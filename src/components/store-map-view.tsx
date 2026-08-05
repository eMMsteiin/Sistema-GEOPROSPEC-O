'use client';

// Mapa de lojas de uma cidade selecionada (fluxo: seletor de região → aqui).
// Filtros client-side por bairro/status/tipo; edição de status, tipo de loja,
// tipo de estabelecimento e observações direto no painel de detalhe.
//
// Nota: o filtro de faixa de renda saiu desta tela por enquanto — dentro de uma
// única cidade a renda é o valor municipal (igual pra todas as lojas), então o
// filtro não filtraria nada. Volta quando houver renda por bairro.

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { EstablishmentKind, GeocodePrecision, ProspectStatus, StoreProfile, StoreType } from '@prisma/client';
import { formatFullAddress, googleMapsSearchUrl } from '@/lib/pdv';

const StoreMap = dynamic(() => import('./store-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center font-mono text-[11px] uppercase tracking-wider text-ink-dim">
      Carregando mapa...
    </div>
  ),
});

export interface StoreWithIncome {
  id: string;
  cnpj: string | null;
  name: string;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  postalCode: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  geocodePrecision: GeocodePrecision;
  distanceKm: number | null;
  storeType: StoreType;
  storeTypeAuto: boolean;
  establishmentKind: EstablishmentKind;
  establishmentKindAuto: boolean;
  profiles: StoreProfile[];
  profilesAuto: boolean;
  status: ProspectStatus;
  phone: string | null;
  notes: string | null;
  visitedByRep: string | null;
  googleMapsUrl: string | null;
  cnaeActive: boolean;
  avgIncome: number | null;
  incomeSource: string | null;
  tier: number;
}

const STATUS_LABELS: Record<ProspectStatus, string> = {
  NOT_VISITED: 'Não visitada',
  VISITED: 'Visitada',
  PARTNER: 'Parceira',
  DECLINED: 'Recusou',
  REQUESTED_TO_REPS: 'Solicitada para os representantes',
};

/**
 * Perfil: segunda dimensão de classificação, independente de storeType/tipo —
 * "que tipo de loja é essa, como abordar comercialmente" em vez de "pode
 * vender Vitiss". Uma loja pode ter mais de um perfil ao mesmo tempo.
 */
const PROFILE_LABELS: Record<StoreProfile, string> = {
  BOUTIQUE_BAIRRO: 'Boutique de bairro',
  FORNECEDORA_PROFISSIONAL: 'Fornecedora profissional',
  REVENDA_MULTI_CATALOGO: 'Revenda multi-catálogo',
  HIBRIDA_SERVICO: 'Híbrida de serviço',
  POPULAR_DESCONTO: 'Popular/desconto',
  REDE_REGIONAL: 'Rede regional',
  CRUZAMENTO_RAMO: 'Cruzamento de ramo',
};

const PROFILE_VALUES = Object.keys(PROFILE_LABELS) as StoreProfile[];

const STATUS_CHIP: Record<ProspectStatus, string> = {
  NOT_VISITED: 'bg-ink-dim/15 text-ink-dim',
  VISITED: 'bg-gold/15 text-gold',
  PARTNER: 'bg-emerald-400/15 text-emerald-300',
  DECLINED: 'bg-glow/15 text-[#ff8fa0]',
  REQUESTED_TO_REPS: 'bg-sky-400/15 text-sky-300',
};

/** Telefone cadastrado na Receita → link direto pro WhatsApp (não é validado, pode estar desatualizado). */
function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/55${digits}`;
}

/**
 * Quão confiável é o pino no nosso mapa. O OpenStreetMap tem cobertura fraca de
 * número de porta em rua residencial brasileira, então na maior parte das vezes
 * o melhor que se consegue é o nível da rua — melhor dizer isso do que deixar o
 * representante achar que o pino está na porta da loja.
 */
const PRECISION_NOTE: Record<GeocodePrecision, string | null> = {
  EXACT: null,
  STREET: 'Pino aproximado: rua certa, número aproximado.',
  POSTAL: 'Pino aproximado: centro do CEP.',
  NEIGHBORHOOD: 'Pino bem aproximado: centro do bairro.',
  NONE: 'Sem localização — não foi possível posicionar no mapa.',
};

const TIER_DOT_COLOR: Record<number, string> = {
  1: 'var(--glow)',
  2: 'var(--gold)',
  3: 'var(--gold-dim)',
};

const TIER_LABELS: Record<number, string> = {
  1: 'Prioridade alta',
  2: 'Prioridade média',
  3: 'Prioridade baixa',
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatCnpj = (c: string | null) =>
  c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;

function TierDot({ tier }: { tier: number }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{
        background: TIER_DOT_COLOR[tier] ?? TIER_DOT_COLOR[3],
        boxShadow: tier === 1 ? '0 0 6px rgba(221,60,86,0.6)' : undefined,
      }}
    />
  );
}

function Badges({ store }: { store: StoreWithIncome }) {
  return (
    <>
      {store.storeType === 'OWN_BRAND' && (
        <span className="inline-block rounded-sm bg-violet-500/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-violet-300">
          ★ Marca própria
        </span>
      )}
      {store.establishmentKind === 'INDIVIDUAL_RESELLER' && (
        <span className="inline-block rounded-sm bg-ink-dim/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-dim">
          Revendedor individual
        </span>
      )}
      {!store.cnaeActive && (
        <span className="inline-block rounded-sm bg-glow/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#ff8fa0]">
          Baixada na Receita
        </span>
      )}
    </>
  );
}

const selectClass =
  'holo-input rounded-sm px-2.5 py-1.5 text-sm';

export default function StoreMapView({ city, onBack }: { city: string; onBack: () => void }) {
  const [stores, setStores] = useState<StoreWithIncome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [neighborhoodFilter, setNeighborhoodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [profileFilter, setProfileFilter] = useState('');
  const [satellite, setSatellite] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [repDraft, setRepDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // O componente é remontado a cada troca de região (key={city} no HomeShell),
  // então não precisa limpar o estado aqui — limpar dentro do efeito só
  // dispararia uma renderização em cascata.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stores?city=${encodeURIComponent(city)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        return res.json() as Promise<StoreWithIncome[]>;
      })
      .then((data) => {
        if (!cancelled) setStores(data);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar as lojas. Recarregue a página.');
      });
    return () => {
      cancelled = true;
    };
  }, [city]);

  const neighborhoods = useMemo(
    () =>
      [
        ...new Set(
          (stores ?? [])
            .map((s) => s.neighborhood)
            .filter((n): n is string => Boolean(n)),
        ),
      ].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [stores],
  );

  const cityIncome = useMemo(() => {
    const withIncome = (stores ?? []).find((s) => s.avgIncome !== null);
    return withIncome?.avgIncome ?? null;
  }, [stores]);

  const filtered = useMemo(() => {
    if (!stores) return [];
    return stores.filter((s) => {
      if (neighborhoodFilter && s.neighborhood !== neighborhoodFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (profileFilter && !s.profiles.includes(profileFilter as StoreProfile)) return false;
      if (kindFilter) {
        if (s.establishmentKind !== kindFilter) return false;
      } else if (s.establishmentKind === 'INDIVIDUAL_RESELLER') {
        // Revendedor individual só aparece quando o filtro pede explicitamente —
        // são muitos (maioria do CNAE de cosméticos) e poluiriam a visão padrão
        // de loja física, que é o prospect de interesse na maior parte do tempo.
        return false;
      }
      return true;
    });
  }, [stores, neighborhoodFilter, statusFilter, profileFilter, kindFilter]);

  const hasFilters = Boolean(neighborhoodFilter || statusFilter || profileFilter || kindFilter);

  const clearFilters = () => {
    setNeighborhoodFilter('');
    setStatusFilter('');
    setProfileFilter('');
    setKindFilter('');
  };

  const selected = selectedId ? (stores ?? []).find((s) => s.id === selectedId) ?? null : null;

  const openStore = (store: StoreWithIncome) => {
    setSelectedId(store.id);
    setNotesDraft(store.notes ?? '');
    setRepDraft(store.visitedByRep ?? '');
    setSaveError(null);
  };

  /** Link confirmado (place_id real) quando existe; senão, busca por texto gerada do endereço. */
  const mapsUrlFor = (store: StoreWithIncome) => store.googleMapsUrl ?? googleMapsSearchUrl(store);

  /**
   * Mensagem pronta pra mandar pro representante que vai visitar a loja.
   * Vai como link de compartilhamento do WhatsApp (wa.me sem número abre a
   * lista de contatos) em vez de área de transferência: copiar falha calado em
   * webview de celular, e o link funciona em qualquer aparelho.
   */
  const shareUrl = (store: StoreWithIncome) => {
    const text = [
      store.name,
      formatFullAddress(store),
      store.addressComplement ? `Complemento: ${store.addressComplement}` : null,
      store.phone ? `Telefone da loja: ${store.phone}` : null,
      mapsUrlFor(store),
    ]
      .filter(Boolean)
      .join('\n');
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const closePanel = () => {
    setSelectedId(null);
    setSaveError(null);
  };

  const patchStore = async (id: string, body: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/stores/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const updated = (await res.json()) as StoreWithIncome;
      if ('notes' in body) setNotesDraft(updated.notes ?? '');
      if ('visitedByRep' in body) setRepDraft(updated.visitedByRep ?? '');
      setStores((prev) =>
        prev
          ? prev.map((s) =>
              s.id === id ? { ...s, ...updated, avgIncome: s.avgIncome, incomeSource: s.incomeSource } : s,
            )
          : prev,
      );
    } catch {
      setSaveError('Não foi possível salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10 sm:px-6">
      {/* Cabeçalho da região */}
      <div className="rise mt-5 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="holo-input rounded-sm px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-dim transition-colors hover:text-gold"
          >
            ← Regiões
          </button>
          <div>
            <p className="hud-label text-glow">Região selecionada</p>
            <h1 className="text-lg font-bold text-ink sm:text-xl">{city}</h1>
          </div>
        </div>
        {cityIncome !== null && (
          <div className="holo-panel rounded-sm px-3 py-1.5">
            <p className="hud-label text-gold-dim">Renda média da região</p>
            <p className="text-sm font-bold text-gold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {brl(cityIncome)}
            </p>
          </div>
        )}
      </div>

      {error ? (
        <div className="holo-panel flex flex-1 items-center justify-center rounded-sm p-8 text-center text-sm text-[#ff8fa0]">
          {error}
        </div>
      ) : !stores ? (
        <div className="flex flex-1 items-center justify-center p-8 font-mono text-[11px] uppercase tracking-wider text-ink-dim">
          Carregando lojas...
        </div>
      ) : (
        <>
          {/* Filtros */}
          <div className="rise mb-3 flex flex-wrap items-end gap-3" style={{ '--d': '90ms' } as React.CSSProperties}>
            <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-gold-dim">
              Bairro
              <select
                className={selectClass}
                value={neighborhoodFilter}
                onChange={(e) => setNeighborhoodFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {neighborhoods.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-gold-dim">
              Status
              <select className={selectClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos</option>
                {(Object.keys(STATUS_LABELS) as ProspectStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-gold-dim">
              Perfil
              <select className={selectClass} value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
                <option value="">Todos</option>
                {PROFILE_VALUES.map((p) => (
                  <option key={p} value={p}>
                    {PROFILE_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-gold-dim">
              Tipo de estabelecimento
              <select className={selectClass} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                <option value="">Todos</option>
                <option value="PHYSICAL_STORE">Só lojas físicas</option>
                <option value="INDIVIDUAL_RESELLER">Só revendedores individuais</option>
              </select>
            </label>

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="pb-1.5 text-sm font-medium text-glow underline-offset-2 hover:underline"
              >
                Limpar filtros
              </button>
            )}

            <div className="ml-auto flex items-center gap-4 pb-1 font-mono text-[10px] uppercase tracking-wider text-ink-dim">
              {[1, 2, 3].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <TierDot tier={t} /> {TIER_LABELS[t]}
                </span>
              ))}
            </div>
          </div>

          {/* Mapa */}
          <div
            className="holo-panel holo-corners rise relative h-[45vh] min-h-[280px] w-full overflow-hidden rounded-sm sm:h-[52vh]"
            style={{ '--d': '160ms' } as React.CSSProperties}
          >
            <StoreMap
              key={city}
              city={city}
              satellite={satellite}
              stores={filtered}
              selectedId={selectedId}
              onSelect={openStore}
            />
            {/* Alternância ruas/satélite — imagem real do lugar (Esri) */}
            <button
              type="button"
              onClick={() => setSatellite((s) => !s)}
              className="holo-input absolute top-3 right-3 z-[900] rounded-sm px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors"
              style={{
                background: 'rgba(11,7,8,0.82)',
                color: satellite ? 'var(--gold)' : 'var(--ink-dim)',
                borderColor: satellite ? 'var(--gold)' : 'var(--panel-border)',
              }}
            >
              {satellite ? '◉ Satélite' : '○ Satélite'}
            </button>
          </div>

          {/* Lista */}
          <div className="rise mt-4 flex-1" style={{ '--d': '230ms' } as React.CSSProperties}>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-dim">
              {filtered.length === 0
                ? stores.length === 0
                  ? 'Nenhuma loja importada nesta região ainda'
                  : 'Nenhuma loja com os filtros atuais'
                : `${filtered.length} loja${filtered.length === 1 ? '' : 's'} encontrada${filtered.length === 1 ? '' : 's'}`}
            </p>

            {/* Tabela (telas largas — a partir de onde 5 colunas cabem sem apertar) */}
            {filtered.length > 0 && (
              <div className="holo-panel hidden overflow-x-auto rounded-sm lg:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b font-mono text-[10px] uppercase tracking-wider text-gold-dim" style={{ borderColor: 'var(--panel-border)' }}>
                      <th className="px-4 py-3 font-medium">Loja</th>
                      <th className="px-4 py-3 font-medium">Bairro</th>
                      <th className="px-4 py-3 font-medium">Renda média</th>
                      <th className="px-4 py-3 font-medium">Distância</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((store, i) => (
                      <tr
                        key={store.id}
                        onClick={() => openStore(store)}
                        className={`rise cursor-pointer border-b transition-colors last:border-0 hover:bg-glow/10 ${
                          store.id === selectedId ? 'bg-glow/10' : ''
                        }`}
                        style={{ borderColor: 'rgba(212,180,131,0.08)', '--d': `${260 + Math.min(i, 10) * 45}ms` } as React.CSSProperties}
                      >
                        <td className="px-4 py-3">
                          <span className="flex flex-wrap items-center gap-2">
                            <TierDot tier={store.tier} />
                            <span className="font-medium text-ink">{store.name}</span>
                            <Badges store={store} />
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-dim">{store.neighborhood ?? '—'}</td>
                        <td className="px-4 py-3 text-ink-dim" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {store.avgIncome !== null ? brl(store.avgIncome) : '—'}
                        </td>
                        <td className="px-4 py-3 text-ink-dim" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {store.distanceKm !== null ? `${store.distanceKm.toLocaleString('pt-BR')} km` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[store.status]}`}>
                            {STATUS_LABELS[store.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Cards (celular e tablet — 1 coluna em telas estreitas, 2 quando sobra espaço) */}
            {filtered.length > 0 && (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">
                {filtered.map((store, i) => (
                  <li key={store.id} className="rise" style={{ '--d': `${260 + Math.min(i, 10) * 45}ms` } as React.CSSProperties}>
                    <button
                      type="button"
                      onClick={() => openStore(store)}
                      className={`holo-panel w-full rounded-sm p-3 text-left transition-transform active:scale-[0.99] ${
                        store.id === selectedId ? 'outline outline-1 outline-glow' : ''
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <TierDot tier={store.tier} />
                        <span className="text-sm font-medium text-ink">{store.name}</span>
                        <Badges store={store} />
                      </span>
                      <span className="mt-1 block text-xs text-ink-dim">
                        {store.neighborhood ? `${store.neighborhood} · ` : ''}
                        {store.distanceKm !== null && `${store.distanceKm.toLocaleString('pt-BR')} km`}
                        {store.avgIncome !== null && ` · renda ${brl(store.avgIncome)}`}
                      </span>
                      <span className={`mt-1.5 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[store.status]}`}>
                        {STATUS_LABELS[store.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Painel de detalhe */}
      {selected && (
        <>
          <div className="backdrop-anim fixed inset-0 z-[1000] bg-black/60 backdrop-blur-[2px]" onClick={closePanel} aria-hidden />
          <div
            className="holo-corners drawer-anim safe-bottom safe-x fixed inset-x-0 bottom-0 z-[1001] max-h-[85vh] overflow-y-auto border-t p-5 sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:max-h-none sm:w-[400px] sm:border-t-0 sm:border-l"
            style={{ background: 'rgba(23,11,13,0.97)', borderColor: 'var(--panel-border)' }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                  <TierDot tier={selected.tier} />
                  {selected.name}
                </h2>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badges store={selected} />
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="rounded-sm p-1 text-ink-dim transition-colors hover:text-gold"
                aria-label="Fechar"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="holo-panel rounded-sm p-3" style={{ background: 'rgba(74,10,23,0.45)' }}>
              <p className="hud-label text-gold-dim">Renda média da região</p>
              <p className="mt-0.5 text-xl font-bold text-gold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {selected.avgIncome !== null ? brl(selected.avgIncome) : 'Sem dado'}
              </p>
              {selected.incomeSource && <p className="mt-1 text-[10px] leading-snug text-ink-dim">{selected.incomeSource}</p>}
            </div>

            <dl className="mt-4 space-y-2.5 text-sm">
              <div>
                <dt className="hud-label text-gold-dim">Endereço</dt>
                <dd className="text-ink">
                  {selected.address ? formatFullAddress(selected) : 'Sem endereço'}
                </dd>
                {selected.addressComplement && (
                  <dd className="text-[12px] text-ink-dim">Complemento: {selected.addressComplement}</dd>
                )}
                {PRECISION_NOTE[selected.geocodePrecision] && (
                  <p className="mt-1 text-[11px] leading-snug text-ink-dim">
                    {PRECISION_NOTE[selected.geocodePrecision]}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  {mapsUrlFor(selected) && (
                    <a
                      href={mapsUrlFor(selected) as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-gold hover:underline"
                      title={selected.googleMapsUrl ? 'Link confirmado' : 'Busca aproximada pelo endereço'}
                    >
                      Abrir no Google Maps →
                    </a>
                  )}
                  <a
                    href={shareUrl(selected)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-gold-dim transition-colors hover:text-gold"
                    title="Abre o WhatsApp com o endereço pronto pra enviar"
                  >
                    Enviar pro representante →
                  </a>
                </div>
              </div>
              <div>
                <dt className="hud-label text-gold-dim">Distância do armazém</dt>
                <dd className="text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {selected.distanceKm !== null ? `${selected.distanceKm.toLocaleString('pt-BR')} km` : '—'}
                </dd>
              </div>
              <div>
                <dt className="hud-label text-gold-dim">Telefone (WhatsApp)</dt>
                <dd>
                  {selected.phone ? (
                    <a
                      href={waLink(selected.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gold hover:underline"
                      title="Abrir conversa no WhatsApp"
                    >
                      {selected.phone}
                    </a>
                  ) : (
                    <span className="text-ink">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="hud-label text-gold-dim">CNPJ</dt>
                <dd className="font-mono text-[13px] text-ink">
                  {selected.cnpj ? formatCnpj(selected.cnpj) : 'Não confirmado ainda'}
                </dd>
              </div>
            </dl>

            <hr className="my-4" style={{ borderColor: 'var(--panel-border)' }} />

            <div className="space-y-4">
              <label className="block">
                <span className="hud-label mb-1.5 block text-gold-dim">Status de prospecção</span>
                <select
                  className={`${selectClass} w-full`}
                  value={selected.status}
                  disabled={saving}
                  onChange={(e) => patchStore(selected.id, { status: e.target.value })}
                >
                  {(Object.keys(STATUS_LABELS) as ProspectStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="hud-label mb-1.5 block text-gold-dim">Representante que visitou</span>
                <input
                  type="text"
                  className={`${selectClass} w-full`}
                  value={repDraft}
                  disabled={saving}
                  onChange={(e) => setRepDraft(e.target.value)}
                  placeholder="Nome do representante"
                />
              </label>
              {repDraft !== (selected.visitedByRep ?? '') && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => patchStore(selected.id, { visitedByRep: repDraft })}
                  className="w-full rounded-sm bg-red-mid px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-red-deep disabled:opacity-50"
                  style={{ boxShadow: '0 0 12px rgba(221,60,86,0.3)' }}
                >
                  {saving ? 'Salvando...' : 'Salvar representante'}
                </button>
              )}

              <div>
                <span className="hud-label mb-1.5 block text-gold-dim">Tipo de loja</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['MULTIBRAND', 'Multimarca'],
                      ['OWN_BRAND', '★ Marca própria'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={saving}
                      onClick={() => selected.storeType !== value && patchStore(selected.id, { storeType: value })}
                      className={`rounded-sm border px-2 py-1.5 text-sm font-medium transition-colors ${
                        selected.storeType === value
                          ? 'border-glow bg-red-mid text-ink'
                          : 'holo-input text-ink-dim hover:text-ink'
                      }`}
                      style={selected.storeType === value ? { boxShadow: '0 0 10px rgba(221,60,86,0.35)' } : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selected.storeTypeAuto && (
                  <p className="mt-1 text-[11px] text-ink-dim">classificação automática — toque pra corrigir</p>
                )}
              </div>

              <div>
                <span className="hud-label mb-1.5 block text-gold-dim">Tipo de estabelecimento</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['PHYSICAL_STORE', 'Loja física'],
                      ['INDIVIDUAL_RESELLER', 'Revendedor individual'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        selected.establishmentKind !== value && patchStore(selected.id, { establishmentKind: value })
                      }
                      className={`rounded-sm border px-2 py-1.5 text-sm font-medium transition-colors ${
                        selected.establishmentKind === value
                          ? 'border-glow bg-red-mid text-ink'
                          : 'holo-input text-ink-dim hover:text-ink'
                      }`}
                      style={selected.establishmentKind === value ? { boxShadow: '0 0 10px rgba(221,60,86,0.35)' } : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selected.establishmentKindAuto && (
                  <p className="mt-1 text-[11px] text-ink-dim">classificação automática — toque pra corrigir</p>
                )}
              </div>

              <div>
                <span className="hud-label mb-1.5 block text-gold-dim">Perfil da loja</span>
                <p className="mb-1.5 text-[11px] leading-snug text-ink-dim">
                  Como abordar comercialmente — pode marcar mais de um.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PROFILE_VALUES.map((value) => {
                    const active = selected.profiles.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          const next = active
                            ? selected.profiles.filter((p) => p !== value)
                            : [...selected.profiles, value];
                          patchStore(selected.id, { profiles: next });
                        }}
                        className={`rounded-sm border px-2 py-1.5 text-sm font-medium transition-colors ${
                          active ? 'border-glow bg-red-mid text-ink' : 'holo-input text-ink-dim hover:text-ink'
                        }`}
                        style={active ? { boxShadow: '0 0 10px rgba(221,60,86,0.35)' } : undefined}
                      >
                        {PROFILE_LABELS[value]}
                      </button>
                    );
                  })}
                </div>
                {selected.profilesAuto && (
                  <p className="mt-1 text-[11px] text-ink-dim">classificação automática — toque pra corrigir</p>
                )}
              </div>

              <label className="block">
                <span className="hud-label mb-1.5 block text-gold-dim">Observações</span>
                <textarea
                  className={`${selectClass} min-h-[80px] w-full`}
                  value={notesDraft}
                  disabled={saving}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Anotações da visita, contato, etc."
                />
              </label>
              {notesDraft !== (selected.notes ?? '') && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => patchStore(selected.id, { notes: notesDraft })}
                  className="w-full rounded-sm bg-red-mid px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-red-deep disabled:opacity-50"
                  style={{ boxShadow: '0 0 12px rgba(221,60,86,0.3)' }}
                >
                  {saving ? 'Salvando...' : 'Salvar observações'}
                </button>
              )}

              {saveError && <p className="text-sm text-[#ff8fa0]">{saveError}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
