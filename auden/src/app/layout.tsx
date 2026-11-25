import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource-variable/inter/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auden",
  description: "Auden — personal AI for work, creativity and growth",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Auden", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#151515" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = await cookies();
  const theme = c.get("auden_theme")?.value;
  const locale = c.get("auden_locale")?.value === "en" ? "en" : "ru";
  return (
    <html lang={locale} data-theme={theme === "light" || theme === "dark" ? theme : "system"}>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker" in navigator&&location.protocol==="https:"){navigator.serviceWorker.register("/sw.js").catch(function(){})}`,
          }}
        />
      </body>
    </html>
  );
}
