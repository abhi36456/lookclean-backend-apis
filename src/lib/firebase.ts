import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyD8JrCFaPbMAf46aWsnTR6EvkpMvivpd1E",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "look-clean-e3f44.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "look-clean-e3f44",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "look-clean-e3f44.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "100058116331",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:100058116331:web:e0da3d0f588dc71d124eae",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-1JQNS2NLEV"
};

// Initialize Firebase App for Client
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

let messaging: Messaging | null = null;

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    messaging = getMessaging(app);
  } catch (err) {
    console.warn('Firebase Messaging failed to initialize:', err);
  }
}

/**
 * Request permission for notifications and obtain FCM Token
 */
export async function requestFcmToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    if (!('Notification' in window)) {
      console.warn('This browser does not support desktop notifications');
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted');
      return null;
    }

    if (!messaging) {
      messaging = getMessaging(app);
    }

    // Standard public VAPID key if configured, or default token fetch
    const currentToken = await getToken(messaging, {
      serviceWorkerRegistration: await navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => undefined)
    });

    if (currentToken) {
      return currentToken;
    } else {
      console.warn('No registration token available. Request permission to generate one.');
      return null;
    }
  } catch (err) {
    console.error('An error occurred while retrieving FCM token:', err);
    return null;
  }
}

/**
 * Listen for foreground push messages
 */
export function onMessageListener(callback: (payload: any) => void) {
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    callback(payload);
  });
}

export { app, messaging };
