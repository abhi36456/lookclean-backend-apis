'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface FaqItem {
  question: string;
  answer: string;
}

export default function ProviderFaqsPage() {
  const [title, setTitle] = useState('Provider FAQ');
  const [content, setContent] = useState('');
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  useEffect(() => {
    fetch('/api/cms/provider-faqs')
      .then((res) => res.json())
      .then((d) => {
        if (d) {
          setTitle(d.title || 'Provider FAQ');
          setContent(typeof d.content === 'string' ? d.content : '');
          if (Array.isArray(d.content)) {
            setFaqs(d.content);
          } else if (Array.isArray(d.faqs) && d.faqs.length > 0) {
            setFaqs(d.faqs);
          } else if (d.content && typeof d.content === 'string') {
            try {
              if (d.content.trim().startsWith('[')) {
                setFaqs(JSON.parse(d.content));
              } else {
                const qMatches = [...d.content.matchAll(/<b>Q:\s*(.*?)<\/b>/gi)];
                const aMatches = [...d.content.matchAll(/A:\s*(.*?)(?=<br>|<\/p>|$)/gi)];
                const items: FaqItem[] = [];
                for (let i = 0; i < Math.max(qMatches.length, aMatches.length); i++) {
                  const q = qMatches[i] ? qMatches[i][1].replace(/<[^>]+>/g, '').trim() : '';
                  const a = aMatches[i] ? aMatches[i][1].replace(/<[^>]+>/g, '').trim() : '';
                  if (q || a) items.push({ question: q, answer: a });
                }
                setFaqs(items);
              }
            } catch { }
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredFaqs = faqs.filter(
    (item) =>
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <div className="bg-gray-900/40 border border-gray-850 p-8 sm:p-12 rounded-3xl backdrop-blur-sm shadow-2xl space-y-8">
          <div className="space-y-3">
            <span className="text-xs font-extrabold uppercase tracking-widest text-amber-500 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
              Provider Center
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight border-b border-gray-850 pb-4">
              {title}
            </h1>
            <p className="text-sm text-gray-400">
              Find answers to frequently asked questions about booking notifications, schedule settings, payouts, and service management for providers.
            </p>
          </div>

          {/* Search bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search Provider FAQs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-2xl px-5 py-3.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-all"
            />
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading Provider FAQs...</div>
          ) : faqs.length > 0 ? (
            <div className="space-y-4">
              {filteredFaqs.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-500">
                  No FAQs matching &quot;{searchQuery}&quot;
                </div>
              ) : (
                filteredFaqs.map((faq, idx) => {
                  const isOpen = openIndex === idx;
                  return (
                    <div
                      key={idx}
                      className="border border-gray-850 bg-gray-950/60 rounded-2xl overflow-hidden transition-all"
                    >
                      <button
                        onClick={() => setOpenIndex(isOpen ? null : idx)}
                        className="w-full text-left px-6 py-4 flex items-center justify-between font-bold text-sm text-white hover:text-amber-400 transition-colors"
                      >
                        <span className="flex items-center gap-3">
                          <span className="text-amber-500 text-xs font-mono font-bold">Q{idx + 1}.</span>
                          {faq.question}
                        </span>
                        <span className="text-gray-400 text-lg">{isOpen ? '−' : '+'}</span>
                      </button>
                      {isOpen && (
                        <div className="px-6 pb-5 pt-1 text-sm text-gray-300 border-t border-gray-900/60 leading-relaxed">
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div
              className="prose prose-invert prose-amber max-w-none text-gray-300 text-sm leading-relaxed space-y-4"
              dangerouslySetInnerHTML={{
                __html:
                  content ||
                  '<h1>Provider FAQ</h1><p><b>Q: How do I receive booking notifications?</b><br>A: Notifications are sent via push notifications and sms.<br><br><b>Q: How do I set my schedule?</b><br>A: Configure your working hours under Schedule Settings.</p>'
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
