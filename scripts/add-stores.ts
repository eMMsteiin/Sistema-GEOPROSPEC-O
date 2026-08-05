// Cadastra lojas manualmente — para quando a existência real da loja já foi
// confirmada por fora (busca na web, Google Maps etc.), sem depender do
// import em massa da Receita. Duas modalidades por entrada:
//
//   Com CNPJ:    puxa o cadastro oficial completo via BrasilAPI (mesma fonte
//                já usada no /api/cnpj do sistema de pedidos) — endereço,
//                bairro, CEP, telefone, situação cadastral.
//   Sem CNPJ:    na prática, a maioria das lojas pequenas/MEI reais que uma
//                pesquisa externa encontra NÃO tem CNPJ localizável em base
//                gratuita (~16% de acerto, medido numa leva real de ~25
//                lojas) — cadastra só com nome + endereço + cidade, deixando
//                o CNPJ pra completar depois se aparecer.
//
// Nos dois casos, geocodifica e classifica pelo mesmo pipeline compartilhado
// do import em massa, e o tipo de estabelecimento sai sempre como "loja
// física" travada (establishmentKindAuto = false) — a verificação humana que
// já aconteceu é mais confiável que o padrão de nome que o classificador
// automático usa como aproximação.
//
// Formato de cada entrada (uma por linha no --file, ou um argumento por loja):
//   <CNPJ>
//   <CNPJ>|Rua Nome, Número|Bairro|LinkMaps|Notas
//   Nome da loja|Rua Nome, Número|Bairro|Cidade|Telefone|LinkMaps|Notas
//
// Endereço, bairro, LinkMaps e Notas são opcionais (deixar vazio entre os
// pipes) — Cidade é obrigatória no modo sem CNPJ. LinkMaps, quando informado
// (ex.: link de place_id confirmado no Google), substitui o link de busca
// aproximado que o sistema geraria a partir do endereço.
//
// Uso:
//   npx tsx scripts/add-stores.ts 64096318000109 "Bia Bella|Rua X, 10|Centro"
//   npx tsx scripts/add-stores.ts --file lojas.txt
//   npx tsx scripts/add-stores.ts --dry-run 64096318000109

import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import {
  IBGE_CODE_BY_CITY,
  MVP_CITIES,
  WAREHOUSE,
  classifyProfiles,
  classifyStoreType,
  formatFullAddress,
  haversineKm,
  normalizeGoogleMapsUrl,
  normalizeHouseNumber,
  normalizeName,
} from '../src/lib/pdv';
import { geocodeAddress } from '../src/lib/geocode';
import type { GeocodePrecision } from '@prisma/client';

const prisma = new PrismaClient();
const USER_AGENT = 'mapa-pdvs-vitiss-add-stores/1.0 (stein100706@gmail.com)';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CITY_BY_IBGE_CODE = new Map(Object.entries(IBGE_CODE_BY_CITY).map(([city, code]) => [code, city]));
const CITY_BY_NORM_NAME = new Map(MVP_CITIES.map((c) => [normalizeName(c), c]));

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** "Rua Nome, Número" → partes separadas; sem vírgula, tudo vira o nome da rua. */
function splitStreetAndNumber(s: string): { address: string; addressNumber: string | null } {
  const m = s.match(/^(.*?),\s*(\S+)$/);
  return m ? { address: m[1].trim(), addressNumber: normalizeHouseNumber(m[2]) } : { address: s, addressNumber: null };
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
  googleMapsUrl?: string;
  notes?: string;
}

interface ManualEntry {
  name: string;
  address: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string;
  phone: string | null;
  googleMapsUrl: string | null;
  notes: string | null;
}

type ParsedEntry = { kind: 'cnpj'; cnpj: string; override: AddressOverride } | { kind: 'manual'; data: ManualEntry };

/** Primeiro campo com 14 dígitos após tirar pontuação = CNPJ; senão é nome (modo manual). */
function parseEntry(entry: string): ParsedEntry | null {
  const parts = entry.split('|').map((s) => s.trim());
  const firstDigits = parts[0].replace(/\D/g, '');

  if (firstDigits.length === 14) {
    const override: AddressOverride = {};
    if (parts[1]) Object.assign(override, splitStreetAndNumber(parts[1]));
    if (parts[2]) override.neighborhood = parts[2];
    if (parts[3]) override.googleMapsUrl = parts[3];
    if (parts[4]) override.notes = parts[4];
    return { kind: 'cnpj', cnpj: firstDigits, override };
  }

  const [name, addrPart, bairroPart, cidadePart, telefonePart, mapsPart, notesPart] = parts;
  if (!name || !cidadePart) return null; // sem cidade não dá pra saber se está na área coberta
  const city = CITY_BY_NORM_NAME.get(normalizeName(cidadePart));
  if (!city) {
    console.warn(`  [cidade não reconhecida] "${cidadePart}" (entrada: ${name}) — cidades cobertas: ${MVP_CITIES.join(', ')}`);
    return null;
  }
  const { address, addressNumber } = addrPart ? splitStreetAndNumber(addrPart) : { address: null, addressNumber: null };
  return {
    kind: 'manual',
    data: {
      name,
      address,
      addressNumber,
      neighborhood: bairroPart || null,
      city,
      phone: telefonePart || null,
      googleMapsUrl: mapsPart || null,
      notes: notesPart || null,
    },
  };
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

interface FreshStoreData {
  name: string;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  postalCode: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  phone: string | null;
  googleMapsUrl: string | null;
  cnaeActive: boolean;
  lat: number | null;
  lng: number | null;
  geocodePrecision: GeocodePrecision;
  distanceKm: number | null;
  establishmentKind: 'PHYSICAL_STORE';
  establishmentKindAuto: false;
}

async function buildFresh(
  name: string,
  address: string | null,
  addressNumber: string | null,
  neighborhood: string | null,
  city: string,
  state: string,
  postalCode: string | null,
  phone: string | null,
  googleMapsUrl: string | null,
  cnaeActive: boolean,
): Promise<{ fresh: FreshStoreData; geocoded: boolean }> {
  const geo = await geocodeAddress({ address, addressNumber, postalCode, neighborhood, city });
  const distanceKm = geo ? Math.round(haversineKm(WAREHOUSE.lat, WAREHOUSE.lng, geo.lat, geo.lng) * 10) / 10 : null;
  return {
    fresh: {
      name,
      address,
      addressNumber,
      addressComplement: null,
      postalCode,
      neighborhood,
      city,
      state,
      phone,
      googleMapsUrl,
      cnaeActive,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      geocodePrecision: geo?.precision ?? 'NONE',
      distanceKm,
      // Confirmada por fora como loja física de verdade — trava a
      // classificação pra não ser sobrescrita num reimport em massa futuro.
      establishmentKind: 'PHYSICAL_STORE',
      establishmentKindAuto: false,
    },
    geocoded: Boolean(geo),
  };
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

  const entries = rawEntries.map(parseEntry).filter((e): e is ParsedEntry => e !== null);
  if (entries.length === 0) {
    console.error(
      'Nenhuma entrada válida. Uso:\n' +
        '  npx tsx scripts/add-stores.ts <entrada...> [--file lista.txt] [--dry-run]\n' +
        '  "<CNPJ>" | "<CNPJ>|Rua Nome, Número|Bairro|LinkMaps|Notas" | "Nome|Rua Nome, Número|Bairro|Cidade|Telefone|LinkMaps|Notas"',
    );
    process.exit(1);
  }

  console.log(`${entries.length} entrada(s) pra processar${dryRun ? ' (dry-run: nada será gravado)' : ''}.\n`);

  let created = 0, updated = 0, skippedCity = 0, skippedNotFound = 0, skippedNoGeo = 0;

  for (const entry of entries) {
    if (entry.kind === 'cnpj') {
      const { cnpj, override } = entry;
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

      const googleMapsUrl = override.googleMapsUrl ? normalizeGoogleMapsUrl(override.googleMapsUrl, name) : null;
      const { fresh, geocoded } = await buildFresh(
        name, address, addressNumber, neighborhood, city, data.uf, postalCode, phone, googleMapsUrl, cnaeActive,
      );
      if (!geocoded) {
        console.warn(`  [sem geocodificação] ${name} — ${formatFullAddress(fresh)}`);
        skippedNoGeo++;
      }
      const autoType = classifyStoreType(`${name} ${data.razao_social}`);
      const addr = formatFullAddress(fresh);

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
        const notes = override.notes ?? null;
        await prisma.store.create({
          data: {
            cnpj,
            ...fresh,
            storeType: autoType,
            storeTypeAuto: true,
            notes,
            profiles: classifyProfiles({ name, notes }),
            profilesAuto: true,
          },
        });
        console.log(`  [criada] ${name} — ${addr}`);
        created++;
      }
      continue;
    }

    // --- modo manual (sem CNPJ) ---
    const { name, address, addressNumber, neighborhood, city, phone, notes } = entry.data;
    const googleMapsUrl = entry.data.googleMapsUrl ? normalizeGoogleMapsUrl(entry.data.googleMapsUrl, name) : null;
    const { fresh, geocoded } = await buildFresh(name, address, addressNumber, neighborhood, city, 'PR', null, phone, googleMapsUrl, true);
    if (!geocoded) {
      console.warn(`  [sem geocodificação] ${name} — ${formatFullAddress(fresh)}`);
      skippedNoGeo++;
    }
    const autoType = classifyStoreType(name);
    const addr = formatFullAddress(fresh);

    if (dryRun) {
      console.log(`  [dry-run, sem CNPJ] ${name} | ${addr} | precisão=${fresh.geocodePrecision}${notes ? ` | notas="${notes}"` : ''}`);
      continue;
    }

    // Sem CNPJ não tem chave de upsert natural — casa por nome normalizado +
    // cidade entre o que já existe (com ou sem CNPJ) pra não duplicar se essa
    // mesma loja já veio do import em massa ou de uma leva manual anterior.
    const sameCity = await prisma.store.findMany({ where: { city }, select: { id: true, name: true, storeTypeAuto: true } });
    const match = sameCity.find((s) => normalizeName(s.name) === normalizeName(name));

    if (match) {
      await prisma.store.update({
        where: { id: match.id },
        data: { ...fresh, ...(match.storeTypeAuto ? { storeType: autoType } : {}) },
      });
      console.log(`  [atualizada, sem CNPJ] ${name} — ${addr}`);
      updated++;
    } else {
      await prisma.store.create({
        data: {
          cnpj: null,
          ...fresh,
          storeType: autoType,
          storeTypeAuto: true,
          notes,
          profiles: classifyProfiles({ name, notes }),
          profilesAuto: true,
        },
      });
      console.log(`  [criada, sem CNPJ] ${name} — ${addr}`);
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
