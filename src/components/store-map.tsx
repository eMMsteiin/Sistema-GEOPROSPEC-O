'use client';

// Mapa Leaflet — carregado só no cliente (dynamic import com ssr: false no
// store-map-view, já que o Leaflet acessa `window`). Os tiles OSM recebem o
// tratamento escuro via CSS (classe .holo-map em globals.css) e tudo fora do
// contorno municipal da cidade selecionada é coberto por uma máscara — abrir
// Colombo mostra só Colombo, não a região inteira.

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { WAREHOUSE } from '@/lib/pdv';
import { CITY_GEO_RING } from '@/lib/city-shapes';
import type { StoreWithIncome } from './store-map-view';

// Paleta holográfica: tier 1 = brilho vermelho, tier 2 = dourado, tier 3 = dourado apagado.
const TIER_COLORS: Record<number, string> = {
  1: '#dd3c56',
  2: '#d4b483',
  3: '#8a7355',
};

// Anel externo da máscara — retângulo bem maior que a região; o contorno da
// cidade vira o "furo" (Leaflet trata anéis extras de um Polygon como furos).
const MASK_OUTER: [number, number][] = [
  [-85, -180],
  [-85, 180],
  [85, 180],
  [85, -180],
];

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

/**
 * Entrada cinematográfica: começa com a região metropolitana inteira e "voa"
 * pra dentro do contorno da cidade; só depois trava pan/zoom nos limites dela.
 * Com prefers-reduced-motion, enquadra direto sem voo.
 */
function FitCity({ ring }: { ring: [number, number][] | null }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;

    if (!ring || ring.length < 3) {
      map.fitBounds(L.latLngBounds([[WAREHOUSE.lat, WAREHOUSE.lng]]), { maxZoom: 12 });
      return;
    }

    const bounds = L.latLngBounds(ring);
    const clamp = () => {
      map.setMaxBounds(bounds.pad(0.25));
      map.setMinZoom(map.getBoundsZoom(bounds.pad(0.25)));
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      map.fitBounds(bounds, { padding: [24, 24] });
      clamp();
      return;
    }

    map.setView(bounds.getCenter(), Math.max(map.getBoundsZoom(bounds) - 2, 8), { animate: false });
    map.once('moveend', clamp);
    map.flyToBounds(bounds, { padding: [24, 24], duration: 1.3, easeLinearity: 0.22 });
  }, [ring, map]);

  return null;
}

// Imagem de satélite (Esri World Imagery) — alternativa gratuita com
// atribuição; o Google Maps não permite uso dos tiles sem a API paga.
const SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTRIBUTION =
  'Imagens &copy; <a href="https://www.esri.com">Esri</a> — Source: Esri, Maxar, Earthstar Geographics';

interface StoreMapProps {
  city: string;
  satellite: boolean;
  stores: StoreWithIncome[];
  selectedId: string | null;
  onSelect: (store: StoreWithIncome) => void;
}

export default function StoreMap({ city, satellite, stores, selectedId, onSelect }: StoreMapProps) {
  const ring = CITY_GEO_RING[city] ?? null;

  return (
    <MapContainer
      center={[WAREHOUSE.lat, WAREHOUSE.lng]}
      zoom={11}
      scrollWheelZoom
      className={`h-full w-full ${satellite ? 'holo-map holo-map--sat' : 'holo-map'}`}
    >
      {satellite ? (
        <TileLayer key="sat" attribution={SAT_ATTRIBUTION} url={SAT_URL} />
      ) : (
        <TileLayer
          key="osm"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}
      <FitCity ring={ring} />

      {/* Máscara: cobre tudo fora do município (o anel da cidade é o furo). */}
      {ring && (
        <>
          <Polygon
            positions={[MASK_OUTER, ring]}
            pathOptions={{ fillColor: '#0b0708', fillOpacity: 0.94, stroke: false }}
            interactive={false}
          />
          {/* Halo + traço do limite municipal */}
          <Polygon
            positions={ring}
            pathOptions={{ fill: false, color: '#d4b483', weight: 6, opacity: 0.12 }}
            interactive={false}
          />
          <Polygon
            positions={ring}
            pathOptions={{ fill: false, color: '#d4b483', weight: 1.5, opacity: 0.7 }}
            interactive={false}
          />
        </>
      )}

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
