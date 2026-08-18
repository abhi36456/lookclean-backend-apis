'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert, LogOut, Search, Filter, ShieldCheck, Phone, Check, Mail,
  X, Calendar, Star, MapPin, Award, Clock, Users, Building, Activity, FileText, ChevronRight, Settings, Lock, Server, Globe, Tag, Scissors, Sparkles, Database,
  HelpCircle, AlertCircle, Smartphone, Plus, Trash2, Edit3, Save, Eye, CheckCircle, ExternalLink, Percent, DollarSign, Copy, CreditCard
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Card from '@/components/Card';
import { CmsRichEditor } from '@/components/CmsRichEditor';
import { triggerTopLoader } from '@/components/TopLoader';

interface UserData {
  id: number;
  email: string;
  name: string;
  role: 'client' | 'provider' | 'admin';
  providerType?: 'freelancer' | 'salon' | null;
  phoneNumber?: string | null;
  isPhoneVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: string;
  isFeatured?: boolean;
  featured?: boolean;
  providerProfile?: {
    name: string;
    salonName?: string | null;
    location: string;
    profileImageUrl?: string | null;
    experience: number;
    licenseType?: string;
    certificateUrl?: string;
    licenseTypes?: string[];
    certificateUrls?: string[];
    coverImageUrl?: string;
    isFeatured?: boolean;
    featured?: boolean;
    services?: { name: string; price: number; category: string }[];
    amenities?: { name: string }[];
  };
  clientProfile?: {
    location?: string | null;
    profileImageUrl?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    createdAt?: string | null;
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
  type AdminTabType = 'dashboard' | 'users' | 'settings' | 'vouchers' | 'cms' | 'faqs' | 'reports' | 'provider-requests' | 'bookings';

  const activeTab: AdminTabType = pathname.endsWith('/users')
    ? 'users'
    : pathname.endsWith('/vouchers')
      ? 'vouchers'
      : pathname.endsWith('/cms')
        ? 'cms'
        : pathname.endsWith('/faqs')
          ? 'faqs'
          : pathname.endsWith('/reports')
            ? 'reports'
            : pathname.endsWith('/provider-requests')
              ? 'provider-requests'
              : pathname.endsWith('/bookings')
                ? 'bookings'
                : pathname.endsWith('/settings')
                  ? 'settings'
                  : 'dashboard';

  const handleTabChange = (tab: AdminTabType) => {
    if (tab !== activeTab) {
      triggerTopLoader();
    }
    if (tab === 'users') {
      router.push('/admin/users');
    } else if (tab === 'vouchers') {
      router.push('/admin/vouchers');
    } else if (tab === 'cms') {
      router.push('/admin/cms');
    } else if (tab === 'faqs') {
      router.push('/admin/faqs');
    } else if (tab === 'reports') {
      router.push('/admin/reports');
    } else if (tab === 'provider-requests') {
      router.push('/admin/provider-requests');
    } else if (tab === 'bookings') {
      router.push('/admin/bookings');
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
  const [settingsSubTab, setSettingsSubTab] = useState<'password' | 'twilio' | 'appversion' | 'categories' | 'services' | 'ambience' | 'database'>('password');

  // App Version state
  const [androidVersion, setAndroidVersion] = useState('1.0.0');
  const [iosVersion, setIosVersion] = useState('1.0.0');
  const [appVersionLoading, setAppVersionLoading] = useState(false);
  const [appVersionMsg, setAppVersionMsg] = useState('');

  // CMS Pages state
  const [cmsActiveSlug, setCmsActiveSlug] = useState<'terms' | 'privacy-policy' | 'refund-policy' | 'client-payment-policy' | 'provider-payment-policy' | 'client-faqs' | 'provider-faqs' | 'community-guidelines'>('terms');
  const [cmsTitle, setCmsTitle] = useState('Terms & Conditions');
  const [cmsContent, setCmsContent] = useState('');
  const [cmsFaqItems, setCmsFaqItems] = useState<{ question: string; answer: string }[]>([]);
  const [cmsLoading, setCmsLoading] = useState(false);
  const [cmsSaving, setCmsSaving] = useState(false);
  const [cmsSavedMsg, setCmsSavedMsg] = useState('');
  const [cmsPreview, setCmsPreview] = useState(false);

  // Reports & Issues state
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [reportsTab, setReportsTab] = useState<'open' | 'closed'>('open');
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsUpdatingId, setReportsUpdatingId] = useState<number | null>(null);

  // Promo Codes CRUD state
  const [promoCodesList, setPromoCodesList] = useState<{ id: number; code: string; title: string; amount: number; isActive: boolean; createdAt: string }[]>([]);
  const [vouchersLoading, setVouchersLoading] = useState(false);
  const [newVoucherCode, setNewVoucherCode] = useState('');
  const [newVoucherTitle, setNewVoucherTitle] = useState('');
  const [newVoucherAmount, setNewVoucherAmount] = useState('');
  const [newVoucherIsActive, setNewVoucherIsActive] = useState(true);

  // Edit Promo Code Modal state
  const [editVoucherModalOpen, setEditVoucherModalOpen] = useState(false);
  const [editingVoucherId, setEditingVoucherId] = useState<number | null>(null);
  const [editVoucherCode, setEditVoucherCode] = useState('');
  const [editVoucherTitle, setEditVoucherTitle] = useState('');
  const [editVoucherAmount, setEditVoucherAmount] = useState('');
  const [editVoucherIsActive, setEditVoucherIsActive] = useState(true);

  // Categories CRUD state
  const [categoriesList, setCategoriesList] = useState<{ id: number; title: string }[]>([]);
  const [newCategoryTitle, setNewCategoryTitle] = useState('');
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // Services CRUD state
  const [servicesList, setServicesList] = useState<{ id: number; mainType: string; title: string; imageUrl?: string | null }[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  // Add Service Modal state
  const [addServiceModalOpen, setAddServiceModalOpen] = useState(false);
  const [activeAddServiceCategory, setActiveAddServiceCategory] = useState('');
  const [newModalServiceTitle, setNewModalServiceTitle] = useState('');
  const [addServiceImageFile, setAddServiceImageFile] = useState<File | null>(null);
  const [addServiceImagePreview, setAddServiceImagePreview] = useState<string | null>(null);

  // Edit Service Modal state
  const [editServiceModalOpen, setEditServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<{ id: number; mainType: string; title: string; imageUrl?: string | null } | null>(null);
  const [editServiceTitle, setEditServiceTitle] = useState('');
  const [editServiceImageFile, setEditServiceImageFile] = useState<File | null>(null);
  const [editServiceImagePreview, setEditServiceImagePreview] = useState<string | null>(null);
  const [removeEditImage, setRemoveEditImage] = useState(false);

  // Add Category with First Service state
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [newCategoryFormTitle, setNewCategoryFormTitle] = useState('');
  const [newCategoryFirstServiceTitle, setNewCategoryFirstServiceTitle] = useState('');
  const [newCategoryServiceImageFile, setNewCategoryServiceImageFile] = useState<File | null>(null);
  const [newCategoryServiceImagePreview, setNewCategoryServiceImagePreview] = useState<string | null>(null);

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

  // Provider Requests state
  const [providerRequestsList, setProviderRequestsList] = useState<any[]>([]);
  const [providerRequestsTab, setProviderRequestsTab] = useState<'Category' | 'Service'>('Category');
  const [providerRequestsLoading, setProviderRequestsLoading] = useState(false);
  const [providerRequestSearch, setProviderRequestSearch] = useState('');
  const [deleteRequestModalOpen, setDeleteRequestModalOpen] = useState(false);
  const [deletingRequestId, setDeletingRequestId] = useState<number | null>(null);
  const [deleteRequestLoading, setDeleteRequestLoading] = useState(false);

  // Booking List state
  const [bookingsList, setBookingsList] = useState<any[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingSearchQuery, setBookingSearchQuery] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled'>('all');

  // Promo Codes and Reports search/filter states
  const [voucherSearch, setVoucherSearch] = useState('');
  const [voucherStatusFilter, setVoucherStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [reportSearch, setReportSearch] = useState('');

  // Booking details drawer state
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [bookingDrawerOpen, setBookingDrawerOpen] = useState(false);
  const [copiedTxId, setCopiedTxId] = useState(false);

  const handleCopyTxId = (txId: string) => {
    if (!txId) return;
    navigator.clipboard.writeText(txId);
    setCopiedTxId(true);
    setTimeout(() => setCopiedTxId(false), 2000);
  };

  // Platform fee cut state
  const [platformFeeCut, setPlatformFeeCut] = useState<string>('5');
  const [platformFeeSaving, setPlatformFeeSaving] = useState(false);
  const [platformFeeMsg, setPlatformFeeMsg] = useState('');

  // Dashboard time filter state (day, week, month, all)
  const [dashboardTimeFilter, setDashboardTimeFilter] = useState<'day' | 'week' | 'month' | 'all'>('all');

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

  // Fetch configs dynamically on tab or sub-tab change
  useEffect(() => {
    if (isAuthenticated && token) {
      if (activeTab === 'vouchers') {
        fetchVouchers();
      } else if (activeTab === 'settings') {
        if (settingsSubTab === 'categories') {
          fetchCategories();
        } else if (settingsSubTab === 'services') {
          fetchCategories();
          fetchServices();
        } else if (settingsSubTab === 'ambience') {
          fetchAmbience();
        }
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

  const fetchVouchers = async () => {
    setVouchersLoading(true);
    try {
      const res = await fetch('/api/admin/settings/promocodes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPromoCodesList(data);
      }
    } catch (err) {
      console.error('Fetch promo codes failed', err);
    } finally {
      setVouchersLoading(false);
    }
  };

  const handleAddVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVoucherCode.trim() || !newVoucherTitle.trim() || !newVoucherAmount) return;
    setVouchersLoading(true);
    try {
      const res = await fetch('/api/admin/settings/vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: newVoucherCode.toUpperCase().trim(),
          title: newVoucherTitle,
          amount: parseFloat(newVoucherAmount),
          isActive: newVoucherIsActive
        }),
      });
      if (res.ok) {
        setNewVoucherCode('');
        setNewVoucherTitle('');
        setNewVoucherAmount('');
        setNewVoucherIsActive(true);
        fetchVouchers();
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to add promo codes');
      }
    } catch (err: any) {
      alert(err.message || 'Error occurred');
    } finally {
      setVouchersLoading(false);
    }
  };

  const handleUpdateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVoucherId || !editVoucherCode.trim() || !editVoucherTitle.trim() || !editVoucherAmount) return;
    setVouchersLoading(true);
    try {
      const res = await fetch('/api/admin/settings/vouchers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: editingVoucherId,
          code: editVoucherCode.toUpperCase().trim(),
          title: editVoucherTitle,
          amount: parseFloat(editVoucherAmount),
          isActive: editVoucherIsActive
        }),
      });
      if (res.ok) {
        setEditVoucherModalOpen(false);
        setEditingVoucherId(null);
        setEditVoucherCode('');
        setEditVoucherTitle('');
        setEditVoucherAmount('');
        setEditVoucherIsActive(true);
        fetchVouchers();
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to update promo codes');
      }
    } catch (err: any) {
      alert(err.message || 'Error occurred');
    } finally {
      setVouchersLoading(false);
    }
  };

  const handleDeleteVoucher = async (id: number) => {
    if (!confirm('Are you sure you want to delete this promo code?')) return;
    setVouchersLoading(true);
    try {
      const res = await fetch(`/api/admin/settings/vouchers?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchVouchers();
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to delete promo code');
      }
    } catch (err) {
      console.error('Delete promo code failed', err);
    } finally {
      setVouchersLoading(false);
    }
  };

  // --- APP VERSIONS HANDLERS ---
  const fetchAppVersions = async () => {
    setAppVersionLoading(true);
    try {
      const res = await fetch('/api/admin/settings/app-version', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAndroidVersion(data.androidVersion || '1.0.0');
        setIosVersion(data.iosVersion || '1.0.0');
      }
    } catch (err) {
      console.error('Fetch app versions failed', err);
    } finally {
      setAppVersionLoading(false);
    }
  };

  const handleSaveAppVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setAppVersionLoading(true);
    setAppVersionMsg('');
    try {
      const res = await fetch('/api/admin/settings/app-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          androidVersion,
          iosVersion
        })
      });
      if (res.ok) {
        setAppVersionMsg('App version settings saved successfully!');
        setTimeout(() => setAppVersionMsg(''), 3000);
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to save app version');
      }
    } catch (err: any) {
      alert(err.message || 'Error occurred');
    } finally {
      setAppVersionLoading(false);
    }
  };

  // --- CMS PAGES HANDLERS ---
  const slugToTitle = (slug: string) => {
    switch (slug) {
      case 'terms': return 'Terms & Conditions';
      case 'privacy-policy': return 'Privacy Policy';
      case 'refund-policy': return 'Refund Policy';
      case 'client-payment-policy': return 'Client Payment Policy';
      case 'provider-payment-policy': return 'Provider Payment Policy';
      case 'client-faqs': return 'Client FAQ';
      case 'provider-faqs': return 'Provider FAQ';
      case 'community-guidelines': return 'Community Guidelines';
      default: return slug;
    }
  };

  const fetchCmsPage = async (slug: string) => {
    setCmsLoading(true);
    setCmsSavedMsg('');
    try {
      const res = await fetch(`/api/cms/${slug}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCmsTitle(data.title || slugToTitle(slug));
        setCmsContent(typeof data.content === 'string' ? data.content : JSON.stringify(data.content, null, 2));
      }
    } catch (err) {
      console.error('Fetch CMS page failed', err);
    } finally {
      setCmsLoading(false);
    }
  };

  const handleSaveCmsPage = async (e: React.FormEvent) => {
    e.preventDefault();
    setCmsSaving(true);
    setCmsSavedMsg('');

    try {
      const res = await fetch('/api/admin/cms-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug: cmsActiveSlug, title: cmsTitle, content: cmsContent })
      });
      if (res.ok) {
        setCmsSavedMsg('CMS Page updated successfully!');
        setTimeout(() => setCmsSavedMsg(''), 3000);
      } else {
        const errData = await res.json();
        alert(errData.message || 'Failed to update CMS page');
      }
    } catch (err: any) {
      alert(err.message || 'Error saving page');
    } finally {
      setCmsSaving(false);
    }
  };



  // --- REPORT & ISSUES HANDLERS ---
  const fetchReports = async (statusFilter = reportsTab) => {
    setReportsLoading(true);
    try {
      const res = await fetch(`/api/admin/reports?status=${statusFilter}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setReportsList(data);
      }
    } catch (err) {
      console.error('Fetch reports failed', err);
    } finally {
      setReportsLoading(false);
    }
  };

  const handleToggleReportStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'open' ? 'closed' : 'open';
    setReportsUpdatingId(id);
    try {
      const res = await fetch('/api/admin/reports/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, status: newStatus })
      });
      if (res.ok) {
        fetchReports(reportsTab);
      }
    } catch (err) {
      console.error('Toggle status failed', err);
    } finally {
      setReportsUpdatingId(null);
    }
  };

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

  // Fetch Provider Requests
  const fetchProviderRequests = async () => {
    if (!token) return;
    setProviderRequestsLoading(true);
    try {
      const res = await fetch('/api/admin/provider-requests', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProviderRequestsList(data.requests || []);
      }
    } catch (err) {
      console.error('Failed to fetch provider requests', err);
    } finally {
      setProviderRequestsLoading(false);
    }
  };

  // Fetch Bookings
  const fetchBookings = async () => {
    if (!token) return;
    setBookingsLoading(true);
    try {
      const res = await fetch('/api/admin/bookings', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setBookingsList(data.bookings || []);
      }
    } catch (err) {
      console.error('Failed to fetch bookings', err);
    } finally {
      setBookingsLoading(false);
    }
  };

  // Fetch Platform Fee Cut
  const fetchPlatformFeeCut = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/settings/platform-fee', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.platformFeeCut !== undefined) {
          setPlatformFeeCut(String(data.platformFeeCut));
        }
      }
    } catch (err) {
      console.error('Failed to fetch platform fee cut', err);
    }
  };

  // Save Platform Fee Cut
  const handleSavePlatformFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setPlatformFeeSaving(true);
    setPlatformFeeMsg('');
    try {
      const res = await fetch('/api/admin/settings/platform-fee', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ platformFeeCut: parseFloat(platformFeeCut) })
      });
      const data = await res.json();
      if (res.ok) {
        setPlatformFeeMsg('Platform fee cut saved successfully!');
        setTimeout(() => setPlatformFeeMsg(''), 3000);
      } else {
        alert(data.message || 'Failed to save platform fee cut');
      }
    } catch (err: any) {
      alert(err.message || 'Error saving platform fee cut');
    } finally {
      setPlatformFeeSaving(false);
    }
  };

  // Delete Provider Request
  const handleDeleteRequest = async (id: number) => {
    if (!token) return;
    setDeleteRequestLoading(true);
    try {
      const res = await fetch(`/api/admin/provider-requests?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setProviderRequestsList((prev) => prev.filter((r) => r.id !== id));
        setDeleteRequestModalOpen(false);
        setDeletingRequestId(null);
      } else {
        const data = await res.json();
        alert(data.message || 'Failed to delete request');
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting request');
    } finally {
      setDeleteRequestLoading(false);
    }
  };

  // Tab switching data fetch
  useEffect(() => {
    if (isAuthenticated && token) {
      if (activeTab === 'dashboard') {
        fetchStats();
        fetchUsers();
        fetchBookings();
        fetchPlatformFeeCut();
      } else if (activeTab === 'vouchers') {
        fetchVouchers();
      } else if (activeTab === 'cms') {
        fetchCmsPage(cmsActiveSlug);
      } else if (activeTab === 'reports') {
        fetchReports(reportsTab);
      } else if (activeTab === 'provider-requests') {
        fetchProviderRequests();
      } else if (activeTab === 'bookings') {
        fetchBookings();
      } else if (activeTab === 'settings') {
        if (settingsSubTab === 'appversion') fetchAppVersions();
        else if (settingsSubTab === 'categories') fetchCategories();
        else if (settingsSubTab === 'services') {
          fetchServices();
          fetchPlatformFeeCut();
        }
        else if (settingsSubTab === 'ambience') fetchAmbience();
      }
    }
  }, [isAuthenticated, token, activeTab, cmsActiveSlug, reportsTab, settingsSubTab]);

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

  const toggleFeatured = async (userId: number, currentStatus?: boolean) => {
    const newStatus = !currentStatus;

    setUsers((prevUsers) =>
      prevUsers.map((u) => {
        if (u.id === userId) {
          return {
            ...u,
            isFeatured: newStatus,
            providerProfile: u.providerProfile
              ? { ...u.providerProfile, isFeatured: newStatus, featured: newStatus }
              : { isFeatured: newStatus, featured: newStatus, name: '', location: '', experience: 0 },
          };
        }
        return u;
      })
    );

    if (selectedUser && selectedUser.id === userId) {
      setSelectedUser((prev) =>
        prev
          ? {
            ...prev,
            isFeatured: newStatus,
            providerProfile: prev.providerProfile
              ? { ...prev.providerProfile, isFeatured: newStatus, featured: newStatus }
              : { isFeatured: newStatus, featured: newStatus, name: '', location: '', experience: 0 },
          }
          : null
      );
    }

    try {
      await fetch('/api/admin/users/featured', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ userId, isFeatured: newStatus }),
      });
    } catch (err) {
      console.error('Failed to toggle featured status', err);
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
  const filteredUsers = users.filter((u: any) => {
    const city = u.clientProfile?.city || u.providerProfile?.city || u.city || '';
    const country = u.clientProfile?.country || u.providerProfile?.country || u.country || '';
    const matchesSearch =
      (u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      country.toLowerCase().includes(searchQuery.toLowerCase());
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
              <img src="/assets/images/Look_Clean_New_Logo.png" alt="Look Clean Logo" className="w-full h-full object-cover" />
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
    <div className="min-h-screen bg-dark-bg text-gray-100 flex relative">
      {/* Decorative background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* LEFT SIDEBAR (Sticky on desktop, hidden on mobile) */}
      <aside className="hidden md:flex flex-col w-64 border-r border-gray-900 bg-gray-950/80 backdrop-blur z-20 shrink-0 p-5 justify-between h-screen sticky top-0">
        <div className="space-y-8">
          {/* Logo */}
          <div className="flex justify-center pt-2">
            <div className="h-[95px]">
              <img src="/assets/images/Look_Clean_New_Logo.png" alt="Look Clean Logo" className="w-full h-full object-cover" />
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
            <button
              onClick={() => handleTabChange('vouchers')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
                ${activeTab === 'vouchers'
                  ? 'bg-primary/10 border border-primary/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <Tag className="w-4 h-4" />
              <span>Promo Codes</span>
            </button>
            <button
              onClick={() => handleTabChange('cms')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
                ${activeTab === 'cms'
                  ? 'bg-primary/10 border border-primary/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <FileText className="w-4 h-4" />
              <span>CMS Pages</span>
            </button>
            <button
              onClick={() => handleTabChange('reports')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
                ${activeTab === 'reports'
                  ? 'bg-primary/10 border border-primary/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <AlertCircle className="w-4 h-4" />
              <span>Report & Issues</span>
            </button>
            <button
              onClick={() => handleTabChange('provider-requests')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
                ${activeTab === 'provider-requests'
                  ? 'bg-primary/10 border border-primary/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <Sparkles className="w-4 h-4" />
              <span>Provider Requests</span>
            </button>
            <button
              onClick={() => handleTabChange('bookings')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-left cursor-pointer transition-all
                ${activeTab === 'bookings'
                  ? 'bg-primary/10 border border-primary/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
                }
              `}
            >
              <Calendar className="w-4 h-4" />
              <span>Booking List</span>
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
              <img src="/assets/images/Look_Clean_New_Logo.png" alt="Look Clean Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-extrabold text-white text-lg">
              Look Clean Admin
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={handleLogout} rightIcon={<LogOut className="w-4 h-4" />}>
            Sign Out
          </Button>
        </header>

        {/* Main Content Area */}
        <main className="flex-grow w-full py-8 px-4 sm:px-8 space-y-8 z-10">
          {activeTab === 'vouchers' ? (
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <Tag className="w-5 h-5 text-primary" /> Promo Codes Settings
                  </h2>
                  <p className="text-xs text-gray-400">Create, update, activate/deactivate, and delete customer discount promo codes.</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <Input
                    type="text"
                    placeholder="Search code or title..."
                    value={voucherSearch}
                    onChange={(e) => setVoucherSearch(e.target.value)}
                    leftIcon={<Search className="w-4 h-4 text-gray-500" />}
                    className="w-full sm:w-64"
                  />

                  <select
                    value={voucherStatusFilter}
                    onChange={(e) => setVoucherStatusFilter(e.target.value as any)}
                    className="w-full sm:w-40 bg-gray-900 border border-gray-850 text-xs font-semibold text-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary transition-all cursor-pointer"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active Only</option>
                    <option value="inactive">Inactive Only</option>
                  </select>
                </div>
              </div>

              <Card className="border border-gray-850 p-6 space-y-4">
                <form onSubmit={handleAddVoucher} className="border border-gray-905 bg-gray-900/10 p-5 rounded-2xl space-y-4 pt-2">
                  <h4 className="text-[10px] font-extrabold text-primary uppercase tracking-wider mb-2">Create New promo codes</h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <Input
                      label="Promo Code"
                      type="text"
                      placeholder="e.g. SAVE20"
                      value={newVoucherCode}
                      onChange={(e) => setNewVoucherCode(e.target.value)}
                      required
                    />
                    <Input
                      label="Title/Description"
                      type="text"
                      placeholder="e.g. 20 Dollars Off"
                      value={newVoucherTitle}
                      onChange={(e) => setNewVoucherTitle(e.target.value)}
                      required
                    />
                    <Input
                      label="Discount Percentage (%)"
                      type="number"
                      placeholder="e.g. 10"
                      value={newVoucherAmount}
                      onChange={(e) => setNewVoucherAmount(e.target.value)}
                      required
                    />
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-450 uppercase tracking-wider block">Status</label>
                      <select
                        value={newVoucherIsActive ? 'active' : 'inactive'}
                        onChange={(e) => setNewVoucherIsActive(e.target.value === 'active')}
                        className="w-full text-xs text-gray-200 bg-gray-950 border border-gray-850 rounded-xl p-3 focus:border-primary transition-all focus:outline-none cursor-pointer"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="submit" isLoading={vouchersLoading} className="px-6 py-2.5">
                      Add promo codes
                    </Button>
                  </div>
                </form>

                <div className="border-t border-gray-900 pt-6">
                  <h4 className="text-xs font-bold text-gray-450 uppercase tracking-wider mb-3">All Promo Codes</h4>
                  {promoCodesList.length === 0 ? (
                    <p className="text-xs text-gray-500 italic py-4 text-center">No promo codes created yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-gray-850 text-gray-400 text-[10px] uppercase font-bold tracking-wider">
                            <th className="pb-3 pr-4">Code</th>
                            <th className="pb-3 pr-4">Title</th>
                            <th className="pb-3 pr-4">Discount (%)</th>
                            <th className="pb-3 pr-4">Status</th>
                            <th className="pb-3 pr-4">Created At</th>
                            <th className="pb-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-900">
                          {promoCodesList.filter((voucher) => {
                            const search = voucherSearch.toLowerCase();
                            const matchesSearch = !search || voucher.code.toLowerCase().includes(search) || (voucher.title || '').toLowerCase().includes(search);
                            const matchesStatus = voucherStatusFilter === 'all' || (voucherStatusFilter === 'active' ? voucher.isActive : !voucher.isActive);
                            return matchesSearch && matchesStatus;
                          }).map((voucher) => (
                            <tr key={voucher.id} className="text-xs text-gray-300 hover:bg-white/2 transition-colors">
                              <td className="py-3.5 pr-4 font-bold text-white tracking-wider">{voucher.code}</td>
                              <td className="py-3.5 pr-4 text-gray-450">{voucher.title}</td>
                              <td className="py-3.5 pr-4 font-semibold text-gray-200">{voucher.amount}%</td>
                              <td className="py-3.5 pr-4">
                                <button
                                  onClick={async () => {
                                    setVouchersLoading(true);
                                    try {
                                      const res = await fetch('/api/admin/settings/vouchers', {
                                        method: 'PUT',
                                        headers: {
                                          'Content-Type': 'application/json',
                                          Authorization: `Bearer ${token}`
                                        },
                                        body: JSON.stringify({
                                          id: voucher.id,
                                          code: voucher.code,
                                          title: voucher.title,
                                          amount: voucher.amount,
                                          isActive: !voucher.isActive
                                        })
                                      });
                                      if (res.ok) {
                                        fetchVouchers();
                                      } else {
                                        alert('Failed to toggle promo code status');
                                      }
                                    } catch (err) {
                                      console.error(err);
                                    } finally {
                                      setVouchersLoading(false);
                                    }
                                  }}
                                  className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase border cursor-pointer select-none transition-all
                                    ${voucher.isActive
                                      ? 'bg-emerald-500/10 text-emerald-450 border-emerald-500/20 hover:bg-emerald-500/20'
                                      : 'bg-red-500/10 text-red-450 border-red-500/20 hover:bg-red-500/20'
                                    }
                                  `}
                                >
                                  {voucher.isActive ? 'Active' : 'Inactive'}
                                </button>
                              </td>
                              <td className="py-3.5 pr-4 text-[10px] text-gray-500">
                                {new Date(voucher.createdAt).toLocaleDateString(undefined, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </td>
                              <td className="py-3.5 text-right space-x-2.5">
                                <button
                                  onClick={() => {
                                    setEditingVoucherId(voucher.id);
                                    setEditVoucherCode(voucher.code);
                                    setEditVoucherTitle(voucher.title);
                                    setEditVoucherAmount(String(voucher.amount));
                                    setEditVoucherIsActive(voucher.isActive);
                                    setEditVoucherModalOpen(true);
                                  }}
                                  className="text-[10px] text-primary hover:text-white font-extrabold uppercase transition-colors cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteVoucher(voucher.id)}
                                  className="text-[10px] text-red-400 hover:text-red-300 font-extrabold uppercase transition-colors cursor-pointer"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {editVoucherModalOpen && (
                  <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <Card className="border border-gray-850 p-6 space-y-4 max-w-md w-full bg-gray-950 shadow-2xl">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                        <Tag className="w-4 h-4 text-primary" /> Edit Promo Code
                      </h3>
                      <p className="text-xs text-gray-450">Modify the settings and status for the selected promo code.</p>

                      <form onSubmit={handleUpdateVoucher} className="space-y-4">
                        <Input
                          label="Promo Code"
                          type="text"
                          placeholder="e.g. SAVE20"
                          value={editVoucherCode}
                          onChange={(e) => setEditVoucherCode(e.target.value)}
                          required
                        />
                        <Input
                          label="Title/Description"
                          type="text"
                          placeholder="e.g. 20 Dollars Off"
                          value={editVoucherTitle}
                          onChange={(e) => setEditVoucherTitle(e.target.value)}
                          required
                        />
                        <Input
                          label="Discount Percentage (%)"
                          type="number"
                          placeholder="e.g. 10"
                          value={editVoucherAmount}
                          onChange={(e) => setEditVoucherAmount(e.target.value)}
                          required
                        />
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-gray-450 uppercase tracking-wider block">Status</label>
                          <select
                            value={editVoucherIsActive ? 'active' : 'inactive'}
                            onChange={(e) => setEditVoucherIsActive(e.target.value === 'active')}
                            className="w-full text-xs text-gray-200 bg-gray-950 border border-gray-850 rounded-xl p-3 focus:border-primary transition-all focus:outline-none cursor-pointer"
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditVoucherModalOpen(false);
                              setEditingVoucherId(null);
                            }}
                            className="px-4 py-2 rounded-xl border border-gray-800 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                          <Button type="submit" isLoading={vouchersLoading} className="px-5 py-2">
                            Save Changes
                          </Button>
                        </div>
                      </form>
                    </Card>
                  </div>
                )}
              </Card>
            </div>
          ) : activeTab === 'cms' ? (
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" /> CMS Pages Setting
                  </h2>
                  <p className="text-xs text-gray-400">Edit website &amp; app legal / policy content using rich editor.</p>
                </div>
                <a
                  href={`/${cmsActiveSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-xs font-bold text-primary hover:bg-primary/20 transition-all"
                >
                  <Globe className="w-3.5 h-3.5" /> Direct Page Visit: /{cmsActiveSlug} <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Top sub-tabs for selecting between all 5 CMS pages */}
              <div className="flex flex-wrap gap-2 border-b border-gray-900 pb-3">
                {[
                  { slug: 'terms', label: 'Terms & Conditions' },
                  { slug: 'privacy-policy', label: 'Privacy Policy' },
                  { slug: 'refund-policy', label: 'Refund Policy' },
                  { slug: 'client-payment-policy', label: 'Client Payment Policy' },
                  { slug: 'provider-payment-policy', label: 'Provider Payment Policy' },
                  { slug: 'client-faqs', label: 'Client FAQ' },
                  { slug: 'provider-faqs', label: 'Provider FAQ' },
                  { slug: 'community-guidelines', label: 'Community Guidelines' }
                ].map((item) => (
                  <button
                    key={item.slug}
                    onClick={() => {
                      setCmsActiveSlug(item.slug as any);
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border
                      ${cmsActiveSlug === item.slug
                        ? 'bg-primary/20 border-primary text-white shadow-lg shadow-primary/10'
                        : 'bg-gray-900/60 border-gray-850 text-gray-400 hover:text-white hover:border-gray-700'
                      }
                    `}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Rich Editor Card */}
              <Card className="border border-gray-850 p-6 space-y-6">
                <form onSubmit={handleSaveCmsPage} className="space-y-5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-900 pb-4">
                    <div className="flex-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1">Page Title</label>
                      <input
                        type="text"
                        value={cmsTitle}
                        onChange={(e) => setCmsTitle(e.target.value)}
                        className="w-full text-base font-bold text-white bg-gray-950 border border-gray-850 rounded-xl px-4 py-2.5 focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-3 pt-4 md:pt-0">
                      <Button type="submit" isLoading={cmsSaving} leftIcon={<Save className="w-4 h-4" />}>
                        Save CMS Page
                      </Button>
                    </div>
                  </div>

                  {cmsSavedMsg && (
                    <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-xs font-semibold flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" /> {cmsSavedMsg}
                    </div>
                  )}

                  {/* CMS Content Editor */}
                  {cmsLoading ? (
                    <div className="py-12 text-center text-gray-400 text-xs">Loading CMS page content...</div>
                  ) : (
                    <CmsRichEditor
                      value={cmsContent}
                      onChange={setCmsContent}
                      placeholder="Write page content here..."
                    />
                  )}
                </form>
              </Card>
            </div>

          ) : activeTab === 'reports' ? (
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-primary" /> Report &amp; Issues
                  </h2>
                  <p className="text-xs text-gray-400">Review app feedback and bug complaints submitted by users with attachments.</p>
                </div>

                <div className="flex items-center gap-3">
                  <Input
                    type="text"
                    placeholder="Search report title, user..."
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                    leftIcon={<Search className="w-4 h-4 text-gray-500" />}
                    className="w-full sm:w-64"
                  />
                </div>
              </div>

              {/* Sub-tabs for Open vs Closed */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setReportsTab('open')}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border
                    ${reportsTab === 'open'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : 'bg-gray-900/60 border-gray-850 text-gray-400 hover:text-white'
                    }
                  `}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>Open Reports</span>
                </button>
                <button
                  onClick={() => setReportsTab('closed')}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border
                    ${reportsTab === 'closed'
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-gray-900/60 border-gray-850 text-gray-400 hover:text-white'
                    }
                  `}
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>Closed Reports</span>
                </button>
              </div>

              {reportsLoading ? (
                <div className="py-12 text-center text-gray-400 text-xs">Loading issue reports...</div>
              ) : reportsList.length === 0 ? (
                <Card className="p-8 text-center text-gray-400 text-xs">
                  No {reportsTab} issue reports found.
                </Card>
              ) : (
                <div className="space-y-4">
                  {reportsList.filter((report) => {
                    const search = reportSearch.toLowerCase();
                    if (!search) return true;
                    return (
                      (report.title || '').toLowerCase().includes(search) ||
                      (report.message || '').toLowerCase().includes(search) ||
                      (report.user?.name || '').toLowerCase().includes(search) ||
                      (report.user?.email || '').toLowerCase().includes(search)
                    );
                  }).map((report) => {
                    let attachmentsArr: string[] = [];
                    try {
                      if (typeof report.attachments === 'string') {
                        attachmentsArr = JSON.parse(report.attachments);
                      } else if (Array.isArray(report.attachments)) {
                        attachmentsArr = report.attachments;
                      }
                    } catch { }

                    return (
                      <Card key={report.id} className="border border-gray-850 p-6 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-gray-900 pb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border
                                ${report.status === 'open' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}
                              `}>
                                Status: {report.status}
                              </span>
                              <span className="text-[10px] text-gray-500">
                                Reported: {new Date(report.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <h3 className="text-base font-bold text-white mt-1">{report.title}</h3>
                          </div>
                          <Button
                            variant={report.status === 'open' ? 'primary' : 'secondary'}
                            size="sm"
                            isLoading={reportsUpdatingId === report.id}
                            onClick={() => handleToggleReportStatus(report.id, report.status)}
                          >
                            {report.status === 'open' ? 'Mark as Closed' : 'Reopen Report'}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs text-gray-300 leading-relaxed bg-gray-950 p-4 rounded-xl border border-gray-900 whitespace-pre-wrap">
                            {report.message}
                          </p>
                        </div>

                        {report.user && (
                          <div className="flex items-center gap-3 text-xs text-gray-400 bg-gray-900/40 p-3 rounded-xl">
                            <span className="font-bold text-gray-200">Submitter:</span>
                            <span>{report.user.name || 'Anonymous User'}</span>
                            {report.user.email && <span>({report.user.email})</span>}
                          </div>
                        )}

                        {attachmentsArr.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Attachments ({attachmentsArr.length})</span>
                            <div className="flex flex-wrap gap-3">
                              {attachmentsArr.map((attUrl, idx) => (
                                <a
                                  key={idx}
                                  href={attUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-20 h-20 rounded-xl overflow-hidden border border-gray-800 bg-gray-950 hover:border-primary transition-all relative block"
                                >
                                  <img src={attUrl} alt="attachment" className="w-full h-full object-cover" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          ) : activeTab === 'provider-requests' ? (
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" /> Provider Requests
                  </h2>
                  <p className="text-xs text-gray-400">Review new category and service addition requests submitted by service providers.</p>
                </div>

                <div className="flex items-center gap-3">
                  <Input
                    type="text"
                    placeholder="Search provider or request title..."
                    value={providerRequestSearch}
                    onChange={(e) => setProviderRequestSearch(e.target.value)}
                    leftIcon={<Search className="w-4 h-4 text-gray-500" />}
                    className="w-full sm:w-64"
                  />
                </div>
              </div>

              {/* Filter Sub-Tabs */}
              <div className="flex items-center gap-3 border-b border-gray-900 pb-3">
                <button
                  onClick={() => setProviderRequestsTab('Category')}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border
                    ${providerRequestsTab === 'Category'
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-gray-900/60 border-gray-850 text-gray-400 hover:text-white'
                    }
                  `}
                >
                  <Tag className="w-4 h-4" />
                  <span>Category Requests</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-extrabold ml-1">
                    {providerRequestsList.filter((r) => r.requestType?.toLowerCase() === 'category').length}
                  </span>
                </button>

                <button
                  onClick={() => setProviderRequestsTab('Service')}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border
                    ${providerRequestsTab === 'Service'
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                      : 'bg-gray-900/60 border-gray-850 text-gray-400 hover:text-white'
                    }
                  `}
                >
                  <Scissors className="w-4 h-4" />
                  <span>Service Requests</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-extrabold ml-1">
                    {providerRequestsList.filter((r) => r.requestType?.toLowerCase() === 'service').length}
                  </span>
                </button>
              </div>

              {/* Requests List Table */}
              {providerRequestsLoading ? (
                <div className="py-12 text-center text-gray-400 text-xs">Loading provider requests...</div>
              ) : (
                <Card className="border border-gray-850 p-0 overflow-hidden">
                  {(() => {
                    const filtered = providerRequestsList.filter((r) => {
                      const matchesTab = r.requestType?.toLowerCase() === providerRequestsTab.toLowerCase();
                      const search = providerRequestSearch.toLowerCase();
                      const matchesSearch =
                        !search ||
                        r.requestTitle?.toLowerCase().includes(search) ||
                        r.provider?.name?.toLowerCase().includes(search) ||
                        r.provider?.email?.toLowerCase().includes(search);
                      return matchesTab && matchesSearch;
                    });

                    if (filtered.length === 0) {
                      return (
                        <div className="p-8 text-center text-gray-400 text-xs">
                          No {providerRequestsTab.toLowerCase()} requests found.
                        </div>
                      );
                    }

                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-gray-900 bg-gray-950/60 text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                              <th className="py-3.5 px-4">Request ID</th>
                              <th className="py-3.5 px-4">Provider</th>
                              <th className="py-3.5 px-4">Request Type</th>
                              <th className="py-3.5 px-4">Requested Title</th>
                              <th className="py-3.5 px-4">Date</th>
                              <th className="py-3.5 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-900/60 text-xs">
                            {filtered.map((req) => (
                              <tr key={req.id} className="hover:bg-white/[0.02] transition-colors">
                                <td className="py-3.5 px-4 font-mono text-gray-400 font-bold">#{req.id}</td>
                                <td className="py-3.5 px-4">
                                  <div className="font-semibold text-white">
                                    {req.provider?.name || req.provider?.providerProfile?.salonName || `Provider #${req.providerId}`}
                                  </div>
                                  <div className="text-[11px] text-gray-400">{req.provider?.email || '-'}</div>
                                </td>
                                <td className="py-3.5 px-4">
                                  <span className={`px-2.5 py-1 rounded text-[10px] font-extrabold uppercase border ${req.requestType === 'Category'
                                    ? 'bg-primary/10 text-primary border-primary/20'
                                    : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                    }`}>
                                    {req.requestType}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4 font-bold text-gray-200">
                                  {req.requestTitle}
                                </td>
                                <td className="py-3.5 px-4 text-gray-400 text-[11px]">
                                  {new Date(req.createdAt).toLocaleDateString()} {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="py-3.5 px-4 text-right">
                                  <button
                                    onClick={() => {
                                      setDeletingRequestId(req.id);
                                      setDeleteRequestModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-red-400 hover:text-red-300 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-all cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </Card>
              )}
            </div>
          ) : activeTab === 'bookings' ? (
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary" /> Booking List
                  </h2>
                  <p className="text-xs text-gray-400">View customer appointments, provider assignments, and complete fee details.</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <Input
                    type="text"
                    placeholder="Search by ID, client, provider..."
                    value={bookingSearchQuery}
                    onChange={(e) => setBookingSearchQuery(e.target.value)}
                    leftIcon={<Search className="w-4 h-4 text-gray-500" />}
                    className="w-full sm:w-64"
                  />

                  <select
                    value={bookingStatusFilter}
                    onChange={(e) => setBookingStatusFilter(e.target.value as any)}
                    className="w-full sm:w-40 bg-gray-900 border border-gray-850 text-xs font-semibold text-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary transition-all cursor-pointer"
                  >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Bookings Data Table */}
              {bookingsLoading ? (
                <div className="py-12 text-center text-gray-400 text-xs">Loading booking records...</div>
              ) : (
                <Card className="border border-gray-850 p-0 overflow-hidden">
                  {(() => {
                    const filtered = bookingsList.filter((b) => {
                      const search = bookingSearchQuery.toLowerCase();
                      const matchesSearch =
                        !search ||
                        String(b.id).includes(search) ||
                        b.client?.name?.toLowerCase().includes(search) ||
                        b.client?.email?.toLowerCase().includes(search) ||
                        b.provider?.name?.toLowerCase().includes(search) ||
                        b.provider?.email?.toLowerCase().includes(search) ||
                        b.provider?.providerProfile?.salonName?.toLowerCase().includes(search);
                      const matchesStatus = bookingStatusFilter === 'all' || b.status?.toLowerCase() === bookingStatusFilter.toLowerCase();
                      return matchesSearch && matchesStatus;
                    });

                    if (filtered.length === 0) {
                      return (
                        <div className="p-8 text-center text-gray-400 text-xs">
                          No bookings found matching filters.
                        </div>
                      );
                    }

                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-gray-900 bg-gray-950/60 text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                              <th className="py-3.5 px-4">Booking ID</th>
                              <th className="py-3.5 px-4">Date & Slot</th>
                              <th className="py-3.5 px-4">Client</th>
                              <th className="py-3.5 px-4">Provider</th>
                              <th className="py-3.5 px-4">Services</th>
                              <th className="py-3.5 px-4">Status</th>
                              <th className="py-3.5 px-4">Total Amount</th>
                              <th className="py-3.5 px-4 text-right">Details</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-900/60 text-xs">
                            {filtered.map((booking) => {
                              const statusColor =
                                booking.status === 'completed'
                                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                  : booking.status === 'confirmed'
                                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                    : booking.status === 'cancelled'
                                      ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

                              const serviceNames = Array.isArray(booking.services)
                                ? booking.services.map((s: any) => s.name || s.title).join(', ')
                                : 'Services';

                              return (
                                <tr key={booking.id} className="hover:bg-white/[0.02] transition-colors">
                                  <td className="py-3.5 px-4 font-mono font-bold text-gray-300">#{booking.id}</td>
                                  <td className="py-3.5 px-4">
                                    <div className="font-semibold text-white">
                                      {new Date(booking.date).toLocaleDateString()}
                                    </div>
                                    <div className="text-[11px] text-gray-400">{booking.timeSlot}</div>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <div className="font-semibold text-white">{booking.client?.name || `Client #${booking.clientId}`}</div>
                                    <div className="text-[11px] text-gray-400">{booking.client?.email || '-'}</div>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <div className="font-semibold text-white">
                                      {booking.provider?.name || booking.provider?.providerProfile?.salonName || `Provider #${booking.providerId}`}
                                    </div>
                                    <div className="text-[11px] text-gray-400">{booking.provider?.email || '-'}</div>
                                  </td>
                                  <td className="py-3.5 px-4 max-w-[200px] truncate text-gray-300">
                                    {serviceNames || 'N/A'}
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase border ${statusColor}`}>
                                      {booking.status || 'pending'}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4 font-extrabold text-white">
                                    ${(booking.grandTotal || booking.serviceAmount || 0).toFixed(2)}
                                  </td>
                                  <td className="py-3.5 px-4 text-right">
                                    <button
                                      onClick={() => {
                                        setSelectedBooking(booking);
                                        setBookingDrawerOpen(true);
                                      }}
                                      className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:text-white px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary border border-primary/20 transition-all cursor-pointer"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>View Details</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </Card>
              )}
            </div>
          ) : activeTab === 'dashboard' ? (
            <div className="space-y-6">
              {/* Header & Timeframe Filter Bar */}
              <div className="border-b border-gray-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-primary" /> Admin Analytics Dashboard
                  </h2>
                  <p className="text-xs text-gray-400">
                    Real-time metrics for platform revenue, customer signups, provider onboardings, and bookings.
                  </p>
                </div>

                {/* Day, Week, Month, All Filter Pills */}
                <div className="flex items-center bg-gray-950 p-1 rounded-xl border border-gray-850 self-start md:self-auto">
                  {(['day', 'week', 'month', 'all'] as const).map((filterKey) => {
                    const labels = {
                      day: 'Today (Day)',
                      week: 'This Week',
                      month: 'This Month',
                      all: 'All Time'
                    };
                    const isActive = dashboardTimeFilter === filterKey;
                    return (
                      <button
                        key={filterKey}
                        onClick={() => setDashboardTimeFilter(filterKey)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${isActive
                          ? 'bg-primary text-gray-950 shadow-md shadow-primary/20'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                          }`}
                      >
                        {labels[filterKey]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Calculations based on filter */}
              {(() => {
                const isWithinFilter = (dateInput: any) => {
                  if (!dateInput || dashboardTimeFilter === 'all') return true;
                  const d = new Date(dateInput);
                  if (isNaN(d.getTime())) return true;
                  const now = new Date();
                  const diffMs = now.getTime() - d.getTime();
                  const diffDays = diffMs / (1000 * 60 * 60 * 24);

                  if (dashboardTimeFilter === 'day') {
                    return diffDays >= 0 && diffDays <= 1 || d.toDateString() === now.toDateString();
                  }
                  if (dashboardTimeFilter === 'week') {
                    return diffDays >= 0 && diffDays <= 7;
                  }
                  if (dashboardTimeFilter === 'month') {
                    return diffDays >= 0 && diffDays <= 30;
                  }
                  return true;
                };

                const filteredUsers = users.filter((u) => isWithinFilter(u.createdAt));
                const filteredBookings = bookingsList.filter((b) => isWithinFilter(b.createdAt || b.date));

                const totalCustomers = filteredUsers.filter((u) => u.role === 'client').length || (dashboardTimeFilter === 'all' ? stats.clients : 0);
                const totalProviders = filteredUsers.filter((u) => u.role === 'provider').length || (dashboardTimeFilter === 'all' ? stats.providers : 0);
                const totalBookings = filteredBookings.length;

                const feeCutPct = parseFloat(platformFeeCut) || 5;
                const totalGrossRevenue = filteredBookings.reduce((sum, b) => sum + (b.grandTotal || b.serviceAmount || 0), 0);
                const totalServiceSubtotal = filteredBookings.reduce((sum, b) => sum + (b.serviceAmount || 0), 0);
                const totalPlatformCommission = (totalServiceSubtotal * feeCutPct) / 100;
                const totalProviderPayout = (totalServiceSubtotal - totalPlatformCommission) + filteredBookings.reduce((sum, b) => sum + (b.tipAmount || 0), 0);

                const completedCount = filteredBookings.filter((b) => b.status === 'completed').length;
                const confirmedCount = filteredBookings.filter((b) => b.status === 'confirmed').length;
                const pendingCount = filteredBookings.filter((b) => b.status === 'pending').length;
                const cancelledCount = filteredBookings.filter((b) => b.status === 'cancelled').length;

                return (
                  <div className="space-y-6">
                    {/* Top 4 KPI Grid Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Card 1: Total Revenue */}
                      <Card className="border border-gray-850 p-5 bg-gray-900/40 relative overflow-hidden">
                        <div className="flex items-center justify-between text-gray-400 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider">Total Revenue</span>
                          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                            <DollarSign className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="text-2xl font-extrabold text-white">${totalGrossRevenue.toFixed(2)}</div>
                        <div className="mt-2 pt-2 border-t border-gray-900 flex items-center justify-between text-[11px]">
                          <span className="text-gray-400">Platform Cut ({feeCutPct}%):</span>
                          <span className="font-extrabold text-emerald-400">+${totalPlatformCommission.toFixed(2)}</span>
                        </div>
                      </Card>

                      {/* Card 2: Total Customers Joined */}
                      <Card className="border border-gray-850 p-5 bg-gray-900/40 relative overflow-hidden">
                        <div className="flex items-center justify-between text-gray-400 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider">Customers Joined</span>
                          <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                            <Users className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="text-2xl font-extrabold text-white">{totalCustomers}</div>
                        <div className="mt-2 pt-2 border-t border-gray-900 flex items-center justify-between text-[11px]">
                          <span className="text-gray-400">Total Registered Clients</span>
                          <span className="font-extrabold text-purple-400">{stats.clients} total</span>
                        </div>
                      </Card>

                      {/* Card 3: Total Providers Joined */}
                      <Card className="border border-gray-850 p-5 bg-gray-900/40 relative overflow-hidden">
                        <div className="flex items-center justify-between text-gray-400 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider">Providers Joined</span>
                          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                            <Building className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="text-2xl font-extrabold text-white">{totalProviders}</div>
                        <div className="mt-2 pt-2 border-t border-gray-900 flex items-center justify-between text-[11px]">
                          <span className="text-gray-400">Verified Providers & Salons</span>
                          <span className="font-extrabold text-amber-400">{stats.providers} total</span>
                        </div>
                      </Card>

                      {/* Card 4: Total Bookings Made */}
                      <Card className="border border-gray-850 p-5 bg-gray-900/40 relative overflow-hidden">
                        <div className="flex items-center justify-between text-gray-400 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider">Bookings Made</span>
                          <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                            <Calendar className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="text-2xl font-extrabold text-white">{totalBookings}</div>
                        <div className="mt-2 pt-2 border-t border-gray-900 flex items-center justify-between text-[11px]">
                          <span className="text-gray-400">Completed Orders</span>
                          <span className="font-extrabold text-emerald-400">{completedCount} completed</span>
                        </div>
                      </Card>
                    </div>

                    {/* Detailed Financial & Booking Analytics Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Financial Overview Card */}
                      <Card className="border border-gray-850 p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-900 pb-3">
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Tag className="w-4 h-4 text-emerald-400" /> Revenue & Payout Financial Breakdown
                          </h3>
                          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {dashboardTimeFilter === 'day' ? 'Today' : dashboardTimeFilter === 'week' ? 'This Week' : dashboardTimeFilter === 'month' ? 'This Month' : 'All Time'}
                          </span>
                        </div>

                        <div className="space-y-3 text-xs divide-y divide-gray-900">
                          <div className="flex justify-between py-2 text-gray-300">
                            <span className="font-medium">Gross Bookings Volume</span>
                            <span className="font-extrabold text-white">${totalGrossRevenue.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between py-2 text-gray-300">
                            <span className="font-medium">Service Subtotal Amount</span>
                            <span className="font-semibold text-gray-200">${totalServiceSubtotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between py-2 text-gray-300">
                            <span className="font-medium">Platform Commission Earned ({feeCutPct}%)</span>
                            <span className="font-extrabold text-emerald-400">+${totalPlatformCommission.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between py-2 text-gray-300">
                            <span className="font-medium">Net Cleared Provider Payout</span>
                            <span className="font-semibold text-indigo-400">${totalProviderPayout.toFixed(2)}</span>
                          </div>
                        </div>
                      </Card>

                      {/* Bookings Status Breakdown Card */}
                      <Card className="border border-gray-850 p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-900 pb-3">
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Activity className="w-4 h-4 text-primary" /> Bookings Performance & Status
                          </h3>
                          <span className="text-[10px] text-gray-400 font-bold uppercase">
                            {totalBookings} Total Requests
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div className="p-3.5 rounded-xl bg-green-500/5 border border-green-500/10 space-y-1">
                            <div className="text-[10px] font-bold text-green-400 uppercase tracking-wider">Completed</div>
                            <div className="text-xl font-extrabold text-white">{completedCount}</div>
                            <div className="text-[10px] text-gray-400">
                              {totalBookings > 0 ? Math.round((completedCount / totalBookings) * 100) : 0}% of bookings
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl bg-blue-500/5 border border-blue-500/10 space-y-1">
                            <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Confirmed</div>
                            <div className="text-xl font-extrabold text-white">{confirmedCount}</div>
                            <div className="text-[10px] text-gray-400">
                              {totalBookings > 0 ? Math.round((confirmedCount / totalBookings) * 100) : 0}% of bookings
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/10 space-y-1">
                            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Pending</div>
                            <div className="text-xl font-extrabold text-white">{pendingCount}</div>
                            <div className="text-[10px] text-gray-400">
                              {totalBookings > 0 ? Math.round((pendingCount / totalBookings) * 100) : 0}% of bookings
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl bg-red-500/5 border border-red-500/10 space-y-1">
                            <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Cancelled</div>
                            <div className="text-xl font-extrabold text-white">{cancelledCount}</div>
                            <div className="text-[10px] text-gray-400">
                              {totalBookings > 0 ? Math.round((cancelledCount / totalBookings) * 100) : 0}% of bookings
                            </div>
                          </div>
                        </div>
                      </Card>
                    </div>

                    {/* Quick Overview Table: Recent Bookings */}
                    <Card className="border border-gray-850 p-6 space-y-4">
                      <div className="flex items-center justify-between border-b border-gray-900 pb-3">
                        <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-emerald-400" /> Recent Bookings
                          </h3>
                          <p className="text-xs text-gray-400">Latest customer appointments in selected timeframe.</p>
                        </div>
                        <button
                          onClick={() => handleTabChange('bookings')}
                          className="text-xs font-bold text-primary hover:text-white transition-colors cursor-pointer"
                        >
                          View All Bookings &rarr;
                        </button>
                      </div>

                      {filteredBookings.length === 0 ? (
                        <p className="text-xs text-gray-500 italic py-4 text-center">No bookings recorded for this timeframe.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-gray-900 text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                                <th className="py-2.5 px-3">Booking ID</th>
                                <th className="py-2.5 px-3">Date</th>
                                <th className="py-2.5 px-3">Client</th>
                                <th className="py-2.5 px-3">Provider</th>
                                <th className="py-2.5 px-3">Status</th>
                                <th className="py-2.5 px-3 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-900 text-xs text-gray-300">
                              {filteredBookings.slice(0, 5).map((booking) => (
                                <tr key={booking.id} className="hover:bg-white/2 transition-colors">
                                  <td className="py-3 px-3 font-mono font-bold text-white">#{booking.id}</td>
                                  <td className="py-3 px-3">{new Date(booking.date).toLocaleDateString()}</td>
                                  <td className="py-3 px-3 font-semibold text-white">{booking.client?.name || `Client #${booking.clientId}`}</td>
                                  <td className="py-3 px-3">{booking.provider?.name || booking.provider?.providerProfile?.salonName || `Provider #${booking.providerId}`}</td>
                                  <td className="py-3 px-3">
                                    <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase border ${booking.status === 'completed'
                                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                      : booking.status === 'confirmed'
                                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                        : booking.status === 'cancelled'
                                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                      }`}>
                                      {booking.status || 'pending'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3 text-right font-extrabold text-white">
                                    ${(booking.grandTotal || booking.serviceAmount || 0).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Card>
                  </div>
                );
              })()}
            </div>
          ) : activeTab === 'settings' ? (
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4">
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-primary" /> System Settings
                </h2>
                <p className="text-xs text-gray-400">Manage administrator credentials, app versioning, and system configurations.</p>
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
                    onClick={() => setSettingsSubTab('appversion')}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-left transition-all w-full cursor-pointer
                      ${settingsSubTab === 'appversion'
                        ? 'bg-primary/10 border border-primary/20 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                      }
                    `}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>App Versions</span>
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
                  ) : settingsSubTab === 'appversion' ? (
                    <Card className="border border-gray-850 p-6 space-y-6">
                      <div className="border-b border-gray-900 pb-3">
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                          <Smartphone className="w-5 h-5 text-primary" /> Mobile App Version Control
                        </h3>
                        <p className="text-xs text-gray-400">Configure current Android and iOS version requirements for app updates.</p>
                      </div>

                      {appVersionMsg && (
                        <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-400 rounded-xl text-xs font-semibold flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" /> {appVersionMsg}
                        </div>
                      )}

                      <form onSubmit={handleSaveAppVersion} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Android Settings Card */}
                          <div className="bg-gray-950 border border-gray-850 p-5 rounded-2xl space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-green-400 flex items-center gap-2">
                              <Smartphone className="w-4 h-4" /> Android App Version
                            </h4>
                            <Input
                              label="Current Android Version"
                              type="text"
                              placeholder="1.0.0"
                              value={androidVersion}
                              onChange={(e) => setAndroidVersion(e.target.value)}
                              required
                            />
                          </div>

                          {/* iOS Settings Card */}
                          <div className="bg-gray-950 border border-gray-850 p-5 rounded-2xl space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
                              <Smartphone className="w-4 h-4" /> iOS App Version
                            </h4>
                            <Input
                              label="Current iOS Version"
                              type="text"
                              placeholder="1.0.0"
                              value={iosVersion}
                              onChange={(e) => setIosVersion(e.target.value)}
                              required
                            />
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <Button type="submit" isLoading={appVersionLoading} leftIcon={<Save className="w-4 h-4" />}>
                            Save App Version Settings
                          </Button>
                        </div>
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
                    <div className="space-y-6">
                      <Card className="border border-gray-850 p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-900 pb-3">
                          <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                              <Settings className="w-4 h-4 text-primary" /> Platform Fee Cut Setting
                            </h3>
                            <p className="text-xs text-gray-400">Set the default percentage cut collected by the platform on completed bookings.</p>
                          </div>
                        </div>
                        <form onSubmit={handleSavePlatformFee} className="flex flex-col sm:flex-row items-end gap-4">
                          <div className="flex-1">
                            <Input
                              label="Platform Fee Cut (%)"
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              placeholder="e.g. 5"
                              value={platformFeeCut}
                              onChange={(e) => setPlatformFeeCut(e.target.value)}
                              required
                            />
                          </div>
                          <Button type="submit" variant="primary" isLoading={platformFeeSaving}>
                            Save Fee Cut
                          </Button>
                        </form>
                        {platformFeeMsg && (
                          <p className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" /> {platformFeeMsg}
                          </p>
                        )}
                      </Card>

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
                                            <div className="flex items-center gap-3">
                                              {service.imageUrl ? (
                                                <img
                                                  src={service.imageUrl}
                                                  alt={service.title}
                                                  className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0"
                                                />
                                              ) : (
                                                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                                                  <Scissors className="w-4 h-4" />
                                                </div>
                                              )}
                                              <span className="text-xs font-semibold text-gray-200">{service.title}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                              <button
                                                onClick={() => {
                                                  setEditingService(service);
                                                  setEditServiceTitle(service.title);
                                                  setEditServiceImagePreview(service.imageUrl || null);
                                                  setEditServiceImageFile(null);
                                                  setRemoveEditImage(false);
                                                  setEditServiceModalOpen(true);
                                                }}
                                                className="text-[10px] text-blue-400 hover:text-blue-300 font-bold uppercase px-2 py-1 rounded hover:bg-blue-500/10 cursor-pointer flex items-center gap-1"
                                              >
                                                <Edit3 className="w-3 h-3" />
                                                <span>Edit</span>
                                              </button>
                                              <button
                                                onClick={() => handleDeleteService(service.id)}
                                                className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase px-2 py-1 rounded hover:bg-red-500/10 cursor-pointer flex items-center gap-1"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                                <span>Delete</span>
                                              </button>
                                            </div>
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
                                    let svcRes: Response;
                                    if (newCategoryServiceImageFile) {
                                      const formData = new FormData();
                                      formData.append('mainType', newCategoryFormTitle);
                                      formData.append('title', newCategoryFirstServiceTitle);
                                      formData.append('image', newCategoryServiceImageFile);
                                      svcRes = await fetch('/api/admin/settings/services', {
                                        method: 'POST',
                                        headers: { Authorization: `Bearer ${token}` },
                                        body: formData,
                                      });
                                    } else {
                                      svcRes = await fetch('/api/admin/settings/services', {
                                        method: 'POST',
                                        headers: {
                                          'Content-Type': 'application/json',
                                          Authorization: `Bearer ${token}`,
                                        },
                                        body: JSON.stringify({ mainType: newCategoryFormTitle, title: newCategoryFirstServiceTitle }),
                                      });
                                    }

                                    if (!svcRes.ok) {
                                      const errData = await svcRes.json();
                                      throw new Error(errData.message || 'Failed to create first service');
                                    }

                                    setIsAddingNewCategory(false);
                                    setNewCategoryFormTitle('');
                                    setNewCategoryFirstServiceTitle('');
                                    setNewCategoryServiceImageFile(null);
                                    setNewCategoryServiceImagePreview(null);
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
                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-gray-300">Service Image (Optional)</label>
                                    <div className="flex items-center gap-3">
                                      {newCategoryServiceImagePreview ? (
                                        <img src={newCategoryServiceImagePreview} alt="Preview" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                                      ) : (
                                        <div className="w-10 h-10 rounded-lg bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-500">
                                          <Scissors className="w-4 h-4" />
                                        </div>
                                      )}
                                      <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            setNewCategoryServiceImageFile(file);
                                            setNewCategoryServiceImagePreview(URL.createObjectURL(file));
                                          }
                                        }}
                                        className="text-xs text-gray-400 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex justify-end gap-3 pt-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsAddingNewCategory(false);
                                        setNewCategoryServiceImageFile(null);
                                        setNewCategoryServiceImagePreview(null);
                                      }}
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
                              <p className="text-xs text-gray-450">Please enter a title and optional image for the new sub-service.</p>

                              <form onSubmit={async (e) => {
                                e.preventDefault();
                                if (!newModalServiceTitle.trim()) return;
                                setServicesLoading(true);
                                try {
                                  let res: Response;
                                  if (addServiceImageFile) {
                                    const formData = new FormData();
                                    formData.append('mainType', activeAddServiceCategory);
                                    formData.append('title', newModalServiceTitle);
                                    formData.append('image', addServiceImageFile);
                                    res = await fetch('/api/admin/settings/services', {
                                      method: 'POST',
                                      headers: { Authorization: `Bearer ${token}` },
                                      body: formData,
                                    });
                                  } else {
                                    res = await fetch('/api/admin/settings/services', {
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
                                  }
                                  if (res.ok) {
                                    setAddServiceModalOpen(false);
                                    setNewModalServiceTitle('');
                                    setAddServiceImageFile(null);
                                    setAddServiceImagePreview(null);
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

                                <div className="space-y-1">
                                  <label className="text-xs font-medium text-gray-300">Service Image (Optional)</label>
                                  <div className="flex items-center gap-3">
                                    {addServiceImagePreview ? (
                                      <img src={addServiceImagePreview} alt="Preview" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-500">
                                        <Scissors className="w-4 h-4" />
                                      </div>
                                    )}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          setAddServiceImageFile(file);
                                          setAddServiceImagePreview(URL.createObjectURL(file));
                                        }
                                      }}
                                      className="text-xs text-gray-400 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                                    />
                                  </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAddServiceModalOpen(false);
                                      setAddServiceImageFile(null);
                                      setAddServiceImagePreview(null);
                                    }}
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

                        {/* Edit Service Modal Overlay */}
                        {editServiceModalOpen && editingService && (
                          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                            <Card className="border border-gray-850 p-6 space-y-4 max-w-md w-full bg-gray-950 shadow-2xl">
                              <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                                <Scissors className="w-4 h-4 text-primary" /> Edit Service
                              </h3>
                              <p className="text-xs text-gray-450">Update details for service "{editingService.title}".</p>

                              <form onSubmit={async (e) => {
                                e.preventDefault();
                                if (!editServiceTitle.trim()) return;
                                setServicesLoading(true);
                                try {
                                  let res: Response;
                                  if (editServiceImageFile) {
                                    const formData = new FormData();
                                    formData.append('id', String(editingService.id));
                                    formData.append('title', editServiceTitle);
                                    formData.append('mainType', editingService.mainType);
                                    formData.append('image', editServiceImageFile);
                                    res = await fetch('/api/admin/settings/services', {
                                      method: 'PUT',
                                      headers: { Authorization: `Bearer ${token}` },
                                      body: formData,
                                    });
                                  } else {
                                    res = await fetch('/api/admin/settings/services', {
                                      method: 'PUT',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${token}`,
                                      },
                                      body: JSON.stringify({
                                        id: editingService.id,
                                        title: editServiceTitle,
                                        mainType: editingService.mainType,
                                        removeImage: removeEditImage,
                                      }),
                                    });
                                  }

                                  if (res.ok) {
                                    setEditServiceModalOpen(false);
                                    setEditingService(null);
                                    fetchServices();
                                  } else {
                                    const data = await res.json();
                                    alert(data.message || 'Failed to update service');
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
                                  value={editServiceTitle}
                                  onChange={(e) => setEditServiceTitle(e.target.value)}
                                  required
                                />

                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-gray-300">Service Image (Optional)</label>
                                  <div className="flex items-center gap-3">
                                    {!removeEditImage && editServiceImagePreview ? (
                                      <img src={editServiceImagePreview} alt="Preview" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-500">
                                        <Scissors className="w-4 h-4" />
                                      </div>
                                    )}
                                    <div className="space-y-1">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            setEditServiceImageFile(file);
                                            setEditServiceImagePreview(URL.createObjectURL(file));
                                            setRemoveEditImage(false);
                                          }
                                        }}
                                        className="text-xs text-gray-400 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                                      />
                                      {!removeEditImage && editServiceImagePreview && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRemoveEditImage(true);
                                            setEditServiceImageFile(null);
                                          }}
                                          className="text-[10px] text-red-400 hover:underline font-medium block"
                                        >
                                          Remove current image
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditServiceModalOpen(false);
                                      setEditingService(null);
                                    }}
                                    className="px-4 py-2 rounded-xl border border-gray-800 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <Button type="submit" isLoading={servicesLoading} className="px-5 py-2">
                                    Save Changes
                                  </Button>
                                </div>
                              </form>
                            </Card>
                          </div>
                        )}
                      </Card>
                    </div>
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
                          <div className={`p-5 rounded-xl border text-xs leading-relaxed space-y-3 ${dbStatusResult.connected
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
            <div className="space-y-6">
              <div className="border-b border-gray-900 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" /> Registered Users
                  </h2>
                  <p className="text-xs text-gray-400">View customer accounts, service provider profiles, verification status, and activity.</p>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <Input
                    type="text"
                    placeholder="Search user name, email, city..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    leftIcon={<Search className="w-4 h-4 text-gray-500" />}
                    className="w-full sm:w-64"
                  />

                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as any)}
                    className="w-full sm:w-40 bg-gray-900 border border-gray-850 text-xs font-semibold text-gray-300 rounded-xl px-3 py-2.5 focus:outline-none focus:border-primary transition-all cursor-pointer"
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
                          <th className="p-4">City</th>
                          <th className="p-4">Country</th>
                          <th className="p-4 text-center">Featured</th>
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
                            <td className="p-4">
                              <span
                                onClick={() => {
                                  setSelectedUser(user);
                                  setDrawerOpen(true);
                                }}
                                className="font-bold text-white hover:text-primary cursor-pointer transition-colors"
                              >
                                {(user.name || user.email.split('@')[0]).toUpperCase()}
                              </span>
                            </td>
                            <td className="p-4 text-gray-300">{user.email}</td>
                            <td className="p-4 text-gray-300 font-medium">
                              {(user as any).clientProfile?.city || (user as any).providerProfile?.city || (user as any).city || '—'}
                            </td>
                            <td className="p-4 text-gray-300 font-medium">
                              {(user as any).clientProfile?.country || (user as any).providerProfile?.country || (user as any).country || '—'}
                            </td>
                            <td className="p-4 text-center">
                              {user.role === 'provider' ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const curr = user.providerProfile?.isFeatured ?? user.providerProfile?.featured ?? user.isFeatured ?? false;
                                    toggleFeatured(user.id, curr);
                                  }}
                                  title="Toggle Featured Status"
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border inline-flex items-center gap-1.5 ${user.providerProfile?.isFeatured || user.providerProfile?.featured || user.isFeatured
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                                    : 'bg-gray-800/60 text-gray-400 border-gray-700/50 hover:bg-gray-700/60'
                                    }`}
                                >
                                  <Sparkles className={`w-3 h-3 ${user.providerProfile?.isFeatured || user.providerProfile?.featured || user.isFeatured ? 'text-amber-400 fill-amber-400' : 'text-gray-500'}`} />
                                  <span>{user.providerProfile?.isFeatured || user.providerProfile?.featured || user.isFeatured ? 'Yes' : 'No'}</span>
                                </button>
                              ) : (
                                <span className="text-xs text-gray-600">—</span>
                              )}
                            </td>
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
                    <h2 className="text-xl font-bold text-white mt-0.5">{selectedUser.name || (selectedUser.email.split('@')[0]).toUpperCase()}</h2>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[9px] text-slate-300 font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-900 border border-gray-800">
                        {selectedUser.role}
                      </span>
                      {selectedUser.role === 'provider' && selectedUser.providerType && (
                        <span className="text-[9px] text-primary font-extrabold uppercase px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
                          {selectedUser.providerType}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Profile Meta Cards */}
                <div className="flex justify-between items-start gap-4 text-sm text-gray-400">
                  <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="break-all">{selectedUser.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span>{selectedUser.phoneNumber || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span>Registered on {new Date(selectedUser.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="text-[11px] text-gray-550 mt-1 space-y-1">
                      {selectedUser.providerProfile?.salonName && (
                        <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5 pt-0.5">
                          <Building className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          <span>Salon: {selectedUser.providerProfile.salonName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Profile Image Avatar */}
                  <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gray-900 border border-gray-850 flex-shrink-0 flex items-center justify-center">
                    {(() => {
                      const imgUrl = (selectedUser.role === 'provider' ? selectedUser.providerProfile?.profileImageUrl : selectedUser.clientProfile?.profileImageUrl) || undefined;
                      return imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={selectedUser.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 text-slate-400 flex items-center justify-center font-bold text-2xl uppercase">
                          {selectedUser.name ? selectedUser.name.charAt(0) : 'U'}
                        </div>
                      );
                    })()}
                  </div>
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
                      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-900/60 border border-gray-850">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Featured Status</span>
                        </div>
                        <button
                          onClick={() => {
                            const curr = selectedUser.providerProfile?.isFeatured ?? selectedUser.providerProfile?.featured ?? selectedUser.isFeatured ?? false;
                            toggleFeatured(selectedUser.id, curr);
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all inline-flex items-center gap-1.5 ${selectedUser.providerProfile?.isFeatured || selectedUser.providerProfile?.featured || selectedUser.isFeatured
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                            : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-750'
                            }`}
                        >
                          <span>{selectedUser.providerProfile?.isFeatured || selectedUser.providerProfile?.featured || selectedUser.isFeatured ? 'Yes (Featured)' : 'No (Regular)'}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-primary" />
                        <span className="text-white font-semibold">{selectedUser.providerProfile?.location || 'No Location Set'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <span>{selectedUser.providerProfile?.experience || 0} years experience</span>
                      </div>
                    </div>

                    {/* Licenses & Certificates */}
                    <div className="space-y-2">
                      <h4 className="font-bold text-white text-sm uppercase tracking-wider">Licenses & Certificates</h4>
                      <div className="bg-gray-900/40 border border-gray-850 rounded-xl p-3.5 space-y-2">
                        {selectedUser.providerProfile?.licenseTypes && selectedUser.providerProfile.licenseTypes.length > 0 ? (
                          selectedUser.providerProfile.licenseTypes.map((lic, idx) => {
                            const certUrl = selectedUser.providerProfile?.certificateUrls?.[idx];
                            return (
                              <div key={idx} className="flex justify-between items-center text-xs py-1.5 border-b last:border-0 border-gray-850/40">
                                <div className="flex items-center gap-2">
                                  <Award className="w-4 h-4 text-purple-500" />
                                  <span className="font-semibold text-gray-350">{lic || 'Unnamed License'}</span>
                                </div>
                                {certUrl && (
                                  <div className="flex items-center gap-2">
                                    <a
                                      href={certUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[10px] text-primary hover:text-white font-extrabold uppercase px-2 py-1 rounded bg-primary/10 border border-primary/20 hover:bg-primary transition-all cursor-pointer"
                                    >
                                      View
                                    </a>
                                    <a
                                      href={certUrl}
                                      download
                                      className="text-[10px] text-gray-400 hover:text-white font-extrabold uppercase px-2 py-1 rounded bg-gray-850 border border-gray-850/50 hover:bg-gray-750 transition-all cursor-pointer"
                                    >
                                      Download
                                    </a>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="flex justify-between items-center text-xs py-1.5">
                            <div className="flex items-center gap-2">
                              <Award className="w-4 h-4 text-purple-500" />
                              <span className="font-semibold text-gray-350">{selectedUser.providerProfile?.licenseType || 'N/A'}</span>
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
                                  className="text-[10px] text-gray-400 hover:text-white font-extrabold uppercase px-2 py-1 rounded bg-gray-850 border border-gray-850/50 hover:bg-gray-750 transition-all cursor-pointer"
                                >
                                  Download
                                </a>
                              </div>
                            )}
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

                {/* Client Specific Profile Data */}
                {selectedUser.role === 'client' && (
                  <div className="space-y-5 pt-4 border-t border-gray-900">
                    <div className="space-y-3.5">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-primary" />
                        <span className="text-white font-semibold">{selectedUser.clientProfile?.location || 'No Location Set'}</span>
                      </div>

                      {selectedUser.clientProfile?.latitude !== undefined && selectedUser.clientProfile?.latitude !== null && (
                        <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-850 space-y-1.5">
                          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block">Coordinates</span>
                          <span className="text-white font-mono text-xs block">
                            Lat: {selectedUser.clientProfile?.latitude}, Lon: {selectedUser.clientProfile?.longitude}
                          </span>
                        </div>
                      )}

                      {selectedUser.clientProfile?.createdAt && (
                        <div className="text-xs text-gray-500">
                          Profile created: {new Date(selectedUser.clientProfile.createdAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
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

      {/* BOOKING DETAILS SLIDE-OUT DRAWER */}
      <AnimatePresence>
        {bookingDrawerOpen && selectedBooking && (
          <>
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setBookingDrawerOpen(false)}
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
                    <span className="text-xs text-primary font-bold uppercase tracking-wider">Booking Preview</span>
                    <h2 className="text-xl font-extrabold text-white mt-0.5">Booking #{selectedBooking.id}</h2>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase border ${selectedBooking.status === 'completed'
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : selectedBooking.status === 'confirmed'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : selectedBooking.status === 'cancelled'
                            ? 'bg-red-500/10 text-red-400 border-red-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                        Status: {selectedBooking.status || 'pending'}
                      </span>
                      <span className="text-[11px] text-gray-400 font-medium">
                        {new Date(selectedBooking.date).toLocaleDateString()} at {selectedBooking.timeSlot}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setBookingDrawerOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Section 1: Provider Info */}
                <div className="bg-gray-900/40 border border-gray-850 p-4 rounded-2xl space-y-3">
                  <h4 className="text-[10px] font-extrabold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5" /> Provider Details
                  </h4>
                  <div className="grid grid-cols-1 gap-1 text-xs text-gray-300">
                    <div className="font-bold text-white text-sm">
                      {selectedBooking.provider?.name || selectedBooking.provider?.providerProfile?.salonName || `Provider #${selectedBooking.providerId}`}
                    </div>
                    {selectedBooking.provider?.providerProfile?.salonName && (
                      <div className="text-gray-400 text-xs">Salon: {selectedBooking.provider.providerProfile.salonName}</div>
                    )}
                    <div className="flex items-center gap-2 text-gray-400 text-xs mt-1">
                      <Mail className="w-3.5 h-3.5 text-gray-500" />
                      <span>{selectedBooking.provider?.email || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400 text-xs">
                      <Phone className="w-3.5 h-3.5 text-gray-500" />
                      <span>{selectedBooking.provider?.phoneNumber || '-'}</span>
                    </div>
                    {selectedBooking.provider?.providerProfile?.location && (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <MapPin className="w-3.5 h-3.5 text-gray-500" />
                        <span>{selectedBooking.provider.providerProfile.location}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 2: Client Info */}
                <div className="bg-gray-900/40 border border-gray-850 p-4 rounded-2xl space-y-3">
                  <h4 className="text-[10px] font-extrabold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> Client Details
                  </h4>
                  <div className="grid grid-cols-1 gap-1 text-xs text-gray-300">
                    <div className="font-bold text-white text-sm">
                      {selectedBooking.client?.name || `Client #${selectedBooking.clientId}`}
                    </div>
                    <div className="flex items-center gap-2 text-gray-400 text-xs mt-1">
                      <Mail className="w-3.5 h-3.5 text-gray-500" />
                      <span>{selectedBooking.client?.email || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-400 text-xs">
                      <Phone className="w-3.5 h-3.5 text-gray-500" />
                      <span>{selectedBooking.client?.phoneNumber || '-'}</span>
                    </div>
                    {selectedBooking.client?.clientProfile?.location && (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <MapPin className="w-3.5 h-3.5 text-gray-500" />
                        <span>{selectedBooking.client.clientProfile.location}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 3: Booked Services */}
                <div className="bg-gray-900/40 border border-gray-850 p-4 rounded-2xl space-y-3">
                  <h4 className="text-[10px] font-extrabold text-primary uppercase tracking-wider flex items-center gap-1.5">
                    <Scissors className="w-3.5 h-3.5" /> Services Booked
                  </h4>
                  {Array.isArray(selectedBooking.services) && selectedBooking.services.length > 0 ? (
                    <div className="space-y-2">
                      {selectedBooking.services.map((svc: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-950 border border-gray-900 text-xs">
                          <div>
                            <div className="font-bold text-white">{svc.name || svc.title}</div>
                            <div className="text-[10px] text-gray-400">{svc.category || 'General'}</div>
                          </div>
                          <div className="font-bold text-primary">${(svc.price || 0).toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 italic">No detailed services list recorded.</div>
                  )}
                </div>

                {/* Section 4: All Charges Breakdown */}
                <div className="bg-gray-900/40 border border-gray-850 p-4 rounded-2xl space-y-3">
                  <h4 className="text-[10px] font-extrabold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" /> Financial & Charges Breakdown
                  </h4>
                  <div className="space-y-2 text-xs divide-y divide-gray-900">
                    <div className="flex justify-between py-1 text-gray-300">
                      <span>Service Amount (Subtotal)</span>
                      <span className="font-semibold text-white">${(selectedBooking.serviceAmount || 0).toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between py-1 text-gray-300">
                      <span>
                        Tip Amount {selectedBooking.tipPercentage ? `(${selectedBooking.tipPercentage}%)` : ''}
                      </span>
                      <span className="font-semibold text-emerald-400">+${(selectedBooking.tipAmount || 0).toFixed(2)}</span>
                    </div>

                    {selectedBooking.promoDiscount > 0 && (
                      <div className="flex justify-between py-1 text-gray-300">
                        <span>Promo Discount {selectedBooking.promoCode ? `(${selectedBooking.promoCode})` : ''}</span>
                        <span className="font-semibold text-amber-400">-${(selectedBooking.promoDiscount || 0).toFixed(2)}</span>
                      </div>
                    )}

                    <div className="flex justify-between pt-3 text-sm font-extrabold">
                      <span className="text-white">Grand Total</span>
                      <span className="text-primary text-base">${(selectedBooking.grandTotal || selectedBooking.serviceAmount || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Section 5: Platform Commission & Provider Payout Breakdown */}
                {(() => {
                  const feeCutPct = typeof selectedBooking.platformFeeCut === 'number'
                    ? selectedBooking.platformFeeCut
                    : (parseFloat(platformFeeCut) || 5);
                  const svcAmount = selectedBooking.serviceAmount || 0;
                  const platformCommission = (svcAmount * feeCutPct) / 100;
                  const tipAmt = selectedBooking.tipAmount || 0;
                  const providerPayout = (svcAmount - platformCommission) + tipAmt;

                  return (
                    <div className="bg-gray-900/40 border border-gray-850 p-4 rounded-2xl space-y-3">
                      <h4 className="text-[10px] font-extrabold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Percent className="w-3.5 h-3.5" /> Platform Commission & Provider Payout
                      </h4>
                      <div className="space-y-2 text-xs divide-y divide-gray-900">
                        <div className="flex justify-between py-1 text-gray-300">
                          <span>Platform Fee Cut Percentage</span>
                          <span className="font-semibold text-indigo-400">{feeCutPct}%</span>
                        </div>

                        <div className="flex justify-between py-1 text-gray-300">
                          <span>Platform Commission ({feeCutPct}% of ${svcAmount.toFixed(2)})</span>
                          <span className="font-semibold text-rose-400">-${platformCommission.toFixed(2)}</span>
                        </div>

                        {tipAmt > 0 && (
                          <div className="flex justify-between py-1 text-gray-300">
                            <span>Client Tip (100% to Provider)</span>
                            <span className="font-semibold text-emerald-400">+${tipAmt.toFixed(2)}</span>
                          </div>
                        )}

                        <div className="flex justify-between pt-3 text-sm font-extrabold">
                          <span className="text-white">Provider Payout</span>
                          <span className="text-emerald-400 text-base">${providerPayout.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Section 6: Stripe Transection & Information */}
                {(() => {
                  const txId = selectedBooking.transactionId || selectedBooking.stripe_transaction_id || selectedBooking.stripe_transection_id || selectedBooking.stripeTransactionId || null;
                  let rawData = selectedBooking.stripeRawData || selectedBooking.stripe_transaction_raw || selectedBooking.stripe_transection_raw || null;
                  let parsedRawObj: Record<string, any> | null = null;
                  if (rawData) {
                    if (typeof rawData === 'object' && rawData !== null) {
                      parsedRawObj = rawData;
                    } else if (typeof rawData === 'string') {
                      try {
                        parsedRawObj = JSON.parse(rawData);
                      } catch (e) {
                        parsedRawObj = null;
                      }
                    }
                  }

                  const rawStatus = (
                    selectedBooking.paymentStatus ||
                    selectedBooking.payment_status ||
                    selectedBooking.stripe_payment_status ||
                    parsedRawObj?.status ||
                    parsedRawObj?.payment_status ||
                    (txId ? 'succeeded' : 'pending')
                  ).toString();

                  const normalizedStatus = rawStatus.toLowerCase();
                  const isPaid = ['succeeded', 'paid', 'complete', 'completed'].includes(normalizedStatus);
                  const isFailed = ['failed', 'canceled', 'requires_payment_method'].includes(normalizedStatus);

                  return (
                    <div className="bg-gray-900/40 border border-gray-850 p-4 rounded-2xl space-y-3">
                      <h4 className="text-[10px] font-extrabold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5" /> Stripe Transection & Information
                      </h4>

                      {/* Transaction ID & Payment Status */}
                      <div className="bg-gray-950/80 border border-gray-850 p-3 rounded-xl space-y-2.5">
                        {/* Transaction ID with Copy Button */}
                        <div className="space-y-1">
                          <div className="text-[11px] font-semibold text-gray-400">Transaction ID</div>
                          <div className="flex items-center justify-between gap-2">
                            <code className="text-xs font-mono text-emerald-400 break-all select-all font-semibold">
                              {txId || 'N/A'}
                            </code>
                            {txId && (
                              <button
                                type="button"
                                onClick={() => handleCopyTxId(txId)}
                                className="px-2.5 py-1 text-[11px] font-medium text-gray-300 bg-gray-900 hover:bg-gray-800 border border-gray-750 rounded-lg flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                                title="Copy Transaction ID"
                              >
                                {copiedTxId ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span className="text-emerald-400 font-semibold">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-gray-400" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Payment Status Display */}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-900 text-xs">
                          <span className="text-gray-400 font-medium">Stripe Payment Status</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
                            isPaid
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : isFailed
                                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {rawStatus}
                          </span>
                        </div>
                      </div>

                      {/* Stripe Raw Data Object Keys Display */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-gray-400">Stripe Raw Data Keys</div>
                        {parsedRawObj && typeof parsedRawObj === 'object' && Object.keys(parsedRawObj).length > 0 ? (
                          <div className="bg-gray-950 border border-gray-850 rounded-xl p-3 max-h-64 overflow-y-auto space-y-2 text-xs font-mono">
                            {Object.entries(parsedRawObj).map(([key, val]) => (
                              <div key={key} className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-gray-900/60 pb-1.5 last:border-0 last:pb-0 gap-1">
                                <span className="text-sky-300 font-semibold shrink-0">{key}:</span>
                                <span className="text-gray-300 break-all text-right font-normal">
                                  {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? 'null')}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : typeof rawData === 'string' && rawData.trim() ? (
                          <div className="bg-gray-950 border border-gray-850 rounded-xl p-3 max-h-64 overflow-y-auto text-xs font-mono text-gray-300 break-all">
                            {rawData}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500 italic p-2 bg-gray-950/50 rounded-xl border border-gray-900">
                            No Stripe raw data recorded for this booking.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Close Drawer Button */}
              <div className="pt-4 border-t border-gray-900">
                <Button variant="secondary" className="w-full" onClick={() => setBookingDrawerOpen(false)}>
                  Close Preview
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* DELETE REQUEST CONFIRMATION MODAL */}
      <AnimatePresence>
        {deleteRequestModalOpen && deletingRequestId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteRequestModalOpen(false)}
              className="fixed inset-0 bg-black z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4"
            >
              <Card className="w-full max-w-md border border-gray-850 p-6 space-y-4 bg-gray-950">
                <div className="flex items-center gap-3 text-red-400">
                  <Trash2 className="w-6 h-6" />
                  <h3 className="text-lg font-bold text-white">Delete Provider Request</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Are you sure you want to delete request <strong>#{deletingRequestId}</strong>? This action cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button variant="secondary" size="sm" onClick={() => setDeleteRequestModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={deleteRequestLoading}
                    onClick={() => handleDeleteRequest(deletingRequestId)}
                  >
                    Delete Request
                  </Button>
                </div>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
