import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import "./globals.css";

// globals.css maps Tailwind's font-sans, font-mono and font-serif to these variables.
const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Only the italic, for the accent words in headlines.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: "italic",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zava Energy customer service",
  description: "Talk to the Zava Energy voice assistant about your bill.",
};

export const viewport: Viewport = {
  themeColor: "#020b07",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const fonts = `${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`;
  return (
    <html lang="en" className={`dark ${fonts} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background">{children}</body>
    </html>
  );
}
