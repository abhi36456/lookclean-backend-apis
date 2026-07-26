'use client';

import React, { useEffect } from 'react';

// OpenAPI Spec definition for Look Clean Mobile API
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Look Clean Mobile App API',
    description: 'API specifications for Client and Provider clients interacting with Look Clean backend services.',
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
    { name: 'Reviews & Ratings', description: 'Provider review and rating submission APIs' },
    { name: 'Settings & FAQ, CMS Page', description: 'Mobile app settings, app version, promo codes, FAQs, and CMS legal pages APIs' },
    { name: 'Report & Issues', description: 'User feedback and app issues report submission API' },
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
    '/providers/daily/transactions': {
      post: {
        tags: ['Providers Profile'],
        summary: 'Get daily transactions',
        description: 'Returns daily aggregated transactions (bookings, service amounts) for the authenticated provider.',
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: {
                  sortBy: { type: 'string', enum: ['currently month', 'all'], example: 'currently month', description: 'Filter mode: "currently month" or "all"' },
                  page: { type: 'integer', example: 1, description: 'Page number for pagination when sortBy is "all"' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Daily transactions retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string', format: 'date', example: '2026-07-25' },
                      totalServiceAmount: { type: 'number', example: 25 },
                      transactions: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'integer' },
                            client: { $ref: '#/components/schemas/User' },
                            services: {
                              type: 'array',
                              items: { $ref: '#/components/schemas/Service' },
                            },
                            rating: {
                              type: 'object',
                              nullable: true,
                              properties: {
                                rating: { type: 'number' },
                                comment: { type: 'string', nullable: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized access' },
          403: { description: 'Forbidden: Requires provider role' },
        },
      },
    },
    '/providers/client-profile': {
      get: {
        tags: ['Providers Profile'],
        summary: 'Get customer profile and transactions',
        description: 'Returns the client information and all past transactions (with ratings) in descending order.',
        parameters: [
          {
            name: 'clientId',
            in: 'query',
            required: true,
            schema: { type: 'integer' },
            description: 'ID of the client',
          },
        ],
        responses: {
          200: {
            description: 'Customer profile retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    client: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        clientProfile: { type: 'object' },
                        transactions: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'integer' },
                              date: { type: 'string', format: 'date' },
                              serviceAmount: { type: 'number' },
                              status: { type: 'string' },
                              services: {
                                type: 'array',
                                items: { type: 'object' },
                              },
                              rating: {
                                type: 'object',
                                nullable: true,
                                properties: {
                                  rating: { type: 'number' },
                                  comment: { type: 'string', nullable: true },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Unauthorized access' },
          403: { description: 'Forbidden: Requires provider role' },
          404: { description: 'Client not found' },
        },
      },
    },
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
                  fcmToken: { type: 'string', example: 'fcm_device_token_sample_12345', description: 'Firebase Cloud Messaging push notification token' },
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
                  fcmToken: { type: 'string', example: 'fcm_device_token_sample_12345', description: 'Firebase Cloud Messaging push notification token' },
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
    '/auth/social-login': {
      post: {
        tags: ['Authenticate'],
        summary: 'Social login or sign up',
        description: 'Authenticates a user via Google or iOS social credentials. Auto-creates account if the social key does not exist.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['social_key', 'social_type', 'email'],
                properties: {
                  social_key: { type: 'string', example: 'oauth_unique_key_12345' },
                  social_type: { type: 'string', enum: ['google', 'ios'], example: 'google' },
                  username: { type: 'string', example: 'Sarah Connor' },
                  email: { type: 'string', example: 'sarah.connor@gmail.com' },
                  fcmToken: { type: 'string', example: 'fcm_device_token_sample_12345', description: 'Firebase Cloud Messaging push notification token' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successfully authenticated user',
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
            description: 'Missing fields or invalid social type',
          },
        },
      },
    },
    '/auth/forgot-password/send-otp': {
      post: {
        tags: ['Authenticate'],
        summary: 'Send Forgot Password OTP',
        description: 'Generates a 6-digit password reset verification code and sends it via Twilio SMS to the user\'s verified phone number.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phoneNumber'],
                properties: {
                  phoneNumber: { type: 'string', example: '+15197749197' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OTP code sent successfully',
          },
          400: {
            description: 'Invalid input or account lacks a verified phone number',
          },
          404: {
            description: 'Phone number not registered',
          },
        },
      },
    },
    '/auth/forgot-password/verify-otp': {
      post: {
        tags: ['Authenticate'],
        summary: 'Verify Forgot Password OTP',
        description: 'Verifies the 6-digit verification code sent to the phone number. Yields a short-lived reset token.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phoneNumber', 'code'],
                properties: {
                  phoneNumber: { type: 'string', example: '+15197749197' },
                  code: { type: 'string', example: '123456' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OTP verified successfully. Yields password reset token.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid or expired OTP code',
          },
          404: {
            description: 'Phone number not registered',
          },
        },
      },
    },
    '/auth/forgot-password/reset': {
      post: {
        tags: ['Authenticate'],
        summary: 'Reset Account Password',
        description: 'Resets the account password using the verified password reset token.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: { type: 'string', description: 'Token obtained from /auth/forgot-password/verify-otp' },
                  password: { type: 'string', example: 'newsecurepassword123' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Password updated successfully',
          },
          400: {
            description: 'Invalid or expired reset token',
          },
        },
      },
    },
    '/users/change-password': {
      post: {
        tags: ['Authenticate'],
        summary: 'Change Logged-In User Password',
        description: 'Allows an authenticated user to change their account password.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['oldPassword', 'newPassword'],
                properties: {
                  oldPassword: { type: 'string', example: 'oldpassword123' },
                  newPassword: { type: 'string', example: 'newpassword123' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Password changed successfully',
          },
          400: {
            description: 'Invalid current password',
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
      delete: {
        tags: ['Client Profile'],
        summary: 'Delete Logged-In Client Account',
        description: 'Allows an authenticated client to permanently delete their own account and all associated profile, services, and amenities data.',
        responses: {
          200: {
            description: 'Account deleted successfully',
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
    '/clients/providers': {
      get: {
        tags: ['Client Profile'],
        summary: 'Get All Providers list with category filter',
        description: 'Returns list of all registered service providers. Can optionally filter by main category ID or name.',
        parameters: [
          {
            name: 'search',
            in: 'query',
            required: false,
            description: 'Search by salon name, freelancer name, service title, or category title',
            schema: {
              type: 'string',
              example: 'Glamour',
            },
          },
          {
            name: 'providerType',
            in: 'query',
            required: false,
            description: 'Filter by provider type: salon or freelancer',
            schema: {
              type: 'string',
              enum: ['salon', 'freelancer'],
              example: 'salon',
            },
          },
          {
            name: 'service',
            in: 'query',
            required: false,
            description: 'Filter by specific service name',
            schema: {
              type: 'string',
              example: 'Haircut',
            },
          },
          {
            name: 'categoryId',
            in: 'query',
            required: false,
            description: 'The main category ID or name to filter providers (e.g. 1 or "Haircut")',
            schema: {
              type: 'string',
              example: '1',
            },
          },
          {
            name: 'sortBy',
            in: 'query',
            required: false,
            description: 'Sort providers by Nearest, Earliest, Ratings, or Featured',
            schema: {
              type: 'string',
              enum: ['Nearest', 'Earliest', 'Ratings', 'Featured'],
              example: 'Nearest',
            },
          },
        ],
        responses: {
          200: {
            description: 'Providers list retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      email: { type: 'string' },
                      name: { type: 'string' },
                      role: { type: 'string' },
                      providerProfile: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          location: { type: 'string' },
                          experience: { type: 'integer' },
                          categories: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                id: { type: 'integer' },
                                title: { type: 'string' },
                              },
                            },
                          },
                          services: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                id: { type: 'integer' },
                                serviceId: { type: 'integer', nullable: true },
                                name: { type: 'string' },
                                price: { type: 'integer' },
                              },
                            },
                          },
                          reviews: {
                            type: 'object',
                            properties: {
                              rating: { type: 'number', example: 4.9 },
                              totalReviews: { type: 'integer', example: 312 },
                              totalReviewsText: { type: 'string', example: '312 reviews' },
                              list: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    name: { type: 'string', example: 'James W.' },
                                    initials: { type: 'string', example: 'JW' },
                                    timeAgo: { type: 'string', example: '2 days ago' },
                                    rating: { type: 'integer', example: 5 },
                                    comment: { type: 'string', example: "Absolutely incredible experience. Best fade I've ever had." }
                                  }
                                }
                              }
                            }
                          },
                          earliestTime: { type: 'string', example: '00:00 AM' },
                          isWishlisted: { type: 'boolean', example: false },
                        },
                      },
                      isWishlisted: { type: 'boolean', example: false },
                    },
                  },
                },
              },
            },
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
    '/clients/wishlist': {
      post: {
        tags: ['Client Profile'],
        summary: 'Toggle provider in client wishlist',
        description: 'Adds a provider to the client\'s wishlist if not present, or removes them if they already exist.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['providerId'],
                properties: {
                  providerId: {
                    type: 'integer',
                    description: 'The user ID of the provider',
                    example: 2,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Wishlist status toggled successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    isWishlisted: { type: 'boolean' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized access',
          },
          403: {
            description: 'Forbidden: Requires client role',
          },
        },
      },
      get: {
        tags: ['Client Profile'],
        summary: 'Get all wishlisted providers',
        description: 'Returns list of all registered service providers currently in the authenticated client\'s wishlist.',
        responses: {
          200: {
            description: 'Wishlisted providers retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      email: { type: 'string' },
                      name: { type: 'string' },
                      role: { type: 'string' },
                      isWishlisted: { type: 'boolean', example: true },
                      providerProfile: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          location: { type: 'string' },
                          experience: { type: 'integer' },
                          isWishlisted: { type: 'boolean', example: true },
                          categories: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                id: { type: 'integer' },
                                title: { type: 'string' },
                              },
                            },
                          },
                          services: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                id: { type: 'integer' },
                                serviceId: { type: 'integer', nullable: true },
                                name: { type: 'string' },
                                price: { type: 'integer' },
                              },
                            },
                          },
                          reviews: {
                            type: 'object',
                            properties: {
                              rating: { type: 'number', example: 4.9 },
                              totalReviews: { type: 'integer', example: 312 },
                              totalReviewsText: { type: 'string', example: '312 reviews' },
                              list: {
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    name: { type: 'string', example: 'James W.' },
                                    initials: { type: 'string', example: 'JW' },
                                    timeAgo: { type: 'string', example: '2 days ago' },
                                    rating: { type: 'integer', example: 5 },
                                    comment: { type: 'string', example: "Absolutely incredible experience. Best fade I've ever had." }
                                  }
                                }
                              }
                            }
                          },
                          earliestTime: { type: 'string', example: '00:00 AM' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized access',
          },
          403: {
            description: 'Forbidden: Requires client role',
          },
        },
      },
      delete: {
        tags: ['Client Profile'],
        summary: 'Delete provider from wishlist by ID',
        description: "Removes a service provider from the client's wishlist by provider ID (via path /clients/wishlist/{providerId}, query ?providerId=2, or body).",
        parameters: [
          {
            name: 'providerId',
            in: 'query',
            required: false,
            schema: { type: 'integer', example: 2 },
            description: 'Provider user ID to remove from wishlist'
          }
        ],
        responses: {
          200: {
            description: 'Provider removed from wishlist successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Provider removed from wishlist successfully' },
                    providerId: { type: 'integer', example: 2 },
                    isWishlisted: { type: 'boolean', example: false }
                  }
                }
              }
            }
          },
          400: { description: 'Missing or invalid providerId' },
          401: { description: 'Unauthorized access' },
          403: { description: 'Forbidden: Requires client role' }
        }
      }
    },
    '/providers/me': {
      get: {
        tags: ['Providers Profile'],
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
      delete: {
        tags: ['Providers Profile'],
        summary: 'Delete Logged-In Provider Account',
        description: 'Allows an authenticated provider to permanently delete their own account and all associated profile, services, and amenities data.',
        responses: {
          200: {
            description: 'Account deleted successfully',
          },
          401: {
            description: 'Unauthorized access',
          },
          403: {
            description: 'Forbidden: Requires provider role',
          },
        },
      },
    },
    '/providers/me/experiences': {
      post: {
        tags: ['Providers Profile'],
        summary: 'Update Provider Experience (Years)',
        description: 'Updates the provider profile experience field. Accessible only for providers.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['experience'],
                properties: {
                  experience: {
                    type: 'integer',
                    description: 'Years of experience',
                    example: 8,
                  },
                },
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['experience'],
                properties: {
                  experience: {
                    type: 'integer',
                    description: 'Years of experience',
                    example: 8,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Experience updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                      example: true,
                    },
                    message: {
                      type: 'string',
                      example: 'Experience updated successfully',
                    },
                    experience: {
                      type: 'integer',
                      example: 8,
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid input or bad request',
          },
          401: {
            description: 'Unauthorized access',
          },
          403: {
            description: 'Forbidden: Requires provider role',
          },
        },
      },
    },
    '/providers/me/availability/config': {
      post: {
        tags: ['Provider Schedule & Availability'],
        summary: 'Set Provider Working Hours & Slot Duration',
        description: 'Allows a provider to set their default working hours and slot duration (in minutes).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['startTime', 'endTime', 'slotDuration'],
                properties: {
                  startTime: { type: 'string', example: '09:00 AM' },
                  endTime: { type: 'string', example: '06:00 PM' },
                  slotDuration: { type: 'integer', example: 60 }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Configuration saved successfully' }
        }
      }
    },
    '/providers/me/availability/slots': {
      get: {
        tags: ['Provider Schedule & Availability'],
        summary: 'Get Provider Availability Slots (Monday to Sunday)',
        description: 'Generates time slots according to the configuration and returns status (active or inactive) for Monday through Sunday.',
        responses: {
          200: { description: 'Success' }
        }
      },
      post: {
        tags: ['Provider Schedule & Availability'],
        summary: 'Save Active Availability Slots',
        description: 'Allows provider to select/pick which slots they are active or inactive for.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['slots'],
                properties: {
                  slots: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['dayOfWeek', 'timeSlot', 'isAvailable'],
                      properties: {
                        dayOfWeek: { type: 'string', example: 'Monday' },
                        timeSlot: { type: 'string', example: '09:00 AM' },
                        isAvailable: { type: 'boolean', example: true }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Slots updated successfully' }
        }
      }
    },
    '/clients/providers/availability': {
      get: {
        tags: ['Booking & Order Summary'],
        summary: 'Get Provider Available Slots for Specific Date',
        description: 'Returns only the available (non-booked, active) slots for a provider on a specific date.',
        parameters: [
          { name: 'providerId', in: 'query', required: true, schema: { type: 'integer', example: 2 } },
          { name: 'date', in: 'query', required: true, description: 'YYYY-MM-DD format', schema: { type: 'string', example: '2026-07-23' } },
          { name: 'currentTime', in: 'query', required: false, description: 'Client current time (e.g. "14:30" or ISO string) to filter out past slots for today', schema: { type: 'string', example: '14:30' } }
        ],
        responses: {
          200: { description: 'Success' }
        }
      }
    },
    '/orders/calculate': {
      post: {
        tags: ['Booking & Order Summary'],
        summary: 'Calculate Order Summary (Totals, Tips, Vouchers)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['serviceIds', 'tipType'],
                properties: {
                  serviceIds: { type: 'array', items: { type: 'integer' }, example: [1, 2] },
                  numberOfPeople: { type: 'integer', example: 2 },
                  tipType: { type: 'string', example: '10%' },
                  tipAmount: { type: 'number', example: 0 },
                  promoCode: { type: 'string', example: 'SAVE10' },
                  voucherCode: { type: 'string', example: 'SAVE10' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Success' }
        }
      }
    },
    '/clients/bookings': {
      get: {
        tags: ['Booking & Order Summary'],
        summary: 'List Bookings for Client',
        responses: {
          200: { description: 'Success' }
        }
      },
      post: {
        tags: ['Booking & Order Summary'],
        summary: 'Create Provider Booking',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['providerId', 'serviceIds', 'numberOfPeople', 'date', 'timeSlot', 'tipType'],
                properties: {
                  providerId: { type: 'integer', example: 2 },
                  serviceIds: { type: 'array', items: { type: 'integer' }, example: [1] },
                  numberOfPeople: { type: 'integer', example: 2 },
                  date: { type: 'string', example: '2026-07-20' },
                  timeSlot: { type: 'string', example: '10:00 AM' },
                  tipType: { type: 'string', example: '15%' },
                  tipAmount: { type: 'number', example: 0 },
                  promoCode: { type: 'string', example: 'SAVE10' },
                  voucherCode: { type: 'string', example: 'SAVE10' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Booking created successfully' }
        }
      }
    },
    '/providers/bookings': {
      get: {
        tags: ['Booking & Order Summary'],
        summary: 'List Bookings for Provider',
        responses: {
          200: { description: 'Success' }
        }
      }
    },
    '/providers/me/licence': {
      put: {
        tags: ['Providers Profile'],
        summary: 'Update Provider License/Certificate by Index',
        description: 'Updates the license name and/or certificate file/URL at a specific array index.',
        parameters: [
          {
            name: 'index',
            in: 'query',
            required: true,
            description: 'Index of the license/certificate to update',
            schema: {
              type: 'integer',
            },
          },
        ],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  licenseType: {
                    type: 'string',
                    example: 'Cosmetology License',
                  },
                  certificate: {
                    type: 'string',
                    format: 'binary',
                    description: 'Upload certificate file (image or PDF)',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'License/certificate updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                    },
                    message: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized access',
          },
          403: {
            description: 'Forbidden: Requires provider role',
          },
        },
      },
      delete: {
        tags: ['Providers Profile'],
        summary: 'Delete Provider License/Certificate by Index',
        description: 'Deletes the license name and certificate URL at a specific array index.',
        parameters: [
          {
            name: 'index',
            in: 'query',
            required: true,
            description: 'Index of the license/certificate to delete',
            schema: {
              type: 'integer',
            },
          },
        ],
        responses: {
          200: {
            description: 'License/certificate deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                    },
                    message: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized access',
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
                  licenseName: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of license names/types (e.g. Cosmetology License, Barber License)',
                    example: ['Cosmetology License', 'Barber License']
                  },
                  certificate: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                    description: 'Uploaded certificate files (PDF or Image only)'
                  },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                required: ['experience'],
                properties: {
                  experience: { type: 'integer', example: 8 },
                  licenses: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        licenseName: { type: 'string', example: 'Cosmetology License' },
                        certificateUrl: { type: 'string', example: 'https://...' }
                      }
                    },
                    example: [
                      { "licenseName": "Cosmetology License", "certificateUrl": "https://..." },
                      { "licenseName": "Barber License", "certificateUrl": "https://..." }
                    ]
                  },
                  licenseType: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['Cosmetology License', 'Barber License']
                  },
                  certificateUrl: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['https://...', 'https://...']
                  }
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
    '/clients/reviews': {
      post: {
        tags: ['Reviews & Ratings'],
        summary: 'Submit Rating & Review for Provider',
        description: 'Submits a 1-5 star rating and optional text review message for a provider and optional service. Updates provider rating in real-time.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['providerId', 'rating'],
                properties: {
                  providerId: { type: 'integer', example: 2, description: 'Provider User ID' },
                  serviceId: { type: 'integer', example: 1, nullable: true, description: 'Optional Service ID' },
                  rating: { type: 'integer', minimum: 1, maximum: 5, example: 5, description: 'Rating score from 1 to 5' },
                  comment: { type: 'string', example: 'Excellent haircut and great attention to detail!', description: 'Optional review text' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Review submitted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    review: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        clientId: { type: 'integer' },
                        providerId: { type: 'integer' },
                        rating: { type: 'integer' },
                        comment: { type: 'string' },
                        createdAt: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          400: { description: 'Missing required fields' },
          401: { description: 'Unauthorized access' }
        }
      }
    },
    '/app-version': {
      get: {
        tags: ['Settings & FAQ, CMS Page'],
        summary: 'Get Mobile App Current Version Requirements',
        description: 'Returns required Android/iOS versions for mobile app.',
        responses: {
          200: {
            description: 'App version requirements retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    androidVersion: { type: 'string', example: '1.2.0' },
                    iosVersion: { type: 'string', example: '1.2.0' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/clients/promocodes': {
      get: {
        tags: ['Settings & FAQ, CMS Page'],
        summary: 'Get List of Active Promo / Voucher Codes',
        description: 'Returns list of active promotional discount codes available for clients.',
        responses: {
          200: {
            description: 'Promo codes retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer', example: 1 },
                      code: { type: 'string', example: 'WELCOME10' },
                      title: { type: 'string', example: '$10 Off First Order' },
                      amount: { type: 'number', example: 10.0 },
                      isActive: { type: 'boolean', example: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/cms/{slug}': {
      get: {
        tags: ['Settings & FAQ, CMS Page'],
        summary: 'Get CMS Legal Page Content by Slug',
        description: 'Fetches HTML text content and structured Q&A data for legal, policy, and FAQ pages.',
        parameters: [
          {
            name: 'slug',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              enum: [
                'terms',
                'privacy-policy',
                'refund-policy',
                'client-payment-policy',
                'provider-payment-policy',
                'client-faqs',
                'provider-faqs',
                'community-guidelines'
              ],
              example: 'terms'
            },
            description: 'CMS page slug identifier (e.g. terms, client-faqs, provider-faqs, privacy-policy)'
          }
        ],
        responses: {
          200: {
            description: 'CMS page content retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    slug: { type: 'string', example: 'client-faqs' },
                    title: { type: 'string', example: 'Client FAQ' },
                    contentType: { type: 'string', enum: ['html', 'array'], example: 'array', description: 'Content format type: "html" for HTML string or "array" for JSON array' },
                    content: {
                      oneOf: [
                        { type: 'string', example: '<h1>Terms & Conditions</h1>...' },
                        {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              question: { type: 'string', example: 'How do I book an appointment?' },
                              answer: { type: 'string', example: 'Select a salon or freelancer, choose your service and time slot, then confirm booking.' }
                            }
                          }
                        }
                      ]
                    },
                    updatedAt: { type: 'string', format: 'date-time' },
                    createdAt: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          },
          404: { description: 'CMS page not found' }
        }
      }
    },
    '/reports': {
      post: {
        tags: ['Report & Issues'],
        summary: 'Submit App Feedback or Issue Report',
        description: 'Allows user to submit app feedback or bug reports with optional file attachments via multipart form-data or JSON.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['title', 'message'],
                properties: {
                  title: { type: 'string', example: 'App Crashes on Checkout' },
                  message: { type: 'string', example: 'When I tap confirm booking, the app closes unexpectedly.' },
                  attachments: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                    description: 'Optional screenshot files (PNG/JPG)'
                  }
                }
              }
            },
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'message'],
                properties: {
                  title: { type: 'string', example: 'Payment Failure' },
                  message: { type: 'string', example: 'Card transaction fails repeatedly.' },
                  attachments: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['https://.../screenshot.png']
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Report submitted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    report: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        title: { type: 'string' },
                        message: { type: 'string' },
                        attachments: { type: 'string', example: '["/uploads/reports/report_12345.png"]' },
                        status: { type: 'string', example: 'open' },
                        createdAt: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          400: { description: 'Title and message are required' }
        }
      },
      get: {
        tags: ['Report & Issues'],
        summary: 'Get User Submitted Issue Reports',
        description: 'Returns issue reports filterable by status (open/closed).',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['open', 'closed'], example: 'open' },
            description: 'Filter reports by status'
          }
        ],
        responses: {
          200: { description: 'Reports list retrieved successfully' }
        }
      }
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
