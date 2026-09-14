// Scripts for firebase and firebase messaging
importScripts('https://www.gstatic.com/firebasejs/9.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.15.0/firebase-messaging-compat.js');

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDyUT23tUg7E1wQh5J1msxDzShGSceAAJ4",
    authDomain: "outsmart-f1174.firebaseapp.com",
    databaseURL: "https://outsmart-f1174-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "outsmart-f1174",
    storageBucket: "outsmart-f1174.firebasestorage.app",
    messagingSenderId: "679675760568",
    appId: "1:679675760568:web:ec3a6e0e8487f01efd094d",
    measurementId: "G-S2RMK4NWV1"
};

// Initialize the Firebase app in the service worker
firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// This handler will be called when a push message is received
// while the app is in the background or closed.
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/img/OutSmart_Icon_50x50px-removebg-preview.png' // A nice icon for the notification
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});