import type { Metadata, Viewport } from "next";
import "./globals.css";
import { themeInitScript } from "./components/ThemeToggle";

export const metadata: Metadata = {
  title: "Bankism · AI Firewall",
  description: "Blue-team AI firewall for LLM banking: the LLM parses, deterministic code decides.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0f16" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The init script sets data-theme before hydration, so React must not warn about it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
