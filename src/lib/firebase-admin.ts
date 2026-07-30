import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';

const projectId = process.env.FIREBASE_PROJECT_ID || 'look-clean-e3f44';

function getAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }
  try {
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccountVar) {
      const serviceAccount = typeof serviceAccountVar === 'string' ? JSON.parse(serviceAccountVar) : serviceAccountVar;
      return initializeApp({
        credential: cert(serviceAccount),
        projectId,
      });
    } else {
      return initializeApp({
        projectId,
      });
    }
  } catch (err) {
    console.error('[Firebase Admin] Initialization error:', err);
    return undefined;
  }
}

export interface FcmPayload {
  token: string | string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendFcmNotification({ token, title, body, data }: FcmPayload): Promise<{ success: boolean; error?: any }> {
  if (!token || (Array.isArray(token) && token.length === 0)) {
    console.warn('[FCM] No token provided for notification:', title);
    return { success: false, error: 'No FCM token provided' };
  }

  try {
    const app = getAdminApp();
    if (!app) {
      console.warn('[FCM] Firebase admin app could not be initialized.');
      return { success: false, error: 'Firebase Admin not initialized' };
    }

    const messaging = getMessaging(app);
    const message: MulticastMessage = {
      tokens: Array.isArray(token) ? token : [token],
      notification: {
        title,
        body,
      },
      data: data || {},
      webpush: {
        fcmOptions: {
          link: '/',
        },
        notification: {
          title,
          body,
          icon: '/icon.png',
        },
      },
    };

    const response = await messaging.sendEachForMulticast(message);
    console.log(`[FCM] Sent message "${title}" to ${response.successCount} / ${response.responses.length} devices.`);
    
    if (response.successCount > 0) {
      return { success: true };
    } else {
      const firstResp = response.responses[0];
      const errObj = firstResp?.error;
      const hasServiceKey = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      
      let errorDetail = errObj
        ? `[${errObj.code || 'fcm_error'}] ${errObj.message}`
        : 'FCM push notification failed (0 devices received message).';

      if (!hasServiceKey) {
        errorDetail += ' NOTE: FIREBASE_SERVICE_ACCOUNT_KEY is missing in server .env file. Real FCM push notifications require Firebase Admin Service Account Key JSON.';
      }

      console.warn('[FCM Send Failed]:', errorDetail);
      return { success: false, error: errorDetail };
    }
  } catch (err: any) {
    const hasServiceKey = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    let errMsg = err?.message || String(err);
    if (!hasServiceKey) {
      errMsg += ' (FIREBASE_SERVICE_ACCOUNT_KEY missing in .env)';
    }
    console.error('[FCM Send Exception]:', errMsg);
    return { success: false, error: errMsg };
  }
}
