importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyD8JrCFaPbMAf46aWsnTR6EvkpMvivpd1E",
  authDomain: "look-clean-e3f44.firebaseapp.com",
  projectId: "look-clean-e3f44",
  storageBucket: "look-clean-e3f44.firebasestorage.app",
  messagingSenderId: "100058116331",
  appId: "1:100058116331:web:e0da3d0f588dc71d124eae",
  measurementId: "G-1JQNS2NLEV"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  const notificationTitle = payload.notification ? payload.notification.title : (payload.data ? payload.data.title : 'LookClean Notification');
  const notificationOptions = {
    body: payload.notification ? payload.notification.body : (payload.data ? payload.data.body : ''),
    icon: '/icon.png',
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
