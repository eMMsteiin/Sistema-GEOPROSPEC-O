// Constantes e helpers do mapeamento de PDVs (prospecção de lojas de cosméticos).
// Usado pelos scripts de ingestão (scripts/import-*.ts, via import relativo) e pelas
// API routes — não importar nada de Next.js aqui.

/** CNAE de comércio varejista de cosméticos, perfumaria e higiene pessoal (4772-5/00). */
export const CNAE_COSMETICOS = '4772500';

/** Cidades cobertas — nomes canônicos, como gravados em Store.city / RegionIncome.city. */
export const MVP_CITIES = ['São José dos Pinhais', 'Piraquara', 'Colombo', 'Pinhais', 'Curitiba'] as const;

/** Códigos IBGE de município (7 dígitos) — verificados na API de localidades do IBGE. */
export const IBGE_CODE_BY_CITY: Record<string, string> = {
  'São José dos Pinhais': '4125506',
  'Piraquara': '4119509',
  'Colombo': '4105805',
  'Pinhais': '4119152',
  'Curitiba': '4106902',
};

/**
 * Tier de prioridade por cidade (seção 7 do doc de requisitos). Derivado em código,
 * não é coluna no banco. Tier 1 = MVP; tier 2 = expansão (bairros periféricos de
 * Curitiba); tudo o mais cai em tier 3 (baixa prioridade por enquanto).
 */
const TIER_BY_CITY: Record<string, number> = {
  'sao jose dos pinhais': 1,
  'piraquara': 1,
  'colombo': 1,
  'pinhais': 1,
  'curitiba': 2,
};

/** Normaliza um nome pra comparação: minúsculas, sem acentos, pontuação vira espaço. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tier de prioridade da região (1 = verde, 2 = amarelo, 3 = cinza). */
export function cityTier(city: string): number {
  return TIER_BY_CITY[normalizeName(city)] ?? 3;
}

/**
 * Marcas conhecidas por venderem exclusivamente produto próprio (seção 6 do doc).
 * Usada só para sinalização visual — nunca para esconder a loja do mapa. Expansível.
 */
export const OWN_BRAND_NAMES = [
  'O Boticário',
  'Boticário',
  'Eudora',
  'Quem Disse Berenice',
  'Vult',
  'The Beauty Box',
  'Tô.Que.Tô',
  'Natura',
  'Espaço Natura',
  'Sephora',
  "L'Occitane",
  'The Body Shop',
];

const OWN_BRAND_NORMALIZED = OWN_BRAND_NAMES.map(normalizeName);

/**
 * Classificação automática do tipo de loja pelo nome fantasia / razão social.
 * Casa a marca como palavra/frase inteira (evita falso positivo tipo "Naturalle"
 * contendo "natura"). Sempre corrigível manualmente na UI (storeTypeAuto = false).
 */
export function classifyStoreType(name: string): 'OWN_BRAND' | 'MULTIBRAND' {
  const padded = ` ${normalizeName(name)} `;
  return OWN_BRAND_NORMALIZED.some((brand) => padded.includes(` ${brand} `))
    ? 'OWN_BRAND'
    : 'MULTIBRAND';
}

/**
 * MEIs revendedores (Avon/Natura/Jequiti etc.) não têm nome fantasia próprio, e
 * a Receita gera a razão social a partir dos dados do titular. Dois formatos
 * aparecem na base:
 *
 *  1. CNPJ-básico + nome — "61.931.719 Criseldi Weber Brandao"
 *  2. nome + CPF        — "Rosangela Maria da Silva 87614898915"
 *
 * Loja de verdade tem nome comercial ("Touti Fragrances Ltda"). Os 11 dígitos
 * seguidos do segundo padrão são específicos o bastante pra não pegar nome
 * comercial com número no fim ("Loja 2000" tem 4 dígitos, não 11).
 */
const MEI_NAME_PATTERNS = [
  /^\d{2}\.\d{3}\.\d{3}\s+\S/, // CNPJ-básico na frente
  /\s\d{11}$/, // CPF no fim
];

/**
 * Classificação automática de loja física vs. revendedor individual pelo padrão
 * de nome auto-gerado da Receita pra MEI. Segunda dimensão independente de
 * storeType — nunca esconde a loja do mapa, só sinaliza. Sempre corrigível
 * manualmente na UI (establishmentKindAuto = false).
 */
export function classifyEstablishmentKind(name: string): 'PHYSICAL_STORE' | 'INDIVIDUAL_RESELLER' {
  const trimmed = name.trim();
  return MEI_NAME_PATTERNS.some((re) => re.test(trimmed)) ? 'INDIVIDUAL_RESELLER' : 'PHYSICAL_STORE';
}

// ---------------------------------------------------------------------------
// Perfil (StoreProfile) — segunda dimensão de classificação, independente do
// storeType. Responde "que tipo de loja é essa, como abordar comercialmente",
// não "pode vender Vitiss". Uma loja pode ter vários perfis ao mesmo tempo.
// ---------------------------------------------------------------------------

export type StoreProfileValue =
  | 'BOUTIQUE_BAIRRO'
  | 'FORNECEDORA_PROFISSIONAL'
  | 'REVENDA_MULTI_CATALOGO'
  | 'HIBRIDA_SERVICO'
  | 'POPULAR_DESCONTO'
  | 'REDE_REGIONAL'
  | 'CRUZAMENTO_RAMO';

const POPULAR_DESCONTO_RE = /tudo\s+(a|por)\s+r\$\s?\d/i;
const HIBRIDA_SERVICO_RE = /sal[ãa]o(?!\s+shopping)|depila[çc][ãa]o|manicure|est[ée]tica/i;
const REDE_RE = /\brede\b/i;
const CRUZAMENTO_RAMO_RE = /celular|papelaria|\bmoda\b|\broupas?\b|\bcal[çc]ados?\b|lingerie|variedades/i;
const RESALE_BRANDS = ['natura', 'avon', 'eudora', 'boticário', 'boticario', 'mary kay', 'jequiti', 'alfaparf'];

function countBrandMentions(text: string): number {
  const lower = text.toLowerCase();
  return RESALE_BRANDS.filter((b) => lower.includes(b)).length;
}

/**
 * Extrai nota e nº de avaliações do formato "Google: 4.7★ (123 avaliações)"
 * usado nas observações — não é um campo estruturado, é texto livre digitado
 * durante a curadoria, então é best-effort (null quando não casa o padrão,
 * ex.: "sem avaliações no Google ainda").
 */
function parseGoogleRating(notes: string): { rating: number; reviews: number } | null {
  const m = notes.match(/Google:\s*([\d.]+)★\s*\((\d[\d.]*)\s*avalia/i);
  if (!m) return null;
  const rating = Number.parseFloat(m[1]);
  const reviews = Number.parseInt(m[2].replace(/\./g, ''), 10);
  if (!Number.isFinite(rating) || !Number.isFinite(reviews)) return null;
  return { rating, reviews };
}

/**
 * Classificação automática de perfil por padrões no nome e nas observações
 * (que, na curadoria feita neste projeto, quase sempre trazem a nota e nº de
 * avaliações do Google, e às vezes um aviso textual como "REDE:" ou
 * "VERIFICAR EM CAMPO: revende Natura/Avon/..."). Sempre corrigível
 * manualmente na UI (profilesAuto = false trava contra reimport).
 */
export function classifyProfiles(store: { name: string; notes: string | null }): StoreProfileValue[] {
  const profiles = new Set<StoreProfileValue>();
  const notes = store.notes ?? '';
  const haystack = `${store.name} ${notes}`;

  if (REDE_RE.test(notes)) profiles.add('REDE_REGIONAL');
  if (POPULAR_DESCONTO_RE.test(notes)) profiles.add('POPULAR_DESCONTO');
  if (HIBRIDA_SERVICO_RE.test(haystack)) profiles.add('HIBRIDA_SERVICO');
  if (countBrandMentions(notes) >= 2) profiles.add('REVENDA_MULTI_CATALOGO');
  if (CRUZAMENTO_RAMO_RE.test(store.name)) profiles.add('CRUZAMENTO_RAMO');

  const rating = parseGoogleRating(notes);
  if (rating) {
    if (rating.reviews >= 500) profiles.add('FORNECEDORA_PROFISSIONAL');
    else if (rating.rating >= 4.7 && rating.reviews >= 15) profiles.add('BOUTIQUE_BAIRRO');
  }

  return [...profiles];
}

// ---------------------------------------------------------------------------
// Endereço
// ---------------------------------------------------------------------------

/**
 * A Receita usa vários marcadores pra "sem número". Normaliza todos pra null
 * em vez de gravar "00" ou "S/N" como se fosse número de porta.
 */
const NO_NUMBER = new Set(['', '0', '00', '000', 'S/N', 'SN', 'S N', 'SEM NUMERO', 'SEM NÚMERO']);

export function normalizeHouseNumber(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return NO_NUMBER.has(v) ? null : (raw ?? '').trim() || null;
}

/** CEP com máscara: "83020304" → "83020-304". Devolve null se não tiver 8 dígitos. */
export function formatCep(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : null;
}

export interface AddressParts {
  address: string | null;
  addressNumber: string | null;
  addressComplement?: string | null;
  postalCode: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
}

/**
 * Endereço no formato postal brasileiro:
 * "Rua Quirino Zagonel, 1206 - Itália, São José dos Pinhais - PR, 83020-304".
 *
 * É essa string (e não a nossa coordenada) que vai pro Google Maps: o
 * geocodificador do Google tem cobertura de número de porta muito melhor que a
 * do OpenStreetMap no Brasil, então deixar o Google resolver o texto acerta o
 * ponto com muito mais frequência do que mandar um lat/lng aproximado nosso.
 */
export function formatFullAddress(s: AddressParts, opts: { forQuery?: boolean } = {}): string {
  const { forQuery = false } = opts;
  const street = s.address?.trim();
  // "s/n" comunica bem pra quem lê, mas não ajuda geocodificador nenhum a achar
  // o ponto — então some da string usada como consulta.
  const streetPart = street
    ? s.addressNumber
      ? `${street}, ${s.addressNumber}`
      : forQuery
        ? street
        : `${street}, s/n`
    : null;
  const cep = formatCep(s.postalCode);

  const head = [streetPart, s.neighborhood?.trim() || null].filter(Boolean).join(' - ');
  const tail = [`${s.city} - ${s.state}`, cep].filter(Boolean).join(', ');
  return [head, tail].filter(Boolean).join(', ');
}

/**
 * Link de busca do Google Maps a partir do endereço em texto — aproximado,
 * o Google resolve a consulta na hora. Usado só como fallback quando a loja
 * não tem um link confirmado (Store.googleMapsUrl, vindo de place_id real).
 */
export function googleMapsSearchUrl(s: AddressParts): string | null {
  if (!s.address && !s.postalCode) return null;
  const query = formatFullAddress(s, { forQuery: true });
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Armazém da distribuidora — Rua Canoinhas, 243, Borda do Campo, São José dos
 * Pinhais/PR. Geocodificado uma vez via Nominatim (nível de rua) e fixado aqui.
 */
export const WAREHOUSE = { lat: -25.5333944, lng: -49.0885098 };

/** Distância em linha reta entre dois pontos, em km (fórmula de haversine). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
