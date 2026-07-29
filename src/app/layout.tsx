import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mapa de PDVs — Vitiss",
  description:
    "Prospecção de lojas de cosméticos na região metropolitana de Curitiba",
  // Faz o site se comportar como app instalado (sem barra do Safari) quando
  // adicionado à Tela de Início no iOS — usa o ícone gerado em apple-icon.png.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mapa de PDVs",
  },
};

export const viewport: Viewport = {
  themeColor: "#4a0a17",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
