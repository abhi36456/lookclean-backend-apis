import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'look-clean-e3f44';
const apiKey = process.env.FIREBASE_SERVER_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyD8JrCFaPbMAf46aWsnTR6EvkpMvivpd1E';

function getAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }
  try {
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccountVar) {
      const serviceAccount = typeof serviceAccountVar === 'string' ? JSON.parse(serviceAccountVar) : serviceAccountVar;
      if (serviceAccount && typeof serviceAccount.private_key === 'string') {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
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

  const tokens = Array.isArray(token) ? token : [token];

  // Strategy 1: Try Firebase Admin SDK if service account key is configured
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const app = getAdminApp();
      if (app) {
        const messaging = getMessaging(app);
        const message: MulticastMessage = {
          tokens,
          notification: { title, body },
          data: data || {},
          webpush: {
            fcmOptions: { link: '/' },
            notification: { title, body, icon: '/icon.png' },
          },
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log(`[FCM Admin SDK] Sent message "${title}" to ${response.successCount} / ${response.responses.length} devices.`);
        if (response.successCount > 0) {
          return { success: true };
        }
      }
    } catch (adminErr: any) {
      console.warn('[FCM Admin SDK Error]:', adminErr?.message || adminErr);
    }
  }

  // Strategy 2: Fallback to FCM REST API using Client Web API Key
  try {
    console.log(`[FCM REST Fallback] Attempting notification dispatch via FCM REST API with Project ID "${projectId}"...`);
    let successCount = 0;
    let lastError = '';

    for (const singleToken of tokens) {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${apiKey}`,
        },
        body: JSON.stringify({
          to: singleToken,
          notification: {
            title,
            body,
            icon: '/icon.png',
            click_action: '/',
          },
          data: data || {},
          priority: 'high',
        }),
      });

      const resData = await res.json().catch(() => ({}));
      if (res.ok && (resData.success > 0 || resData.message_id)) {
        successCount++;
      } else {
        lastError = resData.error || (resData.results && resData.results[0]?.error) || `HTTP ${res.status}`;
      }
    }

    if (successCount > 0) {
      console.log(`[FCM REST Fallback Success] Sent to ${successCount} device(s).`);
      return { success: true };
    } else {
      const errDetail = lastError
        ? `[FCM REST API Error] ${lastError}`
        : 'FCM push notification failed. (Tip: Ensure FIREBASE_SERVICE_ACCOUNT_KEY or Cloud Messaging API Server Key is configured in .env)';
      console.warn('[FCM Send Failed]:', errDetail);
      return { success: false, error: errDetail };
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[FCM Send Exception]:', errMsg);
    return { success: false, error: errMsg };
  }
}
