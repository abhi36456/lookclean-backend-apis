import * as admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID || 'look-clean-e3f44';

if (!admin.apps.length) {
  try {
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccountVar) {
      const serviceAccount = typeof serviceAccountVar === 'string' ? JSON.parse(serviceAccountVar) : serviceAccountVar;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      // Default app initialization with project ID
      admin.initializeApp({
        projectId,
      });
    }
    console.log('[Firebase Admin] Initialized successfully for project:', projectId);
  } catch (err) {
    console.error('[Firebase Admin] Initialization error:', err);
  }
}

export interface FcmPayload {
  token: string | string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Sends a push notification to one or multiple FCM tokens.
 */
export async function sendFcmNotification({ token, title, body, data }: FcmPayload): Promise<{ success: boolean; messageId?: string; error?: any }> {
  if (!token || (Array.isArray(token) && token.length === 0)) {
    console.warn('[FCM] No token provided for notification:', title);
    return { success: false, error: 'No FCM token provided' };
  }

  try {
    const message: admin.messaging.MulticastMessage = {
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

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[FCM] Sent message "${title}" to ${response.successCount} / ${response.responses.length} devices.`);
    
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`[FCM Error] Device index ${idx} failed:`, resp.error?.message);
        }
      });
    }

    return { success: response.successCount > 0 };
  } catch (err: any) {
    console.error('[FCM Send Error]:', err?.message || err);
    return { success: false, error: err?.message || err };
  }
}

export { admin };
