'use client';

// Tela inicial: as 5 cidades cobertas desenhadas com o contorno municipal real
// (IBGE), estilo holográfico. Na entrada, os contornos se desenham em cascata
// sob uma varredura de radar; hover pinta e eleva a região; o clique dá um
// zoom animado pra dentro do contorno antes de abrir o mapa de lojas.

import { useRef, useState } from 'react';
import { CITY_SHAPES, CITY_SHAPES_VIEWBOX, WAREHOUSE_PROJECTED } from '@/lib/city-shapes';

const HINT_BY_CITY: Record<string, string> = {
  'São José dos Pinhais': 'Sede do armazém →',
};

/** Duração do zoom de seleção — mantém em sincronia com a transition inline. */
const ZOOM_MS = 650;

export default function CitySelector({ onSelect }: { onSelect: (city: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoomTarget, setZoomTarget] = useState<string | null>(null);
  const [stageTransform, setStageTransform] = useState<string | undefined>(undefined);
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const firedRef = useRef(false);

  function selectWithZoom(city: string) {
    if (firedRef.current) return;
    const path = pathRefs.current[city];
    if (!path || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      firedRef.current = true;
      onSelect(city);
      return;
    }
    firedRef.current = true;
    const b = path.getBBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const { width: VW, height: VH } = CITY_SHAPES_VIEWBOX;
    const scale = Math.min(3.4, Math.min(VW / b.width, VH / b.height) * 0.82);
    setZoomTarget(city);
    setStageTransform(`translate(${VW / 2}px, ${VH / 2}px) scale(${scale}) translate(${-cx}px, ${-cy}px)`);
    window.setTimeout(() => onSelect(city), ZOOM_MS);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-10">
      <div className="rise mt-6 mb-4 flex flex-wrap items-end justify-between gap-3">
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

      <div className="holo-panel holo-corners rise relative overflow-hidden rounded-sm" style={{ '--d': '120ms' } as React.CSSProperties}>
        <div className="radar-sweep" aria-hidden />
        <svg
          viewBox={`0 0 ${CITY_SHAPES_VIEWBOX.width} ${CITY_SHAPES_VIEWBOX.height}`}
          role="img"
          aria-label="Mapa das cinco cidades cobertas: Curitiba, São José dos Pinhais, Piraquara, Colombo e Pinhais"
          className="relative block w-full"
        >
          <defs>
            <pattern id="holo-grid" width="36" height="36" patternUnits="userSpaceOnUse">
              <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(212,180,131,0.05)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={CITY_SHAPES_VIEWBOX.width} height={CITY_SHAPES_VIEWBOX.height} fill="url(#holo-grid)" />

          {/* Palco com todas as regiões — o zoom da seleção anima este grupo. */}
          <g
            style={{
              transform: stageTransform,
              transition: `transform ${ZOOM_MS}ms cubic-bezier(0.3, 0.6, 0.2, 1)`,
              transformOrigin: '0 0',
            }}
          >
            {CITY_SHAPES.map((shape, i) => {
              const active = hovered === shape.name && !zoomTarget;
              const isZoomTarget = zoomTarget === shape.name;
              const fadedOut = Boolean(zoomTarget) && !isZoomTarget;
              return (
                <g
                  key={shape.name}
                  tabIndex={zoomTarget ? -1 : 0}
                  role="button"
                  aria-label={`Abrir lojas de ${shape.name}`}
                  className="cursor-pointer focus:outline-none"
                  style={{ opacity: fadedOut ? 0 : 1, transition: 'opacity 0.3s ease' }}
                  onMouseEnter={() => setHovered(shape.name)}
                  onMouseLeave={() => setHovered((h) => (h === shape.name ? null : h))}
                  onFocus={() => setHovered(shape.name)}
                  onBlur={() => setHovered((h) => (h === shape.name ? null : h))}
                  onClick={() => selectWithZoom(shape.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectWithZoom(shape.name);
                    }
                  }}
                >
                  <path
                    ref={(el) => {
                      pathRefs.current[shape.name] = el;
                    }}
                    d={shape.d}
                    className="shape-draw"
                    fill={active || isZoomTarget ? 'rgba(221,60,86,0.26)' : 'rgba(212,180,131,0.055)'}
                    stroke={active || isZoomTarget ? 'var(--glow)' : 'var(--gold-dim)'}
                    strokeWidth={active || isZoomTarget ? 1.8 : 1.1}
                    style={{
                      '--d': `${i * 140}ms`,
                      transition:
                        'fill .35s ease, stroke .35s ease, filter .35s ease, transform .35s cubic-bezier(.2,.8,.2,1)',
                      transformBox: 'fill-box',
                      transformOrigin: '50% 50%',
                      transform: active ? 'translateY(-7px) scale(1.015)' : undefined,
                      filter: active
                        ? 'drop-shadow(0 0 16px rgba(221,60,86,0.55)) drop-shadow(0 14px 22px rgba(0,0,0,0.5))'
                        : isZoomTarget
                          ? 'drop-shadow(0 0 22px rgba(221,60,86,0.6))'
                          : undefined,
                    } as React.CSSProperties}
                  />
                  <text
                    x={shape.labelX}
                    y={shape.labelY}
                    textAnchor="middle"
                    className="pointer-events-none select-none font-mono uppercase"
                    style={{
                      fontSize: 12.5,
                      letterSpacing: '0.06em',
                      fill: active || isZoomTarget ? 'var(--ink)' : 'var(--ink-dim)',
                      opacity: isZoomTarget ? 0 : active ? 1 : 0.75,
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
            <g
              transform={`translate(${WAREHOUSE_PROJECTED.x}, ${WAREHOUSE_PROJECTED.y})`}
              className="pointer-events-none"
              style={{ opacity: zoomTarget ? 0 : 1, transition: 'opacity 0.3s ease' }}
            >
              <circle r="7" fill="none" stroke="var(--gold)" strokeWidth="1" opacity="0.6">
                <animate attributeName="r" values="5;16" dur="2.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.65;0" dur="2.6s" repeatCount="indefinite" />
              </circle>
              <circle r="4" fill="var(--gold)" />
            </g>
          </g>
        </svg>

        <div
          className="relative flex min-h-[46px] items-center justify-between gap-4 border-t px-4 py-2.5 font-mono text-[11px] text-ink-dim"
          style={{ borderColor: 'var(--panel-border)', background: 'rgba(11,7,8,0.55)' }}
        >
          <span>
            <span className="mr-2 text-glow">›</span>
            {zoomTarget
              ? `abrindo ${zoomTarget}...`
              : hovered
                ? `${hovered} — toque pra abrir o mapa de lojas`
                : 'aguardando seleção — passe o mouse sobre uma região'}
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
