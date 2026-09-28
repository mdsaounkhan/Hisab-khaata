/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, ChangeEvent } from 'react';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import {
  doc,
  setDoc,
  collection,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  Unsubscribe
} from 'firebase/firestore';
import {
  Bell,
  Megaphone,
  Plus,
  Trash2,
  Check,
  X,
  Info,
  LogOut,
  RefreshCw,
  Crown,
  UserCheck,
  Phone,
  MessageCircle,
  ExternalLink,
  Copy
} from 'lucide-react';
import { auth, googleProvider, db } from './firebase';
import appIconImg from './assets/images/app_icon_1790598084432.jpg';
import developerAvatarImg from './assets/images/developer_avatar_1790598098997.jpg';

const ADMIN_EMAIL = 'saounonly@gmail.com';

interface Transaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  date: string;
  note?: string;
}

interface Categories {
  income: string[];
  expense: string[];
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  tag: string;
  createdAt?: any;
  createdBy?: string;
}

const DEFAULT_CATEGORIES: Categories = {
  income: ['স্যালারি', 'বোনাস', 'ব্যবসা', 'উপহার', 'অন্যান্য আয়'],
  expense: ['বাজার', 'যাতায়াত', 'পোশাক', 'খাদ্য', 'ইন্টারনেট', 'বিল', 'চিকিৎসা', 'শিক্ষা', 'অন্যান্য ব্যয়']
};

export default function App() {
  // App state
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('transactions');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [categories, setCategories] = useState<Categories>(() => {
    try {
      const saved = localStorage.getItem('categories');
      return saved ? JSON.parse(saved) : DEFAULT_CATEGORIES;
    } catch {
      return DEFAULT_CATEGORIES;
    }
  });

  const [initialBalance, setInitialBalance] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('initialBalance');
      return saved ? parseFloat(saved) : 0;
    } catch {
      return 0;
    }
  });

  // User and Cloud status
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'guest' | 'syncing' | 'synced' | 'error'>('guest');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Check if current user is admin
  const isAdmin = useMemo(() => {
    if (!currentUser?.email) return false;
    return currentUser.email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
  }, [currentUser]);

  // Announcements / Notifications state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('readAnnouncementIds');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Admin New Announcement Form
  const [showAddAnnouncementForm, setShowAddAnnouncementForm] = useState(false);
  const [newNoticeTitle, setNewNoticeTitle] = useState('');
  const [newNoticeMessage, setNewNoticeMessage] = useState('');
  const [newNoticeTag, setNewNoticeTag] = useState('নতুন আপডেট');
  const [isSubmittingNotice, setIsSubmittingNotice] = useState(false);

  // Developer Info Modal State
  const [devInfoModalOpen, setDevInfoModalOpen] = useState(false);

  // In-app Delete Confirmation states (replaces window.confirm)
  const [announcementToDelete, setAnnouncementToDelete] = useState<{ id: string; title: string } | null>(null);
  const [txToDelete, setTxToDelete] = useState<string | null>(null);
  const [catToDelete, setCatToDelete] = useState<{ name: string; type: 'income' | 'expense' } | null>(null);
  const [restoreConfirmData, setRestoreConfirmData] = useState<any | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<'add' | 'list' | 'categories' | 'report'>('add');

  // Form states - Add Transaction
  const [txType, setTxType] = useState<'income' | 'expense'>('income');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('');
  const [txDate, setTxDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [txNote, setTxNote] = useState('');

  // Filter states - List
  const [filterCat, setFilterCat] = useState('');
  const [filterType, setFilterType] = useState<'' | 'income' | 'expense'>('');

  // Category Add
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'expense' | 'income'>('expense');

  // Report Month
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // Modals
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [newBalanceInput, setNewBalanceInput] = useState('');
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreJsonText, setRestoreJsonText] = useState('');
  const [clearModalOpen, setClearModalOpen] = useState(false);

  // Edit Transaction Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editType, setEditType] = useState<'income' | 'expense'>('income');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Flag to avoid loop syncing when listening to snapshot
  const isIncomingSyncRef = useRef(false);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 2800);
  };

  // Keep Category selection synced with available categories
  useEffect(() => {
    const available = categories[txType];
    if (available && available.length > 0) {
      if (!available.includes(txCategory)) {
        setTxCategory(available[0]);
      }
    } else {
      setTxCategory('');
    }
  }, [txType, categories]);

  // Persist to LocalStorage
  const saveToLocalStorage = (txs: Transaction[], cats: Categories, balance: number) => {
    try {
      localStorage.setItem('transactions', JSON.stringify(txs));
      localStorage.setItem('categories', JSON.stringify(cats));
      localStorage.setItem('initialBalance', String(balance));
    } catch (e) {
      console.error('LocalStorage write error:', e);
    }
  };

  // Cloud push user data
  const pushToCloud = async (txs: Transaction[], cats: Categories, balance: number, user: User) => {
    try {
      setCloudStatus('syncing');
      await setDoc(doc(db, 'users', user.uid), {
        transactions: txs,
        categories: cats,
        initialBalance: balance,
        updatedAt: serverTimestamp(),
        email: user.email || '',
        displayName: user.displayName || ''
      });
      setCloudStatus('synced');
    } catch (err) {
      console.error('Cloud save failed:', err);
      setCloudStatus('error');
      showToast('☁️ ক্লাউডে সেভ হতে সমস্যা হয়েছে', 'error');
    }
  };

  // Auth & Cloud Sync listener for User data
  useEffect(() => {
    let unsubscribeFirestore: Unsubscribe | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
        setCloudStatus('syncing');

        // Set up Real-time Snapshot Listener for user transactions
        const userDocRef = doc(db, 'users', user.uid);
        unsubscribeFirestore = onSnapshot(
          userDocRef,
          (snapshot) => {
            if (isIncomingSyncRef.current) {
              isIncomingSyncRef.current = false;
              return;
            }

            if (snapshot.exists()) {
              const data = snapshot.data();
              const cloudTxs = (data.transactions as Transaction[]) || [];
              const cloudCats = (data.categories as Categories) || DEFAULT_CATEGORIES;
              const cloudBalance = typeof data.initialBalance === 'number' ? data.initialBalance : 0;

              setTransactions(cloudTxs);
              setCategories(cloudCats);
              setInitialBalance(cloudBalance);

              saveToLocalStorage(cloudTxs, cloudCats, cloudBalance);
              setCloudStatus('synced');
            } else {
              // First time login - upload current local data to user's new cloud profile
              pushToCloud(transactions, categories, initialBalance, user);
            }
          },
          (err) => {
            console.error('Firestore snapshot error:', err);
            setCloudStatus('error');
          }
        );
      } else {
        setCurrentUser(null);
        setCloudStatus('guest');
        if (unsubscribeFirestore) {
          unsubscribeFirestore();
          unsubscribeFirestore = null;
        }
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
      }
    };
  }, []);

  // Real-time listener for Announcements / System Notifications (all users can listen)
  useEffect(() => {
    try {
      const announcementsRef = collection(db, 'announcements');
      const q = query(announcementsRef, orderBy('createdAt', 'desc'));

      const unsubscribeAnnouncements = onSnapshot(
        q,
        (snapshot) => {
          const list: Announcement[] = [];
          snapshot.forEach((d) => {
            const data = d.data();
            list.push({
              id: d.id,
              title: data.title || '',
              message: data.message || '',
              tag: data.tag || 'আপডেট',
              createdAt: data.createdAt,
              createdBy: data.createdBy || ''
            });
          });
          setAnnouncements(list);
        },
        (error) => {
          console.error('Announcements fetch error:', error);
        }
      );

      return () => {
        unsubscribeAnnouncements();
      };
    } catch (e) {
      console.error('Error setting up announcements listener:', e);
    }
  }, []);

  // Compute unread announcements count
  const unreadCount = useMemo(() => {
    return announcements.filter((a) => !readAnnouncementIds.includes(a.id)).length;
  }, [announcements, readAnnouncementIds]);

  // Open notification modal and mark all current announcements as viewed
  const handleOpenNotificationModal = () => {
    setNotificationModalOpen(true);
    if (announcements.length > 0) {
      const allIds = announcements.map((a) => a.id);
      setReadAnnouncementIds(allIds);
      localStorage.setItem('readAnnouncementIds', JSON.stringify(allIds));
    }
  };

  // Mark all announcements as read
  const handleMarkAllRead = () => {
    const allIds = announcements.map((a) => a.id);
    setReadAnnouncementIds(allIds);
    localStorage.setItem('readAnnouncementIds', JSON.stringify(allIds));
    showToast('সব নোটিফিকেশন পড়া হয়েছে হিসেবে চিহ্নিত করা হয়েছে');
  };

  // Publish a new Announcement (Admin action only)
  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      showToast('শুধুমাত্র এডমিন (saounonly@gmail.com) নোটিশ প্রকাশ করতে পারবেন', 'error');
      return;
    }
    if (!newNoticeTitle.trim() || !newNoticeMessage.trim()) {
      showToast('শিরোনাম ও বিস্তারিত তথ্য লিখুন', 'error');
      return;
    }

    setIsSubmittingNotice(true);
    try {
      await addDoc(collection(db, 'announcements'), {
        title: newNoticeTitle.trim(),
        message: newNoticeMessage.trim(),
        tag: newNoticeTag.trim(),
        createdAt: serverTimestamp(),
        createdBy: currentUser?.email || ADMIN_EMAIL
      });

      setNewNoticeTitle('');
      setNewNoticeMessage('');
      setShowAddAnnouncementForm(false);
      showToast('📢 নতুন নোটিফিকেশন সকল ইউজারের কাছে পাঠানো হয়েছে!');
    } catch (err: any) {
      console.error('Failed to post announcement:', err);
      showToast('নোটিফিকেশন প্রকাশ করতে ব্যর্থ হয়েছে: ' + (err?.message || ''), 'error');
    } finally {
      setIsSubmittingNotice(false);
    }
  };

  // Execute Announcement Delete
  const handleConfirmDeleteAnnouncement = async () => {
    if (!announcementToDelete) return;
    const { id } = announcementToDelete;
    setAnnouncementToDelete(null);

    try {
      await deleteDoc(doc(db, 'announcements', id));
      // Immediate optimistic update
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      showToast('🗑️ নোটিফিকেশন মুছে ফেলা হয়েছে');
    } catch (err: any) {
      console.error('Failed to delete announcement:', err);
      showToast('মুছতে সমস্যা হয়েছে: ' + (err?.message || 'অনুমতি নেই'), 'error');
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleDocumentClick = () => {
      setUserMenuOpen(false);
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  // Sync helper when state changes locally
  const updateAppData = (
    newTxs: Transaction[],
    newCats: Categories,
    newBalance: number,
    toastMsg?: string
  ) => {
    setTransactions(newTxs);
    setCategories(newCats);
    setInitialBalance(newBalance);
    saveToLocalStorage(newTxs, newCats, newBalance);

    if (toastMsg) {
      showToast(toastMsg);
    }

    if (currentUser) {
      isIncomingSyncRef.current = true;
      pushToCloud(newTxs, newCats, newBalance, currentUser);
    }
  };

  // Google Sign In
  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setLoginModalOpen(false);
      showToast('লগইন সফল হয়েছে! সকল ডাটা স্বয়ংক্রিয়ভাবে সিংক হবে');
    } catch (e: any) {
      console.error('Login error:', e);
      if (e?.code === 'auth/popup-closed-by-user') {
        showToast('লগইন বাতিল করা হয়েছে', 'info');
      } else if (e?.code === 'auth/unauthorized-domain') {
        showToast('ডোমেন অনুমোদিত নয়', 'error');
      } else {
        showToast('লগইন ব্যর্থ হয়েছে', 'error');
      }
    }
  };

  // Sign out (Reliable, no blocking window.confirm)
  const handleSignOut = async () => {
    setUserMenuOpen(false);
    try {
      await signOut(auth);
      setCurrentUser(null);
      setCloudStatus('guest');
      showToast('লগআউট সম্পন্ন হয়েছে', 'info');
    } catch (e: any) {
      console.error('Sign out error:', e);
      showToast('লগআউট করতে সমস্যা হয়েছে: ' + (e?.message || ''), 'error');
    }
  };

  // Manual sync button
  const handleManualSync = async () => {
    if (!currentUser) {
      showToast('গেস্ট মোড — অনুগ্রহ করে আগে লগইন করুন', 'info');
      return;
    }
    showToast('☁️ সিংক হচ্ছে...', 'info');
    await pushToCloud(transactions, categories, initialBalance, currentUser);
    showToast('✅ ক্লাউডের সাথে সফলভাবে সিংক হয়েছে');
  };

  // Currency Formatter
  const fmt = (num: number) => {
    return '৳ ' + Number(num || 0).toLocaleString('bn-BD', { maximumFractionDigits: 2 });
  };

  // Date Formatter
  const formatDateBengali = (d: string) => {
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length !== 3) return d;
    const [y, m, day] = parts;
    const months = ['জানু', 'ফেব', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ', 'অক্টো', 'নভে', 'ডিসে'];
    const monthName = months[parseInt(m, 10) - 1] || m;
    return `${day} ${monthName}, ${y}`;
  };

  // Format announcement timestamp
  const formatTimestamp = (ts: any) => {
    if (!ts) return 'সম্প্রতি';
    try {
      const date = ts.toDate ? ts.toDate() : new Date(ts);
      return date.toLocaleDateString('bn-BD', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'সম্প্রতি';
    }
  };

  // Calculations
  const totalIncome = useMemo(() => {
    return transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + (t.amount || 0), 0);
  }, [transactions]);

  const totalExpense = useMemo(() => {
    return transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + (t.amount || 0), 0);
  }, [transactions]);

  const currentBalance = useMemo(() => {
    return initialBalance + totalIncome - totalExpense;
  }, [initialBalance, totalIncome, totalExpense]);

  // Filtered transactions for List tab
  const filteredTransactions = useMemo(() => {
    let list = [...transactions].reverse();
    if (filterCat) {
      list = list.filter((t) => t.category === filterCat);
    }
    if (filterType) {
      list = list.filter((t) => t.type === filterType);
    }
    return list;
  }, [transactions, filterCat, filterType]);

  // Report calculations
  const reportData = useMemo(() => {
    const monthTxs = transactions.filter((t) => t.date && t.date.startsWith(reportMonth));
    const rIncome = monthTxs.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const rExpense = monthTxs.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);

    const expenseByCategory: Record<string, number> = {};
    monthTxs
      .filter((t) => t.type === 'expense')
      .forEach((t) => {
        expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
      });

    const entries = Object.entries(expenseByCategory).sort((a, b) => b[1] - a[1]);
    const max = entries.length > 0 ? entries[0][1] : 1;

    return {
      rIncome,
      rExpense,
      entries,
      max
    };
  }, [transactions, reportMonth]);

  // Add Transaction Submit
  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(txAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      showToast('সঠিক পরিমাণ লিখুন', 'error');
      return;
    }
    if (!txCategory) {
      showToast('ক্যাটাগরি নির্বাচন করুন', 'error');
      return;
    }

    const newTx: Transaction = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
      type: txType,
      amount: amountVal,
      category: txCategory,
      date: txDate,
      note: txNote.trim()
    };

    const updated = [...transactions, newTx];
    updateAppData(updated, categories, initialBalance, '✅ লেনদেন সেভ হয়েছে');

    setTxAmount('');
    setTxNote('');
  };

  // Delete Transaction Confirm
  const handleConfirmDeleteTx = () => {
    if (!txToDelete) return;
    const updated = transactions.filter((t) => t.id !== txToDelete);
    updateAppData(updated, categories, initialBalance, '🗑️ লেনদেন মুছে ফেলা হয়েছে');
    setTxToDelete(null);
  };

  // Open Edit Modal
  const handleOpenEdit = (t: Transaction) => {
    setEditingTx(t);
    setEditType(t.type);
    setEditAmount(String(t.amount));
    setEditCategory(t.category);
    setEditDate(t.date);
    setEditNote(t.note || '');
    setEditModalOpen(true);
  };

  // Save Edit Transaction
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;

    const amountVal = parseFloat(editAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      showToast('সঠিক পরিমাণ লিখুন', 'error');
      return;
    }

    const updated = transactions.map((t) => {
      if (t.id === editingTx.id) {
        return {
          ...t,
          type: editType,
          amount: amountVal,
          category: editCategory,
          date: editDate,
          note: editNote.trim()
        };
      }
      return t;
    });

    updateAppData(updated, categories, initialBalance, '✅ লেনদেন আপডেট হয়েছে');
    setEditModalOpen(false);
    setEditingTx(null);
  };

  // Add Category
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) return;

    if (categories[newCatType].includes(trimmed)) {
      showToast('এই ক্যাটাগরি ইতিমধ্যে যোগ করা আছে', 'error');
      return;
    }

    const updatedCats: Categories = {
      ...categories,
      [newCatType]: [...categories[newCatType], trimmed]
    };

    updateAppData(transactions, updatedCats, initialBalance, '✅ নতুন ক্যাটাগরি যোগ হয়েছে');
    setNewCatName('');
  };

  // Delete Category Confirm
  const handleConfirmDeleteCategory = () => {
    if (!catToDelete) return;
    const { name, type } = catToDelete;
    const updatedCats: Categories = {
      ...categories,
      [type]: categories[type].filter((c) => c !== name)
    };

    updateAppData(transactions, updatedCats, initialBalance, '🗑️ ক্যাটাগরি মুছে ফেলা হয়েছে');
    setCatToDelete(null);
  };

  // Save Initial Balance
  const handleSaveInitialBalance = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(newBalanceInput);
    if (isNaN(val)) {
      showToast('সঠিক সংখ্যা লিখুন', 'error');
      return;
    }
    updateAppData(transactions, categories, val, '✅ ওপেনিং ব্যালেন্স সেভ হয়েছে');
    setBalanceModalOpen(false);
  };

  // Month navigation in report
  const handleMonthChangeDir = (dir: number) => {
    if (!reportMonth) return;
    const [yStr, mStr] = reportMonth.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10) + dir;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setReportMonth(`${y}-${String(m).padStart(2, '0')}`);
  };

  // Download JSON Backup
  const handleDownloadBackup = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions,
      categories,
      initialBalance
    };
    const dataStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `hishab-backup_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ ব্যাকআপ ফাইল ডাউনলোড হয়েছে');
  };

  // Prepare Restore Data
  const prepareRestoreData = (data: any) => {
    if (!data || !Array.isArray(data.transactions) || !data.categories) {
      showToast('❌ ভুল বা নষ্ট ব্যাকআপ ফাইল', 'error');
      return;
    }
    setRestoreConfirmData(data);
  };

  // Confirm Restore Data
  const handleExecuteRestore = () => {
    if (!restoreConfirmData) return;
    const data = restoreConfirmData;
    const restoredTxs = data.transactions as Transaction[];
    const restoredCats = data.categories as Categories;
    const restoredBalance = typeof data.initialBalance === 'number' ? data.initialBalance : 0;

    updateAppData(restoredTxs, restoredCats, restoredBalance, `✅ রিস্টোর সফল — ${restoredTxs.length} টি লেনদেন`);
    setRestoreConfirmData(null);
    setRestoreModalOpen(false);
    setRestoreJsonText('');
  };

  // Restore from File
  const handleRestoreFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        prepareRestoreData(parsed);
      } catch {
        showToast('❌ ফাইলটি পড়া যায়নি বা ফরম্যাট ভুল', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Restore from Textarea
  const handleRestoreFromText = () => {
    const trimmed = restoreJsonText.trim();
    if (!trimmed) {
      showToast('ব্যাকআপ কোড পেস্ট করুন', 'error');
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      prepareRestoreData(parsed);
    } catch {
      showToast('❌ ভুল ব্যাকআপ কোড', 'error');
    }
  };

  // Clear All Data
  const handleClearAll = () => {
    updateAppData([], DEFAULT_CATEGORIES, 0, '✅ সকল ডাটা মুছে ফেলা হয়েছে');
    setClearModalOpen(false);
  };

  // All category names for list filter
  const allCategoryOptions = useMemo(() => {
    const set = new Set([...categories.income, ...categories.expense]);
    return Array.from(set);
  }, [categories]);

  return (
    <div className="min-h-screen text-slate-100 pb-12 select-none">
      {/* HEADER */}
      <header className="relative px-5 pt-6 pb-7 text-center overflow-hidden border-b border-white/10 backdrop-blur-xl bg-gradient-to-br from-indigo-500/20 to-purple-600/10">
        <div className="max-w-2xl mx-auto">
          {/* Top Bar with Brand, Yellow Notification Bell, and User Box */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5 text-base font-semibold">
              <img
                src={appIconImg}
                alt="হিসাব খাতা"
                className="w-10 h-10 rounded-2xl object-cover shadow-lg shadow-emerald-500/30 border border-emerald-400/30 shrink-0"
              />
              <div className="text-left">
                <span className="tracking-wide block leading-tight font-bold text-white">হিসাব খাতা</span>
                <span className="text-[10px] text-emerald-400 font-medium block">আয়-ব্যয়ের স্মার্ট খাতা</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* 🔔 NOTIFICATION BELL BUTTON */}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleOpenNotificationModal}
                  title="নোটিফিকেশন ও আপডেট"
                  className={`relative p-2.5 rounded-full transition-all cursor-pointer flex items-center justify-center group active:scale-95 ${
                    unreadCount > 0
                      ? 'bg-amber-400/20 border border-amber-400/70 text-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.6)] animate-pulse'
                      : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Bell
                    className={`w-5 h-5 transition-transform group-hover:rotate-12 ${
                      unreadCount > 0
                        ? 'text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]'
                        : 'text-slate-300'
                    }`}
                  />

                  {/* Unread indicator badge: only highlighted when there is an unread announcement */}
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-gradient-to-r from-rose-500 to-red-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center shadow-lg border-2 border-slate-900 animate-bounce">
                      {unreadCount}
                    </span>
                  )}
                </button>
              </div>

              {/* User Profile / Status Box */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setUserMenuOpen(!userMenuOpen);
                  }}
                  className={`flex items-center gap-2.5 px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                    currentUser
                      ? isAdmin
                        ? 'bg-amber-500/15 border-amber-400/30 hover:bg-amber-500/20'
                        : 'bg-white/10 border-white/20 hover:bg-white/15'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      cloudStatus === 'synced'
                        ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                        : cloudStatus === 'syncing'
                        ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-blink'
                        : cloudStatus === 'error'
                        ? 'bg-rose-400'
                        : 'bg-slate-400'
                    }`}
                  />
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-semibold overflow-hidden text-white relative">
                    {currentUser?.photoURL ? (
                      <img src={currentUser.photoURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      '👤'
                    )}
                  </div>
                  <div className="text-xs font-semibold text-slate-300 hidden sm:flex items-center gap-1">
                    {currentUser ? (
                      isAdmin ? (
                        <span className="text-amber-300 font-bold flex items-center gap-1">
                          <Crown className="w-3 h-3 text-amber-400" /> এডমিন
                        </span>
                      ) : cloudStatus === 'syncing' ? (
                        'সিংক হচ্ছে...'
                      ) : (
                        'লাইভ সিংকড'
                      )
                    ) : (
                      'গেস্ট'
                    )}
                  </div>
                </button>

                {/* User Dropdown Menu */}
                {userMenuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-12 w-64 p-2 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-2xl bg-slate-900/95 z-50 text-left animate-menu"
                  >
                    <div className="p-3 border-b border-white/10 mb-1 text-xs text-slate-400">
                      {currentUser ? (
                        <div>
                          {isAdmin ? (
                            <span className="text-amber-400 font-bold flex items-center gap-1 mb-0.5">
                              <Crown className="w-3.5 h-3.5 text-amber-400" /> সিস্টেম এডমিন
                            </span>
                          ) : (
                            <span className="text-emerald-400 font-semibold block mb-0.5">● ক্লাউড সিংক চালু আছে</span>
                          )}
                          <strong className="text-white text-sm font-medium block truncate">
                            {currentUser.displayName || currentUser.email}
                          </strong>
                          <span className="text-[11px] text-slate-400 block truncate">{currentUser.email}</span>
                        </div>
                      ) : (
                        <div>
                          গেস্ট মোড
                          <strong className="text-white text-sm block mt-0.5">লোকাল ডিভাইসে সেভ হচ্ছে</strong>
                        </div>
                      )}
                    </div>

                    {!currentUser ? (
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          setLoginModalOpen(true);
                        }}
                        className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-indigo-300 hover:bg-white/10 transition text-sm font-medium text-left cursor-pointer"
                      >
                        <span className="text-base">🔐</span>
                        <span>Google দিয়ে লগইন করুন</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          handleManualSync();
                        }}
                        className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-slate-200 hover:bg-white/10 transition text-sm font-medium text-left cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4 text-emerald-400" />
                        <span>এখনই লাইভ সিংক করুন</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleOpenNotificationModal();
                      }}
                      className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-white/10 transition text-sm font-medium text-left cursor-pointer ${
                        unreadCount > 0 ? 'text-amber-300' : 'text-slate-200'
                      }`}
                    >
                      <Bell className={`w-4 h-4 ${unreadCount > 0 ? 'text-amber-400' : 'text-slate-400'}`} />
                      <span>নোটিফিকেশন ও আপডেট</span>
                      {unreadCount > 0 && (
                        <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white">
                          {unreadCount}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setDevInfoModalOpen(true);
                      }}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-sky-300 hover:bg-white/10 transition text-sm font-medium text-left cursor-pointer"
                    >
                      <UserCheck className="w-4 h-4 text-sky-400" />
                      <span>Developer Info</span>
                    </button>

                    <div className="h-px bg-white/10 my-1" />

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setRestoreModalOpen(true);
                      }}
                      className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-slate-200 hover:bg-white/10 transition text-sm font-medium text-left cursor-pointer"
                    >
                      <span className="text-base">♻️</span>
                      <span>ব্যাকআপ রিস্টোর করুন</span>
                    </button>

                    {currentUser && (
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-2.5 p-2.5 rounded-xl text-rose-400 hover:bg-rose-500/10 transition text-sm font-medium text-left cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>লগআউট</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Balance Card */}
          <div className="rounded-3xl p-6 mb-4 text-center relative overflow-hidden shadow-2xl shadow-indigo-600/30 bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-600">
            <div className="text-xs uppercase tracking-widest text-white/80 font-medium">বর্তমান ব্যালেন্স</div>
            <div className="text-3xl sm:text-4xl font-bold text-white mt-1.5 drop-shadow-md">
              {fmt(currentBalance)}
            </div>
            <button
              type="button"
              onClick={() => {
                setNewBalanceInput(String(initialBalance));
                setBalanceModalOpen(true);
              }}
              className="mt-2.5 px-3.5 py-1 bg-white/20 hover:bg-white/30 text-white rounded-full text-xs font-medium border border-white/30 backdrop-blur-md transition-all cursor-pointer"
            >
              ✏️ ব্যালেন্স সেট করুন
            </button>
          </div>

          {/* Income & Expense Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-lg font-bold shrink-0">
                ↑
              </div>
              <div className="text-left overflow-hidden">
                <small className="text-xs text-slate-400 block font-medium">মোট আয়</small>
                <p className="text-base font-bold text-emerald-400 truncate">{fmt(totalIncome)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center text-lg font-bold shrink-0">
                ↓
              </div>
              <div className="text-left overflow-hidden">
                <small className="text-xs text-slate-400 block font-medium">মোট ব্যয়</small>
                <p className="text-base font-bold text-rose-400 truncate">{fmt(totalExpense)}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="max-w-xl mx-auto px-4 py-5">
        {/* Navigation Tabs */}
        <nav className="flex gap-1.5 mb-5 p-1.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setActiveTab('add')}
            className={`flex-1 py-2.5 px-2 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'add'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-base">➕</span>
            <span>যোগ</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-2.5 px-2 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'list'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-base">📋</span>
            <span>লেনদেন</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`flex-1 py-2.5 px-2 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'categories'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-base">🏷️</span>
            <span>ক্যাটাগরি</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('report')}
            className={`flex-1 py-2.5 px-2 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
              activeTab === 'report'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-base">📊</span>
            <span>রিপোর্ট</span>
          </button>
        </nav>

        {/* TAB: ADD TRANSACTION */}
        {activeTab === 'add' && (
          <section className="animate-fade">
            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl">
              <form onSubmit={handleAddTransaction}>
                {/* Type toggle */}
                <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-black/30 mb-4">
                  <button
                    type="button"
                    onClick={() => setTxType('income')}
                    className={`py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      txType === 'income'
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>↑ আয়</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTxType('expense')}
                    className={`py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      txType === 'expense'
                        ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>↓ ব্যয়</span>
                  </button>
                </div>

                <label className="block text-xs font-medium text-slate-400 mb-1.5">পরিমাণ (৳)</label>
                <input
                  type="number"
                  placeholder="0"
                  min="0.01"
                  step="any"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-base mb-3.5"
                />

                <label className="block text-xs font-medium text-slate-400 mb-1.5">ক্যাটাগরি</label>
                <select
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-white/10 text-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-base mb-3.5"
                >
                  {categories[txType]?.length > 0 ? (
                    categories[txType].map((c) => (
                      <option key={c} value={c} className="bg-slate-900 text-white">
                        {c}
                      </option>
                    ))
                  ) : (
                    <option value="">— ক্যাটাগরি নেই —</option>
                  )}
                </select>

                <label className="block text-xs font-medium text-slate-400 mb-1.5">তারিখ</label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-base mb-3.5"
                />

                <label className="block text-xs font-medium text-slate-400 mb-1.5">নোট (ঐচ্ছিক)</label>
                <input
                  type="text"
                  placeholder="যেমন: দুপুরের খাবার"
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-base mb-5"
                />

                <button
                  type="submit"
                  className="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/40 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                >
                  <span>💾</span>
                  <span>সেভ করুন</span>
                </button>
              </form>
            </div>
          </section>
        )}

        {/* TAB: TRANSACTIONS LIST */}
        {activeTab === 'list' && (
          <section className="animate-fade">
            {/* Filters */}
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <select
                value={filterCat}
                onChange={(e) => setFilterCat(e.target.value)}
                className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-xs backdrop-blur-xl focus:outline-none"
              >
                <option value="" className="bg-slate-900 text-white">
                  সব ক্যাটাগরি
                </option>
                {allCategoryOptions.map((c) => (
                  <option key={c} value={c} className="bg-slate-900 text-white">
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-xs backdrop-blur-xl focus:outline-none"
              >
                <option value="" className="bg-slate-900 text-white">
                  সব ধরন
                </option>
                <option value="income" className="bg-slate-900 text-white">
                  আয়
                </option>
                <option value="expense" className="bg-slate-900 text-white">
                  ব্যয়
                </option>
              </select>
            </div>

            {/* List */}
            {filteredTransactions.length === 0 ? (
              <div className="text-center py-10 px-4 rounded-2xl bg-white/5 border border-dashed border-white/10 text-slate-400">
                <div className="text-3xl mb-2 opacity-60">📭</div>
                <p className="text-sm">কোনো লেনদেন পাওয়া যায়নি</p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {filteredTransactions.map((t) => (
                  <li
                    key={t.id}
                    className={`p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl flex items-center justify-between animate-slide border-l-4 ${
                      t.type === 'income' ? 'border-l-emerald-500' : 'border-l-rose-500'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <strong className="text-sm font-semibold text-white block truncate">
                        {t.category}
                      </strong>
                      <small className="text-xs text-slate-400 block mt-0.5 truncate">
                        {formatDateBengali(t.date)} {t.note ? `• ${t.note}` : ''}
                      </small>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-sm font-bold whitespace-nowrap ${
                          t.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.type === 'income' ? '+' : '-'} {fmt(t.amount)}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleOpenEdit(t)}
                        title="এডিট"
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-indigo-600 border border-white/10 flex items-center justify-center text-xs transition cursor-pointer"
                      >
                        ✏️
                      </button>

                      <button
                        type="button"
                        onClick={() => setTxToDelete(t.id)}
                        title="মুছুন"
                        className="w-8 h-8 rounded-lg bg-rose-500/15 hover:bg-rose-600 border border-rose-500/20 text-rose-400 hover:text-white flex items-center justify-center text-xs transition cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* TAB: CATEGORIES */}
        {activeTab === 'categories' && (
          <section className="animate-fade">
            {/* Add Category Form */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl mb-6">
              <form onSubmit={handleAddCategory} className="space-y-3">
                <input
                  type="text"
                  placeholder="নতুন ক্যাটাগরির নাম"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-sm"
                />

                <select
                  value={newCatType}
                  onChange={(e) => setNewCatType(e.target.value as any)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-white/10 text-white focus:outline-none text-sm"
                >
                  <option value="expense">ব্যয়ের ক্যাটাগরি</option>
                  <option value="income">আয়ের ক্যাটাগরি</option>
                </select>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 transition shadow-lg shadow-indigo-500/30 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>➕</span>
                  <span>যোগ করুন</span>
                </button>
              </form>
            </div>

            {/* Income Categories */}
            <div className="mb-5">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-slate-200">
                <span className="w-1.5 h-4 rounded-full bg-emerald-500" />
                আয়ের ক্যাটাগরি
              </h3>
              <ul className="space-y-2">
                {categories.income.map((c) => (
                  <li
                    key={c}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span>🏷️</span>
                      <span>{c}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setCatToDelete({ name: c, type: 'income' })}
                      className="w-7 h-7 rounded-lg bg-rose-500/15 hover:bg-rose-600 border border-rose-500/20 text-rose-400 hover:text-white flex items-center justify-center text-xs transition cursor-pointer"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Expense Categories */}
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-slate-200">
                <span className="w-1.5 h-4 rounded-full bg-rose-500" />
                ব্যয়ের ক্যাটাগরি
              </h3>
              <ul className="space-y-2">
                {categories.expense.map((c) => (
                  <li
                    key={c}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl flex items-center justify-between text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span>🏷️</span>
                      <span>{c}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setCatToDelete({ name: c, type: 'expense' })}
                      className="w-7 h-7 rounded-lg bg-rose-500/15 hover:bg-rose-600 border border-rose-500/20 text-rose-400 hover:text-white flex items-center justify-center text-xs transition cursor-pointer"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* TAB: REPORT & BACKUP */}
        {activeTab === 'report' && (
          <section className="animate-fade">
            {/* Month Picker */}
            <div className="flex gap-2 items-center mb-4">
              <button
                type="button"
                onClick={() => handleMonthChangeDir(-1)}
                className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold transition cursor-pointer"
              >
                ◀
              </button>
              <input
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-center font-medium focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleMonthChangeDir(1)}
                className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold transition cursor-pointer"
              >
                ▶
              </button>
            </div>

            {/* Monthly Big Cards */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-4 rounded-2xl text-center bg-gradient-to-br from-emerald-500/20 to-teal-600/10 border border-emerald-500/30">
                <small className="text-xs text-emerald-300 font-medium block mb-1">মোট আয়</small>
                <div className="text-lg sm:text-xl font-bold text-emerald-400">{fmt(reportData.rIncome)}</div>
              </div>

              <div className="p-4 rounded-2xl text-center bg-gradient-to-br from-rose-500/20 to-red-600/10 border border-rose-500/30">
                <small className="text-xs text-rose-300 font-medium block mb-1">মোট ব্যয়</small>
                <div className="text-lg sm:text-xl font-bold text-rose-400">{fmt(reportData.rExpense)}</div>
              </div>
            </div>

            {/* Expense breakdown by category */}
            <div className="mb-6">
              <div className="text-sm font-semibold flex items-center gap-2 mb-3 text-slate-200">
                <span className="w-1.5 h-4 rounded-full bg-indigo-500" />
                ক্যাটাগরি অনুযায়ী ব্যয়
              </div>

              {reportData.entries.length === 0 ? (
                <div className="text-center py-8 rounded-2xl bg-white/5 border border-dashed border-white/10 text-slate-400 text-xs">
                  এই মাসে কোনো ব্যয় রেকর্ড নেই
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {reportData.entries.map(([cat, amt]) => {
                    const pct = ((amt / (reportData.rExpense || 1)) * 100).toFixed(0);
                    const barWidth = (amt / reportData.max) * 100;
                    return (
                      <li key={cat} className="p-3.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xl">
                        <div className="flex justify-between items-center text-sm font-medium">
                          <span>{cat}</span>
                          <div className="text-right">
                            <span className="text-rose-400 font-bold">{fmt(amt)}</span>
                            <span className="text-xs text-slate-400 ml-1.5">({pct}%)</span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-black/30 rounded-full mt-2 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Backup & Restore */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-indigo-500/10 border border-emerald-500/20 mb-6">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <span>💾</span>
                <span>ব্যাকআপ ও রিস্টোর</span>
              </h3>
              <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                সব ডাটা JSON ফাইলে ডাউনলোড করে নিরাপদে সংরক্ষণ করুন। অন্য ডিভাইসে রিস্টোর করতে পারবেন।
              </p>
              <div className="grid gap-2.5">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 transition shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2 text-sm cursor-pointer"
                >
                  <span>⬇️</span>
                  <span>ব্যাকআপ ডাউনলোড করুন</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRestoreModalOpen(true)}
                  className="w-full py-3 px-4 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 transition shadow-lg shadow-indigo-500/30 flex items-center justify-center gap-2 text-sm cursor-pointer"
                >
                  <span>⬆️</span>
                  <span>ব্যাকআপ রিস্টোর করুন</span>
                </button>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-center">
              <h4 className="text-xs font-bold text-rose-400 mb-1">⚠️ ডেঞ্জার জোন</h4>
              <p className="text-[11px] text-slate-400 mb-3">
                সব লেনদেন, ওপেনিং ব্যালেন্স ও কাস্টম ক্যাটাগরি স্থায়ীভাবে মুছে যাবে।
              </p>
              <button
                type="button"
                onClick={() => setClearModalOpen(true)}
                className="w-full py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 transition text-xs shadow-md shadow-rose-500/30 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>🗑️</span>
                <span>সব ডাটা মুছে ফেলুন</span>
              </button>
            </div>
          </section>
        )}
      </main>

      {/* 📢 NOTIFICATION & ANNOUNCEMENT MODAL */}
      {notificationModalOpen && (
        <div
          onClick={() => setNotificationModalOpen(false)}
          className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-3xl p-5 sm:p-6 bg-slate-900 border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-white/10 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-300 flex items-center justify-center text-lg shadow-[0_0_12px_rgba(251,191,36,0.3)]">
                  🔔
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>নোটিফিকেশন ও আপডেট</span>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white animate-pulse">
                        {unreadCount} টি নতুন
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">অ্যাপের সকল নতুন তথ্য ও ঘোষণা</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setNotificationModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-between gap-2 mb-4">
              {announcements.length > 0 && unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>পঠিত চিহ্নিত করুন</span>
                </button>
              )}

              {/* Show Admin Announcement Add Button ONLY for saounonly@gmail.com */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAddAnnouncementForm(!showAddAnnouncementForm)}
                  className={`ml-auto px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer ${
                    showAddAnnouncementForm
                      ? 'bg-slate-800 text-slate-300 border border-white/10'
                      : 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 font-bold'
                  }`}
                >
                  {showAddAnnouncementForm ? (
                    <>
                      <X className="w-3.5 h-3.5" />
                      <span>ফর্ম বন্ধ করুন</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>নতুন আপডেট লিখুন (Admin)</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Admin Add Announcement Form - Visible only for saounonly@gmail.com */}
            {isAdmin && showAddAnnouncementForm && (
              <div className="mb-5 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-left animate-fade">
                <div className="flex items-center gap-2 mb-3 text-amber-300 text-xs font-bold">
                  <Megaphone className="w-4 h-4 text-amber-400" />
                  <span>এডমিন প্যানেল: নতুন নোটিফিকেশন প্রকাশ করুন</span>
                </div>
                <form onSubmit={handlePublishAnnouncement} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      শিরোনাম (Title)
                    </label>
                    <input
                      type="text"
                      placeholder="যেমন: নতুন ক্যাটাগরি ফিল্টার যুক্ত হয়েছে!"
                      value={newNoticeTitle}
                      onChange={(e) => setNewNoticeTitle(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">ট্যাগ / ধরন</label>
                      <select
                        value={newNoticeTag}
                        onChange={(e) => setNewNoticeTag(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-xs focus:outline-none focus:border-amber-400"
                      >
                        <option value="নতুন আপডেট">নতুন আপডেট</option>
                        <option value="নতুন ফিচার">নতুন ফিচার</option>
                        <option value="জরুরি নোটিশ">জরুরি নোটিশ</option>
                        <option value="সার্ভার মেনটেইনেন্স">সার্ভার মেনটেইনেন্স</option>
                        <option value="টিপস ও ট্রিকস">টিপস ও ট্রিকস</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">পোস্টার এডমিন</label>
                      <div className="px-3 py-2 rounded-xl bg-slate-900/60 border border-white/5 text-amber-400 text-xs font-semibold truncate flex items-center gap-1">
                        <Crown className="w-3 h-3 text-amber-400" />
                        <span>saounonly@gmail.com</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      বিস্তারিত বার্তা (Message)
                    </label>
                    <textarea
                      placeholder="ব্যবহারকারীদের কি বার্তা জানাতে চান বিস্তারিত লিখুন..."
                      value={newNoticeMessage}
                      onChange={(e) => setNewNoticeMessage(e.target.value)}
                      rows={3}
                      required
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-amber-400 resize-none"
                    />
                  </div>

                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddAnnouncementForm(false)}
                      className="px-3 py-1.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 cursor-pointer"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingNotice}
                      className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 text-xs font-bold shadow-md shadow-amber-500/20 hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                    >
                      {isSubmittingNotice ? 'প্রকাশ হচ্ছে...' : '📢 প্রকাশ করুন'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* List of Announcements */}
            <div className="flex-1 overflow-y-auto space-y-3">
              {announcements.length === 0 ? (
                <div className="text-center py-10 px-4 rounded-2xl bg-white/5 border border-dashed border-white/10">
                  <div className="w-12 h-12 rounded-full bg-amber-400/10 text-amber-400 flex items-center justify-center text-xl mx-auto mb-2">
                    🔔
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">কোনো নোটিফিকেশন নেই</h4>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    এডমিন থেকে যখন কোনো তথ্য বা আপডেট প্রকাশ করা হবে, তা এখানে তাৎক্ষণিক দেখা যাবে।
                  </p>
                  {isAdmin && !showAddAnnouncementForm && (
                    <button
                      type="button"
                      onClick={() => setShowAddAnnouncementForm(true)}
                      className="mt-3 px-3 py-1.5 rounded-xl bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-medium inline-flex items-center gap-1 hover:bg-amber-400/30 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>প্রথম আপডেট লিখুন</span>
                    </button>
                  )}
                </div>
              ) : (
                announcements.map((a) => {
                  const isUnread = !readAnnouncementIds.includes(a.id);
                  return (
                    <div
                      key={a.id}
                      className={`p-4 rounded-2xl transition-all border relative ${
                        isUnread
                          ? 'bg-gradient-to-br from-amber-500/15 to-yellow-500/5 border-amber-400/40 shadow-lg shadow-amber-500/5'
                          : 'bg-white/5 border-white/10'
                      }`}
                    >
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                              a.tag === 'জরুরি নোটিশ'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : a.tag === 'নতুন ফিচার'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                            }`}
                          >
                            {a.tag}
                          </span>
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">
                            {formatTimestamp(a.createdAt)}
                          </span>
                          {/* Delete button: ONLY visible to saounonly@gmail.com */}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setAnnouncementToDelete({ id: a.id, title: a.title })}
                              title="নোটিশ মুছে ফেলুন (Admin)"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 transition cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Title */}
                      <h4 className="text-sm font-bold text-white mb-1.5 leading-snug">
                        {a.title}
                      </h4>

                      {/* Message */}
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                        {a.message}
                      </p>
                    </div>
                  );
                })
              )}
            </div>


          </div>
        </div>
      )}

      {/* 🗑️ IN-APP ANNOUNCEMENT DELETE CONFIRMATION MODAL */}
      {announcementToDelete && (
        <div
          onClick={() => setAnnouncementToDelete(null)}
          className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-[70] animate-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-5 bg-slate-900 border border-white/10 text-center shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl mx-auto mb-3">
              🗑️
            </div>
            <h4 className="text-base font-bold text-white mb-1.5">নোটিশটি কি মুছতে চান?</h4>
            <p className="text-xs text-slate-300 mb-4 line-clamp-2 px-2">
              "{announcementToDelete.title}"
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAnnouncementToDelete(null)}
                className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAnnouncement}
                className="py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white text-xs font-bold shadow-md shadow-rose-500/30 hover:brightness-110 cursor-pointer"
              >
                হ্যাঁ, মুছুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🗑️ IN-APP TRANSACTION DELETE CONFIRMATION MODAL */}
      {txToDelete && (
        <div
          onClick={() => setTxToDelete(null)}
          className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-[70] animate-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-5 bg-slate-900 border border-white/10 text-center shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl mx-auto mb-3">
              🗑️
            </div>
            <h4 className="text-base font-bold text-white mb-2">লেনদেনটি মুছে ফেলতে চান?</h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTxToDelete(null)}
                className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTx}
                className="py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white text-xs font-bold shadow-md shadow-rose-500/30 hover:brightness-110 cursor-pointer"
              >
                হ্যাঁ, মুছুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🗑️ IN-APP CATEGORY DELETE CONFIRMATION MODAL */}
      {catToDelete && (
        <div
          onClick={() => setCatToDelete(null)}
          className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-[70] animate-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-5 bg-slate-900 border border-white/10 text-center shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl mx-auto mb-3">
              🗑️
            </div>
            <h4 className="text-base font-bold text-white mb-1.5">ক্যাটাগরি মুছে ফেলতে চান?</h4>
            <p className="text-xs text-slate-300 mb-4 font-semibold text-amber-400">
              "{catToDelete.name}"
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCatToDelete(null)}
                className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCategory}
                className="py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white text-xs font-bold shadow-md shadow-rose-500/30 hover:brightness-110 cursor-pointer"
              >
                হ্যাঁ, মুছুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ♻️ IN-APP RESTORE CONFIRMATION MODAL */}
      {restoreConfirmData && (
        <div
          onClick={() => setRestoreConfirmData(null)}
          className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-[70] animate-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-5 bg-slate-900 border border-white/10 text-center shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xl mx-auto mb-3">
              ⚠️
            </div>
            <h4 className="text-base font-bold text-white mb-1.5">ব্যাকআপ রিস্টোর নিশ্চিত করুন</h4>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              রিস্টোর করলে বর্তমান {transactions.length} টি লেনদেন মুছে গিয়ে নতুন ফাইল প্রতিস্থাপিত হবে।
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRestoreConfirmData(null)}
                className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/5 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleExecuteRestore}
                className="py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-500/30 hover:brightness-110 cursor-pointer"
              >
                হ্যাঁ, রিস্টোর করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl font-semibold text-xs shadow-2xl backdrop-blur-xl z-50 max-w-[90vw] text-center border animate-fade ${
            toast.type === 'error'
              ? 'bg-rose-600/95 text-white border-rose-400/40 shadow-rose-900/50'
              : toast.type === 'info'
              ? 'bg-indigo-600/95 text-white border-indigo-400/40 shadow-indigo-900/50'
              : 'bg-emerald-600/95 text-white border-emerald-400/40 shadow-emerald-900/50'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* LOGIN MODAL */}
      {loginModalOpen && (
        <div
          onClick={() => setLoginModalOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-6 bg-slate-900 border border-white/10 text-center shadow-2xl"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl mx-auto mb-3">
              ☁️
            </div>
            <h3 className="text-base font-bold text-white mb-1.5">Google দিয়ে লগইন করুন</h3>
            <p className="text-xs text-slate-300 mb-5 leading-relaxed">
              লগইন করলে আপনার সকল আয়-ব্যয়ের হিসাব ক্লাউডে নিরাপদ থাকবে এবং সব ডিভাইস থেকে ব্যবহার করা যাবে।
            </p>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs flex items-center justify-center gap-2.5 transition shadow-lg shadow-white/10 cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 48 48">
                <path
                  fill="#FFC107"
                  d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
                />
                <path
                  fill="#FF3D00"
                  d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
                />
              </svg>
              <span>Google দিয়ে কন্টিনিউ করুন</span>
            </button>

            <button
              type="button"
              onClick={() => setLoginModalOpen(false)}
              className="mt-3 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer"
            >
              পরে করব
            </button>
          </div>
        </div>
      )}

      {/* INITIAL BALANCE MODAL */}
      {balanceModalOpen && (
        <div
          onClick={() => setBalanceModalOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-6 bg-slate-900 border border-white/10 text-center shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xl mx-auto mb-3">
              💰
            </div>
            <h3 className="text-base font-bold text-white mb-1">ইনিশিয়াল ব্যালেন্স</h3>
            <p className="text-xs text-slate-300 mb-4">আপনার বর্তমান ক্যাশ বা ওপেনিং ব্যালেন্স সেট করুন।</p>

            <form onSubmit={handleSaveInitialBalance}>
              <input
                type="number"
                step="any"
                placeholder="0"
                value={newBalanceInput}
                onChange={(e) => setNewBalanceInput(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl bg-black/20 border border-white/10 text-white text-center font-bold text-lg mb-4 focus:outline-none focus:border-indigo-500"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBalanceModalOpen(false)}
                  className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-semibold cursor-pointer"
                >
                  সেভ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BACKUP RESTORE MODAL */}
      {restoreModalOpen && (
        <div
          onClick={() => setRestoreModalOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl p-6 bg-slate-900 border border-white/10 shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xl mx-auto mb-3">
              ♻️
            </div>
            <h3 className="text-base font-bold text-white text-center mb-1">ব্যাকআপ রিস্টোর</h3>
            <p className="text-xs text-slate-300 text-center mb-4">
              JSON ফাইল নির্বাচন করুন অথবা ব্যাকআপ কোড পেস্ট করুন।
            </p>

            <label className="block w-full py-3 px-4 rounded-xl border border-dashed border-white/20 hover:border-emerald-500/50 text-center cursor-pointer mb-3 transition">
              <span className="text-xs text-emerald-400 font-semibold">📁 JSON ফাইল সিলেক্ট করুন</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleRestoreFile}
                className="hidden"
              />
            </label>

            <label className="block text-xs font-medium text-slate-400 mb-1">অথবা ব্যাকআপ কোড পেস্ট করুন:</label>
            <textarea
              rows={4}
              value={restoreJsonText}
              onChange={(e) => setRestoreJsonText(e.target.value)}
              placeholder='{"transactions": [...], "categories": {...}}'
              className="w-full p-3 rounded-xl bg-black/20 border border-white/10 text-white text-xs font-mono mb-4 focus:outline-none focus:border-indigo-500"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleRestoreFromText}
                className="py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-semibold cursor-pointer"
              >
                রিস্টোর করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLEAR ALL DATA MODAL */}
      {clearModalOpen && (
        <div
          onClick={() => setClearModalOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl p-6 bg-slate-900 border border-white/10 text-center shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl mx-auto mb-3">
              ⚠️
            </div>
            <h3 className="text-base font-bold text-white mb-2">আপনি কি নিশ্চিত?</h3>
            <p className="text-xs text-slate-300 mb-5 leading-relaxed">
              সব লেনদেন, ওপেনিং ব্যালেন্স ও কাস্টম ক্যাটাগরি স্থায়ীভাবে মুছে যাবে। এই কাজ পূর্বাবস্থায় ফেরানো যাবে না।
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setClearModalOpen(false)}
                className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white text-xs font-semibold cursor-pointer"
              >
                হ্যাঁ, মুছুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT TRANSACTION MODAL */}
      {editModalOpen && editingTx && (
        <div
          onClick={() => setEditModalOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl p-6 bg-slate-900 border border-white/10 shadow-2xl"
          >
            <div className="w-12 h-12 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xl mx-auto mb-3">
              ✏️
            </div>
            <h3 className="text-base font-bold text-white text-center mb-4">লেনদেন এডিট করুন</h3>

            <form onSubmit={handleSaveEdit}>
              {/* Type toggle */}
              <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-black/30 mb-4">
                <button
                  type="button"
                  onClick={() => setEditType('income')}
                  className={`py-2 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    editType === 'income'
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
                      : 'text-slate-400'
                  }`}
                >
                  <span>↑ আয়</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditType('expense')}
                  className={`py-2 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    editType === 'expense'
                      ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white'
                      : 'text-slate-400'
                  }`}
                >
                  <span>↓ ব্যয়</span>
                </button>
              </div>

              <label className="block text-xs font-medium text-slate-400 mb-1">পরিমাণ (৳)</label>
              <input
                type="number"
                step="any"
                min="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl bg-black/20 border border-white/10 text-white text-sm mb-3 focus:outline-none"
              />

              <label className="block text-xs font-medium text-slate-400 mb-1">ক্যাটাগরি</label>
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-white text-sm mb-3 focus:outline-none"
              >
                {categories[editType]?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <label className="block text-xs font-medium text-slate-400 mb-1">তারিখ</label>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl bg-black/20 border border-white/10 text-white text-sm mb-3 focus:outline-none"
              />

              <label className="block text-xs font-medium text-slate-400 mb-1">নোট</label>
              <input
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-black/20 border border-white/10 text-white text-sm mb-5 focus:outline-none"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-semibold cursor-pointer"
                >
                  সেভ করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 👨‍💻 DEVELOPER INFO MODAL (READ ONLY) */}
      {devInfoModalOpen && (
        <div
          onClick={() => setDevInfoModalOpen(false)}
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl p-6 bg-slate-900 border border-white/10 shadow-2xl relative overflow-hidden"
          >
            {/* Top decorative gradient banner */}
            <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-r from-emerald-600/30 via-indigo-600/30 to-purple-600/30 pointer-events-none" />

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setDevInfoModalOpen(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/40 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer z-10"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Developer Profile Header */}
            <div className="relative pt-3 text-center mb-5">
              <div className="relative inline-block mb-3">
                <img
                  src={developerAvatarImg}
                  alt="Engr Saoun Khan"
                  className="w-24 h-24 rounded-full object-cover border-4 border-slate-900 shadow-2xl shadow-indigo-500/40 mx-auto ring-2 ring-emerald-400/50"
                />
                <span
                  className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-white text-[11px] shadow-md font-bold"
                  title="Verified Creator"
                >
                  ✓
                </span>
              </div>

              <h3 className="text-xl font-bold text-white mb-0.5 flex items-center justify-center gap-1.5">
                <span>Engr Saoun Khan</span>
                <Crown className="w-4 h-4 text-amber-400" />
              </h3>
              <p className="text-xs text-emerald-400 font-semibold mb-2.5">
                ইঞ্জিনিয়ার ও সফটওয়্যার ডেভেলপার
              </p>
              <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto bg-white/5 p-3 rounded-2xl border border-white/10">
                “হিসাব খাতা অ্যাপটি ব্যবহার করার জন্য আপনাকে আন্তরিক ধন্যবাদ। যেকোনো মতামত, পরামর্শ বা নতুন ফিচারের প্রয়োজনে সরাসরি আমার সাথে যোগাযোগ করতে পারেন।”
              </p>
            </div>

            {/* Contact Details (Read Only) */}
            <div className="space-y-2.5 mb-5">
              {/* Phone / Mobile */}
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-base">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <span className="text-[11px] text-slate-400 block font-medium">মোবাইল নাম্বার</span>
                    <span className="text-sm font-bold text-white tracking-wider">01948642494</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('01948642494');
                      showToast('মোবাইল নাম্বার কপি করা হয়েছে!');
                    }}
                    title="কপি করুন"
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href="tel:01948642494"
                    className="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>কল দিন</span>
                  </a>
                </div>
              </div>

              {/* Email */}
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-base">
                    ✉️
                  </div>
                  <div className="text-left">
                    <span className="text-[11px] text-slate-400 block font-medium">ইমেইল এড্রেস</span>
                    <span className="text-xs font-semibold text-white">saounonly@gmail.com</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText('saounonly@gmail.com');
                    showToast('ইমেইল কপি করা হয়েছে!');
                  }}
                  title="কপি করুন"
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Social Action Buttons: WhatsApp & Facebook */}
            <div className="grid grid-cols-2 gap-2.5 mb-3">
              {/* WhatsApp Button */}
              <a
                href="https://wa.me/8801948642494"
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 px-3.5 rounded-2xl font-bold text-xs text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 fill-white" />
                <span>WhatsApp</span>
                <ExternalLink className="w-3 h-3 opacity-70" />
              </a>

              {/* Facebook Button */}
              <a
                href="https://www.facebook.com/saounofficial"
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 px-3.5 rounded-2xl font-bold text-xs text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                <span>Facebook</span>
                <ExternalLink className="w-3 h-3 opacity-70" />
              </a>
            </div>

            <div className="text-center pt-2">
              <span className="text-[11px] text-slate-500 block">
                হিসাব খাতা • ভার্সন ২.১ (সকল অধিকার সংরক্ষিত)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
