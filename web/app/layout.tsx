import type { Metadata } from "next"
import { Poppins } from "next/font/google"
import "./globals.css"

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

const SITE_URL = "https://wugi.us"
const SITE_IMAGE = "https://wugi.us/og-default.svg"

export const metadata: Metadata = {
  title: "Wugi — Atlanta Nightlife & Dining",
  description: "Discover the best venues, events, and experiences in Atlanta.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: "Wugi",
    title: "Wugi — Atlanta Nightlife & Dining",
    description: "Discover the best venues, events, and experiences in Atlanta.",
    url: SITE_URL,
    type: "website",
    images: [{ url: SITE_IMAGE, width: 1200, height: 630, alt: "Wugi — Atlanta Nightlife & Dining" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wugi — Atlanta Nightlife & Dining",
    description: "Discover the best venues, events, and experiences in Atlanta.",
    images: [SITE_IMAGE],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${poppins.variable} font-sans antialiased bg-[#f5f3ef] dark:bg-[#111111] text-[#111111] dark:text-white transition-colors`}>
        {children}
      </body>
    </html>
  )
}
