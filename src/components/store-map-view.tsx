'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { EstablishmentKind, ProspectStatus, StoreType } from '@prisma/client';

const StoreMap = dynamic(() => import('./store-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-500">
      Carregando mapa...
    </div>
  ),
});

export interface StoreWithIncome {
  id: string;
  cnpj: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  storeType: StoreType;
  storeTypeAuto: boolean;
  establishmentKind: EstablishmentKind;
  establishmentKindAuto: boolean;
  status: ProspectStatus;
  phone: string | null;
  notes: string | null;
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
};

const STATUS_BADGE: Record<ProspectStatus, string> = {
  NOT_VISITED: 'bg-gray-100 text-gray-700',
  VISITED: 'bg-blue-100 text-blue-800',
  PARTNER: 'bg-green-100 text-green-800',
  DECLINED: 'bg-red-100 text-red-800',
};

const TIER_DOT: Record<number, string> = {
  1: 'bg-green-600',
  2: 'bg-amber-600',
  3: 'bg-gray-500',
};

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatCnpj = (c: string) =>
  c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;

function TierDot({ tier }: { tier: number }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TIER_DOT[tier] ?? TIER_DOT[3]}`} />;
}

function Badges({ store }: { store: StoreWithIncome }) {
  return (
    <>
      {store.storeType === 'OWN_BRAND' && (
        <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">
          Marca própria
        </span>
      )}
      {store.establishmentKind === 'INDIVIDUAL_RESELLER' && (
        <span className="inline-block rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800">
          Revendedor individual
        </span>
      )}
      {!store.cnaeActive && (
        <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
          Baixada na Receita
        </span>
      )}
    </>
  );
}

export default function StoreMapView() {
  const [stores, setStores] = useState<StoreWithIncome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cityFilter, setCityFilter] = useState('');
  const [neighborhoodFilter, setNeighborhoodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [minIncome, setMinIncome] = useState('');
  const [maxIncome, setMaxIncome] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stores')
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
  }, []);

  const cities = useMemo(
    () => [...new Set((stores ?? []).map((s) => s.city))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [stores],
  );

  const neighborhoods = useMemo(
    () =>
      [
        ...new Set(
          (stores ?? [])
            .filter((s) => !cityFilter || s.city === cityFilter)
            .map((s) => s.neighborhood)
            .filter((n): n is string => Boolean(n)),
        ),
      ].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [stores, cityFilter],
  );

  const filtered = useMemo(() => {
    if (!stores) return [];
    const min = minIncome ? Number.parseFloat(minIncome) : null;
    const max = maxIncome ? Number.parseFloat(maxIncome) : null;
    return stores.filter((s) => {
      if (cityFilter && s.city !== cityFilter) return false;
      if (neighborhoodFilter && s.neighborhood !== neighborhoodFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (kindFilter && s.establishmentKind !== kindFilter) return false;
      if (min !== null && Number.isFinite(min) && (s.avgIncome === null || s.avgIncome < min)) return false;
      if (max !== null && Number.isFinite(max) && (s.avgIncome === null || s.avgIncome > max)) return false;
      return true;
    });
  }, [stores, cityFilter, neighborhoodFilter, statusFilter, kindFilter, minIncome, maxIncome]);

  const hasFilters =
    Boolean(cityFilter || neighborhoodFilter || statusFilter || kindFilter || minIncome || maxIncome);

  const clearFilters = () => {
    setCityFilter('');
    setNeighborhoodFilter('');
    setStatusFilter('');
    setKindFilter('');
    setMinIncome('');
    setMaxIncome('');
  };

  const selected = selectedId ? (stores ?? []).find((s) => s.id === selectedId) ?? null : null;

  const openStore = (store: StoreWithIncome) => {
    setSelectedId(store.id);
    setNotesDraft(store.notes ?? '');
    setSaveError(null);
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

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-red-600">{error}</div>
    );
  }

  if (!stores) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-500">Carregando lojas...</div>
    );
  }

  const selectClass =
    'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none';

  return (
    <div className="flex flex-1 flex-col">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Cidade
          <select
            className={selectClass}
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value);
              setNeighborhoodFilter('');
            }}
          >
            <option value="">Todas</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
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

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
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

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Tipo de estabelecimento
          <select className={selectClass} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="PHYSICAL_STORE">Só lojas físicas</option>
            <option value="INDIVIDUAL_RESELLER">Só revendedores individuais</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Renda mín. (R$)
          <input
            type="number"
            inputMode="numeric"
            className={`${selectClass} w-28`}
            value={minIncome}
            onChange={(e) => setMinIncome(e.target.value)}
            placeholder="0"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Renda máx. (R$)
          <input
            type="number"
            inputMode="numeric"
            className={`${selectClass} w-28`}
            value={maxIncome}
            onChange={(e) => setMaxIncome(e.target.value)}
            placeholder="—"
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="pb-1.5 text-sm font-medium text-blue-600 underline-offset-2 hover:underline"
          >
            Limpar filtros
          </button>
        )}

        <div className="ml-auto flex items-center gap-4 pb-1 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-green-600" /> Prioridade alta
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-600" /> Prioridade média
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gray-500" /> Prioridade baixa
          </span>
        </div>
      </div>

      {/* Mapa */}
      <div className="h-[45vh] min-h-[280px] w-full sm:h-[55vh]">
        <StoreMap stores={filtered} selectedId={selectedId} onSelect={openStore} />
      </div>

      {/* Lista */}
      <div className="flex-1 bg-gray-50 px-4 py-4">
        <p className="mb-3 text-sm text-gray-600">
          {filtered.length === 0
            ? 'Nenhuma loja encontrada com os filtros atuais.'
            : `${filtered.length} loja${filtered.length === 1 ? '' : 's'} encontrada${filtered.length === 1 ? '' : 's'}`}
        </p>

        {/* Tabela (desktop) */}
        {filtered.length > 0 && (
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Loja</th>
                  <th className="px-4 py-3">Bairro / Cidade</th>
                  <th className="px-4 py-3">Renda média</th>
                  <th className="px-4 py-3">Distância</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((store) => (
                  <tr
                    key={store.id}
                    onClick={() => openStore(store)}
                    className={`cursor-pointer border-b border-gray-100 last:border-0 hover:bg-blue-50 ${
                      store.id === selectedId ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <TierDot tier={store.tier} />
                        <span className="font-medium text-gray-900">{store.name}</span>
                        <Badges store={store} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {store.neighborhood ? `${store.neighborhood}, ` : ''}
                      {store.city}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {store.avgIncome !== null ? brl(store.avgIncome) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {store.distanceKm !== null ? `${store.distanceKm.toLocaleString('pt-BR')} km` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[store.status]}`}>
                        {STATUS_LABELS[store.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cards (mobile) */}
        {filtered.length > 0 && (
          <ul className="space-y-2 md:hidden">
            {filtered.map((store) => (
              <li key={store.id}>
                <button
                  type="button"
                  onClick={() => openStore(store)}
                  className={`w-full rounded-lg border border-gray-200 bg-white p-3 text-left ${
                    store.id === selectedId ? 'ring-2 ring-blue-400' : ''
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <TierDot tier={store.tier} />
                    <span className="font-medium text-gray-900">{store.name}</span>
                    <Badges store={store} />
                  </span>
                  <span className="mt-1 block text-xs text-gray-600">
                    {store.neighborhood ? `${store.neighborhood}, ` : ''}
                    {store.city}
                    {store.distanceKm !== null && ` · ${store.distanceKm.toLocaleString('pt-BR')} km`}
                    {store.avgIncome !== null && ` · renda ${brl(store.avgIncome)}`}
                  </span>
                  <span
                    className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[store.status]}`}
                  >
                    {STATUS_LABELS[store.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Painel de detalhe */}
      {selected && (
        <>
          <div className="fixed inset-0 z-[1000] bg-black/30" onClick={closePanel} aria-hidden />
          <div className="fixed inset-x-0 bottom-0 z-[1001] max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:max-h-none sm:w-[400px] sm:rounded-none">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <TierDot tier={selected.tier} />
                  {selected.name}
                </h2>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badges store={selected} />
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Fechar"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-xs font-medium uppercase text-blue-700">Renda média da região</p>
              <p className="text-xl font-bold text-blue-900">
                {selected.avgIncome !== null ? brl(selected.avgIncome) : 'Sem dado'}
              </p>
              {selected.incomeSource && <p className="mt-1 text-[11px] text-blue-700">{selected.incomeSource}</p>}
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Endereço</dt>
                <dd className="text-gray-900">
                  {selected.address ?? 'Sem endereço'}
                  {selected.neighborhood ? ` — ${selected.neighborhood}` : ''}, {selected.city}/{selected.state}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Distância do armazém</dt>
                <dd className="text-gray-900">
                  {selected.distanceKm !== null ? `${selected.distanceKm.toLocaleString('pt-BR')} km` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">Telefone</dt>
                <dd className="text-gray-900">
                  {selected.phone ? (
                    <a href={`tel:${selected.phone.replace(/\D/g, '')}`} className="text-blue-600 hover:underline">
                      {selected.phone}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">CNPJ</dt>
                <dd className="text-gray-900">{formatCnpj(selected.cnpj)}</dd>
              </div>
            </dl>

            <hr className="my-4 border-gray-200" />

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Status de prospecção</span>
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

              <div>
                <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Tipo de loja</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['MULTIBRAND', 'Multimarca'],
                      ['OWN_BRAND', 'Marca própria'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        selected.storeType !== value && patchStore(selected.id, { storeType: value })
                      }
                      className={`rounded-md border px-2 py-1.5 text-sm font-medium ${
                        selected.storeType === value
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selected.storeTypeAuto && (
                  <p className="mt-1 text-[11px] text-gray-500">classificação automática — toque pra corrigir</p>
                )}
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
                  Tipo de estabelecimento
                </span>
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
                        selected.establishmentKind !== value &&
                        patchStore(selected.id, { establishmentKind: value })
                      }
                      className={`rounded-md border px-2 py-1.5 text-sm font-medium ${
                        selected.establishmentKind === value
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selected.establishmentKindAuto && (
                  <p className="mt-1 text-[11px] text-gray-500">classificação automática — toque pra corrigir</p>
                )}
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase text-gray-500">Observações</span>
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
                  className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar observações'}
                </button>
              )}

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
