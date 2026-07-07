'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Settings, Globe, Shield, Terminal, ArrowUpRight, Code
} from 'lucide-react';
import Button from '../../components/Button';
import Card from '../../components/Card';

export default function DevSettingPage() {
  const routes = [
    {
      title: 'Root Website',
      path: '/',
      desc: 'One-page client root landing website featuring LookClean value props, steps, categories, and FAQ sections.',
      icon: <Globe className="w-6 h-6 text-primary" />,
      btnText: 'Open Landing Page',
    },
    {
      title: 'Admin Registry Panel',
      path: '/admin',
      desc: 'Statistics control dashboard showing clients/providers metrics, searchable user grids, and user details drawers.',
      icon: <Shield className="w-6 h-6 text-purple-400" />,
      btnText: 'Open Admin Panel',
    },
    {
      title: 'Swagger API Docs Console',
      path: '/docs',
      desc: 'Interactive OpenAPI specification runner for authentication, user profiles, and document/phone verifications.',
      icon: <Terminal className="w-6 h-6 text-green-400" />,
      btnText: 'Open Swagger Docs',
    },
  ];

  return (
    <div className="min-h-screen bg-dark-bg text-gray-100 flex flex-col relative overflow-hidden items-center justify-center p-4 sm:p-6">
      {/* Decorative background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl z-10 space-y-6"
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden bg-gray-950/40 border border-gray-900">
            <img src="/assets/images/Look_Clean_logo.png" alt="LookClean Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            Look<span className="text-primary">Clean</span> Dev Center
          </h1>
          <p className="text-gray-400 text-sm max-w-md">
            Quick-access registry for developer options, route settings, and local specifications.
          </p>
        </div>

        {/* Routes Grid */}
        <div className="space-y-4">
          {routes.map((route, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.1 }}
            >
              <Card className="border border-gray-800 p-5 hover:border-primary/20 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-gray-900/60 rounded-xl border border-gray-850 flex-shrink-0">
                    {route.icon}
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-white text-base flex items-center gap-1.5">
                      {route.title}
                      <span className="text-xs font-mono text-gray-500 bg-gray-950 px-2 py-0.5 rounded border border-gray-850">
                        {route.path}
                      </span>
                    </h3>
                    <p className="text-xs text-gray-400 leading-relaxed max-w-md">
                      {route.desc}
                    </p>
                  </div>
                </div>
                <Link href={route.path} className="w-full sm:w-auto">
                  <Button variant="secondary" size="sm" className="w-full text-xs font-bold" rightIcon={<ArrowUpRight className="w-4 h-4" />}>
                    {route.btnText}
                  </Button>
                </Link>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Footer info */}
        <div className="text-center">
          <span className="text-[10px] text-gray-600 font-bold uppercase tracking-wider flex items-center justify-center gap-1.5">
            <Code className="w-3.5 h-3.5" /> Next.js Development Server Portal
          </span>
        </div>
      </motion.div>
    </div>
  );
}
