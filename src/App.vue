<script setup>
import { ref, onMounted, onUnmounted, computed, watch, defineAsyncComponent, shallowRef } from 'vue';
import { 
  signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserLocalPersistence,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail
} from "firebase/auth";
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc, setDoc, getDoc, getDocs, serverTimestamp, where, deleteDoc, increment, writeBatch, limit } from 'firebase/firestore';
import { auth, adminAuth, db } from './firebase';
import ToastNotification from './components/ToastNotification.vue';
import {
  aggregateFrequentTopics,
  computeContributionIndex,
  normalizeTopicTag,
  suggestionsForSubject,
  topicTrendSplit,
} from './composables/pedagogy';

// Chart.js: lazy load only when stats panel opens
const chartReady = shallowRef(false);
const loadCharts = async () => {
  if (chartReady.value) return;
  const [chartjs, vueChartjs] = await Promise.all([
    import('chart.js'),
    import('vue-chartjs')
  ]);
  chartjs.Chart.register(
    chartjs.ArcElement, chartjs.Tooltip, chartjs.Legend,
    chartjs.CategoryScale, chartjs.LinearScale, chartjs.BarElement,
    chartjs.PointElement, chartjs.LineElement, chartjs.Filler,
    chartjs.RadialLinearScale
  );
  PieChart.value = vueChartjs.Pie;
  DoughnutChart.value = vueChartjs.Doughnut;
  BarChart.value = vueChartjs.Bar;
  LineChart.value = vueChartjs.Line;
  RadarChart.value = vueChartjs.Radar;
  chartReady.value = true;
};
const PieChart = shallowRef(null);
const DoughnutChart = shallowRef(null);
const BarChart = shallowRef(null);
const LineChart = shallowRef(null);
const RadarChart = shallowRef(null);

// Toast notification system
const toastRef = ref(null);
const toast = {
  success: (msg) => toastRef.value?.success(msg),
  error: (msg) => toastRef.value?.error(msg),
  warning: (msg) => toastRef.value?.warning(msg),
  info: (msg) => toastRef.value?.info(msg),
};

// --- ⚙️ DEĞİŞKENLER ---
const questions = ref([]);
const students = ref([]);
const teachers = ref([]);
const currentUser = ref(null);
const showAuthModal = ref(false);
const showSettingsModal = ref(false);
const showTeacherSettingsModal = ref(false);
const showDesignModal = ref(false);
const showAskModal = ref(false);
const showStats = ref(false);
const showPasswordModal = ref(false);
const authTab = ref('login');
const registerTab = ref('student'); // student, teacher
const loginForm = ref({ email: '', password: '' });
const registerForm = ref({ name: '', email: '', password: '', confirmPassword: '', class: '', number: '' });
const adminStudentForm = ref({ name: '', email: '', password: '', class: '', number: '' });
const teacherApprovals = ref([]);
const newSubject = ref('');
const newClass = ref('');
const newQuestion = ref({ subject: '', classLevel: '', content: '', topicTag: '' });
const learnNoteDrafts = ref({});
const topicTagCustom = ref('');
const answerText = ref({});
const editQuestionText = ref({});
const editAnswerText = ref({});
const editingQuestionId = ref(null);
const editingAnswerId = ref(null);
// --- TOPLU İŞLEM DEĞİŞKENLERİ ---
const bulkSelectedUserIds = ref([]); // toplu rol atama için seçili kullanıcılar
const bulkSelectedApprovalIds = ref([]); // toplu onay için seçili öğeler
const bulkActionLoading = ref(false);
// --- TOPLU ROL ATAMA ---
const bulkSetStaffRole = async (userIds, nextRole) => {
  if (!Array.isArray(userIds) || !userIds.length) {
    toast.warning('Seçili kullanıcı yok.');
    return;
  }
  if (!['teacher', 'manager', 'admin', 'student'].includes(nextRole)) {
    toast.warning('Geçersiz rol seçildi.');
    return;
  }
  if (!canEditCriticalSettings()) {
    toast.warning('Toplu rol atama için admin yetkisi gerekir.');
    return;
  }
  bulkActionLoading.value = true;
  try {
    const batch = writeBatch(db);
    userIds.forEach((uid) => {
      batch.update(doc(db, 'users', uid), { role: nextRole });
    });
    await batch.commit();
    toast.success(`${userIds.length} kullanıcıya toplu olarak '${getRoleLabel(nextRole)}' rolü atandı.`);
  } catch (error) {
    toast.error('Toplu rol atama hatası: ' + functionErrorMessage(error));
  } finally {
    bulkActionLoading.value = false;
  }
};

// --- TOPLU ONAY ---
const bulkApproveItems = async (itemType, itemIds) => {
  if (!Array.isArray(itemIds) || !itemIds.length) {
    toast.warning('Seçili öğe yok.');
    return;
  }
  if (!isLeadershipUser()) {
    toast.warning('Toplu onay için yönetici yetkisi gerekir.');
    return;
  }
  bulkActionLoading.value = true;
  try {
    const batch = writeBatch(db);
    if (itemType === 'question') {
      itemIds.forEach((qid) => {
        batch.update(doc(db, 'questions', qid), buildQuestionModerationFields('approved'));
      });
    } else if (itemType === 'student') {
      itemIds.forEach((uid) => {
        batch.update(doc(db, 'users', uid), { isApproved: true });
      });
    } else if (itemType === 'teacher') {
      itemIds.forEach((uid) => {
        batch.update(doc(db, 'users', uid), { isApproved: true });
      });
    } else {
      toast.warning('Geçersiz toplu onay türü.');
      bulkActionLoading.value = false;
      return;
    }
    await batch.commit();
    toast.success(`${itemIds.length} öğe toplu olarak onaylandı.`);
  } catch (error) {
    toast.error('Toplu onay hatası: ' + functionErrorMessage(error));
  } finally {
    bulkActionLoading.value = false;
  }
};
const searchQuery = ref('');
const similarQuestionFound = ref(null);
const similarQuestions = ref([]);
const filterSubject = ref('');
const filterClass = ref('');
const filterApproval = ref('all'); // all, approved, pending
const filterDate = ref('all'); // all, 7d, 30d, 90d
const statsRange = ref('30d');
const dashSubject = ref('');
const dashClass = ref('');
const statsTab = ref('overview');
const notifications = ref([]);
const lastAnswerByQuestion = new Map();
const seenPendingApprovalQuestionIds = new Set();
const lastQuestionModerationById = new Map();
let answerNotificationsInitialized = false;
let questionModerationNotificationsInitialized = false;
let pendingApprovalNotificationsInitialized = false;
const bulkRole = ref('student');
const bulkImporting = ref(false);
const createEmptyBulkReport = () => ({ ok: 0, fail: 0, repaired: 0, errors: [], failures: [] });
const bulkReport = ref(createEmptyBulkReport());
const bulkPending = ref([]);
const approvalQueueType = ref('all');
const approvalQueueSubject = ref('');
const approvalQueueClass = ref('');
const approvalQueueSearch = ref('');
const settingsTab = ref('overview');
const teacherSubjectDrafts = ref({});
const autoSaveEnabled = ref(true);
const isSettingsLoaded = ref(false);
const systemErrors = ref([]);
let autoSaveTimer = null;
const passwordForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' });
const nowText = ref(new Date().toLocaleString('tr-TR'));
const teacherNotificationSettings = ref(createDefaultTeacherApprovalEmailSettings());
const moderationLogs = ref([]);
const questionFeed = ref([]);
const ownQuestionFeed = ref([]);
const moderationDialog = ref(createEmptyModerationDialog());
const likedQuestionIds = ref([]);
const thankedAnswerQuestionIds = ref([]);
const isBrowserOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
const offlineCacheHydrated = ref(false);
const offlineCacheUpdatedAt = ref(0);
const inboxNotifications = ref([]);

// --- 📄 SAYFALAMA ---
const currentPage = ref(1);
const itemsPerPage = 4;

const EMAILJS_API_URL = 'https://api.emailjs.com/api/v1.0/email/send';
const OFFLINE_STORAGE_KEY = 'adab-offline-cache-v1';
const BULK_PASSWORD_MIN_LENGTH = 6;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAFF_ROLES = ['teacher', 'manager', 'admin'];
const LEADERSHIP_ROLES = ['manager', 'admin'];

function createEmptyModerationDialog() {
  return {
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Onayla',
    reasonLabel: 'Açıklama',
    reasonPlaceholder: '',
    reason: '',
    requireReason: true
  };
}

function createDefaultTeacherApprovalEmailSettings() {
  return {
    enabled: false,
    serviceId: '',
    templateId: '',
    publicKey: '',
    fromName: 'ADAB',
    siteUrl: '',
    recipientMap: {}
  };
}

function createEmptyOfflineCache() {
  return {
    settings: null,
    approvedQuestions: [],
    approvedStudents: [],
    updatedAt: 0
  };
}

const defaultSettings = {
  name: 'Taşköprü Anadolu İmam Hatip Lisesi',
  logo: 'https://img.icons8.com/color/96/graduation-cap.png',
  announcement: '2026 Eğitim Öğretim Yılı Hayırlı Olsun.',
  subjects: ['Matematik', 'Edebiyat', 'Fizik', 'Tarih', 'Din K.', 'Rehberlik'],
  classes: ['9. Sınıf', '10. Sınıf', '11. Sınıf', '12. Sınıf'],
  questionGoal: 500,
  styles: {
    fontFamily: "'Manrope', system-ui, sans-serif",
    customFontUrl: '',
    customFontName: '',
    baseFontSize: 15,
    headerBg: '#132337',
    headerText: '#e8eef6',
    accentColor: '#0f8f78',
    footerText: '#e8c468',
    footerBg: '#0f1c2e',
    bodyText: '#1f2a37',
    bgColor: '#101b2d',
    cardRadius: 16,
    titleFont: "'Playfair Display', Georgia, serif",
    titleSize: 26,
    titleColor: '#f7fafc',
    darkMode: false
  }
};

// --- TEMA KATALOĞU (okul kimliği odaklı; mor/indigo varsayılanlardan uzak) ---
const themePresets = {
  akademik: {
    label: 'Akademik Taze',
    blurb: 'Lacivert + zümrüt; günlük kullanım varsayılanı',
    headerBg: '#132337', headerText: '#e8eef6', accentColor: '#0f8f78',
    footerText: '#e8c468', footerBg: '#0f1c2e', bodyText: '#1f2a37',
    bgColor: '#101b2d', titleColor: '#f7fafc', cardRadius: 16, darkMode: false,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Playfair Display', Georgia, serif", titleSize: 26
  },
  sakin: {
    label: 'Sakin Odak',
    blurb: 'Soft teal ve açık sis zemini; uzun ders oturumu',
    headerBg: '#1a3a42', headerText: '#e7f4f6', accentColor: '#2a9d8f',
    footerText: '#b7e4c7', footerBg: '#153138', bodyText: '#24333a',
    bgColor: '#e8eef1', titleColor: '#f4fbfb', cardRadius: 14, darkMode: false,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Manrope', system-ui, sans-serif", titleSize: 24
  },
  etkinlik: {
    label: 'Canlı Etkinlik',
    blurb: 'Yüksek kontrast CTA; duyuru ve etkinlik haftası',
    headerBg: '#0b2e24', headerText: '#f3fff8', accentColor: '#12b886',
    footerText: '#ffe8a3', footerBg: '#082119', bodyText: '#14231c',
    bgColor: '#0d221b', titleColor: '#ffffff', cardRadius: 18, darkMode: false,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Playfair Display', Georgia, serif", titleSize: 28
  },
  kampus: {
    label: 'Kampüs Ormanı',
    blurb: 'Derin yeşil atmosfer; sakin ama kararlı',
    headerBg: '#12433a', headerText: '#e6f6f1', accentColor: '#2f9e74',
    footerText: '#c6f0df', footerBg: '#0e322b', bodyText: '#1c322b',
    bgColor: '#0c281f', titleColor: '#f1fcf7', cardRadius: 14, darkMode: false,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Playfair Display', Georgia, serif", titleSize: 25
  },
  gunisigi: {
    label: 'Gündüz Net',
    blurb: 'Aydınlık panel; rapor ve baskı dostu',
    headerBg: '#f4f7fa', headerText: '#1c2b3a', accentColor: '#0b7f86',
    footerText: '#334155', footerBg: '#e8eef4', bodyText: '#1e293b',
    bgColor: '#dbe4ee', titleColor: '#0f2740', cardRadius: 12, darkMode: false,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Manrope', system-ui, sans-serif", titleSize: 23
  },
  zümre: {
    label: 'Zümre Lacivert',
    blurb: 'Resmî okul dili; altın vurgu ile ciddiyet',
    headerBg: '#1a2744', headerText: '#eef3ff', accentColor: '#3d7ea6',
    footerText: '#d4b483', footerBg: '#141e36', bodyText: '#1f2937',
    bgColor: '#121a2d', titleColor: '#f8fafc', cardRadius: 12, darkMode: false,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Playfair Display', Georgia, serif", titleSize: 26
  },
  mezuniyet: {
    label: 'Mezuniyet',
    blurb: 'Gece tören ışığı; teal ve şampanya tonu',
    headerBg: '#12353f', headerText: '#f4fafb', accentColor: '#1aa6a0',
    footerText: '#e6c989', footerBg: '#0d272f', bodyText: '#1e2f35',
    bgColor: '#0b2229', titleColor: '#ffffff', cardRadius: 16, darkMode: false,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Playfair Display', Georgia, serif", titleSize: 27
  },
  gece: {
    label: 'Gece Ders',
    blurb: 'Düşük ışıklı çalışma; amber vurgu',
    headerBg: '#161b22', headerText: '#f0f3f6', accentColor: '#d4a017',
    footerText: '#f0d78c', footerBg: '#10151b', bodyText: '#d8dee6',
    bgColor: '#0b0f14', titleColor: '#f8fafc', cardRadius: 14, darkMode: true,
    fontFamily: "'Manrope', system-ui, sans-serif",
    titleFont: "'Manrope', system-ui, sans-serif", titleSize: 24
  }
};

const themePresetNames = Object.fromEntries(
  Object.entries(themePresets).map(([key, preset]) => [key, preset.label])
);

const applyThemePreset = (presetKey) => {
  const preset = themePresets[presetKey];
  if (!preset) return;
  const {
    label, blurb, ...styleFields
  } = preset;
  Object.assign(schoolSettings.value.styles, styleFields);
  toast.success(`"${label}" teması uygulandı.`);
};

const schoolSettings = ref(JSON.parse(JSON.stringify(defaultSettings)));

const normalizeEmailInput = (value) => String(value || '').trim().toLowerCase();
const normalizeEmailList = (emails = []) => {
  const raw = Array.isArray(emails) ? emails : String(emails || '').split(/[,\n;]/);
  return Array.from(
    new Set(
      raw
        .map(normalizeEmailInput)
        .filter(email => email && email.includes('@'))
    )
  );
};
const normalizeSubjectList = (subjects = []) => Array.from(
  new Set(
    (Array.isArray(subjects) ? subjects : [subjects])
      .map(subject => String(subject || '').trim())
      .filter(Boolean)
  )
);
const normalizeRecipientMap = (recipientMap = {}) => Object.fromEntries(
  Object.entries(recipientMap || {})
    .map(([subject, emails]) => [String(subject || '').trim(), normalizeEmailList(emails).join(', ')])
    .filter(([subject, emails]) => subject && emails)
);
const mergeSettingsWithDefaults = (data = {}) => ({
  ...defaultSettings,
  ...data,
  styles: {
    ...defaultSettings.styles,
    ...(data.styles || {})
  }
});

const sanitizeFontUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    const allowed = ['fonts.googleapis.com', 'fonts.gstatic.com'];
    if (!allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) return '';
    return parsed.href;
  } catch {
    return '';
  }
};
const mergeTeacherApprovalEmailSettings = (data = {}) => ({
  ...createDefaultTeacherApprovalEmailSettings(),
  ...data,
  recipientMap: normalizeRecipientMap(data.recipientMap || {})
});

const functionErrorMessage = (error, fallback = 'İşlem başarısız.') => {
  const raw = String(error?.message || '').trim();
  if (!raw) return fallback;
  return raw.replace(/^[a-z-]+:\s*/i, '').trim() || fallback;
};

const pushSystemError = (message) => {
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return;
  if (!systemErrors.value.includes(cleanMessage)) {
    systemErrors.value.unshift(cleanMessage);
  }
};

const handleSnapshotError = (label, onError = null) => (error) => {
  console.error(`${label} snapshot failed`, error);
  pushSystemError(`${label}: ${functionErrorMessage(error, 'Yetki veya bağlantı hatası.')}`);
  if (typeof onError === 'function') {
    onError(error);
  }
};

const getActorMeta = () => ({
  actorId: currentUser.value?.id || null,
  actorName: currentUser.value?.name || 'Bilinmiyor',
  actorRole: currentUser.value?.role || 'unknown'
});

const getTimestampMillis = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDateTime = (value) => {
  const millis = getTimestampMillis(value);
  if (!millis) return '-';
  return new Date(millis).toLocaleString('tr-TR');
};

const serializeOfflineValue = (value) => {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value?.toMillis === 'function') {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (Array.isArray(value)) {
    return value.map(item => serializeOfflineValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeOfflineValue(item)])
    );
  }
  return value;
};

const readOfflineCache = () => {
  if (typeof window === 'undefined') return createEmptyOfflineCache();
  try {
    const raw = window.localStorage.getItem(OFFLINE_STORAGE_KEY);
    if (!raw) return createEmptyOfflineCache();
    return {
      ...createEmptyOfflineCache(),
      ...(JSON.parse(raw) || {})
    };
  } catch {
    return createEmptyOfflineCache();
  }
};

const writeOfflineCache = (patch) => {
  if (typeof window === 'undefined') return;
  try {
    const current = readOfflineCache();
    const next = {
      ...current,
      ...patch,
      updatedAt: Date.now()
    };
    window.localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(serializeOfflineValue(next)));
    offlineCacheUpdatedAt.value = next.updatedAt;
  } catch {
    // ignore local cache failures
  }
};

const hydrateOfflineCache = () => {
  const cached = readOfflineCache();
  offlineCacheUpdatedAt.value = cached.updatedAt || 0;
  if (cached.settings) {
    schoolSettings.value = mergeSettingsWithDefaults(cached.settings);
    isSettingsLoaded.value = true;
  }
  if (Array.isArray(cached.approvedQuestions) && cached.approvedQuestions.length) {
    questionFeed.value = cached.approvedQuestions;
  }
  if (Array.isArray(cached.approvedStudents) && cached.approvedStudents.length) {
    students.value = cached.approvedStudents;
  }
  syncQuestionState();
  offlineCacheHydrated.value = Boolean(cached.settings || cached.approvedQuestions?.length || cached.approvedStudents?.length);
};

const handleBrowserOnline = () => {
  isBrowserOnline.value = true;
};

const handleBrowserOffline = () => {
  isBrowserOnline.value = false;
};

const mergeQuestionLists = (...lists) => {
  const merged = new Map();
  lists.flat().forEach((question) => {
    if (!question?.id) return;
    const previous = merged.get(question.id) || {};
    merged.set(question.id, { ...previous, ...question });
  });
  return Array.from(merged.values()).sort((a, b) => getTimestampMillis(b.created_at) - getTimestampMillis(a.created_at));
};

const syncQuestionState = () => {
  questions.value = mergeQuestionLists(questionFeed.value, ownQuestionFeed.value);
};

const buildReactionDocId = (questionId, userId) => `${String(questionId || '').trim()}_${String(userId || '').trim()}`;

let moderationDialogHandler = null;

const closeModerationDialog = () => {
  moderationDialog.value = createEmptyModerationDialog();
  moderationDialogHandler = null;
};

const openModerationDialog = ({
  title,
  message,
  confirmLabel,
  reasonLabel = 'Açıklama',
  reasonPlaceholder = '',
  requireReason = true,
  onConfirm
}) => {
  moderationDialog.value = {
    open: true,
    title: String(title || '').trim(),
    message: String(message || '').trim(),
    confirmLabel: String(confirmLabel || 'Onayla').trim(),
    reasonLabel,
    reasonPlaceholder,
    reason: '',
    requireReason
  };
  moderationDialogHandler = onConfirm;
};

const submitModerationDialog = async () => {
  if (!moderationDialogHandler) {
    closeModerationDialog();
    return;
  }
  const reason = String(moderationDialog.value.reason || '').trim();
  if (moderationDialog.value.requireReason && reason.length < 3) {
    toast.warning("Lütfen en az 3 karakterlik bir açıklama yazın.");
    return;
  }
  try {
    await moderationDialogHandler(reason);
    closeModerationDialog();
  } catch (error) {
    const msg = functionErrorMessage(error, "Moderasyon işlemi tamamlanamadı.");
    pushSystemError(msg);
    toast.error(msg);
  }
};

const rollbackCreatedAuthUser = async (user) => {
  if (!user) return;
  try {
    await user.delete();
  } catch {
    try {
      await signOut(auth);
    } catch {
      // no-op
    }
  }
};

const guessNameFromEmail = (email) => {
  const localPart = normalizeEmailInput(email).split('@')[0] || 'ogrenci';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Öğrenci';
};

const buildRecoveredUserProfile = (user, role = 'student') => {
  const email = normalizeEmailInput(user?.email || '');
  const profile = {
    name: String(user?.displayName || '').trim() || guessNameFromEmail(email),
    email,
    role,
    points: 0,
    isApproved: false,
    archived: false,
    createdAt: serverTimestamp()
  };
  if (role === 'teacher') {
    profile.subjects = [];
  }
  return profile;
};

const recoverMissingUserProfile = async (user, role = 'student') => {
  if (!user?.uid) throw new Error('Kullanıcı bulunamadı.');
  await setDoc(doc(db, 'users', user.uid), buildRecoveredUserProfile(user, role));
};

const buildManagedUserProfile = ({
  name,
  email,
  role = 'student',
  studentClass = '',
  number = '',
  isApproved = true,
  archived = false
}) => {
  const profile = {
    name: String(name || '').trim(),
    email: normalizeEmailInput(email),
    role,
    points: 0,
    isApproved: Boolean(isApproved),
    archived: Boolean(archived),
    createdAt: serverTimestamp()
  };

  if (role === 'student') {
    profile.class = String(studentClass || '').trim();
    profile.number = String(number || '').trim();
  } else if (role === 'teacher') {
    profile.subjects = [];
  }

  return profile;
};

const isLeadershipRole = (role = '') => LEADERSHIP_ROLES.includes(String(role || '').trim());
const isStaffRole = (role = '') => STAFF_ROLES.includes(String(role || '').trim());
const isLeadershipUser = (user = currentUser.value) => Boolean(user && isLeadershipRole(user.role));
const isTeacherUser = (user = currentUser.value) => Boolean(user && user.role === 'teacher');
const isStaffUser = (user = currentUser.value) => Boolean(user && isStaffRole(user.role));
const canEditCriticalSettings = (user = currentUser.value) => Boolean(user && user.role === 'admin');
const canManageUsers = (user = currentUser.value) => isLeadershipUser(user);
const getRoleLabel = (role = '') => {
  const map = {
    admin: 'Admin',
    manager: 'Yönetici',
    teacher: 'Öğretmen',
    student: 'Öğrenci'
  };
  return map[String(role || '').trim()] || 'Kullanıcı';
};
const getRoleBadgeIcon = (role = '') => {
  const map = {
    admin: '👨‍💼',
    manager: '🧭',
    teacher: '👨‍🏫',
    student: '👨‍🎓'
  };
  return map[String(role || '').trim()] || '👤';
};

const getUserSubjects = (user = currentUser.value) => normalizeSubjectList(user?.subjects || []);

const canModerateSubject = (subject, user = currentUser.value) => {
  const cleanSubject = String(subject || '').trim();
  if (!cleanSubject || !user) return false;
  if (isLeadershipUser(user)) return true;
  if (user.role !== 'teacher') return false;
  return getUserSubjects(user).includes(cleanSubject);
};

const canModerateQuestion = (question, user = currentUser.value) => Boolean(question) && canModerateSubject(question.subject, user);

const syncTeacherSubjectDrafts = (teacherList = []) => {
  const nextDrafts = {};
  teacherList.forEach((teacher) => {
    nextDrafts[teacher.id] = normalizeSubjectList(teacher.subjects);
  });
  teacherSubjectDrafts.value = nextDrafts;
};

const toggleTeacherSubject = (teacherId, subject) => {
  const current = new Set(normalizeSubjectList(teacherSubjectDrafts.value[teacherId]));
  if (current.has(subject)) {
    current.delete(subject);
  } else {
    current.add(subject);
  }
  teacherSubjectDrafts.value = {
    ...teacherSubjectDrafts.value,
    [teacherId]: Array.from(current)
  };
};

const saveTeacherSubjects = async (teacherId) => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    return;
  }
  const subjects = normalizeSubjectList(teacherSubjectDrafts.value[teacherId]);
  try {
    await updateDoc(doc(db, "users", teacherId), { subjects });
    toast.success("Öğretmen ders ataması güncellendi.");
  } catch (error) {
    const msg = functionErrorMessage(error, "Öğretmen dersleri kaydedilemedi.");
    systemErrors.value.unshift(msg);
    toast.error(msg);
  }
};

const setStaffRole = async (staff, nextRole) => {
  if (!staff?.id) return;
  if (!['teacher', 'manager', 'admin'].includes(nextRole)) {
    toast.warning("Geçersiz rol seçildi.");
    return;
  }
  if (!canEditCriticalSettings()) {
    toast.warning("Rol güncelleme için admin yetkisi gerekir.");
    return;
  }
  if (staff.role === nextRole) return;

  const roleLabel = getRoleLabel(nextRole);
  const currentRoleLabel = getRoleLabel(staff.role);
  if (!confirm(`${staff.name} kullanıcısının rolü ${currentRoleLabel} yerine ${roleLabel} olsun mu?`)) {
    return;
  }

  try {
    const batch = writeBatch(db);
    const updatePayload = { role: nextRole };
    if (nextRole === 'teacher' && !Array.isArray(staff.subjects)) {
      updatePayload.subjects = [];
    }
    batch.update(doc(db, "users", staff.id), updatePayload);
    addModerationLogToBatch(batch, {
      action: 'change_staff_role',
      targetType: 'user',
      targetId: staff.id,
      targetLabel: `${staff.name} (${staff.email || '-'})`,
      details: `${currentRoleLabel} rolunden ${roleLabel} rolune gecirildi.`
    });
    addInboxNotificationToBatch(batch, {
      recipientId: staff.id,
      type: 'role-updated',
      title: 'Rolunuz guncellendi',
      message: `Yeni rolunuz: ${roleLabel}.`,
      relatedId: staff.id
    });
    await batch.commit();
    toast.success(`${staff.name} artik ${roleLabel}.`);
  } catch (error) {
    const msg = functionErrorMessage(error, "Rol guncellenemedi.");
    systemErrors.value.unshift(msg);
    toast.error(msg);
  }
};

const normalizeTeacherNotificationRecipient = (subject) => {
  const cleanSubject = String(subject || '').trim();
  if (!cleanSubject) return;
  const normalized = normalizeEmailList(teacherNotificationSettings.value.recipientMap?.[cleanSubject]).join(', ');
  if (normalized) {
    teacherNotificationSettings.value.recipientMap[cleanSubject] = normalized;
  } else {
    delete teacherNotificationSettings.value.recipientMap[cleanSubject];
  }
};

const fillTeacherNotificationRecipientsFromTeachers = () => {
  const nextMap = {};
  schoolSettings.value.subjects.forEach((subject) => {
    const emails = teachers.value
      .filter(teacher => teacher.role === 'teacher' && teacher.isApproved && !teacher.archived && normalizeSubjectList(teacher.subjects).includes(subject))
      .map(teacher => teacher.email);
    const normalized = normalizeEmailList(emails).join(', ');
    if (normalized) nextMap[subject] = normalized;
  });
  teacherNotificationSettings.value = {
    ...teacherNotificationSettings.value,
    recipientMap: nextMap
  };
  toast.success("Ders alıcıları öğretmen atamalarından dolduruldu.");
};

const getTeacherNotificationRecipientList = (subject) => {
  const cleanSubject = String(subject || '').trim();
  if (!cleanSubject) return [];
  return normalizeEmailList(teacherNotificationSettings.value.recipientMap?.[cleanSubject] || []);
};

const loadTeacherNotificationSettings = async () => {
  try {
    const snap = await getDoc(doc(db, "private_settings", "teacher_notifications"));
    teacherNotificationSettings.value = snap.exists()
      ? mergeTeacherApprovalEmailSettings(snap.data() || {})
      : createDefaultTeacherApprovalEmailSettings();
  } catch (error) {
    console.error('Teacher notification settings load failed', error);
    teacherNotificationSettings.value = createDefaultTeacherApprovalEmailSettings();
    pushSystemError(`Öğretmen e-posta ayarları: ${functionErrorMessage(error, 'Yüklenemedi.')}`);
  }
};

const saveTeacherNotificationSettings = async () => {
  if (!isLeadershipUser()) {
    toast.warning('Bu ayar için yönetici yetkisi gerekir.');
    return;
  }
  try {
    await setDoc(
      doc(db, "private_settings", "teacher_notifications"),
      mergeTeacherApprovalEmailSettings(teacherNotificationSettings.value)
    );
    toast.success('Öğretmen e-posta ayarları kaydedildi.');
  } catch (error) {
    const msg = functionErrorMessage(error, 'Öğretmen e-posta ayarları kaydedilemedi.');
    pushSystemError(`Öğretmen e-posta ayarları: ${msg}`);
    toast.error(msg);
    throw error;
  }
};

const autoSaveAdminSettings = async () => {
  await setDoc(doc(db, "settings", "school_info"), schoolSettings.value);
  await saveTeacherNotificationSettings();
};

const sendTeacherApprovalEmail = async ({ toEmail, question }) => {
  const config = mergeTeacherApprovalEmailSettings(teacherNotificationSettings.value);
  const moderationUrl = String(config.siteUrl || window.location.origin || '').trim();
  const response = await fetch(EMAILJS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: config.serviceId,
      template_id: config.templateId,
      user_id: config.publicKey,
      template_params: {
        to_email: toEmail,
        to_name: 'Ders Öğretmeni',
        school_name: schoolSettings.value.name,
        from_name: config.fromName || schoolSettings.value.name || 'ADAB',
        question_subject: question.subject,
        class_level: question.classLevel,
        student_name: question.sender,
        student_class: question.senderClass || question.classLevel || '-',
        question_preview: question.content,
        moderation_url: moderationUrl,
        question_link: moderationUrl,
        question_id: question.id || '',
        notification_title: 'Onay bekleyen yeni soru',
        subject_line: `${schoolSettings.value.name} | ${question.subject} için onay bekleyen soru`,
        created_at: new Date().toLocaleString('tr-TR')
      }
    })
  });

  if (!response.ok) {
    const errorText = (await response.text().catch(() => '')).trim();
    throw new Error(errorText || `E-posta servisi hata verdi (${response.status}).`);
  }
};

const notifyTeachersAboutPendingQuestion = async (question) => {
  const config = mergeTeacherApprovalEmailSettings(teacherNotificationSettings.value);
  if (!config.enabled) return;
  if (!config.serviceId || !config.templateId || !config.publicKey) {
    pushSystemError("E-posta bildirimi açık ama EmailJS bilgileri eksik.");
    return;
  }

  const recipients = getTeacherNotificationRecipientList(question.subject);
  if (!recipients.length) return;

  try {
    // EmailJS istemci tarafında saniyede yaklaşık bir isteği daha sorunsuz kaldırıyor.
    for (let index = 0; index < recipients.length; index += 1) {
      await sendTeacherApprovalEmail({ toEmail: recipients[index], question });
      if (index < recipients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    }
  } catch (error) {
    pushSystemError(`E-posta bildirimi gönderilemedi: ${functionErrorMessage(error, 'Bilinmeyen hata.')}`);
  }
};

const buildModerationLogPayload = ({
  action,
  targetType,
  targetId,
  targetLabel,
  subject = '',
  classLevel = '',
  reason = '',
  details = ''
}) => ({
  ...getActorMeta(),
  action,
  targetType,
  targetId,
  targetLabel,
  subject: String(subject || '').trim(),
  classLevel: String(classLevel || '').trim(),
  reason: String(reason || '').trim(),
  details: String(details || '').trim(),
  createdAt: serverTimestamp()
});

const addModerationLogToBatch = (batch, payload) => {
  batch.set(doc(collection(db, "moderation_logs")), buildModerationLogPayload(payload));
};

const buildInboxNotificationPayload = ({
  recipientId,
  type,
  title,
  message,
  relatedId = '',
  reason = ''
}) => ({
  ...getActorMeta(),
  recipientId,
  type,
  title: String(title || '').trim(),
  message: String(message || '').trim(),
  relatedId: String(relatedId || '').trim(),
  reason: String(reason || '').trim(),
  read: false,
  createdAt: serverTimestamp()
});

const addInboxNotificationToBatch = (batch, payload) => {
  if (!payload?.recipientId) return;
  batch.set(doc(collection(db, "user_notifications")), buildInboxNotificationPayload(payload));
};

const buildUserModerationFields = (status, reason = '') => {
  const actor = getActorMeta();
  const common = {
    moderationStatus: status,
    moderationUpdatedAt: serverTimestamp(),
    moderationUpdatedById: actor.actorId,
    moderationUpdatedByName: actor.actorName,
    moderationUpdatedByRole: actor.actorRole
  };

  if (status === 'approved') {
    return {
      ...common,
      isApproved: true,
      archived: false,
      archivedAt: null,
      rejectionReason: null,
      rejectedAt: null,
      rejectedById: null,
      rejectedByName: null,
      rejectedByRole: null
    };
  }

  return {
    ...common,
    isApproved: false,
    archived: true,
    archivedAt: serverTimestamp(),
    rejectionReason: String(reason || '').trim(),
    rejectedAt: serverTimestamp(),
    rejectedById: actor.actorId,
    rejectedByName: actor.actorName,
    rejectedByRole: actor.actorRole
  };
};

const buildQuestionModerationFields = (status, reason = '') => {
  const actor = getActorMeta();
  const common = {
    isApproved: status === 'approved',
    isRejected: status === 'rejected',
    moderationStatus: status,
    moderatedAt: serverTimestamp(),
    moderatedById: actor.actorId,
    moderatedByName: actor.actorName,
    moderatedByRole: actor.actorRole
  };

  if (status === 'approved') {
    return {
      ...common,
      rejectionReason: null,
      rejectedAt: null,
      rejectedById: null,
      rejectedByName: null,
      rejectedByRole: null
    };
  }

  return {
    ...common,
    rejectionReason: String(reason || '').trim(),
    rejectedAt: serverTimestamp(),
    rejectedById: actor.actorId,
    rejectedByName: actor.actorName,
    rejectedByRole: actor.actorRole
  };
};

const buildAnswerModerationFields = (status, reason = '') => {
  const actor = getActorMeta();
  const common = {
    answerApproved: status === 'approved',
    answerModerationStatus: status,
    answerModeratedAt: serverTimestamp(),
    answerModeratedById: actor.actorId,
    answerModeratedByName: actor.actorName,
    answerModeratedByRole: actor.actorRole
  };

  if (status === 'approved') {
    return common;
  }

  return {
    ...common,
    cevap: null,
    respondent: null,
    respId: null,
    respRole: null,
    answerAccepted: false,
    acceptedAt: null
  };
};

const getQuestionModerationState = (question) => {
  if (question?.isApproved) return 'approved';
  if (question?.isRejected) return `rejected:${question?.rejectionReason || ''}`;
  return 'pending';
};

const getModerationLogTitle = (entry) => {
  const actionMap = {
    approve_student: 'Öğrenci onaylandı',
    archive_student: 'Öğrenci pasife alındı',
    approve_teacher: 'Öğretmen onaylandı',
    archive_teacher: 'Öğretmen pasife alındı',
    approve_question: 'Soru onaylandı',
    reject_question: 'Soru reddedildi',
    resubmit_question: 'Soru yeniden gönderildi',
    approve_answer: 'Cevap onaylandı',
    reject_answer: 'Cevap reddedildi',
    change_staff_role: 'Personel rolü güncellendi'
  };
  return actionMap[entry?.action] || 'Moderasyon işlemi';
};

const findUserProfileByEmail = async (email) => {
  const cleanEmail = normalizeEmailInput(email);
  if (!cleanEmail) return null;

  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', cleanEmail)));
  return snap.docs[0] || null;
};

const clearAdminAuthSession = async () => {
  try {
    await signOut(adminAuth);
  } catch {
    // no-op
  }
};

const upsertManagedUserProfile = async ({
  name,
  email,
  password,
  role = 'student',
  studentClass = '',
  number = '',
  isApproved = true
}) => {
  const cleanEmail = normalizeEmailInput(email);
  const existingProfile = await findUserProfileByEmail(cleanEmail);
  const existingRole = existingProfile?.data()?.role;

  if (existingRole && existingRole !== role) {
    throw new Error("Bu e-posta farklı bir kullanıcı rolüne bağlı. Aynı e-posta hem öğrenci hem öğretmen olamaz.");
  }

  let status = 'created';
  let uid = '';

  try {
    try {
      const created = await createUserWithEmailAndPassword(adminAuth, cleanEmail, password);
      uid = created.user.uid;
    } catch (error) {
      if (error?.code !== 'auth/email-already-in-use') {
        throw error;
      }

      try {
        const existingAuth = await signInWithEmailAndPassword(adminAuth, cleanEmail, password);
        uid = existingAuth.user.uid;
        if (!existingProfile) {
          status = 'repaired';
        } else if (existingProfile.id !== uid) {
          status = 'relinked';
        } else {
          status = existingProfile.data()?.archived ? 'restored' : 'updated';
        }
      } catch {
        if (!existingProfile) {
          throw new Error("Bu e-posta zaten Auth'ta kayıtlı. Kullanıcı mevcut şifresiyle giriş yapmalı veya şifresini sıfırlamalı.");
        }

        uid = existingProfile.id;
        status = existingProfile.data()?.archived ? 'restored' : 'updated';
      }
    }

    const userRef = doc(db, 'users', uid);
    const currentSnap = await getDoc(userRef);
    const currentData = currentSnap.exists() ? currentSnap.data() : {};
    const nextProfile = {
      ...buildManagedUserProfile({
        name,
        email: cleanEmail,
        role,
        studentClass,
        number,
        isApproved,
        archived: false
      }),
      points: Number(currentData.points ?? 0),
      createdAt: currentData.createdAt || serverTimestamp()
    };

    await setDoc(userRef, nextProfile, { merge: true });

    if (existingProfile && existingProfile.id !== uid) {
      await deleteDoc(existingProfile.ref);
      status = 'relinked';
    }

    return { uid, status };
  } finally {
    await clearAdminAuthSession();
  }
};

// --- 🤖 YAPAY ZEKA: BENZERLİK ALGILAMA ---
watch(() => newQuestion.value.content, (newVal) => {
  if (!newVal || newVal.length < 5) { 
    similarQuestionFound.value = null; 
    similarQuestions.value = [];
    return; 
  }
  const term = newVal.toLowerCase();
  const matches = questions.value
    .filter(q => q.isApproved && (q.content || '').toLowerCase().includes(term))
    .slice(0, 3);
  similarQuestions.value = matches;
  similarQuestionFound.value = matches.length ? matches[0] : null;
});

// --- 🤖 YAPAY ZEKA: ROZET SİSTEMİ ---
const getUserBadge = (points) => {
  if (points > 200) return '👑 Dahi';
  if (points > 100) return '🏆 Üstad';
  if (points > 50) return '⭐ Kıdemli';
  if (points > 20) return '💡 Gayretli';
  if (points > 5) return '🌱 Filiz';
  return '🆕 Yeni';
};

const topicSuggestions = computed(() => suggestionsForSubject(newQuestion.value.subject));

const pickTopicSuggestion = (tag) => {
  newQuestion.value.topicTag = tag;
  topicTagCustom.value = '';
};

const relevantPendingQuestions = computed(() => (
  questions.value.filter(question => !question.isApproved && !question.isRejected && canModerateQuestion(question))
));

const bulkPreviewStats = computed(() => {
  return bulkPending.value.reduce((stats, item) => {
    stats.total += 1;
    if (item.actionable) stats.ready += 1;
    else stats.blocked += 1;

    if (item.action === 'create') stats.create += 1;
    if (item.action === 'update') stats.update += 1;
    if (item.action === 'restore') stats.restore += 1;
    return stats;
  }, {
    total: 0,
    ready: 0,
    blocked: 0,
    create: 0,
    update: 0,
    restore: 0
  });
});

const approvalQueueBaseEntries = computed(() => {
  const entries = [];

  relevantPendingQuestions.value.forEach((question) => {
    entries.push({
      id: `question-${question.id}`,
      kind: 'question',
      kindLabel: 'Soru',
      title: `${question.subject} | ${question.sender}`,
      subtitle: (question.content || '').slice(0, 150),
      meta: `${question.classLevel || question.senderClass || '-'} • Gönderen: ${question.sender}`,
      subject: String(question.subject || '').trim(),
      classLevel: String(question.classLevel || question.senderClass || '').trim(),
      createdAt: question.created_at || null,
      searchText: [
        question.subject,
        question.classLevel,
        question.sender,
        question.senderClass,
        question.content
      ].join(' ').toLowerCase(),
      data: question
    });
  });

  if (isLeadershipUser()) {
    students.value
      .filter(student => !student.isApproved)
      .forEach((student) => {
        entries.push({
          id: `student-${student.id}`,
          kind: 'student',
          kindLabel: 'Öğrenci',
          title: student.name,
          subtitle: student.email,
          meta: `${student.class || '-'} • No: ${student.number || '-'}`,
          subject: '',
          classLevel: String(student.class || '').trim(),
          createdAt: student.createdAt || null,
          searchText: [
            student.name,
            student.email,
            student.class,
            student.number
          ].join(' ').toLowerCase(),
          data: student
        });
      });
  }

  if (isLeadershipUser()) {
    teachers.value
      .filter(teacher => !teacher.isApproved && teacher.role !== 'student')
      .forEach((teacher) => {
        entries.push({
          id: `teacher-${teacher.id}`,
          kind: 'teacher',
          kindLabel: 'Öğretmen',
          title: teacher.name,
          subtitle: teacher.email,
          meta: 'Öğretmen onayı bekliyor',
          subject: '',
          classLevel: '',
          createdAt: teacher.createdAt || null,
          searchText: [teacher.name, teacher.email].join(' ').toLowerCase(),
          data: teacher
        });
      });
  }

  const order = { question: 0, student: 1, teacher: 2 };
  return entries.sort((a, b) => {
    const timeDiff = getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return (order[a.kind] || 9) - (order[b.kind] || 9);
  });
});

const approvalQueueCounts = computed(() => {
  return approvalQueueBaseEntries.value.reduce((counts, entry) => {
    counts.all += 1;
    counts[entry.kind] += 1;
    return counts;
  }, {
    all: 0,
    question: 0,
    student: 0,
    teacher: 0
  });
});

const approvalQueueEntries = computed(() => {
  let entries = [...approvalQueueBaseEntries.value];

  if (approvalQueueType.value !== 'all') {
    entries = entries.filter(entry => entry.kind === approvalQueueType.value);
  }
  if (approvalQueueSubject.value) {
    entries = entries.filter(entry => entry.subject === approvalQueueSubject.value);
  }
  if (approvalQueueClass.value) {
    entries = entries.filter(entry => entry.classLevel === approvalQueueClass.value);
  }
  if (approvalQueueSearch.value) {
    const term = approvalQueueSearch.value.trim().toLowerCase();
    entries = entries.filter(entry => entry.searchText.includes(term));
  }

  return entries;
});

const clearApprovalQueueFilters = () => {
  approvalQueueType.value = 'all';
  approvalQueueSubject.value = '';
  approvalQueueClass.value = '';
  approvalQueueSearch.value = '';
};

const needsTeacherSubjectAssignment = computed(() => (
  currentUser.value?.role === 'teacher' && !getUserSubjects(currentUser.value).length
));

const canViewStats = computed(() => {
  if (!currentUser.value) return false;
  if (isLeadershipUser()) return true;
  return isTeacherUser() && isBrowserOnline.value;
});

const canOpenSettings = computed(() => isLeadershipUser());
const canOpenDesign = computed(() => canEditCriticalSettings());
const teacherIsOffline = computed(() => isTeacherUser() && !isBrowserOnline.value);

const userCanSeeQuestion = (question, user = currentUser.value) => {
  if (!question) return false;
  if (question.isApproved) return true;
  if (!user) return false;
  if (canModerateQuestion(question, user)) return true;
  return question.senderId === user.id;
};

const visibleModerationLogs = computed(() => (
  moderationLogs.value.filter((entry) => {
    if (isLeadershipUser()) return true;
    if (entry.actorId === currentUser.value?.id) return true;
    if (entry.subject) return canModerateSubject(entry.subject);
    return false;
  })
));

const hasLikedQuestion = (questionId) => likedQuestionIds.value.includes(questionId);
const hasThankedAnswer = (questionId) => thankedAnswerQuestionIds.value.includes(questionId);
const sortedInboxNotifications = computed(() => (
  [...inboxNotifications.value].sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt))
));
const unreadInboxCount = computed(() => sortedInboxNotifications.value.filter(item => !item.read).length);
const offlineStatusText = computed(() => {
  const lastSync = offlineCacheUpdatedAt.value ? `Son eşitleme: ${formatDateTime(offlineCacheUpdatedAt.value)}` : 'Henüz yerel veri yok.';
  if (!isBrowserOnline.value) {
    return `Çevrimdışı mod aktif. Son kaydedilen içerik gösteriliyor. ${lastSync}`;
  }
  if (offlineCacheHydrated.value) {
    return `Çevrimdışı görüntüleme hazır. ${lastSync}`;
  }
  return '';
});

// --- 🔍 ARAMA ---
const filteredQuestions = computed(() => {
  let list = questions.value.filter(q => userCanSeeQuestion(q));
  if (searchQuery.value) {
    const term = searchQuery.value.toLowerCase();
    list = list.filter(q => 
      (q.content || '').toLowerCase().includes(term) || 
      (q.subject || '').toLowerCase().includes(term) || 
      (q.sender || '').toLowerCase().includes(term)
    );
  }
  if (filterSubject.value) list = list.filter(q => q.subject === filterSubject.value);
  if (filterClass.value) list = list.filter(q => q.classLevel === filterClass.value);
  if (filterApproval.value === 'approved') list = list.filter(q => q.isApproved);
  if (filterApproval.value === 'pending') list = list.filter(q => !q.isApproved && !q.isRejected);
  if (filterApproval.value === 'rejected') list = list.filter(q => q.isRejected);
  if (filterDate.value !== 'all') {
    const now = Date.now();
    const days = filterDate.value === '7d' ? 7 : filterDate.value === '30d' ? 30 : 90;
    const since = now - days * 24 * 60 * 60 * 1000;
    list = list.filter(q => {
      const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : null;
      return ts ? ts >= since : true;
    });
  }
  return list;
});

const totalPages = computed(() => Math.ceil(filteredQuestions.value.length / itemsPerPage));
const paginatedQuestions = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  return filteredQuestions.value.slice(start, start + itemsPerPage);
});
const changePage = (p) => { if (p >= 1 && p <= totalPages.value) currentPage.value = p; };

const formatAuthMethods = (methods) => {
  if (!methods || !methods.length) return "bilinmiyor";
  const map = {
    "password": "E‑posta/Şifre",
    "google.com": "Eski Google kaydı"
  };
  return methods.map(m => map[m] || m).join(", ");
};

const showEmailInUseHelp = async (rawEmail) => {
  const email = String(rawEmail || "").trim();
  if (!email) {
    toast.info("Bu e-posta zaten kullanımda. Giriş yapmayı deneyin.");
    return;
  }
  toast.info("Bu e-posta zaten kayıtlı. Giriş yapın veya şifre sıfırlayın.");
};

const handlePasswordReset = async () => {
  const email = normalizeEmailInput(loginForm.value.email);
  if (!email) {
    toast.warning("Önce e-posta adresinizi yazın.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    toast.success("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.");
  } catch (error) {
    const code = error?.code;
    if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
      toast.error("Bu e-posta için şifre sıfırlama gönderilemedi. Adresi kontrol edin.");
      return;
    }
    toast.error("Şifre sıfırlama hatası: " + functionErrorMessage(error, "E-posta gönderilemedi."));
  }
};

const handleEmailLogin = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    const { email, password } = loginForm.value;
    
    if (!email || !password) {
      toast.warning("E-posta ve şifre gerekli!");
      return;
    }

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (userData.archived) {
        const reasonText = userData.rejectionReason ? `\nGerekçe: ${userData.rejectionReason}` : '';
        toast.info(`Bu hesap pasife alınmış.${reasonText}`);
        await signOut(auth);
        return;
      }
      if (!userData.isApproved) {
        const reasonText = userData.rejectionReason ? `\nSon not: ${userData.rejectionReason}` : '';
        toast.info(`Hesabınız henüz onaylanmamıştır. Yönetici tarafından doğrulanmasını bekleyin.${reasonText}`);
        await signOut(auth);
        return;
      }
      currentUser.value = { id: userCredential.user.uid, ...userData };
      showAuthModal.value = false;
      loginForm.value = { email: '', password: '' };
    } else {
      try {
        await recoverMissingUserProfile(userCredential.user, 'student');
        await signOut(auth);
        loginForm.value = { email: '', password: '' };
        toast.info("Bu hesap için profil kaydı eksikti. Profil yeniden oluşturuldu; yönetici onayından sonra giriş yapabilirsiniz.");
      } catch (recoverError) {
        await signOut(auth);
        throw recoverError;
      }
    }
  } catch (error) {
    toast.error("Giriş Hatası: " + (error.code === 'auth/user-not-found' ? "Kullanıcı bulunamadı" : error.message));
  }
};

const handleStudentRegister = async () => {
  try {
    const { name, email, password, confirmPassword, class: studentClass, number } = registerForm.value;
    const cleanEmail = normalizeEmailInput(email);

    if (!name || !cleanEmail || !password || !studentClass || !number) {
      toast.warning("Tüm alanlar gerekli!");
      return;
    }

    if (password !== confirmPassword) {
      toast.warning("Şifreler eşleşmiyor!");
      return;
    }

    const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);

    try {
      await setDoc(doc(db, 'users', userCredential.user.uid), {
        name,
        email: cleanEmail,
        class: studentClass,
        number,
        role: 'student',
        points: 0,
        isApproved: false,
        archived: false,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      await rollbackCreatedAuthUser(userCredential.user);
      throw error;
    }

    toast.success("Kaydınız başarılı! Yönetici onayı bekleniyor.");
    authTab.value = 'login';
    registerForm.value = { name: '', email: '', password: '', confirmPassword: '', class: '', number: '' };
  } catch (error) {
    if (error?.code === 'auth/email-already-in-use') {
      await showEmailInUseHelp(registerForm.value.email);
      return;
    }
    toast.error("Kayıt Hatası: " + error.message);
  }
};

const handleTeacherRegister = async () => {
  try {
    const { name, email, password, confirmPassword } = registerForm.value;
    const cleanEmail = normalizeEmailInput(email);

    if (!name || !cleanEmail || !password) {
      toast.warning("Tüm alanlar gerekli!");
      return;
    }

    if (password !== confirmPassword) {
      toast.warning("Şifreler eşleşmiyor!");
      return;
    }

    const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);

    try {
      await setDoc(doc(db, 'users', userCredential.user.uid), {
        name,
        email: cleanEmail,
        role: 'teacher',
        subjects: [],
        points: 0,
        isApproved: false,
        archived: false,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      await rollbackCreatedAuthUser(userCredential.user);
      throw error;
    }

    toast.success("Öğretmen kaydı başarılı! Yönetici onayı bekleniyor.");
    authTab.value = 'login';
    registerTab.value = 'student';
    registerForm.value = { name: '', email: '', password: '', confirmPassword: '', class: '', number: '' };
  } catch (error) {
    if (error?.code === 'auth/email-already-in-use') {
      await showEmailInUseHelp(registerForm.value.email);
      return;
    }
    toast.error("Kayıt Hatası: " + error.message);
  }
};

const handleLogout = async () => {
  try {
    await clearAdminAuthSession();
    await signOut(auth);
    currentUser.value = null;
  } catch (error) {
    toast.error("Çıkış hatası: " + error.message);
  }
};

const handleChangePassword = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const { currentPassword, newPassword, confirmPassword } = passwordForm.value;
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.warning("Tüm alanlar gerekli!");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.warning("Yeni şifreler eşleşmiyor!");
      return;
    }
    try {
      const credential = EmailAuthProvider.credential(user.email || '', currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      toast.success("Şifre güncellendi!");
      passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' };
      showPasswordModal.value = false;
    } catch (err) {
      toast.error("Şifre güncelleme hatası: " + (err.message || err));
    }
  } catch (error) {
    toast.error("Şifre güncelleme hatası: " + error.message);
  }
};

const handleAdminCreateStudent = async () => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    return;
  }
  try {
    const { name, email, password, class: studentClass, number } = adminStudentForm.value;
    const cleanEmail = normalizeEmailInput(email);
    if (!name || !cleanEmail || !password || !studentClass || !number) {
      toast.warning("Tüm alanlar gerekli!");
      return;
    }

    const result = await upsertManagedUserProfile({
      name,
      email: cleanEmail,
      password,
      role: 'student',
      studentClass,
      number,
      isApproved: true
    });

    const messages = {
      created: "✅ Öğrenci hesabı oluşturuldu ve onaylandı.",
      repaired: "✅ Auth hesabı zaten vardı; eksik öğrenci profili onarıldı ve onaylandı.",
      restored: "✅ Pasife alınmış öğrenci profili geri açıldı. Mevcut şifre geçerliliğini korur.",
      updated: "✅ Mevcut öğrenci profili güncellendi ve onaylı durumda tutuldu.",
      relinked: "✅ Yetim öğrenci kaydı temizlendi; hesap yeni kimlikle yeniden bağlandı."
    };

    toast.success(messages[result?.status] || "✅ Öğrenci hesabı hazır.");
    adminStudentForm.value = { name: '', email: '', password: '', class: '', number: '' };
  } catch (error) {
    toast.error("Admin kayıt hatası: " + functionErrorMessage(error, "Kullanıcı oluşturulamadı."));
  }
};

const downloadBulkTemplate = (role) => {
  const header = "ad_soyad,email,sinif,numara,sifre";
  const example = role === 'teacher'
    ? "Ayşe Öğretmen,ayse@okul.edu.tr,,,Sifre123"
    : "Ali Veli,ali@okul.edu.tr,10. Sınıf,1234,Sifre123";
  const csv = `${header}\n${example}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ADAB_${role}_sablon.csv`;
  a.click();
};


const normalizeHeader = (h) => {
  const key = String(h || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/[ı]/g, 'i')
    .replace(/[ş]/g, 's')
    .replace(/[ğ]/g, 'g')
    .replace(/[ü]/g, 'u')
    .replace(/[ö]/g, 'o')
    .replace(/[ç]/g, 'c');

  if (['ad soyad', 'adsoyad', 'isim soyisim', 'isim', 'name'].includes(key)) return 'name';
  if (['email', 'e posta', 'eposta', 'e mail', 'e-mail'].includes(key)) return 'email';
  if (['sinif', 'class', 'sınıf'].includes(key)) return 'class';
  if (['numara', 'no', 'number', 'okul numarasi', 'okul numarası'].includes(key)) return 'number';
  if (['sifre', 'password', 'parola', 'şifre'].includes(key)) return 'password';
  return '';
};

const parseDelimited = (text, delimiter) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(field);
      if (row.some(c => String(c || '').trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(c => String(c || '').trim() !== '')) rows.push(row);
  return rows;
};

const detectDelimiter = (line) => {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = (line.split(d).length - 1);
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
};

const rowsToUsers = (rows) => {
  if (!rows.length) return { users: [], errors: ['Dosya boş.'] };
  const headerRow = rows[0];
  const map = headerRow.map(normalizeHeader);
  if (!map.includes('name') || !map.includes('email') || !map.includes('password')) {
    return { users: [], errors: ['Başlıklar eksik. Gerekli: ad_soyad, email, sifre (sinif, numara opsiyonel).'] };
  }
  const users = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const data = {};
    for (let c = 0; c < map.length; c++) {
      const key = map[c];
      if (key) data[key] = String(r[c] ?? '').trim();
    }
    if (!data.name && !data.email && !data.password) continue;
    if (!data.name || !data.email || !data.password) {
      errors.push(`Satır ${i + 1}: Zorunlu alan eksik.`);
      continue;
    }
    data.email = normalizeEmailInput(data.email);
    data.rowNumber = i + 1;
    users.push(data);
  }
  return { users, errors };
};

const chunkItems = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const buildStudentNumberKey = (studentClass, number) => {
  const cleanClass = String(studentClass || '').trim().toLowerCase();
  const cleanNumber = String(number || '').trim();
  return `${cleanClass}::${cleanNumber}`;
};

const fetchProfilesByEmails = async (emails) => {
  const uniqueEmails = Array.from(new Set(emails.map(normalizeEmailInput).filter(Boolean)));
  const profileMap = new Map();
  if (!uniqueEmails.length) return profileMap;

  const chunks = chunkItems(uniqueEmails, 10);
  for (const chunk of chunks) {
    const snap = await getDocs(query(collection(db, 'users'), where('email', 'in', chunk)));
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      profileMap.set(normalizeEmailInput(data.email), { id: docSnap.id, ...data });
    });
  }

  return profileMap;
};

const buildBulkPreviewEntries = async (users, role) => {
  const duplicateEmailCounts = {};
  const duplicateStudentNumberCounts = {};
  const existingProfiles = await fetchProfilesByEmails(users.map(item => item.email));
  const activeStudentNumberOwners = new Map();

  students.value.forEach((student) => {
    const key = buildStudentNumberKey(student.class, student.number);
    if (key !== '::') {
      activeStudentNumberOwners.set(key, normalizeEmailInput(student.email));
    }
  });

  users.forEach((item) => {
    const email = normalizeEmailInput(item.email);
    duplicateEmailCounts[email] = (duplicateEmailCounts[email] || 0) + 1;

    if (role === 'student') {
      const key = buildStudentNumberKey(item.class, item.number);
      if (key !== '::') {
        duplicateStudentNumberCounts[key] = (duplicateStudentNumberCounts[key] || 0) + 1;
      }
    }
  });

  return users.map((item) => {
    const cleanName = String(item.name || '').trim();
    const cleanEmail = normalizeEmailInput(item.email);
    const cleanPassword = String(item.password || '').trim();
    const cleanClass = String(item.class || '').trim();
    const cleanNumber = String(item.number || '').trim();
    const existingProfile = existingProfiles.get(cleanEmail);
    const issues = [];
    const hints = [];
    let action = 'create';
    let actionLabel = 'Yeni hesap oluşturulacak';
    let tone = 'ready';

    if (cleanName.length < 3) {
      issues.push('Ad soyad en az 3 karakter olmalı.');
    }
    if (!SIMPLE_EMAIL_PATTERN.test(cleanEmail)) {
      issues.push('Geçerli bir e-posta adresi gerekli.');
    }
    if (cleanPassword.length < BULK_PASSWORD_MIN_LENGTH) {
      issues.push(`Şifre en az ${BULK_PASSWORD_MIN_LENGTH} karakter olmalı.`);
    }
    if (duplicateEmailCounts[cleanEmail] > 1) {
      issues.push('Bu e-posta dosya içinde birden fazla kez geçiyor.');
    }

    if (role === 'student') {
      if (!cleanClass) {
        issues.push('Öğrenci için sınıf zorunlu.');
      } else if (!schoolSettings.value.classes.includes(cleanClass)) {
        issues.push('Sınıf okul ayarlarında tanımlı değil.');
      }

      if (!cleanNumber) {
        issues.push('Öğrenci için okul numarası zorunlu.');
      }

      const studentNumberKey = buildStudentNumberKey(cleanClass, cleanNumber);
      if (studentNumberKey !== '::' && duplicateStudentNumberCounts[studentNumberKey] > 1) {
        issues.push('Bu sınıf ve numara dosya içinde birden fazla kez geçiyor.');
      }

      const numberOwnerEmail = activeStudentNumberOwners.get(studentNumberKey);
      if (studentNumberKey !== '::' && numberOwnerEmail && numberOwnerEmail !== cleanEmail) {
        issues.push('Bu sınıf ve numara başka bir aktif öğrenciye ait.');
      }
    }

    if (existingProfile) {
      if (existingProfile.role !== role) {
        issues.push(`Bu e-posta sistemde ${getRoleLabel(existingProfile.role).toLowerCase()} rolüne bağlı.`);
      } else if (existingProfile.archived) {
        action = 'restore';
        actionLabel = 'Arşivden geri açılacak';
        tone = 'warn';
      } else if (existingProfile.isApproved) {
        action = 'update';
        actionLabel = 'Mevcut hesap güncellenecek';
        tone = 'info';
      } else {
        action = 'update';
        actionLabel = 'Mevcut hesap onaylanacak';
        tone = 'info';
      }

      if (role === 'student' && existingProfile.role === 'student') {
        if (cleanClass && existingProfile.class && cleanClass !== String(existingProfile.class).trim()) {
          hints.push(`Mevcut sınıf: ${existingProfile.class}`);
        }
        if (cleanNumber && existingProfile.number && cleanNumber !== String(existingProfile.number).trim()) {
          hints.push(`Mevcut numara: ${existingProfile.number}`);
        }
      }
    }

    if (issues.length) {
      action = 'blocked';
      actionLabel = 'İçe aktarım engelli';
      tone = 'error';
    }

    return {
      ...item,
      email: cleanEmail,
      class: cleanClass,
      number: cleanNumber,
      role,
      action,
      actionLabel,
      tone,
      issues,
      hints,
      actionable: issues.length === 0
    };
  });
};

const handleBulkImport = async (e, role) => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    e.target.value = '';
    return;
  }
  if (bulkImporting.value) return;
  const file = e.target.files?.[0];
  if (!file) return;
  bulkImporting.value = true;
  bulkReport.value = createEmptyBulkReport();
  bulkPending.value = [];
  try {
    let rows = [];
    const text = await file.text();
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delimiter = detectDelimiter(firstLine);
    rows = parseDelimited(text, delimiter);

    const { users, errors } = rowsToUsers(rows);
    if (!users.length && !errors.length) {
      bulkReport.value = { ...createEmptyBulkReport(), errors: ['Dosyada işlenecek satır bulunamadı.'] };
      bulkImporting.value = false;
      e.target.value = '';
      return;
    }

    if (!users.length) {
      bulkReport.value = { ...createEmptyBulkReport(), errors };
      bulkImporting.value = false;
      e.target.value = '';
      return;
    }

    bulkPending.value = await buildBulkPreviewEntries(users, role);
    bulkReport.value = { ...createEmptyBulkReport(), errors };
  } catch (error) {
    const msg = error.message || error;
    bulkReport.value = { ...createEmptyBulkReport(), errors: [msg] };
    systemErrors.value.unshift("Toplu aktarım hatası: " + msg);
  } finally {
    bulkImporting.value = false;
    e.target.value = '';
  }
};

const runBulkImport = async () => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    return;
  }
  if (!bulkPending.value.length) return;
  const actionableEntries = bulkPending.value.filter(entry => entry.actionable);
  const blockedEntries = bulkPending.value.filter(entry => !entry.actionable);
  if (!actionableEntries.length) {
    toast.warning("İçe aktarılabilecek kayıt yok. Önce hatalı satırları düzeltin.");
    return;
  }
  const confirmMessage = blockedEntries.length
    ? `${actionableEntries.length} kayıt işlenecek, ${blockedEntries.length} kayıt atlanacak. Devam edilsin mi?`
    : `${actionableEntries.length} kullanıcı oluşturulacak/güncellenecek. Devam edilsin mi?`;
  if (!confirm(confirmMessage)) return;
  bulkImporting.value = true;
  try {
    let ok = 0;
    let fail = 0;
    let repaired = 0;
    const failList = [];
    const role = actionableEntries[0]?.role || bulkRole.value;
    const nextPending = [...blockedEntries];

    for (const entry of actionableEntries) {
      try {
        const result = await upsertManagedUserProfile({
          name: entry.name,
          email: entry.email,
          password: entry.password,
          role,
          studentClass: entry.class,
          number: entry.number,
          isApproved: true
        });
        ok++;
        if (result?.status && result.status !== 'created') repaired++;
      } catch (error) {
        fail++;
        const message = functionErrorMessage(error, 'Bilinmeyen hata.');
        failList.push(`${entry?.email || 'E-posta yok'}: ${message}`);
        nextPending.push({
          ...entry,
          action: 'blocked',
          actionLabel: 'İçe aktarım sırasında hata aldı',
          tone: 'error',
          actionable: false,
          issues: Array.from(new Set([...(entry.issues || []), message]))
        });
      }
    }

    bulkReport.value = {
      ok,
      fail,
      repaired,
      errors: bulkReport.value.errors,
      failures: failList
    };
    bulkPending.value = nextPending;
    toast.success(
      fail
        ? `Toplu kayıt tamamlandı. Başarılı: ${ok}, onarılan: ${repaired}, hatalı: ${fail}.`
        : `Toplu kayıt tamamlandı. Başarılı: ${ok}, onarılan: ${repaired}.`
    );
  } catch (error) {
    const msg = functionErrorMessage(error, "Toplu kayıt tamamlanamadı.");
    bulkReport.value = { ...bulkReport.value, fail: bulkPending.value.length, failures: [msg] };
    systemErrors.value.unshift("Toplu kayıt hatası: " + msg);
    toast.error(msg);
  } finally {
    bulkImporting.value = false;
  }
};

// --- 📦 YEDEKLEME ---
const downloadJSONBackup = () => {
  if (!isLeadershipUser()) {
    toast.warning("Bu işlem için yönetici yetkisi gerekir.");
    return;
  }
  const data = {
    settings: schoolSettings.value,
    teacherNotifications: teacherNotificationSettings.value,
    moderationLogs: moderationLogs.value,
    questions: questions.value,
    users: students.value,
    teachers: teachers.value,
    date: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ADAB_Yedek.json`; a.click();
};

const handleLogoUpload = (e) => {
  if (!isLeadershipUser()) {
    toast.warning("Bu işlem için yönetici yetkisi gerekir.");
    e.target.value = '';
    return;
  }
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast.warning("Lütfen bir görsel dosyası seçin.");
    e.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (evt) => {
    const dataUrl = evt.target?.result;
    if (typeof dataUrl === 'string') {
      schoolSettings.value.logo = dataUrl;
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

const handleRestoreJSON = async (e) => {
  if (!canEditCriticalSettings()) {
    toast.warning("Bu işlem için admin yetkisi gerekir.");
    e.target.value = '';
    return;
  }
  const file = e.target.files[0];
  if (!file || !confirm("Yedek yüklenecek. Emin misiniz?")) return;
  const reader = new FileReader();
  reader.onload = async (f) => {
    try {
      const data = JSON.parse(f.target.result);
      if (data.settings) { 
        const mergedSettings = mergeSettingsWithDefaults(data.settings);
        schoolSettings.value = mergedSettings;
        await setDoc(doc(db, "settings", "school_info"), mergedSettings);
      }
      if (data.teacherNotifications) {
        const mergedNotifications = mergeTeacherApprovalEmailSettings(data.teacherNotifications);
        teacherNotificationSettings.value = mergedNotifications;
        await setDoc(doc(db, "private_settings", "teacher_notifications"), mergedNotifications);
      }
      toast.success("Yedek Yüklendi! Sayfa yenileniyor..."); 
      window.location.reload();
    } catch (err) { 
      toast.error("Hata: " + err.message); 
    }
  };
  reader.readAsText(file);
};

// --- 💾 KAYDET ---
const saveAll = async () => { 
  try {
    const role = currentUser.value?.role;
    if (!isLeadershipRole(role)) {
      toast.warning("Bu işlem için yetkiniz yok.");
      return;
    }
    await setDoc(doc(db, "settings", "school_info"), schoolSettings.value); 
    if (isLeadershipRole(role)) {
      await saveTeacherNotificationSettings();
    }
    toast.success("Ayarlar Mühürlendi!"); 
    showSettingsModal.value = false; 
    showDesignModal.value = false; 
  } catch (error) {
    const msg = "Kaydetme hatası: " + (error.message || error);
    systemErrors.value.unshift(msg);
    toast.error(msg);
  }
};

const saveSubjectsClasses = async () => {
  try {
    const role = currentUser.value?.role;
    if (!isLeadershipRole(role)) {
      toast.warning("Bu işlem için yetkiniz yok.");
      return;
    }
    await setDoc(doc(db, "settings", "school_info"), {
      subjects: [...schoolSettings.value.subjects],
      classes: [...schoolSettings.value.classes]
    }, { merge: true });
    toast.success("Ders/Sınıf güncellendi!");
    showTeacherSettingsModal.value = false;
  } catch (error) {
    const msg = "Kaydetme hatası: " + (error.message || error);
    systemErrors.value.unshift(msg);
    toast.error(msg);
  }
};

const reloadSettingsFromServer = async () => {
  try {
    await loadSettings();
    if (currentUser.value) {
      await loadTeacherNotificationSettings();
    }
    toast.success("Son kaydedilen ayarlar yüklendi.");
  } catch (error) {
    const msg = "Ayarlar yüklenemedi: " + (error.message || error);
    systemErrors.value.unshift(msg);
    toast.error(msg);
  }
};

const createSnapshot = async () => { 
  if (!canEditCriticalSettings()) {
    toast.warning("Bu işlem için admin yetkisi gerekir.");
    return;
  }
  await setDoc(doc(db, "settings", "safe_snapshot"), schoolSettings.value); 
  await setDoc(doc(db, "private_settings", "teacher_notifications_snapshot"), mergeTeacherApprovalEmailSettings(teacherNotificationSettings.value));
  toast.success("⚓ Snapshot Alındı!"); 
};

const restoreSnapshot = async () => { 
  if (!canEditCriticalSettings()) {
    toast.warning("Bu işlem için admin yetkisi gerekir.");
    return;
  }
  const snap = await getDoc(doc(db, "settings", "safe_snapshot"));
  const notificationSnap = await getDoc(doc(db, "private_settings", "teacher_notifications_snapshot"));
  if (snap.exists()) {
    schoolSettings.value = mergeSettingsWithDefaults(snap.data());
    if (notificationSnap.exists()) {
      teacherNotificationSettings.value = mergeTeacherApprovalEmailSettings(notificationSnap.data() || {});
    }
    await saveAll();
    window.location.reload();
  }
};

// --- ONAY İŞLEMLERİ ---
const likeQuestion = async (q) => {
  if (!currentUser.value) {
    showAuthModal.value = true;
    return;
  }
  if (!q?.isApproved) {
    toast.info("Sadece onaylı sorular beğenilebilir.");
    return;
  }
  if (hasLikedQuestion(q.id)) {
    toast.info("Bu soruyu zaten beğendiniz.");
    return;
  }

  const reactionId = buildReactionDocId(q.id, currentUser.value.id);
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "question_likes", reactionId), {
      questionId: q.id,
      userId: currentUser.value.id,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, "questions", q.id), { likes: increment(1) });
    await batch.commit();
  } catch (error) {
    toast.error(functionErrorMessage(error, "Beğeni kaydedilemedi."));
  }
};

const onayIslem = async (qData, tip) => {
  if (!canModerateQuestion(qData)) {
    toast.warning("Bu soru üzerinde işlem yapma yetkiniz yok.");
    return;
  }
  const questionRef = doc(db, "questions", qData.id);

  if (tip === 'soru') {
    const batch = writeBatch(db);
    batch.update(questionRef, buildQuestionModerationFields('approved'));
    if (qData.senderId) {
      batch.update(doc(db, "users", qData.senderId), { points: increment(10) });
    }
    addModerationLogToBatch(batch, {
      action: 'approve_question',
      targetType: 'question',
      targetId: qData.id,
      targetLabel: `${qData.subject} | ${(qData.content || '').slice(0, 80)}`,
      subject: qData.subject,
      classLevel: qData.classLevel
    });
    addInboxNotificationToBatch(batch, {
      recipientId: qData.senderId,
      type: 'question-approved',
      title: 'Sorunuz onaylandı',
      message: `${qData.subject} dersindeki sorunuz yayına alındı.`,
      relatedId: qData.id
    });
    await batch.commit();
    return;
  }

  if (tip === 'cevap') {
    const batch = writeBatch(db);
    batch.update(questionRef, buildAnswerModerationFields('approved'));
    if (qData.respId) {
      batch.update(doc(db, "users", qData.respId), { points: increment(20) });
    }
    addModerationLogToBatch(batch, {
      action: 'approve_answer',
      targetType: 'answer',
      targetId: qData.id,
      targetLabel: `${qData.subject} | ${(qData.cevap || '').slice(0, 80)}`,
      subject: qData.subject,
      classLevel: qData.classLevel
    });
    addInboxNotificationToBatch(batch, {
      recipientId: qData.respId,
      type: 'answer-approved',
      title: 'Cevabınız onaylandı',
      message: `${qData.subject} dersindeki cevabınız onaylandı.`,
      relatedId: qData.id
    });
    await batch.commit();
    return;
  }

  if (tip === 'sil') {
    openModerationDialog({
      title: 'Soruyu Reddet',
      message: 'Soru silinmeyecek; red nedeni ile birlikte kaydedilecek ve sadece sahibi ile moderatörler görecek.',
      confirmLabel: 'Soruyu Reddet',
      reasonLabel: 'Red nedeni',
      reasonPlaceholder: 'Örn. Aynı soru daha önce cevaplandı / ders dışı / eksik ifade',
      onConfirm: async (reason) => {
        const batch = writeBatch(db);
        batch.update(questionRef, buildQuestionModerationFields('rejected', reason));
        addModerationLogToBatch(batch, {
          action: 'reject_question',
          targetType: 'question',
          targetId: qData.id,
          targetLabel: `${qData.subject} | ${(qData.content || '').slice(0, 80)}`,
          subject: qData.subject,
          classLevel: qData.classLevel,
          reason
        });
        addInboxNotificationToBatch(batch, {
          recipientId: qData.senderId,
          type: 'question-rejected',
          title: 'Sorunuz reddedildi',
          message: `${qData.subject} dersindeki sorunuz reddedildi.`,
          relatedId: qData.id,
          reason
        });
        await batch.commit();
      }
    });
  }
};

const startEditQuestion = (q) => {
  editingQuestionId.value = q.id;
  editQuestionText.value[q.id] = q.content || '';
};

const saveEditQuestion = async (q) => {
  const text = (editQuestionText.value[q.id] || '').trim();
  if (text.length < 5) {
    toast.warning("Soru en az 5 karakter olmalı.");
    return;
  }
  if (q.senderId === currentUser.value?.id && q.isRejected) {
    const batch = writeBatch(db);
    batch.update(doc(db, "questions", q.id), {
      content: text,
      isRejected: false,
      moderationStatus: 'pending',
      rejectionReason: null,
      rejectedAt: null,
      rejectedById: null,
      rejectedByName: null,
      rejectedByRole: null
    });
    addModerationLogToBatch(batch, {
      action: 'resubmit_question',
      targetType: 'question',
      targetId: q.id,
      targetLabel: `${q.subject} | ${(text || '').slice(0, 80)}`,
      subject: q.subject,
      classLevel: q.classLevel,
      details: 'Öğrenci soruyu düzenleyip yeniden değerlendirmeye gönderdi.'
    });
    await batch.commit();
    editingQuestionId.value = null;
    return;
  }
  await updateDoc(doc(db, "questions", q.id), { content: text });
  editingQuestionId.value = null;
};

const startEditAnswer = (q) => {
  editingAnswerId.value = q.id;
  editAnswerText.value[q.id] = q.cevap || '';
};

const saveEditAnswer = async (q) => {
  const text = (editAnswerText.value[q.id] || '').trim();
  if (text.length < 10) {
    toast.warning("Cevap en az 10 karakter olmalı.");
    return;
  }
  await updateDoc(doc(db, "questions", q.id), { cevap: text });
  editingAnswerId.value = null;
};

const rejectAnswer = async (q) => {
  openModerationDialog({
    title: 'Cevabı Reddet',
    message: 'Cevap yayından kaldırılacak ve işlem geçmişine neden kaydedilecek.',
    confirmLabel: 'Cevabı Reddet',
    reasonLabel: 'Red nedeni',
    reasonPlaceholder: 'Örn. Eksik, yanlış veya uygunsuz cevap',
    onConfirm: async (reason) => {
      const batch = writeBatch(db);
      batch.update(doc(db, "questions", q.id), buildAnswerModerationFields('rejected', reason));
      addModerationLogToBatch(batch, {
        action: 'reject_answer',
        targetType: 'answer',
        targetId: q.id,
        targetLabel: `${q.subject} | ${(q.cevap || '').slice(0, 80)}`,
        subject: q.subject,
        classLevel: q.classLevel,
        reason
      });
      addInboxNotificationToBatch(batch, {
        recipientId: q.respId,
        type: 'answer-rejected',
        title: 'Cevabınız reddedildi',
        message: `${q.subject} dersindeki cevabınız reddedildi.`,
        relatedId: q.id,
        reason
      });
      await batch.commit();
    }
  });
};

const handleSendAnswer = async (q) => {
  const text = (answerText.value[q.id] || '').trim();
  if (text.length < 10) {
    toast.warning("Cevap en az 10 karakter olmalı.");
    return;
  }
  await updateDoc(doc(db,'questions',q.id),{
    cevap: text,
    respondent: currentUser.value.name,
    respId: currentUser.value.id,
    respRole: currentUser.value.role,
    answerApproved: false,
    answerModerationStatus: 'pending'
  });
  answerText.value[q.id] = '';
};

const acceptAnswer = async (q) => {
  if (q.answerAccepted) return;
  const note = String(learnNoteDrafts.value[q.id] || '').trim().slice(0, 300);
  const payload = { answerAccepted: true, acceptedAt: serverTimestamp() };
  if (note) payload.learnedNote = note;
  try {
    await updateDoc(doc(db, "questions", q.id), payload);
    delete learnNoteDrafts.value[q.id];
    toast.success(note ? 'Çözüm kabul edildi. Öğrenme notun kaydedildi.' : 'Çözüm kabul edildi.');
  } catch (error) {
    toast.error(functionErrorMessage(error, 'Çözüm kabul edilemedi.'));
  }
};

const thankAnswer = async (q) => {
  if (!currentUser.value) {
    showAuthModal.value = true;
    return;
  }
  if (!q?.answerApproved) {
    toast.info("Sadece onaylı cevaplar için teşekkür gönderebilirsiniz.");
    return;
  }
  if (hasThankedAnswer(q.id)) {
    toast.info("Bu cevaba zaten teşekkür ettiniz.");
    return;
  }

  const reactionId = buildReactionDocId(q.id, currentUser.value.id);
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "answer_thanks", reactionId), {
      questionId: q.id,
      userId: currentUser.value.id,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, "questions", q.id), { answerThanks: increment(1) });
    await batch.commit();
  } catch (error) {
    toast.error(functionErrorMessage(error, "Teşekkür kaydedilemedi."));
  }
};

const handleCreateQuestion = async () => {
  if (!currentUser.value) {
    showAuthModal.value = true;
    return;
  }
  if (!currentUser.value.isApproved) {
    toast.warning("Hesabınız onaylanmadan soru gönderemezsiniz.");
    return;
  }

  const payload = {
    subject: String(newQuestion.value.subject || '').trim(),
    classLevel: String(newQuestion.value.classLevel || '').trim(),
    content: String(newQuestion.value.content || '').trim(),
    topicTag: normalizeTopicTag(newQuestion.value.topicTag || topicTagCustom.value)
  };
  if (!payload.subject || !payload.classLevel || payload.content.length < 5) {
    toast.warning("Ders, sınıf ve en az 5 karakterlik soru gerekli.");
    return;
  }

  try {
    const questionDoc = {
      sender: currentUser.value.name,
      senderId: currentUser.value.id,
      senderRole: currentUser.value.role,
      subject: payload.subject,
      classLevel: payload.classLevel,
      content: payload.content,
      isApproved: false,
      isRejected: false,
      moderationStatus: 'pending',
      likes: 0,
      created_at: serverTimestamp()
    };
    if (payload.topicTag) questionDoc.topicTag = payload.topicTag;
    if (currentUser.value.class) {
      questionDoc.senderClass = currentUser.value.class;
    }

    const questionRef = await addDoc(collection(db, 'questions'), questionDoc);
    void notifyTeachersAboutPendingQuestion({
      id: questionRef.id,
      ...questionDoc,
      created_at: new Date()
    });

    showAskModal.value = false;
    newQuestion.value = { subject: '', classLevel: '', content: '', topicTag: '' };
    topicTagCustom.value = '';
    similarQuestionFound.value = null;
    similarQuestions.value = [];
  } catch (error) {
    toast.error("Soru gönderilemedi: " + (error.message || error));
  }
};

// --- ÖĞRENCİ AYARLARI ---
const deleteStudent = async (studentId) => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    return;
  }
  const student = students.value.find(item => item.id === studentId);
  if (!student) {
    toast.warning("Öğrenci bulunamadı.");
    return;
  }
  openModerationDialog({
    title: 'Öğrenciyi Pasife Al',
    message: `${student.name} hesabı pasife alınacak. Giriş yapamaz ve onaysız duruma düşer.`,
    confirmLabel: 'Pasife Al',
    reasonLabel: 'Pasife alma nedeni',
    reasonPlaceholder: 'Örn. Mezun oldu / yanlış kayıt / yönetim kararı',
    onConfirm: async (reason) => {
      const batch = writeBatch(db);
      batch.update(doc(db, "users", studentId), buildUserModerationFields('archived', reason));
      addModerationLogToBatch(batch, {
        action: 'archive_student',
        targetType: 'user',
        targetId: studentId,
        targetLabel: `${student.name} (${student.class || '-'})`,
        classLevel: student.class,
        reason
      });
      addInboxNotificationToBatch(batch, {
        recipientId: studentId,
        type: 'account-archived',
        title: 'Öğrenci hesabınız pasife alındı',
        message: 'Hesabınız pasif duruma alındı.',
        relatedId: studentId,
        reason
      });
      await batch.commit();
      toast.success("Öğrenci hesabı pasife alındı.");
    }
  });
};

// --- DERS AYARLARI ---
const addSubject = () => {
  if (newSubject.value.trim()) {
    if (!schoolSettings.value.subjects.includes(newSubject.value)) {
      schoolSettings.value.subjects.push(newSubject.value);
      newSubject.value = '';
    } else {
      toast.info("Bu ders zaten var!");
    }
  }
};

const deleteSubject = (index) => {
  if (confirm("Dersi silmek istediğinizden emin misiniz?")) {
    schoolSettings.value.subjects.splice(index, 1);
  }
};

const addClass = () => {
  if (newClass.value.trim()) {
    if (!schoolSettings.value.classes.includes(newClass.value)) {
      schoolSettings.value.classes.push(newClass.value);
      newClass.value = '';
    } else {
      toast.info("Bu sınıf zaten var!");
    }
  }
};

const deleteClass = (index) => {
  if (confirm("Sınıfı silmek istediğinizden emin misiniz?")) {
    schoolSettings.value.classes.splice(index, 1);
  }
};

// --- ÖĞRETMENLERİ ONAYLA ---
const approveStudent = async (studentId) => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    return;
  }
  try {
    const student = students.value.find(item => item.id === studentId);
    const batch = writeBatch(db);
    batch.update(doc(db, "users", studentId), buildUserModerationFields('approved'));
    addModerationLogToBatch(batch, {
      action: 'approve_student',
      targetType: 'user',
      targetId: studentId,
      targetLabel: student ? `${student.name} (${student.class || '-'})` : studentId,
      classLevel: student?.class || ''
    });
    addInboxNotificationToBatch(batch, {
      recipientId: studentId,
      type: 'account-approved',
      title: 'Öğrenci hesabınız onaylandı',
      message: 'Artık giriş yapabilir ve soru gönderebilirsiniz.',
      relatedId: studentId
    });
    await batch.commit();
    toast.success("Öğrenci onaylandı!");
  } catch (error) {
    const msg = functionErrorMessage(error, "Öğrenci onaylanamadı.");
    pushSystemError(msg);
    toast.error(msg);
  }
};

const approveTeacher = async (teacherId) => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    return;
  }
  try {
    const teacher = teachers.value.find(item => item.id === teacherId);
    const batch = writeBatch(db);
    batch.update(doc(db, "users", teacherId), buildUserModerationFields('approved'));
    addModerationLogToBatch(batch, {
      action: 'approve_teacher',
      targetType: 'user',
      targetId: teacherId,
      targetLabel: teacher ? `${teacher.name} (${teacher.email || '-'})` : teacherId
    });
    addInboxNotificationToBatch(batch, {
      recipientId: teacherId,
      type: 'account-approved',
      title: 'Öğretmen hesabınız onaylandı',
      message: 'Artık öğretmen yetkileriyle sisteme giriş yapabilirsiniz.',
      relatedId: teacherId
    });
    await batch.commit();
    toast.success("Öğretmen onaylandı!");
  } catch (error) {
    const msg = functionErrorMessage(error, "Öğretmen onaylanamadı.");
    pushSystemError(msg);
    toast.error(msg);
  }
};

const rejectTeacher = async (teacherId) => {
  if (!canManageUsers()) {
    toast.warning("Bu işlem için yonetici yetkisi gerekir.");
    return;
  }
  const teacher = teachers.value.find(item => item.id === teacherId);
  if (!teacher) {
    toast.warning("Öğretmen bulunamadı.");
    return;
  }
  openModerationDialog({
    title: 'Öğretmeni Pasife Al',
    message: `${teacher.name} hesabı pasife alınacak.`,
    confirmLabel: 'Pasife Al',
    reasonLabel: 'Pasife alma nedeni',
    reasonPlaceholder: 'Örn. Yetki kaldırıldı / yanlış kayıt',
    onConfirm: async (reason) => {
      const batch = writeBatch(db);
      batch.update(doc(db, "users", teacherId), buildUserModerationFields('archived', reason));
      addModerationLogToBatch(batch, {
        action: 'archive_teacher',
        targetType: 'user',
        targetId: teacherId,
        targetLabel: `${teacher.name} (${teacher.email || '-'})`,
        reason
      });
      addInboxNotificationToBatch(batch, {
        recipientId: teacherId,
        type: 'account-archived',
        title: 'Öğretmen hesabınız pasife alındı',
        message: 'Hesabınız pasif duruma alındı.',
        relatedId: teacherId,
        reason
      });
      await batch.commit();
      toast.error("Hesap pasife alındı.");
    }
  });
};

// --- 🧠 AI VERİ SETI İHRACATI ---
const downloadNotebook = () => {
  if (!isLeadershipUser()) {
    toast.warning("Bu işlem için yönetici yetkisi gerekir.");
    return;
  }
  const approved = questions.value.filter(q => q.isApproved);
  const aiData = {
    meta: {
      project: "ADAB - Taşköprü AIHL",
      description: "Bu veri seti, öğrencilerin akademik sorularını ve verilen cevapları içerir.",
      instruction: "Sen bir eğitim asistanısın. Aşağıdaki Soru-Cevap verilerini kullanarak öğrencilerin eksik olduğu konuları analiz et ve özet çıkar."
    },
    data: approved.map(q => ({
      ders: q.subject,
      seviye: q.classLevel,
      konu: q.topicTag || '',
      soru: q.content,
      cevap: q.cevap || "Henüz cevaplanmamış",
      ogrenme_notu: q.learnedNote || '',
      begeni: q.likes || 0
    }))
  };
  const blob = new Blob([JSON.stringify(aiData, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ADAB_AI_Dataset.json"; a.click();
};

// --- 📊 CSV RAPOR İHRACATI ---
const exportStatsCSV = () => {
  if (!isLeadershipUser()) { toast.warning("Bu işlem için yönetici yetkisi gerekir."); return; }
  const rows = [
    ['Ders', 'Konu', 'Sınıf', 'Soran', 'Durum', 'Tarih', 'Cevap Süresi(sa)', 'Öğrenme Notu'].join(';')
  ];
  statsQuestions.value.forEach(q => {
    const created = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    const accepted = q.acceptedAt?.toDate ? q.acceptedAt.toDate().getTime() : 0;
    const respHours = (created && accepted && accepted > created)
      ? ((accepted - created) / 3600000).toFixed(1)
      : '';
    rows.push([
      q.subject || '',
      q.topicTag || '',
      q.classLevel || '',
      q.sender || '',
      q.isApproved ? 'Onaylı' : 'Beklemede',
      q.created_at?.toDate ? q.created_at.toDate().toLocaleDateString('tr-TR') : '',
      respHours,
      (q.learnedNote || '').replace(/;/g, ',')
    ].join(';'));
  });
  const bom = '\uFEFF';
  const blob = new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `adab_rapor_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('CSV raporu indirildi.');
};

// --- 📄 PDF RAPOR ---
const exportStatsPDF = () => {
  if (!isLeadershipUser()) { toast.warning("Bu işlem için yönetici yetkisi gerekir."); return; }
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  const date = new Date().toLocaleDateString('tr-TR');
  const name = schoolSettings.value?.name || 'ADAB';
  const ws = weeklySummary.value;
  const pc = periodComparison.value;
  const aw = approvalWaitTime.value;
  const rt = avgResponseTime.value;
  const qq = questionQuality.value;
  
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ADAB Rapor - ${date}</title>
  <style>body{font-family:system-ui,sans-serif;padding:30px;color:#1e293b;max-width:800px;margin:0 auto}
  h1{color:${accent};border-bottom:3px solid ${accent};padding-bottom:8px}
  h2{color:${accent};margin-top:24px;font-size:1.1rem}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:10px 0}
  .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
  .card b{font-size:1.4rem;display:block;color:${accent}}
  .card small{color:#64748b}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:0.85rem}
  th{background:${accent};color:#fff;padding:6px 8px;text-align:left}
  td{padding:5px 8px;border-bottom:1px solid #e2e8f0}
  tr:nth-child(even){background:#f8fafc}
  .arrow-up{color:#16a085} .arrow-down{color:#ef4444}
  @media print{body{padding:10px}}</style></head><body>`;
  
  html += `<h1>📈 ${name} - Akademik Rapor</h1><p>Rapor Tarihi: ${date} | Dönem: Son ${pc.days} gün</p>`;
  
  // Haftalık özet
  html += `<h2>📅 Haftalık Özet</h2><div class="grid">
    <div class="card"><b>${ws.questions.current}</b><small>Bu Hafta Soru</small><br><small class="${ws.questions.current >= ws.questions.previous ? 'arrow-up' : 'arrow-down'}">${ws.questions.current >= ws.questions.previous ? '▲' : '▼'} Önceki: ${ws.questions.previous}</small></div>
    <div class="card"><b>${ws.answered.current}</b><small>Cevaplanan</small><br><small class="${ws.answered.current >= ws.answered.previous ? 'arrow-up' : 'arrow-down'}">${ws.answered.current >= ws.answered.previous ? '▲' : '▼'} Önceki: ${ws.answered.previous}</small></div>
    <div class="card"><b>${ws.approved.current}</b><small>Onaylanan</small><br><small class="${ws.approved.current >= ws.approved.previous ? 'arrow-up' : 'arrow-down'}">${ws.approved.current >= ws.approved.previous ? '▲' : '▼'} Önceki: ${ws.approved.previous}</small></div>
  </div>`;
  
  // KPI'lar
  html += `<h2>📊 Temel Metrikler</h2><div class="grid">
    <div class="card"><b>${statsQuestions.value.length}</b><small>Toplam Soru</small></div>
    <div class="card"><b>${statsApproved.value.length}</b><small>Onaylı</small></div>
    <div class="card"><b>${statsPending.value.length}</b><small>Beklemede</small></div>
    <div class="card"><b>${goalPercent.value}%</b><small>Hedef İlerleme</small></div>
    <div class="card"><b>${rt.count ? rt.avg + 'sa' : '-'}</b><small>Ort. Yanıt Süresi</small></div>
    <div class="card"><b>${aw.count ? aw.avg + 'sa' : '-'}</b><small>Ort. Onay Bekleme</small></div>
  </div>`;
  
  // Dönem karşılaştırma
  html += `<h2>📅 Dönem Karşılaştırma</h2><p>Bu dönem: <b>${pc.current}</b> | Önceki: <b>${pc.previous}</b> | Fark: <span class="${pc.diff >= 0 ? 'arrow-up' : 'arrow-down'}">${pc.diff >= 0 ? '▲' : '▼'} ${Math.abs(pc.diff)} (${pc.pct >= 0 ? '+' : ''}${pc.pct}%)</span></p>`;
  
  // Top tablolar
  const renderTable = (title, headers, rows) => {
    html += `<h2>${title}</h2><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;
    rows.forEach(r => { html += `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`; });
    html += `</tbody></table>`;
  };
  renderTable('📘 Top Dersler', ['#', 'Ders', 'Adet'], topSubjects.value.map((s, i) => [i + 1, s[0], s[1]]));
  renderTable('🏷️ Sık Konular', ['#', 'Ders', 'Konu', 'Adet', 'Cevapsız'], frequentTopics.value.map((t, i) => [i + 1, t.subject, t.topic, t.count, t.unanswered]));
  renderTable('🏫 Top Sınıflar', ['#', 'Sınıf', 'Adet'], topClasses.value.map((s, i) => [i + 1, s[0], s[1]]));
  renderTable('👤 Top Soru Soran', ['#', 'Öğrenci', 'Adet'], topAskers.value.map((s, i) => [i + 1, s[0], s[1]]));
  renderTable('🌟 Katkı İndeksi', ['#', 'Öğrenci', 'İndeks', 'Rozet'], contributionLeaders.value.map((s, i) => [i + 1, s.name, s.index, s.badge]));
  renderTable('👨‍🏫 Top Cevaplayan', ['#', 'Öğretmen', 'Adet'], topResponders.value.map((s, i) => [i + 1, s[0], s[1]]));
  if (anonymousTopicInsights.value.length) {
    renderTable('🔬 Anonim Konu Eğilimi (1. yarı → 2. yarı)', ['Konu', 'İlk', 'Son', 'Δ'],
      anonymousTopicInsights.value.map((t) => [t.topic, t.firstHalf, t.secondHalf, (t.delta >= 0 ? '+' : '') + t.delta]));
  }
  
  // Ders yanıt süreleri
  if (subjectResponseTime.value.length) {
    renderTable('⏱️ Ders Bazlı Yanıt Süreleri', ['Ders', 'Ort. Süre (sa)', 'Cevap Sayısı'], 
      subjectResponseTime.value.map(s => [s.subject, s.avg, s.count]));
  }
  
  // Sınıf katılım
  if (classParticipation.value.length) {
    renderTable('🏫 Sınıf Katılım Oranları', ['Sınıf', 'Toplam', 'Aktif', 'Oran'],
      classParticipation.value.map(c => [c.cls, c.totalStudents, c.activeStudents, c.rate + '%']));
  }
  
  // Soru kalitesi
  html += `<h2>📝 Soru Kalitesi</h2><p>Ort. soru uzunluğu: <b>${qq.avgLength}</b> karakter | En çok beğeni: <b>${qq.maxLikes}</b></p>`;
  
  // Öğrenci aktivite
  if (studentActivity.value.length) {
    renderTable('🌟 Öğrenci Aktivite Skoru', ['#', 'Öğrenci', 'Sınıf', 'Soru', 'Beğeni', 'Skor'],
      studentActivity.value.map((s, i) => [i + 1, s.name, s.cls, s.questions, s.likes, s.score]));
  }
  
  html += `<hr><p style="text-align:center;color:#94a3b8;font-size:0.8rem">Bu rapor ${name} ADAB sistemi tarafından otomatik oluşturulmuştur.</p></body></html>`;
  
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }
  toast.success('PDF raporu hazırlandı — yazdır diyalogu açılacak.');
};

let unsubscribeQuestions = null;
let unsubscribeOwnQuestions = null;
let unsubscribeStudents = null;
let unsubscribeTeachers = null;
let unsubscribeSettings = null;
let unsubscribeTeacherNotifications = null;
let unsubscribeModerationLogs = null;
let unsubscribeQuestionLikes = null;
let unsubscribeAnswerThanks = null;
let unsubscribeInboxNotifications = null;
let unsubscribeAuth = null;
let clockTimer = null;
let settingsSnapshotInitialized = false;
let teacherNotificationSnapshotInitialized = false;

const stopStaffListeners = () => {
  if (unsubscribeStudents) {
    unsubscribeStudents();
    unsubscribeStudents = null;
  }
  if (unsubscribeTeachers) {
    unsubscribeTeachers();
    unsubscribeTeachers = null;
  }
  students.value = [];
  teachers.value = [];
};

const stopOwnQuestionsListener = () => {
  if (unsubscribeOwnQuestions) {
    unsubscribeOwnQuestions();
    unsubscribeOwnQuestions = null;
  }
  ownQuestionFeed.value = [];
  syncQuestionState();
};

const stopModerationLogsListener = () => {
  if (unsubscribeModerationLogs) {
    unsubscribeModerationLogs();
    unsubscribeModerationLogs = null;
  }
  moderationLogs.value = [];
};

const stopEngagementListeners = () => {
  if (unsubscribeQuestionLikes) {
    unsubscribeQuestionLikes();
    unsubscribeQuestionLikes = null;
  }
  if (unsubscribeAnswerThanks) {
    unsubscribeAnswerThanks();
    unsubscribeAnswerThanks = null;
  }
  likedQuestionIds.value = [];
  thankedAnswerQuestionIds.value = [];
};

const stopInboxNotificationsListener = () => {
  if (unsubscribeInboxNotifications) {
    unsubscribeInboxNotifications();
    unsubscribeInboxNotifications = null;
  }
  inboxNotifications.value = [];
};

const refreshQuestionNotifications = () => {
  const list = questions.value;
  const uid = currentUser.value?.id;
  if (!uid) return;

  const answerInitial = !answerNotificationsInitialized;
  list.forEach((q) => {
    if (q.senderId === uid && q.cevap) {
      const last = lastAnswerByQuestion.get(q.id);
      if (answerInitial) {
        lastAnswerByQuestion.set(q.id, q.cevap);
        return;
      }
      if (last !== q.cevap) {
        lastAnswerByQuestion.set(q.id, q.cevap);
        notifications.value.unshift(`✅ Sorunuza cevap geldi: "${(q.content || '').slice(0, 40)}..."`);
      }
    }
  });
  answerNotificationsInitialized = true;

  const moderationInitial = !questionModerationNotificationsInitialized;
  list.forEach((q) => {
    if (q.senderId !== uid) return;
    const state = getQuestionModerationState(q);
    const previous = lastQuestionModerationById.get(q.id);
    if (moderationInitial) {
      lastQuestionModerationById.set(q.id, state);
      return;
    }
    if (previous !== state) {
      lastQuestionModerationById.set(q.id, state);
      if (state === 'approved') {
        notifications.value.unshift(`✅ Sorunuz onaylandı: "${(q.content || '').slice(0, 45)}..."`);
      } else if (state.startsWith('rejected:')) {
        const reason = q.rejectionReason ? ` Gerekçe: ${q.rejectionReason}` : '';
        notifications.value.unshift(`❌ Sorunuz reddedildi.${reason}`);
      }
    }
  });
  questionModerationNotificationsInitialized = true;

  const initialModerationLoad = !pendingApprovalNotificationsInitialized;
  list.forEach((q) => {
    if (!q.isApproved && !q.isRejected && canModerateQuestion(q)) {
      if (initialModerationLoad) {
        seenPendingApprovalQuestionIds.add(q.id);
        return;
      }
      if (!seenPendingApprovalQuestionIds.has(q.id)) {
        seenPendingApprovalQuestionIds.add(q.id);
        notifications.value.unshift(`📝 Onay bekleyen ${q.subject} sorusu: "${(q.content || '').slice(0, 50)}..."`);
      }
    }
  });
  pendingApprovalNotificationsInitialized = true;
};

const startModerationLogsListener = () => {
  if (unsubscribeModerationLogs) unsubscribeModerationLogs();
  unsubscribeModerationLogs = onSnapshot(
    query(collection(db, "moderation_logs"), orderBy("createdAt", "desc"), limit(50)),
    (snap) => {
      moderationLogs.value = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    },
    handleSnapshotError('İşlem geçmişi', () => {
      moderationLogs.value = [];
    })
  );
};

const startEngagementListeners = (uid) => {
  stopEngagementListeners();
  if (!uid) return;

  unsubscribeQuestionLikes = onSnapshot(
    query(collection(db, "question_likes"), where("userId", "==", uid)),
    (snap) => {
      likedQuestionIds.value = snap.docs
        .map(docSnap => docSnap.data()?.questionId)
        .filter(Boolean);
    },
    handleSnapshotError('Soru beğenileri', () => {
      likedQuestionIds.value = [];
    })
  );

  unsubscribeAnswerThanks = onSnapshot(
    query(collection(db, "answer_thanks"), where("userId", "==", uid)),
    (snap) => {
      thankedAnswerQuestionIds.value = snap.docs
        .map(docSnap => docSnap.data()?.questionId)
        .filter(Boolean);
    },
    handleSnapshotError('Cevap teşekkürleri', () => {
      thankedAnswerQuestionIds.value = [];
    })
  );
};

const startInboxNotificationsListener = (uid) => {
  stopInboxNotificationsListener();
  if (!uid) return;

  unsubscribeInboxNotifications = onSnapshot(
    query(collection(db, "user_notifications"), where("recipientId", "==", uid)),
    (snap) => {
      inboxNotifications.value = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    },
    handleSnapshotError('Bildirim kutusu', () => {
      inboxNotifications.value = [];
    })
  );
};

const markInboxNotificationRead = async (notificationId) => {
  const entry = inboxNotifications.value.find(item => item.id === notificationId);
  if (!entry || entry.read) return;
  await updateDoc(doc(db, "user_notifications", notificationId), { read: true });
};

const markAllInboxNotificationsRead = async () => {
  const unread = sortedInboxNotifications.value.filter(item => !item.read).slice(0, 50);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach((item) => {
    batch.update(doc(db, "user_notifications", item.id), { read: true });
  });
  await batch.commit();
};

const startStaffListeners = () => {
  if (unsubscribeTeachers) unsubscribeTeachers();
  
  unsubscribeTeachers = onSnapshot(
    query(collection(db, "users"), where("role", "in", STAFF_ROLES)),
    (s) => {
      const teacherList = s.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => !t.archived);

      teachers.value = teacherList;
      syncTeacherSubjectDrafts(teacherList.filter(member => member.role === 'teacher'));

      const selfTeacher = teacherList.find(teacher => teacher.id === currentUser.value?.id);
      if (selfTeacher && isStaffUser(currentUser.value)) {
        currentUser.value = { ...currentUser.value, ...selfTeacher };
      }
    },
    handleSnapshotError('Personel listesi', () => {
      teachers.value = [];
      syncTeacherSubjectDrafts([]);
    })
  );
};

const startStudentsListener = (onlyApproved) => {
  if (unsubscribeStudents) unsubscribeStudents();
  const base = collection(db, "users");
  const studentsQuery = onlyApproved
    ? query(base, where("role", "==", "student"), where("isApproved", "==", true))
    : query(base, where("role", "==", "student"));
  unsubscribeStudents = onSnapshot(
    studentsQuery,
    (s) => {
      const studentList = s.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(student => !student.archived)
        .sort((a, b) => (b.points || 0) - (a.points || 0));
      students.value = studentList;
      writeOfflineCache({
        approvedStudents: studentList.filter(student => student.isApproved)
      });
    },
    handleSnapshotError('Öğrenci listesi', () => {
      const cached = readOfflineCache();
      students.value = Array.isArray(cached.approvedStudents) ? cached.approvedStudents : [];
    })
  );
};

const startQuestionsListener = (includePending) => {
  if (unsubscribeQuestions) unsubscribeQuestions();
  const questionsQuery = includePending
    ? query(collection(db, "questions"), orderBy("created_at", "desc"), limit(500))
    : query(collection(db, "questions"), where("isApproved", "==", true), orderBy("created_at", "desc"), limit(500));
  unsubscribeQuestions = onSnapshot(
    questionsQuery,
    (s) => {
      questionFeed.value = s.docs.map(d => ({ id: d.id, ...d.data() }));
      writeOfflineCache({
        approvedQuestions: questionFeed.value.filter(question => question.isApproved)
      });
      syncQuestionState();
      refreshQuestionNotifications();
    },
    handleSnapshotError('Soru akışı', () => {
      const cached = readOfflineCache();
      questionFeed.value = Array.isArray(cached.approvedQuestions) ? cached.approvedQuestions : [];
      syncQuestionState();
    })
  );
};

const startOwnQuestionsListener = (uid) => {
  stopOwnQuestionsListener();
  if (!uid) return;
  unsubscribeOwnQuestions = onSnapshot(
    query(collection(db, "questions"), where("senderId", "==", uid)),
    (snap) => {
      ownQuestionFeed.value = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      syncQuestionState();
      refreshQuestionNotifications();
    },
    handleSnapshotError('Kendi sorularım', () => {
      ownQuestionFeed.value = [];
      syncQuestionState();
    })
  );
};

const loadSettings = async () => {
  const docSnap = await getDoc(doc(db, "settings", "school_info"));
  if (docSnap.exists()) {
    schoolSettings.value = mergeSettingsWithDefaults(docSnap.data() || {});
    writeOfflineCache({ settings: schoolSettings.value });
  }
  isSettingsLoaded.value = true;
};

const startSettingsListener = () => {
  if (unsubscribeSettings) unsubscribeSettings();
  settingsSnapshotInitialized = false;
  unsubscribeSettings = onSnapshot(
    doc(db, "settings", "school_info"),
    (snap) => {
      if (!snap.exists()) {
        if (!isSettingsLoaded.value) isSettingsLoaded.value = true;
        settingsSnapshotInitialized = true;
        return;
      }
      if (settingsSnapshotInitialized) {
        const editing = showSettingsModal.value || showTeacherSettingsModal.value || showDesignModal.value;
        if (editing) return;
      }
      schoolSettings.value = mergeSettingsWithDefaults(snap.data() || {});
      writeOfflineCache({ settings: schoolSettings.value });
      isSettingsLoaded.value = true;
      settingsSnapshotInitialized = true;
    },
    handleSnapshotError('Okul ayarları', () => {
      const cached = readOfflineCache();
      if (cached.settings) {
        schoolSettings.value = mergeSettingsWithDefaults(cached.settings);
      }
      isSettingsLoaded.value = true;
    })
  );
};

const stopTeacherNotificationSettingsListener = () => {
  if (unsubscribeTeacherNotifications) {
    unsubscribeTeacherNotifications();
    unsubscribeTeacherNotifications = null;
  }
  teacherNotificationSnapshotInitialized = false;
  teacherNotificationSettings.value = createDefaultTeacherApprovalEmailSettings();
};

const startTeacherNotificationSettingsListener = () => {
  if (unsubscribeTeacherNotifications) unsubscribeTeacherNotifications();
  teacherNotificationSnapshotInitialized = false;
  unsubscribeTeacherNotifications = onSnapshot(
    doc(db, "private_settings", "teacher_notifications"),
    (snap) => {
      if (teacherNotificationSnapshotInitialized && showSettingsModal.value) {
        return;
      }
      teacherNotificationSettings.value = snap.exists()
        ? mergeTeacherApprovalEmailSettings(snap.data() || {})
        : createDefaultTeacherApprovalEmailSettings();
      teacherNotificationSnapshotInitialized = true;
    },
    handleSnapshotError('Öğretmen e-posta ayarları', () => {
      teacherNotificationSettings.value = createDefaultTeacherApprovalEmailSettings();
    })
  );
};

// --- UYGULAMA BAŞLATMA (GÜNCELLENMİŞ HALİ) ---

// Escape key handler for modals
const handleEscKey = (e) => {
  if (e.key === 'Escape') {
    if (showAuthModal.value) { showAuthModal.value = false; return; }
    if (showSettingsModal.value) { showSettingsModal.value = false; return; }
    if (showTeacherSettingsModal.value) { showTeacherSettingsModal.value = false; return; }
    if (showDesignModal.value) { showDesignModal.value = false; return; }
    if (showAskModal.value) { showAskModal.value = false; return; }
    if (showPasswordModal.value) { showPasswordModal.value = false; return; }
  }
};

onMounted(async () => {
  document.addEventListener('keydown', handleEscKey);
  const updateNow = () => {
    nowText.value = new Date().toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };
  updateNow();
  clockTimer = setInterval(updateNow, 60000); // Her dakika güncelle (performans için)
  hydrateOfflineCache();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);
  }

  // 1. Ziyaretçiler dahil HERKES için ayarları canlı dinle
  startSettingsListener();
  
  // 2. Soruları hemen çekmeye başla (Giriş yapılmamış modda)
  startQuestionsListener(false);

  // 3. Liderlik Tablosu: sadece onayli ogrenciler
  startStudentsListener(true);

  // 4. Kullanıcı oturum durumunu takip et
  unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
    try {
      if (firebaseUser) {
        if (currentUser.value?.id !== firebaseUser.uid) {
          notifications.value = [];
          lastAnswerByQuestion.clear();
          seenPendingApprovalQuestionIds.clear();
          lastQuestionModerationById.clear();
          answerNotificationsInitialized = false;
          questionModerationNotificationsInitialized = false;
          pendingApprovalNotificationsInitialized = false;
        }
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.archived) {
            await signOut(auth);
            return;
          }
          if (userData.isApproved) {
            currentUser.value = { id: firebaseUser.uid, ...userData };
            await loadTeacherNotificationSettings();
            startTeacherNotificationSettingsListener();
            startOwnQuestionsListener(firebaseUser.uid);
            startEngagementListeners(firebaseUser.uid);
            startInboxNotificationsListener(firebaseUser.uid);

            if (isLeadershipRole(userData.role)) {
              startQuestionsListener(true);
              startStaffListeners();
              startStudentsListener(false);
              startModerationLogsListener();
            } else if (userData.role === 'teacher') {
              stopStaffListeners();
              startQuestionsListener(true);
              startStudentsListener(true);
              stopModerationLogsListener();
            } else {
              stopStaffListeners();
              startQuestionsListener(false);
              startStudentsListener(true);
              stopModerationLogsListener();
            }
            return;
          }
        }
        await signOut(auth);
      } else {
        // Giriş yoksa (ziyaretçiyse)
        currentUser.value = null;
        notifications.value = [];
        stopStaffListeners();
        stopTeacherNotificationSettingsListener();
        stopOwnQuestionsListener();
        stopModerationLogsListener();
        stopEngagementListeners();
        stopInboxNotificationsListener();
        lastAnswerByQuestion.clear();
        seenPendingApprovalQuestionIds.clear();
        lastQuestionModerationById.clear();
        answerNotificationsInitialized = false;
        questionModerationNotificationsInitialized = false;
        pendingApprovalNotificationsInitialized = false;
        startStudentsListener(true);
        startQuestionsListener(false);
      }
    } catch (error) {
      console.error('Auth bootstrap failed', error);
      pushSystemError(`Oturum doğrulanamadı: ${functionErrorMessage(error, 'Yetki veya bağlantı hatası.')}`);
      currentUser.value = null;
      notifications.value = [];
      stopStaffListeners();
      stopTeacherNotificationSettingsListener();
      stopOwnQuestionsListener();
      stopModerationLogsListener();
      stopEngagementListeners();
      stopInboxNotificationsListener();
      lastAnswerByQuestion.clear();
      seenPendingApprovalQuestionIds.clear();
      lastQuestionModerationById.clear();
      answerNotificationsInitialized = false;
      questionModerationNotificationsInitialized = false;
      pendingApprovalNotificationsInitialized = false;
      await signOut(auth).catch(() => {});
      startStudentsListener(true);
      startQuestionsListener(false);
    }
  });

});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscKey);
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleBrowserOnline);
    window.removeEventListener('offline', handleBrowserOffline);
  }
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  if (unsubscribeAuth) unsubscribeAuth();
  unsubscribeAuth = null;
  if (unsubscribeQuestions) unsubscribeQuestions();
  unsubscribeQuestions = null;
  if (unsubscribeOwnQuestions) unsubscribeOwnQuestions();
  unsubscribeOwnQuestions = null;
  if (unsubscribeStudents) unsubscribeStudents();
  unsubscribeStudents = null;
  if (unsubscribeTeachers) unsubscribeTeachers();
  unsubscribeTeachers = null;
  if (unsubscribeSettings) unsubscribeSettings();
  unsubscribeSettings = null;
  if (unsubscribeTeacherNotifications) unsubscribeTeacherNotifications();
  unsubscribeTeacherNotifications = null;
  if (unsubscribeModerationLogs) unsubscribeModerationLogs();
  unsubscribeModerationLogs = null;
  if (unsubscribeQuestionLikes) unsubscribeQuestionLikes();
  unsubscribeQuestionLikes = null;
  if (unsubscribeAnswerThanks) unsubscribeAnswerThanks();
  unsubscribeAnswerThanks = null;
  if (unsubscribeInboxNotifications) unsubscribeInboxNotifications();
  unsubscribeInboxNotifications = null;
});

watch(
  schoolSettings,
  () => {
    if (!isSettingsLoaded.value) return;
    if (!autoSaveEnabled.value) return;
    if (!isLeadershipUser()) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      try {
        await autoSaveAdminSettings();
      } catch (error) {
        const msg = "Otomatik kaydetme hatası: " + (error.message || error);
        pushSystemError(msg);
      }
    }, 2500);
  },
  { deep: true }
);

watch(
  teacherNotificationSettings,
  () => {
    if (!isSettingsLoaded.value) return;
    if (!autoSaveEnabled.value) return;
    if (!isLeadershipUser()) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      try {
        await autoSaveAdminSettings();
      } catch (error) {
        const msg = "Otomatik e-posta ayarı kaydetme hatası: " + (error.message || error);
        pushSystemError(msg);
      }
    }, 2500);
  },
  { deep: true }
);

watch(
  () => [showSettingsModal.value, showTeacherSettingsModal.value, showDesignModal.value],
  async (curr, prev) => {
    const wasOpen = prev?.some(Boolean);
    const isOpen = curr?.some(Boolean);
    if (wasOpen && !isOpen) {
      try {
        await loadSettings();
      } catch (error) {
        const msg = "Ayarlar yüklenemedi: " + (error.message || error);
        systemErrors.value.unshift(msg);
      }
    }
  }
);

const statsQuestions = computed(() => {
  const now = Date.now();
  let days = 0;
  if (statsRange.value === '7d') days = 7;
  else if (statsRange.value === '30d') days = 30;
  else if (statsRange.value === '90d') days = 90;
  if (!days) return questions.value;
  const since = now - days * 24 * 60 * 60 * 1000;
  return questions.value.filter(q => {
    const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : null;
    return ts ? ts >= since : true;
  });
});

const statsApproved = computed(() => statsQuestions.value.filter(q => q.isApproved));
const statsPending = computed(() => statsQuestions.value.filter(q => !q.isApproved && !q.isRejected));

const subjectStatsData = computed(() => {
  const labels = (schoolSettings.value?.subjects || []).filter(Boolean);
  const counts = labels.map(label => statsApproved.value.filter(q => q.subject === label).length);
  return { labels, datasets: [{ data: counts, backgroundColor: labels.map(colorForLabel) }] };
});

const classStatsData = computed(() => {
  const labels = (schoolSettings.value?.classes || []).filter(Boolean);
  const counts = labels.map(label => statsApproved.value.filter(q => q.classLevel === label).length);
  return { labels, datasets: [{ data: counts, backgroundColor: labels.map(colorForLabel) }] };
});

const approvalStatsData = computed(() => ({
  labels: ['Onaylı', 'Onaysız'],
  datasets: [{ data: [statsApproved.value.length, statsPending.value.length], backgroundColor: ['#16a085', '#f59e0b'] }]
}));

const goalData = computed(() => {
  const goal = schoolSettings.value.questionGoal || 500;
  return {
    labels: ['Mevcut', `Hedef (${goal})`],
    datasets: [{ 
      label: 'Etkileşim', 
      backgroundColor: [schoolSettings.value?.styles?.accentColor || '#16a085', '#e2e8f0'], 
      data: [statsQuestions.value.length, goal] 
    }]
  };
});

const barChartOptions = {
  responsive: true,
  plugins: {
    tooltip: {
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}`
      }
    },
    legend: { display: false }
  },
  scales: {
    y: { beginAtZero: true, ticks: { stepSize: 50 } }
  }
};

const goalRemaining = computed(() => {
  const goal = schoolSettings.value.questionGoal || 500;
  return Math.max(0, goal - statsQuestions.value.length);
});
const goalPercent = computed(() => {
  const goal = schoolSettings.value.questionGoal || 500;
  return Math.min(100, Math.round((statsQuestions.value.length / goal) * 100));
});

// --- TREND GRAFİĞİ (günlük soru sayısı) ---
const trendData = computed(() => {
  const days = statsRange.value === '7d' ? 7 : statsRange.value === '30d' ? 30 : statsRange.value === '90d' ? 90 : 60;
  const now = Date.now();
  const labels = [];
  const counts = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now - i * 86400000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const label = dayStart.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
    labels.push(label);
    const count = statsQuestions.value.filter(q => {
      const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
      return ts >= dayStart.getTime() && ts < dayEnd.getTime();
    }).length;
    counts.push(count);
  }
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  return {
    labels,
    datasets: [{
      label: 'Günlük Soru',
      data: counts,
      borderColor: accent,
      backgroundColor: accent + '33',
      fill: true,
      tension: 0.3,
      pointRadius: days > 30 ? 0 : 3
    }]
  };
});

const trendChartOptions = {
  responsive: true,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => `${ctx.raw} soru` } }
  },
  scales: {
    y: { beginAtZero: true, ticks: { stepSize: 1 } },
    x: { ticks: { maxTicksLimit: 10, font: { size: 9 } } }
  }
};

// --- YANIT SÜRESİ ANALİZİ ---
const avgResponseTime = computed(() => {
  const responded = statsQuestions.value.filter(q => q.isApproved && q.cevap && q.created_at && q.acceptedAt);
  if (!responded.length) return { avg: 0, min: 0, max: 0, count: 0 };
  const durations = responded.map(q => {
    const created = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    const accepted = q.acceptedAt?.toDate ? q.acceptedAt.toDate().getTime() : 0;
    return (created && accepted && accepted > created) ? (accepted - created) / 3600000 : 0;
  }).filter(d => d > 0);
  if (!durations.length) return { avg: 0, min: 0, max: 0, count: 0 };
  const sum = durations.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round(sum / durations.length * 10) / 10,
    min: Math.round(Math.min(...durations) * 10) / 10,
    max: Math.round(Math.max(...durations) * 10) / 10,
    count: durations.length
  };
});

// --- DÖNEM KARŞILAŞTIRMASI ---
const periodComparison = computed(() => {
  const now = Date.now();
  let days = 30;
  if (statsRange.value === '7d') days = 7;
  else if (statsRange.value === '90d') days = 90;
  const currentStart = now - days * 86400000;
  const prevStart = currentStart - days * 86400000;
  const current = questions.value.filter(q => {
    const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    return ts >= currentStart;
  }).length;
  const previous = questions.value.filter(q => {
    const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    return ts >= prevStart && ts < currentStart;
  }).length;
  const diff = current - previous;
  const pct = previous ? Math.round((diff / previous) * 100) : (current > 0 ? 100 : 0);
  return { current, previous, diff, pct, days };
});

// --- SINIF KATILIM ORANI ---
const classParticipation = computed(() => {
  const classes = schoolSettings.value?.classes || [];
  return classes.map(cls => {
    const totalStudents = students.value.filter(s => s.class === cls && s.isApproved).length;
    const activeStudents = new Set(
      statsQuestions.value.filter(q => q.classLevel === cls).map(q => q.senderId).filter(Boolean)
    ).size;
    const rate = totalStudents > 0 ? Math.round((activeStudents / totalStudents) * 100) : 0;
    return { cls, totalStudents, activeStudents, rate };
  });
});

// --- DASHBOARD FİLTRELİ VERİ ---
const dashFiltered = computed(() => {
  let list = statsQuestions.value;
  if (dashSubject.value) list = list.filter(q => q.subject === dashSubject.value);
  if (dashClass.value) list = list.filter(q => q.classLevel === dashClass.value);
  return list;
});

// --- 2) CEVAPLAMA ORANI DOUGHNUT ---
const answerRatioData = computed(() => {
  const answered = dashFiltered.value.filter(q => q.cevap).length;
  const unanswered = dashFiltered.value.length - answered;
  return {
    labels: ['Cevaplanmış', 'Cevaplanmamış'],
    datasets: [{ data: [answered, unanswered], backgroundColor: ['#16a085', '#ef4444'], borderWidth: 0 }]
  };
});

// --- 3) SAAT DİLİMİ ISI HARİTASI ---
const heatmapData = computed(() => {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  dashFiltered.value.forEach(q => {
    const d = q.created_at?.toDate ? q.created_at.toDate() : null;
    if (d) grid[d.getDay()][d.getHours()]++;
  });
  const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  return { grid, dayNames };
});

// --- 4) DERS BAZLI YANIT SÜRESİ ---
const subjectResponseTime = computed(() => {
  const map = new Map();
  dashFiltered.value.filter(q => q.cevap && q.created_at && q.acceptedAt).forEach(q => {
    const created = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    const accepted = q.acceptedAt?.toDate ? q.acceptedAt.toDate().getTime() : 0;
    if (created && accepted && accepted > created) {
      const hours = (accepted - created) / 3600000;
      if (!map.has(q.subject)) map.set(q.subject, []);
      map.get(q.subject).push(hours);
    }
  });
  return Array.from(map.entries()).map(([subject, durations]) => ({
    subject,
    avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * 10) / 10,
    count: durations.length
  })).sort((a, b) => a.avg - b.avg);
});

// --- 5) KÜMÜLATİF BÜYÜME GRAFİĞİ ---
const cumulativeData = computed(() => {
  const days = statsRange.value === '7d' ? 7 : statsRange.value === '30d' ? 30 : statsRange.value === '90d' ? 90 : 60;
  const now = Date.now();
  const labels = [];
  const cumulative = [];
  let total = 0;
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now - i * 86400000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    labels.push(dayStart.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }));
    total += dashFiltered.value.filter(q => {
      const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
      return ts >= dayStart.getTime() && ts < dayEnd.getTime();
    }).length;
    cumulative.push(total);
  }
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  return {
    labels,
    datasets: [{ label: 'Toplam Soru', data: cumulative, borderColor: '#6366f1', backgroundColor: '#6366f133', fill: true, tension: 0.3, pointRadius: days > 30 ? 0 : 2 }]
  };
});

// --- 6) ONAY BEKLEME SÜRESİ ---
const approvalWaitTime = computed(() => {
  const pending = dashFiltered.value.filter(q => !q.isApproved && !q.isRejected && q.created_at);
  if (!pending.length) return { avg: 0, max: 0, count: 0 };
  const now = Date.now();
  const waits = pending.map(q => {
    const created = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    return created ? (now - created) / 3600000 : 0;
  }).filter(d => d > 0);
  if (!waits.length) return { avg: 0, max: 0, count: 0 };
  return {
    avg: Math.round(waits.reduce((a, b) => a + b, 0) / waits.length * 10) / 10,
    max: Math.round(Math.max(...waits) * 10) / 10,
    count: waits.length
  };
});

// --- 7) SORU KALİTESİ METRİKLERİ ---
const questionQuality = computed(() => {
  const qs = dashFiltered.value;
  if (!qs.length) return { avgLength: 0, maxLikes: 0, topLiked: [] };
  const lengths = qs.map(q => (q.content || '').length);
  const avgLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const topLiked = [...qs].filter(q => (q.likes || 0) > 0).sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 5);
  return { avgLength, maxLikes: topLiked[0]?.likes || 0, topLiked };
});

// --- 8) ÖĞRENCİ AKTİVİTE SKORU ---
const studentActivity = computed(() => {
  const map = new Map();
  dashFiltered.value.forEach(q => {
    const id = q.senderId;
    if (!id) return;
    if (!map.has(id)) map.set(id, { name: q.sender || 'Bilinmiyor', questions: 0, likes: 0, cls: q.classLevel || '' });
    const entry = map.get(id);
    entry.questions++;
    entry.likes += (q.likes || 0);
  });
  return Array.from(map.values())
    .map(s => ({ ...s, score: s.questions * 10 + s.likes * 5 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
});

// --- 9) HAFTALIK ÖZET KARTI ---
const weeklySummary = computed(() => {
  const now = Date.now();
  const thisWeekStart = now - 7 * 86400000;
  const lastWeekStart = thisWeekStart - 7 * 86400000;
  const thisWeek = questions.value.filter(q => {
    const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    return ts >= thisWeekStart;
  });
  const lastWeek = questions.value.filter(q => {
    const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    return ts >= lastWeekStart && ts < thisWeekStart;
  });
  const thisAnswered = thisWeek.filter(q => q.cevap).length;
  const lastAnswered = lastWeek.filter(q => q.cevap).length;
  const thisApproved = thisWeek.filter(q => q.isApproved).length;
  const lastApproved = lastWeek.filter(q => q.isApproved).length;
  return {
    questions: { current: thisWeek.length, previous: lastWeek.length },
    answered: { current: thisAnswered, previous: lastAnswered },
    approved: { current: thisApproved, previous: lastApproved }
  };
});

// --- 11) RADAR CHART (ders dağılımı) ---
const radarData = computed(() => {
  const subjects = (schoolSettings.value?.subjects || []).filter(Boolean);
  const counts = subjects.map(s => dashFiltered.value.filter(q => q.subject === s).length);
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  return {
    labels: subjects,
    datasets: [{ label: 'Soru Dağılımı', data: counts, backgroundColor: accent + '33', borderColor: accent, pointBackgroundColor: accent }]
  };
});

const radarOptions = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: { r: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } } }
};

// ============================
// 🔬 GELİŞMİŞ ANALİZ MODÜLÜ
// ============================

// --- ÖĞRETMEN PERFORMANS ANALİZİ ---
const teacherPerformance = computed(() => {
  const map = new Map();
  dashFiltered.value.forEach(q => {
    if (!q.respondent) return;
    if (!map.has(q.respondent)) map.set(q.respondent, { name: q.respondent, answers: 0, accepted: 0, thanks: 0, durations: [] });
    const entry = map.get(q.respondent);
    entry.answers++;
    if (q.answerAccepted) entry.accepted++;
    entry.thanks += (q.answerThanks || 0);
    if (q.created_at && q.acceptedAt) {
      const c = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
      const a = q.acceptedAt?.toDate ? q.acceptedAt.toDate().getTime() : 0;
      if (c && a && a > c) entry.durations.push((a - c) / 3600000);
    }
  });
  return Array.from(map.values()).map(t => ({
    ...t,
    avgTime: t.durations.length ? Math.round(t.durations.reduce((a, b) => a + b, 0) / t.durations.length * 10) / 10 : null,
    acceptRate: t.answers ? Math.round(t.accepted / t.answers * 100) : 0
  })).sort((a, b) => b.answers - a.answers);
});

// --- PEDAGOJİ: SIK KONULAR / KATKI / ANONİM BİLİM ---
const frequentTopics = computed(() => aggregateFrequentTopics(dashFiltered.value, 15));

const topicStatsData = computed(() => {
  const top = frequentTopics.value.slice(0, 8);
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  return {
    labels: top.map((t) => (t.topic.length > 14 ? t.topic.slice(0, 14) + '…' : t.topic)),
    datasets: [{
      label: 'Soru',
      data: top.map((t) => t.count),
      backgroundColor: top.map((_, i) => (i % 2 ? accent : accent + '99')),
    }],
  };
});

const contributionLeaders = computed(() => {
  const asked = new Map();
  const accepted = new Map();
  const thanks = new Map();
  dashFiltered.value.forEach((q) => {
    if (q.senderId) asked.set(q.senderId, (asked.get(q.senderId) || 0) + 1);
    if (q.respId && q.answerAccepted) accepted.set(q.respId, (accepted.get(q.respId) || 0) + 1);
    if (q.respId) thanks.set(q.respId, (thanks.get(q.respId) || 0) + (q.answerThanks || 0));
  });
  return students.value
    .filter((s) => s.isApproved !== false)
    .map((s) => {
      const index = computeContributionIndex({
        points: s.points || 0,
        questionsAsked: asked.get(s.id) || 0,
        answersAccepted: accepted.get(s.id) || 0,
        thanksReceived: thanks.get(s.id) || 0,
      });
      return {
        id: s.id,
        name: s.name,
        cls: s.class || '-',
        points: s.points || 0,
        index,
        badge: getUserBadge(s.points || 0),
      };
    })
    .filter((s) => s.index > 0)
    .sort((a, b) => b.index - a.index)
    .slice(0, 15);
});

const anonymousTopicInsights = computed(() => topicTrendSplit(dashFiltered.value));

const anonymousScienceSummary = computed(() => {
  const pool = dashFiltered.value;
  const tagged = pool.filter((q) => normalizeTopicTag(q.topicTag));
  const learned = pool.filter((q) => q.learnedNote);
  const acceptRate = pool.filter((q) => q.cevap).length
    ? Math.round((pool.filter((q) => q.answerAccepted).length / pool.filter((q) => q.cevap).length) * 100)
    : 0;
  return {
    total: pool.length,
    tagged: tagged.length,
    tagCoverage: pool.length ? Math.round((tagged.length / pool.length) * 100) : 0,
    learnedNotes: learned.length,
    acceptRate,
    hotTopics: frequentTopics.value.slice(0, 5),
    cooling: anonymousTopicInsights.value.filter((t) => t.delta < 0).slice(0, 5),
    rising: anonymousTopicInsights.value.filter((t) => t.delta > 0).slice(0, 5),
  };
});

// --- ÖĞRETMEN CEVAP DAĞILIMI BAR CHART ---
const teacherBarData = computed(() => {
  const top = teacherPerformance.value.slice(0, 8);
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  return {
    labels: top.map(t => t.name.length > 12 ? t.name.slice(0, 12) + '…' : t.name),
    datasets: [{ label: 'Cevap', data: top.map(t => t.answers), backgroundColor: accent + 'aa' }]
  };
});

// --- SORU TAMAMLANMA HUNİSİ ---
const funnelData = computed(() => {
  const total = dashFiltered.value.length;
  const approved = dashFiltered.value.filter(q => q.isApproved).length;
  const answered = dashFiltered.value.filter(q => q.cevap).length;
  const accepted = dashFiltered.value.filter(q => q.answerAccepted).length;
  return [
    { label: 'Gönderilen', count: total, pct: 100, color: '#3b82f6' },
    { label: 'Onaylanan', count: approved, pct: total ? Math.round(approved / total * 100) : 0, color: '#16a085' },
    { label: 'Cevaplanan', count: answered, pct: total ? Math.round(answered / total * 100) : 0, color: '#f59e0b' },
    { label: 'Kabul Edilen', count: accepted, pct: total ? Math.round(accepted / total * 100) : 0, color: '#8b5cf6' }
  ];
});

// --- HAFTA İÇİ vs HAFTA SONU ---
const weekdayVsWeekend = computed(() => {
  let weekday = 0, weekend = 0;
  dashFiltered.value.forEach(q => {
    const d = q.created_at?.toDate ? q.created_at.toDate() : null;
    if (!d) return;
    const day = d.getDay();
    if (day === 0 || day === 6) weekend++; else weekday++;
  });
  return { weekday, weekend, total: weekday + weekend };
});

// --- AKTİF KULLANICI METRİKLERİ (DAU/WAU/MAU) ---
const activeUsers = computed(() => {
  const now = Date.now();
  const day1 = now - 86400000;
  const day7 = now - 7 * 86400000;
  const day30 = now - 30 * 86400000;
  const dau = new Set(), wau = new Set(), mau = new Set();
  questions.value.forEach(q => {
    const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    const uid = q.senderId;
    if (!uid || !ts) return;
    if (ts >= day1) dau.add(uid);
    if (ts >= day7) wau.add(uid);
    if (ts >= day30) mau.add(uid);
  });
  return { dau: dau.size, wau: wau.size, mau: mau.size };
});

// --- SINIF × DERS KORELASYON MATRİSİ ---
const classSubjectMatrix = computed(() => {
  const classes = (schoolSettings.value?.classes || []).filter(Boolean);
  const subjects = (schoolSettings.value?.subjects || []).filter(Boolean);
  const matrix = classes.map(cls =>
    subjects.map(sub => dashFiltered.value.filter(q => q.classLevel === cls && q.subject === sub).length)
  );
  const maxVal = Math.max(1, ...matrix.flat());
  return { classes, subjects, matrix, maxVal };
});

// --- HEDEF TARİH TAHMİNİ ---
const goalPrediction = computed(() => {
  const goal = schoolSettings.value.questionGoal || 500;
  const current = statsQuestions.value.length;
  if (current >= goal) return { reached: true, daysLeft: 0, date: 'Hedef ulaşıldı!' };
  const days = statsRange.value === '7d' ? 7 : statsRange.value === '30d' ? 30 : statsRange.value === '90d' ? 90 : 60;
  const dailyRate = current / Math.max(days, 1);
  if (dailyRate <= 0) return { reached: false, daysLeft: Infinity, date: 'Yetersiz veri' };
  const remaining = goal - current;
  const daysLeft = Math.ceil(remaining / dailyRate);
  const targetDate = new Date(Date.now() + daysLeft * 86400000);
  return { reached: false, daysLeft, date: targetDate.toLocaleDateString('tr-TR') };
});

// --- BÜYÜME HIZI TRENDİ ---
const growthRate = computed(() => {
  const days = statsRange.value === '7d' ? 7 : statsRange.value === '30d' ? 30 : statsRange.value === '90d' ? 90 : 60;
  const now = Date.now();
  const weeks = [];
  const weekCount = Math.min(Math.floor(days / 7), 12);
  for (let w = weekCount - 1; w >= 0; w--) {
    const wStart = now - (w + 1) * 7 * 86400000;
    const wEnd = now - w * 7 * 86400000;
    const count = dashFiltered.value.filter(q => {
      const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
      return ts >= wStart && ts < wEnd;
    }).length;
    weeks.push(count);
  }
  const rates = [];
  for (let i = 1; i < weeks.length; i++) {
    rates.push(weeks[i - 1] ? Math.round((weeks[i] - weeks[i - 1]) / weeks[i - 1] * 100) : 0);
  }
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  return {
    labels: weeks.map((_, i) => `H${i + 1}`),
    datasets: [
      { label: 'Soru Sayısı', data: weeks, borderColor: accent, backgroundColor: accent + '33', fill: true, tension: 0.3, yAxisID: 'y' },
      { label: 'Büyüme %', data: [0, ...rates], borderColor: '#f59e0b', backgroundColor: '#f59e0b33', borderDash: [5, 5], tension: 0.3, yAxisID: 'y1' }
    ],
    rates
  };
});

const growthRateOptions = {
  responsive: true,
  plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 9 } } } },
  scales: {
    y: { beginAtZero: true, position: 'left', ticks: { stepSize: 1, font: { size: 9 } }, title: { display: true, text: 'Soru', font: { size: 9 } } },
    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 9 }, callback: (v) => v + '%' }, title: { display: true, text: 'Büyüme', font: { size: 9 } } }
  }
};

// --- ÖĞRENCİ SEGMENTASYONU ---
const studentSegments = computed(() => {
  const now = Date.now();
  const day7 = now - 7 * 86400000;
  const day30 = now - 30 * 86400000;
  const map = new Map();
  questions.value.forEach(q => {
    const ts = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
    const uid = q.senderId;
    if (!uid) return;
    if (!map.has(uid)) map.set(uid, { name: q.sender || 'Bilinmiyor', cls: q.classLevel || '', lastActive: 0, count: 0 });
    const e = map.get(uid);
    e.count++;
    if (ts > e.lastActive) e.lastActive = ts;
  });
  const all = Array.from(map.values());
  const active = all.filter(s => s.lastActive >= day7);
  const moderate = all.filter(s => s.lastActive >= day30 && s.lastActive < day7);
  const inactive = all.filter(s => s.lastActive < day30);
  return { active, moderate, inactive, total: all.length };
});

const segmentDoughnutData = computed(() => ({
  labels: ['Aktif (7g)', 'Ilımlı (30g)', 'Pasif (30g+)'],
  datasets: [{ data: [studentSegments.value.active.length, studentSegments.value.moderate.length, studentSegments.value.inactive.length], backgroundColor: ['#16a085', '#f59e0b', '#ef4444'], borderWidth: 0 }]
}));

// --- MODERASYON ANALİZİ ---
const moderationStats = computed(() => {
  const total = dashFiltered.value.length;
  const approved = dashFiltered.value.filter(q => q.isApproved).length;
  const rejected = dashFiltered.value.filter(q => q.isRejected).length;
  const pending = total - approved - rejected;
  const answerApproved = dashFiltered.value.filter(q => q.answerApproved).length;
  const answerPending = dashFiltered.value.filter(q => q.cevap && !q.answerApproved).length;
  return { total, approved, rejected, pending, answerApproved, answerPending,
    approveRate: total ? Math.round(approved / total * 100) : 0,
    rejectRate: total ? Math.round(rejected / total * 100) : 0
  };
});

// --- EN UZUN CEVAPSIZ SORULAR ---
const longestUnanswered = computed(() => {
  const now = Date.now();
  return dashFiltered.value
    .filter(q => q.isApproved && !q.cevap && q.created_at)
    .map(q => {
      const created = q.created_at?.toDate ? q.created_at.toDate().getTime() : 0;
      return { ...q, waitHours: created ? Math.round((now - created) / 3600000 * 10) / 10 : 0 };
    })
    .sort((a, b) => b.waitHours - a.waitHours)
    .slice(0, 10);
});

// --- ENGAGEMENT SKORU ---
const engagementScore = computed(() => {
  const totalStudents = students.value.filter(s => s.isApproved).length || 1;
  const activeStudentCount = new Set(dashFiltered.value.map(q => q.senderId).filter(Boolean)).size;
  const participationRate = activeStudentCount / totalStudents;
  const totalQ = dashFiltered.value.length || 1;
  const answerRate = dashFiltered.value.filter(q => q.cevap).length / totalQ;
  const likeRate = dashFiltered.value.filter(q => (q.likes || 0) > 0).length / totalQ;
  const acceptRate = dashFiltered.value.filter(q => q.answerAccepted).length / totalQ;
  const raw = participationRate * 30 + answerRate * 30 + likeRate * 20 + acceptRate * 20;
  const score = Math.min(100, Math.round(raw * 100));
  const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';
  return { score, grade, participationRate: Math.round(participationRate * 100), answerRate: Math.round(answerRate * 100), likeRate: Math.round(likeRate * 100), acceptRate: Math.round(acceptRate * 100) };
});

// --- CEVAP KALİTESİ ---
const answerQuality = computed(() => {
  const answered = dashFiltered.value.filter(q => q.cevap);
  if (!answered.length) return { acceptRate: 0, thankRate: 0, total: 0 };
  const accepted = answered.filter(q => q.answerAccepted).length;
  const thanked = answered.filter(q => (q.answerThanks || 0) > 0).length;
  return {
    acceptRate: Math.round(accepted / answered.length * 100),
    thankRate: Math.round(thanked / answered.length * 100),
    total: answered.length
  };
});

const topSubjects = computed(() => {
  const map = new Map();
  statsApproved.value.forEach(q => map.set(q.subject, (map.get(q.subject) || 0) + 1));
  return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
});

const topClasses = computed(() => {
  const map = new Map();
  statsApproved.value.forEach(q => map.set(q.classLevel, (map.get(q.classLevel) || 0) + 1));
  return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
});

const topAskers = computed(() => {
  const map = new Map();
  statsQuestions.value.forEach(q => map.set(q.sender || 'Bilinmiyor', (map.get(q.sender || 'Bilinmiyor') || 0) + 1));
  return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
});

const topResponders = computed(() => {
  const map = new Map();
  statsQuestions.value.forEach(q => { if (q.respondent) map.set(q.respondent, (map.get(q.respondent) || 0) + 1); });
  return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);
});

const chartOptions = {
  responsive: true,
  plugins: {
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const total = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
          const value = ctx.raw || 0;
          const pct = Math.round((value / total) * 100);
          return `${ctx.label}: ${value} (${pct}%)`;
        }
      }
    }
  }
};

const chartPalette = computed(() => {
  const accent = schoolSettings.value?.styles?.accentColor || '#16a085';
  return [
    accent,
    '#f59e0b', '#3b82f6', '#e11d48', '#10b981', '#8b5cf6',
    '#f97316', '#14b8a6', '#ef4444', '#6366f1', '#84cc16', '#0ea5e9',
    '#ec4899', '#22c55e', '#a855f7', '#06b6d4', '#f43f5e', '#eab308',
    '#4f46e5', '#fb7185', '#34d399', '#c026d3', '#38bdf8', '#b91c1c'
  ];
});

const colorForLabel = (label) => {
  const name = String(label || '').toLowerCase().trim();
  if (!name) return chartPalette.value[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return chartPalette.value[hash % chartPalette.value.length];
};

</script>

<template>
  <ToastNotification ref="toastRef" />
  <div v-if="isSettingsLoaded" class="app-container" :class="{ 'dark-mode': schoolSettings.styles.darkMode }" :style="{ 
    fontFamily: schoolSettings.styles.customFontName ? schoolSettings.styles.customFontName : schoolSettings.styles.fontFamily, 
    fontSize: schoolSettings.styles.baseFontSize + 'px',
    color: schoolSettings.styles.bodyText,
    '--accent': schoolSettings.styles.accentColor,
    '--header-bg': schoolSettings.styles.headerBg,
    '--header-text': schoolSettings.styles.headerText,
    '--body-text': schoolSettings.styles.bodyText,
    '--footer-text': schoolSettings.styles.footerText,
    '--footer-bg': schoolSettings.styles.footerBg || schoolSettings.styles.headerBg,
    '--bg-color': schoolSettings.styles.bgColor || '#101b2d',
    '--card-radius': (schoolSettings.styles.cardRadius || 14) + 'px',
    '--title-color': schoolSettings.styles.titleColor
  }">
    <component :is="'style'" v-if="sanitizeFontUrl(schoolSettings.styles.customFontUrl)">
      @import url('{{ sanitizeFontUrl(schoolSettings.styles.customFontUrl) }}');
    </component>

    <header class="navbar-wrapper" role="banner">
      <div class="center-column banner-box glass-premium" :style="{ backgroundColor: schoolSettings.styles.headerBg, borderColor: schoolSettings.styles.accentColor }">
        <div class="logo-area"><img :src="schoolSettings.logo" class="logo-fixed" alt="Okul logosu"></div>
        <div class="brand-info-center">
          <h1 class="grand-title" :style="{ fontFamily: schoolSettings.styles.titleFont, fontSize: schoolSettings.styles.titleSize + 'px', color: schoolSettings.styles.titleColor }">DİJİTAL İMECE: ADAB</h1>
          <p class="grand-subtitle" :style="{ color: schoolSettings.styles.headerText }">{{ schoolSettings.name }}</p>
        </div>
        <div class="nav-actions">
          <button v-if="currentUser" @click="showPasswordModal = true" class="icon-btn" title="Şifre Değiştir" aria-label="Şifre değiştir">🔒</button>
          <button v-if="!currentUser" @click="showAuthModal = true" class="btn-login-main" :style="{ backgroundColor: schoolSettings.styles.accentColor }" aria-label="Giriş yap">GİRİŞ</button>
          <div v-else class="user-pill">
            <span>{{ currentUser.name }}</span>
            <span class="role-badge" :title="getRoleLabel(currentUser.role)">{{ getRoleBadgeIcon(currentUser.role) }}</span>
            <button @click="handleLogout" class="logout-btn" aria-label="Çıkış yap">🔓</button>
          </div>
          <div class="time-chip">🕒 {{ nowText }}</div>
        </div>
      </div>
    </header>

    <main class="center-column main-content" role="main">
      <div v-if="schoolSettings.announcement" class="announcement-box" :style="{background: schoolSettings.styles.accentColor}">📢 {{ schoolSettings.announcement }}</div>

      <div v-if="currentUser && (isLeadershipUser() || isTeacherUser())" class="admin-toolbar glass-premium">
        <button @click="showStats = !showStats; if (showStats) loadCharts()" class="btn-xs" :disabled="teacherIsOffline">📊 İstatistik</button>
        <button v-if="canOpenDesign" @click="showDesignModal = true" class="btn-xs">🎨 Tasarım</button>
        <button v-if="canOpenSettings" @click="settingsTab='overview'; showSettingsModal = true" class="btn-xs">⚙️ Yönetim</button>
        <span class="admin-clock">🕒 {{ nowText }}</span>
      </div>

      <div v-if="showStats && canViewStats" class="stats-panel glass-premium fade-in">
        <div class="stats-header">
          <h3>📈 Akademik Rapor</h3>
          <div class="s-btns">
            <select v-model="statsRange" class="stats-select">
              <option value="7d">Son 7 gün</option>
              <option value="30d">Son 30 gün</option>
              <option value="90d">Son 90 gün</option>
              <option value="all">Tümü</option>
            </select>
            <select v-model="dashSubject" class="stats-select">
              <option value="">Tüm Dersler</option>
              <option v-for="s in schoolSettings.subjects" :key="s" :value="s">{{ s }}</option>
            </select>
            <select v-model="dashClass" class="stats-select">
              <option value="">Tüm Sınıflar</option>
              <option v-for="c in schoolSettings.classes" :key="c" :value="c">{{ c }}</option>
            </select>
            <button v-if="isLeadershipUser()" @click="downloadJSONBackup" class="btn-xs">JSON</button>
            <button v-if="isLeadershipUser()" @click="downloadNotebook" class="btn-xs">🤖 AI</button>
            <button v-if="isLeadershipUser()" @click="exportStatsCSV" class="btn-xs">📊 CSV</button>
            <button v-if="isLeadershipUser()" @click="exportStatsPDF" class="btn-xs">📄 PDF</button>
          </div>
        </div>

        <!-- TABS -->
        <div class="stats-tabs">
          <button :class="{ active: statsTab === 'overview' }" @click="statsTab = 'overview'">📊 Genel</button>
          <button :class="{ active: statsTab === 'charts' }" @click="statsTab = 'charts'">📈 Grafikler</button>
          <button :class="{ active: statsTab === 'analysis' }" @click="statsTab = 'analysis'">🔬 Analiz</button>
          <button :class="{ active: statsTab === 'topics' }" @click="statsTab = 'topics'">🏷️ Konular</button>
          <button :class="{ active: statsTab === 'science' }" @click="statsTab = 'science'">🧬 Bilim</button>
          <button :class="{ active: statsTab === 'students' }" @click="statsTab = 'students'">👤 Öğrenci</button>
          <button :class="{ active: statsTab === 'teachers' }" @click="statsTab = 'teachers'">👨‍🏫 Öğretmen</button>
          <button :class="{ active: statsTab === 'engagement' }" @click="statsTab = 'engagement'">🎯 Etkileşim</button>
        </div>

        <!-- ===== GENEL TAB ===== -->
        <div v-if="statsTab === 'overview'">
          <!-- HAFTALIK ÖZET -->
          <div class="weekly-summary">
            <div class="ws-card">
              <div class="ws-label">📝 Soru</div>
              <div class="ws-value">{{ weeklySummary.questions.current }}</div>
              <div :class="weeklySummary.questions.current >= weeklySummary.questions.previous ? 'ws-up' : 'ws-down'">
                {{ weeklySummary.questions.current >= weeklySummary.questions.previous ? '▲' : '▼' }} Önceki: {{ weeklySummary.questions.previous }}
              </div>
            </div>
            <div class="ws-card">
              <div class="ws-label">💬 Cevap</div>
              <div class="ws-value">{{ weeklySummary.answered.current }}</div>
              <div :class="weeklySummary.answered.current >= weeklySummary.answered.previous ? 'ws-up' : 'ws-down'">
                {{ weeklySummary.answered.current >= weeklySummary.answered.previous ? '▲' : '▼' }} Önceki: {{ weeklySummary.answered.previous }}
              </div>
            </div>
            <div class="ws-card">
              <div class="ws-label">✅ Onay</div>
              <div class="ws-value">{{ weeklySummary.approved.current }}</div>
              <div :class="weeklySummary.approved.current >= weeklySummary.approved.previous ? 'ws-up' : 'ws-down'">
                {{ weeklySummary.approved.current >= weeklySummary.approved.previous ? '▲' : '▼' }} Önceki: {{ weeklySummary.approved.previous }}
              </div>
            </div>
          </div>

          <!-- DÖNEM KARŞILAŞTIRMA -->
          <div class="stats-comparison">
            <div class="kpi-item">
              📅 Bu dönem: <b>{{ periodComparison.current }}</b>
              | Önceki: <b>{{ periodComparison.previous }}</b>
              | <span :style="{ color: periodComparison.diff >= 0 ? '#16a085' : '#ef4444' }">
                {{ periodComparison.diff >= 0 ? '▲' : '▼' }} {{ Math.abs(periodComparison.diff) }} ({{ periodComparison.pct >= 0 ? '+' : '' }}{{ periodComparison.pct }}%)
              </span>
            </div>
          </div>

          <!-- ENGAGEMENT SKORU -->
          <div class="engagement-card">
            <div class="eng-grade" :style="{ background: engagementScore.score >= 60 ? 'var(--accent, #16a085)' : '#f59e0b' }">{{ engagementScore.grade }}</div>
            <div class="eng-details">
              <div class="eng-score-label">Etkileşim Skoru: <b>{{ engagementScore.score }}/100</b></div>
              <div class="eng-bar-wrap">
                <div class="eng-bar-fill" :style="{ width: engagementScore.score + '%', background: 'var(--accent, #16a085)' }"></div>
              </div>
              <div class="eng-mini-stats">
                <span>👥 Katılım: {{ engagementScore.participationRate }}%</span>
                <span>💬 Cevap: {{ engagementScore.answerRate }}%</span>
                <span>❤️ Beğeni: {{ engagementScore.likeRate }}%</span>
                <span>✅ Kabul: {{ engagementScore.acceptRate }}%</span>
              </div>
            </div>
          </div>

          <!-- SORU HUNİSİ -->
          <div class="funnel-section">
            <b>🔽 Soru Çözüm Hunisi</b>
            <div class="funnel-bars">
              <div v-for="f in funnelData" :key="f.label" class="funnel-step">
                <div class="funnel-bar" :style="{ width: f.pct + '%', backgroundColor: f.color }">
                  <span class="funnel-text">{{ f.label }}: {{ f.count }} ({{ f.pct }}%)</span>
                </div>
              </div>
            </div>
          </div>

          <!-- AKTİF KULLANICILAR + HEDEF TAHMİNİ -->
          <div class="stats-kpi" style="margin-top:8px;">
            <div class="kpi-item">👤 Günlük Aktif: <b>{{ activeUsers.dau }}</b> | Haftalık: <b>{{ activeUsers.wau }}</b> | Aylık: <b>{{ activeUsers.mau }}</b></div>
            <div class="kpi-item">📅 Hafta İçi: <b>{{ weekdayVsWeekend.weekday }}</b> | Hafta Sonu: <b>{{ weekdayVsWeekend.weekend }}</b></div>
            <div class="kpi-item">🔮 Hedef Tahmini: <b>{{ goalPrediction.date }}</b> <span v-if="!goalPrediction.reached && goalPrediction.daysLeft < Infinity">({{ goalPrediction.daysLeft }} gün)</span></div>
          </div>

          <div class="stats-kpi">
            <div class="kpi-item">🎯 Hedefe kalan: <b>{{ goalRemaining }}</b> ({{ goalPercent }}%)</div>
            <div class="kpi-item">✅ Onaylı: <b>{{ statsApproved.length }}</b> | ⏳ Beklemede: <b>{{ statsPending.length }}</b></div>
            <div class="kpi-item" v-if="avgResponseTime.count">⏱️ Ort. Yanıt: <b>{{ avgResponseTime.avg }}sa</b> (min: {{ avgResponseTime.min }}sa, max: {{ avgResponseTime.max }}sa)</div>
            <div class="kpi-item" v-if="approvalWaitTime.count">⏳ Onay Bekleme: <b>{{ approvalWaitTime.avg }}sa</b> (max: {{ approvalWaitTime.max }}sa, {{ approvalWaitTime.count }} soru)</div>
            <div class="kpi-item">📝 Ort. Soru Uzunluğu: <b>{{ questionQuality.avgLength }}</b> karakter</div>
          </div>

          <div class="stats-lists">
            <div class="stats-list"><b>Top Dersler</b><table class="stats-table"><thead><tr><th>#</th><th>Ders</th><th>Adet</th></tr></thead><tbody><tr v-for="(i, idx) in topSubjects" :key="idx"><td>{{ idx + 1 }}</td><td>{{ i[0] }}</td><td>{{ i[1] }}</td></tr></tbody></table></div>
            <div class="stats-list"><b>Top Sınıflar</b><table class="stats-table"><thead><tr><th>#</th><th>Sınıf</th><th>Adet</th></tr></thead><tbody><tr v-for="(i, idx) in topClasses" :key="idx"><td>{{ idx + 1 }}</td><td>{{ i[0] }}</td><td>{{ i[1] }}</td></tr></tbody></table></div>
            <div class="stats-list"><b>Top Soru Soran</b><table class="stats-table"><thead><tr><th>#</th><th>Öğrenci</th><th>Adet</th></tr></thead><tbody><tr v-for="(i, idx) in topAskers" :key="idx"><td>{{ idx + 1 }}</td><td>{{ i[0] }}</td><td>{{ i[1] }}</td></tr></tbody></table></div>
            <div class="stats-list"><b>Top Cevaplayan</b><table class="stats-table"><thead><tr><th>#</th><th>Öğretmen</th><th>Adet</th></tr></thead><tbody><tr v-for="(i, idx) in topResponders" :key="idx"><td>{{ idx + 1 }}</td><td>{{ i[0] }}</td><td>{{ i[1] }}</td></tr></tbody></table></div>
          </div>
        </div>

        <!-- ===== GRAFİKLER TAB ===== -->
        <div v-if="statsTab === 'charts'">
          <div class="charts-grid" v-if="chartReady">
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">📘 Derslere Göre</h4><component :is="PieChart" :data="subjectStatsData" :options="chartOptions" /></div>
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">🏫 Sınıflara Göre</h4><component :is="PieChart" :data="classStatsData" :options="chartOptions" /></div>
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">✅ Cevaplama Oranı</h4><component :is="DoughnutChart" :data="answerRatioData" :options="chartOptions" /></div>
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">🎯 Hedefe İlerleme</h4><component :is="BarChart" :data="goalData" :options="barChartOptions" /></div>
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">🕸️ Ders Dağılımı (Radar)</h4><component :is="RadarChart" :data="radarData" :options="radarOptions" /></div>
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">✅ Onay Durumu</h4><component :is="PieChart" :data="approvalStatsData" :options="chartOptions" /></div>
          </div>
          <div v-else style="text-align:center;padding:20px;color:#94a3b8;">Grafikler yükleniyor...</div>

          <!-- TREND + KÜMÜLATİF -->
          <div v-if="chartReady" class="charts-grid-2">
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">📈 Günlük Soru Trendi</h4><component :is="LineChart" :data="trendData" :options="trendChartOptions" /></div>
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">📊 Kümülatif Büyüme</h4><component :is="LineChart" :data="cumulativeData" :options="trendChartOptions" /></div>
          </div>

          <!-- BÜYÜME HIZI + ÖĞRETMEN CEVAP + SEGMENT -->
          <div v-if="chartReady" class="charts-grid-2" style="margin-top:10px;">
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">📈 Haftalık Büyüme Hızı</h4><component :is="LineChart" :data="growthRate" :options="growthRateOptions" /></div>
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">👨‍🏫 Öğretmen Cevap Dağılımı</h4><component :is="BarChart" :data="teacherBarData" :options="barChartOptions" /></div>
          </div>
          <div v-if="chartReady" class="charts-grid-2" style="margin-top:10px;">
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">🏷️ Sık Konu Etiketleri</h4>
              <component v-if="frequentTopics.length" :is="BarChart" :data="topicStatsData" :options="barChartOptions" />
              <div v-else style="color:#94a3b8;font-size:0.85rem;padding:12px;">Henüz konu etiketi yok. Yeni sorularda konu seçin.</div>
            </div>
            <div class="c-box">
              <h4 style="margin:0 0 8px; font-size:0.8rem;">📊 Moderasyon Oranları</h4>
              <div class="mod-stats-grid">
                <div class="mod-stat"><span class="mod-label">Onay</span><span class="mod-val" style="color:#16a085">{{ moderationStats.approveRate }}%</span></div>
                <div class="mod-stat"><span class="mod-label">Red</span><span class="mod-val" style="color:#ef4444">{{ moderationStats.rejectRate }}%</span></div>
                <div class="mod-stat"><span class="mod-label">Bekleyen</span><span class="mod-val" style="color:#f59e0b">{{ moderationStats.pending }}</span></div>
                <div class="mod-stat"><span class="mod-label">Cevap Onayı</span><span class="mod-val" style="color:#3b82f6">{{ moderationStats.answerApproved }}</span></div>
              </div>
            </div>
          </div>

          <!-- ISI HARİTASI -->
          <div class="c-box" style="margin-top:10px;">
            <h4 style="margin:0 0 8px; font-size:0.8rem;">🌡️ Soru Yoğunluk Haritası (Gün × Saat)</h4>
            <div class="heatmap-container">
              <div class="heatmap-row" v-for="(row, dayIdx) in heatmapData.grid" :key="dayIdx">
                <span class="heatmap-label">{{ heatmapData.dayNames[dayIdx] }}</span>
                <div v-for="(val, hour) in row" :key="hour" 
                  class="heatmap-cell" 
                  :style="{ backgroundColor: val ? `rgba(22,160,133,${Math.min(val / 5, 1)})` : 'rgba(0,0,0,0.05)' }"
                  :title="`${heatmapData.dayNames[dayIdx]} ${hour}:00 - ${val} soru`">
                  {{ val || '' }}
                </div>
              </div>
              <div class="heatmap-hours">
                <span class="heatmap-label"></span>
                <span v-for="h in 24" :key="h" class="heatmap-hour">{{ h - 1 }}</span>
              </div>
            </div>
          </div>
          <div v-if="chartReady" class="charts-grid-2" style="margin-top:10px;">
            <div class="c-box"><h4 style="margin:0 0 8px; font-size:0.8rem;">🎯 Öğrenci Segmentasyonu</h4><component :is="DoughnutChart" :data="segmentDoughnutData" :options="chartOptions" /></div>
          </div>
        </div>

        <!-- ===== KONULAR TAB (PEDAGOJİ) ===== -->
        <div v-if="statsTab === 'topics'">
          <div class="stats-kpi">
            <div class="kpi-item">🏷️ Etiketli soru oranı: <b>{{ anonymousScienceSummary.tagCoverage }}%</b> ({{ anonymousScienceSummary.tagged }}/{{ anonymousScienceSummary.total }})</div>
            <div class="kpi-item">📝 Öğrenme notu: <b>{{ anonymousScienceSummary.learnedNotes }}</b></div>
          </div>
          <div class="stats-list" v-if="frequentTopics.length">
            <b>🔥 Sık Konular / Pedagojik Odak</b>
            <table class="stats-table" style="margin-top:8px;">
              <thead><tr><th>#</th><th>Ders</th><th>Konu</th><th>Adet</th><th>Cevapsız</th><th>Bekleyen</th></tr></thead>
              <tbody>
                <tr v-for="(t, idx) in frequentTopics" :key="t.subject + t.topic">
                  <td>{{ idx + 1 }}</td>
                  <td>{{ t.subject }}</td>
                  <td><b>{{ t.topic }}</b></td>
                  <td>{{ t.count }}</td>
                  <td :style="{ color: t.unanswered ? '#ef4444' : '#16a085' }">{{ t.unanswered }}</td>
                  <td>{{ t.pending }}</td>
                </tr>
              </tbody>
            </table>
            <small style="color:#94a3b8;display:block;margin-top:6px;">Cevapsız yüksek konular zümre tekrarı / ders içi pekiştirme için önceliklidir.</small>
          </div>
          <div v-else style="text-align:center;padding:20px;color:#94a3b8;">Konu etiketli soru yok. Öğrenciler soru sorarken konu seçtikçe burası dolar.</div>
          <div v-if="chartReady && frequentTopics.length" class="c-box" style="margin-top:12px;">
            <h4 style="margin:0 0 8px;font-size:0.8rem;">Grafik: Sık Konular</h4>
            <component :is="BarChart" :data="topicStatsData" :options="barChartOptions" />
          </div>
        </div>

        <!-- ===== BİLİM / ANONİM ANALİTİK ===== -->
        <div v-if="statsTab === 'science'">
          <div class="stats-kpi">
            <div class="kpi-item">🔬 Örneklem: <b>{{ anonymousScienceSummary.total }}</b> soru (kişisel isim kullanılmaz)</div>
            <div class="kpi-item">✅ Cevap kabul oranı: <b>{{ anonymousScienceSummary.acceptRate }}%</b></div>
            <div class="kpi-item">🏷️ Konu kapsama: <b>{{ anonymousScienceSummary.tagCoverage }}%</b></div>
          </div>
          <div class="charts-grid-2" style="margin-top:10px;">
            <div class="stats-list">
              <b>📈 Yükselen konular (2. yarıda artış)</b>
              <table class="stats-table" v-if="anonymousScienceSummary.rising.length" style="margin-top:6px;">
                <thead><tr><th>Konu</th><th>1. yarı</th><th>2. yarı</th><th>Δ</th></tr></thead>
                <tbody>
                  <tr v-for="t in anonymousScienceSummary.rising" :key="'up'+t.topic">
                    <td>{{ t.topic }}</td><td>{{ t.firstHalf }}</td><td>{{ t.secondHalf }}</td>
                    <td style="color:#16a085;font-weight:700;">+{{ t.delta }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-else style="color:#94a3b8;padding:8px;font-size:0.85rem;">Yeterli etiketli zaman serisi yok.</div>
            </div>
            <div class="stats-list">
              <b>📉 Soğuyan konular (azalış — olası öğrenme kazanımı)</b>
              <table class="stats-table" v-if="anonymousScienceSummary.cooling.length" style="margin-top:6px;">
                <thead><tr><th>Konu</th><th>1. yarı</th><th>2. yarı</th><th>Δ</th></tr></thead>
                <tbody>
                  <tr v-for="t in anonymousScienceSummary.cooling" :key="'dn'+t.topic">
                    <td>{{ t.topic }}</td><td>{{ t.firstHalf }}</td><td>{{ t.secondHalf }}</td>
                    <td style="color:#3b82f6;font-weight:700;">{{ t.delta }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-else style="color:#94a3b8;padding:8px;font-size:0.85rem;">Yeterli veri yok.</div>
            </div>
          </div>
          <div class="stats-list" style="margin-top:10px;">
            <b>🌟 Katkı İndeksi (puan + kabul + teşekkür ağırlıklı)</b>
            <table class="stats-table" v-if="contributionLeaders.length" style="margin-top:6px;">
              <thead><tr><th>#</th><th>Öğrenci</th><th>Sınıf</th><th>Rozet</th><th>İndeks</th></tr></thead>
              <tbody>
                <tr v-for="(s, idx) in contributionLeaders" :key="s.id">
                  <td>{{ idx + 1 }}</td>
                  <td><b>{{ s.name }}</b></td>
                  <td>{{ s.cls }}</td>
                  <td>{{ s.badge }}</td>
                  <td><b style="color:var(--accent)">{{ s.index }}</b></td>
                </tr>
              </tbody>
            </table>
            <small style="color:#94a3b8;">İndeks = Puan + Soru×4 + Kabul×12 + Teşekkür×3</small>
          </div>
        </div>

        <!-- ===== ANALİZ TAB ===== -->
        <div v-if="statsTab === 'analysis'">
          <!-- DERS BAZLI YANIT SÜRESİ -->
          <div class="stats-list" v-if="subjectResponseTime.length">
            <b>⏱️ Ders Bazlı Yanıt Süreleri</b>
            <table class="stats-table">
              <thead><tr><th>Ders</th><th>Ort. Süre</th><th>Cevap</th></tr></thead>
              <tbody>
                <tr v-for="s in subjectResponseTime" :key="s.subject">
                  <td>{{ s.subject }}</td>
                  <td><b>{{ s.avg }}</b> saat</td>
                  <td>{{ s.count }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- SINIF KATILIM ORANI -->
          <div v-if="classParticipation.length" class="stats-list" style="margin-top:10px;">
            <b>🏫 Sınıf Katılım Oranları</b>
            <table class="stats-table">
              <thead><tr><th>Sınıf</th><th>Toplam</th><th>Aktif</th><th>Oran</th></tr></thead>
              <tbody>
                <tr v-for="cp in classParticipation" :key="cp.cls">
                  <td>{{ cp.cls }}</td>
                  <td>{{ cp.totalStudents }}</td>
                  <td>{{ cp.activeStudents }}</td>
                  <td>
                    <div class="participation-bar">
                      <div class="participation-fill" :style="{ width: cp.rate + '%', background: schoolSettings.styles.accentColor }"></div>
                      <span>{{ cp.rate }}%</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- SORU KALİTESİ -->
          <div class="stats-list" style="margin-top:10px;">
            <b>📝 Soru Kalitesi</b>
            <div class="stats-kpi" style="margin-top:6px;">
              <div class="kpi-item">Ort. Uzunluk: <b>{{ questionQuality.avgLength }}</b> karakter</div>
              <div class="kpi-item">En Çok Beğeni: <b>{{ questionQuality.maxLikes }}</b> ❤️</div>
            </div>
            <div v-if="questionQuality.topLiked.length" style="margin-top:8px;">
              <small><b>En Beğenilen Sorular:</b></small>
              <div v-for="q in questionQuality.topLiked" :key="q.id" class="top-liked-item">
                <span class="like-badge">❤️ {{ q.likes }}</span>
                <span>{{ (q.content || '').slice(0, 80) }}{{ (q.content || '').length > 80 ? '...' : '' }}</span>
                <small style="color:#94a3b8"> — {{ q.sender }}, {{ q.subject }}</small>
              </div>
            </div>
          </div>

          <!-- ONAY BEKLEME -->
          <div v-if="approvalWaitTime.count" class="stats-list" style="margin-top:10px;">
            <b>⏳ Onay Bekleyen Sorular</b>
            <div class="stats-kpi" style="margin-top:6px;">
              <div class="kpi-item">Bekleyen: <b>{{ approvalWaitTime.count }}</b></div>
              <div class="kpi-item">Ort. Bekleme: <b>{{ approvalWaitTime.avg }}sa</b></div>
              <div class="kpi-item">En Uzun: <b>{{ approvalWaitTime.max }}sa</b></div>
            </div>
          </div>

          <!-- SINIF × DERS KORELASYON MATRİSİ -->
          <div v-if="classSubjectMatrix.classes.length && classSubjectMatrix.subjects.length" class="stats-list" style="margin-top:10px;">
            <b>🔗 Sınıf × Ders Korelasyon Matrisi</b>
            <div class="matrix-container" style="margin-top:8px;">
              <table class="matrix-table">
                <thead>
                  <tr>
                    <th></th>
                    <th v-for="sub in classSubjectMatrix.subjects" :key="sub" class="matrix-header">{{ sub.length > 6 ? sub.slice(0, 6) + '…' : sub }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ci) in classSubjectMatrix.matrix" :key="ci">
                    <td class="matrix-label">{{ classSubjectMatrix.classes[ci] }}</td>
                    <td v-for="(val, si) in row" :key="si"
                      class="matrix-cell"
                      :style="{ backgroundColor: val ? `rgba(22,160,133,${Math.max(0.1, val / classSubjectMatrix.maxVal)})` : 'rgba(0,0,0,0.03)', color: val / classSubjectMatrix.maxVal > 0.5 ? '#fff' : '#333' }">
                      {{ val || '' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- CEVAP KALİTESİ METRİKLERİ -->
          <div class="stats-list" style="margin-top:10px;">
            <b>💎 Cevap Kalitesi</b>
            <div class="stats-kpi" style="margin-top:6px;">
              <div class="kpi-item">Toplam Cevaplanan: <b>{{ answerQuality.total }}</b></div>
              <div class="kpi-item">✅ Kabul Oranı: <b>{{ answerQuality.acceptRate }}%</b></div>
              <div class="kpi-item">🙏 Teşekkür Oranı: <b>{{ answerQuality.thankRate }}%</b></div>
            </div>
          </div>

          <!-- EN UZUN CEVAPSIZ SORULAR -->
          <div v-if="longestUnanswered.length" class="stats-list" style="margin-top:10px;">
            <b>🚨 En Uzun Cevapsız Sorular</b>
            <table class="stats-table" style="margin-top:6px;">
              <thead><tr><th>#</th><th>Soru</th><th>Ders</th><th>Sınıf</th><th>Bekleme</th></tr></thead>
              <tbody>
                <tr v-for="(q, idx) in longestUnanswered" :key="q.id || idx">
                  <td>{{ idx + 1 }}</td>
                  <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ (q.content || '').slice(0, 60) }}</td>
                  <td>{{ q.subject }}</td>
                  <td>{{ q.classLevel }}</td>
                  <td style="color:#ef4444;font-weight:600;">{{ q.waitHours }}sa</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ===== ÖĞRENCİ TAB ===== -->
        <div v-if="statsTab === 'students'">
          <!-- ÖĞRENCİ SEGMENTASYONU -->
          <div class="stats-list" style="margin-bottom:10px;">
            <b>🎯 Öğrenci Segmentasyonu</b>
            <div class="segment-cards">
              <div class="seg-card seg-active"><div class="seg-count">{{ studentSegments.active.length }}</div><div class="seg-label">Aktif (7 gün)</div></div>
              <div class="seg-card seg-moderate"><div class="seg-count">{{ studentSegments.moderate.length }}</div><div class="seg-label">Ilımlı (30 gün)</div></div>
              <div class="seg-card seg-inactive"><div class="seg-count">{{ studentSegments.inactive.length }}</div><div class="seg-label">Pasif (30g+)</div></div>
              <div class="seg-card seg-total"><div class="seg-count">{{ studentSegments.total }}</div><div class="seg-label">Toplam</div></div>
            </div>
          </div>

          <div class="stats-list" v-if="studentActivity.length">
            <b>🌟 Öğrenci Aktivite Skoru</b>
            <table class="stats-table">
              <thead><tr><th>#</th><th>Öğrenci</th><th>Sınıf</th><th>Soru</th><th>Beğeni</th><th>Skor</th></tr></thead>
              <tbody>
                <tr v-for="(s, idx) in studentActivity" :key="idx">
                  <td>{{ idx + 1 }}</td>
                  <td><b>{{ s.name }}</b></td>
                  <td>{{ s.cls }}</td>
                  <td>{{ s.questions }}</td>
                  <td>❤️ {{ s.likes }}</td>
                  <td><b style="color: var(--accent)">{{ s.score }}</b></td>
                </tr>
              </tbody>
            </table>
            <small style="color:#94a3b8;display:block;margin-top:4px;">Skor = Soru×10 + Beğeni×5</small>
          </div>
          <div class="stats-list" style="margin-top:12px;" v-if="contributionLeaders.length">
            <b>🌟 Katkı İndeksi Liderliği</b>
            <table class="stats-table" style="margin-top:6px;">
              <thead><tr><th>#</th><th>Öğrenci</th><th>Rozet</th><th>İndeks</th></tr></thead>
              <tbody>
                <tr v-for="(s, idx) in contributionLeaders.slice(0, 10)" :key="'c'+s.id">
                  <td>{{ idx + 1 }}</td>
                  <td>{{ s.name }}</td>
                  <td>{{ s.badge }}</td>
                  <td><b>{{ s.index }}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!studentActivity.length && !contributionLeaders.length" style="text-align:center;padding:20px;color:#94a3b8;">Henüz yeterli veri yok.</div>
        </div>

        <!-- ===== ÖĞRETMEN TAB ===== -->
        <div v-if="statsTab === 'teachers'">
          <div class="stats-list" v-if="teacherPerformance.length">
            <b>👨‍🏫 Öğretmen Performans Analizi</b>
            <table class="stats-table" style="margin-top:8px;">
              <thead><tr><th>#</th><th>Öğretmen</th><th>Cevap</th><th>Ort. Süre</th><th>Kabul %</th><th>🙏</th></tr></thead>
              <tbody>
                <tr v-for="(t, idx) in teacherPerformance" :key="idx">
                  <td>{{ idx + 1 }}</td>
                  <td><b>{{ t.name }}</b></td>
                  <td>{{ t.answers }}</td>
                  <td>{{ t.avgTime !== null ? t.avgTime + ' sa' : '—' }}</td>
                  <td>
                    <div class="participation-bar">
                      <div class="participation-fill" :style="{ width: t.acceptRate + '%', background: t.acceptRate >= 70 ? '#16a085' : t.acceptRate >= 40 ? '#f59e0b' : '#ef4444' }"></div>
                      <span>{{ t.acceptRate }}%</span>
                    </div>
                  </td>
                  <td>{{ t.thanks }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else style="text-align:center;padding:20px;color:#94a3b8;">Henüz öğretmen verisi yok.</div>
          <div class="stats-list" style="margin-top:12px;" v-if="frequentTopics.length">
            <b>🎯 Öğretmen Odak: Sık / Cevapsız Konular</b>
            <table class="stats-table" style="margin-top:8px;">
              <thead><tr><th>Ders</th><th>Konu</th><th>Adet</th><th>Cevapsız</th></tr></thead>
              <tbody>
                <tr v-for="t in frequentTopics.slice(0, 10)" :key="'teach'+t.subject+t.topic">
                  <td>{{ t.subject }}</td>
                  <td><b>{{ t.topic }}</b></td>
                  <td>{{ t.count }}</td>
                  <td :style="{ color: t.unanswered ? '#ef4444' : '#16a085', fontWeight: 700 }">{{ t.unanswered }}</td>
                </tr>
              </tbody>
            </table>
            <small style="color:#94a3b8;">Bu liste ders tekrarı ve etüt planı için kullanılabilir.</small>
          </div>
        </div>

        <!-- ===== ETKİLEŞİM TAB ===== -->
        <div v-if="statsTab === 'engagement'">
          <!-- ENGAGEMENT KART -->
          <div class="engagement-detail-card">
            <div class="eng-detail-header">
              <div class="eng-big-grade" :style="{ background: engagementScore.score >= 60 ? 'var(--accent, #16a085)' : '#f59e0b' }">{{ engagementScore.grade }}</div>
              <div>
                <h3 style="margin:0;">Okul Etkileşim Skoru</h3>
                <div class="eng-big-score">{{ engagementScore.score }}<small>/100</small></div>
              </div>
            </div>
            <div class="eng-breakdown">
              <div class="eng-factor"><span>👥 Katılım Oranı</span><div class="eng-factor-bar"><div :style="{ width: engagementScore.participationRate + '%' }"></div></div><b>{{ engagementScore.participationRate }}%</b></div>
              <div class="eng-factor"><span>💬 Cevaplama Oranı</span><div class="eng-factor-bar"><div :style="{ width: engagementScore.answerRate + '%' }"></div></div><b>{{ engagementScore.answerRate }}%</b></div>
              <div class="eng-factor"><span>❤️ Beğeni Oranı</span><div class="eng-factor-bar"><div :style="{ width: engagementScore.likeRate + '%' }"></div></div><b>{{ engagementScore.likeRate }}%</b></div>
              <div class="eng-factor"><span>✅ Kabul Oranı</span><div class="eng-factor-bar"><div :style="{ width: engagementScore.acceptRate + '%' }"></div></div><b>{{ engagementScore.acceptRate }}%</b></div>
            </div>
          </div>

          <!-- AKTİF KULLANICI -->
          <div class="stats-list" style="margin-top:10px;">
            <b>📊 Aktif Kullanıcı Metrikleri</b>
            <div class="segment-cards" style="margin-top:8px;">
              <div class="seg-card seg-active"><div class="seg-count">{{ activeUsers.dau }}</div><div class="seg-label">Günlük (DAU)</div></div>
              <div class="seg-card seg-moderate"><div class="seg-count">{{ activeUsers.wau }}</div><div class="seg-label">Haftalık (WAU)</div></div>
              <div class="seg-card seg-total"><div class="seg-count">{{ activeUsers.mau }}</div><div class="seg-label">Aylık (MAU)</div></div>
            </div>
          </div>

          <!-- SORU HUNİSİ DETAY -->
          <div class="stats-list" style="margin-top:10px;">
            <b>🔽 Soru Çözüm Hunisi (Detay)</b>
            <div class="funnel-detail">
              <div v-for="(f, idx) in funnelData" :key="f.label" class="funnel-detail-step">
                <div class="funnel-detail-bar" :style="{ width: f.pct + '%', minWidth: '60px', backgroundColor: f.color }">
                  {{ f.label }}
                </div>
                <div class="funnel-detail-info">
                  <b>{{ f.count }}</b> ({{ f.pct }}%)
                  <span v-if="idx > 0 && funnelData[idx - 1].count" class="funnel-drop">
                    ↓ {{ Math.round((1 - f.count / funnelData[idx - 1].count) * 100) }}% kayıp
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- HAFTA İÇİ vs SONU -->
          <div class="stats-list" style="margin-top:10px;">
            <b>📅 Hafta İçi vs Hafta Sonu</b>
            <div class="weekday-compare">
              <div class="wd-bar-group">
                <div class="wd-bar wd-weekday" :style="{ width: (weekdayVsWeekend.total ? weekdayVsWeekend.weekday / weekdayVsWeekend.total * 100 : 0) + '%' }">
                  Hafta İçi: {{ weekdayVsWeekend.weekday }}
                </div>
                <div class="wd-bar wd-weekend" :style="{ width: (weekdayVsWeekend.total ? weekdayVsWeekend.weekend / weekdayVsWeekend.total * 100 : 0) + '%' }">
                  Hafta Sonu: {{ weekdayVsWeekend.weekend }}
                </div>
              </div>
            </div>
          </div>

          <!-- HEDEF TAHMİNİ -->
          <div class="stats-list" style="margin-top:10px;">
            <b>🔮 Hedef Tahmin Analizi</b>
            <div class="stats-kpi" style="margin-top:6px;">
              <div class="kpi-item">Mevcut: <b>{{ statsQuestions.length }}</b> / Hedef: <b>{{ schoolSettings.questionGoal || 500 }}</b></div>
              <div class="kpi-item" v-if="goalPrediction.reached">🎉 <b style="color:#16a085">Hedefe ulaşıldı!</b></div>
              <div class="kpi-item" v-else>📅 Tahmini Ulaşma: <b>{{ goalPrediction.date }}</b> ({{ goalPrediction.daysLeft }} gün kaldı)</div>
            </div>
          </div>
        </div>
      </div>

      <div class="filter-row glass-premium">
        <select v-model="filterSubject">
          <option value="">Tüm Dersler</option>
          <option v-for="s in schoolSettings.subjects" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="filterClass">
          <option value="">Tüm Sınıflar</option>
          <option v-for="c in schoolSettings.classes" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-model="filterApproval">
          <option value="all">Tümü</option>
          <option value="approved">Onaylı</option>
          <option value="pending">Onaysız</option>
          <option value="rejected">Reddedilen</option>
        </select>
        <select v-model="filterDate">
          <option value="all">Tüm Tarihler</option>
          <option value="7d">Son 7 gün</option>
          <option value="30d">Son 30 gün</option>
          <option value="90d">Son 90 gün</option>
        </select>
      </div>

      <div v-if="currentUser && (notifications.length || sortedInboxNotifications.length)" class="notif-box glass-premium">
        <div class="notif-header">
          <b>Bildirimler<span v-if="unreadInboxCount"> ({{ unreadInboxCount }} yeni)</span></b>
          <div class="row-flex" style="gap: 6px;">
            <button v-if="unreadInboxCount" class="btn-tiny ok" @click="markAllInboxNotificationsRead">Tümünü Okundu</button>
            <button v-if="notifications.length" class="btn-tiny no" @click="notifications = []">Canlıyı Kapat</button>
          </div>
        </div>
        <div v-for="entry in sortedInboxNotifications.slice(0, 5)" :key="entry.id" class="notif-item" :class="{ unread: !entry.read }">
          <div>
            <b>{{ entry.title }}</b>
            <div>{{ entry.message }}</div>
            <small v-if="entry.reason">Gerekçe: {{ entry.reason }}</small>
          </div>
          <div class="log-meta">
            <small>{{ formatDateTime(entry.createdAt) }}</small>
            <button v-if="!entry.read" class="btn-tiny ok" @click="markInboxNotificationRead(entry.id)">Okundu</button>
          </div>
        </div>
        <div v-for="(n, i) in notifications.slice(0, 5)" :key="`live-${i}`" class="notif-item">
          <div>• {{ n }}</div>
        </div>
      </div>

      <div v-if="offlineStatusText && (!isBrowserOnline || !currentUser)" class="offline-box glass-premium">
        <b>{{ isBrowserOnline ? 'Çevrimdışı hazır' : 'Çevrimdışı mod' }}</b>
        <div>{{ offlineStatusText }}</div>
      </div>

      <div v-if="needsTeacherSubjectAssignment" class="visitor-alert-box">
        <p>📌 Hesabınıza henüz ders ataması yapılmamış.</p>
        <p>Bir yönetici size ders tanımladığında ilgili sorular için onay bildirimi alacaksınız.</p>
      </div>

      <div v-else-if="(isLeadershipUser() || (isTeacherUser() && !teacherIsOffline)) && relevantPendingQuestions.length" class="notif-box glass-premium">
        <div class="notif-header">
          <b>Onay Bekleyen Ders Soruları</b>
        </div>
        <div v-for="q in relevantPendingQuestions.slice(0, 5)" :key="q.id">• {{ q.subject }}: "{{ (q.content || '').slice(0, 70) }}..."</div>
      </div>

      <div class="search-bar"><label class="sr-only" for="main-search">Soru ara</label><input id="main-search" v-model="searchQuery" placeholder="🔍 Konu, öğrenci veya sınıf ara..." class="search-input"></div>
      
      <button v-if="currentUser" @click="showAskModal = true" class="btn-ask-compact" :style="{ backgroundColor: schoolSettings.styles.accentColor }">
        ➕ YENİ SORU SOR
      </button>

      <div v-else class="visitor-alert-box">
        <p>📢 <b>Soru ve cevapları inceleyebilirsiniz.</b></p>
        <p>Soru sormak veya cevap yazmak için lütfen giriş yapın.</p>
        <button @click="showAuthModal = true" class="btn-login-alert">GİRİŞ YAP / KAYIT OL</button>
      </div>

      <div class="feed">
        <div v-for="q in paginatedQuestions" :key="q.id" class="post-card compact glass-premium" :class="{pending: !q.isApproved && !q.isRejected, rejected: q.isRejected}">
          <div class="post-header">
            <div class="badges">
              <span class="badge" :style="{ backgroundColor: q.isApproved ? schoolSettings.styles.accentColor : q.isRejected ? '#dc2626' : '#f59e0b' }">{{ q.subject }}</span>
              <span v-if="q.classLevel" class="badge-class">{{ q.classLevel }}</span>
              <span v-if="q.topicTag" class="badge-topic">🏷️ {{ q.topicTag }}</span>
              <span v-if="q.answerAccepted" class="badge-status ok">✅ Çözüldü</span>
              <span v-else-if="q.cevap && q.answerApproved" class="badge-status wait">💬 Cevaplı</span>
              <span v-else-if="!q.isApproved && !q.isRejected" class="badge-status pending">⏳ Onay</span>
            </div>
            <div class="meta">
              <b>{{ q.sender }}</b> <small>({{ q.senderClass || 'Genel' }})</small>
            </div>
          </div>
          <div v-if="editingQuestionId === q.id" class="post-body">
            <textarea v-model="editQuestionText[q.id]" rows="3"></textarea>
            <div class="actions-compact">
              <button @click="saveEditQuestion(q)" class="btn-tiny ok">✔ Kaydet</button>
              <button @click="editingQuestionId=null" class="btn-tiny no">✖ İptal</button>
            </div>
          </div>
          <p v-else class="post-body">{{ q.content }}</p>
          <div v-if="q.isRejected && userCanSeeQuestion(q)" class="moderation-note rejected-note">
            <b>Reddedildi</b>
            <div>{{ q.rejectionReason || 'Gerekçe belirtilmedi.' }}</div>
            <small v-if="q.rejectedByName">İşlem: {{ q.rejectedByName }}</small>
          </div>
          <div v-else-if="!q.isApproved && !q.isRejected && currentUser?.id === q.senderId" class="moderation-note pending-note">
            <b>Onay bekliyor</b>
            <div>Sorunuz öğretmen veya yönetici onayına düştü.</div>
          </div>
          <div v-if="q.isApproved" class="interactions">
            <button @click="likeQuestion(q)" class="btn-like" :disabled="hasLikedQuestion(q.id)">
              {{ hasLikedQuestion(q.id) ? '❤️ Beğenildi' : '❤️ Beğen' }} {{ q.likes || 0 }}
            </button>
          </div>

          <div v-if="canModerateQuestion(q) && !q.isApproved" class="actions-compact">
            <button @click="onayIslem(q, 'soru')" class="btn-tiny ok">✔ Onayla</button>
            <button @click="onayIslem(q, 'sil')" class="btn-tiny no">✖ Reddet</button>
          </div>
          <div v-if="currentUser && (currentUser.id === q.senderId || isLeadershipUser() || canModerateQuestion(q))" class="actions-compact">
            <button @click="startEditQuestion(q)" class="btn-tiny send">✏️ Düzenle</button>
          </div>

          <div v-if="q.cevap" class="answer-box compact-ans" :style="{ borderLeftColor: q.answerApproved ? schoolSettings.styles.accentColor : '#f59e0b' }">
            <div class="ans-head">💡 <b>{{ q.respondent }}:</b> 
              <span v-if="q.answerApproved" class="app-tag">✓</span>
              <span v-if="q.answerAccepted" class="app-tag">Çözüm</span>
            </div>
            <div v-if="editingAnswerId === q.id">
              <textarea v-model="editAnswerText[q.id]" rows="3"></textarea>
              <div class="actions-compact">
                <button @click="saveEditAnswer(q)" class="btn-tiny ok">✔ Kaydet</button>
                <button @click="editingAnswerId=null" class="btn-tiny no">✖ İptal</button>
              </div>
            </div>
            <p v-else>{{ q.cevap }}</p>
            <div v-if="q.learnedNote" class="learned-note">📘 Öğrenci notu: {{ q.learnedNote }}</div>
            <div class="actions-compact">
              <button v-if="canModerateQuestion(q) && !q.answerApproved" @click="onayIslem(q, 'cevap')" class="btn-tiny ok">✔ Onayla</button>
              <button v-if="canModerateQuestion(q)" @click="rejectAnswer(q)" class="btn-tiny no">✖ Reddet</button>
              <button v-if="currentUser && (currentUser.id === q.respId || isLeadershipUser() || canModerateQuestion(q))" @click="startEditAnswer(q)" class="btn-tiny send">✏️ Düzenle</button>
              <div v-if="currentUser && currentUser.id === q.senderId && q.answerApproved && !q.answerAccepted" class="accept-block">
                <input v-model="learnNoteDrafts[q.id]" class="input-tiny" maxlength="300" placeholder="Ne öğrendim? (opsiyonel)" />
                <button @click="acceptAnswer(q)" class="btn-tiny ok">✅ Çözüm Kabul</button>
              </div>
              <button
                v-if="currentUser && q.answerApproved"
                @click="thankAnswer(q)"
                class="btn-tiny send"
                :disabled="hasThankedAnswer(q.id)"
              >
                {{ hasThankedAnswer(q.id) ? '🙏 Gönderildi' : '🙏 Teşekkür' }} ({{ q.answerThanks || 0 }})
              </button>
            </div>
          </div>

          <div v-if="currentUser && q.isApproved && !q.cevap" class="reply-compact">
            <input v-model="answerText[q.id]" placeholder="Yanıt..." class="input-tiny">
            <button @click="handleSendAnswer(q)" class="btn-tiny send" :style="{background:schoolSettings.styles.accentColor}">➤</button>
          </div>
        </div>
      </div>

      <div v-if="totalPages > 1" class="pagination">
        <button @click="changePage(currentPage - 1)" :disabled="currentPage === 1">❮</button>
        <span>{{ currentPage }} / {{ totalPages }}</span>
        <button @click="changePage(currentPage + 1)" :disabled="currentPage === totalPages">❯</button>
      </div>
    </main>

    <footer class="footer-wrapper">
      <div class="center-column marquee-box glass-premium" :style="{ backgroundColor: schoolSettings.styles.footerBg || schoolSettings.styles.headerBg, color: schoolSettings.styles.footerText, borderColor: schoolSettings.styles.accentColor }">
        <div class="marquee-content">
          🏆 LİDERLİK TABLOSU: 
          <span v-for="(s, index) in students.slice(0, 10)" :key="s.id" style="margin-right: 15px;">
             <span v-if="index === 0">🥇</span>
             <span v-else-if="index === 1">🥈</span>
             <span v-else-if="index === 2">🥉</span>
             <span v-else>{{ index + 1 }}.</span>
             {{ s.name }} ({{ getUserBadge(s.points) }} - {{ s.points || 0 }}P) | 
          </span>
        </div>
      </div>
    </footer>

    <div v-if="showAuthModal" class="modal-overlay">
      <div class="modal-box">
        <div class="tabs">
          <button @click="authTab='login'" :class="{active:authTab=='login'}">Giriş</button>
          <button @click="authTab='register'" :class="{active:authTab=='register'}">Kayıt</button>
        </div>

        <div v-if="authTab=='login'">
          <h3>Giriş Yap</h3>
          <input v-model="loginForm.email" type="email" placeholder="E-posta Adresi" autocomplete="username">
          <input v-model="loginForm.password" type="password" placeholder="Şifre" autocomplete="current-password">
          <button type="button" @click="handleEmailLogin" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">📧 E-POSTA İLE GİRİŞ</button>
          <button type="button" @click="handlePasswordReset" class="btn-forgot-password">🔑 Şifremi unuttum — sıfırlama maili gönder</button>
          <small class="auth-hint">E-posta adresini yazıp “Şifremi unuttum”a basın. Bağlantı gelen kutunuza (veya spam’e) düşer.</small>
        </div>

        <div v-else>
          <div class="register-tabs">
            <button @click="registerTab='student'" :class="{active:registerTab=='student'}">👨‍🎓 Öğrenci</button>
            <button @click="registerTab='teacher'" :class="{active:registerTab=='teacher'}">👨‍🏫 Öğretmen</button>
          </div>

          <div v-if="registerTab=='student'">
            <h3>Öğrenci Kaydı</h3>
            <input v-model="registerForm.name" placeholder="Ad Soyad">
            <input v-model="registerForm.email" type="email" placeholder="E-posta">
            <input v-model="registerForm.password" type="password" placeholder="Şifre">
            <input v-model="registerForm.confirmPassword" type="password" placeholder="Şifreyi Onayla">
            <select v-model="registerForm.class">
              <option value="" disabled selected>Sınıf Seçiniz</option>
              <option v-for="c in schoolSettings.classes" :key="c" :value="c">{{ c }}</option>
            </select>
            <input v-model="registerForm.number" placeholder="Okul Numarası">
            <button @click="handleStudentRegister" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">📚 KAYIT OL</button>
          </div>

          <div v-else>
            <h3>Öğretmen Kaydı</h3>
            <input v-model="registerForm.name" placeholder="Adı Soyadı">
            <input v-model="registerForm.email" type="email" placeholder="Okul E-postası (zorunlu)">
            <input v-model="registerForm.password" type="password" placeholder="Şifre">
            <input v-model="registerForm.confirmPassword" type="password" placeholder="Şifreyi Onayla">
            <small>Not: Admin tarafından onayınızı bekleyeceksiniz.</small>
            <button @click="handleTeacherRegister" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">☑️ ÖĞRETMEN KAYDI</button>
          </div>
        </div>

        <button @click="showAuthModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <div v-if="showPasswordModal && currentUser" class="modal-overlay">
      <div class="modal-box">
        <h3>🔒 Şifre Değiştir</h3>
        <input v-model="passwordForm.currentPassword" type="password" placeholder="Mevcut şifre">
        <input v-model="passwordForm.newPassword" type="password" placeholder="Yeni şifre">
        <input v-model="passwordForm.confirmPassword" type="password" placeholder="Yeni şifre (tekrar)">
        <button @click="handleChangePassword" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">Şifreyi Güncelle</button>
        <button @click="showPasswordModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <div v-if="showAskModal && currentUser" class="modal-overlay">
      <div class="modal-box">
        <h3>❓ Soru Sor</h3>
        
        <div v-if="similarQuestionFound" class="ai-warning">
          🤖 <b>Yapay Zeka Uyarısı:</b> Benzer sorular bulundu!
          <div v-for="(q, i) in similarQuestions" :key="q.id" style="margin-top: 4px;">
            <i>{{ i + 1 }}. "{{ q.content.substring(0, 60) }}..."</i>
          </div>
        </div>

        <select v-model="newQuestion.subject">
          <option value="" disabled selected>Ders Seçiniz</option>
          <option v-for="s in schoolSettings.subjects" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="newQuestion.classLevel">
          <option value="" disabled selected>Sınıf Seviyesi</option>
          <option v-for="c in schoolSettings.classes" :key="c" :value="c">{{ c }}</option>
        </select>
        <div v-if="newQuestion.subject" class="topic-picker">
          <label>Konu / kazanım (pedagojik etiket)</label>
          <div class="topic-chips">
            <button
              v-for="tag in topicSuggestions"
              :key="tag"
              type="button"
              class="topic-chip"
              :class="{ active: newQuestion.topicTag === tag }"
              @click="pickTopicSuggestion(tag)"
            >{{ tag }}</button>
          </div>
          <input
            v-model="topicTagCustom"
            maxlength="40"
            placeholder="Veya kendi konu etiketinizi yazın…"
            @input="newQuestion.topicTag = topicTagCustom"
          />
        </div>
        <textarea v-model="newQuestion.content" placeholder="Sorunuzu buraya yazın..." rows="4"></textarea>
        <button @click="handleCreateQuestion" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">GÖNDER</button>
        <button @click="showAskModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <div v-if="showDesignModal && canOpenDesign" class="modal-overlay">
      <div class="modal-box large">
        <h3>🎨 Tasarım Stüdyosu</h3>

        <!-- TEMA PRESET'LERİ -->
        <div class="s-section" style="border-left: 4px solid #0f8f78;">
          <h4>🖼️ Hazır Tema Paketleri</h4>
          <p class="theme-help">Okul kimliğine uygun paletler. Birini seç → canlı önizleme → “Tasarımı Mühürle”.</p>
          <div class="theme-presets-grid">
            <button
              v-for="(preset, key) in themePresets"
              :key="key"
              type="button"
              class="theme-preset-card"
              :class="{ recommended: key === 'akademik' }"
              @click="applyThemePreset(key)"
            >
              <span class="theme-swatch-row">
                <i :style="{ background: preset.headerBg }"></i>
                <i :style="{ background: preset.accentColor }"></i>
                <i :style="{ background: preset.bgColor }"></i>
              </span>
              <strong>{{ preset.label }}</strong>
              <small>{{ preset.blurb }}</small>
            </button>
          </div>
        </div>
        
        <div class="s-section" style="border-left: 4px solid #f39c12;">
          <h4>📏 Başlık Ayarları</h4>
          <label>Font:</label>
          <select v-model="schoolSettings.styles.titleFont">
            <option value="'Inter', sans-serif">Modern</option>
            <option value="'Georgia', serif">Klasik</option>
            <option value="'Impact', sans-serif">Kalın</option>
            <option value="'Trebuchet MS', sans-serif">Teknik</option>
          </select>
          <label>Boyut:</label>
          <input type="range" v-model="schoolSettings.styles.titleSize" min="16" max="40">
          <label>Renk:</label>
          <input type="color" v-model="schoolSettings.styles.titleColor" style="width:100%; height:35px;">
        </div>

        <div class="s-section">
          <h4>🔤 Genel Font Ayarları</h4>
          <input v-model="schoolSettings.styles.customFontUrl" placeholder="Google Fonts Linki (opsiyonel)">
          <input v-model="schoolSettings.styles.customFontName" placeholder="Font Adı (opsiyonel)">
          <label>Temel Yazı Boyutu: {{ schoolSettings.styles.baseFontSize }}px</label>
          <input type="range" v-model="schoolSettings.styles.baseFontSize" min="12" max="20">
        </div>

        <div class="s-section">
          <h4>🎨 Renkler</h4>
          <div class="color-grid">
            <div>
              <label>Banner Arka Planı:</label>
              <input type="color" v-model="schoolSettings.styles.headerBg">
            </div>
            <div>
              <label>Banner Yazısı:</label>
              <input type="color" v-model="schoolSettings.styles.headerText">
            </div>
            <div>
              <label>Buton Rengi (Vurgu):</label>
              <input type="color" v-model="schoolSettings.styles.accentColor">
            </div>
            <div>
              <label>Gövde Yazı Rengi:</label>
              <input type="color" v-model="schoolSettings.styles.bodyText">
            </div>
            <div>
              <label>Alt Bar Arka Planı:</label>
              <input type="color" v-model="schoolSettings.styles.footerBg">
            </div>
            <div>
              <label>Alt Bar Yazısı:</label>
              <input type="color" v-model="schoolSettings.styles.footerText">
            </div>
            <div>
              <label>Sayfa Arka Planı:</label>
              <input type="color" v-model="schoolSettings.styles.bgColor">
            </div>
            <div>
              <label>Köşe Yuvarlaklığı: {{ schoolSettings.styles.cardRadius }}px</label>
              <input type="range" v-model.number="schoolSettings.styles.cardRadius" min="0" max="28" style="height:auto;">
            </div>
          </div>
        </div>

        <div class="s-section" style="border-left: 4px solid #3b82f6;">
          <h4>🌙 Mod</h4>
          <label class="auto-save-toggle">
            <input type="checkbox" v-model="schoolSettings.styles.darkMode"> Koyu Mod
          </label>
        </div>

        <!-- CANLI ÖNİZLEME -->
        <div class="s-section" style="border-left: 4px solid #10b981;">
          <h4>👁️ Canlı Önizleme</h4>
          <div class="design-preview" :class="{ 'dark-mode': schoolSettings.styles.darkMode }" :style="{ background: schoolSettings.styles.bgColor, borderRadius: schoolSettings.styles.cardRadius + 'px' }">
            <div class="preview-header" :style="{ background: schoolSettings.styles.headerBg, color: schoolSettings.styles.headerText, borderRadius: schoolSettings.styles.cardRadius + 'px ' + schoolSettings.styles.cardRadius + 'px 0 0' }">
              <span :style="{ fontFamily: schoolSettings.styles.titleFont, fontSize: (schoolSettings.styles.titleSize * 0.6) + 'px', color: schoolSettings.styles.titleColor }">DİJİTAL İMECE</span>
            </div>
            <div class="preview-body" :style="{ color: schoolSettings.styles.bodyText, background: schoolSettings.styles.darkMode ? '#1e293b' : '#fff' }">
              <div class="preview-card" :style="{ borderRadius: schoolSettings.styles.cardRadius + 'px', borderLeft: '3px solid ' + schoolSettings.styles.accentColor }">
                <span style="font-size:0.7rem;">📘 Matematik</span>
                <p style="font-size:0.65rem; margin:4px 0;">Örnek soru metni burada görünür...</p>
                <button class="preview-btn" :style="{ background: schoolSettings.styles.accentColor }">Cevapla</button>
              </div>
            </div>
            <div class="preview-footer" :style="{ background: schoolSettings.styles.footerBg, color: schoolSettings.styles.footerText, borderRadius: '0 0 ' + schoolSettings.styles.cardRadius + 'px ' + schoolSettings.styles.cardRadius + 'px' }">
              <span style="font-size:0.6rem;">🏫 Liderler Tablosu</span>
            </div>
          </div>
        </div>

        <button @click="saveAll" class="btn-save-final" :style="{ backgroundColor: schoolSettings.styles.accentColor }">🎨 TASARIMI MÜHÜRLE</button>
        <button @click="showDesignModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <div v-if="showSettingsModal && canOpenSettings" class="modal-overlay">
      <div class="modal-box large">
        <h3>⚙️ Yönetim Paneli</h3>
        <div class="settings-tabs">
          <button @click="settingsTab='overview'" :class="{ active: settingsTab === 'overview' }">Genel</button>
          <button @click="settingsTab='people'" :class="{ active: settingsTab === 'people' }">Kullanıcılar</button>
          <button @click="settingsTab='notifications'" :class="{ active: settingsTab === 'notifications' }">Bildirim</button>
          <button @click="settingsTab='imports'" :class="{ active: settingsTab === 'imports' }">İçe Aktar</button>
          <button @click="settingsTab='history'" :class="{ active: settingsTab === 'history' }">Geçmiş</button>
        </div>

        <div v-if="settingsTab === 'overview'" class="s-section">
          <h4>🟢 Online Kullanıcı</h4>
          <div class="row-flex">
            <div class="online-info">
              <b>{{ currentUser?.name || 'Bilinmiyor' }}</b>
              <small>{{ getRoleLabel(currentUser?.role || '') }}</small>
            </div>
            <div class="time-chip">🕒 {{ nowText || new Date().toLocaleString('tr-TR') }}</div>
          </div>
          <div class="row-flex" style="margin-top: 8px;">
            <label class="auto-save-toggle">
              <input type="checkbox" v-model="autoSaveEnabled">
              Otomatik Kaydet
            </label>
            <button class="btn-snap" @click="reloadSettingsFromServer">Son Kaydı Yükle</button>
          </div>
        </div>

        <div v-if="canEditCriticalSettings() && settingsTab === 'overview'" class="s-section safe-zone" style="border-left: 4px solid #e74c3c;">
          <h4>🔒 Güvenlik & Yedekleme</h4>
          <div class="row-flex">
            <button @click="createSnapshot" class="btn-snap">📸 Snapshot Al</button>
            <button @click="restoreSnapshot" class="btn-roll">⏮️ Geri Dön</button>
          </div>
          <div class="restore-zone">
            <label class="btn-restore-file">📤 YEDEK YÜKLE <input type="file" @change="handleRestoreJSON" hidden accept=".json"></label>
          </div>
        </div>

        <div v-if="settingsTab === 'overview'" class="s-section">
          <h4>🏫 Okul Bilgileri</h4>
          <label>Okul Adı:</label>
          <input v-model="schoolSettings.name">
          <label>Duyuru:</label>
          <textarea v-model="schoolSettings.announcement" rows="2"></textarea>
          <label>🎯 Soru Hedefi:</label>
          <input v-model.number="schoolSettings.questionGoal" type="number" min="1" placeholder="500">
          <label>Logo URL:</label>
          <input v-model="schoolSettings.logo">
          <div class="row-flex">
            <label class="btn-restore-file" style="margin: 0;">
              🖼️ Logo Seç (PC)
              <input type="file" @change="handleLogoUpload" hidden accept="image/*">
            </label>
            <button @click="saveAll" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">💾 Logo ve Bilgileri Kaydet</button>
          </div>
        </div>

        <div v-if="settingsTab === 'overview'" class="s-section">
          <h4>📖 Ders Yönetimi</h4>
          <div class="row-flex">
            <input v-model="newSubject" placeholder="Yeni Ders Adı">
            <button @click="addSubject" class="btn-add">➕</button>
          </div>
          <div class="tag-list">
            <span v-for="(s,i) in schoolSettings.subjects" :key="i" class="tag-item">
              {{s}} <b @click="deleteSubject(i)" style="cursor:pointer;">✕</b>
            </span>
          </div>
        </div>

        <div v-if="settingsTab === 'overview'" class="s-section">
          <h4>👥 Sınıf Yönetimi</h4>
          <div class="row-flex">
            <input v-model="newClass" placeholder="Yeni Sınıf Adı">
            <button @click="addClass" class="btn-add">➕</button>
          </div>
          <div class="tag-list">
            <span v-for="(c,i) in schoolSettings.classes" :key="i" class="tag-item">
              {{c}} <b @click="deleteClass(i)" style="cursor:pointer;">✕</b>
            </span>
          </div>
        </div>

        <div v-if="settingsTab === 'people'" class="s-section">
          <h4>🧭 Filtreli Onay Masası</h4>
          <div class="approval-toolbar">
            <select v-model="approvalQueueType">
              <option value="all">Tümü</option>
              <option value="question">Sorular</option>
              <option value="student">Öğrenciler</option>
              <option value="teacher">Öğretmenler</option>
            </select>
            <select v-model="approvalQueueSubject">
              <option value="">Tüm Dersler</option>
              <option v-for="s in schoolSettings.subjects" :key="`queue-subject-${s}`" :value="s">{{ s }}</option>
            </select>
            <select v-model="approvalQueueClass">
              <option value="">Tüm Sınıflar</option>
              <option v-for="c in schoolSettings.classes" :key="`queue-class-${c}`" :value="c">{{ c }}</option>
            </select>
            <input v-model="approvalQueueSearch" placeholder="İsim, e-posta veya içerik ara">
            <button class="btn-snap" @click="clearApprovalQueueFilters">Temizle</button>
          </div>
          <div class="approval-pills">
            <span class="approval-pill">Toplam {{ approvalQueueCounts.all }}</span>
            <span class="approval-pill">Soru {{ approvalQueueCounts.question }}</span>
            <span class="approval-pill">Öğrenci {{ approvalQueueCounts.student }}</span>
            <span class="approval-pill">Öğretmen {{ approvalQueueCounts.teacher }}</span>
          </div>
          <div v-if="approvalQueueEntries.length" class="approval-list">
            <div v-for="entry in approvalQueueEntries.slice(0, 12)" :key="entry.id" class="approval-row">
              <div class="approval-main">
                <div class="approval-title">
                  <span class="approval-kind" :class="entry.kind">{{ entry.kindLabel }}</span>
                  <b>{{ entry.title }}</b>
                </div>
                <div>{{ entry.subtitle }}</div>
                <small>{{ entry.meta }}</small>
              </div>
              <div class="approval-side">
                <small>{{ formatDateTime(entry.createdAt) }}</small>
                <div class="actions-compact">
                  <template v-if="entry.kind === 'question'">
                    <button @click="onayIslem(entry.data, 'soru')" class="btn-tiny ok">✓ Onayla</button>
                    <button @click="onayIslem(entry.data, 'sil')" class="btn-tiny no">✕ Reddet</button>
                  </template>
                  <template v-else-if="entry.kind === 'student'">
                    <button @click="approveStudent(entry.data.id)" class="btn-tiny ok">✓ Onayla</button>
                    <button @click="deleteStudent(entry.data.id)" class="btn-tiny no">✕ Pasife Al</button>
                  </template>
                  <template v-else>
                    <button @click="approveTeacher(entry.data.id)" class="btn-tiny ok">✓ Onayla</button>
                    <button @click="rejectTeacher(entry.data.id)" class="btn-tiny no">✕ Pasife Al</button>
                  </template>
                </div>
              </div>
            </div>
            <div v-if="approvalQueueEntries.length > 12" class="empty-msg">… ve {{ approvalQueueEntries.length - 12 }} kayıt daha</div>
          </div>
          <div v-else class="empty-msg">Filtreye uyan onay bekleyen kayıt yok ✓</div>
        </div>

        <div v-if="settingsTab === 'people'" class="s-section">
          <h4>👨‍🎓 Öğrenci Yönetimi</h4>
          <label>Onaylı Öğrenciler:</label>
          <div v-for="s in students.filter(x => x.isApproved)" :key="s.id" class="stu-row">
            <div><b>{{ s.name }}</b> <small>({{ s.class }})</small></div>
            <div>
              <button @click="deleteStudent(s.id)" class="btn-tiny no">🗑️ Pasife Al</button>
            </div>
          </div>
        </div>

        <div v-if="settingsTab === 'people'" class="s-section">
          <h4>➕ Yönetici ile Öğrenci Ekle</h4>
          <input v-model="adminStudentForm.name" placeholder="Ad Soyad">
          <input v-model="adminStudentForm.email" type="email" placeholder="E-posta">
          <input v-model="adminStudentForm.password" type="password" placeholder="Şifre">
          <select v-model="adminStudentForm.class">
            <option value="" disabled selected>Sınıf Seçiniz</option>
            <option v-for="c in schoolSettings.classes" :key="c" :value="c">{{ c }}</option>
          </select>
          <input v-model="adminStudentForm.number" placeholder="Okul Numarası">
          <button @click="handleAdminCreateStudent" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">➕ ÖĞRENCİ EKLE</button>
        </div>

        <div v-if="settingsTab === 'people'" class="s-section">
          <h4>👥 Personel Yönetimi</h4>
          <small>Ogretmenler sadece soru ve istatistik ekranlarini kullanir. Yonetici ve admin tum sistemi gorur.</small>
          <label style="margin-top: 10px;">Onaylı Personel:</label>
          <div v-for="t in teachers.filter(x => x.isApproved)" :key="t.id" class="stu-row">
            <div>
              <b>{{ t.name }}</b> <small>({{ t.email }})</small>
              <small>Rol: {{ getRoleLabel(t.role) }}</small>
              <div class="tag-list" style="margin-top: 6px;">
                <button
                  v-for="subject in schoolSettings.subjects"
                  :key="subject"
                  type="button"
                  class="btn-tiny"
                  :class="teacherSubjectDrafts[t.id]?.includes(subject) ? 'ok' : 'send'"
                  @click="toggleTeacherSubject(t.id, subject)"
                  :disabled="t.role !== 'teacher'"
                >
                  {{ subject }}
                </button>
              </div>
              <small>Atanan dersler: {{ t.role === 'teacher' ? ((teacherSubjectDrafts[t.id] || []).join(', ') || 'Henüz yok') : 'Yonetici rollerinde ders atamasi gerekmez' }}</small>
            </div>
            <div>
              <button v-if="t.role === 'teacher'" @click="saveTeacherSubjects(t.id)" class="btn-tiny ok">💾 Dersleri Kaydet</button>
              <div v-if="canEditCriticalSettings()" class="actions-compact">
                <button @click="setStaffRole(t, 'teacher')" class="btn-tiny send">Ogretmen</button>
                <button @click="setStaffRole(t, 'manager')" class="btn-tiny ok">Yonetici</button>
                <button @click="setStaffRole(t, 'admin')" class="btn-tiny ok">Admin</button>
              </div>
              <button @click="rejectTeacher(t.id)" class="btn-tiny no">🗑️ Pasife Al</button>
            </div>
          </div>
        </div>

        <div v-if="settingsTab === 'notifications'" class="s-section">
          <h4>✉️ Öğretmen E-posta Bildirimleri</h4>
          <small>Bu alan sadece onaylı kullanıcılara açık özel ayarda tutulur. Mümkünse kurumsal/branş e-postaları kullanın.</small>
          <label class="auto-save-toggle" style="margin-top: 8px;">
            <input type="checkbox" v-model="teacherNotificationSettings.enabled">
            Ders öğretmenine otomatik e-posta gönder
          </label>
          <input v-model="teacherNotificationSettings.serviceId" placeholder="EmailJS Service ID">
          <input v-model="teacherNotificationSettings.templateId" placeholder="EmailJS Template ID">
          <input v-model="teacherNotificationSettings.publicKey" placeholder="EmailJS Public Key">
          <input v-model="teacherNotificationSettings.fromName" placeholder="Gönderen Adı">
          <input v-model="teacherNotificationSettings.siteUrl" placeholder="Yönlendirme URL'si (boşsa mevcut site)">
          <div class="row-flex" style="margin-top: 8px;">
            <button class="btn-snap" @click="fillTeacherNotificationRecipientsFromTeachers">Öğretmenlerden Doldur</button>
            <button class="btn-save-final" @click="saveTeacherNotificationSettings" :style="{background:schoolSettings.styles.accentColor}">💾 E-posta Ayarını Kaydet</button>
          </div>
          <small style="display:block; margin-top:8px;">
            EmailJS template değişkenleri: <code>to_email</code>, <code>question_subject</code>, <code>class_level</code>, <code>student_name</code>, <code>student_class</code>, <code>question_preview</code>, <code>moderation_url</code>, <code>subject_line</code>
          </small>
          <div v-for="subject in schoolSettings.subjects" :key="`mail-${subject}`" class="notif-recipient-row">
            <label>{{ subject }}</label>
            <input
              v-model="teacherNotificationSettings.recipientMap[subject]"
              @change="normalizeTeacherNotificationRecipient(subject)"
              placeholder="ornek@okul.k12.tr, ikinci@okul.k12.tr"
            >
          </div>
        </div>

        <div v-if="settingsTab === 'imports'" class="s-section">
          <h4>📥 Toplu Üye Yükleme</h4>
          <label>Rol Seçin:</label>
          <select v-model="bulkRole">
            <option value="student">Öğrenci</option>
            <option value="teacher">Öğretmen</option>
          </select>
          <small>Desteklenen formatlar: CSV. Başlıklar: ad_soyad, email, sinif, numara, sifre</small>
          <div class="row-flex">
            <a class="btn-restore-file" href="/ornek_ogrenciler.csv" download style="margin: 0;">📄 Öğrenci Örnek CSV</a>
            <a class="btn-restore-file" href="/ornek_ogretmenler.csv" download style="margin: 0;">📄 Öğretmen Örnek CSV</a>
          </div>
          <div class="row-flex">
            <label class="btn-restore-file" style="margin: 0;">
              📄 Dosya Seç
              <input type="file" @change="(e) => handleBulkImport(e, bulkRole)" hidden accept=".csv,.tsv,.txt">
            </label>
            <button class="btn-add" @click="downloadBulkTemplate(bulkRole)" title="Şablon indir">⬇️</button>
          </div>
          <small v-if="bulkImporting">Yükleme sürüyor, lütfen bekleyin...</small>
          <div v-if="bulkPending.length" class="bulk-preview">
            <div class="bulk-summary">
              <b>Önizleme:</b> Toplam {{ bulkPreviewStats.total }} kayıt.
            </div>
            <div class="approval-pills">
              <span class="approval-pill">Hazır {{ bulkPreviewStats.ready }}</span>
              <span class="approval-pill">Engelli {{ bulkPreviewStats.blocked }}</span>
              <span class="approval-pill">Yeni {{ bulkPreviewStats.create }}</span>
              <span class="approval-pill">Güncelle {{ bulkPreviewStats.update }}</span>
              <span class="approval-pill">Geri Aç {{ bulkPreviewStats.restore }}</span>
            </div>
            <div class="bulk-list">
              <div v-for="row in bulkPending.slice(0, 12)" :key="`${row.email}-${row.rowNumber}`" class="bulk-row">
                <div class="bulk-row-main">
                  <div class="approval-title">
                    <span class="bulk-badge" :class="row.tone">{{ row.actionLabel }}</span>
                    <b>#{{ row.rowNumber }} {{ row.name }}</b>
                  </div>
                  <div>{{ row.email }} | {{ row.class || '-' }} | {{ row.number || '-' }}</div>
                  <small v-if="row.hints?.length">Not: {{ row.hints.join(' | ') }}</small>
                  <div v-if="row.issues?.length" class="bulk-errors">
                    <div v-for="(issue, idx) in row.issues" :key="`${row.email}-issue-${idx}`">• {{ issue }}</div>
                  </div>
                </div>
              </div>
              <div v-if="bulkPending.length > 12">… ve {{ bulkPending.length - 12 }} kayıt daha</div>
            </div>
            <div class="row-flex" style="margin-top: 6px;">
              <button
                class="btn-save-final"
                @click="runBulkImport"
                :disabled="!bulkPreviewStats.ready"
                :style="{background:schoolSettings.styles.accentColor}"
              >
                ✅ Hazır {{ bulkPreviewStats.ready }} Kaydı Başlat
              </button>
            </div>
          </div>
          <div v-if="!bulkImporting && (bulkReport.ok || bulkReport.fail || bulkReport.errors.length)" class="bulk-report">
            <div class="bulk-summary">
              <b>Sonuç:</b> Başarılı: {{ bulkReport.ok }} | Onarılan: {{ bulkReport.repaired || 0 }} | Hatalı: {{ bulkReport.fail }}
            </div>
            <div v-if="bulkReport.errors.length" class="bulk-errors">
              <b>Uyarılar:</b>
              <div v-for="(e, i) in bulkReport.errors" :key="i">• {{ e }}</div>
            </div>
            <div v-if="bulkReport.failures.length" class="bulk-errors">
              <b>Hatalı Kayıtlar:</b>
              <div v-for="(f, i) in bulkReport.failures" :key="i">• {{ f }}</div>
            </div>
          </div>
        </div>

        <div v-if="systemErrors.length && settingsTab === 'notifications'" class="s-section">
          <h4>⚠️ Sistem Hataları</h4>
          <div class="bulk-errors">
            <div v-for="(e, i) in systemErrors.slice(0, 5)" :key="i">• {{ e }}</div>
          </div>
        </div>

        <div v-if="visibleModerationLogs.length && settingsTab === 'history'" class="s-section">
          <h4>🕓 İşlem Geçmişi</h4>
          <div class="log-list">
            <div v-for="entry in visibleModerationLogs.slice(0, 12)" :key="entry.id" class="log-row">
              <div>
                <b>{{ getModerationLogTitle(entry) }}</b>
                <div>{{ entry.targetLabel }}</div>
                <small v-if="entry.reason">Gerekçe: {{ entry.reason }}</small>
                <small v-else-if="entry.details">{{ entry.details }}</small>
              </div>
              <div class="log-meta">
                <small>{{ entry.actorName }}</small>
                <small>{{ entry.subject || entry.classLevel || '-' }}</small>
                <small>{{ formatDateTime(entry.createdAt) }}</small>
              </div>
            </div>
          </div>
        </div>

        <button @click="saveAll" class="btn-save-final" :style="{ backgroundColor: schoolSettings.styles.accentColor }">💾 AYARLARI KAYDET</button>
        <button @click="showSettingsModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <div v-if="showTeacherSettingsModal && canOpenSettings" class="modal-overlay">
      <div class="modal-box large">
        <h3>📚 Ders / Sınıf Yönetimi</h3>

        <div class="s-section">
          <h4>📖 Ders Yönetimi</h4>
          <div class="row-flex">
            <input v-model="newSubject" placeholder="Yeni Ders Adı">
            <button @click="addSubject" class="btn-add">➕</button>
          </div>
          <div class="tag-list">
            <span v-for="(s,i) in schoolSettings.subjects" :key="i" class="tag-item">
              {{s}} <b @click="deleteSubject(i)" style="cursor:pointer;">✕</b>
            </span>
          </div>
        </div>

        <div class="s-section">
          <h4>👥 Sınıf Yönetimi</h4>
          <div class="row-flex">
            <input v-model="newClass" placeholder="Yeni Sınıf Adı">
            <button @click="addClass" class="btn-add">➕</button>
          </div>
          <div class="tag-list">
            <span v-for="(c,i) in schoolSettings.classes" :key="i" class="tag-item">
              {{c}} <b @click="deleteClass(i)" style="cursor:pointer;">✕</b>
            </span>
          </div>
        </div>

        <div v-if="currentUser?.role === 'teacher'" class="s-section">
          <h4>🧭 Filtreli Onay Masası</h4>
          <div class="approval-toolbar">
            <select v-model="approvalQueueType">
              <option value="all">Tümü</option>
              <option value="question">Sorular</option>
              <option value="student">Öğrenciler</option>
            </select>
            <select v-model="approvalQueueSubject">
              <option value="">Tüm Dersler</option>
              <option v-for="s in schoolSettings.subjects" :key="`teacher-queue-subject-${s}`" :value="s">{{ s }}</option>
            </select>
            <select v-model="approvalQueueClass">
              <option value="">Tüm Sınıflar</option>
              <option v-for="c in schoolSettings.classes" :key="`teacher-queue-class-${c}`" :value="c">{{ c }}</option>
            </select>
            <input v-model="approvalQueueSearch" placeholder="İsim veya içerik ara">
            <button class="btn-snap" @click="clearApprovalQueueFilters">Temizle</button>
          </div>
          <div class="approval-pills">
            <span class="approval-pill">Toplam {{ approvalQueueCounts.all }}</span>
            <span class="approval-pill">Soru {{ approvalQueueCounts.question }}</span>
            <span class="approval-pill">Öğrenci {{ approvalQueueCounts.student }}</span>
          </div>
          <div v-if="approvalQueueEntries.length" class="approval-list">
            <div v-for="entry in approvalQueueEntries.slice(0, 12)" :key="entry.id" class="approval-row">
              <div class="approval-main">
                <div class="approval-title">
                  <span class="approval-kind" :class="entry.kind">{{ entry.kindLabel }}</span>
                  <b>{{ entry.title }}</b>
                </div>
                <div>{{ entry.subtitle }}</div>
                <small>{{ entry.meta }}</small>
              </div>
              <div class="approval-side">
                <small>{{ formatDateTime(entry.createdAt) }}</small>
                <div class="actions-compact">
                  <template v-if="entry.kind === 'question'">
                    <button @click="onayIslem(entry.data, 'soru')" class="btn-tiny ok">✓ Onayla</button>
                    <button @click="onayIslem(entry.data, 'sil')" class="btn-tiny no">✕ Reddet</button>
                  </template>
                  <template v-else>
                    <button @click="approveStudent(entry.data.id)" class="btn-tiny ok">✓ Onayla</button>
                    <button @click="deleteStudent(entry.data.id)" class="btn-tiny no">✕ Pasife Al</button>
                  </template>
                </div>
              </div>
            </div>
            <div v-if="approvalQueueEntries.length > 12" class="empty-msg">… ve {{ approvalQueueEntries.length - 12 }} kayıt daha</div>
          </div>
          <div v-else class="empty-msg">Filtreye uyan onay bekleyen kayıt yok ✓</div>
        </div>

        <div v-if="visibleModerationLogs.length" class="s-section">
          <h4>🕓 Son İşlemler</h4>
          <div class="log-list">
            <div v-for="entry in visibleModerationLogs.slice(0, 8)" :key="entry.id" class="log-row">
              <div>
                <b>{{ getModerationLogTitle(entry) }}</b>
                <div>{{ entry.targetLabel }}</div>
                <small v-if="entry.reason">Gerekçe: {{ entry.reason }}</small>
                <small v-else-if="entry.details">{{ entry.details }}</small>
              </div>
              <div class="log-meta">
                <small>{{ entry.actorName }}</small>
                <small>{{ entry.subject || entry.classLevel || '-' }}</small>
                <small>{{ formatDateTime(entry.createdAt) }}</small>
              </div>
            </div>
          </div>
        </div>

        <button @click="saveSubjectsClasses" class="btn-save-final" :style="{ backgroundColor: schoolSettings.styles.accentColor }">💾 DERS/SINIF KAYDET</button>
        <button @click="showTeacherSettingsModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <div v-if="moderationDialog.open" class="modal-overlay">
      <div class="modal-box" style="max-width: 520px;">
        <h3>{{ moderationDialog.title }}</h3>
        <p style="margin-bottom: 12px; color: #334155;">{{ moderationDialog.message }}</p>
        <label>{{ moderationDialog.reasonLabel }}</label>
        <textarea
          v-model="moderationDialog.reason"
          rows="4"
          :placeholder="moderationDialog.reasonPlaceholder"
        ></textarea>
        <div class="actions-compact">
          <button @click="submitModerationDialog" class="btn-tiny ok">{{ moderationDialog.confirmLabel }}</button>
          <button @click="closeModerationDialog" class="btn-tiny no">İptal</button>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="app-container">
    <div class="center-column glass-premium" style="padding:16px; text-align:center;">
      Ayarlar yükleniyor...
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Playfair+Display:wght@600;700;800&display=swap');

* { box-sizing: border-box; }

/* Screen reader only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.visitor-alert-box {
  background: #f8f9fa;
  border: 2px dashed #6c757d;
  padding: 15px;
  border-radius: 12px;
  text-align: center;
  margin: 15px auto;
  max-width: 600px;
}

.visitor-alert-box p {
  margin: 5px 0;
  color: #343a40;
}

.btn-login-alert {
  background: #28a745; /* Yeşil tonu */
  color: white;
  border: none;
  padding: 8px 20px;
  border-radius: 20px;
  cursor: pointer;
  font-weight: bold;
  margin-top: 10px;
}
.app-container { 
  min-height: 100vh; 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  background:
    radial-gradient(920px 580px at 12% -8%, color-mix(in srgb, var(--accent, #0f8f78) 30%, transparent), transparent 62%),
    radial-gradient(780px 520px at 100% 4%, color-mix(in srgb, var(--footer-text, #e8c468) 16%, transparent), transparent 58%),
    radial-gradient(720px 480px at 48% 108%, color-mix(in srgb, var(--accent, #0f8f78) 12%, transparent), transparent 60%),
    linear-gradient(180deg, var(--bg-color, #101b2d) 0%, color-mix(in srgb, var(--bg-color, #111827) 88%, white) 55%, var(--bg-color, #101b2d) 100%);
  background-attachment: fixed; 
}

.app-container.dark-mode .glass-premium {
  background: rgba(30, 41, 59, 0.92);
  color: #e2e8f0;
}
.app-container.dark-mode .post-card {
  background: #1e293b;
  color: #e2e8f0;
  border-color: rgba(255,255,255,0.08);
}
.app-container.dark-mode .post-card:hover {
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.4);
}
.app-container.dark-mode .modal-box {
  background: #1e293b;
  color: #e2e8f0;
}
.app-container.dark-mode .modal-box h3 {
  color: #f1f5f9;
}
.app-container.dark-mode .s-section {
  background: #334155;
  color: #e2e8f0;
}
.app-container.dark-mode input,
.app-container.dark-mode select,
.app-container.dark-mode textarea {
  background: #0f172a;
  color: #e2e8f0;
  border-color: rgba(255,255,255,0.12);
}
.app-container.dark-mode .c-box,
.app-container.dark-mode .kpi-item,
.app-container.dark-mode .stats-list,
.app-container.dark-mode .ws-card {
  background: #1e293b;
  color: #e2e8f0;
  border-color: rgba(255,255,255,0.08);
}
.app-container.dark-mode .stats-tabs button {
  color: #94a3b8;
}
.app-container.dark-mode .stats-tabs button.active {
  color: var(--accent, #16a085);
  background: rgba(22, 160, 133, 0.15);
}
.app-container.dark-mode .heatmap-cell {
  color: #fff;
}
.app-container.dark-mode .participation-bar {
  background: rgba(255,255,255,0.1);
}
.app-container.dark-mode .participation-bar span {
  color: #e2e8f0;
}
.app-container.dark-mode .stats-table th {
  background: var(--accent, #16a085);
}
.app-container.dark-mode .stats-table td {
  border-bottom-color: rgba(255,255,255,0.06);
}
.app-container.dark-mode .answer-box {
  background: #0f172a;
  color: #e2e8f0;
}
.app-container.dark-mode .filter-row select {
  background: #0f172a;
  color: #e2e8f0;
}
.app-container.dark-mode .pagination {
  color: #e2e8f0;
}
.app-container.dark-mode .btn-close-final {
  background: #334155;
  color: #e2e8f0;
}

.center-column { 
  width: 92%; 
  max-width: 650px; 
  margin: 0 auto; 
}

.glass-premium { 
  background: rgba(255, 255, 255, 0.92); 
  backdrop-filter: blur(14px); 
  border-radius: var(--card-radius, 14px); 
  border: 1px solid rgba(255,255,255,0.25); 
  box-shadow: 0 20px 50px rgba(2, 6, 23, 0.25), 0 0 0 1px rgba(255,255,255,0.18), 0 0 40px rgba(255, 200, 150, 0.08);
  animation: floatIn 0.6s ease-out both;
}

.ai-warning { 
  background: #fff3cd; 
  color: #856404; 
  padding: 8px; 
  border-radius: 8px; 
  font-size: 0.8rem; 
  margin-bottom: 10px; 
  border: 1px solid #ffeeba; 
}

/* NAVBARs */
.navbar-wrapper { 
  width: 100%; 
  position: sticky; 
  top: 0; 
  z-index: 1000; 
  padding: 5px 0; 
}

.banner-box { 
  display: grid; 
  grid-template-columns: 60px 1fr auto; 
  align-items: center; 
  padding: 8px 16px; 
  border-bottom: 3px solid; 
}

.logo-fixed { 
  height: 52px; 
  border-radius: 10px; 
  box-shadow: 0 8px 18px rgba(0,0,0,0.2);
}

.brand-info-center { 
  text-align: center; 
}

.grand-title { 
  margin: 0; 
  font-family: 'Playfair Display', serif;
  font-weight: 800; 
  letter-spacing: 1px; 
  text-transform: uppercase;
}

.grand-subtitle { 
  font-size: 0.78rem; 
  margin: 0; 
  opacity: 0.92; 
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.nav-actions { 
  display: flex; 
  gap: 5px; 
  justify-content: flex-end; 
}

.icon-btn { 
  background: rgba(255,255,255,0.12); 
  border: 1px solid rgba(255,255,255,0.2);
  font-size: 1.1rem; 
  cursor: pointer; 
  color: white; 
  padding: 6px 8px;
  border-radius: 10px;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.icon-btn:hover {
  transform: translateY(-1px);
  background: rgba(255,255,255,0.18);
  box-shadow: 0 6px 14px rgba(2, 6, 23, 0.25);
}

.btn-login-main { 
  color: white; 
  padding: 8px 16px; 
  border-radius: 16px; 
  font-size: 0.75rem; 
  border: none; 
  font-weight: 800; 
  cursor: pointer; 
  box-shadow: 0 8px 18px rgba(0,0,0,0.2);
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.btn-login-main:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(0,0,0,0.25);
  filter: saturate(1.05);
}

.user-pill { 
  padding: 5px 10px; 
  border-radius: 16px; 
  display: flex; 
  align-items: center; 
  gap: 6px; 
  background: rgba(0,0,0,0.25); 
  color: white; 
  font-size: 0.75rem; 
  font-weight: 800; 
}

.role-badge {
  font-size: 1rem;
}

.logout-btn { 
  background: none; 
  border: none; 
  color: white; 
  cursor: pointer; 
  font-weight: bold;
  padding: 0;
}

/* MODALs */
.modal-overlay { 
  position: fixed; 
  inset: 0; 
  background: rgba(0,0,0,0.8); 
  display: flex; 
  justify-content: center; 
  align-items: center; 
  z-index: 2000; 
  overflow-y: auto;
  padding: 10px;
}

.modal-box { 
  background: white; 
  padding: 25px; 
  border-radius: 18px; 
  width: 90%; 
  max-width: 480px; 
  max-height: 85vh; 
  overflow-y: auto; 
  color: #0f172a; 
  box-shadow: 0 30px 70px rgba(2, 6, 23, 0.35);
}

.modal-box.large {
  max-width: 550px;
}

.modal-box h3 {
  margin-top: 0;
  color: #1e293b;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.tabs { 
  display: flex; 
  margin-bottom: 15px; 
  border-bottom: 2px solid #e2e8f0;
}

.tabs button { 
  flex: 1; 
  padding: 10px; 
  border: none; 
  background: none; 
  cursor: pointer; 
  font-weight: bold; 
  color: #64748b;
}

.tabs button.active { 
  border-bottom: 3px solid var(--accent, #16a085); 
  color: var(--accent, #16a085);
  margin-bottom: -2px;
}

.register-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

.register-tabs button {
  flex: 1;
  padding: 10px;
  border: 2px solid #e2e8f0;
  background: white;
  border-radius: 8px;
  cursor: pointer;
  font-weight: bold;
  transition: all 0.3s;
}

.register-tabs button.active {
  background: var(--accent, #16a085);
  color: white;
  border-color: var(--accent, #16a085);
}

/* FEED */
.main-content { 
  padding: 16px 0 24px; 
  flex: 1; 
}

.announcement-box { 
  color: white; 
  padding: 10px; 
  border-radius: 12px; 
  margin-bottom: 12px; 
  font-weight: 800; 
  font-size: 0.82rem; 
  text-align: center; 
  box-shadow: 0 10px 20px rgba(2, 6, 23, 0.25);
  animation: floatIn 0.65s ease-out both;
}

.search-bar { 
  margin-bottom: 10px; 
}

.search-input { 
  width: 100%; 
  padding: 12px 14px; 
  border-radius: 16px; 
  border: 1px solid rgba(2,6,23,0.08); 
  box-shadow: 0 8px 20px rgba(2,6,23,0.12); 
  font-weight: 700; 
}

.btn-ask-compact { 
  width: 100%; 
  padding: 12px; 
  color: white; 
  border: none; 
  font-weight: 900; 
  border-radius: 12px; 
  margin-bottom: 15px; 
  cursor: pointer; 
  box-shadow: 0 10px 22px rgba(2,6,23,0.25);
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.btn-ask-compact:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 28px rgba(2,6,23,0.28);
  filter: saturate(1.06);
}

.feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100px;
}

.post-card { 
  padding: 14px; 
  border-radius: var(--card-radius, 14px); 
  border: 1px solid rgba(2,6,23,0.08); 
  background: white; 
  box-shadow: 0 12px 24px rgba(2, 6, 23, 0.1), 0 0 32px rgba(255, 220, 180, 0.08);
  animation: floatIn 0.55s ease-out both;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.post-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 18px 36px rgba(2, 6, 23, 0.2), 0 0 38px rgba(255, 210, 170, 0.18);
}

.post-card.pending {
  border-left: 4px solid #f59e0b;
}

.post-card.rejected {
  border-left: 4px solid #dc2626;
}

.post-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-start;
  margin-bottom: 8px; 
}

.badges { 
  display: flex; 
  gap: 5px; 
  flex-wrap: wrap;
}

.badge { 
  color: white; 
  padding: 4px 10px; 
  border-radius: 12px; 
  font-size: 0.65rem; 
  font-weight: 800; 
  letter-spacing: 0.2px;
}

.badge-class { 
  background: #0f172a; 
  color: white; 
  padding: 3px 8px; 
  border-radius: 8px; 
  font-size: 0.65rem; 
  font-weight: 700; 
}

.badge-topic {
  background: #ecfeff;
  color: #0e7490;
  border: 1px solid #a5f3fc;
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 0.65rem;
  font-weight: 700;
}

.badge-status {
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 0.62rem;
  font-weight: 800;
}
.badge-status.ok { background: #d1fae5; color: #065f46; }
.badge-status.wait { background: #e0e7ff; color: #3730a3; }
.badge-status.pending { background: #fef3c7; color: #92400e; }

.topic-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
}
.topic-picker label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #334155;
}
.topic-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.topic-chip {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #0f172a;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}
.topic-chip.active {
  background: #0f766e;
  border-color: #0f766e;
  color: #fff;
}
.learned-note {
  margin-top: 8px;
  padding: 8px 10px;
  background: #f0fdfa;
  border: 1px dashed #5eead4;
  border-radius: 8px;
  font-size: 0.82rem;
  color: #115e59;
}
.accept-block {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
  margin-top: 4px;
}
.accept-block .input-tiny {
  flex: 1;
  min-width: 160px;
}

.meta { 
  font-size: 0.75rem; 
  text-align: right; 
  line-height: 1.2; 
}

.post-body { 
  font-size: 0.92rem; 
  margin: 8px 0; 
  line-height: 1.5; 
}

.moderation-note {
  margin: 8px 0;
  padding: 10px;
  border-radius: 10px;
  font-size: 0.8rem;
}

.pending-note {
  background: #fff7ed;
  border: 1px solid rgba(245, 158, 11, 0.2);
  color: #92400e;
}

.rejected-note {
  background: #fef2f2;
  border: 1px solid rgba(220, 38, 38, 0.15);
  color: #991b1b;
}

.interactions {
  margin: 8px 0;
}

.btn-like { 
  background: none; 
  border: 1px solid #e74c3c; 
  color: #e74c3c; 
  padding: 2px 8px; 
  border-radius: 10px; 
  cursor: pointer; 
  font-size: 0.7rem; 
  font-weight: bold; 
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.btn-like:hover {
  transform: translateY(-1px);
  background: rgba(231, 76, 60, 0.08);
  box-shadow: 0 6px 12px rgba(2,6,23,0.12);
}

.btn-like:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.actions-compact { 
  display: flex; 
  gap: 5px; 
  margin-top: 8px; 
}

.btn-tiny { 
  padding: 4px 10px; 
  border-radius: 5px; 
  border: none; 
  font-weight: bold; 
  font-size: 0.7rem; 
  cursor: pointer; 
  color: white; 
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.btn-tiny:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(2,6,23,0.12);
  filter: brightness(1.03);
}

.btn-tiny:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
  filter: none;
}

.ok { background: #27ae60; }
.no { background: #e74c3c; }
.send { color: white; }

.answer-box { 
  margin-top: 8px; 
  padding: 8px; 
  border-radius: 8px; 
  border-left: 4px solid; 
  font-size: 0.85rem; 
  background: #f8fafc; 
}

.ans-head {
  font-weight: bold;
  margin-bottom: 5px;
}

.app-tag {
  background: #27ae60;
  color: white;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.7rem;
}

.reply-compact { 
  display: flex; 
  gap: 5px; 
  margin-top: 8px; 
}

.input-tiny { 
  flex: 1; 
  padding: 5px; 
  border: 1px solid #ddd; 
  border-radius: 5px; 
  font-size: 0.8rem; 
}

.pagination { 
  display: flex; 
  justify-content: center; 
  gap: 10px; 
  margin-top: 15px; 
  padding: 10px; 
  background: rgba(255,255,255,0.12); 
  border-radius: 20px; 
  color: white; 
  font-weight: 800; 
  backdrop-filter: blur(6px);
}

.pagination button { 
  background: white; 
  border: none; 
  padding: 5px 12px; 
  border-radius: 5px; 
  cursor: pointer; 
  font-weight: bold; 
}

.pagination button:disabled { 
  opacity: 0.5; 
  cursor: not-allowed; 
}

/* FOOTER */
.footer-wrapper { 
  width: 100%; 
  position: sticky; 
  bottom: 0; 
  z-index: 1000; 
  padding: 5px 0; 
}

.marquee-box {
  display: flex;
  align-items: center;
  padding: 10px;
  border-top: 3px solid;
  width: 92%;
  max-width: 650px;
  margin: 0 auto;
  overflow: hidden;
  position: relative;
  border-radius: 12px;
  box-shadow: 0 12px 28px rgba(2, 6, 23, 0.25);
}

.marquee-content { 
  display: inline-block; 
  white-space: nowrap; 
  padding-left: 100%; 
  animation: scroll 35s linear infinite; 
  font-weight: 700; 
  font-size: 0.75rem; 
}

@keyframes scroll { 
  0% { transform: translateX(0); } 
  100% { transform: translateX(-100%); } 
}

/* SETTINGS PANEL */
.stats-panel { 
  padding: 14px; 
  margin-bottom: 16px; 
  overflow: hidden;
  max-width: 100%;
  box-sizing: border-box;
}

.stats-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
  gap: 6px;
}

.s-btns { 
  display: flex; 
  gap: 5px;
  flex-wrap: wrap;
  align-items: center;
}

.stats-select {
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid rgba(2,6,23,0.2);
  font-size: 0.7rem;
}

.btn-xs { 
  padding: 4px 8px; 
  font-size: 0.6rem; 
  cursor: pointer; 
  background: var(--accent, #16a085);
  color: white;
  border: none;
  border-radius: 4px;
  font-weight: bold;
}

.btn-xs:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.admin-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  margin-bottom: 10px;
}

.admin-clock {
  margin-left: auto;
  font-size: 0.75rem;
  font-weight: 800;
  color: #0f172a;
  background: rgba(2, 6, 23, 0.06);
  border: 1px solid rgba(2, 6, 23, 0.1);
  padding: 6px 10px;
  border-radius: 12px;
}

.settings-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.settings-tabs button {
  border: 1px solid rgba(2, 6, 23, 0.08);
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  cursor: pointer;
}

.settings-tabs button.active {
  background: #0f766e;
  color: white;
  border-color: #0f766e;
}

.charts-grid { 
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 10px; 
}

.charts-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}

.c-box { 
  background: white; 
  padding: 12px; 
  border-radius: var(--card-radius, 14px); 
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  box-shadow: 0 10px 20px rgba(2, 6, 23, 0.1);
  animation: floatIn 0.6s ease-out both;
}

.stats-kpi {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.stats-comparison {
  margin-bottom: 10px;
}

/* STATS TABS */
.stats-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 2px solid rgba(0,0,0,0.06);
  padding-bottom: 6px;
  flex-wrap: wrap;
}
.stats-tabs button {
  padding: 6px 12px;
  border: none;
  background: transparent;
  border-radius: 8px 8px 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
}
.stats-tabs button.active {
  color: var(--accent, #16a085);
  background: rgba(22, 160, 133, 0.1);
  border-bottom: 2px solid var(--accent, #16a085);
}

/* WEEKLY SUMMARY */
.weekly-summary {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}
.ws-card {
  background: #fff;
  border: 1px solid rgba(2,6,23,0.08);
  border-radius: 10px;
  padding: 10px;
  text-align: center;
}
.ws-label { font-size: 0.7rem; color: #64748b; font-weight: 600; }
.ws-value { font-size: 1.5rem; font-weight: 800; color: var(--accent, #16a085); }
.ws-up { font-size: 0.65rem; color: #16a085; font-weight: 600; }
.ws-down { font-size: 0.65rem; color: #ef4444; font-weight: 600; }

/* HEATMAP */
.heatmap-container { overflow-x: auto; }
.heatmap-row { display: flex; gap: 2px; margin-bottom: 2px; align-items: center; }
.heatmap-label { width: 28px; font-size: 0.6rem; font-weight: 700; color: #64748b; text-align: right; flex-shrink: 0; }
.heatmap-cell {
  width: 20px; height: 20px; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.5rem; font-weight: 700; color: #fff;
  cursor: default;
}
.heatmap-hours { display: flex; gap: 2px; }
.heatmap-hour { width: 20px; text-align: center; font-size: 0.5rem; color: #94a3b8; }

/* TOP LIKED */
.top-liked-item {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid rgba(0,0,0,0.04);
  font-size: 0.75rem;
}
.like-badge {
  font-size: 0.7rem;
  font-weight: 700;
  min-width: 40px;
}

.participation-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0,0,0,0.06);
  border-radius: 6px;
  height: 18px;
  position: relative;
  min-width: 80px;
}

.participation-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.4s ease;
}

.participation-bar span {
  position: absolute;
  right: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  color: #334155;
}

/* ====== YENİ ANALİZ STİLLERİ ====== */

/* Engagement Card */
.engagement-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid rgba(2,6,23,0.08);
  border-radius: 12px;
  padding: 12px;
  margin-top: 10px;
}
.eng-grade {
  width: 48px; height: 48px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 1.4rem; font-weight: 900;
  flex-shrink: 0;
}
.eng-details { flex: 1; min-width: 0; }
.eng-score-label { font-size: 0.8rem; font-weight: 700; margin-bottom: 4px; }
.eng-bar-wrap {
  height: 8px; background: rgba(0,0,0,0.06); border-radius: 4px; overflow: hidden;
}
.eng-bar-fill {
  height: 100%; border-radius: 4px; transition: width 0.4s ease;
}
.eng-mini-stats {
  display: flex; gap: 8px; flex-wrap: wrap; font-size: 0.65rem; color: #64748b; margin-top: 4px;
}

/* Funnel */
.funnel-section {
  background: #fff; border: 1px solid rgba(2,6,23,0.08); border-radius: 12px; padding: 10px; margin-top: 10px; font-size: 0.8rem;
}
.funnel-bars { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.funnel-step { display: flex; }
.funnel-bar {
  height: 28px; border-radius: 6px; display: flex; align-items: center; padding: 0 10px;
  color: #fff; font-size: 0.7rem; font-weight: 600; min-width: 80px; transition: width 0.4s ease;
}

/* Funnel Detail */
.funnel-detail { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.funnel-detail-step { display: flex; align-items: center; gap: 10px; }
.funnel-detail-bar {
  height: 32px; border-radius: 8px; display: flex; align-items: center; padding: 0 12px;
  color: #fff; font-size: 0.75rem; font-weight: 700; transition: width 0.4s ease;
}
.funnel-detail-info { font-size: 0.75rem; white-space: nowrap; }
.funnel-drop { color: #ef4444; margin-left: 4px; font-size: 0.65rem; }

/* Segment Cards */
.segment-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 6px; }
.seg-card { border-radius: 10px; padding: 10px 6px; text-align: center; }
.seg-count { font-size: 1.4rem; font-weight: 900; }
.seg-label { font-size: 0.65rem; margin-top: 2px; }
.seg-active { background: rgba(22,160,133,0.1); color: #16a085; }
.seg-moderate { background: rgba(245,158,11,0.1); color: #f59e0b; }
.seg-inactive { background: rgba(239,68,68,0.1); color: #ef4444; }
.seg-total { background: rgba(59,130,246,0.1); color: #3b82f6; }

/* Matrix */
.matrix-container { overflow-x: auto; }
.matrix-table { border-collapse: collapse; font-size: 0.65rem; width: 100%; }
.matrix-table th, .matrix-table td { padding: 4px 6px; text-align: center; border: 1px solid rgba(0,0,0,0.08); }
.matrix-header { font-weight: 600; writing-mode: horizontal-tb; font-size: 0.6rem; }
.matrix-label { font-weight: 600; text-align: left !important; white-space: nowrap; }
.matrix-cell { min-width: 28px; font-weight: 600; transition: background-color 0.3s; }

/* Moderation Stats */
.mod-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.mod-stat { text-align: center; padding: 8px; border-radius: 8px; background: rgba(0,0,0,0.03); }
.mod-label { display: block; font-size: 0.65rem; color: #64748b; }
.mod-val { display: block; font-size: 1.2rem; font-weight: 900; }

/* Engagement Detail */
.engagement-detail-card {
  background: #fff; border: 1px solid rgba(2,6,23,0.08); border-radius: 12px; padding: 16px;
}
.eng-detail-header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.eng-big-grade {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 2rem; font-weight: 900; flex-shrink: 0;
}
.eng-big-score { font-size: 2rem; font-weight: 900; line-height: 1; }
.eng-big-score small { font-size: 0.9rem; color: #94a3b8; }
.eng-breakdown { display: flex; flex-direction: column; gap: 8px; }
.eng-factor { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; }
.eng-factor span:first-child { width: 120px; flex-shrink: 0; }
.eng-factor b { width: 40px; text-align: right; }
.eng-factor-bar { flex: 1; height: 8px; background: rgba(0,0,0,0.06); border-radius: 4px; overflow: hidden; }
.eng-factor-bar div { height: 100%; background: var(--accent, #16a085); border-radius: 4px; transition: width 0.4s; }

/* Weekday Compare */
.weekday-compare { margin-top: 8px; }
.wd-bar-group { display: flex; flex-direction: column; gap: 4px; }
.wd-bar {
  height: 32px; border-radius: 8px; display: flex; align-items: center; padding: 0 12px;
  color: #fff; font-size: 0.75rem; font-weight: 700; min-width: 80px; transition: width 0.4s;
}
.wd-weekday { background: #3b82f6; }
.wd-weekend { background: #f59e0b; }

/* Dark mode for new elements */
.app-container.dark-mode .engagement-card,
.app-container.dark-mode .funnel-section,
.app-container.dark-mode .engagement-detail-card {
  background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1);
}
.app-container.dark-mode .eng-score-label,
.app-container.dark-mode .eng-detail-header h3 { color: #e2e8f0; }
.app-container.dark-mode .eng-bar-wrap,
.app-container.dark-mode .eng-factor-bar { background: rgba(255,255,255,0.1); }
.app-container.dark-mode .eng-mini-stats { color: #94a3b8; }
.app-container.dark-mode .seg-card { border: 1px solid rgba(255,255,255,0.08); }
.app-container.dark-mode .matrix-table th,
.app-container.dark-mode .matrix-table td { border-color: rgba(255,255,255,0.1); }
.app-container.dark-mode .matrix-label { color: #e2e8f0; }
.app-container.dark-mode .mod-stat { background: rgba(255,255,255,0.06); }
.app-container.dark-mode .mod-label { color: #94a3b8; }
.app-container.dark-mode .eng-big-score { color: #e2e8f0; }
.app-container.dark-mode .funnel-detail-info { color: #cbd5e1; }

@media (max-width: 600px) {
  .segment-cards { grid-template-columns: repeat(2, 1fr); }
  .eng-factor span:first-child { width: 80px; font-size: 0.7rem; }
  .eng-detail-header { flex-direction: column; text-align: center; }
  .matrix-table { font-size: 0.55rem; }
  .matrix-table th, .matrix-table td { padding: 2px 3px; }
  .mod-stats-grid { grid-template-columns: 1fr 1fr; }
}

.kpi-item {
  background: #fff;
  border: 1px solid rgba(2,6,23,0.08);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 0.8rem;
  font-weight: 700;
}

.stats-lists {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}

.stats-list {
  background: #fff;
  border: 1px solid rgba(2,6,23,0.08);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 0.8rem;
}

.filter-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px;
  margin-bottom: 10px;
}

.notif-box {
  padding: 10px;
  margin-bottom: 8px;
  font-size: 0.8rem;
}

.notif-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid rgba(2, 6, 23, 0.08);
}

.notif-item:first-of-type {
  border-top: none;
}

.notif-item.unread {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid rgba(14, 165, 233, 0.2);
  border-radius: 12px;
  background: rgba(239, 246, 255, 0.82);
}

.notif-item > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #0f172a;
}

.offline-box {
  padding: 10px;
  margin-bottom: 8px;
  font-size: 0.8rem;
  border-left: 4px solid #0ea5e9;
  background: rgba(239, 246, 255, 0.92);
  color: #0f172a;
}

.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(2, 6, 23, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  font-size: 0.78rem;
}

.log-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  color: #475569;
  white-space: nowrap;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
  font-size: 0.78rem;
}

.stats-table th,
.stats-table td {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid rgba(2,6,23,0.08);
}

.stats-table th {
  font-weight: 800;
}

.s-section { 
  background: #f1f5f9; 
  padding: 12px; 
  border-radius: 8px; 
  margin-bottom: 10px; 
}

.s-section h4 {
  margin-top: 0;
  margin-bottom: 8px;
  color: #1e293b;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.safe-zone {
  border-left: 4px solid #e74c3c !important;
}

.color-grid { 
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 10px; 
  margin-top: 10px;
}

.color-grid div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.color-grid label {
  font-size: 0.75rem;
  font-weight: bold;
}

.color-grid input { 
  height: 35px; 
  width: 100%; 
  padding: 0; 
  border: none; 
  cursor: pointer;
  border-radius: 4px;
}

.row-flex { 
  display: flex; 
  gap: 5px; 
  margin-bottom: 8px;
}

.btn-add { 
  background: var(--accent, #16a085); 
  color: white; 
  border: none; 
  width: 35px;
  min-width: 35px;
  border-radius: 5px; 
  cursor: pointer; 
  font-weight: bold;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.btn-add:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(2,6,23,0.12);
}

.btn-snap { 
  background: #1e293b; 
  color: white; 
  flex: 1; 
  padding: 8px; 
  border-radius: 5px; 
  border: none; 
  cursor: pointer; 
  font-size: 0.75rem;
  font-weight: bold;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.btn-snap:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(2,6,23,0.12);
}

.btn-roll { 
  background: #e67e22; 
  color: white; 
  flex: 1; 
  padding: 8px; 
  border-radius: 5px; 
  border: none; 
  cursor: pointer; 
  font-size: 0.75rem;
  font-weight: bold;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.btn-roll:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(2,6,23,0.12);
}

.restore-zone {
  margin-top: 8px;
}

.btn-restore-file { 
  background: #8e44ad; 
  color: white; 
  padding: 10px 15px; 
  border-radius: 8px; 
  cursor: pointer; 
  font-weight: bold; 
  font-size: 0.75rem; 
  display: block; 
  text-align: center; 
  width: 100%;
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.btn-restore-file:hover {
  background: #7d3c98;
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(2,6,23,0.12);
  filter: saturate(1.05);
}

.tag-list { 
  display: flex; 
  flex-wrap: wrap; 
  gap: 5px; 
}

.tag-item { 
  background: #e2e8f0; 
  padding: 4px 10px; 
  border-radius: 12px; 
  font-size: 0.7rem; 
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 5px;
}

.stu-section {
  background: white;
  padding: 8px;
  border-radius: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.stu-section label {
  display: block;
  margin-bottom: 8px;
  font-weight: bold;
  color: #1e293b;
}

.stu-row { 
  display: flex; 
  justify-content: space-between; 
  align-items: center;
  background: #f8fafc; 
  padding: 8px; 
  border-radius: 5px; 
  margin-bottom: 5px; 
  font-size: 0.8rem; 
}

.empty-msg {
  text-align: center;
  padding: 10px;
  color: #27ae60;
  font-weight: bold;
}

.adv-font { 
  margin-top: 8px; 
  padding: 8px; 
  background: white;
  border-radius: 6px;
}

.adv-font input { 
  font-size: 0.8rem; 
  margin-bottom: 5px; 
}

/* FORM ELEMENTS */
input, select, textarea { 
  width: 100%; 
  padding: 10px; 
  margin-bottom: 8px; 
  border: 1px solid rgba(2,6,23,0.1); 
  border-radius: 10px; 
  font-family: inherit;
}

select {
  cursor: pointer;
}

textarea {
  resize: vertical;
  font-family: inherit;
}

label {
  display: block;
  margin-bottom: 4px;
  font-weight: bold;
  font-size: 0.8rem;
  color: #1e293b;
}

.btn-save-final { 
  width: 100%; 
  padding: 10px; 
  color: white; 
  font-weight: 900; 
  border-radius: 10px; 
  margin-top: 10px; 
  border: none; 
  cursor: pointer; 
  box-shadow: 0 10px 22px rgba(2,6,23,0.2);
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.btn-save-final:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 26px rgba(2,6,23,0.24);
  filter: saturate(1.05);
}

.online-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-weight: 700;
}

.time-chip {
  margin-left: auto;
  background: rgba(2, 6, 23, 0.06);
  border: 1px solid rgba(2, 6, 23, 0.1);
  padding: 6px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 800;
  color: #0f172a;
}

.auto-save-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 800;
  color: #0f172a;
}

.notif-recipient-row {
  margin-top: 8px;
  padding: 10px;
  border: 1px dashed rgba(2, 6, 23, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
}

.approval-toolbar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.approval-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.approval-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  color: #0f172a;
  font-size: 0.75rem;
  font-weight: 800;
}

.approval-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.approval-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(2, 6, 23, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
}

.approval-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #0f172a;
}

.approval-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  min-width: 180px;
}

.approval-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.approval-kind {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
  color: #0f172a;
  background: rgba(15, 23, 42, 0.08);
}

.approval-kind.question {
  background: rgba(14, 165, 233, 0.18);
}

.approval-kind.student {
  background: rgba(34, 197, 94, 0.18);
}

.approval-kind.teacher {
  background: rgba(245, 158, 11, 0.22);
}

.bulk-preview {
  margin-top: 10px;
  background: #fffdf7;
  border: 1px dashed rgba(2,6,23,0.15);
  border-radius: 10px;
  padding: 10px;
}

.bulk-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 0.8rem;
  color: #0f172a;
}

.bulk-row {
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(2, 6, 23, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.bulk-row-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bulk-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
  color: #0f172a;
}

.bulk-badge.ready {
  background: rgba(34, 197, 94, 0.18);
}

.bulk-badge.info {
  background: rgba(14, 165, 233, 0.18);
}

.bulk-badge.warn {
  background: rgba(245, 158, 11, 0.22);
}

.bulk-badge.error {
  background: rgba(220, 38, 38, 0.16);
}

.bulk-report {
  margin-top: 10px;
  background: #ffffff;
  border: 1px dashed rgba(2,6,23,0.15);
  border-radius: 10px;
  padding: 10px;
}

.bulk-summary {
  font-weight: 800;
  margin-bottom: 6px;
  color: #0f172a;
}

.bulk-errors {
  font-size: 0.8rem;
  color: #7c2d12;
}

.btn-save-final:hover {
  opacity: 0.9;
}

.btn-forgot-password {
  width: 100%;
  margin-top: 10px;
  padding: 10px;
  background: transparent;
  border: 1px dashed #94a3b8;
  border-radius: 10px;
  color: #0f766e;
  font-weight: 700;
  font-size: 0.9rem;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.btn-forgot-password:hover {
  background: #f0fdfa;
  border-color: #14b8a6;
}

.auth-hint {
  display: block;
  margin-top: 8px;
  color: #64748b;
  line-height: 1.35;
}

.btn-close-final { 
  width: 100%; 
  background: #e2e8f0; 
  border: none; 
  padding: 10px; 
  margin-top: 8px; 
  border-radius: 8px; 
  cursor: pointer; 
  font-weight: bold;
  color: #1e293b;
}

.btn-close-final:hover {
  background: #cbd5e1;
}

small {
  display: block;
  margin-top: 5px;
  margin-bottom: 10px;
  color: #64748b;
  font-size: 0.75rem;
}

.fade-in {
  animation: fadeIn 0.5s ease-in;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes floatIn {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* THEME PRESETS */
.theme-help {
  margin: 0 0 12px;
  font-size: 0.82rem;
  color: #64748b;
  line-height: 1.4;
}
.theme-presets-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (min-width: 720px) {
  .theme-presets-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.theme-preset-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 12px 11px;
  border: 1px solid #d9e2ec;
  border-radius: 12px;
  background: #f8fafc;
  cursor: pointer;
  text-align: left;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
.theme-preset-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent, #0f8f78) 55%, #d9e2ec);
  box-shadow: 0 10px 22px rgba(15, 28, 46, 0.12);
}
.theme-preset-card.recommended {
  border-color: color-mix(in srgb, var(--accent, #0f8f78) 70%, #d9e2ec);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, #0f8f78) 35%, transparent);
}
.theme-preset-card strong {
  font-size: 0.82rem;
  color: #1e293b;
  font-weight: 800;
}
.theme-preset-card small {
  margin: 0;
  font-size: 0.68rem;
  line-height: 1.35;
  color: #64748b;
}
.theme-swatch-row {
  display: flex;
  gap: 4px;
  width: 100%;
}
.theme-swatch-row i {
  flex: 1;
  height: 18px;
  border-radius: 5px;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

/* DESIGN PREVIEW */
.design-preview {
  border: 1px solid rgba(0,0,0,0.1);
  overflow: hidden;
  min-height: 120px;
}

.preview-header {
  padding: 8px 12px;
  text-align: center;
  font-weight: 800;
}

.preview-body {
  padding: 8px 12px;
}

.preview-card {
  padding: 8px;
  margin: 4px 0;
  background: rgba(0,0,0,0.03);
}

.preview-btn {
  border: none;
  color: white;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 0.6rem;
  font-weight: 700;
  cursor: default;
}

.preview-footer {
  padding: 6px 12px;
  text-align: center;
}

@media (max-width: 600px) {
  .charts-grid { grid-template-columns: 1fr; }
  .charts-grid-2 { grid-template-columns: 1fr; }
  .stats-lists { grid-template-columns: 1fr; }
  .filter-row { grid-template-columns: 1fr; }
  .color-grid { grid-template-columns: 1fr; }
  .modal-box { max-width: 95%; }
  .banner-box { padding: 5px 10px; }
  .approval-toolbar { grid-template-columns: 1fr; }
  .approval-row { flex-direction: column; }
  .approval-side { align-items: stretch; min-width: 0; }
  .weekly-summary { grid-template-columns: 1fr; }
  .stats-tabs { font-size: 0.7rem; }
}

@media (max-width: 900px) and (min-width: 601px) {
  .charts-grid { grid-template-columns: 1fr 1fr; }
}
</style>
