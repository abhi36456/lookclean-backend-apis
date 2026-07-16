'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert, LogOut, Search, Filter, ShieldCheck, Phone, Check,
  X, Calendar, Star, MapPin, Award, Clock, Users, Building, Activity, FileText, ChevronRight, Settings, Lock, Server, Globe, Tag, Scissors, Sparkles, Database
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Card from '@/components/Card';

interface UserData {
  id: number;
  email: string;
  name: string;
  role: 'client' | 'provider' | 'admin';
  providerType?: 'freelancer' | 'salon' | null;
  isPhoneVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: string;
  providerProfile?: {
    name: string;
    location: string;
    profileImageUrl?: string | null;
    experience: number;
    licenseType?: string;
    certificateUrl?: string;
    coverImageUrl?: string;
    services?: { name: string; price: number; category: string }[];
    amenities?: { name: string }[];
  };
  clientProfile?: {
    location?: string | null;
    profileImageUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // Login form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Routing and Navigation state
  const pathname = usePathname();
  const router = useRouter();

  // Derive activeTab from pathname
  const activeTab = pathname.endsWith('/users') ? 'users' : (pathname.endsWith('/settings') ? 'settings' : 'dashboard');

  const handleTabChange = (tab: 'dashboard' | 'users' | 'settings') => {
    if (tab === 'users') {
      router.push('/admin/users');
    } else if (tab === 'settings') {
      router.push('/admin/settings');
    } else {
      router.push('/admin');
    }
  };

  // Dashboard state
  const [users, setUsers] = useState<UserData[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    clients: 0,
    providers: 0,
    verifiedPhone: 0,
    verifiedDocs: 0,
  });
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'client' | 'provider'>('all');

  // Drawer state
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Settings tab state
  const [settingsSubTab, setSettingsSubTab] = useState<'password' | 'twilio' | 'categories' | 'services' | 'ambience' | 'database'>('password');

  // Categories CRUD state
  const [categoriesList, setCategoriesList] = useState<{ id: number; title: string }[]>([]);
  const [newCategoryTitle, setNewCategoryTitle] = useState('');
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // Services CRUD state
  const [servicesList, setServicesList] = useState<{ id: number; mainType: string; title: string }[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Add Service Modal state
  const [addServiceModalOpen, setAddServiceModalOpen] = useState(false);
  const [activeAddServiceCategory, setActiveAddServiceCategory] = useState('');
  const [newModalServiceTitle, setNewModalServiceTitle] = useState('');

  // Add Category with First Service state
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [newCategoryFormTitle, setNewCategoryFormTitle] = useState('');
  const [newCategoryFirstServiceTitle, setNewCategoryFirstServiceTitle] = useState('');

  // Ambience/Amenities CRUD state
  const [ambienceList, setAmbienceList] = useState<{ id: number; mainType: string; mainTypeIcon?: string; title: string; icon?: string }[]>([]);
  const [ambienceLoading, setAmbienceLoading] = useState(false);

  // Add Item to Group Modal state
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [activeAddItemGroup, setActiveAddItemGroup] = useState('');
  const [activeAddItemGroupIcon, setActiveAddItemGroupIcon] = useState('');
  const [newModalItemTitle, setNewModalItemTitle] = useState('');
  const [newModalItemSvg, setNewModalItemSvg] = useState<File | null>(null);

  // Add New Group state
  const [isAddingNewGroup, setIsAddingNewGroup] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupFirstItemTitle, setNewGroupFirstItemTitle] = useState('');
  const [newGroupCsv, setNewGroupCsv] = useState<File | null>(null);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Twilio settings state
  const [twilioMode, setTwilioMode] = useState<'staging' | 'live'>('staging');
  const [stagingSid, setStagingSid] = useState('');
  const [stagingToken, setStagingToken] = useState('');
  const [stagingNumber, setStagingNumber] = useState('');
  const [stagingVerificationServiceId, setStagingVerificationServiceId] = useState('');
  const [stagingMessagingServiceSid, setStagingMessagingServiceSid] = useState('');
  const [testPhoneStaging, setTestPhoneStaging] = useState('');
  const [liveSid, setLiveSid] = useState('');
  const [liveToken, setLiveToken] = useState('');
  const [liveNumber, setLiveNumber] = useState('');
  const [liveVerificationServiceId, setLiveVerificationServiceId] = useState('');
  const [liveMessagingServiceSid, setLiveMessagingServiceSid] = useState('');
  const [testPhoneLive, setTestPhoneLive] = useState('');
  const [twilioSuccess, setTwilioSuccess] = useState('');
  const [twilioError, setTwilioError] = useState('');
  const [twilioSaveLoading, setTwilioSaveLoading] = useState(false);
  const [verifyStagingLoading, setVerifyStagingLoading] = useState(false);
  const [verifyLiveLoading, setVerifyLiveLoading] = useState(false);

  // Database check states
  const [dbChecking, setDbChecking] = useState(false);
  const [dbStatusResult, setDbStatusResult] = useState<{
    checked: boolean;
    connected: boolean;
    message: string;
    error?: string;
    databaseUrl?: string;
  } | null>(null);

  const handleCheckDatabaseConnection = async () => {
    setDbChecking(true);
    setDbStatusResult(null);
    try {
      const res = await fetch('/api/admin/settings/database/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      setDbStatusResult({
        checked: true,
        connected: data.connected,
        message: data.message,
        error: data.error,
        databaseUrl: data.databaseUrl,
      });
    } catch (err: any) {
      setDbStatusResult({
        checked: true,
        connected: false,
        message: 'Could not contact the connection-checking API.',
        error: String(err),
      });
    } finally {
      setDbChecking(false);
    }
  };

  // Fetch configs dynamically on sub-tab change
  useEffect(() => {
    if (isAuthenticated && token && activeTab === 'settings') {
      if (settingsSubTab === 'categories') {
        fetchCategories();
      } else if (settingsSubTab === 'services') {
        fetchCategories();
        fetchServices();
      } else if (settingsSubTab === 'ambience') {
        fetchAmbience();
      }
    }
  }, [isAuthenticated, token, activeTab, settingsSubTab]);

  // Read URL hash on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleHashChange = () => {
        const hash = window.location.hash.replace('#', '');
        if (['password', 'twilio', 'categories', 'services', 'ambience', 'database'].includes(hash)) {
          setSettingsSubTab(hash as any);
        }
      };
      handleHashChange();
      window.addEventListener('hashchange', handleHashChange);
      return () => window.removeEventListener('hashchange', handleHashChange);
    }
  }, []);

  // Sync state to URL hash
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const currentHash = window.location.hash.replace('#', '');
      if (currentHash !== settingsSubTab) {
        window.location.hash = settingsSubTab;
      }
    }
  }, [settingsSubTab]);

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/admin/settings/categories', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCategoriesList(data);
      }
    } catch (err) {
      console.error('Fetch categories failed', err);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryTitle.trim()) return;
    setCategoriesLoading(true);
    try {
      const res = await fetch('/api/admin/settings/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: newCategoryTitle }),
      });
      if (res.ok) {
        setNewCategoryTitle('');
        fetchCategories();
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to add category');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCategoriesLoading(false);
    }
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
      const res = await fetch(`/api/admin/settings/categories?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchCategories();
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to delete category');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchServices = async () => {
    try {
      const res = await fetch('/api/admin/settings/services', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setServicesList(data);
      }
    } catch (err) {
      console.error('Fetch services failed', err);
    }
  };

  // Removed old handleAddService in favor of modal and category creation forms

  const handleDeleteService = async (id: number) => {
    if (!confirm('Are you sure you want to delete this service?')) return;
    try {
      const res = await fetch(`/api/admin/settings/services?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchServices();
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to delete service');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAmbience = async () => {
    try {
      const res = await fetch('/api/admin/settings/ambience', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAmbienceList(data);
      }
    } catch (err) {
      console.error('Fetch ambience failed', err);
    }
  };

  // Removed old handleAddAmbience in favor of modal and new group creation forms

  const handleDeleteAmbience = async (id: number) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      const res = await fetch(`/api/admin/settings/ambience?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchAmbience();
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to delete item');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Check auth on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('lc_admin_token');
    if (storedToken) {
      setToken(storedToken);
      setIsAuthenticated(true);
    }
  }, []);

  // Fetch data on auth
  useEffect(() => {
    if (isAuthenticated && token) {
      fetchStats();
      fetchUsers();
    }
  }, [isAuthenticated, token]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      } else if (res.status === 401 || res.status === 403) {
        handleLogout();
      }
    } catch (err) {
      console.error('Fetch stats failed', err);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      } else if (res.status === 401 || res.status === 403) {
        handleLogout();
      }
    } catch (err) {
      console.error('Fetch users failed', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Load Twilio settings when settings tab becomes active
  useEffect(() => {
    if (isAuthenticated && token && activeTab === 'settings') {
      const loadSettings = async () => {
        try {
          const res = await fetch('/api/admin/settings/twilio', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            setTwilioMode(data.activeMode || 'staging');
            if (data.staging) {
              setStagingSid(data.staging.accountSid || '');
              setStagingToken(data.staging.authToken || '');
              setStagingNumber(data.staging.phoneNumber || '');
              setStagingVerificationServiceId(data.staging.verificationServiceId || '');
              setStagingMessagingServiceSid(data.staging.messagingServiceSid || '');
            }
            if (data.live) {
              setLiveSid(data.live.accountSid || '');
              setLiveToken(data.live.authToken || '');
              setLiveNumber(data.live.phoneNumber || '');
              setLiveVerificationServiceId(data.live.verificationServiceId || '');
              setLiveMessagingServiceSid(data.live.messagingServiceSid || '');
            }
          } else if (res.status === 401 || res.status === 403) {
            handleLogout();
          } else {
            const errData = await res.json();
            setTwilioError(errData.message || 'Failed to load settings');
          }
        } catch (err) {
          console.error('Failed to load Twilio settings', err);
        }
      };
      loadSettings();
    }
  }, [isAuthenticated, token, activeTab]);

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('Are you sure you want to delete this user account? This will permanently delete the user and all associated profile, services, and amenities data. This action cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users?id=${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDrawerOpen(false);
        setSelectedUser(null);
        fetchUsers();
        fetchStats();
        alert('User account and all associated data deleted successfully.');
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to delete user account.');
      }
    } catch (err) {
      console.error(err);
      alert('Network error. Failed to delete user.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirm password do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordSuccess(data.message || 'Password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordError(data.message || 'Failed to update password.');
      }
    } catch {
      setPasswordError('Network error. Failed to update password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSaveTwilioSettings = async () => {
    setTwilioError('');
    setTwilioSuccess('');
    setTwilioSaveLoading(true);

    try {
      const res = await fetch('/api/admin/settings/twilio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          activeMode: twilioMode,
          staging: {
            accountSid: stagingSid,
            authToken: stagingToken,
            phoneNumber: stagingNumber,
            verificationServiceId: stagingVerificationServiceId,
            messagingServiceSid: stagingMessagingServiceSid,
          },
          live: {
            accountSid: liveSid,
            authToken: liveToken,
            phoneNumber: liveNumber,
            verificationServiceId: liveVerificationServiceId,
            messagingServiceSid: liveMessagingServiceSid,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTwilioSuccess('Twilio configurations saved successfully!');
      } else {
        setTwilioError(data.message || 'Failed to save configurations.');
      }
    } catch {
      setTwilioError('Network error. Failed to save configurations.');
    } finally {
      setTwilioSaveLoading(false);
    }
  };

  const handleVerifyTwilio = async (mode: 'staging' | 'live') => {
    setTwilioError('');
    setTwilioSuccess('');

    const sid = mode === 'staging' ? stagingSid : liveSid;
    const tokenVal = mode === 'staging' ? stagingToken : liveToken;
    const phoneVal = mode === 'staging' ? stagingNumber : liveNumber;
    const verifyServiceId = mode === 'staging' ? stagingVerificationServiceId : liveVerificationServiceId;
    const msgServiceSid = mode === 'staging' ? stagingMessagingServiceSid : liveMessagingServiceSid;
    const testPhone = mode === 'staging' ? testPhoneStaging : testPhoneLive;

    if (!testPhone) {
      setTwilioError('A test recipient phone number is required to verify the connection.');
      return;
    }

    if (mode === 'staging') setVerifyStagingLoading(true);
    else setVerifyLiveLoading(true);

    try {
      const res = await fetch('/api/admin/settings/twilio/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode,
          accountSid: sid,
          authToken: tokenVal,
          phoneNumber: phoneVal,
          verificationServiceId: verifyServiceId,
          messagingServiceSid: msgServiceSid,
          testPhoneNumber: testPhone,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTwilioSuccess(data.message);
      } else {
        setTwilioError(data.message || 'Verification connection failed.');
      }
    } catch {
      setTwilioError('Network error. Failed to verify connection.');
    } finally {
      if (mode === 'staging') setVerifyStagingLoading(false);
      else setVerifyLiveLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (res.ok && data.user.role === 'admin') {
        localStorage.setItem('lc_admin_token', data.token);
        setToken(data.token);
        setIsAuthenticated(true);
      } else {
        setLoginError(data.message || 'Invalid admin credentials');
      }
    } catch {
      setLoginError('Server connection failed. Try email: admin@lookclean.com password: admin123');
    } finally {
      setLoginLoading(false);
    }
  };

  function handleLogout() {
    localStorage.removeItem('lc_admin_token');
    setToken(null);
    setIsAuthenticated(false);
    setSelectedUser(null);
    setDrawerOpen(false);
  }



  // Filter users based on query and filter
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole && u.role !== 'admin';
  });

  // --- RENDERING LOGIN PANEL ---
  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 min-h-screen bg-dark-bg">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-42 h-42">
              <img src="/assets/images/Look_Clean_logo.png" alt="LookClean Logo" className="w-full h-full object-cover" />
            </div>

          </div>

          <Card className="shadow-2xl">
            <h2 className="text-xl font-bold mb-6 text-center text-white flex items-center justify-center gap-2">
              <ShieldAlert className="w-5 h-5 text-primary" /> Admin Authenticate
            </h2>

            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm mb-4 text-center font-medium">
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                label="Admin Email"
                type="email"
                placeholder="admin@lookclean.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <Input
                label="Admin Password"
                type="password"
                placeholder="admin123"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <Button type="submit" className="w-full mt-2" isLoading={loginLoading}>
                Log In as Admin
              </Button>
            </form>
          </Card>
        </motion.div>
      </div>
    );
  }

  // --- RENDERING ADMIN DASHBOARD ---
  return (
    <div className="min-h-screen bg-dark-bg text-gray-100 flex relative overflow-x-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* LEFT SIDEBAR (Sticky on desktop, hidden on mobile) */}
      <aside className="hidden md:flex flex-col w-64 border-r border-gray-900 bg-gray-950/80 backdrop-blur z-20 shrink-0 p-5 justify-between h-screen sticky top-0">
        <div className="space-y-8">
          {/* Logo */}
          <div className="flex justify-center pt-2">
            <div className="h-[95px]">
              <img src="/assets/images/Look_Clean_logo.png" alt="LookClean Logo" className="w-full h-full object-cover" />
            </div>
          </div>

          {/* Nav links */}
          <nav className="space-y-1.5">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-2 px-2">Navigation</span>
            <button
              onClick={() => handleTabChange('dashboard')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
                ${activeTab === 'dashboard'
                  ? 'bg-primary/10 border border-primary/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <Building className="w-4 h-4" />
              <span>Dashboard</span>
            </button>
            <button
              onClick={() => handleTabChange('users')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
                ${activeTab === 'users'
                  ? 'bg-primary/10 border border-primary/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <Users className="w-4 h-4" />
              <span>Users</span>
            </button>
          </nav>
        </div>

        {/* User Card & Sign Out */}
        <div className="space-y-4 pt-4 border-t border-gray-900">
          <button
            onClick={() => handleTabChange('settings')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
              ${activeTab === 'settings'
                ? 'bg-primary/10 border border-primary/20 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
              }
            `}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>

          <div className="flex items-center gap-3 px-1">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-sm">
              SA
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">System Admin</p>
              <p className="text-[10px] text-gray-500 truncate">admin@lookclean.com</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" className="w-full justify-center py-2" onClick={handleLogout} rightIcon={<LogOut className="w-3.5 h-3.5" />}>
            Sign Out
          </Button>
        </div>
      </aside>

      {/* RIGHT MAIN PANEL */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Mobile Header */}
        <header className="md:hidden border-b border-gray-900 bg-gray-950/80 backdrop-blur px-6 py-4 flex justify-between items-center z-20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden bg-gray-950/40 border border-gray-900">
              <img src="/assets/images/Look_Clean_logo.png" alt="LookClean Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-extrabold text-white text-lg">
              LookClean Admin
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout} rightIcon={<LogOut className="w-4 h-4" />}>
            Sign Out
          </Button>
        </header>

        {/* Main Content Area */}
        <main className="flex-grow w-full py-8 px-4 sm:px-8 space-y-8 z-10">
          {activeTab === 'dashboard' ? (
            <>
              {/* Statistics Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border border-gray-850 p-4">
                  <div className="flex items-center justify-between text-gray-500 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider">Total Users</span>
                    <Users className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-2xl font-extrabold text-white">{stats.total}</div>
                </Card>

                <Card className="border border-gray-850 p-4">
                  <div className="flex items-center justify-between text-gray-500 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider">Clients</span>
                    <Users className="w-4 h-4 text-purple-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-white">{stats.clients}</div>
                </Card>

                <Card className="border border-gray-850 p-4">
                  <div className="flex items-center justify-between text-gray-500 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider">Providers</span>
                    <Building className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-white">{stats.providers}</div>
                </Card>

                <Card className="border border-gray-850 p-4">
                  <div className="flex items-center justify-between text-gray-500 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider">SMS Verified</span>
                    <Phone className="w-4 h-4 text-green-500" />
                  </div>
                  <div className="text-2xl font-extrabold text-white">
                    {stats.total > 0 ? Math.round((stats.verifiedPhone / stats.total) * 100) : 0}%
                  </div>
                </Card>
              </div>

              {/* Greeting Card */}
              <Card className="border border-gray-850 p-6 bg-gradient-to-r from-primary-dark/10 to-purple-950/20">
                <h3 className="text-lg font-bold text-white mb-2">Welcome to LookClean Admin Center</h3>
                <p className="text-xs text-gray-400 max-w-xl leading-relaxed">
                  Use this control dashboard to track total registered users, verify stylists credentials, analyze mobile OTP activations, and manage bookings and salon listings. Select the <strong>Users</strong> tab in the sidebar to browse individual clients and provider directory grids.
                </p>
              </Card>
            </>
          ) : activeTab === 'settings' ? (
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4">
                <h2 className="text-xl font-extrabold text-white">System Settings</h2>
                <p className="text-xs text-gray-400">Manage administrator credentials and Twilio SMS Gateway configurations.</p>
              </div>

              {/* Flex Container for Settings Layout */}
              <div className="flex flex-col lg:flex-row gap-6 items-start">

                {/* Left side Sub-tabs navigation */}
                <div className="w-full lg:w-60 flex flex-row lg:flex-col gap-1 z-10">
                  <button
                    onClick={() => setSettingsSubTab('password')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all w-full cursor-pointer
                      ${settingsSubTab === 'password'
                        ? 'bg-primary/10 border border-primary/20 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }
                    `}
                  >
                    <Lock className="w-4 h-4" />
                    <span>Change Password</span>
                  </button>
                  <button
                    onClick={() => setSettingsSubTab('twilio')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all w-full cursor-pointer
                      ${settingsSubTab === 'twilio'
                        ? 'bg-primary/10 border border-primary/20 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }
                    `}
                  >
                    <Server className="w-4 h-4" />
                    <span>Twilio Configuration</span>
                  </button>
                  <button
                    onClick={() => setSettingsSubTab('categories')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all w-full cursor-pointer
                      ${settingsSubTab === 'categories'
                        ? 'bg-primary/10 border border-primary/20 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }
                    `}
                  >
                    <Tag className="w-4 h-4" />
                    <span>Category Settings</span>
                  </button>
                  <button
                    onClick={() => setSettingsSubTab('services')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all w-full cursor-pointer
                      ${settingsSubTab === 'services'
                        ? 'bg-primary/10 border border-primary/20 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }
                    `}
                  >
                    <Scissors className="w-4 h-4" />
                    <span>Service Settings</span>
                  </button>
                  <button
                    onClick={() => setSettingsSubTab('ambience')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all w-full cursor-pointer
                      ${settingsSubTab === 'ambience'
                        ? 'bg-primary/10 border border-primary/20 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }
                    `}
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Ambience & Amenities</span>
                  </button>
                  <button
                    onClick={() => setSettingsSubTab('database')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all w-full cursor-pointer
                      ${settingsSubTab === 'database'
                        ? 'bg-primary/10 border border-primary/20 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }
                    `}
                  >
                    <Database className="w-4 h-4" />
                    <span>Database Status</span>
                  </button>
                </div>

                {/* Right side Settings content forms */}
                <div className="flex-1 w-full">
                  {settingsSubTab === 'password' ? (
                    <Card className="border border-gray-850 p-6 space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                        <Lock className="w-4 h-4 text-primary" /> Admin Change Password
                      </h3>

                      {passwordSuccess && (
                        <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-3 rounded-xl text-xs font-medium">
                          {passwordSuccess}
                        </div>
                      )}

                      {passwordError && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs font-medium">
                          {passwordError}
                        </div>
                      )}

                      <form onSubmit={handleChangePassword} className="space-y-4">
                        <Input
                          label="Current Password"
                          type="password"
                          placeholder="••••••••"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                        />
                        <Input
                          label="New Password"
                          type="password"
                          placeholder="••••••••"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <Input
                          label="Confirm New Password"
                          type="password"
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                        <Button type="submit" isLoading={passwordLoading} className="px-6 py-2.5">
                          Update Password
                        </Button>
                      </form>
                    </Card>
                  ) : settingsSubTab === 'twilio' ? (
                    <div className="space-y-6">
                      {twilioSuccess && (
                        <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-3 rounded-xl text-xs font-medium">
                          {twilioSuccess}
                        </div>
                      )}

                      {twilioError && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-xs font-medium">
                          {twilioError}
                        </div>
                      )}

                      <Card className="border border-gray-850 p-6 space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Server className="w-4 h-4 text-primary" /> Twilio SMS Gateway
                          </span>
                          <span className={`
                            text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide
                            ${twilioMode === 'live' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}
                          `}>
                            Active Mode: {twilioMode}
                          </span>
                        </h3>

                        <div className="space-y-2">
                          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Active Connection Mode</label>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setTwilioMode('staging')}
                              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer border
                                ${twilioMode === 'staging'
                                  ? 'bg-amber-500/10 text-amber-450 border-amber-500/20 font-bold'
                                  : 'text-gray-400 border-gray-800 hover:text-white'
                                }
                              `}
                            >
                              Staging Mode
                            </button>
                            <button
                              onClick={() => setTwilioMode('live')}
                              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer border
                                ${twilioMode === 'live'
                                  ? 'bg-green-500/10 text-green-450 border-green-500/20 font-bold'
                                  : 'text-gray-400 border-gray-800 hover:text-white'
                                }
                              `}
                            >
                              Live Production Mode
                            </button>
                          </div>
                        </div>
                      </Card>

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {/* Staging Mode Card */}
                        <Card className="border border-gray-850 p-6 space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                            <Server className="w-3.5 h-3.5" /> Staging Environment Configuration
                          </h4>
                          <div className="space-y-4">
                            <Input
                              label="Account SID (Staging)"
                              type="text"
                              placeholder="AC..."
                              value={stagingSid}
                              onChange={(e) => setStagingSid(e.target.value)}
                            />
                            <Input
                              label="Auth Token (Staging)"
                              type="password"
                              placeholder="••••••••"
                              value={stagingToken}
                              onChange={(e) => setStagingToken(e.target.value)}
                            />
                            <Input
                              label="Sender Phone Number (Staging)"
                              type="text"
                              placeholder="+15005550006"
                              value={stagingNumber}
                              onChange={(e) => setStagingNumber(e.target.value)}
                            />
                            <Input
                              label="Verification Service SID (Staging)"
                              type="text"
                              placeholder="VA..."
                              value={stagingVerificationServiceId}
                              onChange={(e) => setStagingVerificationServiceId(e.target.value)}
                            />
                            <Input
                              label="SMS / Messaging Service SID (Staging)"
                              type="text"
                              placeholder="MG..."
                              value={stagingMessagingServiceSid}
                              onChange={(e) => setStagingMessagingServiceSid(e.target.value)}
                            />
                            <Input
                              label="Recipient Phone Number (for testing)"
                              type="text"
                              placeholder="+11234567890"
                              value={testPhoneStaging}
                              onChange={(e) => setTestPhoneStaging(e.target.value)}
                            />
                            <div className="pt-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="w-full justify-center text-xs"
                                isLoading={verifyStagingLoading}
                                onClick={() => handleVerifyTwilio('staging')}
                              >
                                Verify Staging Connection
                              </Button>
                            </div>
                          </div>
                        </Card>

                        {/* Live Mode Card */}
                        <Card className="border border-gray-850 p-6 space-y-4">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-green-400 flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5" /> Live Production Environment
                          </h4>
                          <div className="space-y-4">
                            <Input
                              label="Account SID (Live)"
                              type="text"
                              placeholder="AC..."
                              value={liveSid}
                              onChange={(e) => setLiveSid(e.target.value)}
                            />
                            <Input
                              label="Auth Token (Live)"
                              type="password"
                              placeholder="••••••••"
                              value={liveToken}
                              onChange={(e) => setLiveToken(e.target.value)}
                            />
                            <Input
                              label="Sender Phone Number (Live)"
                              type="text"
                              placeholder="+15005550001"
                              value={liveNumber}
                              onChange={(e) => setLiveNumber(e.target.value)}
                            />
                            <Input
                              label="Verification Service SID (Live)"
                              type="text"
                              placeholder="VA..."
                              value={liveVerificationServiceId}
                              onChange={(e) => setLiveVerificationServiceId(e.target.value)}
                            />
                            <Input
                              label="SMS / Messaging Service SID (Live)"
                              type="text"
                              placeholder="MG..."
                              value={liveMessagingServiceSid}
                              onChange={(e) => setLiveMessagingServiceSid(e.target.value)}
                            />
                            <Input
                              label="Recipient Phone Number (for testing)"
                              type="text"
                              placeholder="+11234567890"
                              value={testPhoneLive}
                              onChange={(e) => setTestPhoneLive(e.target.value)}
                            />
                            <div className="pt-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="w-full justify-center text-xs"
                                isLoading={verifyLiveLoading}
                                onClick={() => handleVerifyTwilio('live')}
                              >
                                Verify Live Connection
                              </Button>
                            </div>
                          </div>
                        </Card>
                      </div>

                      <div className="flex justify-end pt-2">
                        <Button
                          onClick={handleSaveTwilioSettings}
                          isLoading={twilioSaveLoading}
                          className="px-8 py-3"
                        >
                          Save Twilio Configuration
                        </Button>
                      </div>
                    </div>
                  ) : settingsSubTab === 'categories' ? (
                    <Card className="border border-gray-850 p-6 space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                        <Tag className="w-4 h-4 text-primary" /> Category Settings
                      </h3>
                      <p className="text-xs text-gray-400">Add or remove master categories for providers to select from.</p>

                      <form onSubmit={handleAddCategory} className="flex gap-3 items-end pt-2">
                        <div className="flex-1">
                          <Input
                            label="Category Title"
                            type="text"
                            placeholder="e.g. Hair, Nails, Massage..."
                            value={newCategoryTitle}
                            onChange={(e) => setNewCategoryTitle(e.target.value)}
                          />
                        </div>
                        <Button type="submit" isLoading={categoriesLoading} className="py-2.5">
                          Add Category
                        </Button>
                      </form>

                      <div className="border-t border-gray-900 pt-4">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">All Categories</h4>
                        {categoriesList.length === 0 ? (
                          <p className="text-xs text-gray-500 italic">No categories created yet.</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {categoriesList.map((cat) => (
                              <div key={cat.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-900/40 border border-white/5 hover:border-primary/20 transition-all">
                                <span className="text-xs font-semibold text-gray-200">{cat.title}</span>
                                <button
                                  onClick={() => handleDeleteCategory(cat.id)}
                                  className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase px-2 py-1 rounded hover:bg-red-500/10 cursor-pointer"
                                >
                                  Delete
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Card>
                  ) : settingsSubTab === 'services' ? (
                    <Card className="border border-gray-850 p-6 space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                        <Scissors className="w-4 h-4 text-primary" /> Service Settings
                      </h3>
                      <p className="text-xs text-gray-400">Manage master services. Click inline buttons next to categories to add sub-services directly.</p>

                      <div className="border-t border-gray-900 pt-4">
                        {categoriesList.length === 0 ? (
                          <div className="text-center py-6">
                            <p className="text-xs text-gray-500 italic mb-4">No categories created yet. Create a category to get started.</p>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            {categoriesList.map((cat) => {
                              const main = cat.title;
                              const filteredServices = servicesList.filter(s => s.mainType === main);
                              return (
                                <div key={main} className="space-y-3">
                                  <h5 className="text-[10px] font-extrabold text-primary uppercase tracking-wider border-b border-gray-900 pb-2 flex items-center justify-between">
                                    <span>{main}</span>
                                    <button
                                      onClick={() => {
                                        setActiveAddServiceCategory(main);
                                        setNewModalServiceTitle('');
                                        setAddServiceModalOpen(true);
                                      }}
                                      className="text-[9px] text-primary hover:text-white font-extrabold uppercase px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 hover:bg-primary transition-all cursor-pointer"
                                    >
                                      + Add Service
                                    </button>
                                  </h5>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {filteredServices.length === 0 ? (
                                      <p className="text-[10px] text-gray-500 italic py-1 col-span-2">No services in this category yet. Click '+ Add Service' to create one.</p>
                                    ) : (
                                      filteredServices.map((service) => (
                                        <div key={service.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-900/40 border border-white/5 hover:border-primary/20 transition-all">
                                          <span className="text-xs font-semibold text-gray-200">{service.title}</span>
                                          <button
                                            onClick={() => handleDeleteService(service.id)}
                                            className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase px-2 py-1 rounded hover:bg-red-500/10 cursor-pointer"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="pt-6 border-t border-gray-900 mt-6">
                          {isAddingNewCategory ? (
                            <div className="p-4 rounded-xl border border-dashed border-primary/30 bg-primary/5 space-y-4">
                              <h5 className="text-[10px] font-extrabold text-primary uppercase tracking-wider">Create New Service Category</h5>
                              <form onSubmit={async (e) => {
                                e.preventDefault();
                                if (!newCategoryFormTitle.trim() || !newCategoryFirstServiceTitle.trim()) return;
                                setServicesLoading(true);
                                try {
                                  // 1. Create Category
                                  const catRes = await fetch('/api/admin/settings/categories', {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: JSON.stringify({ title: newCategoryFormTitle }),
                                  });
                                  if (!catRes.ok) {
                                    const errData = await catRes.json();
                                    throw new Error(errData.message || 'Failed to create category');
                                  }

                                  // 2. Create First Service
                                  const svcRes = await fetch('/api/admin/settings/services', {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: JSON.stringify({ mainType: newCategoryFormTitle, title: newCategoryFirstServiceTitle }),
                                  });
                                  if (!svcRes.ok) {
                                    const errData = await svcRes.json();
                                    throw new Error(errData.message || 'Failed to create first service');
                                  }

                                  setIsAddingNewCategory(false);
                                  setNewCategoryFormTitle('');
                                  setNewCategoryFirstServiceTitle('');
                                  fetchCategories();
                                  fetchServices();
                                } catch (err: any) {
                                  alert(err.message || 'Error occurred');
                                } finally {
                                  setServicesLoading(false);
                                }
                              }} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <Input
                                    label="Category Title"
                                    type="text"
                                    placeholder="e.g. Hair Color, Facial"
                                    value={newCategoryFormTitle}
                                    onChange={(e) => setNewCategoryFormTitle(e.target.value)}
                                    required
                                  />
                                  <Input
                                    label="First Service Title"
                                    type="text"
                                    placeholder="e.g. Root touch-up, Balayage"
                                    value={newCategoryFirstServiceTitle}
                                    onChange={(e) => setNewCategoryFirstServiceTitle(e.target.value)}
                                    required
                                  />
                                </div>
                                <div className="flex justify-end gap-3 pt-2">
                                  <button
                                    type="button"
                                    onClick={() => setIsAddingNewCategory(false)}
                                    className="px-4 py-2 rounded-xl border border-gray-800 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <Button type="submit" isLoading={servicesLoading} className="px-5 py-2">
                                    Create Category & Service
                                  </Button>
                                </div>
                              </form>
                            </div>
                          ) : (
                            <button
                              onClick={() => setIsAddingNewCategory(true)}
                              className="w-full p-4 rounded-xl border border-dashed border-gray-800 hover:border-primary/40 text-xs font-semibold text-gray-400 hover:text-white text-center cursor-pointer transition-all flex items-center justify-center gap-2 hover:bg-white/5"
                            >
                              <Scissors className="w-4 h-4 text-gray-500" />
                              <span>+ Add New Service Category</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Add Service Modal Overlay */}
                      {addServiceModalOpen && (
                        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                          <Card className="border border-gray-850 p-6 space-y-4 max-w-md w-full bg-gray-950 shadow-2xl">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                              <Scissors className="w-4 h-4 text-primary" /> Add Service to {activeAddServiceCategory}
                            </h3>
                            <p className="text-xs text-gray-450">Please enter a title for the new sub-service.</p>

                            <form onSubmit={async (e) => {
                              e.preventDefault();
                              if (!newModalServiceTitle.trim()) return;
                              setServicesLoading(true);
                              try {
                                const res = await fetch('/api/admin/settings/services', {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${token}`,
                                  },
                                  body: JSON.stringify({
                                    mainType: activeAddServiceCategory,
                                    title: newModalServiceTitle
                                  }),
                                });
                                if (res.ok) {
                                  setAddServiceModalOpen(false);
                                  setNewModalServiceTitle('');
                                  fetchServices();
                                } else {
                                  const data = await res.json();
                                  alert(data.message || 'Failed to add service');
                                }
                              } catch (err) {
                                console.error(err);
                              } finally {
                                setServicesLoading(false);
                              }
                            }} className="space-y-4">
                              <Input
                                label="Service Title"
                                type="text"
                                placeholder="e.g. Skin fade, Kids cut..."
                                value={newModalServiceTitle}
                                onChange={(e) => setNewModalServiceTitle(e.target.value)}
                                required
                              />

                              <div className="flex justify-end gap-3 pt-2">
                                <button
                                  type="button"
                                  onClick={() => setAddServiceModalOpen(false)}
                                  className="px-4 py-2 rounded-xl border border-gray-800 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <Button type="submit" isLoading={servicesLoading} className="px-5 py-2">
                                  Add Service
                                </Button>
                              </div>
                            </form>
                          </Card>
                        </div>
                      )}
                    </Card>
                  ) : settingsSubTab === 'ambience' ? (
                    <Card className="border border-gray-850 p-6 space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" /> Ambience & Amenities Settings
                      </h3>
                      <p className="text-xs text-gray-400">Manage master amenities and ambience configurations. Click inline buttons to add items directly to a group.</p>

                      <div className="border-t border-gray-900 pt-4">
                        {ambienceList.length === 0 ? (
                          <div className="text-center py-6">
                            <p className="text-xs text-gray-500 italic mb-4">No groups or items created yet.</p>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            {Array.from(new Set(ambienceList.map(a => a.mainType))).map((group) => {
                              const firstItem = ambienceList.find(a => a.mainType === group);
                              return (
                                <div key={group} className="space-y-3">
                                  <h5 className="text-[10px] font-extrabold text-purple-400 uppercase tracking-wider border-b border-gray-900 pb-2 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                      {firstItem?.mainTypeIcon && <span>{firstItem.mainTypeIcon}</span>}
                                      <span>{group}</span>
                                    </div>
                                    <button
                                      onClick={() => {
                                        setActiveAddItemGroup(group);
                                        setActiveAddItemGroupIcon(firstItem?.mainTypeIcon || '');
                                        setNewModalItemTitle('');
                                        setNewModalItemSvg(null);
                                        setAddItemModalOpen(true);
                                      }}
                                      className="text-[9px] text-primary hover:text-white font-extrabold uppercase px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 hover:bg-primary transition-all cursor-pointer"
                                    >
                                      + Add Item
                                    </button>
                                  </h5>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {ambienceList.filter(a => a.mainType === group).map((item) => (
                                      <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-900/40 border border-white/5 hover:border-primary/20 transition-all">
                                        <span className="text-xs font-semibold text-gray-200 flex items-center gap-2">
                                          {item.icon && (
                                            item.icon.startsWith('http') || item.icon.startsWith('/') ? (
                                              <img src={item.icon} alt={item.title} className="w-4 h-4 object-contain shrink-0" />
                                            ) : (
                                              <span className="text-sm">{item.icon}</span>
                                            )
                                          )}
                                          <span>{item.title}</span>
                                        </span>
                                        <button
                                          onClick={() => handleDeleteAmbience(item.id)}
                                          className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase px-2 py-1 rounded hover:bg-red-500/10 cursor-pointer"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="pt-6 border-t border-gray-900 mt-6">
                          {isAddingNewGroup ? (
                            <div className="p-4 rounded-xl border border-dashed border-primary/30 bg-primary/5 space-y-4">
                              <h5 className="text-[10px] font-extrabold text-primary uppercase tracking-wider">Create New Ambience Group</h5>
                              <form onSubmit={async (e) => {
                                e.preventDefault();
                                if (!newGroupTitle.trim()) return;
                                if (!newGroupFirstItemTitle.trim() && !newGroupCsv) {
                                  alert('Please enter a First Item Title or upload a CSV file with items.');
                                  return;
                                }
                                setAmbienceLoading(true);
                                try {
                                  const fd = new FormData();
                                  fd.append('mainType', newGroupTitle);
                                  if (newGroupFirstItemTitle.trim()) {
                                    fd.append('title', newGroupFirstItemTitle);
                                  }
                                  if (newGroupCsv) {
                                    fd.append('csvFile', newGroupCsv);
                                  }

                                  const res = await fetch('/api/admin/settings/ambience', {
                                    method: 'POST',
                                    headers: {
                                      Authorization: `Bearer ${token}`,
                                    },
                                    body: fd,
                                  });
                                  if (res.ok) {
                                    setIsAddingNewGroup(false);
                                    setNewGroupTitle('');
                                    setNewGroupFirstItemTitle('');
                                    setNewGroupCsv(null);
                                    fetchAmbience();
                                  } else {
                                    const data = await res.json();
                                    alert(data.message || 'Failed to create group');
                                  }
                                } catch (err) {
                                  console.error(err);
                                } finally {
                                  setAmbienceLoading(false);
                                }
                              }} className="space-y-4">
                                <div className="grid grid-cols-1 gap-4">
                                  <Input
                                    label="Group Title"
                                    type="text"
                                    placeholder="e.g. Convenience & Refreshments"
                                    value={newGroupTitle}
                                    onChange={(e) => setNewGroupTitle(e.target.value)}
                                    required
                                  />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                                  <Input
                                    label="First Item Title (Optional)"
                                    type="text"
                                    placeholder="e.g. Complimentary beverages"
                                    value={newGroupFirstItemTitle}
                                    onChange={(e) => setNewGroupFirstItemTitle(e.target.value)}
                                  />
                                  <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Or Upload Items CSV File</label>
                                    <input
                                      type="file"
                                      accept=".csv"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0] || null;
                                        setNewGroupCsv(file);
                                      }}
                                      className="w-full text-xs text-gray-400 bg-gray-900 border border-gray-800 rounded-xl p-2.5 hover:border-primary/40 focus:border-primary transition-all focus:outline-none file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-semibold file:bg-primary/20 file:text-primary file:cursor-pointer hover:file:bg-primary/30"
                                    />
                                  </div>
                                </div>
                                <div className="flex justify-end gap-3 pt-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsAddingNewGroup(false);
                                      setNewGroupCsv(null);
                                    }}
                                    className="px-4 py-2 rounded-xl border border-gray-800 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <Button type="submit" isLoading={ambienceLoading} className="px-5 py-2">
                                    Create Group
                                  </Button>
                                </div>
                              </form>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setNewGroupTitle('');
                                setNewGroupFirstItemTitle('');
                                setNewGroupCsv(null);
                                setIsAddingNewGroup(true);
                              }}
                              className="w-full p-4 rounded-xl border border-dashed border-gray-800 hover:border-primary/40 text-xs font-semibold text-gray-400 hover:text-white text-center cursor-pointer transition-all flex items-center justify-center gap-2 hover:bg-white/5"
                            >
                              <Sparkles className="w-4 h-4 text-gray-500" />
                              <span>+ Add New Ambience & Amenities Group</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Add Item Modal Overlay */}
                      {addItemModalOpen && (
                        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                          <Card className="border border-gray-850 p-6 space-y-4 max-w-md w-full bg-gray-950 shadow-2xl">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-primary" /> Add Item to {activeAddItemGroup}
                            </h3>
                            <p className="text-xs text-gray-450">Please enter a title and select/type an emoji icon for the new option.</p>

                            <form onSubmit={async (e) => {
                              e.preventDefault();
                              if (!newModalItemTitle.trim()) return;
                              setAmbienceLoading(true);
                              try {
                                const fd = new FormData();
                                fd.append('mainType', activeAddItemGroup || '');
                                fd.append('mainTypeIcon', activeAddItemGroupIcon || '');
                                fd.append('title', newModalItemTitle);
                                if (newModalItemSvg) {
                                  fd.append('svgFile', newModalItemSvg);
                                }

                                const res = await fetch('/api/admin/settings/ambience', {
                                  method: 'POST',
                                  headers: {
                                    Authorization: `Bearer ${token}`,
                                  },
                                  body: fd,
                                });
                                if (res.ok) {
                                  setAddItemModalOpen(false);
                                  setNewModalItemTitle('');
                                  setNewModalItemSvg(null);
                                  fetchAmbience();
                                } else {
                                  const data = await res.json();
                                  alert(data.message || 'Failed to add ambience item');
                                }
                              } catch (err) {
                                console.error(err);
                              } finally {
                                setAmbienceLoading(false);
                              }
                            }} className="space-y-4">
                              <Input
                                label="Item Title"
                                type="text"
                                placeholder="e.g. Aromatherapy, Free Wi-Fi..."
                                value={newModalItemTitle}
                                onChange={(e) => setNewModalItemTitle(e.target.value)}
                                required
                              />

                              <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">Or Upload SVG Icon File</label>
                                <input
                                  type="file"
                                  accept=".svg"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] || null;
                                    setNewModalItemSvg(file);
                                  }}
                                  className="w-full text-xs text-gray-400 bg-gray-900 border border-gray-800 rounded-xl p-2.5 hover:border-primary/40 focus:border-primary transition-all focus:outline-none file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-semibold file:bg-primary/20 file:text-primary file:cursor-pointer hover:file:bg-primary/30"
                                />
                              </div>

                              <div className="flex justify-end gap-3 pt-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddItemModalOpen(false);
                                    setNewModalItemSvg(null);
                                  }}
                                  className="px-4 py-2 rounded-xl border border-gray-800 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <Button type="submit" isLoading={ambienceLoading} className="px-5 py-2">
                                  Add Item
                                </Button>
                              </div>
                            </form>
                          </Card>
                        </div>
                      )}
                    </Card>
                  ) : (
                    <Card className="border border-gray-850 p-6 space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                        <Database className="w-4 h-4 text-primary" /> Database Status & Diagnostics
                      </h3>
                      <p className="text-xs text-gray-400">Verify connectivity to the live/local database server and view connection configuration details.</p>

                      <div className="border-t border-gray-900 pt-6 space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-gray-900/30 border border-white/5">
                          <div className="space-y-1">
                            <h4 className="text-xs font-bold text-gray-200">Database Connection Test</h4>
                            <p className="text-[11px] text-gray-400">Click the button to perform a direct query connection test to the database.</p>
                          </div>
                          <button
                            onClick={handleCheckDatabaseConnection}
                            disabled={dbChecking}
                            className="px-5 py-2.5 rounded-xl bg-primary text-white text-xs font-bold uppercase hover:bg-primary/95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                          >
                            {dbChecking ? 'Checking Connection...' : 'Check Connection'}
                          </button>
                        </div>

                        {dbStatusResult && (
                          <div className={`p-5 rounded-xl border text-xs leading-relaxed space-y-3 ${
                            dbStatusResult.connected 
                              ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' 
                              : 'bg-red-500/5 border-red-500/20 text-red-400'
                          }`}>
                            <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[11px]">
                              {dbStatusResult.connected ? (
                                <Check className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <X className="w-4 h-4 text-red-500" />
                              )}
                              <span>
                                Connection Status: {dbStatusResult.connected ? 'Success' : 'Failed'}
                              </span>
                            </div>

                            <p>{dbStatusResult.message}</p>

                            {dbStatusResult.databaseUrl && (
                              <div className="pt-2 border-t border-white/5 space-y-1.5">
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400 block">Configured URL:</span>
                                <code className="block p-3 rounded-lg bg-black/40 text-gray-300 font-mono text-[11px] break-all select-all border border-white/5">
                                  {dbStatusResult.databaseUrl}
                                </code>
                              </div>
                            )}

                            {dbStatusResult.error && (
                              <div className="pt-2 border-t border-white/5 space-y-1.5">
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400 block">Error Details:</span>
                                <pre className="block p-3 rounded-lg bg-black/40 text-red-300/80 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed border border-white/5">
                                  {dbStatusResult.error}
                                </pre>
                              </div>
                            )}

                            {!dbStatusResult.connected && (
                              <div className="pt-3 border-t border-white/5 text-gray-400 space-y-2">
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-300 block">Troubleshooting Guide:</span>
                                <ul className="list-disc pl-4 space-y-1 text-[11px]">
                                  <li>Ensure the <code className="text-gray-300 font-mono">DATABASE_URL</code> in your live server's <code className="text-gray-300 font-mono">.env</code> file has <code className="text-emerald-500 font-mono">?sslaccept=accept_invalid_certs</code> appended if secure transport is required.</li>
                                  <li>Check if the RDS Security Group Inbound Rules allow traffic on port <code className="text-gray-300 font-mono">3306</code> from the web server's IP address.</li>
                                  <li>Verify that your RDS instance is set to <code className="text-gray-300 font-mono">Publicly Accessible = Yes</code> if connecting from outside AWS.</li>
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* User Management Section */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <h2 className="text-xl font-extrabold text-white">Registered Users</h2>

                {/* Search and Filters */}
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="relative flex items-center flex-grow">
                    <Search className="w-4 h-4 text-gray-500 absolute left-3 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search user name or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2 text-xs rounded-xl glass-input w-full"
                    />
                  </div>

                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as any)}
                    className="px-3 py-2 text-xs rounded-xl glass-input border border-gray-800"
                  >
                    <option value="all">All Roles</option>
                    <option value="client">Clients Only</option>
                    <option value="provider">Providers Only</option>
                  </select>
                </div>
              </div>

              {/* User List Table */}
              <Card className="p-0 overflow-hidden border border-gray-800">
                {loadingUsers ? (
                  <div className="py-20 text-center text-gray-500">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                    Loading users registry...
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="py-20 text-center text-gray-500">
                    No users matching search conditions
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-gray-850 bg-gray-950/40 text-gray-400 font-bold uppercase tracking-wider text-xs">
                          <th className="p-4 w-12 text-center">Photo</th>
                          <th className="p-4">Name</th>
                          <th className="p-4">Email</th>
                          <th className="p-4">Role</th>
                          <th className="p-4 text-center">SMS Phone</th>
                          <th className="p-4 text-right">View Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-850">
                        {filteredUsers.map((user) => (
                          <tr key={user.id} className="hover:bg-gray-900/20 transition-all">
                            <td className="p-4 w-12 text-center">
                              <div className="w-9 h-9 rounded-xl border border-gray-850 bg-gray-900/60 flex items-center justify-center overflow-hidden mx-auto shrink-0">
                                {user.role === 'provider' && user.providerProfile?.profileImageUrl ? (
                                  <img
                                    src={user.providerProfile.profileImageUrl}
                                    alt={user.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : user.role === 'client' && user.clientProfile?.profileImageUrl ? (
                                  <img
                                    src={user.clientProfile.profileImageUrl}
                                    alt={user.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="text-xs font-bold text-primary uppercase">
                                    {(user.name || user.email || '?').charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4 font-bold text-white">{user.name || ''}</td>
                            <td className="p-4 text-gray-300">{user.email}</td>
                            <td className="p-4">
                              {user.role ? (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border
                                  ${user.role === 'provider' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' : 'bg-purple-500/10 text-purple-400 border-purple-500/10'}
                                `}>
                                  {user.role}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-gray-500/10 text-gray-400 border-gray-500/10">
                                  Not Selected
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-center">
                              {user.isPhoneVerified ? (
                                <span className="text-green-500 text-xs font-semibold inline-flex items-center gap-0.5">
                                  <Check className="w-4 h-4" /> Verified
                                </span>
                              ) : (
                                <span className="text-red-500 text-xs font-semibold inline-flex items-center gap-0.5">
                                  <X className="w-4 h-4" /> Unverified
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => {
                                  setSelectedUser(user);
                                  setDrawerOpen(true);
                                }}
                                className="p-1 rounded hover:bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                              >
                                <ChevronRight className="w-5 h-5 inline-block" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </main>
      </div>

      {/* USER DETAILS SLIDE-OUT DRAWER */}
      <AnimatePresence>
        {drawerOpen && selectedUser && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-black z-30"
            />

            {/* Slideout Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-gray-950 border-l border-gray-900 shadow-2xl z-40 p-6 flex flex-col justify-between overflow-y-auto"
            >
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-900 pb-4">
                  <div>
                    <span className="text-xs text-primary font-bold uppercase tracking-wider">User details</span>
                    <h2 className="text-xl font-bold text-white mt-0.5">{selectedUser.name}</h2>
                  </div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Profile Meta Cards */}
                <div className="space-y-4 text-sm text-gray-400">
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-850">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Email Address</span>
                      <span className="text-white font-semibold block mt-0.5 break-all">{selectedUser.email}</span>
                    </div>
                    <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-850">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Registry ID</span>
                      <span className="text-white font-semibold block mt-0.5">#{selectedUser.id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span>Registered on {new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                  </div>

                  {/* Provider Specific Profile Data */}
                  {selectedUser.role === 'provider' && (
                    <div className="space-y-5 pt-4 border-t border-gray-900">

                      {selectedUser.providerProfile?.coverImageUrl && (
                        <div className="h-32 rounded-xl overflow-hidden bg-gray-900 relative">
                          <img src={selectedUser.providerProfile.coverImageUrl} alt="Cover" className="w-full h-full object-cover" />
                        </div>
                      )}

                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-primary" />
                          <span className="text-white font-semibold">{selectedUser.providerProfile?.location || 'No Location Set'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-amber-500" />
                          <span>{selectedUser.providerProfile?.experience || 0} years experience</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Award className="w-4 h-4 text-purple-500" />
                            <span>License: {selectedUser.providerProfile?.licenseType || 'N/A'}</span>
                          </div>
                          {selectedUser.providerProfile?.certificateUrl && (
                            <div className="flex items-center gap-2">
                              <a
                                href={selectedUser.providerProfile.certificateUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-primary hover:text-white font-extrabold uppercase px-2 py-1 rounded bg-primary/10 border border-primary/20 hover:bg-primary transition-all cursor-pointer"
                              >
                                View
                              </a>
                              <a
                                href={selectedUser.providerProfile.certificateUrl}
                                download
                                className="text-[10px] text-gray-400 hover:text-white font-extrabold uppercase px-2 py-1 rounded bg-gray-850 border border-gray-800 hover:bg-gray-750 transition-all cursor-pointer"
                              >
                                Download
                              </a>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Offered Services */}
                      <div className="space-y-2">
                        <h4 className="font-bold text-white text-sm uppercase tracking-wider">Services Catalog</h4>
                        <div className="bg-gray-900/40 border border-gray-850 rounded-xl p-3.5 space-y-2">
                          {selectedUser.providerProfile?.services && selectedUser.providerProfile.services.length > 0 ? (
                            selectedUser.providerProfile.services.map((srv, idx) => (
                              <div key={idx} className="flex justify-between items-center text-xs py-1.5 border-b last:border-0 border-gray-850/40">
                                <span className="font-semibold text-gray-350">{srv.name} ({srv.category})</span>
                                <span className="font-bold text-white">${srv.price}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-gray-500 py-1">No services registered</p>
                          )}
                        </div>
                      </div>

                      {/* Amenities */}
                      <div className="space-y-2">
                        <h4 className="font-bold text-white text-sm uppercase tracking-wider">Ambience & Amenities</h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedUser.providerProfile?.amenities && selectedUser.providerProfile.amenities.length > 0 ? (
                            selectedUser.providerProfile.amenities.map((am) => (
                              <span key={am.name} className="px-2.5 py-1 rounded-lg border border-gray-850 text-xs text-gray-300 font-semibold bg-gray-900/40">
                                {am.name}
                              </span>
                            ))
                          ) : (
                            <p className="text-xs text-gray-500 py-1">No amenities declared</p>
                          )}
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="border-t border-gray-900 pt-5 mt-6 space-y-3">
                {selectedUser.role !== 'admin' && (
                  <Button
                    variant="danger"
                    className="w-full text-white cursor-pointer"
                    onClick={() => handleDeleteUser(selectedUser.id)}
                  >
                    Delete User Account
                  </Button>
                )}
                <Button variant="secondary" className="w-full" onClick={() => setDrawerOpen(false)}>
                  Close Panel
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
