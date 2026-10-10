import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Path of Building Web",
  description: "Веб-версия Path of Building Community для Path of Exile 1.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
