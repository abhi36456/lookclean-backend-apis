'use client';

import React, { useEffect } from 'react';
import swaggerSpec from '../../../swagger.json';

// OpenAPI Spec definition for Look Clean Mobile API (dynamically loaded from swagger.json)
export const openApiSpec = swaggerSpec as any;

export default function DocsPage() {
  useEffect(() => {
    // Dynamic import styling and scripts (loading locally to prevent CDN/offline blocks)
    let swaggerUiCss = document.querySelector('link[href*="swagger-ui.css"]') as HTMLLinkElement;
    if (!swaggerUiCss) {
      swaggerUiCss = document.createElement('link');
      swaggerUiCss.rel = 'stylesheet';
      swaggerUiCss.href = '/assets/swagger/swagger-ui.css';
      document.head.appendChild(swaggerUiCss);
    }

    const initSwagger = () => {
      if ((window as any).SwaggerUIBundle) {
        const presets = (window as any).SwaggerUIBundle.presets;
        const ui = (window as any).SwaggerUIBundle({
          dom_id: '#swagger-ui',
          spec: openApiSpec,
          presets: [
            presets.apis,
            (window as any).SwaggerUIStandalonePreset || presets.standalone
          ],
          layout: 'BaseLayout',
          deepLinking: true,
          defaultModelsExpandDepth: -1,
          responseInterceptor: (response: any) => {
            if (response.url.includes('/auth/') && (response.url.includes('login') || response.url.includes('register'))) {
              if (response.obj && response.obj.token) {
                const token = response.obj.token;
                (window as any).ui.preauthorizeApiKey('BearerAuth', token);
                console.log('[Swagger Auto-Auth] Token authorized successfully!');
              }
            }
            return response;
          }
        });
        (window as any).ui = ui;
      }
    };

    let swaggerUiScript = document.querySelector('script[src*="swagger-ui-bundle.js"]') as HTMLScriptElement;
    if (!swaggerUiScript) {
      swaggerUiScript = document.createElement('script');
      swaggerUiScript.src = '/assets/swagger/swagger-ui-bundle.js';
      swaggerUiScript.async = true;
      swaggerUiScript.onload = () => {
        initSwagger();
      };
      document.body.appendChild(swaggerUiScript);
    } else {
      if ((window as any).SwaggerUIBundle) {
        initSwagger();
      } else {
        const existingOnload = swaggerUiScript.onload;
        swaggerUiScript.onload = (e) => {
          if (existingOnload) (existingOnload as any)(e);
          initSwagger();
        };
      }
    }
  }, []);

  return (
    <div className="bg-gray-50 min-h-screen">
      <style>{`
        /* Hide the Example Value | Schema tabs bar */
        .swagger-ui .tab {
          display: none !important;
        }
        /* Hide the bottom Schemas/Models section */
        .swagger-ui .models {
          display: none !important;
        }
        /* Hide all Swagger response examples, models, and header controls */
        .swagger-ui .response-col_description .model-example,
        .swagger-ui .response-col_description .model-box,
        .swagger-ui .response-col_description .response-controls,
        .swagger-ui .response-col_description .responses-inner h5,
        .swagger-ui .response-col_description h5 {
          display: none !important;
        }
      `}</style>
      {/* Brand logo header */}
      <div className="bg-slate-900 border-b border-slate-800 text-white px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-primary-gradient text-primary-contrast rounded-xl flex items-center justify-center text-sm font-black">
          LC
        </div>
        <span className="text-lg font-bold tracking-tight">
          Look Clean <span className="text-primary font-medium">Developer API Specification</span>
        </span>
      </div>

      {/* Swagger UI Target Container */}
      <div className="max-w-6xl mx-auto p-4 sm:p-6 bg-white shadow-sm mt-4 rounded-2xl border border-gray-150">
        <div id="swagger-ui" />
      </div>
    </div>
  );
}
