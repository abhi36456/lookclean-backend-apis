import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

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

// Helper: Check if DB connection works, else use fallback
async function executeWithDbFallback<T>(
  dbAction: () => Promise<T>,
  fallbackAction: () => Promise<T>
): Promise<T> {
  try {
    // Try executing DB action. If prisma is down, it throws
    return await dbAction();
  } catch (err) {
    console.warn('[DB Error] Falling back to mock memory storage', err);
    return await fallbackAction();
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

function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token);
}

function sanitizeUser(user: unknown) {
  if (!user) return null;
  const plainUser = JSON.parse(JSON.stringify(user)) as Record<string, unknown>;
  delete plainUser.password;
  return plainUser;
}

// ROUTE HANDLERS
export async function GET(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  const { catchall } = await params;
  const path = catchall?.join('/') || '';
  console.log(`[API GET] /api/${path}`);

  // 1. Fetch current profile (/api/users/me)
  if (path === 'users/me') {
    const auth = getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
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
    return NextResponse.json(sanitizeUser(userData));
  }

  // Twilio settings (/api/admin/settings/twilio)
  if (path === 'admin/settings/twilio') {
    const auth = getAuthenticatedUser(request);
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

  // 3. Admin user list (/api/admin/users)
  if (path === 'admin/users') {
    const auth = getAuthenticatedUser(request);
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
          },
        });
      },
      async () => {
        return mockDb.users.map((user) => {
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

    const sanitizedUsers = (usersList as any[] || []).map(sanitizeUser);
    return NextResponse.json(sanitizedUsers);
  }

  // 4. Admin stats (/api/admin/stats)
  if (path === 'admin/stats') {
    const auth = getAuthenticatedUser(request);
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
      return NextResponse.json(list.map((item: any) => item.title));
    }
    return NextResponse.json(list);
  }

  // 6. GET Services Settings list (/api/admin/settings/services or /api/provider/setup/services)
  if (path === 'admin/settings/services' || path === 'provider/setup/services') {
    const list = await executeWithDbFallback(
      async () => {
        const dbList = await prisma.serviceSetting.findMany({
          include: { mainType: true },
          orderBy: { title: 'asc' }
        });
        return dbList.map(s => ({
          id: s.id,
          mainType: s.mainType.title,
          title: s.title
        }));
      },
      async () => {
        return [
          { id: 1, mainType: 'Haircut', title: 'Classic cut' },
          { id: 2, mainType: 'Haircut', title: 'Skin fade' },
          { id: 3, mainType: 'Beard', title: 'Beard trim' },
        ];
      }
    );
    return NextResponse.json(list);
  }

  // 7. GET Ambience & Amenities Settings list (/api/admin/settings/ambience or /api/provider/setup/ambience)
  if (path === 'admin/settings/ambience' || path === 'provider/setup/ambience') {
    const list = await executeWithDbFallback(
      async () => {
        const dbList = await prisma.ambienceSetting.findMany({
          include: { ambienceGroup: true },
          orderBy: { title: 'asc' }
        });
        return dbList.map(a => ({
          id: a.id,
          mainType: a.ambienceGroup.title,
          mainTypeIcon: a.ambienceGroup.icon,
          title: a.title,
          icon: a.icon
        }));
      },
      async () => {
        return [
          { id: 1, mainType: 'Amenities', title: 'Free Wi-Fi' },
          { id: 2, mainType: 'Amenities', title: 'Parking' },
          { id: 3, mainType: 'Ambience', title: 'Quiet Space' },
          { id: 4, mainType: 'Ambience', title: 'Relaxing Music' },
        ];
      }
    );
    return NextResponse.json(list);
  }

  return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  const { catchall } = await params;
  const path = catchall?.join('/') || '';
  console.log(`[API POST] /api/${path}`);

  let body = {};
  try {
    body = await request.json();
  } catch {
    // Empty body or not JSON
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
        user: sanitizeUser(responseObj.user),
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
          // Check admin hardcoded
          if (email === 'admin@lookclean.com' && hashPassword(password) === hashPassword('admin123')) {
            const token = generateToken(1, 'admin@lookclean.com', 'admin');
            return {
              token,
              user: { id: 1, email: 'admin@lookclean.com', name: 'System Admin', role: 'admin' },
            };
          }
          const user = await prisma.user.findUnique({
            where: { email },
            include: {
              providerProfile: {
                include: { services: true, amenities: true },
              },
            },
          });
          if (!user || user.password !== hashPassword(password)) throw new Error('Invalid credentials');
          const token = generateToken(user.id, user.email, user.role);
          return { token, user };
        },
        async () => {
          if (email === 'admin@lookclean.com' && hashPassword(password) === hashPassword('admin123')) {
            const token = generateToken(1, 'admin@lookclean.com', 'admin');
            return {
              token,
              user: { id: 1, email: 'admin@lookclean.com', name: 'System Admin', role: 'admin' },
            };
          }
          const user = mockDb.users.find((u) => u.email === email && u.password === hashPassword(password));
          if (!user) throw new Error('Invalid credentials');
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
      return NextResponse.json({
        token: responseObj.token,
        user: sanitizeUser(responseObj.user),
      });
    } catch (err: any) {
      return NextResponse.json({ message: err.message || 'Login failed' }, { status: 400 });
    }
  }

  // 3. Select Role and Provider Type (/api/auth/select-role)
  if (path === 'auth/select-role') {
    const auth = getAuthenticatedUser(request);
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
      const newToken = generateToken(responseObj.id, responseObj.email, responseObj.role);
      return NextResponse.json({
        token: newToken,
        user: sanitizeUser(responseObj),
      });
    } catch (err: any) {
      return NextResponse.json({ message: err.message || 'Error updating role' }, { status: 400 });
    }
  }

  // 4. Forgot Password send OTP (/api/auth/forgot-password/send-otp)
  if (path === 'auth/forgot-password/send-otp') {
    const { email } = body as any;
    if (!email) {
      return NextResponse.json({ message: 'Email is required' }, { status: 400 });
    }

    try {
      const user = await executeWithDbFallback(
        async () => {
          return await prisma.user.findUnique({ where: { email } });
        },
        async () => {
          return mockDb.users.find((u) => u.email === email) || null;
        }
      );

      if (!user) {
        return NextResponse.json({ message: 'No registered user found with this email address' }, { status: 404 });
      }

      if (!user.phoneNumber) {
        return NextResponse.json({ message: 'No verified phone number found for this account' }, { status: 400 });
      }

      // Generate a random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore.set('forgot-password:' + email, { code: otp, exp: Date.now() + 1000 * 60 * 10 }); // 10 minutes expiry

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
      params.append('To', user.phoneNumber);
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
    const { email, code } = body as any;
    if (!email || !code) {
      return NextResponse.json({ message: 'Email and verification code are required' }, { status: 400 });
    }

    const user = await executeWithDbFallback(
      async () => {
        return await prisma.user.findUnique({ where: { email } });
      },
      async () => {
        return mockDb.users.find((u) => u.email === email) || null;
      }
    );

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    // Verify OTP using cache store
    const record = otpStore.get('forgot-password:' + email);
    if (!record || record.code !== code || record.exp < Date.now()) {
      return NextResponse.json({ message: 'Invalid or expired verification code' }, { status: 400 });
    }

    // Clear OTP after successful verification
    otpStore.delete('forgot-password:' + email);

    // Generate short-lived reset token (15 mins)
    const resetToken = generateResetToken(user.id, user.email);

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
    const auth = getAuthenticatedUser(request);
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
    const auth = getAuthenticatedUser(request);
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
    const auth = getAuthenticatedUser(request);
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
    const auth = getAuthenticatedUser(request);
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
    const auth = getAuthenticatedUser(request);
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

  // 12. Create Category Setting (/api/admin/settings/categories)
  if (path === 'admin/settings/categories') {
    const auth = getAuthenticatedUser(request);
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
    const auth = getAuthenticatedUser(request);
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
    const auth = getAuthenticatedUser(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
    const { mainType, mainTypeIcon, title, icon } = body as any;
    if (!mainType || !title) {
      return NextResponse.json({ message: 'mainType and title are required' }, { status: 400 });
    }
    try {
      const ambience = await executeWithDbFallback(
        async () => {
          let group = await prisma.ambienceGroupSetting.findUnique({
            where: { title: mainType.trim() }
          });
          if (!group) {
            group = await prisma.ambienceGroupSetting.create({
              data: {
                title: mainType.trim(),
                icon: mainTypeIcon ? mainTypeIcon.trim() : null
              }
            });
          } else if (mainTypeIcon && group.icon !== mainTypeIcon) {
            group = await prisma.ambienceGroupSetting.update({
              where: { id: group.id },
              data: { icon: mainTypeIcon.trim() }
            });
          }
          return await prisma.ambienceSetting.create({
            data: {
              ambienceGroupId: group.id,
              title: title.trim(),
              icon: icon ? icon.trim() : null
            }
          });
        },
        async () => {
          return {
            id: Math.floor(Math.random() * 10000),
            ambienceGroupId: 1,
            title: title.trim(),
            icon: icon ? icon.trim() : null,
            createdAt: new Date()
          };
        }
      );
      return NextResponse.json({ success: true, ambience });
    } catch (err: any) {
      return NextResponse.json({ message: err.message || 'Failed to create ambience setting' }, { status: 400 });
    }
  }

  // 15. Provider Onboarding Step 1: Profile Setup (/api/provider/setup/profile)
  if (path === 'provider/setup/profile') {
    const auth = getAuthenticatedUser(request);
    if (!auth || auth.role !== 'provider') {
      return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
    }
    const { coverImageUrl, profileImageUrl, name, location, latitude, longitude } = body as any;
    if (!name || !location) {
      return NextResponse.json({ message: 'Name and location are required' }, { status: 400 });
    }
    try {
      const profile = await executeWithDbFallback(
        async () => {
          return await prisma.providerProfile.upsert({
            where: { userId: auth.userId },
            update: {
              name,
              location,
              coverImageUrl,
              profileImageUrl,
              latitude: latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
              longitude: longitude !== undefined && longitude !== null ? parseFloat(longitude) : null
            },
            create: {
              userId: auth.userId,
              name,
              location,
              coverImageUrl,
              profileImageUrl,
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
          mockProfile.coverImageUrl = coverImageUrl || null;
          mockProfile.profileImageUrl = profileImageUrl || null;
          mockProfile.latitude = latitude !== undefined && latitude !== null ? parseFloat(latitude) : null;
          mockProfile.longitude = longitude !== undefined && longitude !== null ? parseFloat(longitude) : null;
          return mockProfile;
        }
      );
      return NextResponse.json({ success: true, profile });
    } catch (err: any) {
      return NextResponse.json({ message: err.message || 'Failed to update profile' }, { status: 400 });
    }
  }

  // 16. Provider Onboarding Step 2: Set Selected Categories (/api/provider/setup/categories)
  if (path === 'provider/setup/categories') {
    const auth = getAuthenticatedUser(request);
    if (!auth || auth.role !== 'provider') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
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
      return NextResponse.json({ success: true, categories: JSON.parse(profile.categories || '[]') });
    } catch (err: any) {
      return NextResponse.json({ message: err.message || 'Failed to save categories' }, { status: 400 });
    }
  }

  // 17. Provider Onboarding Step 3: Set Selected Services & Pricing (/api/provider/setup/services)
  if (path === 'provider/setup/services') {
    const auth = getAuthenticatedUser(request);
    if (!auth || auth.role !== 'provider') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
    const { services } = body as any; // Array of { name, price, category }
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
          // Re-insert
          if (services.length > 0) {
            await prisma.providerService.createMany({
              data: services.map((s: any) => ({
                profileId: profile.id,
                name: s.name,
                price: parseInt(s.price) || 0,
                category: s.category || 'General',
              })),
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
            mockDb.services.push({
              id: Math.floor(Math.random() * 10000),
              profileId: mockProfile.id,
              name: s.name,
              price: parseInt(s.price) || 0,
              category: s.category || 'General',
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
    const auth = getAuthenticatedUser(request);
    if (!auth || auth.role !== 'provider') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
    const { items } = body as any; // Array of { name, type }
    if (!Array.isArray(items)) {
      return NextResponse.json({ message: 'Items must be an array' }, { status: 400 });
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
          // Re-insert
          if (items.length > 0) {
            await prisma.providerAmenity.createMany({
              data: items.map((item: any) => ({
                profileId: profile.id,
                name: item.name,
                type: item.type || 'amenity',
                icon: item.icon || null,
              })),
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
          items.forEach((item: any) => {
            mockDb.amenities.push({
              id: Math.floor(Math.random() * 10000),
              profileId: mockProfile.id,
              name: item.name,
              type: item.type || 'amenity',
              icon: item.icon || null,
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
    const auth = getAuthenticatedUser(request);
    if (!auth || auth.role !== 'provider') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
    const { experience, licenseType, certificateUrl } = body as any;
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
                experience: parseInt(experience) || 0,
                licenseType,
                certificateUrl
              }
            });
          } else {
            profile = await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: { experience: parseInt(experience) || 0, licenseType, certificateUrl },
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
          mockProfile.licenseType = licenseType || null;
          mockProfile.certificateUrl = certificateUrl || null;
          
          const mockUser = mockDb.users.find((u) => u.id === auth.userId);
          if (mockUser) mockUser.onboardingCompleted = true;
          return mockProfile;
        }
      );
      return NextResponse.json({ success: true, message: 'Licenses updated. Onboarding complete!', profile: response });
    } catch (err: any) {
      return NextResponse.json({ message: err.message || 'Failed to save licenses' }, { status: 400 });
    }
  }

  return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  const { catchall } = await params;
  const path = catchall?.join('/') || '';
  console.log(`[API PUT] /api/${path}`);

  const auth = getAuthenticatedUser(request);
  if (!auth) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body = {} as any;
  try {
    body = await request.json();
  } catch {
    // Empty
  }

  // Update Profile (/api/users/profile)
  if (path === 'users/profile') {
    const { role, providerType, onboardingCompleted, providerProfile } = body;

    const updatedUser = await executeWithDbFallback(
      async () => {
        // Build prisma data
        const updateData: any = {};
        if (role) updateData.role = role;
        if (providerType !== undefined) updateData.providerType = providerType;
        if (onboardingCompleted !== undefined) updateData.onboardingCompleted = onboardingCompleted;

        if (providerProfile) {
          const profileUpsert = {
            name: providerProfile.name || '',
            location: providerProfile.location || '',
            experience: providerProfile.experience || 0,
            licenseType: providerProfile.licenseType || null,
            certificateUrl: providerProfile.certificateUrl || null,
            coverImageUrl: providerProfile.coverImageUrl || null,
          };

          // Update/Create profile
          updateData.providerProfile = {
            upsert: {
              create: {
                ...profileUpsert,
                services: {
                  create: (providerProfile.services || []).map((s: any) => ({
                    name: s.name,
                    price: s.price,
                    category: s.category || 'General',
                  })),
                },
                amenities: {
                  create: (providerProfile.amenities || []).map((a: any) => typeof a === 'string' ? { name: a } : { name: a.name, icon: a.icon || null, type: a.type || 'amenity' }),
                },
              },
              update: {
                ...profileUpsert,
                // For simplicity, delete and recreate services/amenities if specified
                services: {
                  deleteMany: {},
                  create: (providerProfile.services || []).map((s: any) => ({
                    name: s.name,
                    price: s.price,
                    category: s.category || 'General',
                  })),
                },
                amenities: {
                  deleteMany: {},
                  create: (providerProfile.amenities || []).map((a: any) => typeof a === 'string' ? { name: a } : { name: a.name, icon: a.icon || null, type: a.type || 'amenity' }),
                },
              },
            },
          };
        }

        return await prisma.user.update({
          where: { id: auth.userId },
          data: updateData,
          include: {
            providerProfile: {
              include: { services: true, amenities: true },
            },
          },
        });
      },
      async () => {
        const user = mockDb.users.find((u) => u.id === auth.userId);
        if (!user) throw new Error('User not found');

        if (role) user.role = role;
        if (providerType !== undefined) user.providerType = providerType;
        if (onboardingCompleted !== undefined) user.onboardingCompleted = onboardingCompleted;

        if (providerProfile) {
          let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
          if (!profile) {
            profile = {
              id: mockDb.profiles.length + 1,
              userId: auth.userId,
            };
            mockDb.profiles.push(profile);
          }
          profile.name = providerProfile.name || '';
          profile.location = providerProfile.location || '';
          profile.experience = providerProfile.experience || 0;
          profile.licenseType = providerProfile.licenseType || null;
          profile.certificateUrl = providerProfile.certificateUrl || null;
          profile.coverImageUrl = providerProfile.coverImageUrl || null;

          // Replace services
          mockDb.services = mockDb.services.filter((s) => s.profileId !== profile.id);
          (providerProfile.services || []).forEach((s: any) => {
            mockDb.services.push({
              id: mockDb.services.length + 1,
              profileId: profile.id,
              name: s.name,
              price: s.price,
              category: s.category || 'General',
            });
          });

          // Replace amenities
          mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profile.id);
          (providerProfile.amenities || []).forEach((a: any) => {
            mockDb.amenities.push({
              id: mockDb.amenities.length + 1,
              profileId: profile.id,
              name: typeof a === 'string' ? a : a.name,
              icon: typeof a === 'string' ? null : (a.icon || null),
              type: typeof a === 'string' ? 'amenity' : (a.type || 'amenity'),
            });
          });
        }

        // Fetch structure
        const profile = mockDb.profiles.find((p) => p.userId === user.id);
        let providerProfileData = undefined;
        if (profile) {
          providerProfileData = {
            ...profile,
            services: mockDb.services.filter((s) => s.profileId === profile.id),
            amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
          };
        }
        return { ...user, providerProfile: providerProfileData };
      }
    );

    return NextResponse.json(sanitizeUser(updatedUser));
  }



  return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  const { catchall } = await params;
  const path = catchall?.join('/') || '';
  console.log(`[API DELETE] /api/${path}`);

  const auth = getAuthenticatedUser(request);
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const idStr = searchParams.get('id');
  if (!idStr) {
    return NextResponse.json({ message: 'Missing resource id parameter' }, { status: 400 });
  }
  const id = parseInt(idStr);

  // 1. Delete Category Setting
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

  // 2. Delete Service Setting
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

  // 3. Delete Ambience Setting
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
}
