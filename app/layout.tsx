import './globals.css';
import type { Metadata } from 'next';
import { Barlow_Condensed, Source_Sans_3, IBM_Plex_Mono } from 'next/font/google';

const fontDisplay = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

const fontBody = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});

const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-mono-num',
});

export const metadata: Metadata = {
  title: 'Controle de Pedidos · Nutry Cap',
  description: 'Painel de acompanhamento de pedidos por status',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
