import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bankism · AI Firewall",
  description: "Blue-team AI firewall for LLM banking: the LLM parses, deterministic code decides.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
