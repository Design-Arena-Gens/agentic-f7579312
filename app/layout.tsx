import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Agentic Dubber",
  description: "Advanced multi-language video dubbing with voice cloning",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <nav className="nav">
            <Link href="/">Agentic Dubber</Link>
            <div className="spacer" />
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">MIT ? {new Date().getFullYear()}</footer>
      </body>
    </html>
  );
}
