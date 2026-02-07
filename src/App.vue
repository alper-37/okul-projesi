<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { 
  signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserLocalPersistence
} from "firebase/auth";
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc, setDoc, getDoc, getDocs, serverTimestamp, where, deleteDoc, increment, writeBatch } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Pie, Bar } from 'vue-chartjs';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

// --- ⚙️ DEĞİŞKENLER ---
const questions = ref([]);
const students = ref([]);
const teachers = ref([]);
const currentUser = ref(null);
const showAuthModal = ref(false);
const showSettingsModal = ref(false);
const showDesignModal = ref(false);
const showAskModal = ref(false);
const showStats = ref(false);
const authTab = ref('login');
const registerTab = ref('student'); // student, teacher
const loginForm = ref({ email: '', password: '' });
const registerForm = ref({ name: '', email: '', password: '', confirmPassword: '', class: '', number: '', schoolCode: '' });
const teacherApprovals = ref([]);
const newSubject = ref('');
const newClass = ref('');
const newQuestion = ref({ subject: '', classLevel: '', content: '' });
const answerText = ref({});
const searchQuery = ref('');
const similarQuestionFound = ref(null);

// --- 📄 SAYFALAMA ---
const currentPage = ref(1);
const itemsPerPage = 4;

const schoolSettings = ref({
  name: 'Taşköprü Anadolu İmam Hatip Lisesi',
  schoolCode: 'TAIHL2026',
  logo: 'https://img.icons8.com/color/96/graduation-cap.png',
  announcement: '2026 Eğitim Öğretim Yılı Hayırlı Olsun.',
  subjects: ['Matematik', 'Edebiyat', 'Fizik', 'Tarih', 'Din K.', 'Rehberlik'],
  classes: ['9. Sınıf', '10. Sınıf', '11. Sınıf', '12. Sınıf'],
  styles: {
    fontFamily: "'Inter', sans-serif",
    customFontUrl: '',
    customFontName: '',
    baseFontSize: 15,
    headerBg: '#1e293b',
    headerText: '#ffffff',
    accentColor: '#16a085',
    footerText: '#fbbf24',
    bodyText: '#333333',
    titleFont: "'Inter', sans-serif",
    titleSize: 24,
    titleColor: '#ffffff'
  }
});

// --- 🤖 YAPAY ZEKA: BENZERLİK ALGILAMA ---
watch(() => newQuestion.value.content, (newVal) => {
  if (!newVal || newVal.length < 5) { similarQuestionFound.value = null; return; }
  const match = questions.value.find(q => q.isApproved && q.content.toLowerCase().includes(newVal.toLowerCase()));
  similarQuestionFound.value = match ? match : null;
});

// --- 🤖 YAPAY ZEKA: ROZET SİSTEMİ ---
const getUserBadge = (points) => {
  if (points > 100) return '🏆 Üstad';
  if (points > 50) return '⭐ Kıdemli';
  if (points > 20) return '💡 Gayretli';
  return '🌱 Yeni';
};

// --- 🔍 ARAMA ---
const filteredQuestions = computed(() => {
  let list = questions.value.filter(q => q.isApproved || currentUser.value?.role === 'admin' || currentUser.value?.role === 'teacher');
  if (searchQuery.value) {
    const term = searchQuery.value.toLowerCase();
    list = list.filter(q => 
      (q.content || '').toLowerCase().includes(term) || 
      (q.subject || '').toLowerCase().includes(term) || 
      (q.sender || '').toLowerCase().includes(term)
    );
  }
  return list;
});

const totalPages = computed(() => Math.ceil(filteredQuestions.value.length / itemsPerPage));
const paginatedQuestions = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  return filteredQuestions.value.slice(start, start + itemsPerPage);
});
const changePage = (p) => { if (p >= 1 && p <= totalPages.value) currentPage.value = p; };

// --- 🔐 GÜVENLI GİRİŞ AYARLARI ---
const handleGoogleLogin = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (!userData.isApproved) {
        alert("Hesabınız henüz onaylanmamıştır.");
        signOut(auth);
        return;
      }
      currentUser.value = { id: user.uid, ...userData };
      showAuthModal.value = false;
    } else {
      alert("Kullanıcı bulunamadı. Lütfen kanıtlama koduyla kaydolun.");
      signOut(auth);
    }
  } catch (error) {
    alert("Google giriş hatası: " + error.message);
  }
};

const handleEmailLogin = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    const { email, password } = loginForm.value;
    
    if (!email || !password) {
      alert("E-posta ve şifre gerekli!");
      return;
    }

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      if (!userData.isApproved) {
        alert("Hesabınız henüz onaylanmamıştır. Yönetici tarafından doğrulanmasını bekleyin.");
        await signOut(auth);
        return;
      }
      currentUser.value = { id: userCredential.user.uid, ...userData };
      showAuthModal.value = false;
      loginForm.value = { email: '', password: '' };
    }
  } catch (error) {
    alert("Giriş Hatası: " + (error.code === 'auth/user-not-found' ? "Kullanıcı bulunamadı" : error.message));
  }
};

const handleStudentRegister = async () => {
  try {
    const { name, email, password, confirmPassword, class: studentClass, number, schoolCode } = registerForm.value;

    if (!name || !email || !password || !studentClass || !number || !schoolCode) {
      alert("Tüm alanlar gerekli!");
      return;
    }

    if (password !== confirmPassword) {
      alert("Şifreler eşleşmiyor!");
      return;
    }

    if (schoolCode !== schoolSettings.value.schoolCode) {
      alert("Şehir kodunuz yanlış!");
      return;
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    await setDoc(doc(db, 'users', userCredential.user.uid), {
      name,
      email,
      class: studentClass,
      number,
      role: 'student',
      points: 0,
      isApproved: false,
      createdAt: serverTimestamp()
    });

    alert("✅ Kaydınız başarılı! Yönetici onayı bekleniyor.");
    authTab.value = 'login';
    registerForm.value = { name: '', email: '', password: '', confirmPassword: '', class: '', number: '', schoolCode: '' };
  } catch (error) {
    alert("Kayıt Hatası: " + error.message);
  }
};

const handleTeacherRegister = async () => {
  try {
    const { name, email, password, confirmPassword, schoolCode } = registerForm.value;

    if (!name || !email || !password || !schoolCode) {
      alert("Tüm alanlar gerekli!");
      return;
    }

    if (password !== confirmPassword) {
      alert("Şifreler eşleşmiyor!");
      return;
    }

    if (schoolCode !== schoolSettings.value.schoolCode) {
      alert("Okul kodunuz yanlış!");
      return;
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    await setDoc(doc(db, 'users', userCredential.user.uid), {
      name,
      email,
      role: 'teacher',
      points: 0,
      isApproved: false,
      createdAt: serverTimestamp()
    });

    alert("✅ Öğretmen kayıtlaması başarılı! Admin onayı bekleniyor.");
    authTab.value = 'login';
    registerTab.value = 'student';
    registerForm.value = { name: '', email: '', password: '', confirmPassword: '', class: '', number: '', schoolCode: '' };
  } catch (error) {
    alert("Kayıt Hatası: " + error.message);
  }
};

const handleLogout = async () => {
  try {
    await signOut(auth);
    currentUser.value = null;
  } catch (error) {
    alert("Çıkış hatası: " + error.message);
  }
};

// --- 📦 YEDEKLEME ---
const downloadJSONBackup = () => {
  const data = { settings: schoolSettings.value, questions: questions.value, users: students.value, teachers: teachers.value, date: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `ADAB_Yedek.json`; a.click();
};

const handleRestoreJSON = async (e) => {
  const file = e.target.files[0];
  if (!file || !confirm("Yedek yüklenecek. Emin misiniz?")) return;
  const reader = new FileReader();
  reader.onload = async (f) => {
    try {
      const data = JSON.parse(f.target.result);
      if (data.settings) { 
        schoolSettings.value = data.settings; 
        await setDoc(doc(db, "settings", "school_info"), data.settings); 
      }
      alert("✅ Yedek Yüklendi! Sayfa yenileniyor..."); 
      window.location.reload();
    } catch (err) { 
      alert("Hata: " + err.message); 
    }
  };
  reader.readAsText(file);
};

// --- 💾 KAYDET ---
const saveAll = async () => { 
  await setDoc(doc(db, "settings", "school_info"), schoolSettings.value); 
  alert("✅ Ayarlar Mühürlendi!"); 
  showSettingsModal.value = false; 
  showDesignModal.value = false; 
};

const createSnapshot = async () => { 
  await setDoc(doc(db, "settings", "safe_snapshot"), schoolSettings.value); 
  alert("⚓ Snapshot Alındı!"); 
};

const restoreSnapshot = async () => { 
  const snap = await getDoc(doc(db, "settings", "safe_snapshot"));
  if (snap.exists()) { schoolSettings.value = snap.data(); await saveAll(); window.location.reload(); }
};

// --- ONAY İŞLEMLERİ ---
const likeQuestion = async (q) => { await updateDoc(doc(db, "questions", q.id), { likes: increment(1) }); };

const onayIslem = async (qData, tip) => {
  if (tip === 'soru') { 
    await updateDoc(doc(db, "questions", qData.id), { isApproved: true }); 
    if (qData.senderId) await updateDoc(doc(db, "users", qData.senderId), { points: increment(10) }); 
  }
  else if (tip === 'cevap') { 
    await updateDoc(doc(db, "questions", qData.id), { answerApproved: true }); 
    if (qData.respId) await updateDoc(doc(db, "users", qData.respId), { points: increment(20) }); 
  }
  else if (tip === 'sil') { 
    if (confirm("Soruyu silinsin mi?")) await deleteDoc(doc(db, "questions", qData.id)); 
  }
};

// --- ÖĞRENCİ AYARLARI ---
const deleteStudent = async (studentId) => {
  if (confirm("Bu öğrenciyi silmek istediğinizden emin misiniz?")) {
    await deleteDoc(doc(db, 'users', studentId));
    alert("✅ Öğrenci silindi!");
  }
};

// --- DERS AYARLARI ---
const addSubject = () => {
  if (newSubject.value.trim()) {
    if (!schoolSettings.value.subjects.includes(newSubject.value)) {
      schoolSettings.value.subjects.push(newSubject.value);
      newSubject.value = '';
      saveAll();
    } else {
      alert("Bu ders zaten var!");
    }
  }
};

const deleteSubject = (index) => {
  if (confirm("Dersi silmek istediğinizden emin misiniz?")) {
    schoolSettings.value.subjects.splice(index, 1);
    saveAll();
  }
};

const addClass = () => {
  if (newClass.value.trim()) {
    if (!schoolSettings.value.classes.includes(newClass.value)) {
      schoolSettings.value.classes.push(newClass.value);
      newClass.value = '';
      saveAll();
    } else {
      alert("Bu sınıf zaten var!");
    }
  }
};

const deleteClass = (index) => {
  if (confirm("Sınıfı silmek istediğinizden emin misiniz?")) {
    schoolSettings.value.classes.splice(index, 1);
    saveAll();
  }
};

// --- ÖĞRETMENLERİ ONAYLA ---
const approveTeacher = async (teacherId) => {
  await updateDoc(doc(db, 'users', teacherId), { isApproved: true });
  alert("✅ Öğretmen onaylandı!");
};

const rejectTeacher = async (teacherId) => {
  if (confirm("Öğretmen başvurusunu reddet?")) {
    await deleteDoc(doc(db, 'users', teacherId));
    alert("❌ Başvuru reddedildi!");
  }
};

// --- 🧠 AI VERİ SETI İHRACATI ---
const downloadNotebook = () => {
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
      soru: q.content,
      cevap: q.cevap || "Henüz cevaplanmamış",
      begeni: q.likes || 0
    }))
  };
  const blob = new Blob([JSON.stringify(aiData, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ADAB_AI_Dataset.json"; a.click();
};
let unsubscribeQuestions = null;
let unsubscribeStudents = null;
let unsubscribeTeachers = null;

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

const startStaffListeners = () => {
  stopStaffListeners();
  unsubscribeStudents = onSnapshot(
    query(collection(db, "users"), where("role", "==", "student"), orderBy("points", "desc")),
    (s) => students.value = s.docs.map(d => ({ id: d.id, ...d.data() }))
  );
  unsubscribeTeachers = onSnapshot(
    query(collection(db, "users"), where("role", "==", "teacher")),
    (s) => teachers.value = s.docs.map(d => ({ id: d.id, ...d.data() }))
  );
};

const startQuestionsListener = (signedIn) => {
  if (unsubscribeQuestions) unsubscribeQuestions();
  const questionsQuery = signedIn
    ? query(collection(db, "questions"), orderBy("created_at", "desc"))
    : query(collection(db, "questions"), where("isApproved", "==", true), orderBy("created_at", "desc"));
  unsubscribeQuestions = onSnapshot(questionsQuery, (s) =>
    questions.value = s.docs.map(d => ({ id: d.id, ...d.data() }))
  );
};

const loadSettings = async () => {
  const docSnap = await getDoc(doc(db, "settings", "school_info"));
  if (docSnap.exists()) schoolSettings.value = docSnap.data();
};

// --- UYGULAMA BAŞLATMA ---
  onMounted(async () => {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.isApproved) {
          currentUser.value = { id: firebaseUser.uid, ...userData };
          startQuestionsListener(true);

          if (userData.role === 'admin' || userData.role === 'teacher') {
            startStaffListeners();
          } else {
            stopStaffListeners();
          }

          await loadSettings();
          return;
        }
      }
      await signOut(auth);
    }

    currentUser.value = null;
    startQuestionsListener(false);
    stopStaffListeners();
  });
});
const chartData = computed(() => {
  const approvedQs = questions.value.filter(q => q.isApproved);
  const counts = {};
  approvedQs.forEach(q => counts[q.subject] = (counts[q.subject] || 0) + 1);
  return {
    labels: Object.keys(counts),
    datasets: [{
      backgroundColor: ['#16a085', '#2980b9', '#f39c12', '#d35400', '#1e293b'],
      data: Object.values(counts)
    }]
  };
});
const goalData = computed(() => ({
  labels: ['Mevcut', 'Hedef (500)'],
  datasets: [{ 
    label: 'Etkileşim', 
    backgroundColor: ['#16a085', '#e2e8f0'], 
    data: [questions.value.length, 500] 
  }]
}));
</script>

<template>
  <div class="app-container" :style="{ 
    fontFamily: schoolSettings.styles.customFontName ? schoolSettings.styles.customFontName : schoolSettings.styles.fontFamily, 
    fontSize: schoolSettings.styles.baseFontSize + 'px',
    color: schoolSettings.styles.bodyText
  }">
    <component :is="'style'" v-if="schoolSettings.styles.customFontUrl">
      @import url('{{ schoolSettings.styles.customFontUrl }}');
    </component>

    <header class="navbar-wrapper">
      <div class="center-column banner-box glass-premium" :style="{ backgroundColor: schoolSettings.styles.headerBg, borderColor: schoolSettings.styles.accentColor }">
        <div class="logo-area"><img :src="schoolSettings.logo" class="logo-fixed"></div>
        <div class="brand-info-center">
          <h1 class="grand-title" :style="{ fontFamily: schoolSettings.styles.titleFont, fontSize: schoolSettings.styles.titleSize + 'px', color: schoolSettings.styles.titleColor }">DİJİTAL İMECE: ADAB</h1>
          <p class="grand-subtitle" :style="{ color: schoolSettings.styles.headerText }">{{ schoolSettings.name }}</p>
        </div>
        <div class="nav-actions">
          <button v-if="currentUser?.role === 'admin'" @click="showStats = !showStats" class="icon-btn" title="İstatistikler">📊</button>
          <button v-if="currentUser?.role === 'admin'" @click="showDesignModal = true" class="icon-btn" title="Tasarım">🎨</button>
          <button v-if="currentUser?.role === 'admin'" @click="showSettingsModal = true" class="icon-btn" title="Ayarlar">⚙️</button>
          <button v-if="!currentUser" @click="showAuthModal = true" class="btn-login-main" :style="{ backgroundColor: schoolSettings.styles.accentColor }">GİRİŞ</button>
          <div v-else class="user-pill">
            <span>{{ currentUser.name }}</span>
            <span class="role-badge">{{ currentUser.role === 'admin' ? '👨‍💼' : currentUser.role === 'teacher' ? '👨‍🏫' : '👨‍🎓' }}</span>
            <button @click="handleLogout" class="logout-btn">🔓</button>
          </div>
        </div>
      </div>
    </header>

    <main class="center-column main-content">
      <div v-if="schoolSettings.announcement" class="announcement-box" :style="{background: schoolSettings.styles.accentColor}">📢 {{ schoolSettings.announcement }}</div>

      <div v-if="showStats && currentUser?.role === 'admin'" class="stats-panel glass-premium fade-in">
        <div class="stats-header">
          <h3>📈 Akademik Rapor</h3>
          <div class="s-btns">
            <button @click="downloadJSONBackup" class="btn-xs">JSON İndir</button>
            <button @click="downloadNotebook" class="btn-xs">🤖 AI Veri Seti</button>
          </div>
        </div>
        <div class="charts-grid">
          <div class="c-box"><Pie :data="chartData" :options="{responsive:true}" /></div>
          <div class="c-box"><Bar :data="goalData" :options="{responsive:true}" /></div>
        </div>
      </div>

      <div class="search-bar"><input v-model="searchQuery" placeholder="🔍 Konu, öğrenci veya sınıf ara..." class="search-input"></div>
      <button @click="currentUser ? showAskModal = true : showAuthModal = true" class="btn-ask-compact" :style="{ backgroundColor: schoolSettings.styles.accentColor }">➕ YENİ SORU</button>

      <div class="feed">
        <div v-for="q in paginatedQuestions" :key="q.id" class="post-card compact glass-premium" :class="{pending: !q.isApproved}">
          <div class="post-header">
            <div class="badges">
              <span class="badge" :style="{ backgroundColor: q.isApproved ? schoolSettings.styles.accentColor : '#f59e0b' }">{{ q.subject }}</span>
              <span v-if="q.classLevel" class="badge-class">{{ q.classLevel }}</span>
            </div>
            <div class="meta">
              <b>{{ q.sender }}</b> <small>({{ q.senderClass || 'Genel' }})</small>
            </div>
          </div>
          <p class="post-body">{{ q.content }}</p>
          <div class="interactions"><button @click="likeQuestion(q)" class="btn-like">❤️ {{ q.likes || 0 }}</button></div>

          <div v-if="(currentUser?.role === 'admin' || currentUser?.role === 'teacher') && !q.isApproved" class="actions-compact">
            <button @click="onayIslem(q, 'soru')" class="btn-tiny ok">✔ Onayla</button>
            <button @click="onayIslem(q, 'sil')" class="btn-tiny no">✖ Sil</button>
          </div>

          <div v-if="q.cevap" class="answer-box compact-ans" :style="{ borderLeftColor: q.answerApproved ? schoolSettings.styles.accentColor : '#f59e0b' }">
            <div class="ans-head">💡 <b>{{ q.respondent }}:</b> <span v-if="q.answerApproved" class="app-tag">✓</span></div>
            <p>{{ q.cevap }}</p>
            <button v-if="(currentUser?.role === 'admin' || currentUser?.role === 'teacher') && !q.answerApproved" @click="onayIslem(q, 'cevap')" class="btn-tiny ok">✔ Onayla</button>
          </div>

          <div v-if="currentUser && q.isApproved && !q.cevap" class="reply-compact">
            <input v-model="answerText[q.id]" placeholder="Yanıt..." class="input-tiny">
            <button @click="updateDoc(doc(db,'questions',q.id),{cevap:answerText[q.id], respondent:currentUser.name, respId:currentUser.id, respRole:currentUser.role, answerApproved:false}); answerText[q.id]='';" class="btn-tiny send" :style="{background:schoolSettings.styles.accentColor}">➤</button>
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
      <div class="center-column marquee-box glass-premium" :style="{ backgroundColor: schoolSettings.styles.headerBg, color: schoolSettings.styles.footerText, borderColor: schoolSettings.styles.accentColor }">
        <div class="marquee-content">
          🏆 Liderlik: <span v-for="s in students.slice(0,3)" :key="s.id">{{ s.name }} ({{ getUserBadge(s.points) }} - {{ s.points || 0 }}P) | </span>
        </div>
      </div>
    </footer>

    <!-- GİRİŞ VE KAYIT MODAL -->
    <div v-if="showAuthModal" class="modal-overlay">
      <div class="modal-box">
        <div class="tabs">
          <button @click="authTab='login'" :class="{active:authTab=='login'}">Giriş</button>
          <button @click="authTab='register'" :class="{active:authTab=='register'}">Kayıt</button>
        </div>

        <!-- GİRİŞ SEKMESİ -->
        <div v-if="authTab=='login'">
          <h3>Giriş Yap</h3>
          <input v-model="loginForm.email" type="email" placeholder="E-posta Adresi">
          <input v-model="loginForm.password" type="password" placeholder="Şifre">
          <button @click="handleEmailLogin" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">📧 E-POSTA İLE GİRİŞ</button>
          <div class="divider">VEYA</div>
          <button @click="handleGoogleLogin" class="btn-google">🔵 GOOGLE İLE GİRİŞ</button>
        </div>

        <!-- KAYIT SEKMESİ -->
        <div v-else>
          <div class="register-tabs">
            <button @click="registerTab='student'" :class="{active:registerTab=='student'}">👨‍🎓 Öğrenci</button>
            <button @click="registerTab='teacher'" :class="{active:registerTab=='teacher'}">👨‍🏫 Öğretmen</button>
          </div>

          <!-- ÖĞRENCİ KAYDI -->
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
            <input v-model="registerForm.schoolCode" placeholder="Okul Güvenlik Kodu" type="password">
            <button @click="handleStudentRegister" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">📚 KAYIT OL</button>
          </div>

          <!-- ÖĞRETMEN KAYDI -->
          <div v-else>
            <h3>Öğretmen Kaydı</h3>
            <input v-model="registerForm.name" placeholder="Adı Soyadı">
            <input v-model="registerForm.email" type="email" placeholder="Okul E-postası (zorunlu)">
            <input v-model="registerForm.password" type="password" placeholder="Şifre">
            <input v-model="registerForm.confirmPassword" type="password" placeholder="Şifreyi Onayla">
            <input v-model="registerForm.schoolCode" placeholder="Okul Güvenlik Kodu" type="password">
            <small>Not: Admin tarafından onayınızı bekleyeceksiniz.</small>
            <button @click="handleTeacherRegister" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">☑️ ÖĞRETMEN KAYDI</button>
          </div>
        </div>

        <button @click="showAuthModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <!-- SORU SORMA MODAL -->
    <div v-if="showAskModal && currentUser" class="modal-overlay">
      <div class="modal-box">
        <h3>❓ Soru Sor</h3>
        
        <div v-if="similarQuestionFound" class="ai-warning">
          🤖 <b>Yapay Zeka Uyarısı:</b> Benzer bir soru bulundu!<br>
          <i>"{{ similarQuestionFound.content.substring(0, 50) }}..."</i>
        </div>

        <select v-model="newQuestion.subject">
          <option value="" disabled selected>Ders Seçiniz</option>
          <option v-for="s in schoolSettings.subjects" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="newQuestion.classLevel">
          <option value="" disabled selected>Sınıf Seviyesi</option>
          <option v-for="c in schoolSettings.classes" :key="c" :value="c">{{ c }}</option>
        </select>
        <textarea v-model="newQuestion.content" placeholder="Sorunuzu buraya yazın..." rows="4"></textarea>
        <button @click="addDoc(collection(db,'questions'),{sender:currentUser.name, senderClass:currentUser.class, senderId:currentUser.id, senderRole:currentUser.role, subject:newQuestion.subject, classLevel:newQuestion.classLevel, content:newQuestion.content, isApproved:false, likes:0, created_at:serverTimestamp()}); showAskModal=false; newQuestion.value = { subject: '', classLevel: '', content: '' };" class="btn-save-final" :style="{background:schoolSettings.styles.accentColor}">GÖNDER</button>
        <button @click="showAskModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <!-- TASARIM MODAL -->
    <div v-if="showDesignModal" class="modal-overlay">
      <div class="modal-box large">
        <h3>🎨 Tasarım Stüdyosu</h3>
        
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
              <label>Alt Yazı:</label>
              <input type="color" v-model="schoolSettings.styles.footerText">
            </div>
          </div>
        </div>

        <button @click="saveAll" class="btn-save-final" :style="{ backgroundColor: schoolSettings.styles.accentColor }">🎨 TASARIMI MÜHÜRLE</button>
        <button @click="showDesignModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>

    <!-- AYARLAR VE YÖNETİM MODAL -->
    <div v-if="showSettingsModal" class="modal-overlay">
      <div class="modal-box large">
        <h3>⚙️ Yönetim Paneli</h3>

        <!-- GÜVENLI YÖNETİM BÖLÜMÜ -->
        <div class="s-section safe-zone" style="border-left: 4px solid #e74c3c;">
          <h4>🔒 Güvenlik & Yedekleme</h4>
          <div class="row-flex">
            <button @click="createSnapshot" class="btn-snap">📸 Snapshot Al</button>
            <button @click="restoreSnapshot" class="btn-roll">⏮️ Geri Dön</button>
          </div>
          <div class="restore-zone">
            <label class="btn-restore-file">📤 YEDEK YÜKLE <input type="file" @change="handleRestoreJSON" hidden accept=".json"></label>
          </div>
        </div>

        <!-- OKUL BİLGİLERİ -->
        <div class="s-section">
          <h4>🏫 Okul Bilgileri</h4>
          <label>Okul Adı:</label>
          <input v-model="schoolSettings.name">
          <label>Okul Güvenlik Kodu:</label>
          <input v-model="schoolSettings.schoolCode" type="password">
          <label>Duyuru:</label>
          <textarea v-model="schoolSettings.announcement" rows="2"></textarea>
          <label>Logo URL:</label>
          <input v-model="schoolSettings.logo">
        </div>

        <!-- DERS YÖNETİMİ -->
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

        <!-- SINIF YÖNETİMİ -->
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

        <!-- ÖĞRENCİ AYAR YÖNETİMİ -->
        <div class="s-section">
          <h4>👨‍🎓 Öğrenci Yönetimi</h4>
          <div class="stu-section">
            <label>Onay Bekleyenler:</label>
            <div v-for="s in students.filter(x => !x.isApproved)" :key="s.id" class="stu-row">
              <div><b>{{ s.name }}</b> <small>({{ s.class }})</small></div>
              <div>
                <button @click="updateDoc(doc(db,'users',s.id),{isApproved:true})" class="btn-tiny ok">✓ Onayla</button>
                <button @click="deleteStudent(s.id)" class="btn-tiny no">✕ Reddet</button>
              </div>
            </div>
            <div v-if="!students.filter(x => !x.isApproved).length" class="empty-msg">Onay bekleyen öğrenci yok ✓</div>
          </div>
        </div>

        <!-- ÖĞRETMEN AYAR YÖNETİMİ -->
        <div class="s-section">
          <h4>👨‍🏫 Öğretmen Yönetimi</h4>
          <div class="stu-section">
            <label>Onay Bekleyenler:</label>
            <div v-for="t in teachers.filter(x => !x.isApproved)" :key="t.id" class="stu-row">
              <div><b>{{ t.name }}</b> <small>({{ t.email }})</small></div>
              <div>
                <button @click="approveTeacher(t.id)" class="btn-tiny ok">✓ Onayla</button>
                <button @click="rejectTeacher(t.id)" class="btn-tiny no">✕ Reddet</button>
              </div>
            </div>
            <div v-if="!teachers.filter(x => !x.isApproved).length" class="empty-msg">Onay bekleyen öğretmen yok ✓</div>
          </div>

          <label style="margin-top: 10px;">Onaylı Öğretmenler:</label>
          <div v-for="t in teachers.filter(x => x.isApproved)" :key="t.id" class="stu-row">
            <div><b>{{ t.name }}</b> <small>({{ t.email }})</small></div>
            <div>
              <button @click="deleteDoc(doc(db,'users',t.id))" class="btn-tiny no">🗑️ Sil</button>
            </div>
          </div>
        </div>

        <button @click="saveAll" class="btn-save-final" :style="{ backgroundColor: schoolSettings.styles.accentColor }">💾 AYARLARI MÜHÜRLE</button>
        <button @click="showSettingsModal=false" class="btn-close-final">Kapat</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Poppins:wght@400;700&family=Montserrat:wght@400;700&display=swap');

* { box-sizing: border-box; }

.app-container { 
  min-height: 100vh; 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  background: linear-gradient(rgba(15,23,42,0.9), rgba(15,23,42,0.95)), url('https://images.unsplash.com/photo-1507842217343-583bb7270b66?q=80&w=2000&auto=format&fit=crop'); 
  background-size: cover; 
  background-attachment: fixed; 
}

.center-column { 
  width: 92%; 
  max-width: 650px; 
  margin: 0 auto; 
}

.glass-premium { 
  background: rgba(255, 255, 255, 0.96); 
  backdrop-filter: blur(12px); 
  border-radius: 10px; 
  border: 1px solid rgba(255,255,255,0.2); 
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
  padding: 5px 15px; 
  border-bottom: 3px solid; 
}

.logo-fixed { 
  height: 50px; 
  border-radius: 6px; 
}

.brand-info-center { 
  text-align: center; 
}

.grand-title { 
  margin: 0; 
  font-weight: 900; 
  letter-spacing: 1px; 
}

.grand-subtitle { 
  font-size: 0.75rem; 
  margin: 0; 
  opacity: 0.9; 
}

.nav-actions { 
  display: flex; 
  gap: 5px; 
  justify-content: flex-end; 
}

.icon-btn { 
  background: none; 
  border: none; 
  font-size: 1.2rem; 
  cursor: pointer; 
  color: white; 
  padding: 5px;
}

.btn-login-main { 
  color: white; 
  padding: 6px 15px; 
  border-radius: 15px; 
  font-size: 0.75rem; 
  border: none; 
  font-weight: bold; 
  cursor: pointer; 
}

.user-pill { 
  padding: 3px 10px; 
  border-radius: 15px; 
  display: flex; 
  align-items: center; 
  gap: 5px; 
  background: rgba(0,0,0,0.2); 
  color: white; 
  font-size: 0.75rem; 
  font-weight: bold; 
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
  border-radius: 15px; 
  width: 90%; 
  max-width: 480px; 
  max-height: 85vh; 
  overflow-y: auto; 
  color: #333; 
}

.modal-box.large {
  max-width: 550px;
}

.modal-box h3 {
  margin-top: 0;
  color: #1e293b;
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
  border-bottom: 3px solid #16a085; 
  color: #16a085;
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
  background: #16a085;
  color: white;
  border-color: #16a085;
}

.divider {
  text-align: center;
  margin: 15px 0;
  color: #999;
  font-weight: bold;
}

.btn-google {
  width: 100%;
  padding: 12px;
  background: white;
  border: 2px solid #4285f4;
  color: #4285f4;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  margin-bottom: 10px;
}

.btn-google:hover {
  background: #f1f1f1;
}

/* FEED */
.main-content { 
  padding: 10px 0; 
  flex: 1; 
}

.announcement-box { 
  color: white; 
  padding: 8px; 
  border-radius: 8px; 
  margin-bottom: 10px; 
  font-weight: bold; 
  font-size: 0.8rem; 
  text-align: center; 
}

.search-bar { 
  margin-bottom: 10px; 
}

.search-input { 
  width: 100%; 
  padding: 10px; 
  border-radius: 20px; 
  border: none; 
  box-shadow: 0 4px 10px rgba(0,0,0,0.1); 
  font-weight: bold; 
}

.btn-ask-compact { 
  width: 100%; 
  padding: 12px; 
  color: white; 
  border: none; 
  font-weight: 800; 
  border-radius: 10px; 
  margin-bottom: 15px; 
  cursor: pointer; 
}

.feed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100px;
}

.post-card { 
  padding: 12px; 
  border-radius: 10px; 
  border: 1px solid #eee; 
  background: white; 
}

.post-card.pending {
  border-left: 4px solid #f59e0b;
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
  padding: 3px 10px; 
  border-radius: 12px; 
  font-size: 0.65rem; 
  font-weight: 800; 
}

.badge-class { 
  background: #34495e; 
  color: white; 
  padding: 3px 8px; 
  border-radius: 8px; 
  font-size: 0.65rem; 
  font-weight: bold; 
}

.meta { 
  font-size: 0.75rem; 
  text-align: right; 
  line-height: 1.2; 
}

.post-body { 
  font-size: 0.9rem; 
  margin: 8px 0; 
  line-height: 1.4; 
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
  background: rgba(255,255,255,0.1); 
  border-radius: 20px; 
  color: white; 
  font-weight: bold; 
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
  padding: 8px; 
  border-top: 3px solid; 
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
  padding: 12px; 
  margin-bottom: 15px; 
}

.stats-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center;
  margin-bottom: 10px; 
}

.s-btns { 
  display: flex; 
  gap: 5px; 
}

.btn-xs { 
  padding: 4px 8px; 
  font-size: 0.6rem; 
  cursor: pointer; 
  background: #16a085;
  color: white;
  border: none;
  border-radius: 4px;
  font-weight: bold;
}

.charts-grid { 
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 10px; 
}

.c-box { 
  background: white; 
  padding: 10px; 
  border-radius: 8px; 
  min-height: 300px;
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
  background: #16a085; 
  color: white; 
  border: none; 
  width: 35px;
  min-width: 35px;
  border-radius: 5px; 
  cursor: pointer; 
  font-weight: bold;
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
}

.btn-restore-file:hover {
  background: #7d3c98;
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
  padding: 8px; 
  margin-bottom: 8px; 
  border: 1px solid #ddd; 
  border-radius: 6px; 
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
  font-weight: bold; 
  border-radius: 8px; 
  margin-top: 10px; 
  border: none; 
  cursor: pointer; 
}

.btn-save-final:hover {
  opacity: 0.9;
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
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 600px) {
  .charts-grid { grid-template-columns: 1fr; }
  .color-grid { grid-template-columns: 1fr; }
  .modal-box { max-width: 95%; }
  .banner-box { padding: 5px 10px; }
}
</style>