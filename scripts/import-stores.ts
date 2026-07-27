// Importa lojas de cosméticos (CNAE 4772-5/00) das 4 cidades do MVP a partir dos
// Dados Abertos de CNPJ da Receita Federal, geocodifica via Nominatim e grava em Store.
//
// Desenhado pra rodar numa máquina com pouco disco livre (~15GB): processa UMA parte
// por vez — baixa um zip, descompacta, filtra em streaming linha a linha, e APAGA o
// zip e o CSV antes de baixar a próxima parte. O pico de disco por iteração é o
// tamanho de uma única parte (poucos GB), nunca o dataset inteiro.
//
// A Receita hospeda os arquivos num Nextcloud do SERPRO (arquivos.receitafederal.gov.br),
// acessível via WebDAV com o token público do compartilhamento.
//
// Reimport idempotente: upsert por CNPJ. Em update, atualiza dado fresco da fonte
// (nome/endereço/bairro/telefone/situação/lat/lng/distância), mas NUNCA sobrescreve
// `status` nem `notes`, e só sobrescreve `storeType`/`establishmentKind` se as
// respectivas flags *Auto ainda forem true (ninguém corrigiu manualmente) —
// preserva o trabalho de campo entre reimports.
//
// Uso:
//   npx tsx scripts/import-stores.ts                  # import completo (baixa ~10 partes de cada)
//   npx tsx scripts/import-stores.ts --dry-run        # não grava no banco, só mostra o que faria
//   npx tsx scripts/import-stores.ts --max-parts 1    # smoke test: só a 1ª parte de cada arquivo
//   npx tsx scripts/import-stores.ts --limit 5        # processa (geocodifica/grava) no máx. 5 lojas
//   npx tsx scripts/import-stores.ts --period 2026-06 # usa uma pasta mensal específica

import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  CNAE_COSMETICOS,
  MVP_CITIES,
  WAREHOUSE,
  classifyEstablishmentKind,
  classifyStoreType,
  haversineKm,
  normalizeName,
} from '../src/lib/pdv';

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

const SHARE_TOKEN = 'gn672Ad4CF8N6TK'; // token público do compartilhamento da Receita
const WEBDAV_BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ';
const AUTH_HEADER = `Basic ${Buffer.from(`${SHARE_TOKEN}:`).toString('base64')}`;
const USER_AGENT = 'mapa-pdvs-vitiss-import/1.0 (stein100706@gmail.com)';
const WORK_DIR = path.join(os.tmpdir(), 'cnpj-import-pdv');
const NOMINATIM_DELAY_MS = 1100; // política de uso do Nominatim: máx. 1 req/s

const COL = {
  CNPJ_BASICO: 0,
  CNPJ_ORDEM: 1,
  CNPJ_DV: 2,
  NOME_FANTASIA: 4,
  SITUACAO: 5, // '02' = ATIVA
  CNAE_PRINCIPAL: 11,
  TIPO_LOGRADOURO: 13,
  LOGRADOURO: 14,
  NUMERO: 15,
  BAIRRO: 17,
  CEP: 18,
  UF: 19,
  MUNICIPIO: 20, // código TOM/Receita (4 dígitos), resolvido via Municipios.zip
  DDD1: 21,
  TELEFONE1: 22,
} as const;

interface CliOptions {
  dryRun: boolean;
  limit: number | null;
  maxParts: number | null;
  period: string | null;
}

interface EstabRow {
  cnpj: string;
  cnpjBasico: string;
  nomeFantasia: string | null;
  active: boolean;
  address: string | null;
  neighborhood: string | null;
  cep: string | null;
  city: string;
  phone: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, limit: null, maxParts: null, period: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--limit') opts.limit = Number.parseInt(argv[++i], 10);
    else if (arg === '--max-parts') opts.maxParts = Number.parseInt(argv[++i], 10);
    else if (arg === '--period') opts.period = argv[++i];
    else {
      console.error(`Argumento desconhecido: ${arg}`);
      process.exit(1);
    }
  }
  if (opts.limit !== null && !Number.isInteger(opts.limit)) throw new Error('--limit exige um número');
  if (opts.maxParts !== null && !Number.isInteger(opts.maxParts)) throw new Error('--max-parts exige um número');
  if (opts.period !== null && !/^\d{4}-\d{2}$/.test(opts.period)) throw new Error('--period exige o formato YYYY-MM');
  return opts;
}

async function webdavList(dirPath: string): Promise<string[]> {
  const res = await fetch(`${WEBDAV_BASE}${dirPath}`, {
    method: 'PROPFIND',
    headers: { Authorization: AUTH_HEADER, Depth: '1', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`PROPFIND ${dirPath} falhou: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const hrefs = [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => decodeURIComponent(m[1]));
  return hrefs;
}

async function resolvePeriod(requested: string | null): Promise<string> {
  if (requested) return requested;
  const hrefs = await webdavList('/');
  const periods = hrefs
    .map((h) => h.match(/\/(\d{4}-\d{2})\/?$/)?.[1])
    .filter((p): p is string => Boolean(p))
    .sort();
  if (periods.length === 0) throw new Error('Nenhuma pasta mensal encontrada no servidor da Receita');
  return periods[periods.length - 1];
}

async function listZipParts(period: string, prefix: 'Estabelecimentos' | 'Empresas'): Promise<string[]> {
  const hrefs = await webdavList(`/${period}/`);
  const re = new RegExp(`/(${prefix}\\d+\\.zip)$`);
  return hrefs
    .map((h) => h.match(re)?.[1])
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function downloadFile(period: string, fileName: string, destPath: string): Promise<void> {
  const url = `${WEBDAV_BASE}/${period}/${fileName}`;
  const res = await fetch(url, { headers: { Authorization: AUTH_HEADER, 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Download de ${fileName} falhou: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(destPath));
}

async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  await mkdir(destDir, { recursive: true });
  await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', destDir]);
  const files = await readdir(destDir);
  return files.map((f) => path.join(destDir, f));
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ';') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function scanCsvFile(filePath: string, onRow: (cols: string[]) => void): Promise<number> {
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });
  let count = 0;
  for await (const line of rl) {
    if (!line) continue;
    onRow(parseCsvLine(line));
    count++;
  }
  return count;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

async function resolveMunicipalityCodes(period: string): Promise<Map<string, string>> {
  const zipPath = path.join(WORK_DIR, 'Municipios.zip');
  const extractDir = path.join(WORK_DIR, 'municipios');
  console.log('Baixando Municipios.zip (arquivo de referência, ~40KB)...');
  await downloadFile(period, 'Municipios.zip', zipPath);
  const files = await extractZip(zipPath, extractDir);

  const wanted = new Map(MVP_CITIES.map((c) => [normalizeName(c), c]));
  const codeToCity = new Map<string, string>();
  for (const file of files) {
    await scanCsvFile(file, (cols) => {
      const canonical = wanted.get(normalizeName(cols[1] ?? ''));
      if (canonical) codeToCity.set(cols[0], canonical);
    });
  }
  await rm(zipPath, { force: true });
  await rm(extractDir, { recursive: true, force: true });

  if (codeToCity.size !== MVP_CITIES.length) {
    throw new Error(
      `Esperava ${MVP_CITIES.length} códigos de município, achei ${codeToCity.size}: ` +
        JSON.stringify([...codeToCity.entries()]),
    );
  }
  console.log('Códigos de município resolvidos:', Object.fromEntries(codeToCity));
  return codeToCity;
}

async function scanEstabelecimentos(
  period: string,
  parts: string[],
  codeToCity: Map<string, string>,
): Promise<EstabRow[]> {
  const rows: EstabRow[] = [];

  for (const partName of parts) {
    const zipPath = path.join(WORK_DIR, partName);
    const extractDir = path.join(WORK_DIR, partName.replace('.zip', ''));
    console.log(`\n[${partName}] baixando...`);
    await downloadFile(period, partName, zipPath);
    console.log(`[${partName}] descompactando...`);
    const files = await extractZip(zipPath, extractDir);
    await rm(zipPath, { force: true });

    let scanned = 0;
    for (const file of files) {
      scanned += await scanCsvFile(file, (cols) => {
        if (cols[COL.CNAE_PRINCIPAL] !== CNAE_COSMETICOS) return;
        const city = codeToCity.get(cols[COL.MUNICIPIO]);
        if (!city) return;

        const cnpj = `${cols[COL.CNPJ_BASICO]}${cols[COL.CNPJ_ORDEM]}${cols[COL.CNPJ_DV]}`;
        const logradouro = [cols[COL.TIPO_LOGRADOURO], cols[COL.LOGRADOURO]].filter(Boolean).join(' ').trim();
        const numero = cols[COL.NUMERO]?.trim();
        const address = logradouro
          ? titleCase(numero && numero !== 'S/N' ? `${logradouro}, ${numero}` : logradouro)
          : null;
        const ddd = cols[COL.DDD1]?.trim();
        const tel = cols[COL.TELEFONE1]?.trim();

        rows.push({
          cnpj,
          cnpjBasico: cols[COL.CNPJ_BASICO],
          nomeFantasia: cols[COL.NOME_FANTASIA]?.trim() ? titleCase(cols[COL.NOME_FANTASIA].trim()) : null,
          active: cols[COL.SITUACAO] === '02',
          address,
          neighborhood: cols[COL.BAIRRO]?.trim() ? titleCase(cols[COL.BAIRRO].trim()) : null,
          cep: cols[COL.CEP]?.trim() || null,
          city,
          phone: ddd && tel ? `(${ddd}) ${tel}` : null,
        });
      });
    }

    await rm(extractDir, { recursive: true, force: true });
    console.log(`[${partName}] ${scanned} linhas varridas — ${rows.length} lojas acumuladas no filtro`);
  }

  return rows;
}

async function scanEmpresas(
  period: string,
  parts: string[],
  basicos: Set<string>,
): Promise<Map<string, string>> {
  const razaoByBasico = new Map<string, string>();

  for (const partName of parts) {
    if (razaoByBasico.size === basicos.size) break;
    const zipPath = path.join(WORK_DIR, partName);
    const extractDir = path.join(WORK_DIR, partName.replace('.zip', ''));
    console.log(`\n[${partName}] baixando...`);
    await downloadFile(period, partName, zipPath);
    console.log(`[${partName}] descompactando...`);
    const files = await extractZip(zipPath, extractDir);
    await rm(zipPath, { force: true });

    for (const file of files) {
      await scanCsvFile(file, (cols) => {
        if (basicos.has(cols[0]) && cols[1]) razaoByBasico.set(cols[0], titleCase(cols[1].trim()));
      });
    }

    await rm(extractDir, { recursive: true, force: true });
    console.log(`[${partName}] razões sociais encontradas: ${razaoByBasico.size}/${basicos.size}`);
  }

  return razaoByBasico;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastNominatimCall = 0;

async function nominatimSearch(params: Record<string, string>): Promise<{ lat: number; lng: number } | null> {
  const wait = lastNominatimCall + NOMINATIM_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastNominatimCall = Date.now();

  const qs = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    console.warn(`  Nominatim respondeu ${res.status} — pulando geocodificação desta loja`);
    return null;
  }
  const results = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!results.length) return null;
  return { lat: Number.parseFloat(results[0].lat), lng: Number.parseFloat(results[0].lon) };
}

async function geocode(row: EstabRow): Promise<{ lat: number; lng: number } | null> {
  if (row.address) {
    const hit = await nominatimSearch({ street: row.address, city: row.city, state: 'Paraná', country: 'Brasil' });
    if (hit) return hit;
  }
  if (row.cep) {
    const hit = await nominatimSearch({ postalcode: row.cep, country: 'Brasil' });
    if (hit) return hit;
  }
  if (row.neighborhood) {
    const hit = await nominatimSearch({ q: `${row.neighborhood}, ${row.city}, Paraná, Brasil` });
    if (hit) return hit;
  }
  return null;
}

async function upsertStores(rows: EstabRow[], razaoByBasico: Map<string, string>, opts: CliOptions) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let geocoded = 0;
  let processed = 0;

  for (const row of rows) {
    if (opts.limit !== null && processed >= opts.limit) {
      console.log(`\n--limit ${opts.limit} atingido — parando.`);
      break;
    }
    processed++;

    const name = row.nomeFantasia || razaoByBasico.get(row.cnpjBasico) || 'Sem nome';
    const existing = await prisma.store.findUnique({ where: { cnpj: row.cnpj } });

    if (!row.active && !existing) {
      skipped++;
      continue;
    }

    let lat = existing?.lat ?? null;
    let lng = existing?.lng ?? null;
    const addressChanged = existing ? existing.address !== row.address : true;
    if (row.active && (lat == null || lng == null || addressChanged)) {
      const hit = await geocode(row);
      if (hit) {
        lat = hit.lat;
        lng = hit.lng;
        geocoded++;
      } else {
        console.warn(`  Sem geocodificação pra ${name} (${row.address ?? 'sem endereço'}, ${row.city}) — fica sem pin no mapa`);
      }
    }
    const distanceKm = lat != null && lng != null
      ? Math.round(haversineKm(WAREHOUSE.lat, WAREHOUSE.lng, lat, lng) * 10) / 10
      : null;

    const fullName = `${name} ${razaoByBasico.get(row.cnpjBasico) ?? ''}`;
    const autoType = classifyStoreType(fullName);
    const autoKind = classifyEstablishmentKind(fullName);

    if (opts.dryRun) {
      const action = existing ? 'atualizaria' : 'criaria';
      console.log(
        `[dry-run] ${action}: ${name} | ${row.cnpj} | ${row.address ?? '—'}, ${row.neighborhood ?? '—'}, ${row.city}` +
          ` | tipo=${autoType} | kind=${autoKind} | ativa=${row.active} | lat/lng=${lat?.toFixed(5) ?? '—'},${lng?.toFixed(5) ?? '—'} | dist=${distanceKm ?? '—'}km`,
      );
      continue;
    }

    if (existing) {
      await prisma.store.update({
        where: { cnpj: row.cnpj },
        data: {
          name,
          address: row.address,
          neighborhood: row.neighborhood,
          city: row.city,
          state: 'PR',
          phone: row.phone,
          cnaeActive: row.active,
          lat,
          lng,
          distanceKm,
          ...(existing.storeTypeAuto ? { storeType: autoType } : {}),
          ...(existing.establishmentKindAuto ? { establishmentKind: autoKind } : {}),
        },
      });
      updated++;
    } else {
      await prisma.store.create({
        data: {
          cnpj: row.cnpj,
          name,
          address: row.address,
          neighborhood: row.neighborhood,
          city: row.city,
          state: 'PR',
          phone: row.phone,
          cnaeActive: row.active,
          lat,
          lng,
          distanceKm,
          storeType: autoType,
          storeTypeAuto: true,
          establishmentKind: autoKind,
          establishmentKindAuto: true,
        },
      });
      created++;
    }
  }

  console.log(
    `\nConcluído: ${created} criadas, ${updated} atualizadas, ${skipped} ignoradas (baixadas/inativas), ${geocoded} geocodificadas.`,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });

  try {
    const period = await resolvePeriod(opts.period);
    console.log(`Pasta mensal da Receita: ${period}${opts.dryRun ? ' (dry-run: nada será gravado)' : ''}`);

    const codeToCity = await resolveMunicipalityCodes(period);

    let estabParts = await listZipParts(period, 'Estabelecimentos');
    let empresaParts = await listZipParts(period, 'Empresas');
    if (opts.maxParts !== null) {
      estabParts = estabParts.slice(0, opts.maxParts);
      empresaParts = empresaParts.slice(0, opts.maxParts);
      console.log(`--max-parts ${opts.maxParts}: processando só ${estabParts.map((p) => p).join(', ')}`);
    }
    if (estabParts.length === 0) throw new Error('Nenhuma parte de Estabelecimentos encontrada');

    const rows = await scanEstabelecimentos(period, estabParts, codeToCity);
    console.log(`\nTotal filtrado: ${rows.length} estabelecimentos (CNAE ${CNAE_COSMETICOS}, 4 cidades do MVP)`);
    if (rows.length === 0) {
      console.log('Nada a importar.');
      return;
    }

    const basicos = new Set(rows.map((r) => r.cnpjBasico));
    const razaoByBasico = await scanEmpresas(period, empresaParts, basicos);

    console.log('\nGeocodificando e gravando (Nominatim, máx. 1 req/s — pode levar alguns minutos)...');
    await upsertStores(rows, razaoByBasico, opts);
  } finally {
    await rm(WORK_DIR, { recursive: true, force: true });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
