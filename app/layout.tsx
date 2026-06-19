import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Controle de Pedidos · Nutry Cap',
  description: 'Painel de acompanhamento de pedidos por status',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
