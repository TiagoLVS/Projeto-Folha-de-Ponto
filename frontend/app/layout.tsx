import { VisualThemeProvider } from "@/components/visual-theme";
import type { Metadata } from "next";
import { EmailAccount } from "@/components/email-account";
import { SystemLock } from "@/components/system-lock";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import "./glass.css";
import "./desktop-glass.css";
import "./clean-desktop.css";
import "./academic.css";
import "./themes.css";

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
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased"><VisualThemeProvider><SystemLock /><EmailAccount />{children}<Toaster position="bottom-right" richColors /></VisualThemeProvider></body>
    </html>
  );
}
