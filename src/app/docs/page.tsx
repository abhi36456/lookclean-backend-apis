'use client';

import React, { useEffect } from 'react';

// OpenAPI Spec definition for LookClean Mobile API
const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'LookClean Mobile App API',
    description: 'API specifications for Client and Provider clients interacting with LookClean backend services.',
    version: '1.0.0',
  },
  servers: [
    {
      url: '/api',
      description: 'Local development server',
    },
  ],
  tags: [
    { name: 'Authenticate', description: 'Consolidated login, registration, and role selection APIs' },
    { name: 'Client Profile', description: 'Client profile details and settings' },
    { name: 'Verification', description: 'Phone OTP verification APIs' },
    { name: 'Provider Onboarding Flow', description: 'Step-by-step onboarding APIs (Steps 1 to 5) for service providers' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste Bearer token without "Bearer" prefix (e.g. eyJ1c2VySWQiOjIsImVtYWlsI...)',
      },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['client', 'provider', 'admin'] },
          providerType: { type: 'string', nullable: true, enum: ['freelancer', 'salon'] },
          isPhoneVerified: { type: 'boolean' },
          onboardingCompleted: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Service: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'integer' },
          category: { type: 'string' },
        },
      },
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Authenticate'],
        summary: 'Register a new user account',
        description: 'Creates a user credential set. Role is left empty and can be set via /auth/select-role.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'user@lookclean.com' },
                  password: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successfully registered user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid inputs or email already exists',
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Authenticate'],
        summary: 'Log in to user account',
        description: 'Authenticates credentials and yields JWT access token.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', example: 'provider@lookclean.com' },
                  password: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successful authentication',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid credentials',
          },
        },
      },
    },
    '/auth/select-role': {
      post: {
        tags: ['Authenticate'],
        summary: 'Select profile role & provider type',
        description: 'Selects the user\'s role and provider type after registration.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { type: 'string', enum: ['client', 'provider'] },
                  providerType: { type: 'string', enum: ['freelancer', 'salon'], nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successfully updated role details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized access',
          },
        },
      },
    },
    '/clients/me': {
      get: {
        tags: ['Client Profile'],
        summary: 'Get current user profile details',
        description: 'Returns profile details based on authenticated Bearer token. Accessible only for clients.',
        responses: {
          200: {
            description: 'Profile data loaded successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          401: {
            description: 'Missing or expired token header',
          },
          403: {
            description: 'Forbidden: Requires client role',
          },
        },
      },
    },
    '/clients/profile': {
      put: {
        tags: ['Client Profile'],
        summary: 'Update User Profile Settings',
        description: 'Update client profile details. Accessible only for clients.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Sarah Connor' },
                  location: { type: 'string', example: 'Los Angeles, CA' },
                  latitude: { type: 'number', format: 'float', example: 34.0522 },
                  longitude: { type: 'number', format: 'float', example: -118.2437 },
                  profileImage: { type: 'string', format: 'binary', description: 'Upload client profile image file' },
                  onboardingCompleted: { type: 'boolean', example: true },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Sarah Connor' },
                  location: { type: 'string', example: 'Los Angeles, CA' },
                  latitude: { type: 'number', format: 'float', example: 34.0522 },
                  longitude: { type: 'number', format: 'float', example: -118.2437 },
                  profileImageUrl: { type: 'string', example: 'https://...' },
                  onboardingCompleted: { type: 'boolean', example: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Profile saved successfully',
          },
          401: {
            description: 'Unauthorized access',
          },
          403: {
            description: 'Forbidden: Requires client role',
          },
        },
      },
    },
    '/providers/me': {
      get: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Get current provider profile details',
        description: 'Returns provider profile details based on authenticated Bearer token. Accessible only for providers.',
        responses: {
          200: {
            description: 'Profile data loaded successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          401: {
            description: 'Missing or expired token header',
          },
          403: {
            description: 'Forbidden: Requires provider role',
          },
        },
      },
    },
    '/users/verify/mobile/send': {
      post: {
        tags: ['Verification'],
        summary: 'Send Mobile SMS Verification',
        description: 'Sends dynamic OTP verification SMS code via Twilio.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phoneNumber'],
                properties: {
                  phoneNumber: { type: 'string', example: '+17755228862' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'SMS verification sent successfully',
          },
        },
      },
    },
    '/users/verify/mobile': {
      post: {
        tags: ['Verification'],
        summary: 'Verify Mobile SMS OTP',
        description: 'Verify phone using OTP code (Use: 1234 or 123456 or dynamic code).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phoneNumber', 'code'],
                properties: {
                  phoneNumber: { type: 'string', example: '+17755228862' },
                  code: { type: 'string', example: '1234' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Mobile phone verified successfully',
          },
          400: {
            description: 'Invalid verification code matching',
          },
        },
      },
    },
    '/provider/setup/profile': {
      post: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 1: Set up Provider Profile details',
        description: 'Configures cover images, profile images, and geo-coordinates for the service provider.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['name', 'location'],
                properties: {
                  name: { type: 'string', example: 'Glamour Cuts' },
                  location: { type: 'string', example: 'Los Angeles, CA' },
                  profileImage: { type: 'string', format: 'binary', description: 'Profile image file (PNG/JPG)' },
                  coverImage: { type: 'string', format: 'binary', description: 'Cover image file (PNG/JPG)' },
                  latitude: { type: 'number', example: 34.0522 },
                  longitude: { type: 'number', example: -118.2437 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Profile updated successfully' },
        },
      },
    },
    '/provider/setup/categories': {
      get: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 2: Get all admin-defined categories',
        responses: {
          200: {
            description: 'Returns list of category objects',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer', example: 1 },
                      title: { type: 'string', example: 'Haircut' }
                    }
                  }
                }
              }
            }
          },
        },
      },
      post: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 2: Save selected categories for provider',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['categories'],
                properties: {
                  categories: {
                    type: 'array',
                    items: { type: 'integer' },
                    example: [1, 2],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Categories saved successfully' },
        },
      },
    },
    '/provider/setup/services': {
      get: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 3: Get all admin-defined services & pricing template',
        responses: {
          200: { description: 'Returns list of service titles' },
        },
      },
      post: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 3: Save selected services and pricing',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['services'],
                properties: {
                  services: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        service_id: { type: 'integer', example: 1 },
                        price: { type: 'integer', example: 45 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Services saved successfully' },
        },
      },
    },
    '/provider/setup/ambience': {
      get: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 4: Get all admin-defined Ambience & Amenities template',
        responses: {
          200: { description: 'Returns list of ambience and amenity configurations' },
        },
      },
      post: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 4: Save selected Ambience & Amenities',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ambienceIds'],
                properties: {
                  ambienceIds: {
                    type: 'array',
                    items: {
                      type: 'integer'
                    },
                    example: [1, 2, 3],
                    description: 'Array of Ambience Setting IDs',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Ambience & Amenities saved successfully' },
        },
      },
    },
    '/provider/setup/license': {
      post: {
        tags: ['Provider Onboarding Flow'],
        summary: 'Step 5: Save Licenses, experience, and complete onboarding',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['experience'],
                properties: {
                  experience: { type: 'integer', example: 8 },
                  licenseType: { type: 'string', example: 'Cosmetology License' },
                  certificate: { type: 'string', format: 'binary', description: 'Upload certificate (PDF or Image only)' },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                required: ['experience'],
                properties: {
                  experience: { type: 'integer', example: 8 },
                  licenseType: { type: 'string', example: 'Cosmetology License' },
                  certificateUrl: { type: 'string', example: 'https://...' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Onboarding complete and profile finalized' },
        },
      },
    },
  },
};

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
      {/* Brand logo header */}
      <div className="bg-slate-900 border-b border-slate-800 text-white px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-primary-gradient text-primary-contrast rounded-xl flex items-center justify-center text-sm font-black">
          LC
        </div>
        <span className="text-lg font-bold tracking-tight">
          LookClean <span className="text-primary font-medium">Developer API Specification</span>
        </span>
      </div>

      {/* Swagger UI Target Container */}
      <div className="max-w-6xl mx-auto p-4 sm:p-6 bg-white shadow-sm mt-4 rounded-2xl border border-gray-150">
        <div id="swagger-ui" />
      </div>
    </div>
  );
}
