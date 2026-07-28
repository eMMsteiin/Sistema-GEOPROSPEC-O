'use client';

// Mapa Leaflet — carregado só no cliente (dynamic import com ssr: false no
// store-map-view, já que o Leaflet acessa `window`). Os tiles OSM recebem o
// tratamento escuro via CSS (classe .holo-map em globals.css).

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { WAREHOUSE } from '@/lib/pdv';
import type { StoreWithIncome } from './store-map-view';

// Paleta holográfica: tier 1 = brilho vermelho, tier 2 = dourado, tier 3 = dourado apagado.
const TIER_COLORS: Record<number, string> = {
  1: '#dd3c56',
  2: '#d4b483',
  3: '#8a7355',
};

function pinIcon(store: StoreWithIncome, selected: boolean): L.DivIcon {
  const color = TIER_COLORS[store.tier] ?? TIER_COLORS[3];
  const dimmed = store.establishmentKind === 'INDIVIDUAL_RESELLER' && !selected;
  const starBadge =
    store.storeType === 'OWN_BRAND'
      ? `<g transform="translate(20,2)">
           <circle cx="7" cy="7" r="7" fill="#7c3aed" stroke="#f3e8db" stroke-width="1.2"/>
           <path d="M7 2.8l1.2 2.5 2.7.4-2 1.9.5 2.7L7 9l-2.4 1.3.5-2.7-2-1.9 2.7-.4z" fill="#f3e8db"/>
         </g>`
      : '';
  const ring = selected
    ? `<circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.5"/>`
    : '';
  const glow = selected || store.tier === 1 ? 0.55 : 0.3;
  const html = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"
         style="opacity:${dimmed ? 0.5 : 1};filter:drop-shadow(0 0 6px ${color}${Math.round(glow * 255).toString(16).padStart(2, '0')})">
      ${ring}
      <path d="M16 2C8.8 2 3 7.8 3 15c0 9.6 13 27 13 27s13-17.4 13-27C29 7.8 23.2 2 16 2z"
            fill="${color}" stroke="#0b0708" stroke-width="1.6"/>
      <circle cx="16" cy="15" r="5" fill="#0b0708"/>
      <circle cx="16" cy="15" r="2.4" fill="${color}"/>
      ${starBadge}
    </svg>`;
  return L.divIcon({
    className: '',
    html,
    iconSize: [36, 44],
    iconAnchor: [16, 44],
  });
}

const warehouseIcon = L.divIcon({
  className: '',
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"
         style="filter:drop-shadow(0 0 8px rgba(212,180,131,0.7))">
      <circle cx="15" cy="15" r="12" fill="#d4b483" stroke="#0b0708" stroke-width="2"/>
      <path d="M9 16.5l6-5 6 5V21H9z" fill="#0b0708"/>
    </svg>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/** Enquadra todas as lojas + o armazém, só no primeiro carregamento. */
function FitBoundsOnce({ stores }: { stores: StoreWithIncome[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    const points: [number, number][] = stores
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => [s.lat as number, s.lng as number]);
    points.push([WAREHOUSE.lat, WAREHOUSE.lng]);
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
    fitted.current = true;
  }, [stores, map]);

  return null;
}

interface StoreMapProps {
  stores: StoreWithIncome[];
  selectedId: string | null;
  onSelect: (store: StoreWithIncome) => void;
}

export default function StoreMap({ stores, selectedId, onSelect }: StoreMapProps) {
  return (
    <MapContainer
      center={[WAREHOUSE.lat, WAREHOUSE.lng]}
      zoom={11}
      scrollWheelZoom
      className="holo-map h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBoundsOnce stores={stores} />
      <Marker
        position={[WAREHOUSE.lat, WAREHOUSE.lng]}
        icon={warehouseIcon}
        title="Armazém (Borda do Campo, São José dos Pinhais)"
        zIndexOffset={500}
      />
      {stores
        .filter((s) => s.lat != null && s.lng != null)
        .map((store) => (
          <Marker
            key={store.id}
            position={[store.lat as number, store.lng as number]}
            icon={pinIcon(store, store.id === selectedId)}
            zIndexOffset={store.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(store) }}
          />
        ))}
    </MapContainer>
  );
}
