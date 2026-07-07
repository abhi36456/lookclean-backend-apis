'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Sparkles, ShieldCheck, Clock, Star, MapPin, ChevronDown, Check,
  Search, ArrowRight, Smartphone, Compass, Heart, MessageSquare
} from 'lucide-react';
import Button from '../components/Button';
import Card from '../components/Card';

export default function LandingPage() {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const categories = [
    { name: 'Haircuts', icon: '💇‍♂️', desc: 'Barbering, fades, trims' },
    { name: 'Hair Color', icon: '🎨', desc: 'Roots, highlights, balayage' },
    { name: 'Facials & Spa', icon: '🧖‍♀️', desc: 'Hydration, masks, massage' },
    { name: 'Nails & Makeup', icon: '💅', desc: 'Manicures, extensions, glam' }
  ];

  const steps = [
    { nr: '01', title: 'Discover Near You', desc: 'Browse highly-rated salons or mobile freelance stylists in your immediate area.' },
    { nr: '02', title: 'Compare Pricing', desc: 'View complete service menus, read client testimonials, and select your look.' },
    { nr: '03', title: 'Confirm & Enjoy', desc: 'Book instantly via the APP, check verified credentials, and get styled.' }
  ];

  const faqs = [
    { q: 'How does LookClean verify stylists?', a: 'All providers undergo phone number SMS OTP verification and identity document scanning (professional state cosmetology licenses are verified) before receiving a verified trust badge.' },
    { q: 'Can I book a stylist to travel to my home?', a: 'Yes! Freelance stylists are equipped to travel to your address with their own professional kit. You can also book appointments at standard physical salons.' },
    { q: 'Is my payment secure?', a: 'LookClean uses premium secure gateways. Payments are only released after your appointment is completed and confirmed.' }
  ];

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100 flex flex-col relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-[40%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Header / Navbar */}
      <header className="border-b border-gray-900 bg-gray-950/70 backdrop-blur-md px-6 py-4 flex justify-between items-center z-20 sticky top-0">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden bg-gray-950/40 border border-gray-900">
            <img src="/assets/images/Look_Clean_logo.png" alt="LookClean Logo" className="w-full h-full object-cover" />
          </div>
          <span className="font-extrabold text-white text-xl tracking-tight">
            Look<span className="text-primary">Clean</span>
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-gray-400">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          <Link href="/docs" className="text-primary hover:text-primary-light transition-colors flex items-center gap-1">
            API Docs
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="secondary" size="sm">Admin Panel</Button>
          </Link>
          <Link href="/docs" className="md:hidden">
            <Button variant="ghost" size="sm">Docs</Button>
          </Link>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative z-10 pt-20 pb-16 px-6 max-w-6xl mx-auto w-full text-center">
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
            Smarter Styling, <span className="text-gradient">LookClean</span> Results
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

        {/* Mockup Search Widget */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-3xl mx-auto mt-12 bg-gray-900/60 border border-gray-800 p-4 rounded-2xl sm:rounded-full shadow-2xl backdrop-blur-md flex flex-col sm:flex-row items-center gap-3"
        >
          <div className="flex items-center gap-2.5 px-4 w-full sm:w-1/2 border-b sm:border-b-0 sm:border-r border-gray-800 pb-3 sm:pb-0">
            <Search className="w-5 h-5 text-gray-500 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search services (e.g. Skin fade, balayage)..."
              className="bg-transparent text-white placeholder-gray-500 text-sm focus:outline-none w-full"
              defaultValue="Classic cut"
              readOnly
            />
          </div>
          <div className="flex items-center gap-2.5 px-4 w-full sm:w-1/3 pb-3 sm:pb-0">
            <MapPin className="w-5 h-5 text-primary flex-shrink-0" />
            <input
              type="text"
              placeholder="Your Location..."
              className="bg-transparent text-white placeholder-gray-500 text-sm focus:outline-none w-full"
              defaultValue="Manhattan, NY"
              readOnly
            />
          </div>
          <Button size="md" className="w-full sm:w-auto px-8 py-3 rounded-full flex-shrink-0">
            Search
          </Button>
        </motion.div>
      </section>

      {/* CATEGORIES GRID */}
      <section id="features" className="py-20 px-6 max-w-6xl mx-auto w-full relative z-10">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold text-white">Popular Service Categories</h2>
          <p className="text-gray-400 mt-2">Book any service in minutes with certified local professionals.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {categories.map((c) => (
            <Card key={c.name} animateHover className="border border-gray-800">
              <div className="text-4xl mb-4">{c.icon}</div>
              <h3 className="font-bold text-lg text-white">{c.name}</h3>
              <p className="text-gray-400 text-sm mt-1.5 leading-relaxed">{c.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-20 px-6 bg-gray-950/40 border-y border-gray-900 relative z-10">
        <div className="max-w-6xl mx-auto w-full">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-white">How LookClean Works</h2>
            <p className="text-gray-400 mt-2">Get styled in three simple, secure steps.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {steps.map((s, idx) => (
              <div key={idx} className="relative space-y-4">
                <span className="text-6xl font-black text-primary/10 absolute -top-8 left-0 select-none">
                  {s.nr}
                </span>
                <h3 className="font-bold text-xl text-white relative z-10 pt-2">{s.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS & TRUST */}
      <section className="py-20 px-6 max-w-5xl mx-auto w-full text-center relative z-10 space-y-10">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h2 className="text-3xl font-extrabold text-white">Security & Trust First</h2>
          <p className="text-gray-400">
            Every provider profile in our registry features verification badges denoting identity document audits and phone number OTP checks.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4">
          <div className="p-6 rounded-2xl bg-gray-900/30 border border-gray-850">
            <div className="text-3xl font-extrabold text-white">100%</div>
            <div className="text-xs text-gray-500 uppercase tracking-widest mt-1">Verified Badges</div>
          </div>
          <div className="p-6 rounded-2xl bg-gray-900/30 border border-gray-850">
            <div className="text-3xl font-extrabold text-white">4.9 ★</div>
            <div className="text-xs text-gray-500 uppercase tracking-widest mt-1">Average Rating</div>
          </div>
          <div className="p-6 rounded-2xl bg-gray-900/30 border border-gray-850">
            <div className="text-3xl font-extrabold text-white">20k+</div>
            <div className="text-xs text-gray-500 uppercase tracking-widest mt-1">Booked Styles</div>
          </div>
          <div className="p-6 rounded-2xl bg-gray-900/30 border border-gray-850">
            <div className="text-3xl font-extrabold text-white">12m</div>
            <div className="text-xs text-gray-500 uppercase tracking-widest mt-1">Avg. Stylist Travel</div>
          </div>
        </div>
      </section>

      {/* FAQ SECTION */}
      <section id="faq" className="py-20 px-6 max-w-3xl mx-auto w-full relative z-10">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold text-white">Frequently Asked Questions</h2>
          <p className="text-gray-400 mt-2">Everything you need to know about the LookClean registry.</p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <div
                key={idx}
                className="rounded-xl border border-gray-850 bg-gray-900/20 overflow-hidden transition-all duration-300"
              >
                <button
                  onClick={() => setActiveFaq(isOpen ? null : idx)}
                  className="w-full p-5 text-left flex justify-between items-center text-white font-semibold hover:bg-gray-850/40 transition-colors"
                >
                  <span>{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-sm text-gray-400 leading-relaxed border-t border-gray-850/40 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-900 bg-gray-950/80 px-6 py-8 relative z-10 mt-auto">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <img src="/assets/images/Look_Clean_logo.png" alt="LookClean Logo" className="w-5 h-5 object-contain" />
            <span className="font-bold text-white">LookClean &copy; 2026</span>
          </div>
          <div className="flex gap-6 text-sm text-gray-400">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#how-it-works" className="hover:text-white">How It Works</a>
            <Link href="/admin" className="hover:text-white">Admin</Link>
            <Link href="/docs" className="hover:text-white">API Swagger Docs</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
