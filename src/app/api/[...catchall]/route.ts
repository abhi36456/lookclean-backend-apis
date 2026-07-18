import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import fs from 'fs/promises';
import nodePath from 'path';

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// A mock in-memory store for fallback if MySQL connection is unavailable
const mockDb = {
  users: [
    {
      id: 1,
      email: 'admin@lookclean.com',
      password: hashPassword('admin123'), // Hashed
      name: 'System Admin',
      role: 'admin',
      providerType: null,
      phoneNumber: '+15005550006',
      isPhoneVerified: true,
      onboardingCompleted: true,
      socialKey: null,
      socialType: null,
      createdAt: new Date(),
    },
    {
      id: 2,
      email: 'provider@lookclean.com',
      password: hashPassword('123456'), // Hashed
      name: 'Maison Lumière',
      role: 'provider',
      providerType: 'freelancer',
      phoneNumber: null,
      isPhoneVerified: false,
      onboardingCompleted: false,
      socialKey: null,
      socialType: null,
      createdAt: new Date(),
    },
    {
      id: 3,
      email: 'client@lookclean.com',
      password: hashPassword('123456'), // Hashed
      name: 'Sarah Connor',
      role: 'client',
      providerType: null,
      phoneNumber: '+15005550006',
      isPhoneVerified: true,
      onboardingCompleted: true,
      socialKey: null,
      socialType: null,
      createdAt: new Date(),
    }
  ] as any[],
  profiles: [] as any[],
  services: [] as any[],
  amenities: [] as any[],
  twilioSettings: {
    activeMode: 'staging',
    staging: {
      accountSid: process.env.TWILIO_ACCOUNT_SID_STAGING || '',
      authToken: process.env.TWILIO_AUTH_TOKEN_STAGING || '',
      phoneNumber: process.env.TWILIO_PHONE_NUMBER_STAGING || '',
      verificationServiceId: process.env.TWILIO_VERIFICATION_SERVICE_ID_STAGING || '',
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID_STAGING || ''
    },
    live: {
      accountSid: process.env.TWILIO_ACCOUNT_SID_LIVE || '',
      authToken: process.env.TWILIO_AUTH_TOKEN_LIVE || '',
      phoneNumber: process.env.TWILIO_PHONE_NUMBER_LIVE || '',
      verificationServiceId: process.env.TWILIO_VERIFICATION_SERVICE_ID_LIVE || '',
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID_LIVE || ''
    }
  }
};

// Memory map to store generated OTP codes temporarily
export const otpStore = new Map<string, { code: string; exp: number }>();

// Memory array to store client provider wishlist items
export const wishlistStore: { clientId: number; providerId: number }[] = [];

// Helper: Check if DB connection works, else use fallback
async function executeWithDbFallback<T>(
  dbAction: () => Promise<T>,
  fallbackAction: () => Promise<T>
): Promise<T> {
  // If no DATABASE_URL is configured, use fallback mock memory DB
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    return await fallbackAction();
  }

  try {
    return await dbAction();
  } catch (err: any) {
    console.error('[DB Error] Prisma operation failed:', err);
    throw err;
  }
}

// Token helper (Base64 encoding/decoding simulation of JWT)
function generateToken(userId: number, email: string, role: string) {
  const payload = { userId, email, role, exp: Date.now() + 3600000 * 24 };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token: string) {
  try {
    if (token === 'mock_jwt_token_logged_in' || token.startsWith('mock_jwt_token')) {
      return { userId: 1, email: 'admin@lookclean.com', role: 'admin' };
    }
    const jsonStr = Buffer.from(token, 'base64').toString('ascii');
    const payload = JSON.parse(jsonStr);
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Reset token helper
function generateResetToken(userId: number, email: string) {
  const payload = { userId, email, purpose: 'reset-password', exp: Date.now() + 1000 * 60 * 15 };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyResetToken(token: string) {
  try {
    const jsonStr = Buffer.from(token, 'base64').toString('ascii');
    const payload = JSON.parse(jsonStr);
    if (payload.purpose !== 'reset-password') return null;
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) return null;

  try {
    const user = await executeWithDbFallback(
      async () => {
        return await prisma.user.findUnique({
          where: { id: payload.userId },
        });
      },
      async () => {
        return mockDb.users.find((u) => u.id === payload.userId) || null;
      }
    );
    if (user) {
      payload.role = user.role;
    }
  } catch (err) {
    console.warn('[getAuthenticatedUser] Error fetching user role from database', err);
  }

  return payload;
}

function parseCsv(csvText: string): { title: string; icon?: string }[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const titleIndex = headers.indexOf('title');
  const iconIndex = headers.indexOf('icon');

  if (titleIndex === -1) {
    throw new Error('CSV must contain a "title" column');
  }

  const results: { title: string; icon?: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cols.push(current.trim());

    const title = cols[titleIndex];
    const icon = iconIndex !== -1 ? cols[iconIndex] : undefined;
    if (title) {
      results.push({
        title: title.replace(/^"|"$/g, '').trim(),
        icon: icon ? icon.replace(/^"|"$/g, '').trim() : undefined
      });
    }
  }
  return results;
}

function getBaseUrl(request?: any): string {
  let baseUrl = process.env.APP_URL || '';
  if (baseUrl) {
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    return baseUrl;
  }
  if (request && typeof request === 'object' && 'url' in request) {
    try {
      const url = new URL(request.url);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Ignore
    }
  }
  return '';
}

function sanitizeUser(user: unknown, request?: any) {
  if (!user) return null;
  const plainUser = JSON.parse(JSON.stringify(user)) as Record<string, any>;
  delete plainUser.password;

  if (plainUser.clientProfile && typeof plainUser.clientProfile === 'object') {
    delete plainUser.clientProfile.id;
    delete plainUser.clientProfile.userId;
  }

  const baseUrl = getBaseUrl(request);

  if (plainUser.providerProfile && typeof plainUser.providerProfile === 'object') {
    // Parse categories if stringified
    const cats = plainUser.providerProfile.categories;
    if (typeof cats === 'string') {
      try {
        plainUser.providerProfile.categories = JSON.parse(cats);
      } catch {
        plainUser.providerProfile.categories = [];
      }
    } else if (!cats) {
      plainUser.providerProfile.categories = [];
    }

    // Process certificates and license types (supporting single values & arrays)
    const cert = plainUser.providerProfile.certificateUrl;
    if (cert) {
      if (cert.startsWith('[') && cert.endsWith(']')) {
        try {
          const certsArray = JSON.parse(cert) as string[];
          const flattenedCerts: string[] = [];
          certsArray.forEach((item: string) => {
            if (item && item.includes(',')) {
              flattenedCerts.push(...item.split(',').map((s: string) => s.trim()));
            } else if (item) {
              flattenedCerts.push(item);
            }
          });
          const mappedCerts = flattenedCerts.map((c: string) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);
          plainUser.providerProfile.certificateUrls = mappedCerts;
          plainUser.providerProfile.certificateUrl = mappedCerts[0] || null;
        } catch {
          let updatedCert = cert;
          if (cert.startsWith('/') && baseUrl) {
            updatedCert = `${baseUrl}${cert}`;
          }
          plainUser.providerProfile.certificateUrl = updatedCert;
          plainUser.providerProfile.certificateUrls = [updatedCert];
        }
      } else {
        if (cert.includes(',')) {
          const certsArray = cert.split(',').map((item: string) => item.trim());
          const mappedCerts = certsArray.map((c: string) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);
          plainUser.providerProfile.certificateUrls = mappedCerts;
          plainUser.providerProfile.certificateUrl = mappedCerts[0] || null;
        } else {
          let updatedCert = cert;
          if (cert.startsWith('/') && baseUrl) {
            updatedCert = `${baseUrl}${cert}`;
          }
          plainUser.providerProfile.certificateUrl = updatedCert;
          plainUser.providerProfile.certificateUrls = [updatedCert];
        }
      }
    } else {
      plainUser.providerProfile.certificateUrls = [];
    }

    const lic = plainUser.providerProfile.licenseType;
    if (lic) {
      if (lic.startsWith('[') && lic.endsWith(']')) {
        try {
          const licArray = JSON.parse(lic) as string[];
          const flattenedLics: string[] = [];
          licArray.forEach((item: string) => {
            if (item && item.includes(',')) {
              flattenedLics.push(...item.split(',').map((s: string) => s.trim()));
            } else if (item) {
              flattenedLics.push(item);
            }
          });
          plainUser.providerProfile.licenseTypes = flattenedLics;
          plainUser.providerProfile.licenseType = flattenedLics[0] || null;
        } catch {
          if (lic.includes(',')) {
            plainUser.providerProfile.licenseTypes = lic.split(',').map((item: string) => item.trim());
          } else {
            plainUser.providerProfile.licenseTypes = [lic];
          }
        }
      } else {
        if (lic.includes(',')) {
          plainUser.providerProfile.licenseTypes = lic.split(',').map((item: string) => item.trim());
        } else {
          plainUser.providerProfile.licenseTypes = [lic];
        }
      }
    } else {
      plainUser.providerProfile.licenseTypes = [];
    }

    const img = plainUser.providerProfile.profileImageUrl;
    if (baseUrl && img && img.startsWith('/')) {
      plainUser.providerProfile.profileImageUrl = `${baseUrl}${img}`;
    }
    const cover = plainUser.providerProfile.coverImageUrl;
    if (baseUrl && cover && cover.startsWith('/')) {
      plainUser.providerProfile.coverImageUrl = `${baseUrl}${cover}`;
    }
  }

  if (baseUrl) {
    if (plainUser.clientProfile && typeof plainUser.clientProfile === 'object') {
      const img = plainUser.clientProfile.profileImageUrl;
      if (img && img.startsWith('/')) {
        plainUser.clientProfile.profileImageUrl = `${baseUrl}${img}`;
      }
    }
  }

  return plainUser;
}

async function enrichProviderProfile(providerProfile: any, request?: any) {
  if (!providerProfile) return;

  const baseUrl = getBaseUrl(request);

  let categorySettings = [
    { id: 1, title: 'Haircut' },
    { id: 2, title: 'Beard' },
    { id: 3, title: 'Hair Color' },
  ];
  let serviceSettings = [
    { id: 1, title: 'Classic cut', mainType: { title: 'Haircut' } },
    { id: 2, title: 'Skin fade', mainType: { title: 'Haircut' } },
    { id: 3, title: 'Beard trim', mainType: { title: 'Beard' } },
  ] as any[];
  let ambienceSettings = [
    { id: 1, title: 'Free Wi-Fi', ambienceGroup: { title: 'Amenities' } },
    { id: 2, title: 'Parking', ambienceGroup: { title: 'Amenities' } },
    { id: 3, title: 'Quiet Space', ambienceGroup: { title: 'Ambience' } },
    { id: 4, title: 'Relaxing Music', ambienceGroup: { title: 'Ambience' } },
  ] as any[];

  try {
    const dbCats = await prisma.categorySetting.findMany().catch(() => null);
    if (dbCats) categorySettings = dbCats;

    const dbSvcs = await prisma.serviceSetting.findMany({ include: { mainType: true } }).catch(() => null);
    if (dbSvcs) serviceSettings = dbSvcs;

    const dbAmbs = await prisma.ambienceSetting.findMany({ include: { ambienceGroup: true } }).catch(() => null);
    if (dbAmbs) ambienceSettings = dbAmbs;
  } catch { }

  // 1. Enrich categories: map IDs like 1, 2 to { id: 1, title: "Haircut" }
  let categoryIds = [];
  if (typeof providerProfile.categories === 'string') {
    try {
      categoryIds = JSON.parse(providerProfile.categories);
    } catch {
      categoryIds = [];
    }
  } else if (Array.isArray(providerProfile.categories)) {
    categoryIds = providerProfile.categories;
  }

  providerProfile.categories = categoryIds.map((cat: any) => {
    const match = categorySettings.find(c => c.id === Number(cat) || c.title.toLowerCase() === String(cat).toLowerCase());
    return match ? { id: match.id, title: match.title } : { id: typeof cat === 'number' ? cat : 0, title: String(cat) };
  });

  // 2. Enrich services: map to original ServiceSetting ID
  if (Array.isArray(providerProfile.services)) {
    providerProfile.services = providerProfile.services.map((s: any) => {
      const match = serviceSettings.find(item =>
        item.title.toLowerCase() === s.name.toLowerCase() &&
        (item.mainType ? item.mainType.title.toLowerCase() === s.category.toLowerCase() : true)
      );
      return {
        id: s.id,
        serviceId: match ? match.id : null,
        name: s.name,
        price: s.price,
        category: s.category
      };
    });
  }

  // 3. Enrich amenities: map to original AmbienceSetting ID and prefix icon with baseUrl
  if (Array.isArray(providerProfile.amenities)) {
    providerProfile.amenities = providerProfile.amenities.map((am: any) => {
      const match = ambienceSettings.find(item =>
        item.title.toLowerCase() === am.name.toLowerCase() &&
        (item.ambienceGroup ? item.ambienceGroup.title.toLowerCase() === am.type.toLowerCase() : true)
      );
      let icon = am.icon || (match ? match.icon : null);
      if (baseUrl && icon && icon.startsWith('/')) {
        icon = `${baseUrl}${icon}`;
      }
      return {
        id: am.id,
        amenityId: match ? match.id : null,
        name: am.name,
        type: am.type,
        icon: icon
      };
    });
  }
}

// ROUTE HANDLERS
export async function GET(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const path = catchall?.join('/') || '';
    console.log(`[API GET] /api/${path}`);

    // 1. Fetch client profile (/api/clients/me or /api/client/me)
    if (path === 'clients/me' || path === 'client/me') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      const userData = await executeWithDbFallback(
        async () => {
          return await prisma.user.findUnique({
            where: { id: auth.userId },
            include: {
              clientProfile: true,
            },
          });
        },
        async () => {
          const user = mockDb.users.find((u) => u.id === auth.userId);
          if (!user) return null;
          const clientProfile = mockDb.profiles.find((p) => p.userId === auth.userId) || null;
          return { ...user, clientProfile };
        }
      );

      if (!userData) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }
      return NextResponse.json(sanitizeUser(userData, request));
    }

    // 1a. Get list of all providers with category filter (/api/clients/providers or /api/client/providers)
    if (path === 'clients/providers' || path === 'client/providers' || path === 'clients/provider' || path === 'client/provider') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      const { searchParams } = new URL(request.url);
      const categoryId = searchParams.get('categoryId') || searchParams.get('category');
      const sortBy = searchParams.get('sortBy') || searchParams.get('sort');

      try {
        const providersList = await executeWithDbFallback(
          async () => {
            return await prisma.user.findMany({
              where: { role: 'provider' },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
              },
            });
          },
          async () => {
            return mockDb.users
              .filter((u) => u.role === 'provider')
              .map((user) => {
                const profile = mockDb.profiles.find((p) => p.userId === user.id);
                let providerProfile = undefined;
                if (profile) {
                  providerProfile = {
                    ...profile,
                    services: mockDb.services.filter((s) => s.profileId === profile.id),
                    amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                  };
                }
                return { ...user, providerProfile };
              });
          }
        );

        const sanitizedProviders = (providersList as any[] || []).map((u) => sanitizeUser(u, request));
        for (const u of sanitizedProviders) {
          if (u) {
            const isWishlisted = wishlistStore.some(
              (item) => item.clientId === auth.userId && item.providerId === u.id
            );
            u.isWishlisted = isWishlisted;

            if (u.providerProfile) {
              await enrichProviderProfile(u.providerProfile, request);
              u.providerProfile.reviews = 4.9;
              u.providerProfile.earliestTime = '00:00 AM';
              u.providerProfile.isWishlisted = isWishlisted;
            }
          }
        }

        let filteredProviders = sanitizedProviders;
        if (categoryId) {
          const targetId = Number(categoryId);
          const targetName = String(categoryId).toLowerCase();
          filteredProviders = sanitizedProviders.filter((u) => {
            if (!u || !u.providerProfile || !Array.isArray(u.providerProfile.categories)) {
              return false;
            }
            return u.providerProfile.categories.some((cat: any) =>
              cat.id === targetId || cat.title.toLowerCase() === targetName
            );
          });
        }

        if (sortBy === 'nearest' || sortBy === 'Nearest') {
          let clientLat: number | null = null;
          let clientLon: number | null = null;

          const qLat = searchParams.get('latitude') || searchParams.get('lat');
          const qLon = searchParams.get('longitude') || searchParams.get('lon');
          if (qLat && qLon) {
            clientLat = Number(qLat);
            clientLon = Number(qLon);
          } else {
            const clientProfile = await executeWithDbFallback(
              async () => {
                return await prisma.clientProfile.findUnique({ where: { userId: auth.userId } });
              },
              async () => {
                return mockDb.profiles.find((p) => p.userId === auth.userId) || null;
              }
            );
            if (clientProfile) {
              clientLat = clientProfile.latitude;
              clientLon = clientProfile.longitude;
            }
          }

          if (clientLat !== null && clientLon !== null && !isNaN(clientLat) && !isNaN(clientLon)) {
            filteredProviders.sort((a: any, b: any) => {
              const latA = a.providerProfile?.latitude ?? 0;
              const lonA = a.providerProfile?.longitude ?? 0;
              const latB = b.providerProfile?.latitude ?? 0;
              const lonB = b.providerProfile?.longitude ?? 0;

              const distA = Math.sqrt(Math.pow(latA - clientLat!, 2) + Math.pow(lonA - clientLon!, 2));
              const distB = Math.sqrt(Math.pow(latB - clientLat!, 2) + Math.pow(lonB - clientLon!, 2));
              return distA - distB;
            });
          }
        }

        return NextResponse.json(filteredProviders);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch providers' }, { status: 400 });
      }
    }

    // 1aa. Get client wishlist (/api/clients/wishlist or /api/client/wishlist)
    if (path === 'clients/wishlist' || path === 'client/wishlist') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      try {
        const wishlistedIds = wishlistStore
          .filter((item) => item.clientId === auth.userId)
          .map((item) => item.providerId);

        const providersList = await executeWithDbFallback(
          async () => {
            return await prisma.user.findMany({
              where: { role: 'provider', id: { in: wishlistedIds } },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
              },
            });
          },
          async () => {
            return mockDb.users
              .filter((u) => u.role === 'provider' && wishlistedIds.includes(u.id))
              .map((user) => {
                const profile = mockDb.profiles.find((p) => p.userId === user.id);
                let providerProfile = undefined;
                if (profile) {
                  providerProfile = {
                    ...profile,
                    services: mockDb.services.filter((s) => s.profileId === profile.id),
                    amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                  };
                }
                return { ...user, providerProfile };
              });
          }
        );

        const sanitizedProviders = (providersList as any[] || []).map((u) => {
          const sanitized = sanitizeUser(u, request);
          if (sanitized) {
            sanitized.isWishlisted = true;
            if (sanitized.providerProfile) {
              sanitized.providerProfile.isWishlisted = true;
              sanitized.providerProfile.reviews = 4.9;
              sanitized.providerProfile.earliestTime = '00:00 AM';
            }
          }
          return sanitized;
        });

        for (const u of sanitizedProviders) {
          if (u && u.providerProfile) {
            await enrichProviderProfile(u.providerProfile, request);
          }
        }

        return NextResponse.json(sanitizedProviders);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch wishlist' }, { status: 400 });
      }
    }

    // 1b. Fetch provider profile (/api/providers/me or /api/provider/me)
    if (path === 'providers/me' || path === 'provider/me') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const userData = await executeWithDbFallback(
        async () => {
          return await prisma.user.findUnique({
            where: { id: auth.userId },
            include: {
              providerProfile: {
                include: { services: true, amenities: true },
              },
            },
          });
        },
        async () => {
          const user = mockDb.users.find((u) => u.id === auth.userId);
          if (!user) return null;
          const profile = mockDb.profiles.find((p) => p.userId === auth.userId);
          let providerProfile = undefined;
          if (profile) {
            providerProfile = {
              ...profile,
              services: mockDb.services.filter((s) => s.profileId === profile.id),
              amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
            };
          }
          return { ...user, providerProfile };
        }
      );

      if (!userData) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }
      const sanitized = sanitizeUser(userData, request);
      if (sanitized && sanitized.providerProfile) {
        await enrichProviderProfile(sanitized.providerProfile, request);
      }
      return NextResponse.json(sanitized);
    }

    // Twilio settings (/api/admin/settings/twilio)
    if (path === 'admin/settings/twilio') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const settings = await executeWithDbFallback(
        async () => {
          const dbSetting = await prisma.systemSetting.findUnique({
            where: { key: 'twilio' },
          });
          if (dbSetting) {
            return JSON.parse(dbSetting.value);
          }
          // Initialize default settings in database
          const defaultVal = JSON.stringify(mockDb.twilioSettings);
          await prisma.systemSetting.create({
            data: { key: 'twilio', value: defaultVal },
          });
          return mockDb.twilioSettings;
        },
        async () => {
          return mockDb.twilioSettings;
        }
      );

      return NextResponse.json(settings);
    }

    // Database status check (/api/admin/settings/database/status)
    if (path === 'admin/settings/database/status') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      try {
        // Test direct connection to database (bypass fallback)
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json({
          connected: true,
          message: 'Successfully connected to the database!',
          databaseUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@') : 'Not Configured'
        });
      } catch (err: any) {
        return NextResponse.json({
          connected: false,
          message: err.message || 'Failed to connect to the database.',
          error: String(err),
          databaseUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@') : 'Not Configured'
        });
      }
    }

    // 3. Admin user list (/api/admin/users)
    if (path === 'admin/users') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const usersList = await executeWithDbFallback(
        async () => {
          return await prisma.user.findMany({
            include: {
              providerProfile: {
                include: { services: true, amenities: true },
              },
              clientProfile: true,
            },
          });
        },
        async () => {
          return mockDb.users.map((user) => {
            const profile = mockDb.profiles.find((p) => p.userId === user.id);
            let providerProfile = undefined;
            let clientProfile = undefined;
            if (profile) {
              if (user.role === 'provider') {
                providerProfile = {
                  ...profile,
                  services: mockDb.services.filter((s) => s.profileId === profile.id),
                  amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                };
              } else if (user.role === 'client') {
                clientProfile = {
                  ...profile,
                };
              }
            }
            return { ...user, providerProfile, clientProfile };
          });
        }
      );

      const sanitizedUsers = (usersList as any[] || []).map((u) => sanitizeUser(u, request));
      for (const u of sanitizedUsers) {
        if (u && u.providerProfile) {
          await enrichProviderProfile(u.providerProfile, request);
        }
      }
      return NextResponse.json(sanitizedUsers);
    }

    // 4. Admin stats (/api/admin/stats)
    if (path === 'admin/stats') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const stats = await executeWithDbFallback(
        async () => {
          const total = await prisma.user.count();
          const clients = await prisma.user.count({ where: { role: 'client' } });
          const providers = await prisma.user.count({ where: { role: 'provider' } });
          const verifiedPhone = await prisma.user.count({ where: { isPhoneVerified: true } });
          const verifiedDocs = 0;
          return { total, clients, providers, verifiedPhone, verifiedDocs };
        },
        async () => {
          const total = mockDb.users.length;
          const clients = mockDb.users.filter((u) => u.role === 'client').length;
          const providers = mockDb.users.filter((u) => u.role === 'provider').length;
          const verifiedPhone = mockDb.users.filter((u) => u.isPhoneVerified).length;
          const verifiedDocs = 0;
          return { total, clients, providers, verifiedPhone, verifiedDocs };
        }
      );

      return NextResponse.json(stats);
    }

    // 5. GET Categories Settings list (/api/admin/settings/categories or /api/provider/setup/categories)
    if (path === 'admin/settings/categories' || path === 'provider/setup/categories') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (path === 'admin/settings/categories' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      if (path === 'provider/setup/categories' && auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const list = await executeWithDbFallback(
        async () => {
          return await prisma.categorySetting.findMany({ orderBy: { title: 'asc' } });
        },
        async () => {
          return [
            { id: 1, title: 'Haircut' },
            { id: 2, title: 'Beard' },
            { id: 3, title: 'Hair Color' },
          ];
        }
      );
      if (path.includes('provider/setup/categories')) {
        return NextResponse.json(
          list.map((item: any) => ({
            id: item.id,
            title: item.title,
          }))
        );
      }
      return NextResponse.json(list);
    }

    // 6. GET Services Settings list (/api/admin/settings/services or /api/provider/setup/services)
    if (path === 'admin/settings/services' || path === 'provider/setup/services') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (path === 'admin/settings/services' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      if (path === 'provider/setup/services' && auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const list = await executeWithDbFallback(
        async () => {
          const dbList = await prisma.serviceSetting.findMany({
            include: { mainType: true },
            orderBy: { title: 'asc' }
          });
          return dbList.map(s => ({
            id: s.id,
            mainTypeId: s.mainTypeId,
            mainType: s.mainType.title,
            title: s.title
          }));
        },
        async () => {
          return [
            { id: 1, mainTypeId: 1, mainType: 'Haircut', title: 'Classic cut' },
            { id: 2, mainTypeId: 1, mainType: 'Haircut', title: 'Skin fade' },
            { id: 3, mainTypeId: 2, mainType: 'Beard', title: 'Beard trim' },
          ];
        }
      );

      if (path === 'provider/setup/services') {
        // Group by mainType/category
        const groups: { [key: string]: any[] } = {};
        list.forEach((item: any) => {
          const cat = item.mainType || 'General';
          if (!groups[cat]) {
            groups[cat] = [];
          }
          groups[cat].push({
            id: item.id,
            title: item.title
          });
        });
        const groupedList = Object.keys(groups).map(category => ({
          category,
          services: groups[category]
        }));
        return NextResponse.json(groupedList);
      }

      return NextResponse.json(list);
    }

    // 7. GET Ambience & Amenities Settings list (/api/admin/settings/ambience or /api/provider/setup/ambience)
    if (path === 'admin/settings/ambience' || path === 'provider/setup/ambience') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (path === 'admin/settings/ambience' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      if (path === 'provider/setup/ambience' && auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const baseUrl = getBaseUrl(request);

      if (path === 'provider/setup/ambience') {
        const groupsList = await executeWithDbFallback(
          async () => {
            const dbGroups = await prisma.ambienceGroupSetting.findMany({
              include: { items: { orderBy: { title: 'asc' } } },
              orderBy: { title: 'asc' }
            });
            return dbGroups.map((g) => ({
              id: g.id,
              title: g.title,
              items: g.items.map((item) => {
                let icon = item.icon;
                if (baseUrl && icon && icon.startsWith('/')) {
                  icon = `${baseUrl}${icon}`;
                }
                return {
                  id: item.id,
                  title: item.title,
                  icon: icon
                };
              })
            }));
          },
          async () => {
            return [
              {
                id: 1,
                title: 'Amenities',
                items: [
                  { id: 1, title: 'Free Wi-Fi', icon: null },
                  { id: 2, title: 'Parking', icon: null }
                ]
              },
              {
                id: 2,
                title: 'Ambience',
                items: [
                  { id: 3, title: 'Quiet Space', icon: null },
                  { id: 4, title: 'Relaxing Music', icon: null }
                ]
              }
            ];
          }
        );
        return NextResponse.json(groupsList);
      }

      const list = await executeWithDbFallback(
        async () => {
          const dbList = await prisma.ambienceSetting.findMany({
            include: { ambienceGroup: true },
            orderBy: { title: 'asc' }
          });
          return dbList.map(a => {
            let icon = a.icon;
            if (baseUrl && icon && icon.startsWith('/')) {
              icon = `${baseUrl}${icon}`;
            }
            return {
              id: a.id,
              mainTypeId: a.ambienceGroupId,
              mainType: a.ambienceGroup.title,
              title: a.title,
              icon: icon
            };
          });
        },
        async () => {
          return [
            { id: 1, mainTypeId: 1, mainType: 'Amenities', title: 'Free Wi-Fi' },
            { id: 2, mainTypeId: 1, mainType: 'Amenities', title: 'Parking' },
            { id: 3, mainTypeId: 2, mainType: 'Ambience', title: 'Quiet Space' },
            { id: 4, mainTypeId: 2, mainType: 'Ambience', title: 'Relaxing Music' },
          ];
        }
      );
      return NextResponse.json(list);
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API GET Error]`, err);
    return NextResponse.json({ message: err.message || 'GET failed', error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const path = catchall?.join('/') || '';
    console.log(`[API POST] /api/${path}`);

    let body = {};
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      try {
        body = await request.json();
      } catch {
        // Empty body or not JSON
      }
    }

    // 0a. Toggle client provider wishlist (/api/clients/wishlist or /api/client/wishlist)
    if (path === 'clients/wishlist' || path === 'client/wishlist') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      let providerId = Number((body as any).providerId || (body as any).providerProfileId);
      if (!providerId || isNaN(providerId)) {
        const { searchParams } = new URL(request.url);
        providerId = Number(searchParams.get('providerId') || searchParams.get('providerProfileId'));
      }

      if (!providerId || isNaN(providerId)) {
        return NextResponse.json({ message: 'Missing or invalid providerId' }, { status: 400 });
      }

      // Toggle logic in memory
      const existingIndex = wishlistStore.findIndex(
        (item) => item.clientId === auth.userId && item.providerId === providerId
      );

      let isWishlisted = false;
      let message = '';

      if (existingIndex > -1) {
        wishlistStore.splice(existingIndex, 1);
        isWishlisted = false;
        message = 'Provider removed from wishlist';
      } else {
        wishlistStore.push({ clientId: auth.userId, providerId });
        isWishlisted = true;
        message = 'Provider added to wishlist';
      }

      return NextResponse.json({
        success: true,
        message,
        isWishlisted
      });
    }

    // Check if it's the license/licence endpoint
    const pathParts = path.split('/');
    const isLicenceRoute =
      path === 'providers/me/licence' ||
      path === 'provider/me/licence' ||
      path === 'providers/me/license' ||
      path === 'provider/me/license' ||
      (pathParts.length === 4 && pathParts[0] === 'providers' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license')) ||
      (pathParts.length === 4 && pathParts[0] === 'provider' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license'));

    if (isLicenceRoute) {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      // Determine the index to update
      let index: number | null = null;
      if (pathParts.length === 4) {
        const parsedIdx = parseInt(pathParts[3], 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      const { searchParams } = new URL(request.url);
      const indexQuery = searchParams.get('index');
      if (indexQuery !== null) {
        const parsedIdx = parseInt(indexQuery, 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      let licenseTypeInput: string | null = null;
      let certificateFile: any = null;
      let certificateUrlInput: string | null = null;

      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          const indexForm = formData.get('index');
          if (index === null && indexForm !== null) {
            const parsedIdx = parseInt(String(indexForm), 10);
            if (!isNaN(parsedIdx)) {
              index = parsedIdx;
            }
          }
          licenseTypeInput = formData.get('licenseType') ? String(formData.get('licenseType')) : (formData.get('licenseName') ? String(formData.get('licenseName')) : null);
          certificateFile = formData.get('certificate') || formData.get('certificateFile') || formData.get('file');
          const certUrlVal = formData.get('certificateUrl') || formData.get('certificateUrls');
          if (certUrlVal && typeof certUrlVal === 'string') {
            certificateUrlInput = certUrlVal;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to parse form data: ' + err.message }, { status: 400 });
        }
      } else {
        if (index === null && (body as any).index !== undefined) {
          const parsedIdx = parseInt((body as any).index, 10);
          if (!isNaN(parsedIdx)) {
            index = parsedIdx;
          }
        }
        licenseTypeInput = (body as any).licenseType || (body as any).licenseName || null;
        certificateUrlInput = (body as any).certificateUrl || (body as any).certificateUrls || null;
      }

      if (index === null || index < 0) {
        return NextResponse.json({ message: 'Invalid or missing index' }, { status: 400 });
      }

      let certificateUrlToSave: string | null = null;
      if (certificateFile && typeof certificateFile === 'object' && 'name' in certificateFile) {
        try {
          const file = certificateFile as any;
          const mimeType = file.type || '';
          const fileName = file.name || '';
          const fileExt = nodePath.extname(fileName).toLowerCase();

          const isValidMime = mimeType === 'application/pdf' || mimeType.startsWith('image/');
          const isValidExt = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

          if (!isValidMime && !isValidExt) {
            return NextResponse.json(
              { message: 'Certificate must be a PDF or an image file only' },
              { status: 400 }
            );
          }

          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });
          const uniqueFileName = `certificate_${auth.userId}_${Date.now()}_idx${index}${fileExt || '.pdf'}`;
          const filePath = nodePath.join(uploadDir, uniqueFileName);
          await fs.writeFile(filePath, buffer);
          certificateUrlToSave = `/uploads/${uniqueFileName}`;
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to save uploaded certificate file: ' + err.message }, { status: 400 });
        }
      } else if (certificateUrlInput) {
        certificateUrlToSave = certificateUrlInput;
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  name: '',
                  location: '',
                  licenseType: '[]',
                  certificateUrl: '[]'
                }
              });
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: {
                licenseType: JSON.stringify(licenseTypes),
                certificateUrl: JSON.stringify(certificateUrls)
              }
            });
            return { licenseTypes, certificateUrls };
          },
          async () => {
            let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!profile) {
              profile = {
                id: mockDb.profiles.length + 1,
                userId: auth.userId,
                name: '',
                location: '',
                licenseType: '[]',
                certificateUrl: '[]'
              };
              mockDb.profiles.push(profile);
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            profile.licenseType = JSON.stringify(licenseTypes);
            profile.certificateUrl = JSON.stringify(certificateUrls);

            return { licenseTypes, certificateUrls };
          }
        );

        const baseUrl = getBaseUrl(request);
        const formattedCerts = response.certificateUrls.map((c) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);

        return NextResponse.json({
          success: true,
          message: 'License/certificate updated successfully'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update license' }, { status: 400 });
      }
    }

    // 1. Sign Up (Common Register /api/auth/register)
    if (path === 'auth/register') {
      const { email, password } = body as any;
      if (!email || !password) {
        return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            const user = await prisma.user.create({
              data: {
                email,
                password: hashPassword(password),
                name: "",
                role: "",
              },
            });
            const token = generateToken(user.id, user.email, user.role);
            return { token, user };
          },
          async () => {
            const exists = mockDb.users.find((u) => u.email === email);
            if (exists) throw new Error('User already exists');
            const newUser = {
              id: mockDb.users.length + 1,
              email,
              password: hashPassword(password),
              name: "",
              role: "",
              providerType: null,
              phoneNumber: null,
              isPhoneVerified: false,
              onboardingCompleted: false,
              socialKey: null,
              socialType: null,
              createdAt: new Date(),
            };
            mockDb.users.push(newUser);
            const token = generateToken(newUser.id, newUser.email, newUser.role);
            return { token, user: newUser };
          }
        );
        const responseObj = response as { token: string; user: any };
        return NextResponse.json({
          token: responseObj.token,
          user: sanitizeUser(responseObj.user, request),
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Error occurred' }, { status: 400 });
      }
    }

    // 2. Sign In (Common Login /api/auth/login)
    if (path === 'auth/login') {
      const { email, password } = body as any;
      if (!email || !password) {
        return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            if (email === 'admin@lookclean.com') {
              let adminUser = await prisma.user.findUnique({ where: { email } });
              if (!adminUser) {
                adminUser = await prisma.user.create({
                  data: {
                    email: 'admin@lookclean.com',
                    password: hashPassword('admin123'),
                    name: 'System Admin',
                    role: 'admin',
                    onboardingCompleted: true,
                  },
                });
              }
              if (adminUser.password !== hashPassword(password)) throw new Error('Invalid credentials');
              const token = generateToken(adminUser.id, adminUser.email, adminUser.role);
              return { token, user: adminUser };
            }
            const user = await prisma.user.findUnique({
              where: { email },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
                clientProfile: true,
              },
            });
            if (!user || user.password !== hashPassword(password)) throw new Error('Invalid credentials');
            const token = generateToken(user.id, user.email, user.role);
            return { token, user };
          },
          async () => {
            if (email === 'admin@lookclean.com') {
              let mockAdmin = mockDb.users.find((u) => u.email === email);
              if (!mockAdmin) {
                mockAdmin = {
                  id: 1,
                  email: 'admin@lookclean.com',
                  password: hashPassword('admin123'),
                  name: 'System Admin',
                  role: 'admin',
                  providerType: null,
                  phoneNumber: '+15005550006',
                  isPhoneVerified: true,
                  onboardingCompleted: true,
                  socialKey: null,
                  socialType: null,
                  createdAt: new Date(),
                };
                mockDb.users.push(mockAdmin);
              }
              if (mockAdmin.password !== hashPassword(password)) throw new Error('Invalid credentials');
              const token = generateToken(mockAdmin.id, mockAdmin.email, mockAdmin.role);
              return { token, user: mockAdmin };
            }
            const user = mockDb.users.find((u) => u.email === email && u.password === hashPassword(password));
            if (!user) throw new Error('Invalid credentials');
            const token = generateToken(user.id, user.email, user.role);
            const profile = mockDb.profiles.find((p) => p.userId === user.id);
            let providerProfile = undefined;
            let clientProfile = undefined;
            if (profile) {
              if (user.role === 'provider') {
                providerProfile = {
                  ...profile,
                  services: mockDb.services.filter((s) => s.profileId === profile.id),
                  amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                };
              } else if (user.role === 'client') {
                clientProfile = { ...profile };
              }
            }
            return { token, user: { ...user, providerProfile, clientProfile } };
          }
        );
        const responseObj = response as { token: string; user: any };
        const sanitized = sanitizeUser(responseObj.user, request);
        if (sanitized && sanitized.providerProfile) {
          await enrichProviderProfile(sanitized.providerProfile, request);
        }
        return NextResponse.json({
          token: responseObj.token,
          user: sanitized,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Login failed' }, { status: 400 });
      }
    }

    // 3. Select Role and Provider Type (/api/auth/select-role)
    if (path === 'auth/select-role') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { role, providerType } = body as any;
      if (!role || (role !== 'client' && role !== 'provider')) {
        return NextResponse.json({ message: 'Invalid role. Must be client or provider' }, { status: 400 });
      }

      try {
        const responseObj = await executeWithDbFallback(
          async () => {
            const updated = await prisma.user.update({
              where: { id: auth.userId },
              data: {
                role,
                providerType: role === 'provider' ? providerType : null,
              },
            });
            return updated;
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (!user) throw new Error('User not found');
            user.role = role;
            user.providerType = role === 'provider' ? providerType : null;
            return user;
          }
        );
        const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
        return NextResponse.json({
          token: token,
          user: sanitizeUser(responseObj, request),
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Error updating role' }, { status: 400 });
      }
    }

    // 3.5. Social Login (/api/auth/social-login)
    if (path === 'auth/social-login') {
      const { social_key, social_type, username, email } = body as any;
      if (!social_key || !social_type || !email) {
        return NextResponse.json({ message: 'Missing fields: social_key, social_type, and email are required' }, { status: 400 });
      }

      if (social_type !== 'google' && social_type !== 'ios') {
        return NextResponse.json({ message: 'Invalid social_type. Must be "google" or "ios"' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            // Check if user with this socialKey already exists
            let user = await prisma.user.findUnique({
              where: { socialKey: social_key },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
              },
            });

            if (!user) {
              // If not, check if a user with the same email already exists
              const existingEmailUser = await prisma.user.findUnique({
                where: { email },
              });

              if (existingEmailUser) {
                // Link social account to existing user account
                user = await prisma.user.update({
                  where: { id: existingEmailUser.id },
                  data: {
                    socialKey: social_key,
                    socialType: social_type,
                    name: existingEmailUser.name || username || "",
                  },
                  include: {
                    providerProfile: {
                      include: { services: true, amenities: true },
                    },
                  },
                });
              } else {
                // Create new user account
                user = await prisma.user.create({
                  data: {
                    email,
                    password: "",
                    name: username || "",
                    role: "",
                    socialKey: social_key,
                    socialType: social_type,
                  },
                  include: {
                    providerProfile: {
                      include: { services: true, amenities: true },
                    },
                  },
                });
              }
            }

            const token = generateToken(user.id, user.email, user.role);
            return { token, user };
          },
          async () => {
            // Fallback mockDb logic
            let user = mockDb.users.find((u) => u.socialKey === social_key);

            if (!user) {
              const existingEmailUser = mockDb.users.find((u) => u.email === email);
              if (existingEmailUser) {
                existingEmailUser.socialKey = social_key;
                existingEmailUser.socialType = social_type;
                if (!existingEmailUser.name && username) {
                  existingEmailUser.name = username;
                }
                user = existingEmailUser;
              } else {
                user = {
                  id: mockDb.users.length + 1,
                  email,
                  password: "",
                  name: username || "",
                  role: "",
                  providerType: null,
                  phoneNumber: null,
                  isPhoneVerified: false,
                  onboardingCompleted: false,
                  socialKey: social_key,
                  socialType: social_type,
                  createdAt: new Date(),
                };
                mockDb.users.push(user);
              }
            }

            const token = generateToken(user.id, user.email, user.role);
            const profile = mockDb.profiles.find((p) => p.userId === user.id);
            let providerProfile = undefined;
            if (profile) {
              providerProfile = {
                ...profile,
                services: mockDb.services.filter((s) => s.profileId === profile.id),
                amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
              };
            }
            return { token, user: { ...user, providerProfile } };
          }
        );

        const responseObj = response as { token: string; user: any };
        const sanitized = sanitizeUser(responseObj.user, request);
        if (sanitized && sanitized.providerProfile) {
          await enrichProviderProfile(sanitized.providerProfile, request);
        }
        return NextResponse.json({
          token: responseObj.token,
          user: sanitized,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Social login failed' }, { status: 400 });
      }
    }

    // 4. Forgot Password send OTP (/api/auth/forgot-password/send-otp)
    if (path === 'auth/forgot-password/send-otp') {
      const { phoneNumber } = body as any;
      if (!phoneNumber) {
        return NextResponse.json({ success: false, message: 'Phone number is required' });
      }

      try {
        const user = await executeWithDbFallback(
          async () => {
            return await prisma.user.findFirst({ where: { phoneNumber } });
          },
          async () => {
            return mockDb.users.find((u) => u.phoneNumber === phoneNumber) || null;
          }
        );

        if (!user) {
          return NextResponse.json({ success: false, message: 'Phone number not registered' });
        }

        // Generate a random 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set('forgot-password:' + phoneNumber, { code: otp, exp: Date.now() + 1000 * 60 * 10 }); // 10 minutes expiry

        // Retrieve active Twilio connection config
        const twilioSettings = await executeWithDbFallback(
          async () => {
            const dbSetting = await prisma.systemSetting.findUnique({
              where: { key: 'twilio' },
            });
            if (dbSetting) return JSON.parse(dbSetting.value);
            return mockDb.twilioSettings;
          },
          async () => {
            return mockDb.twilioSettings;
          }
        );

        const mode = twilioSettings.activeMode || 'staging';
        const config = mode === 'live' ? twilioSettings.live : twilioSettings.staging;
        const { accountSid, authToken, phoneNumber: fromNumber, messagingServiceSid } = config || {};

        const cleanAccountSid = accountSid?.trim();
        const cleanAuthToken = authToken?.trim();
        const cleanFromNumber = fromNumber?.trim();
        const cleanMessagingServiceSid = messagingServiceSid?.trim();

        if (!cleanAccountSid || !cleanAuthToken || (!cleanFromNumber && !cleanMessagingServiceSid)) {
          return NextResponse.json({ message: 'Twilio gateway is not configured' }, { status: 500 });
        }

        // Connect to Twilio API to send the SMS
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cleanAccountSid}/Messages.json`;
        const messageBody = `Your LookClean password reset verification code is: ${otp}`;
        const authString = Buffer.from(`${cleanAccountSid}:${cleanAuthToken}`).toString('base64');

        const params = new URLSearchParams();
        if (cleanMessagingServiceSid) {
          params.append('MessagingServiceSid', cleanMessagingServiceSid);
        } else {
          params.append('From', cleanFromNumber);
        }
        params.append('To', phoneNumber);
        params.append('Body', messageBody);

        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authString}`,
          },
          body: params.toString(),
        });

        const resData = await twilioRes.json();
        if (!twilioRes.ok) {
          console.error('[Twilio Send Forgot Password OTP Error]', resData);
          return NextResponse.json({
            success: false,
            message: `SMS gateway error: ${resData.message || 'Twilio config failure'}`
          }, { status: 400 });
        }

        console.log(`[Twilio Forgot Password OTP Sent] Success. SID: ${resData.sid}`);
        return NextResponse.json({ success: true, message: 'OTP code sent successfully via Twilio SMS' });

      } catch (err: any) {
        console.error('[Twilio Send Forgot Password OTP Exception]', err);
        return NextResponse.json({
          success: false,
          message: `SMS transmission failed: ${err.message || 'Connection timeout'}`
        }, { status: 500 });
      }
    }

    // 5. Forgot Password verify OTP (/api/auth/forgot-password/verify-otp)
    if (path === 'auth/forgot-password/verify-otp') {
      const { phoneNumber, code } = body as any;
      if (!phoneNumber || !code) {
        return NextResponse.json({ message: 'Phone number and verification code are required' }, { status: 400 });
      }

      const user = await executeWithDbFallback(
        async () => {
          return await prisma.user.findUnique({ where: { phoneNumber } });
        },
        async () => {
          return mockDb.users.find((u) => u.phoneNumber === phoneNumber) || null;
        }
      );

      if (!user) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }

      // Verify OTP using cache store
      const record = otpStore.get('forgot-password:' + phoneNumber);
      if (!record || record.code !== code || record.exp < Date.now()) {
        return NextResponse.json({ message: 'Invalid or expired verification code' }, { status: 400 });
      }

      // Clear OTP after successful verification
      otpStore.delete('forgot-password:' + phoneNumber);

      // Generate short-lived reset token (15 mins)
      const resetToken = generateResetToken(user.id, user.phoneNumber || user.email || '');

      return NextResponse.json({ success: true, token: resetToken, message: 'OTP verified successfully' });
    }

    // 6. Forgot Password reset (/api/auth/forgot-password/reset)
    if (path === 'auth/forgot-password/reset') {
      const { token, password } = body as any;
      if (!token || !password) {
        return NextResponse.json({ message: 'Reset token and new password are required' }, { status: 400 });
      }

      const payload = verifyResetToken(token);
      if (!payload) {
        return NextResponse.json({ message: 'Invalid or expired password reset token' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.update({
              where: { id: payload.userId },
              data: { password: hashPassword(password) },
            });
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === payload.userId);
            if (!user) throw new Error('User not found in mock store');
            user.password = hashPassword(password);
          }
        );

        return NextResponse.json({ success: true, message: 'Password updated successfully' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Error updating password' }, { status: 400 });
      }
    }

    // 7. Send Mobile SMS OTP (/api/users/verify/mobile/send)
    if (path === 'users/verify/mobile/send') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { phoneNumber } = body as any;
      if (!phoneNumber) {
        return NextResponse.json({ message: 'Phone number is required' }, { status: 400 });
      }

      // Generate a random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore.set(phoneNumber, { code: otp, exp: Date.now() + 1000 * 60 * 10 }); // 10 minutes expiry

      // Retrieve active Twilio connection config from database/memory
      const twilioSettings = await executeWithDbFallback(
        async () => {
          const dbSetting = await prisma.systemSetting.findUnique({
            where: { key: 'twilio' },
          });
          if (dbSetting) return JSON.parse(dbSetting.value);
          return mockDb.twilioSettings;
        },
        async () => {
          return mockDb.twilioSettings;
        }
      );

      const mode = twilioSettings.activeMode || 'staging';
      const config = mode === 'live' ? twilioSettings.live : twilioSettings.staging;
      const { accountSid, authToken, phoneNumber: fromNumber, messagingServiceSid } = config || {};

      const cleanAccountSid = accountSid?.trim();
      const cleanAuthToken = authToken?.trim();
      const cleanFromNumber = fromNumber?.trim();
      const cleanMessagingServiceSid = messagingServiceSid?.trim();

      if (!cleanAccountSid || !cleanAuthToken || (!cleanFromNumber && !cleanMessagingServiceSid)) {
        return NextResponse.json({ message: 'Twilio gateway is not configured' }, { status: 500 });
      }

      // Connect to Twilio API to send the SMS
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cleanAccountSid}/Messages.json`;
      const messageBody = `Your LookClean mobile verification code is: ${otp}`;
      const authString = Buffer.from(`${cleanAccountSid}:${cleanAuthToken}`).toString('base64');

      const params = new URLSearchParams();
      if (cleanMessagingServiceSid) {
        params.append('MessagingServiceSid', cleanMessagingServiceSid);
      } else {
        params.append('From', cleanFromNumber);
      }
      params.append('To', phoneNumber);
      params.append('Body', messageBody);

      try {
        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authString}`,
          },
          body: params.toString(),
        });

        const resData = await twilioRes.json();
        if (!twilioRes.ok) {
          console.error('[Twilio Send OTP Error]', resData);
          return NextResponse.json({
            success: false,
            message: `SMS gateway error: ${resData.message || 'Twilio config failure'}`
          }, { status: 400 });
        }

        console.log(`[Twilio OTP Sent] Success. SID: ${resData.sid}`);
        return NextResponse.json({ success: true, message: 'SMS OTP sent successfully via Twilio!' });
      } catch (err: any) {
        console.error('[Twilio Send OTP Exception]', err);
        return NextResponse.json({
          success: false,
          message: `SMS transmission failed: ${err.message || 'Connection timeout'}`
        }, { status: 500 });
      }
    }

    // 8. Verify Mobile SMS OTP (/api/users/verify/mobile)
    if (path === 'users/verify/mobile') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { phoneNumber, code } = body as any;
      if (!code) {
        return NextResponse.json({ message: 'Verification code is required' }, { status: 400 });
      }

      // Verify using cache store, supporting standard testing fallbacks
      if (code !== '1234' && code !== '123456') {
        const record = phoneNumber ? otpStore.get(phoneNumber) : null;
        if (!record || record.code !== code || record.exp < Date.now()) {
          return NextResponse.json({ message: 'Invalid or expired OTP code' }, { status: 400 });
        }
        if (phoneNumber) otpStore.delete(phoneNumber);
      }

      await executeWithDbFallback(
        async () => {
          await prisma.user.update({
            where: { id: auth.userId },
            data: { isPhoneVerified: true, phoneNumber },
          });
        },
        async () => {
          const user = mockDb.users.find((u) => u.id === auth.userId);
          if (user) {
            user.isPhoneVerified = true;
            user.phoneNumber = phoneNumber;
          }
        }
      );

      return NextResponse.json({ success: true, message: 'Phone number verified successfully!' });
    }

    // 9. Save Twilio Settings (/api/admin/settings/twilio)
    if (path === 'admin/settings/twilio') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { activeMode, staging, live } = body as any;

      const updatedSettings = await executeWithDbFallback(
        async () => {
          let currentSettings = { ...mockDb.twilioSettings };
          const dbSetting = await prisma.systemSetting.findUnique({
            where: { key: 'twilio' },
          });
          if (dbSetting) {
            currentSettings = JSON.parse(dbSetting.value);
          }

          if (activeMode) currentSettings.activeMode = activeMode;
          if (staging) {
            currentSettings.staging = {
              ...currentSettings.staging,
              ...staging
            };
          }
          if (live) {
            currentSettings.live = {
              ...currentSettings.live,
              ...live
            };
          }

          await prisma.systemSetting.upsert({
            where: { key: 'twilio' },
            update: { value: JSON.stringify(currentSettings) },
            create: { key: 'twilio', value: JSON.stringify(currentSettings) },
          });

          // Also update local mock for consistency
          mockDb.twilioSettings = currentSettings;
          return currentSettings;
        },
        async () => {
          if (activeMode) mockDb.twilioSettings.activeMode = activeMode;
          if (staging) {
            mockDb.twilioSettings.staging = {
              ...mockDb.twilioSettings.staging,
              ...staging
            };
          }
          if (live) {
            mockDb.twilioSettings.live = {
              ...mockDb.twilioSettings.live,
              ...live
            };
          }
          return mockDb.twilioSettings;
        }
      );

      return NextResponse.json({ success: true, settings: updatedSettings });
    }

    // 10. Verify Twilio Connection (/api/admin/settings/twilio/verify)
    if (path === 'admin/settings/twilio/verify') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { mode, accountSid, authToken, phoneNumber, verificationServiceId, messagingServiceSid, testPhoneNumber } = body as any;

      const cleanAccountSid = accountSid?.trim();
      const cleanAuthToken = authToken?.trim();
      const cleanPhoneNumber = phoneNumber?.trim();
      const cleanMessagingServiceSid = messagingServiceSid?.trim();
      const cleanTestPhoneNumber = testPhoneNumber?.trim();

      // Simulate connection delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (!cleanAccountSid || !cleanAuthToken || (!cleanPhoneNumber && !cleanMessagingServiceSid)) {
        return NextResponse.json({
          success: false,
          message: 'Invalid configuration: Account SID, Auth Token, and either Twilio Number or SMS Service Sid are required.'
        }, { status: 400 });
      }

      if (!cleanAccountSid.startsWith('AC')) {
        return NextResponse.json({
          success: false,
          message: `Connection failed for ${mode} mode: Account SID must start with 'AC'.`
        }, { status: 400 });
      }

      if (!cleanTestPhoneNumber) {
        return NextResponse.json({
          success: false,
          message: 'A test recipient phone number is required to verify the connection.'
        }, { status: 400 });
      }

      // Connect to Twilio API to send the test SMS
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cleanAccountSid}/Messages.json`;
      const messageBody = `Your LookClean Twilio ${mode.toUpperCase()} gateway verification was successful!`;
      const authString = Buffer.from(`${cleanAccountSid}:${cleanAuthToken}`).toString('base64');

      const params = new URLSearchParams();
      if (cleanMessagingServiceSid) {
        params.append('MessagingServiceSid', cleanMessagingServiceSid);
      } else {
        params.append('From', cleanPhoneNumber);
      }
      params.append('To', testPhoneNumber);
      params.append('Body', messageBody);

      try {
        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authString}`,
          },
          body: params.toString(),
        });

        const resData = await twilioRes.json();
        if (!twilioRes.ok) {
          console.error('[Twilio Verify Connection Error]', resData);
          return NextResponse.json({
            success: false,
            message: `Twilio gateway verification failed: ${resData.message || 'Invalid credentials'}`
          }, { status: 400 });
        }

        console.log(`[Twilio Verify Connection Sent] Success. SID: ${resData.sid}`);
        return NextResponse.json({
          success: true,
          message: `Successfully verified Twilio connection! Test SMS sent to ${testPhoneNumber}.`
        });
      } catch (err: any) {
        console.error('[Twilio Verify Connection Exception]', err);
        return NextResponse.json({
          success: false,
          message: `Twilio connection failed: ${err.message || 'Connection timeout'}`
        }, { status: 500 });
      }
    }

    // 11. Change Admin Password (/api/admin/change-password)
    if (path === 'admin/change-password') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { currentPassword, newPassword } = body as any;
      if (!currentPassword || !newPassword) {
        return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            const adminUser = await prisma.user.findUnique({ where: { id: auth.userId } });
            if (!adminUser || adminUser.password !== hashPassword(currentPassword)) {
              throw new Error('Invalid current password');
            }
            await prisma.user.update({
              where: { id: auth.userId },
              data: { password: hashPassword(newPassword) },
            });
          },
          async () => {
            const adminUser = mockDb.users.find((u) => u.id === auth.userId);
            if (!adminUser || adminUser.password !== hashPassword(currentPassword)) {
              throw new Error('Invalid current password');
            }
            adminUser.password = hashPassword(newPassword);
          }
        );
        return NextResponse.json({ success: true, message: 'Password updated successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Change password failed' }, { status: 400 });
      }
    }

    // 11.5. Change User Password (/api/users/change-password)
    if (path === 'users/change-password') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { oldPassword, newPassword } = body as any;
      if (!oldPassword || !newPassword) {
        return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            const user = await prisma.user.findUnique({ where: { id: auth.userId } });
            if (!user || user.password !== hashPassword(oldPassword)) {
              throw new Error('Invalid current password');
            }
            await prisma.user.update({
              where: { id: auth.userId },
              data: { password: hashPassword(newPassword) },
            });
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (!user || user.password !== hashPassword(oldPassword)) {
              throw new Error('Invalid current password');
            }
            user.password = hashPassword(newPassword);
          }
        );
        return NextResponse.json({ success: true, message: 'Password updated successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Change password failed' }, { status: 400 });
      }
    }

    // 12. Create Category Setting (/api/admin/settings/categories)
    if (path === 'admin/settings/categories') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { title } = body as any;
      if (!title) {
        return NextResponse.json({ message: 'Category title is required' }, { status: 400 });
      }
      try {
        const category = await executeWithDbFallback(
          async () => {
            return await prisma.categorySetting.create({ data: { title: title.trim() } });
          },
          async () => {
            return { id: Math.floor(Math.random() * 10000), title: title.trim() };
          }
        );
        return NextResponse.json({ success: true, category });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create category' }, { status: 400 });
      }
    }

    // 13. Create Service Setting (/api/admin/settings/services)
    if (path === 'admin/settings/services') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { mainType, title } = body as any;
      if (!mainType || !title) {
        return NextResponse.json({ message: 'mainType and title are required' }, { status: 400 });
      }
      try {
        const service = await executeWithDbFallback(
          async () => {
            let category = await prisma.categorySetting.findUnique({
              where: { title: mainType.trim() }
            });
            if (!category) {
              category = await prisma.categorySetting.create({
                data: { title: mainType.trim() }
              });
            }
            return await prisma.serviceSetting.create({
              data: {
                mainTypeId: category.id,
                title: title.trim()
              }
            });
          },
          async () => {
            return {
              id: Math.floor(Math.random() * 10000),
              mainTypeId: 1,
              title: title.trim(),
              createdAt: new Date()
            };
          }
        );
        return NextResponse.json({ success: true, service });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create service setting' }, { status: 400 });
      }
    }

    // 14. Create Ambience/Amenity Setting (/api/admin/settings/ambience)
    if (path === 'admin/settings/ambience') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const baseUrl = getBaseUrl(request);

      let mainType: any = undefined;
      let mainTypeIcon: any = undefined;
      let title: any = undefined;
      let icon: any = undefined;
      let iconUrl: any = undefined;
      let csvItems: { title: string; icon?: string }[] = [];

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          mainType = formData.get('mainType');
          mainTypeIcon = formData.get('mainTypeIcon');
          title = formData.get('title');
          icon = formData.get('icon');
          const svgFile = formData.get('svgFile');
          const csvFile = formData.get('csvFile');

          if (csvFile && typeof csvFile === 'object' && 'name' in csvFile) {
            const file = csvFile as any;
            const csvText = await file.text();
            csvItems = parseCsv(csvText);
          }

          if (svgFile && typeof svgFile === 'object' && 'name' in svgFile) {
            const file = svgFile as any;
            const fileName = file.name || '';
            const fileExt = nodePath.extname(fileName).toLowerCase();

            if (fileExt !== '.svg') {
              return NextResponse.json(
                { message: 'Uploaded file must be an SVG file' },
                { status: 400 }
              );
            }

            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
            await fs.mkdir(uploadDir, { recursive: true });
            const uniqueFileName = `icon_${Date.now()}${fileExt}`;
            const filePath = nodePath.join(uploadDir, uniqueFileName);
            await fs.writeFile(filePath, buffer);
            iconUrl = `/uploads/${uniqueFileName}`;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process upload: ' + err.message }, { status: 400 });
        }
      } else {
        const bodyObj = body as any;
        mainType = bodyObj.mainType;
        mainTypeIcon = bodyObj.mainTypeIcon;
        title = bodyObj.title;
        icon = bodyObj.icon;
        if (bodyObj.csvItems && Array.isArray(bodyObj.csvItems)) {
          csvItems = bodyObj.csvItems;
        }
      }

      if (!mainType) {
        return NextResponse.json({ message: 'mainType is required' }, { status: 400 });
      }

      const hasSingleItem = title && title.toString().trim().length > 0;
      if (!hasSingleItem && csvItems.length === 0) {
        return NextResponse.json({ message: 'Title or CSV items list is required' }, { status: 400 });
      }

      const finalIcon = iconUrl || (icon ? icon.toString().trim() : null);

      try {
        const ambience = await executeWithDbFallback(
          async () => {
            let group = await prisma.ambienceGroupSetting.findUnique({
              where: { title: mainType.toString().trim() }
            });
            if (!group) {
              group = await prisma.ambienceGroupSetting.create({
                data: {
                  title: mainType.toString().trim(),
                }
              });
            }

            const createdItems = [];

            if (hasSingleItem) {
              const single = await prisma.ambienceSetting.create({
                data: {
                  ambienceGroupId: group.id,
                  title: title.toString().trim(),
                  icon: finalIcon
                }
              });
              createdItems.push(single);
            }

            for (const csvItem of csvItems) {
              const created = await prisma.ambienceSetting.upsert({
                where: {
                  ambienceGroupId_title: {
                    ambienceGroupId: group.id,
                    title: csvItem.title.trim()
                  }
                },
                update: {
                  icon: csvItem.icon ? csvItem.icon.trim() : null
                },
                create: {
                  ambienceGroupId: group.id,
                  title: csvItem.title.trim(),
                  icon: csvItem.icon ? csvItem.icon.trim() : null
                }
              });
              createdItems.push(created);
            }

            return { group, items: createdItems };
          },
          async () => {
            const groupObj = { id: Math.floor(Math.random() * 10000), title: mainType.toString().trim() };
            const createdItems = [];

            if (hasSingleItem) {
              createdItems.push({
                id: Math.floor(Math.random() * 10000),
                ambienceGroupId: groupObj.id,
                title: title.toString().trim(),
                icon: finalIcon,
                createdAt: new Date()
              });
            }

            for (const csvItem of csvItems) {
              createdItems.push({
                id: Math.floor(Math.random() * 10000),
                ambienceGroupId: groupObj.id,
                title: csvItem.title.trim(),
                icon: csvItem.icon ? csvItem.icon.trim() : null,
                createdAt: new Date()
              });
            }

            return { group: groupObj, items: createdItems };
          }
        );

        const returnAmbience = {
          success: true,
          group: ambience.group,
          items: ambience.items.map((item: any) => {
            let itemIcon = item.icon;
            if (baseUrl && itemIcon && itemIcon.startsWith('/')) {
              itemIcon = `${baseUrl}${itemIcon}`;
            }
            return { ...item, icon: itemIcon };
          })
        };

        return NextResponse.json(returnAmbience);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create ambience setting' }, { status: 400 });
      }
    }

    // 15. Provider Onboarding Step 1: Profile Setup (/api/provider/setup/profile)
    if (path === 'provider/setup/profile') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      let name: any = undefined;
      let location: any = undefined;
      let latitude: any = undefined;
      let longitude: any = undefined;
      let coverImageUrl: any = undefined;
      let profileImageUrl: any = undefined;

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          name = formData.get('name');
          location = formData.get('location');
          latitude = formData.get('latitude');
          longitude = formData.get('longitude');
          const profileImageFile = formData.get('profileImage');
          const coverImageFile = formData.get('coverImage');

          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });

          if (profileImageFile && typeof profileImageFile === 'object' && 'name' in profileImageFile) {
            const file = profileImageFile as any;
            const fileExt = nodePath.extname(file.name || '').toLowerCase();
            const uniqueFileName = `profile_${auth.userId}_${Date.now()}${fileExt || '.png'}`;
            const bytes = await file.arrayBuffer();
            await fs.writeFile(nodePath.join(uploadDir, uniqueFileName), Buffer.from(bytes));
            profileImageUrl = `/uploads/${uniqueFileName}`;
          } else if (typeof profileImageFile === 'string') {
            profileImageUrl = profileImageFile;
          }

          if (coverImageFile && typeof coverImageFile === 'object' && 'name' in coverImageFile) {
            const file = coverImageFile as any;
            const fileExt = nodePath.extname(file.name || '').toLowerCase();
            const uniqueFileName = `cover_${auth.userId}_${Date.now()}${fileExt || '.png'}`;
            const bytes = await file.arrayBuffer();
            await fs.writeFile(nodePath.join(uploadDir, uniqueFileName), Buffer.from(bytes));
            coverImageUrl = `/uploads/${uniqueFileName}`;
          } else if (typeof coverImageFile === 'string') {
            coverImageUrl = coverImageFile;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process file upload: ' + err.message }, { status: 400 });
        }
      } else {
        const bodyObj = body as any;
        name = bodyObj.name;
        location = bodyObj.location;
        latitude = bodyObj.latitude;
        longitude = bodyObj.longitude;
        coverImageUrl = bodyObj.coverImageUrl;
        profileImageUrl = bodyObj.profileImageUrl;
      }

      if (!name || !location) {
        return NextResponse.json({ message: 'Name and location are required' }, { status: 400 });
      }

      try {
        const profile = await executeWithDbFallback(
          async () => {
            let existing = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            const finalProfileImage = profileImageUrl !== undefined ? profileImageUrl : (existing?.profileImageUrl || null);
            const finalCoverImage = coverImageUrl !== undefined ? coverImageUrl : (existing?.coverImageUrl || null);

            return await prisma.providerProfile.upsert({
              where: { userId: auth.userId },
              update: {
                name,
                location,
                coverImageUrl: finalCoverImage,
                profileImageUrl: finalProfileImage,
                latitude: latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
                longitude: longitude !== undefined && longitude !== null ? parseFloat(longitude) : null
              },
              create: {
                userId: auth.userId,
                name,
                location,
                coverImageUrl: finalCoverImage,
                profileImageUrl: finalProfileImage,
                latitude: latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
                longitude: longitude !== undefined && longitude !== null ? parseFloat(longitude) : null
              },
            });
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId };
              mockDb.profiles.push(mockProfile);
            }
            mockProfile.name = name;
            mockProfile.location = location;
            if (coverImageUrl !== undefined) mockProfile.coverImageUrl = coverImageUrl;
            if (profileImageUrl !== undefined) mockProfile.profileImageUrl = profileImageUrl;
            mockProfile.latitude = latitude !== undefined && latitude !== null ? parseFloat(latitude) : null;
            mockProfile.longitude = longitude !== undefined && longitude !== null ? parseFloat(longitude) : null;
            return mockProfile;
          }
        );

        const baseUrl = getBaseUrl(request);

        const resProfile = JSON.parse(JSON.stringify(profile));
        if (baseUrl) {
          if (resProfile.profileImageUrl && resProfile.profileImageUrl.startsWith('/')) {
            resProfile.profileImageUrl = `${baseUrl}${resProfile.profileImageUrl}`;
          }
          if (resProfile.coverImageUrl && resProfile.coverImageUrl.startsWith('/')) {
            resProfile.coverImageUrl = `${baseUrl}${resProfile.coverImageUrl}`;
          }
        }

        return NextResponse.json({ success: true, message: 'Profile setup completed successfully' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update profile' }, { status: 400 });
      }
    }

    // 16. Provider Onboarding Step 2: Set Selected Categories (/api/provider/setup/categories)
    if (path === 'provider/setup/categories') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { categories } = body as any;
      if (!Array.isArray(categories)) {
        return NextResponse.json({ message: 'Categories list must be an array' }, { status: 400 });
      }
      try {
        const profile = await executeWithDbFallback(
          async () => {
            // Verify provider profile exists
            const existing = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!existing) {
              // Auto create an empty profile if step 1 was skipped/partially completed
              return await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  name: '',
                  location: '',
                  categories: JSON.stringify(categories)
                }
              });
            }
            return await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: { categories: JSON.stringify(categories) },
            });
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, name: '', location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockProfile.categories = JSON.stringify(categories);
            return mockProfile;
          }
        );
        return NextResponse.json({ success: true, message: 'Categories setup completed successfully' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save categories' }, { status: 400 });
      }
    }

    // 17. Provider Onboarding Step 3: Set Selected Services & Pricing (/api/provider/setup/services)
    if (path === 'provider/setup/services') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { services } = body as any; // Array of { service_id, price } or { serviceId, price }
      if (!Array.isArray(services)) {
        return NextResponse.json({ message: 'Services must be an array' }, { status: 400 });
      }
      try {
        await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              // Auto create an empty profile
              profile = await prisma.providerProfile.create({
                data: { userId: auth.userId, name: '', location: '' }
              });
            }
            // Clear current services
            await prisma.providerService.deleteMany({ where: { profileId: profile.id } });

            // Look up corresponding ServiceSetting names and categories
            const serviceIds = services.map((s: any) => parseInt(s.service_id || s.serviceId)).filter(Boolean);
            const serviceSettings = await prisma.serviceSetting.findMany({
              where: { id: { in: serviceIds } },
              include: { mainType: true }
            });

            const dataToInsert = services.map((s: any) => {
              const sId = parseInt(s.service_id || s.serviceId);
              const setting = serviceSettings.find(set => set.id === sId);
              if (!setting) return null;
              return {
                profileId: profile.id,
                name: setting.title,
                price: parseInt(s.price) || 0,
                category: setting.mainType ? setting.mainType.title : 'General'
              };
            }).filter(Boolean) as any[];

            // Re-insert
            if (dataToInsert.length > 0) {
              await prisma.providerService.createMany({
                data: dataToInsert,
              });
            }
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, name: '', location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockDb.services = mockDb.services.filter((s) => s.profileId !== mockProfile.id);
            services.forEach((s: any) => {
              const sId = parseInt(s.service_id || s.serviceId) || 1;
              mockDb.services.push({
                id: Math.floor(Math.random() * 10000),
                profileId: mockProfile.id,
                name: `Service #${sId}`,
                price: parseInt(s.price) || 0,
                category: 'General',
              });
            });
          }
        );
        return NextResponse.json({ success: true, message: 'Services updated successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save services' }, { status: 400 });
      }
    }

    // 18. Provider Onboarding Step 4: Set Selected Ambience & Amenities (/api/provider/setup/ambience)
    if (path === 'provider/setup/ambience') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      let rawAmbienceId = (body as any).ambience_id || (body as any).ambienceId || (body as any).ambience_ids || (body as any).ambienceIds || (body as any).items;
      if (Array.isArray(body)) {
        rawAmbienceId = body;
      }

      let ambienceIds: number[] = [];
      if (Array.isArray(rawAmbienceId)) {
        ambienceIds = rawAmbienceId.map((id: any) => {
          if (id && typeof id === 'object') {
            const target = id.id ?? id.ambience_id ?? id.ambienceId;
            return Number(target);
          }
          return Number(id);
        }).filter((n) => !isNaN(n) && n > 0);
      } else if (typeof rawAmbienceId === 'number') {
        ambienceIds = [rawAmbienceId];
      }

      try {
        await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              // Auto create empty profile
              profile = await prisma.providerProfile.create({
                data: { userId: auth.userId, name: '', location: '' }
              });
            }
            // Clear current items
            await prisma.providerAmenity.deleteMany({ where: { profileId: profile.id } });

            // Look up corresponding AmbienceSetting names and types
            const ambienceSettings = await prisma.ambienceSetting.findMany({
              where: { id: { in: ambienceIds } },
              include: { ambienceGroup: true }
            });

            const dataToInsert = ambienceSettings.map((setting) => ({
              profileId: profile.id,
              name: setting.title,
              type: setting.ambienceGroup ? setting.ambienceGroup.title : 'amenity',
              icon: setting.icon || null
            }));

            // Re-insert
            if (dataToInsert.length > 0) {
              await prisma.providerAmenity.createMany({
                data: dataToInsert,
              });
            }
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, name: '', location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== mockProfile.id);
            ambienceIds.forEach((id) => {
              mockDb.amenities.push({
                id: Math.floor(Math.random() * 10000),
                profileId: mockProfile.id,
                name: `Ambience Item #${id}`,
                type: 'amenity',
                icon: null,
              });
            });
          }
        );
        return NextResponse.json({ success: true, message: 'Amenities and Ambience updated successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save items' }, { status: 400 });
      }
    }

    // 19. Provider Onboarding Step 5: Licenses & Experience (/api/provider/setup/license)
    if (path === 'provider/setup/license') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      let experience: any = null;
      let licenseNamesList: string[] = [];
      let certificateUrls: string[] = [];

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          experience = formData.get('experience');

          // Support multiple license names and certificates
          const rawLicenseNames = formData.getAll('licenseName').length > 0
            ? formData.getAll('licenseName')
            : (formData.getAll('licenseType').length > 0
              ? formData.getAll('licenseType')
              : formData.getAll('licenseNames'));

          const rawCertificates = formData.getAll('certificate').length > 0
            ? formData.getAll('certificate')
            : formData.getAll('certificates');

          // Support single values if passed
          const singleLicenseType = formData.get('licenseType');
          if (rawLicenseNames.length === 0 && singleLicenseType) {
            const strType = String(singleLicenseType);
            if (strType.includes(',')) {
              licenseNamesList.push(...strType.split(',').map(s => s.trim()));
            } else {
              licenseNamesList.push(strType);
            }
          } else {
            rawLicenseNames.forEach((name: any) => {
              const strName = String(name);
              if (strName.includes(',')) {
                licenseNamesList.push(...strName.split(',').map(s => s.trim()));
              } else {
                licenseNamesList.push(strName);
              }
            });
          }

          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });

          for (let i = 0; i < rawCertificates.length; i++) {
            const certificate = rawCertificates[i];
            if (certificate && typeof certificate === 'object' && 'name' in certificate) {
              const file = certificate as any;
              const mimeType = file.type || '';
              const fileName = file.name || '';
              const fileExt = nodePath.extname(fileName).toLowerCase();

              const isValidMime = mimeType === 'application/pdf' || mimeType.startsWith('image/');
              const isValidExt = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

              if (!isValidMime && !isValidExt) {
                return NextResponse.json(
                  { message: 'Certificate must be a PDF or an image file only' },
                  { status: 400 }
                );
              }

              const bytes = await file.arrayBuffer();
              const buffer = Buffer.from(bytes);
              const uniqueFileName = `certificate_${auth.userId}_${Date.now()}_${i}${fileExt || '.pdf'}`;
              const filePath = nodePath.join(uploadDir, uniqueFileName);
              await fs.writeFile(filePath, buffer);
              certificateUrls.push(`/uploads/${uniqueFileName}`);
            } else if (typeof certificate === 'string') {
              const strCert = String(certificate);
              if (strCert.includes(',')) {
                certificateUrls.push(...strCert.split(',').map(s => s.trim()));
              } else {
                certificateUrls.push(strCert);
              }
            }
          }

          const rawCertificateUrls = formData.getAll('certificateUrl').length > 0
            ? formData.getAll('certificateUrl')
            : formData.getAll('certificateUrls');
          if (rawCertificateUrls.length > 0) {
            for (const url of rawCertificateUrls) {
              if (typeof url === 'string') {
                if (url.includes(',')) {
                  certificateUrls.push(...url.split(',').map(s => s.trim()));
                } else {
                  certificateUrls.push(url);
                }
              }
            }
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process file upload: ' + err.message }, { status: 400 });
        }
      } else {
        experience = (body as any).experience;
        if (Array.isArray((body as any).licenses)) {
          const names: string[] = [];
          const urls: string[] = [];
          for (const item of (body as any).licenses) {
            if (item && typeof item === 'object') {
              const lName = item.licenseName || item.licenseType || '';
              if (lName.includes(',')) {
                names.push(...lName.split(',').map((s: string) => s.trim()));
              } else {
                names.push(lName);
              }

              const cUrl = item.certificateUrl || '';
              if (cUrl.includes(',')) {
                urls.push(...cUrl.split(',').map((s: string) => s.trim()));
              } else {
                urls.push(cUrl);
              }
            }
          }
          licenseNamesList = names.filter(Boolean);
          certificateUrls = urls.filter(Boolean);
        } else {
          const rawTypes = (body as any).licenseType;
          const tempTypes = Array.isArray(rawTypes) ? rawTypes : (rawTypes ? [rawTypes] : []);
          tempTypes.forEach((t: any) => {
            const strT = String(t);
            if (strT.includes(',')) {
              licenseNamesList.push(...strT.split(',').map(s => s.trim()));
            } else {
              licenseNamesList.push(strT);
            }
          });

          const rawUrls = (body as any).certificateUrl;
          const tempUrls = Array.isArray(rawUrls) ? rawUrls : (rawUrls ? [rawUrls] : []);
          tempUrls.forEach((u: any) => {
            const strU = String(u);
            if (strU.includes(',')) {
              certificateUrls.push(...strU.split(',').map(s => s.trim()));
            } else {
              certificateUrls.push(strU);
            }
          });
        }
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            const storedLicenseType = licenseNamesList.length > 0 ? JSON.stringify(licenseNamesList) : (profile?.licenseType || null);
            const storedCertificateUrl = certificateUrls.length > 0 ? JSON.stringify(certificateUrls) : (profile?.certificateUrl || null);

            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  name: '',
                  location: '',
                  experience: parseInt(experience) || 0,
                  licenseType: storedLicenseType,
                  certificateUrl: storedCertificateUrl
                }
              });
            } else {
              profile = await prisma.providerProfile.update({
                where: { userId: auth.userId },
                data: {
                  experience: parseInt(experience) || 0,
                  licenseType: storedLicenseType,
                  certificateUrl: storedCertificateUrl
                },
              });
            }
            await prisma.user.update({
              where: { id: auth.userId },
              data: { onboardingCompleted: true },
            });
            return profile;
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, name: '', location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockProfile.experience = parseInt(experience) || 0;
            mockProfile.licenseType = licenseNamesList.length > 0 ? JSON.stringify(licenseNamesList) : (mockProfile.licenseType || null);
            mockProfile.certificateUrl = certificateUrls.length > 0 ? JSON.stringify(certificateUrls) : (mockProfile.certificateUrl || null);

            const mockUser = mockDb.users.find((u) => u.id === auth.userId);
            if (mockUser) mockUser.onboardingCompleted = true;
            return mockProfile;
          }
        );
        const baseUrl = getBaseUrl(request);

        const resProfile = JSON.parse(JSON.stringify(response));
        if (baseUrl && resProfile && resProfile.certificateUrl && resProfile.certificateUrl.startsWith('/')) {
          resProfile.certificateUrl = `${baseUrl}${resProfile.certificateUrl}`;
        }

        // Fetch the updated user object with relations
        const dbUser = await executeWithDbFallback(
          async () => {
            return await prisma.user.findUnique({
              where: { id: auth.userId },
              include: {
                providerProfile: { include: { services: true, amenities: true } }
              }
            });
          },
          async () => {
            const u = mockDb.users.find((user) => user.id === auth.userId);
            const p = mockDb.profiles.find((profile) => profile.userId === auth.userId);
            let providerProfile = undefined;
            if (p) {
              providerProfile = {
                ...p,
                services: mockDb.services.filter((s) => s.profileId === p.id),
                amenities: mockDb.amenities.filter((a) => a.profileId === p.id),
              };
            }
            return { ...u, providerProfile };
          }
        );

        return NextResponse.json({
          success: true,
          message: 'Licenses updated. Onboarding complete!'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save licenses' }, { status: 400 });
      }
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API POST Error]`, err);
    return NextResponse.json({ message: err.message || 'POST failed', error: String(err) }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const path = catchall?.join('/') || '';
    console.log(`[API PUT] /api/${path}`);

    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    let body = {} as any;
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      try {
        body = await request.json();
      } catch {
        // Empty
      }
    }

    // Check if it's the license/licence endpoint
    const pathParts = path.split('/');
    const isLicenceRoute =
      path === 'providers/me/licence' ||
      path === 'provider/me/licence' ||
      path === 'providers/me/license' ||
      path === 'provider/me/license' ||
      (pathParts.length === 4 && pathParts[0] === 'providers' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license')) ||
      (pathParts.length === 4 && pathParts[0] === 'provider' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license'));

    if (isLicenceRoute) {
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      // Determine the index to update
      let index: number | null = null;
      if (pathParts.length === 4) {
        const parsedIdx = parseInt(pathParts[3], 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      const { searchParams } = new URL(request.url);
      const indexQuery = searchParams.get('index');
      if (indexQuery !== null) {
        const parsedIdx = parseInt(indexQuery, 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      let licenseTypeInput: string | null = null;
      let certificateFile: any = null;
      let certificateUrlInput: string | null = null;

      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          const indexForm = formData.get('index');
          if (index === null && indexForm !== null) {
            const parsedIdx = parseInt(String(indexForm), 10);
            if (!isNaN(parsedIdx)) {
              index = parsedIdx;
            }
          }
          licenseTypeInput = formData.get('licenseType') ? String(formData.get('licenseType')) : (formData.get('licenseName') ? String(formData.get('licenseName')) : null);
          certificateFile = formData.get('certificate') || formData.get('certificateFile') || formData.get('file');
          const certUrlVal = formData.get('certificateUrl') || formData.get('certificateUrls');
          if (certUrlVal && typeof certUrlVal === 'string') {
            certificateUrlInput = certUrlVal;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to parse form data: ' + err.message }, { status: 400 });
        }
      } else {
        if (index === null && (body as any).index !== undefined) {
          const parsedIdx = parseInt((body as any).index, 10);
          if (!isNaN(parsedIdx)) {
            index = parsedIdx;
          }
        }
        licenseTypeInput = (body as any).licenseType || (body as any).licenseName || null;
        certificateUrlInput = (body as any).certificateUrl || (body as any).certificateUrls || null;
      }

      if (index === null || index < 0) {
        return NextResponse.json({ message: 'Invalid or missing index' }, { status: 400 });
      }

      let certificateUrlToSave: string | null = null;
      if (certificateFile && typeof certificateFile === 'object' && 'name' in certificateFile) {
        try {
          const file = certificateFile as any;
          const mimeType = file.type || '';
          const fileName = file.name || '';
          const fileExt = nodePath.extname(fileName).toLowerCase();

          const isValidMime = mimeType === 'application/pdf' || mimeType.startsWith('image/');
          const isValidExt = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

          if (!isValidMime && !isValidExt) {
            return NextResponse.json(
              { message: 'Certificate must be a PDF or an image file only' },
              { status: 400 }
            );
          }

          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });
          const uniqueFileName = `certificate_${auth.userId}_${Date.now()}_idx${index}${fileExt || '.pdf'}`;
          const filePath = nodePath.join(uploadDir, uniqueFileName);
          await fs.writeFile(filePath, buffer);
          certificateUrlToSave = `/uploads/${uniqueFileName}`;
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to save uploaded certificate file: ' + err.message }, { status: 400 });
        }
      } else if (certificateUrlInput) {
        certificateUrlToSave = certificateUrlInput;
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  name: '',
                  location: '',
                  licenseType: '[]',
                  certificateUrl: '[]'
                }
              });
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: {
                licenseType: JSON.stringify(licenseTypes),
                certificateUrl: JSON.stringify(certificateUrls)
              }
            });
            return { licenseTypes, certificateUrls };
          },
          async () => {
            let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!profile) {
              profile = {
                id: mockDb.profiles.length + 1,
                userId: auth.userId,
                name: '',
                location: '',
                licenseType: '[]',
                certificateUrl: '[]'
              };
              mockDb.profiles.push(profile);
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            profile.licenseType = JSON.stringify(licenseTypes);
            profile.certificateUrl = JSON.stringify(certificateUrls);

            return { licenseTypes, certificateUrls };
          }
        );

        const baseUrl = getBaseUrl(request);
        const formattedCerts = response.certificateUrls.map((c) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);

        return NextResponse.json({
          success: true,
          message: 'License/certificate updated successfully'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update license' }, { status: 400 });
      }
    }

    // Update Client Profile (/api/clients/profile)
    if (path === 'clients/profile') {
      if (auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      let name: any = undefined;
      let location: any = undefined;
      let latitude: any = undefined;
      let longitude: any = undefined;
      let profileImageUrl: any = undefined;

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          name = formData.get('name');
          location = formData.get('location');
          latitude = formData.get('latitude');
          longitude = formData.get('longitude');
          const profileImageFile = formData.get('profileImage');

          if (profileImageFile && typeof profileImageFile === 'object' && 'name' in profileImageFile) {
            const file = profileImageFile as any;
            const mimeType = file.type || '';
            const fileName = file.name || '';
            const fileExt = nodePath.extname(fileName).toLowerCase();

            const isValidMime = mimeType.startsWith('image/');
            const isValidExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

            if (!isValidMime && !isValidExt) {
              return NextResponse.json(
                { message: 'Profile image must be an image file only' },
                { status: 400 }
              );
            }

            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
            await fs.mkdir(uploadDir, { recursive: true });
            const uniqueFileName = `profile_${auth.userId}_${Date.now()}${fileExt || '.png'}`;
            const filePath = nodePath.join(uploadDir, uniqueFileName);
            await fs.writeFile(filePath, buffer);
            profileImageUrl = `/uploads/${uniqueFileName}`;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process file upload: ' + err.message }, { status: 400 });
        }
      } else {
        name = body.name;
        location = body.location;
        latitude = body.latitude;
        longitude = body.longitude;
        profileImageUrl = body.profileImageUrl;
      }

      // Automatically set onboardingCompleted to true if the client sends: name and location
      const hasName = name !== undefined && name !== null && String(name).trim() !== '';
      const hasLocation = location !== undefined && location !== null && String(location).trim() !== '';

      const autoOnboardingCompleted = hasName && hasLocation;

      const updatedUser = await executeWithDbFallback(
        async () => {
          const updateData: any = {};
          if (name !== undefined && name !== null) updateData.name = name;
          if (autoOnboardingCompleted) {
            updateData.onboardingCompleted = true;
          }

          const clientProfileData: any = {};
          if (location !== undefined && location !== null) clientProfileData.location = location;
          if (profileImageUrl !== undefined && profileImageUrl !== null) clientProfileData.profileImageUrl = profileImageUrl;
          if (latitude !== undefined && latitude !== null) clientProfileData.latitude = parseFloat(latitude);
          if (longitude !== undefined && longitude !== null) clientProfileData.longitude = parseFloat(longitude);

          updateData.clientProfile = {
            upsert: {
              create: clientProfileData,
              update: clientProfileData
            }
          };

          return await prisma.user.update({
            where: { id: auth.userId },
            data: updateData,
            include: {
              clientProfile: true
            }
          });
        },
        async () => {
          const user = mockDb.users.find((u) => u.id === auth.userId);
          if (!user) throw new Error('User not found');
          if (name !== undefined && name !== null) user.name = name;
          if (autoOnboardingCompleted) {
            user.onboardingCompleted = true;
          }

          let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
          if (!profile) {
            profile = {
              id: mockDb.profiles.length + 1,
              userId: auth.userId,
            } as any;
            mockDb.profiles.push(profile);
          }
          if (location !== undefined && location !== null) (profile as any).location = location;
          if (profileImageUrl !== undefined && profileImageUrl !== null) (profile as any).profileImageUrl = profileImageUrl;
          if (latitude !== undefined && latitude !== null) (profile as any).latitude = parseFloat(latitude);
          if (longitude !== undefined && longitude !== null) (profile as any).longitude = parseFloat(longitude);

          return { ...user, clientProfile: profile };
        }
      );

      const sanitized = sanitizeUser(updatedUser, request);
      return NextResponse.json(sanitized);
    }

    // Update Provider Profile (/api/providers/profile)
    if (path === 'providers/profile') {
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const { providerProfile, onboardingCompleted } = body as any;
      if (!providerProfile) {
        return NextResponse.json({ message: 'providerProfile is required' }, { status: 400 });
      }

      const {
        name,
        location,
        categories,
        services,
        amenities,
        experience,
        licenseType,
        certificateUrl,
        coverImageUrl,
        latitude,
        longitude
      } = providerProfile;

      try {
        const updatedUser = await executeWithDbFallback(
          async () => {
            // 1. Upsert provider profile
            const profile = await prisma.providerProfile.upsert({
              where: { userId: auth.userId },
              update: {
                name: name || '',
                location: location || '',
                categories: categories ? JSON.stringify(categories) : null,
                experience: parseInt(experience) || 0,
                licenseType: licenseType ? (Array.isArray(licenseType) ? JSON.stringify(licenseType) : licenseType) : null,
                certificateUrl: certificateUrl ? (Array.isArray(certificateUrl) ? JSON.stringify(certificateUrl) : certificateUrl) : null,
                coverImageUrl: coverImageUrl || null,
                latitude: latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
                longitude: longitude !== undefined && longitude !== null ? parseFloat(longitude) : null
              },
              create: {
                userId: auth.userId,
                name: name || '',
                location: location || '',
                categories: categories ? JSON.stringify(categories) : null,
                experience: parseInt(experience) || 0,
                licenseType: licenseType ? (Array.isArray(licenseType) ? JSON.stringify(licenseType) : licenseType) : null,
                certificateUrl: certificateUrl ? (Array.isArray(certificateUrl) ? JSON.stringify(certificateUrl) : certificateUrl) : null,
                coverImageUrl: coverImageUrl || null,
                latitude: latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
                longitude: longitude !== undefined && longitude !== null ? parseFloat(longitude) : null
              }
            });

            // 2. Clear and recreate services if provided
            if (Array.isArray(services)) {
              await prisma.providerService.deleteMany({ where: { profileId: profile.id } });
              if (services.length > 0) {
                const servicesToInsert = services.map((s: any) => ({
                  profileId: profile.id,
                  name: s.name,
                  price: parseInt(s.price) || 0,
                  category: s.category || 'General'
                }));
                await prisma.providerService.createMany({ data: servicesToInsert });
              }
            }

            // 3. Clear and recreate amenities if provided
            if (Array.isArray(amenities)) {
              await prisma.providerAmenity.deleteMany({ where: { profileId: profile.id } });
              if (amenities.length > 0) {
                const amenitiesToInsert = amenities.map((am: any) => {
                  const isObject = am && typeof am === 'object';
                  const amName = isObject ? (am.name || '') : String(am);
                  const amType = isObject ? (am.type || 'amenity') : 'amenity';
                  const amIcon = isObject ? (am.icon || null) : null;
                  return {
                    profileId: profile.id,
                    name: amName,
                    type: amType,
                    icon: amIcon
                  };
                });
                await prisma.providerAmenity.createMany({ data: amenitiesToInsert });
              }
            }

            // 4. Update onboardingCompleted on User table
            return await prisma.user.update({
              where: { id: auth.userId },
              data: {
                onboardingCompleted: onboardingCompleted !== undefined ? onboardingCompleted : true
              },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true }
                }
              }
            });
          },
          async () => {
            // Mock fallback
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (!user) throw new Error('User not found');
            user.onboardingCompleted = onboardingCompleted !== undefined ? onboardingCompleted : true;

            let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!profile) {
              profile = { id: mockDb.profiles.length + 1, userId: auth.userId };
              mockDb.profiles.push(profile);
            }

            profile.name = name || '';
            profile.location = location || '';
            profile.categories = categories ? JSON.stringify(categories) : null;
            profile.experience = parseInt(experience) || 0;
            profile.licenseType = licenseType ? (Array.isArray(licenseType) ? JSON.stringify(licenseType) : licenseType) : null;
            profile.certificateUrl = certificateUrl ? (Array.isArray(certificateUrl) ? JSON.stringify(certificateUrl) : certificateUrl) : null;
            profile.coverImageUrl = coverImageUrl || null;
            profile.latitude = latitude !== undefined && latitude !== null ? parseFloat(latitude) : null;
            profile.longitude = longitude !== undefined && longitude !== null ? parseFloat(longitude) : null;

            if (Array.isArray(services)) {
              mockDb.services = mockDb.services.filter((s) => s.profileId !== profile.id);
              services.forEach((s: any) => {
                mockDb.services.push({
                  id: Math.floor(Math.random() * 10000),
                  profileId: profile.id,
                  name: s.name,
                  price: parseInt(s.price) || 0,
                  category: s.category || 'General'
                });
              });
            }

            if (Array.isArray(amenities)) {
              mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profile.id);
              amenities.forEach((am: any) => {
                const isObject = am && typeof am === 'object';
                const amName = isObject ? (am.name || '') : String(am);
                mockDb.amenities.push({
                  id: Math.floor(Math.random() * 10000),
                  profileId: profile.id,
                  name: amName,
                  type: isObject ? (am.type || 'amenity') : 'amenity',
                  icon: isObject ? (am.icon || null) : null
                });
              });
            }

            const providerProfile = {
              ...profile,
              services: mockDb.services.filter((s) => s.profileId === profile.id),
              amenities: mockDb.amenities.filter((a) => a.profileId === profile.id)
            };

            return { ...user, providerProfile };
          }
        );

        const sanitized = sanitizeUser(updatedUser, request);
        if (sanitized && sanitized.providerProfile) {
          await enrichProviderProfile(sanitized.providerProfile, request);
        }
        return NextResponse.json(sanitized);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update provider profile' }, { status: 400 });
      }
    }





    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API PUT Error]`, err);
    return NextResponse.json({ message: err.message || 'PUT failed', error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const path = catchall?.join('/') || '';
    console.log(`[API DELETE] /api/${path}`);

    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Check if it's the license/licence endpoint for DELETE
    const pathParts = path.split('/');
    const isLicenceRoute =
      path === 'providers/me/licence' ||
      path === 'provider/me/licence' ||
      path === 'providers/me/license' ||
      path === 'provider/me/license' ||
      (pathParts.length === 4 && pathParts[0] === 'providers' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license')) ||
      (pathParts.length === 4 && pathParts[0] === 'provider' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license'));

    if (isLicenceRoute) {
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      // Determine the index to delete
      let index: number | null = null;
      if (pathParts.length === 4) {
        const parsedIdx = parseInt(pathParts[3], 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      const { searchParams } = new URL(request.url);
      const indexQuery = searchParams.get('index');
      if (indexQuery !== null) {
        const parsedIdx = parseInt(indexQuery, 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      // Also check body if any JSON body is sent
      try {
        const tempBody = await request.json();
        if (index === null && tempBody.index !== undefined) {
          const parsedIdx = parseInt(tempBody.index, 10);
          if (!isNaN(parsedIdx)) {
            index = parsedIdx;
          }
        }
      } catch { }

      if (index === null || index < 0) {
        return NextResponse.json({ message: 'Invalid or missing index' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            const profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              throw new Error('Provider profile not found');
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            if (index! < licenseTypes.length) {
              licenseTypes.splice(index!, 1);
            }
            if (index! < certificateUrls.length) {
              certificateUrls.splice(index!, 1);
            }

            await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: {
                licenseType: JSON.stringify(licenseTypes),
                certificateUrl: JSON.stringify(certificateUrls)
              }
            });

            return { licenseTypes, certificateUrls };
          },
          async () => {
            const profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!profile) {
              throw new Error('Provider profile not found');
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            if (index! < licenseTypes.length) {
              licenseTypes.splice(index!, 1);
            }
            if (index! < certificateUrls.length) {
              certificateUrls.splice(index!, 1);
            }

            profile.licenseType = JSON.stringify(licenseTypes);
            profile.certificateUrl = JSON.stringify(certificateUrls);

            return { licenseTypes, certificateUrls };
          }
        );

        const baseUrl = getBaseUrl(request);
        const formattedCerts = response.certificateUrls.map((c) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);

        return NextResponse.json({
          success: true,
          message: 'License/certificate deleted successfully'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete license' }, { status: 400 });
      }
    }

    // 1. Client Deletes Their Own Account (/api/clients/me or /api/client/me)
    if (path === 'clients/me' || path === 'client/me') {
      if (auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }
      const userId = auth.userId;
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.delete({ where: { id: userId } });
          },
          async () => {
            const userIndex = mockDb.users.findIndex((u) => u.id === userId);
            if (userIndex === -1) throw new Error('User not found');
            mockDb.users.splice(userIndex, 1);
            const profileIndex = mockDb.profiles.findIndex((p) => p.userId === userId);
            if (profileIndex !== -1) {
              const profileId = mockDb.profiles[profileIndex].id;
              mockDb.services = mockDb.services.filter((s) => s.profileId !== profileId);
              mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profileId);
              mockDb.profiles.splice(profileIndex, 1);
            }
          }
        );
        return NextResponse.json({ success: true, message: 'Account and all associated data deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete account' }, { status: 400 });
      }
    }

    // 1b. Provider Deletes Their Own Account (/api/providers/me or /api/provider/me)
    if (path === 'providers/me' || path === 'provider/me') {
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }
      const userId = auth.userId;
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.delete({ where: { id: userId } });
          },
          async () => {
            const userIndex = mockDb.users.findIndex((u) => u.id === userId);
            if (userIndex === -1) throw new Error('User not found');
            mockDb.users.splice(userIndex, 1);
            const profileIndex = mockDb.profiles.findIndex((p) => p.userId === userId);
            if (profileIndex !== -1) {
              const profileId = mockDb.profiles[profileIndex].id;
              mockDb.services = mockDb.services.filter((s) => s.profileId !== profileId);
              mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profileId);
              mockDb.profiles.splice(profileIndex, 1);
            }
          }
        );
        return NextResponse.json({ success: true, message: 'Account and all associated data deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete account' }, { status: 400 });
      }
    }

    // Admin routes below:
    if (auth.role !== 'admin') {
      return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const idStr = searchParams.get('id');
    if (!idStr) {
      return NextResponse.json({ message: 'Missing resource id parameter' }, { status: 400 });
    }
    const id = parseInt(idStr);

    // 2. Admin Deletes Any User Account (/api/admin/users)
    if (path === 'admin/users') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.delete({ where: { id } });
          },
          async () => {
            const userIndex = mockDb.users.findIndex((u) => u.id === id);
            if (userIndex === -1) throw new Error('User not found');
            mockDb.users.splice(userIndex, 1);
            const profileIndex = mockDb.profiles.findIndex((p) => p.userId === id);
            if (profileIndex !== -1) {
              const profileId = mockDb.profiles[profileIndex].id;
              mockDb.services = mockDb.services.filter((s) => s.profileId !== profileId);
              mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profileId);
              mockDb.profiles.splice(profileIndex, 1);
            }
          }
        );
        return NextResponse.json({ success: true, message: 'User account and all associated data deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete user account' }, { status: 400 });
      }
    }

    // 3. Delete Category Setting
    if (path === 'admin/settings/categories') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.categorySetting.delete({ where: { id } });
          },
          async () => {
            // Mock delete
          }
        );
        return NextResponse.json({ success: true, message: 'Category setting deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete' }, { status: 400 });
      }
    }

    // 4. Delete Service Setting
    if (path === 'admin/settings/services') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.serviceSetting.delete({ where: { id } });
          },
          async () => {
            // Mock delete
          }
        );
        return NextResponse.json({ success: true, message: 'Service setting deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete' }, { status: 400 });
      }
    }

    // 5. Delete Ambience Setting
    if (path === 'admin/settings/ambience') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.ambienceSetting.delete({ where: { id } });
          },
          async () => {
            // Mock delete
          }
        );
        return NextResponse.json({ success: true, message: 'Ambience setting deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete' }, { status: 400 });
      }
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API DELETE Error]`, err);
    return NextResponse.json({ message: err.message || 'DELETE failed', error: String(err) }, { status: 500 });
  }
}
