import type { Metadata } from "next"
import { Poppins } from "next/font/google"
import "./globals.css"

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "Wugi — Atlanta Nightlife & Dining",
  description: "Discover the best venues, events, and experiences in Atlanta.",
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
