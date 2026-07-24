'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import Button from '../components/Button';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-dark-bg text-gray-100 flex flex-col relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-[40%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Header / Navbar */}
      <header className="border-b border-gray-900 bg-gray-950/70 backdrop-blur-md px-6 py-4 flex justify-between items-center z-20 sticky top-0">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-gray-950/40 border border-gray-900">
            <img src="/assets/images/Look_Clean_New_Logo.png" alt="Look Clean Logo" className="w-full h-full object-cover" />
          </div>
          <span className="font-extrabold text-white text-xl tracking-tight">
            Look<span className="text-primary">Clean</span>
          </span>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative z-10 py-20 px-6 max-w-6xl mx-auto w-full text-center flex-1 flex flex-col justify-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-6"
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full bg-primary/10 text-primary border border-primary/15 uppercase tracking-wider mx-auto">
            <Sparkles className="w-3.5 h-3.5" /> Book Top Salon & Mobile Stylists
          </span>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-tight max-w-4xl mx-auto">
            Smarter Styling, <span className="text-gradient">Look Clean</span> Results
          </h1>
          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto font-medium">
            Find certified independent barbers, mobile nail artists, and premium salons near you. Instant booking, verified credentials, and secure transactions.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-6">
            <Link href="/docs">
              <Button size="lg" className="w-full sm:w-auto" rightIcon={<ArrowRight className="w-5 h-5" />}>
                Explore Swagger APIs
              </Button>
            </Link>
            <Link href="/admin">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                Admin Panel Login
              </Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-900 bg-gray-950/80 px-6 py-8 relative z-10 mt-auto">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <img src="/assets/images/Look_Clean_New_Logo.png" alt="Look Clean Logo" className="w-5 h-5 object-contain" />
            <span className="font-bold text-white">Look Clean &copy; 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

