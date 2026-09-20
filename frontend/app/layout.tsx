import type { Metadata } from "next";
import "./globals.css";
import "./glass.css";
import "./desktop-glass.css";
import "./clean-desktop.css";

export const metadata: Metadata = {
  title: "Ponto Docente · UnDF",
  description: "Gestão de professores e folhas de ponto da Universidade do Distrito Federal.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
