// Cadastra lojas manualmente por CNPJ — para quando a existência real da loja
// já foi confirmada por fora (busca na web, Google Maps etc.), sem depender do
// import em massa da Receita. Puxa o cadastro oficial completo via BrasilAPI
// (mesma fonte já usada no /api/cnpj do sistema de pedidos), geocodifica e
// classifica do mesmo jeito que o import em massa — só que aqui o tipo de
// estabelecimento é sempre "loja física" e travado (establishmentKindAuto =
// false), porque a verificação humana que already aconteceu é mais confiável
// que o padrão de nome que o classificador automático usa como aproximação.
//
// Uso:
//   npx tsx scripts/add-stores.ts 64096318000109 11222333000181
//   npx tsx scripts/add-stores.ts --file lojas.txt      # um CNPJ por linha
//   npx tsx scripts/add-stores.ts --dry-run 64096318000109

import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import {
  IBGE_CODE_BY_CITY,
  WAREHOUSE,
  classifyStoreType,
  formatFullAddress,
  haversineKm,
  normalizeHouseNumber,
} from '../src/lib/pdv';
import { geocodeAddress } from '../src/lib/geocode';

const prisma = new PrismaClient();
const USER_AGENT = 'mapa-pdvs-vitiss-add-stores/1.0 (stein100706@gmail.com)';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CITY_BY_IBGE_CODE = new Map(Object.entries(IBGE_CODE_BY_CITY).map(([city, code]) => [code, city]));

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

interface BrasilApiCnpj {
  razao_social: string;
  nome_fantasia: string | null;
  logradouro: string | null;
  descricao_tipo_de_logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  codigo_municipio_ibge: number;
  municipio: string;
  uf: string;
  ddd_telefone_1: string | null;
  descricao_situacao_cadastral: string;
}

async function fetchCnpj(cnpj: string): Promise<BrasilApiCnpj | null> {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BrasilAPI respondeu ${res.status} pro CNPJ ${cnpj}`);
  return (await res.json()) as BrasilApiCnpj;
}

interface AddressOverride {
  address?: string;
  addressNumber?: string | null;
  neighborhood?: string;
}

/**
 * Cada entrada pode ser só o CNPJ, ou "CNPJ|Rua Nome, Número|Bairro" — o
 * cadastro da Receita frequentemente não tem logradouro/número pra micro-loja
 * (aconteceu na prática: Bia Bella, CNPJ 22.745.360/0001-55, veio com rua e
 * número em branco), mas uma pesquisa externa às vezes já traz o endereço
 * comercial certo. Bairro e CEP continuam vindo da Receita mesmo com override.
 */
function parseEntry(entry: string): { cnpj: string; override: AddressOverride } {
  const [cnpjPart, addrPart, bairroPart] = entry.split('|').map((s) => s.trim());
  const cnpj = cnpjPart.replace(/\D/g, '');
  const override: AddressOverride = {};
  if (addrPart) {
    const m = addrPart.match(/^(.*?),\s*(\S+)$/);
    if (m) {
      override.address = m[1].trim();
      override.addressNumber = normalizeHouseNumber(m[2]);
    } else {
      override.address = addrPart;
    }
  }
  if (bairroPart) override.neighborhood = bairroPart;
  return { cnpj, override };
}

function parseArgs(argv: string[]): { dryRun: boolean; entries: string[]; file: string | null } {
  const dryRun = argv.includes('--dry-run');
  const fileIdx = argv.indexOf('--file');
  const file = fileIdx >= 0 ? argv[fileIdx + 1] : null;
  // fileIdx = -1 quando --file não foi passado — sem essa checagem, "i !==
  // fileIdx + 1" vira "i !== 0" e derruba silenciosamente o 1º argumento real.
  const entries = argv.filter(
    (a, i) => a !== '--dry-run' && (fileIdx < 0 || (i !== fileIdx && i !== fileIdx + 1)) && !a.startsWith('--'),
  );
  return { dryRun, entries, file };
}

async function main() {
  const { dryRun, entries: cliEntries, file } = parseArgs(process.argv.slice(2));

  const rawEntries = [...cliEntries];
  if (file) {
    const content = await readFile(file, 'utf-8');
    rawEntries.push(
      ...content
        .split('\n')
        .map((l) => l.split('#')[0].trim()) // '#' inicia comentário na linha
        .filter(Boolean),
    );
  }

  const byCnpj = new Map<string, AddressOverride>();
  for (const entry of rawEntries) {
    const { cnpj, override } = parseEntry(entry);
    if (cnpj.length === 14) byCnpj.set(cnpj, override);
  }
  const cnpjs = [...byCnpj.keys()];
  if (cnpjs.length === 0) {
    console.error(
      'Nenhum CNPJ válido informado (precisa de 14 dígitos). Uso:\n' +
        '  npx tsx scripts/add-stores.ts <cnpj...> [--file lista.txt] [--dry-run]\n' +
        '  cada entrada pode ser "CNPJ" ou "CNPJ|Rua Nome, Número|Bairro" (override de endereço)',
    );
    process.exit(1);
  }

  console.log(`${cnpjs.length} CNPJ(s) pra processar${dryRun ? ' (dry-run: nada será gravado)' : ''}.\n`);

  let created = 0, updated = 0, skippedCity = 0, skippedNotFound = 0, skippedNoGeo = 0;

  for (const cnpj of cnpjs) {
    const override = byCnpj.get(cnpj) ?? {};
    const data = await fetchCnpj(cnpj);
    await sleep(400); // sem política pública de rate limit documentada — throttle leve por educação

    if (!data) {
      console.warn(`  [não encontrado] ${cnpj}`);
      skippedNotFound++;
      continue;
    }

    const city = CITY_BY_IBGE_CODE.get(String(data.codigo_municipio_ibge));
    if (!city) {
      console.warn(`  [fora da área coberta] ${data.razao_social} — ${data.municipio}/${data.uf}`);
      skippedCity++;
      continue;
    }

    const name = data.nome_fantasia?.trim() || data.razao_social;
    const logradouro = [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' ').trim();
    let address = logradouro ? titleCase(logradouro) : null;
    let addressNumber = normalizeHouseNumber(data.numero);
    const addressComplement = data.complemento?.trim() ? titleCase(data.complemento.trim()) : null;
    let neighborhood = data.bairro?.trim() ? titleCase(data.bairro.trim()) : null;

    if (override.address) {
      console.log(`  [override] ${name}: endereço da Receita era "${address ?? '(vazio)'}, ${addressNumber ?? 's/n'}" — usando "${override.address}, ${override.addressNumber ?? 's/n'}"`);
      address = override.address;
      addressNumber = override.addressNumber ?? null;
    }
    if (override.neighborhood) neighborhood = override.neighborhood;
    const cepDigits = (data.cep ?? '').replace(/\D/g, '');
    const postalCode = cepDigits.length === 8 ? cepDigits : null;
    const phoneDigits = (data.ddd_telefone_1 ?? '').replace(/\D/g, '');
    const phone = phoneDigits.length >= 10 ? `(${phoneDigits.slice(0, 2)}) ${phoneDigits.slice(2)}` : null;
    const cnaeActive = data.descricao_situacao_cadastral === 'ATIVA';

    const geo = await geocodeAddress({ address, addressNumber, postalCode, neighborhood, city });
    if (!geo) {
      console.warn(`  [sem geocodificação] ${name} — ${formatFullAddress({ address, addressNumber, addressComplement, postalCode, neighborhood, city, state: data.uf })}`);
    }
    const distanceKm = geo ? Math.round(haversineKm(WAREHOUSE.lat, WAREHOUSE.lng, geo.lat, geo.lng) * 10) / 10 : null;
    if (!geo) skippedNoGeo++;

    const autoType = classifyStoreType(`${name} ${data.razao_social}`);

    const fresh = {
      name,
      address,
      addressNumber,
      addressComplement,
      postalCode,
      neighborhood,
      city,
      state: data.uf,
      phone,
      cnaeActive,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      geocodePrecision: geo?.precision ?? 'NONE',
      distanceKm,
      // Confirmada por fora como loja física de verdade — trava a
      // classificação pra não ser sobrescrita num reimport em massa futuro.
      establishmentKind: 'PHYSICAL_STORE' as const,
      establishmentKindAuto: false,
    };

    const addr = formatFullAddress({ ...fresh });
    if (dryRun) {
      console.log(`  [dry-run] ${name} | ${cnpj} | ${addr} | precisão=${fresh.geocodePrecision}`);
      continue;
    }

    const existing = await prisma.store.findUnique({ where: { cnpj } });
    if (existing) {
      await prisma.store.update({
        where: { cnpj },
        data: { ...fresh, ...(existing.storeTypeAuto ? { storeType: autoType } : {}) },
      });
      console.log(`  [atualizada] ${name} — ${addr}`);
      updated++;
    } else {
      await prisma.store.create({
        data: { cnpj, ...fresh, storeType: autoType, storeTypeAuto: true },
      });
      console.log(`  [criada] ${name} — ${addr}`);
      created++;
    }
  }

  console.log(
    `\nConcluído: ${created} criadas, ${updated} atualizadas, ${skippedCity} fora da área coberta, ` +
      `${skippedNotFound} não encontradas, ${skippedNoGeo} sem geocodificação (gravadas mesmo assim, sem pino no mapa).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
