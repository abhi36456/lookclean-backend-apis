'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export default function ProviderPaymentPolicyPage() {
  const [data, setData] = useState<{ title: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cms/provider-payment-policy')
      .then((res) => res.json())
      .then((d) => {
        if (d && d.content) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col justify-between selection:bg-amber-500 selection:text-black">
      {/* Header */}
      <header className="border-b border-gray-900 bg-gray-950/80 backdrop-blur sticky top-0 z-30 px-6 py-4 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-3">
          <div className="h-10 w-auto">
            <img src="/assets/images/Look_Clean_New_Logo.png" alt="Look Clean Logo" className="h-full object-contain" />
          </div>
          <span className="font-extrabold text-white text-lg tracking-tight">Look Clean</span>
        </Link>
        <Link
          href="/"
          className="text-xs font-semibold text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-gray-850 bg-gray-900/50 hover:bg-gray-900 transition-all"
        >
          &larr; Back to Home
        </Link>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl w-full mx-auto px-6 py-12 flex-grow">
        <div className="bg-gray-900/40 border border-gray-850 p-8 sm:p-12 rounded-3xl backdrop-blur-sm shadow-2xl space-y-6">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight border-b border-gray-850 pb-4">
            {data?.title || 'Provider Payment Policy'}
          </h1>

          {loading ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading Provider Payment Policy...</div>
          ) : (
            <div
              className="prose prose-invert prose-amber max-w-none text-gray-300 text-sm leading-relaxed space-y-4"
              dangerouslySetInnerHTML={{
                __html:
                  data?.content ||
                  '<h1>Provider Payment Policy</h1><p>Provider earnings and payouts are deposited into registered bank accounts on a weekly or bi-weekly cycle minus platform commission fees.</p>'
              }}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 bg-gray-950 py-6 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} Look Clean. All rights reserved.
      </footer>
    </div>
  );
}
