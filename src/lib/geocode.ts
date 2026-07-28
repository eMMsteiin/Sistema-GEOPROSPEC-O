// Geocodificação de endereço brasileiro via Nominatim (OpenStreetMap).
// Sem dependência de Next.js — usado pelos scripts de manutenção via import
// relativo. Respeita a política de uso do Nominatim (máx. 1 req/s).

import { formatCep } from './pdv';

const USER_AGENT = 'mapa-pdvs-vitiss/1.0 (stein100706@gmail.com)';
const NOMINATIM_DELAY_MS = 1100;

export type GeocodePrecisionValue = 'EXACT' | 'STREET' | 'POSTAL' | 'NEIGHBORHOOD' | 'NONE';

export interface GeocodeInput {
  address: string | null;
  addressNumber: string | null;
  postalCode: string | null;
  neighborhood: string | null;
  city: string;
}

export interface GeocodeHit {
  lat: number;
  lng: number;
  precision: GeocodePrecisionValue;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

async function search(
  params: Record<string, string>,
): Promise<{ lat: number; lng: number; hasHouseNumber: boolean } | null> {
  const wait = lastCall + NOMINATIM_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const qs = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'br',
    addressdetails: '1', // precisa pra saber se bateu número de porta
    ...params,
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    console.warn(`  Nominatim respondeu ${res.status} — pulando geocodificação`);
    return null;
  }
  const results = (await res.json()) as Array<{
    lat: string;
    lon: string;
    address?: { house_number?: string };
  }>;
  if (!results.length) return null;
  const hit = results[0];
  return {
    lat: Number.parseFloat(hit.lat),
    lng: Number.parseFloat(hit.lon),
    hasHouseNumber: Boolean(hit.address?.house_number),
  };
}

/**
 * Geocodifica em cascata, do mais preciso pro mais grosseiro, devolvendo junto o
 * quão confiável foi o acerto.
 *
 * Detalhe que custou caro: na busca estruturada do Nominatim o número de porta
 * tem que vir ANTES do nome da rua ("1206 Rua Quirino Zagonel"). Passando
 * "Rua Quirino Zagonel, 1206" o número é ignorado e a resposta cai num ponto
 * qualquer da via — verificado na prática, caía a ~1,5 km do endereço real, em
 * outro bairro. Mesmo com o formato certo, o OpenStreetMap tem pouca cobertura
 * de número de porta em rua residencial brasileira, então na maioria das vezes o
 * melhor possível é nível de rua — por isso a precisão é gravada e mostrada.
 */
export async function geocodeAddress(row: GeocodeInput): Promise<GeocodeHit | null> {
  const cep = formatCep(row.postalCode);
  const street = row.address
    ? row.addressNumber
      ? `${row.addressNumber} ${row.address}`
      : row.address
    : null;

  // 1) rua + número (+ CEP, que desambigua ruas homônimas na mesma cidade)
  if (street) {
    const hit = await search({
      street,
      city: row.city,
      state: 'Paraná',
      country: 'Brasil',
      ...(cep ? { postalcode: cep } : {}),
    });
    if (hit) return { lat: hit.lat, lng: hit.lng, precision: hit.hasHouseNumber ? 'EXACT' : 'STREET' };
  }

  // 2) mesma coisa sem o CEP (CEP genérico/errado no cadastro é comum)
  if (street && cep) {
    const hit = await search({ street, city: row.city, state: 'Paraná', country: 'Brasil' });
    if (hit) return { lat: hit.lat, lng: hit.lng, precision: hit.hasHouseNumber ? 'EXACT' : 'STREET' };
  }

  // 3) centro do CEP
  if (cep) {
    const hit = await search({ postalcode: cep, country: 'Brasil' });
    if (hit) return { lat: hit.lat, lng: hit.lng, precision: 'POSTAL' };
  }

  // 4) centro do bairro — só pra loja não sumir do mapa
  if (row.neighborhood) {
    const hit = await search({ q: `${row.neighborhood}, ${row.city}, Paraná, Brasil` });
    if (hit) return { lat: hit.lat, lng: hit.lng, precision: 'NEIGHBORHOOD' };
  }

  return null;
}
