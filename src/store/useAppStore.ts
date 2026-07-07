import { create } from 'zustand';
import { authApi, usersApi, RegisterData, LoginData } from '../services/api';

export interface ServiceItem {
  id: string;
  category: string;
  name: string;
  price: number;
  isAdded: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'client' | 'provider' | '';
  providerType: 'freelancer' | 'salon' | '';
  isPhoneVerified: boolean;
  onboardingCompleted: boolean;
  providerProfile?: {
    name: string;
    location: string;
    categories: string[];
    services: { name: string; price: number }[];
    amenities: string[];
    experience: number;
    licenseType: string;
    certificateUrl?: string;
    coverImageUrl?: string;
  };
}

interface AppStoreState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Onboarding State
  currentOnboardingStep: number;
  coverImage: string | null;
  freelancerName: string;
  location: string;
  selectedCategories: string[];
  servicesCatalog: ServiceItem[];
  selectedAmenities: string[];
  yearsOfExperience: string;
  licenseName: string;
  certificateName: string | null;

  // Operations
  clearError: () => void;
  login: (data: LoginData) => Promise<boolean>;
  register: (data: RegisterData) => Promise<boolean>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  updateUserRole: (role: 'client' | 'provider', providerType?: 'freelancer' | 'salon') => Promise<void>;

  // Onboarding Operations
  setCoverImage: (img: string | null) => void;
  setFreelancerName: (name: string) => void;
  setLocation: (loc: string) => void;
  toggleCategory: (category: string) => void;
  setServicesCatalog: (services: ServiceItem[]) => void;
  toggleService: (serviceId: string) => void;
  updateServicePrice: (serviceId: string, price: number) => void;
  toggleAmenity: (amenity: string) => void;
  setCredentials: (exp: string, license: string, certName: string | null) => void;
  nextStep: () => void;
  prevStep: () => void;
  submitOnboarding: () => Promise<boolean>;
}

const PRELOADED_SERVICES: ServiceItem[] = [
  // Haircut
  { id: 'hc_1', category: 'Haircut', name: 'Classic cut', price: 35, isAdded: true },
  { id: 'hc_2', category: 'Haircut', name: 'Skin fade', price: 45, isAdded: true },
  { id: 'hc_3', category: 'Haircut', name: 'Kids cut', price: 25, isAdded: true },
  // Beard
  { id: 'bd_1', category: 'Beard', name: 'Beard trim', price: 20, isAdded: true },
  { id: 'bd_2', category: 'Beard', name: 'Hot-towel shave', price: 30, isAdded: true },
  { id: 'bd_3', category: 'Beard', name: 'Beard sculpt', price: 25, isAdded: true },
  // Hair Color
  { id: 'hc_c1', category: 'Hair Color', name: 'Root touch-up', price: 60, isAdded: true },
  { id: 'hc_c2', category: 'Hair Color', name: 'Full color', price: 100, isAdded: true },
  { id: 'hc_c3', category: 'Hair Color', name: 'Balayage', price: 150, isAdded: true },
  // Spa
  { id: 'spa_1', category: 'Spa', name: 'Aroma therapy spa', price: 80, isAdded: true },
  { id: 'spa_2', category: 'Spa', name: 'Steam treatment', price: 40, isAdded: false },
  // Facial
  { id: 'fc_1', category: 'Facial', name: 'Deep cleansing facial', price: 50, isAdded: true },
  { id: 'fc_2', category: 'Facial', name: 'Glow booster facial', price: 65, isAdded: false },
  // Nails
  { id: 'nl_1', category: 'Nails', name: 'Classic manicure', price: 30, isAdded: true },
  { id: 'nl_2', category: 'Nails', name: 'Gel pedicure', price: 45, isAdded: true },
  // Makeup
  { id: 'mk_1', category: 'Makeup', name: 'Soft glam makeup', price: 75, isAdded: true },
  { id: 'mk_2', category: 'Makeup', name: 'Full bridal makeup', price: 250, isAdded: false },
  // Body Massage
  { id: 'bm_1', category: 'Body Massage', name: 'Swedish massage (60m)', price: 90, isAdded: true },
  { id: 'bm_2', category: 'Body Massage', name: 'Deep tissue massage', price: 110, isAdded: false },
  // Threading
  { id: 'th_1', category: 'Threading', name: 'Eyebrow threading', price: 15, isAdded: true },
  // Waxing
  { id: 'wx_1', category: 'Waxing', name: 'Full arms waxing', price: 40, isAdded: true },
  // Eyelash
  { id: 'ey_1', category: 'Eyelash', name: 'Classic lash extensions', price: 85, isAdded: true },
  // Tattoo
  { id: 'tt_1', category: 'Tattoo', name: 'Small minimalist tattoo', price: 100, isAdded: true },
  // Piercing
  { id: 'pr_1', category: 'Piercing', name: 'Earlobe piercing', price: 30, isAdded: true },
  // Bridal
  { id: 'br_1', category: 'Bridal', name: 'Complete bridal package', price: 450, isAdded: true },
];

export const useAppStore = create<AppStoreState>((set, get) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('lc_token') : null,
  user: typeof window !== 'undefined' && localStorage.getItem('lc_user') ? JSON.parse(localStorage.getItem('lc_user')!) : null,
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem('lc_token') : false,
  isLoading: false,
  error: null,

  // Onboarding State
  currentOnboardingStep: 1,
  coverImage: null,
  freelancerName: '',
  location: '',
  selectedCategories: [],
  servicesCatalog: PRELOADED_SERVICES,
  selectedAmenities: [],
  yearsOfExperience: '',
  licenseName: '',
  certificateName: null,

  clearError: () => set({ error: null }),

  login: async (data: LoginData) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.login(data);
      set({
        token: response.token,
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
      });
      return true;
    } catch (err) {
      const errorResponse = err as { response?: { data?: { message?: string } }; message?: string };
      set({
        error: errorResponse.response?.data?.message || errorResponse.message || 'Login failed',
        isLoading: false
      });
      return false;
    }
  },

  register: async (data: RegisterData) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.register(data);
      set({
        token: response.token,
        user: response.user,
        isAuthenticated: true,
        isLoading: false,
      });
      return true;
    } catch (err) {
      const errorResponse = err as { response?: { data?: { message?: string } }; message?: string };
      set({
        error: errorResponse.response?.data?.message || errorResponse.message || 'Registration failed',
        isLoading: false
      });
      return false;
    }
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('lc_token');
      localStorage.removeItem('lc_user');
    }
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      currentOnboardingStep: 1,
      coverImage: null,
      freelancerName: '',
      location: '',
      selectedCategories: [],
      selectedAmenities: [],
      yearsOfExperience: '',
      licenseName: '',
      certificateName: null,
    });
  },

  fetchUser: async () => {
    try {
      const user = await usersApi.getMe();
      set({ user, isAuthenticated: true });
    } catch {
      console.warn('[Store] fetchUser failed, probably unauthenticated or offline');
    }
  },

  updateUserRole: async (role: 'client' | 'provider', providerType?: 'freelancer' | 'salon') => {
    set({ isLoading: true, error: null });
    try {
      const currentUser = get().user;
      if (!currentUser) throw new Error('No user is logged in');
      
      const updatedUser = await usersApi.updateProfile({
        role,
        providerType: providerType || null,
        onboardingCompleted: role === 'client' ? true : currentUser.onboardingCompleted,
      });
      
      set({ user: updatedUser, isLoading: false });
    } catch (err) {
      const errorResponse = err as { message?: string };
      set({ error: errorResponse.message || 'Failed to update user role', isLoading: false });
    }
  },

  // Onboarding Operations
  setCoverImage: (coverImage) => set({ coverImage }),
  setFreelancerName: (freelancerName) => set({ freelancerName }),
  setLocation: (location) => set({ location }),
  
  toggleCategory: (category) => set((state) => {
    const isSelected = state.selectedCategories.includes(category);
    const selectedCategories = isSelected
      ? state.selectedCategories.filter((c) => c !== category)
      : [...state.selectedCategories, category];
    return { selectedCategories };
  }),

  setServicesCatalog: (servicesCatalog) => set({ servicesCatalog }),

  toggleService: (serviceId) => set((state) => {
    const updated = state.servicesCatalog.map((s) => 
      s.id === serviceId ? { ...s, isAdded: !s.isAdded } : s
    );
    return { servicesCatalog: updated };
  }),

  updateServicePrice: (serviceId, price) => set((state) => {
    const updated = state.servicesCatalog.map((s) => 
      s.id === serviceId ? { ...s, price } : s
    );
    return { servicesCatalog: updated };
  }),

  toggleAmenity: (amenity) => set((state) => {
    const isSelected = state.selectedAmenities.includes(amenity);
    const selectedAmenities = isSelected
      ? state.selectedAmenities.filter((a) => a !== amenity)
      : [...state.selectedAmenities, amenity];
    return { selectedAmenities };
  }),

  setCredentials: (yearsOfExperience, licenseName, certificateName) => set({
    yearsOfExperience,
    licenseName,
    certificateName,
  }),

  nextStep: () => set((state) => ({ currentOnboardingStep: state.currentOnboardingStep + 1 })),
  prevStep: () => set((state) => ({ currentOnboardingStep: Math.max(1, state.currentOnboardingStep - 1) })),

  submitOnboarding: async () => {
    set({ isLoading: true, error: null });
    try {
      const state = get();
      const currentUser = state.user;
      if (!currentUser) throw new Error('Not logged in');

      // Aggregate only the added services that belong to selected categories
      const activeServices = state.servicesCatalog
        .filter((s) => s.isAdded && state.selectedCategories.includes(s.category))
        .map((s) => ({ name: s.name, price: s.price }));

      const providerProfile = {
        name: state.freelancerName || currentUser.name || 'Maison Lumière',
        location: state.location,
        categories: state.selectedCategories,
        services: activeServices,
        amenities: state.selectedAmenities,
        experience: parseInt(state.yearsOfExperience) || 0,
        licenseType: state.licenseName,
        certificateUrl: state.certificateName || 'uploaded_cert.pdf',
        coverImageUrl: state.coverImage || '/api/placeholder/800/400',
      };

      const updatedUser = await usersApi.updateProfile({
        onboardingCompleted: true,
        providerProfile,
      });

      set({ user: updatedUser, isLoading: false, currentOnboardingStep: 1 });
      return true;
    } catch (err) {
      const errorResponse = err as { message?: string };
      set({ error: errorResponse.message || 'Onboarding submit failed', isLoading: false });
      return false;
    }
  }
}));
