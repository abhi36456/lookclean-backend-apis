import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Look Clean - Salon & Styling Booking App",
  description: "Discover & book top-rated salons, barbers, and mobile stylists, or grow your styling business.",
  icons: {
    icon: "/assets/images/look_clean_new_fev_logo.png",
    shortcut: "/assets/images/look_clean_new_fev_logo.png",
    apple: "/assets/images/look_clean_new_fev_logo.png",
  },
};

import { Suspense } from "react";
import TopLoader from "@/components/TopLoader";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} min-h-screen antialiased dark`}
      suppressHydrationWarning
    >
      <body
        className="min-h-screen flex flex-col bg-dark-bg text-gray-100 selection:bg-primary/30 selection:text-white relative"
        suppressHydrationWarning
      >
        <Suspense fallback={null}>
          <TopLoader />
        </Suspense>

        {/* Decorative background glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

        <main className="flex-1 flex flex-col z-10">{children}</main>
      </body>
    </html>
  );
}
