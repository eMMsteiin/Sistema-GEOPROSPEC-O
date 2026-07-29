import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — é isso que faz o navegador oferecer "Adicionar à Tela
 * de Início" / "Instalar app" com o ícone certo, em tela cheia, como um app
 * nativo, sem passar por App Store/Play Store.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mapa de PDVs — Vitiss',
    short_name: 'Mapa de PDVs',
    description: 'Geoprospecção de lojas de cosméticos na região metropolitana de Curitiba',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0708',
    theme_color: '#4a0a17',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
