import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { resolveTenantBySlug } from "@/lib/tenant/resolve";
import { slugFromHost } from "@/modules/auth/routes";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Bravitar",
  description: "Students, batches, attendance and fees for activity academies.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// On an academy's address, its type picks the accent (globals.css), for every
// page and the sheets that open outside it.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const slug = slugFromHost((await headers()).get("host"));
  const vertical = slug ? (await resolveTenantBySlug(slug))?.verticalPreset : undefined;
  return (
    <html lang="en" data-vertical={vertical} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
