import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  CACHE_SIZE_UNLIMITED,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const missing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  throw new Error(`Missing Firebase config: ${missing.join(", ")}`);
}

// Firebase'i başlat
const app = initializeApp(firebaseConfig);
const adminApp = initializeApp(firebaseConfig, "adminApp");

// Dışa aktar
export const auth = getAuth(app);
export const adminAuth = getAuth(adminApp);
export const db = initializeFirestore(app, {
  // Enable persistent IndexedDB cache for true offline reads after first sync.
  localCache: typeof window !== "undefined" && "indexedDB" in window
    ? persistentLocalCache({
        cacheSizeBytes: 100 * 1024 * 1024, // 100 MB limit
        tabManager: persistentMultipleTabManager()
      })
    : memoryLocalCache(),
  // Work around WebChannel connection issues on some networks/extensions.
  experimentalForceLongPolling: true,
  useFetchStreams: false
});
