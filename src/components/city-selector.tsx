'use client';

// Tela inicial: as 5 cidades cobertas desenhadas com o contorno municipal real
// (IBGE), estilo holográfico. Hover pinta e eleva a região; clique abre o mapa
// de lojas daquela cidade. Sem mapa-múndi — só o que a operação cobre.

import { useState } from 'react';
import { CITY_SHAPES, CITY_SHAPES_VIEWBOX, WAREHOUSE_PROJECTED } from '@/lib/city-shapes';

const HINT_BY_CITY: Record<string, string> = {
  'São José dos Pinhais': 'Sede do armazém →',
};

export default function CitySelector({ onSelect }: { onSelect: (city: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-10">
      <div className="mt-6 mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hud-label mb-1.5 text-glow">Seleção de região</p>
          <h1 className="text-xl font-bold text-ink sm:text-2xl" style={{ textWrap: 'balance' }}>
            Escolha uma cidade pra abrir o mapa de lojas
          </h1>
        </div>
        <p className="max-w-[44ch] text-[13px] leading-relaxed text-ink-dim">
          Contorno real dos 5 municípios cobertos (IBGE). Passe o mouse pra
          pré-visualizar, toque pra abrir as lojas da região.
        </p>
      </div>

      <div className="holo-panel holo-corners relative overflow-hidden rounded-sm">
        <svg
          viewBox={`0 0 ${CITY_SHAPES_VIEWBOX.width} ${CITY_SHAPES_VIEWBOX.height}`}
          role="img"
          aria-label="Mapa das cinco cidades cobertas: Curitiba, São José dos Pinhais, Piraquara, Colombo e Pinhais"
          className="block w-full"
        >
          <defs>
            <pattern id="holo-grid" width="36" height="36" patternUnits="userSpaceOnUse">
              <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(212,180,131,0.05)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={CITY_SHAPES_VIEWBOX.width} height={CITY_SHAPES_VIEWBOX.height} fill="url(#holo-grid)" />

          {CITY_SHAPES.map((shape) => {
            const active = hovered === shape.name;
            return (
              <g
                key={shape.name}
                tabIndex={0}
                role="button"
                aria-label={`Abrir lojas de ${shape.name}`}
                className="cursor-pointer focus:outline-none"
                onMouseEnter={() => setHovered(shape.name)}
                onMouseLeave={() => setHovered((h) => (h === shape.name ? null : h))}
                onFocus={() => setHovered(shape.name)}
                onBlur={() => setHovered((h) => (h === shape.name ? null : h))}
                onClick={() => onSelect(shape.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(shape.name);
                  }
                }}
              >
                <path
                  d={shape.d}
                  fill={active ? 'rgba(221,60,86,0.26)' : 'rgba(212,180,131,0.055)'}
                  stroke={active ? 'var(--glow)' : 'var(--gold-dim)'}
                  strokeWidth={active ? 1.8 : 1.1}
                  style={{
                    transition: 'fill .35s ease, stroke .35s ease, filter .35s ease, transform .35s cubic-bezier(.2,.8,.2,1)',
                    transformBox: 'fill-box',
                    transformOrigin: '50% 50%',
                    transform: active ? 'translateY(-7px) scale(1.015)' : undefined,
                    filter: active
                      ? 'drop-shadow(0 0 16px rgba(221,60,86,0.55)) drop-shadow(0 14px 22px rgba(0,0,0,0.5))'
                      : undefined,
                  }}
                />
                <text
                  x={shape.labelX}
                  y={shape.labelY}
                  textAnchor="middle"
                  className="pointer-events-none select-none font-mono uppercase"
                  style={{
                    fontSize: 12.5,
                    letterSpacing: '0.06em',
                    fill: active ? 'var(--ink)' : 'var(--ink-dim)',
                    opacity: active ? 1 : 0.75,
                    transition: 'fill .3s ease, opacity .3s ease',
                  }}
                >
                  {shape.name}
                </text>
                <text
                  x={shape.labelX}
                  y={shape.labelY + 17}
                  textAnchor="middle"
                  className="pointer-events-none select-none font-mono uppercase"
                  style={{
                    fontSize: 9.5,
                    letterSpacing: '0.08em',
                    fill: 'var(--glow)',
                    opacity: active ? 1 : 0,
                    transition: 'opacity .3s ease',
                  }}
                >
                  {HINT_BY_CITY[shape.name] ?? 'Ver lojas mapeadas →'}
                </text>
              </g>
            );
          })}

          {/* Armazém — farol fixo de referência */}
          <g transform={`translate(${WAREHOUSE_PROJECTED.x}, ${WAREHOUSE_PROJECTED.y})`} className="pointer-events-none">
            <circle
              r="7"
              fill="none"
              stroke="var(--gold)"
              strokeWidth="1"
              opacity="0.6"
              style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
            >
              <animate attributeName="r" values="5;16" dur="2.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.65;0" dur="2.6s" repeatCount="indefinite" />
            </circle>
            <circle r="4" fill="var(--gold)" />
          </g>
        </svg>

        <div className="flex min-h-[46px] items-center justify-between gap-4 border-t px-4 py-2.5 font-mono text-[11px] text-ink-dim" style={{ borderColor: 'var(--panel-border)' }}>
          <span>
            <span className="mr-2 text-glow">›</span>
            {hovered ? `${hovered} — toque pra abrir o mapa de lojas` : 'aguardando seleção — passe o mouse sobre uma região'}
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="inline-block h-2 w-2 rounded-full bg-gold" />
            <span className="uppercase tracking-wider" style={{ fontSize: 9.5 }}>Armazém</span>
          </span>
        </div>
      </div>
    </div>
  );
}
