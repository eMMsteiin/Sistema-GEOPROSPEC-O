'use client';

// Fluxo da tela única do app: seletor de região (contornos reais) → mapa de
// lojas da cidade escolhida. O estado de navegação vive aqui.

import { useState } from 'react';
import CitySelector from '@/components/city-selector';
import StoreMapView from '@/components/store-map-view';
import LogoutButton from '@/components/logout-button';

export default function HomeShell({ userName }: { userName: string }) {
  const [city, setCity] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen flex-col">
      <header
        className="safe-top flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6"
        style={{ borderColor: 'var(--panel-border)', background: 'rgba(11,7,8,0.55)' }}
      >
        <div className="min-w-0">
          <p className="hud-label text-gold">Sistema de Geoprospecção</p>
          <p className="truncate text-[15px] font-bold text-ink">Vitiss Cosméticos — Melhorança</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden font-mono text-[11px] uppercase tracking-wider text-ink-dim sm:inline">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-glow align-middle holo-pulse" />
            {userName}
          </span>
          <LogoutButton />
        </div>
      </header>

      {city === null ? (
        <CitySelector onSelect={setCity} />
      ) : (
        <StoreMapView key={city} city={city} onBack={() => setCity(null)} />
      )}
    </div>
  );
}
