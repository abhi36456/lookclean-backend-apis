import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to inject JWT token
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('lc_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Check if backend is available, else we run simulated mode
let useMock = true;

export interface RegisterData {
  email: string;
  password?: string;
}

export interface LoginData {
  email: string;
  password?: string;
}

export interface ProfileData {
  role?: 'client' | 'provider' | '';
  providerType?: 'freelancer' | 'salon' | null;
  onboardingCompleted?: boolean;
  isPhoneVerified?: boolean;
  providerProfile?: Record<string, unknown>;
}

// Define default mocks for registration/login / users / etc.
export const mockApi = {
  async register(data: RegisterData) {
    console.log('[Mock API] Register called', data);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const token = 'mock_jwt_token_' + Math.random().toString(36).substring(7);
    const mockUser = {
      id: 'usr_1',
      email: data.email,
      name: '',
      role: '',
      providerType: null,
      isPhoneVerified: false,
      onboardingCompleted: false,
    };
    if (typeof window !== 'undefined') {
      localStorage.setItem('lc_token', token);
      localStorage.setItem('lc_user', JSON.stringify(mockUser));
    }
    return { token, user: mockUser };
  },

  async login(data: LoginData) {
    console.log('[Mock API] Login called', data);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const token = 'mock_jwt_token_logged_in';
    const storedUserStr = typeof window !== 'undefined' ? localStorage.getItem('lc_user') : null;
    let mockUser = storedUserStr ? JSON.parse(storedUserStr) : null;
    
    if (!mockUser || mockUser.email !== data.email) {
      mockUser = {
        id: 'usr_2',
        email: data.email,
        name: 'John Doe',
        role: 'provider',
        providerType: 'freelancer',
        isPhoneVerified: true,
        onboardingCompleted: true,
        providerProfile: {
          name: 'Maison Lumière',
          location: 'Downtown Manhattan',
          categories: ['Haircut', 'Beard'],
          services: [
            { name: 'Classic cut', price: 35 },
            { name: 'Skin fade', price: 45 },
            { name: 'Beard trim', price: 20 }
          ],
          amenities: ['AC waiting area', 'Tidy & hygienic'],
          experience: 8,
          licenseType: 'State Cosmetology License',
          certificateUrl: 'certificate.pdf'
        }
      };
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('lc_token', token);
      localStorage.setItem('lc_user', JSON.stringify(mockUser));
    }
    return { token, user: mockUser };
  },

  async getMe() {
    console.log('[Mock API] getMe called');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const storedUserStr = typeof window !== 'undefined' ? localStorage.getItem('lc_user') : null;
    if (!storedUserStr) throw new Error('Not authenticated');
    return JSON.parse(storedUserStr);
  },

  async updateProfile(profileData: ProfileData) {
    console.log('[Mock API] updateProfile called', profileData);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const storedUserStr = typeof window !== 'undefined' ? localStorage.getItem('lc_user') : null;
    if (!storedUserStr) throw new Error('Not authenticated');
    const user = JSON.parse(storedUserStr);
    const updatedUser = {
      ...user,
      ...profileData,
    };
    if (typeof window !== 'undefined') {
      localStorage.setItem('lc_user', JSON.stringify(updatedUser));
    }
    return updatedUser;
  },

  async sendSmsOtp(phoneNumber: string) {
    console.log('[Mock API] sendSmsOtp to', phoneNumber);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { success: true, message: 'OTP Sent successfully' };
  },

  async verifySmsOtp(phoneNumber: string, code: string) {
    console.log('[Mock API] verifySmsOtp for', phoneNumber, 'code', code);
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (code !== '123456' && code !== '1234') {
      throw new Error('Invalid verification code. Try "1234"');
    }
    const storedUserStr = typeof window !== 'undefined' ? localStorage.getItem('lc_user') : null;
    if (storedUserStr) {
      const user = JSON.parse(storedUserStr);
      user.isPhoneVerified = true;
      localStorage.setItem('lc_user', JSON.stringify(user));
    }
    return { success: true };
  },

  async sendForgotPasswordOtp(email: string) {
    console.log('[Mock API] sendForgotPasswordOtp to', email);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { success: true, message: 'Reset OTP sent' };
  },

  async verifyForgotPasswordOtp(email: string, code: string) {
    console.log('[Mock API] verifyForgotPasswordOtp for', email, 'code', code);
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (code !== '123456' && code !== '1234') {
      throw new Error('Invalid code. Try "1234"');
    }
    return { token: 'reset_temp_token_abc123' };
  },

  async resetPassword(token: string, password: string) {
    console.log('[Mock API] resetPassword with token', token, 'and new password length', password.length);
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { success: true };
  }
};

// API Wrapper functions which will try to call the real API first, and fallback to mock if backend is down or not found.
export const authApi = {
  register: async (data: RegisterData) => {
    if (useMock) return mockApi.register(data);
    try {
      const response = await apiClient.post('/auth/register', data);
      return response.data;
    } catch (err) {
      console.warn('Real API Register failed, using mock API', err);
      return mockApi.register(data);
    }
  },

  login: async (data: LoginData) => {
    if (useMock) return mockApi.login(data);
    try {
      const response = await apiClient.post('/auth/login', data);
      return response.data;
    } catch (err) {
      console.warn('Real API Login failed, using mock API', err);
      return mockApi.login(data);
    }
  },

  selectRole: async (role: string, providerType?: string) => {
    if (useMock) {
      console.log('[Mock API] selectRole called', { role, providerType });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const storedUserStr = typeof window !== 'undefined' ? localStorage.getItem('lc_user') : null;
      if (!storedUserStr) throw new Error('Not authenticated');
      const user = JSON.parse(storedUserStr);
      user.role = role;
      user.providerType = providerType || null;
      const token = 'mock_jwt_token_' + role + '_' + Math.random().toString(36).substring(7);
      if (typeof window !== 'undefined') {
        localStorage.setItem('lc_token', token);
        localStorage.setItem('lc_user', JSON.stringify(user));
      }
      return { token, user };
    }
    try {
      const response = await apiClient.post('/auth/select-role', { role, providerType });
      if (response.data && response.data.token) {
        localStorage.setItem('lc_token', response.data.token);
        localStorage.setItem('lc_user', JSON.stringify(response.data.user));
      }
      return response.data;
    } catch (err) {
      console.warn('Real API selectRole failed, using mock API', err);
      const storedUserStr = typeof window !== 'undefined' ? localStorage.getItem('lc_user') : null;
      if (!storedUserStr) throw new Error('Not authenticated');
      const user = JSON.parse(storedUserStr);
      user.role = role;
      user.providerType = providerType || null;
      const token = 'mock_jwt_token_' + role + '_' + Math.random().toString(36).substring(7);
      if (typeof window !== 'undefined') {
        localStorage.setItem('lc_token', token);
        localStorage.setItem('lc_user', JSON.stringify(user));
      }
      return { token, user };
    }
  },

  sendForgotPasswordOtp: async (email: string) => {
    if (useMock) return mockApi.sendForgotPasswordOtp(email);
    try {
      const response = await apiClient.post('/auth/forgot-password/send-otp', { email });
      return response.data;
    } catch {
      return mockApi.sendForgotPasswordOtp(email);
    }
  },

  verifyForgotPasswordOtp: async (email: string, code: string) => {
    if (useMock) return mockApi.verifyForgotPasswordOtp(email, code);
    try {
      const response = await apiClient.post('/auth/forgot-password/verify-otp', { email, code });
      return response.data;
    } catch {
      return mockApi.verifyForgotPasswordOtp(email, code);
    }
  },

  resetPassword: async (token: string, password: string) => {
    if (useMock) return mockApi.resetPassword(token, password);
    try {
      const response = await apiClient.post('/auth/forgot-password/reset', { token, password });
      return response.data;
    } catch {
      return mockApi.resetPassword(token, password);
    }
  }
};

export const usersApi = {
  getMe: async () => {
    if (useMock) return mockApi.getMe();
    try {
      const response = await apiClient.get('/users/me');
      return response.data;
    } catch {
      return mockApi.getMe();
    }
  },

  updateProfile: async (profileData: ProfileData) => {
    if (useMock) return mockApi.updateProfile(profileData);
    try {
      const response = await apiClient.put('/users/profile', profileData);
      return response.data;
    } catch {
      return mockApi.updateProfile(profileData);
    }
  },

  sendSmsOtp: async (phoneNumber: string) => {
    if (useMock) return mockApi.sendSmsOtp(phoneNumber);
    try {
      const response = await apiClient.post('/users/verify/mobile/send', { phoneNumber });
      return response.data;
    } catch {
      return mockApi.sendSmsOtp(phoneNumber);
    }
  },

  verifySmsOtp: async (phoneNumber: string, code: string) => {
    if (useMock) return mockApi.verifySmsOtp(phoneNumber, code);
    try {
      const response = await apiClient.post('/users/verify/mobile', { phoneNumber, code });
      return response.data;
    } catch {
      return mockApi.verifySmsOtp(phoneNumber, code);
    }
  }
};

export const settingsApi = {
  getTwilioSettings: async () => {
    try {
      const response = await apiClient.get('/admin/settings/twilio');
      return response.data;
    } catch {
      return {
        activeMode: 'staging',
        staging: { accountSid: 'ACstaging1234567890abcdef1234567890', authToken: 'token_staging_abc123', phoneNumber: '+15005550006' },
        live: { accountSid: 'AClive0987654321fedcba09876543210', authToken: 'token_live_xyz789', phoneNumber: '+15005550001' }
      };
    }
  },
  saveTwilioSettings: async (settings: any) => {
    try {
      const response = await apiClient.post('/admin/settings/twilio', settings);
      return response.data;
    } catch {
      return { success: true };
    }
  },
  verifyTwilioConnection: async (data: any) => {
    try {
      const response = await apiClient.post('/admin/settings/twilio/verify', data);
      return response.data;
    } catch (err: any) {
      if (err.response && err.response.data) return err.response.data;
      throw err;
    }
  },
  changeAdminPassword: async (data: any) => {
    try {
      const response = await apiClient.post('/admin/change-password', data);
      return response.data;
    } catch (err: any) {
      if (err.response && err.response.data) return err.response.data;
      throw err;
    }
  }
};

// Check backend connectivity asynchronously to set useMock
if (typeof window !== 'undefined') {
  axios.get(`${API_BASE_URL}/auth/health`, { timeout: 1000 })
    .then(() => {
      useMock = false;
      console.log('[API] Backend online, mock disabled.');
    })
    .catch(() => {
      useMock = true;
      console.log('[API] Backend unreachable or no health check, using mock fallback.');
    });
}
