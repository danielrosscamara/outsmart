// =================================================================
//                 OutSmart Main Application Script (Final)
//       (Handles Auth, Dashboard, QR Scanner, and Timers)
//                — RE-ARCHITECTED: Multi-user outlet sharing model
//                — ADDED: Owner/Admin/Guest permission system
//                — ADDED: Access request and approval workflow
//                — ADDED: Temporary Access Code generation and redemption
//                — ADDED: Profile Picture Upload and Display
//                — PRESERVED: All original features (schedules, idle, billing, etc.)
//                — FIXED: All UI blinking and unresponsiveness bugs
// =================================================================

/* eslint-disable no-undef */
// --- IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, EmailAuthProvider, updatePassword, reauthenticateWithCredential, deleteUser } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getDatabase, ref, set, onValue, update, get, runTransaction, push, remove } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-storage.js";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDyUT23tUg7E1wQh5J1msxDzShGSceAAJ4",
    authDomain: "outsmart-f1174.firebaseapp.com",
    databaseURL: "https://outsmart-f1174-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "outsmart-f1174",
    storageBucket: "outsmart-f1174.appspot.com",
    messagingSenderId: "679675760568",
    appId: "1:679675760568:web:ec3a6e0e8487f01efd094d",
    measurementId: "G-S2RMK4NWV1"
};

// --- INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

const appStartTime = Date.now();

let globalTimerProcessorInterval = null;
let outletsListenerUnsub = null;
let wattMonitorUnsub = null;

let globalUserUID = null;
let lastKnownOutletState = {};
const activeTimers = {};
let userOutletsData = {};

// --- HELPER FUNCTIONS ---

async function logNotificationForUser(userId, message) {
    if (!userId) return;
    const notificationRef = ref(db, `users/${userId}/notifications`);
    try {
        await push(notificationRef, { message: message, timestamp: Date.now() });
    } catch (error) { console.error("Failed to log targeted notification:", error); }
}

async function notifyOwnerOfAdminAction(action, outletId) {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) return;
        
        const memberSnap = await get(ref(db, `outletMembers/${outletId}/${currentUser.uid}`));
        if (!memberSnap.exists() || memberSnap.val().role === 'main_owner') return;

        const ownerSnap = await get(ref(db, `outletOwnership/${outletId}`));
        if (ownerSnap.exists()) {
            const ownerId = ownerSnap.val();
            const userSnap = await get(ref(db, `users/${currentUser.uid}/username`));
            const adminName = userSnap.val() || 'An admin';
            const outletSnap = await get(ref(db, `outletSettings/${outletId}/name`));
            const outletName = outletSnap.val() || outletId;
            await logNotificationForUser(ownerId, `${adminName} ${action} outlet '${outletName}'.`);
        }
    } catch (error) { console.error("Failed to send admin action notification:", error); }
}

function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(err => console.warn('Notification permission request failed', err));
    }
}

function showNotification(title, body) {
    if ("Notification" in window && Notification.permission === 'granted') {
        try { new Notification(title, { body }); } catch (e) { console.warn('Notification failed', e); }
    } else {
        try { alert(`${title}\n\n${body}`); } catch(e) { console.log(title, body); }
    }
}

// =================================================================
//               MASTER AUTHENTICATION GATEKEEPER
// =================================================================

onAuthStateChanged(auth, (user) => {
    const currentPage = window.location.pathname;
    if (user) {
        globalUserUID = user.uid;
        try { requestNotificationPermission(); } catch(e){}

        displayUsername(user);
        displayUserProfilePicture(user);
        startGlobalTimerProcessor(); 
        startGlobalWattMonitor();
        initializeTempCodeModal(user); 

        const isRegistering = sessionStorage.getItem('isRegistering');
        if (!isRegistering && (currentPage.endsWith('login.html') || currentPage.endsWith('register.html'))) {
            window.location.href = 'index.html';
        } else if (currentPage.endsWith('index.html') || currentPage.includes('index.html') || currentPage.endsWith('/')) {
            initializeDashboard(user);
            initializeLogoutButtons();
            initializeQrScanner();
            initializeTimerModal();
            initializeBulkControlButtons();
        } else if (currentPage.endsWith('outlet.html')) { 
            initializeOutletManagementPage(user);
            initializeLogoutButtons();
            initializeQrScanner(); 
        } else if (currentPage.endsWith('billestimator.html')) {
            initializeBillEstimator(user);
            initializeLogoutButtons();
        } else if (currentPage.endsWith('settings.html')) {
            initializeSettingsPage(user);
            initializeLogoutButtons();
            initializeScheduleModal();
            initializeIdleConfigModal();
            initializeProfilePictureUploader(user);
        } else if (currentPage.endsWith('notification.html')) {
            initializeNotificationPage(user);
            initializeLogoutButtons();
        } else if (currentPage.endsWith('profile.html')) {
            initializeProfilePage(user);
            initializeLogoutButtons();
        }

    } else {
        globalUserUID = null;
        if (globalTimerProcessorInterval) clearInterval(globalTimerProcessorInterval);
        if (outletsListenerUnsub) { try { outletsListenerUnsub(); } catch(e){} }
        if (wattMonitorUnsub) { try { wattMonitorUnsub(); } catch(e){} }
        Object.values(activeTimers).forEach(clearInterval);
        for (const key in activeTimers) { delete activeTimers[key]; }

        if (!currentPage.endsWith('login.html') && !currentPage.endsWith('register.html')) {
            window.location.href = 'login.html';
        } else if (currentPage.endsWith('login.html')) {
            initializeLoginForm();
        } else if (currentPage.endsWith('register.html')) {
            initializeRegisterForm();
        }
    }
});

// =================================================================
//               UI DISPLAY & BACKGROUND PROCESSES
// =================================================================

function displayUsername(user) {
    if (!user) return;
    const userRef = ref(db, 'users/' + user.uid);
    onValue(userRef, (snapshot) => {
        const userData = snapshot.val();
        if (userData && userData.username) {
            const username = userData.username;
            const welcomeMessageElement = document.getElementById('welcome-message');
            const usernameDisplayElement = document.getElementById('username-display');
            if (welcomeMessageElement) welcomeMessageElement.textContent = `Welcome back, ${username}`;
            if (usernameDisplayElement) usernameDisplayElement.textContent = username;
        } else {
            const usernameDisplayElement = document.getElementById('username-display');
            if (usernameDisplayElement) usernameDisplayElement.textContent = user.email;
        }
    }, { onlyOnce: true });
}

function displayUserProfilePicture(user) {
    if (!user) return;
    const userRef = ref(db, `users/${user.uid}`);

    onValue(userRef, (snapshot) => {
        const userData = snapshot.val();
        const profilePicUrl = userData?.profilePictureUrl;
        const profileImages = document.querySelectorAll('.img-profile');

        if (profilePicUrl) {
            profileImages.forEach(img => { img.src = profilePicUrl; });
        } else {
            profileImages.forEach(img => { img.src = "assets/img/artworks-YDQOy2Pru5CA2rhs-x1uzgA-t500x500.jpg"; });
        }
    });
}

async function checkAndProcessExpiredTimers() {
    try {
        const dbRootSnapshot = await get(ref(db));
        if (!dbRootSnapshot.exists()) return;
        
        const dbState = dbRootSnapshot.val();
        const allOutletsLive = dbState.Outlets || {};
        const allOutletsSettings = dbState.outletSettings || {};
        const allOwnership = dbState.outletOwnership || {};
        const allMembers = dbState.outletMembers || {};
        const allUsersConfig = Object.fromEntries(Object.entries(dbState.users || {}).map(([uid, data]) => [uid, data.config]));

        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const currentDay = now.getDay();
        const updates = {};
        const notificationsToSend = [];
        const OFFLINE_THRESHOLD_MS = 15 * 1000;

        for (const outletId in allOutletsSettings) {
            const settings = allOutletsSettings[outletId];
            const live = allOutletsLive[outletId];
            const ownerId = allOwnership[outletId];
            const outletName = settings.name || outletId;

            const outletMembers = allMembers[outletId] || {};
            for (const memberId in outletMembers) {
                const member = outletMembers[memberId];
                if (member.expiresAt && member.expiresAt < now.getTime()) {
                    updates[`/outletMembers/${outletId}/${memberId}/accessEnabled`] = false;
                    updates[`/outletMembers/${outletId}/${memberId}/isAdmin`] = false;
                    updates[`/outletMembers/${outletId}/${memberId}/expiresAt`] = null;
                    const messageForGuest = `Your temporary access to '${outletName}' has expired.`;
                    const messageForOwner = `Temporary access for user '${memberId}' to '${outletName}' has expired.`;
                    notificationsToSend.push({ userId: memberId, message: messageForGuest });
                    if(ownerId) notificationsToSend.push({ userId: ownerId, message: messageForOwner });
                }
            }

            if (!live || !settings || !ownerId) continue;
            
            const kwhRate = allUsersConfig[ownerId]?.kwhRate || 14.00;

            const addBillingUpdate = (outletStatus, lastStatusChange, currentWatts) => {
                if (outletStatus === 'HIGH') {
                    const runningTimeMs = now.getTime() - (lastStatusChange || now.getTime());
                    const runningTimeHours = runningTimeMs / 36e5;
                    if (runningTimeHours > 0) {
                        const kwhThisSession = ((parseFloat(currentWatts) || 0) / 1000) * runningTimeHours;
                        const billingPath = `/users/${ownerId}/outletBilling/${outletId}/accumulatedKwh`;
                        updates[billingPath] = (updates[billingPath] || 0) + kwhThisSession;
                    }
                }
            };

            if (settings.timerSet && settings.timerTargetTimestamp && settings.timerTargetTimestamp < now.getTime()) {
                addBillingUpdate(live.status, live.lastStatusChange, live.watts);
                updates[`/Outlets/${outletId}/status`] = settings.timerTargetStatus;
                updates[`/Outlets/${outletId}/lastStatusChange`] = now.getTime();
                updates[`/outletSettings/${outletId}/timerSet`] = false;
                updates[`/outletSettings/${outletId}/timerTargetTimestamp`] = null;
                updates[`/outletSettings/${outletId}/timerTargetStatus`] = null;
                const actionText = settings.timerTargetStatus === 'HIGH' ? 'turned on' : 'turned off';
                const message = `${outletName} was ${actionText} by timer.`;
                Object.keys(allMembers[outletId] || {}).forEach(uid => notificationsToSend.push({ userId: uid, message }));
            }

            if (settings.schedules) {
                for (const scheduleId in settings.schedules) {
                    const schedule = settings.schedules[scheduleId];
                    if (schedule?.enabled && Array.isArray(schedule.days) && schedule.days.includes(currentDay)) {
                        const [hour, minute] = (schedule.time || '00:00').split(':').map(Number);
                        const scheduleTime = hour * 60 + minute;
                        if (scheduleTime === currentTime && (now.getTime() - (schedule.lastExecutedTimestamp || 0) > 60000)) {
                            if (schedule.action !== live.status) {
                                addBillingUpdate(live.status, live.lastStatusChange, live.watts);
                                updates[`/Outlets/${outletId}/status`] = schedule.action;
                                updates[`/Outlets/${outletId}/lastStatusChange`] = now.getTime();
                                updates[`/outletSettings/${outletId}/schedules/${scheduleId}/lastExecutedTimestamp`] = now.getTime();
                                const actionText = schedule.action === 'HIGH' ? 'turned on' : 'turned off';
                                const message = `${outletName} was ${actionText} by schedule.`;
                                Object.keys(allMembers[outletId] || {}).forEach(uid => notificationsToSend.push({ userId: uid, message }));
                            }
                        }
                    }
                }
            }
            
            const idleConfig = settings.idleConfig;
            if (idleConfig?.enabled) {
                const currentWatts = parseFloat(live.watts) || 0;
                const idleThreshold = parseFloat(idleConfig.idleThresholdWatts) || 0;
                const currentState = live.idleState || {};
                const isCurrentlyIdle = live.status === 'HIGH' && currentWatts <= idleThreshold;
                if (isCurrentlyIdle) {
                    if (!currentState.idleSinceTimestamp) {
                        updates[`/Outlets/${outletId}/idleState/idleSinceTimestamp`] = now.getTime();
                    } else if (!currentState.notificationSent) {
                        const idleDurationMs = now.getTime() - currentState.idleSinceTimestamp;
                        const idleTimeMsConfigured = (parseInt(idleConfig.idleTimeMinutes, 10) || 0) * 60 * 1000;
                        if (idleDurationMs >= idleTimeMsConfigured) {
                            updates[`/Outlets/${outletId}/idleState/notificationSent`] = true;
                            const gracePeriodMs = (parseInt(idleConfig.gracePeriodMinutes, 10) || 0) * 60 * 1000;
                            updates[`/Outlets/${outletId}/idleState/pendingShutdownTimestamp`] = now.getTime() + gracePeriodMs;
                            const title = `Idle device: ${outletName}`;
                            const body = `Device has been idle for ${idleConfig.idleTimeMinutes} minutes. It will turn off automatically in ${idleConfig.gracePeriodMinutes} minutes.`;
                            Object.keys(allMembers[outletId] || {}).forEach(uid => notificationsToSend.push({ userId: uid, message: `${outletName} is idle.`, title, body }));
                        }
                    }
                } else if (currentState.idleSinceTimestamp) {
                    updates[`/Outlets/${outletId}/idleState`] = null;
                }
            }
            
            if (live.idleState?.pendingShutdownTimestamp && live.idleState.pendingShutdownTimestamp < now.getTime()) {
                addBillingUpdate(live.status, live.lastStatusChange, live.watts);
                updates[`/Outlets/${outletId}/status`] = 'LOW';
                updates[`/Outlets/${outletId}/lastStatusChange`] = now.getTime();
                updates[`/Outlets/${outletId}/idleState`] = null;
                const title = `Device Turned Off: ${outletName}`;
                const body = `The device was automatically turned off due to inactivity.`;
                const message = `${outletName} was automatically turned off due to inactivity.`;
                Object.keys(allMembers[outletId] || {}).forEach(uid => notificationsToSend.push({ userId: uid, message, title, body }));
            }
            
            if (idleConfig?.continuityCheckEnabled && live.status === 'HIGH' && !live.continuityCheckPending) {
                const runtimeMs = now.getTime() - (live.lastStatusChange || now.getTime());
                const configuredDurationMs = (parseInt(idleConfig.continuityCheckHours, 10) || 8) * 3600 * 1000;
                if (runtimeMs >= configuredDurationMs) {
                    const gracePeriodMins = parseInt(idleConfig.continuityGracePeriodMinutes, 10) || 5;
                    updates[`/Outlets/${outletId}/continuityCheckPending`] = true;
                    updates[`/Outlets/${outletId}/continuityShutdownTimestamp`] = now.getTime() + (gracePeriodMins * 60 * 1000);
                    const title = `Are you still there?`;
                    const body = `'${outletName}' has been running for ${idleConfig.continuityCheckHours} hours. Please open the app to confirm you're still using it.`;
                    Object.keys(allMembers[outletId] || {}).forEach(uid => notificationsToSend.push({ userId: uid, message: body, title, body }));
                }
            }

            if (live.continuityCheckPending && live.continuityShutdownTimestamp && live.continuityShutdownTimestamp < now.getTime()) {
                addBillingUpdate(live.status, live.lastStatusChange, live.watts);
                updates[`/Outlets/${outletId}/status`] = 'LOW';
                updates[`/Outlets/${outletId}/lastStatusChange`] = now.getTime();
                updates[`/Outlets/${outletId}/continuityCheckPending`] = null;
                updates[`/Outlets/${outletId}/continuityShutdownTimestamp`] = null;
                const message = `'${outletName}' was automatically turned off after running for a long time.`;
                Object.keys(allMembers[outletId] || {}).forEach(uid => notificationsToSend.push({ userId: uid, message: message, title: 'Device Auto-Off' }));
            }
            
            if (now.getTime() - appStartTime > 20000) {
                const lastHeartbeat = live.lastUpdatedTimestamp || 0;
                const isOffline = (now.getTime() - lastHeartbeat) > OFFLINE_THRESHOLD_MS;
                if (isOffline && !settings.offlineNotificationSent) {
                    updates[`/outletSettings/${outletId}/offlineNotificationSent`] = true;
                    const message = `${outletName} appears to be offline.`;
                    const title = `Outlet Offline: ${outletName}`;
                    Object.keys(allMembers[outletId] || {}).forEach(uid => notificationsToSend.push({ userId: uid, message, title, body: `The outlet may be offline.` }));
                }
            }
        }

        const billingUpdates = Object.entries(updates).filter(([path]) => path.includes('/outletBilling/')).map(([path, value]) => ({ ref: ref(db, path), value }));
        const otherUpdates = Object.fromEntries(Object.entries(updates).filter(([path]) => !path.includes('/outletBilling/')));
        const transactionPromises = billingUpdates.map(bu => runTransaction(bu.ref, (currentKwh) => (currentKwh || 0) + bu.value));
        await Promise.all(transactionPromises);

        if (Object.keys(otherUpdates).length > 0) {
            await update(ref(db), otherUpdates);
        }

        for (const notif of notificationsToSend) {
            if (notif.userId === globalUserUID) { showNotification(notif.title || "OutSmart Notification", notif.body || notif.message); }
            await logNotificationForUser(notif.userId, notif.message);
        }
    } catch (err) { console.error("Error processing global timers:", err); }
}

function startGlobalTimerProcessor(intervalMs = 5000) {
    if (globalTimerProcessorInterval) clearInterval(globalTimerProcessorInterval);
    globalTimerProcessorInterval = setInterval(checkAndProcessExpiredTimers, intervalMs);
}

async function startGlobalWattMonitor() {
    if (wattMonitorUnsub) { try { wattMonitorUnsub(); } catch(e){} wattMonitorUnsub = null; }
    
    const outletsRef = ref(db, 'Outlets/');
    wattMonitorUnsub = onValue(outletsRef, async (snapshot) => {
        if (!snapshot.exists()) return;
        const currentLiveData = snapshot.val();
        const wattUpdates = {};
        
        const settingsSnapshot = await get(ref(db, 'outletSettings'));
        const allOutletSettings = settingsSnapshot.val() || {};
        
        for (const outletId in currentLiveData) {
            const outletData = currentLiveData[outletId];
            if (typeof outletData !== 'object' || outletData === null) continue;

            const previousOutletState = lastKnownOutletState[outletId] || {};
            const hasNewData = previousOutletState.lastUpdatedTimestamp && previousOutletState.lastUpdatedTimestamp !== outletData.lastUpdatedTimestamp;

            if (hasNewData) {
                const outletSettings = allOutletSettings[outletId];
                if (outletSettings && outletSettings.offlineNotificationSent) {
                    wattUpdates[`/outletSettings/${outletId}/offlineNotificationSent`] = null;
                    const membersSnapshot = await get(ref(db, `outletMembers/${outletId}`));
                    if(membersSnapshot.exists()){
                        const members = membersSnapshot.val();
                        const outletName = outletSettings.name || outletId;
                        for(const uid in members){
                             logNotificationForUser(uid, `${outletName} is back online.`);
                             if (uid === globalUserUID) {
                                 showNotification(`Outlet Back Online: ${outletName}`, `The device is now connected.`);
                             }
                        }
                    }
                }
            }

            const currentWatts = parseFloat(outletData.watts) || 0;
            if (outletData.highestWatts === undefined || currentWatts > (parseFloat(outletData.highestWatts) || 0)) {
                wattUpdates[`/Outlets/${outletId}/highestWatts`] = currentWatts;
            }
            if (currentWatts > 0) {
                const prevLowest = parseFloat(outletData.lowestWatts) || 0;
                if (prevLowest === 0 || currentWatts < prevLowest) {
                    wattUpdates[`/Outlets/${outletId}/lowestWatts`] = currentWatts;
                }
            }
        }

        if (Object.keys(wattUpdates).length > 0) {
            update(ref(db), wattUpdates).catch(err => console.error("Failed to update watt/heartbeat records:", err));
        }
        lastKnownOutletState = currentLiveData;
    });
}

// =================================================================
//                    FEATURE INITIALIZER FUNCTIONS
// =================================================================

function initializeLoginForm() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            signInWithEmailAndPassword(auth, email, password)
                .catch(error => alert("Login failed: " + error.message));
        });
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const seconds = Math.floor((now - timestamp) / 1000);
    if (seconds < 10) return `just now`;
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function initializeDashboard(user) {
    const mainTableBody = document.getElementById('outlet-table-body');
    const controlPanelBody = document.getElementById('outlet-control-panel');
    if (!mainTableBody || !controlPanelBody) return;

    if (outletsListenerUnsub) { try { outletsListenerUnsub(); } catch (e) {} }
    
    let dashboardData = {}; 
    const activeOutletListeners = {};
    const lastKnownTimerTargets = {};
    const continuityTimers = {};

    const rootRef = ref(db);
    outletsListenerUnsub = onValue(rootRef, (snapshot) => {
        if (!snapshot.exists()) {
            mainTableBody.innerHTML = '<tr><td colspan="5" class="text-center">No outlets found. Scan a QR code to add one.</td></tr>';
            controlPanelBody.innerHTML = '<tr><td colspan="4" class="text-center">No outlets found.</td></tr>';
            return;
        }
        const dbState = snapshot.val();
        
        const outletsToShow = new Set();
        if (dbState.outletMembers) {
            for (const outletId in dbState.outletMembers) {
                if (dbState.outletMembers[outletId][user.uid]?.accessEnabled) outletsToShow.add(outletId);
            }
        }
        if (dbState.outletSettings) {
            for (const outletId in dbState.outletSettings) {
                if (dbState.outletSettings[outletId].accessRequests?.[user.uid]) outletsToShow.add(outletId);
            }
        }

        const currentIds = Object.keys(activeOutletListeners);
        const newIds = Array.from(outletsToShow);

        currentIds.forEach(outletId => {
            if (!newIds.includes(outletId)) {
                activeOutletListeners[outletId].unsubLive();
                activeOutletListeners[outletId].unsubSettings();
                delete activeOutletListeners[outletId];
                delete dashboardData[outletId];
                document.getElementById(`outlet-row-${outletId}`)?.remove();
                document.getElementById(`control-row-${outletId}`)?.remove();
            }
        });
        
        if (newIds.length === 0) {
            mainTableBody.innerHTML = '<tr><td colspan="5" class="text-center">No outlets found. Scan a QR code to add one.</td></tr>';
            controlPanelBody.innerHTML = '<tr><td colspan="4" class="text-center">No outlets found.</td></tr>';
        } else if (mainTableBody.querySelector('td[colspan="5"]')) {
            mainTableBody.innerHTML = '';
            controlPanelBody.innerHTML = '';
        }

        newIds.forEach(outletId => {
            if (!activeOutletListeners[outletId]) {
                dashboardData[outletId] = {}; 

                const liveRef = ref(db, `Outlets/${outletId}`);
                const unsubLive = onValue(liveRef, (snap) => {
                    dashboardData[outletId].live = snap.val() || {};
                    renderOrUpdateRow(outletId);
                });

                const settingsRef = ref(db, `outletSettings/${outletId}`);
                const unsubSettings = onValue(settingsRef, (snap) => {
                    dashboardData[outletId].settings = snap.val() || {};
                    renderOrUpdateRow(outletId);
                });

                activeOutletListeners[outletId] = { unsubLive, unsubSettings };
            }
        });
    });

    const renderOrUpdateRow = (outletId) => {
        const data = dashboardData[outletId];
        if (!data || (!data.live && !data.settings)) return; 

        const settings = data.settings || {};
        const live = data.live || {};
        const isPending = settings.accessRequests?.[user.uid];

        if (isPending) {
             let mainRow = document.getElementById(`outlet-row-${outletId}`) || document.createElement('tr');
             mainRow.id = `outlet-row-${outletId}`;
             mainRow.className = "outlet-pending";
             mainRow.innerHTML = `<td>${settings.name || outletId}<br><small class="text-warning">Pending Approval</small></td><td colspan="4" class="text-muted">Waiting for owner to grant access...</td>`;
             if (!mainRow.parentNode) mainTableBody.appendChild(mainRow);
             
             let controlRow = document.getElementById(`control-row-${outletId}`) || document.createElement('tr');
             controlRow.id = `control-row-${outletId}`;
             controlRow.className = "outlet-pending";
             controlRow.innerHTML = `<td>${settings.name || outletId}</td><td colspan="3" class="text-muted">Pending Approval</td>`;
             if (!controlRow.parentNode) controlPanelBody.appendChild(controlRow);
             return;
        }

        const outletData = { ...settings, ...live };
        let statusInfo = '';
        if (outletData.lastStatusChange) {
            const statusText = (outletData.status || 'LOW').toUpperCase() === 'HIGH' ? 'Running' : 'Stopped';
            statusInfo = `<br><small class="text-muted" style="font-size: 0.75rem;">${statusText} ${formatTimeAgo(outletData.lastStatusChange)}</small>`;
        }

        let mainRow = document.getElementById(`outlet-row-${outletId}`);
        if (!mainRow) {
            mainRow = document.createElement('tr'); 
            mainRow.id = `outlet-row-${outletId}`;
            mainRow.innerHTML = `<td class="outlet-name-cell"></td><td class="outlet-watts-cell"></td><td class="outlet-current-cell"></td><td class="outlet-voltage-cell"></td><td id="main-timer-${outletId}">--:--</td>`;
            mainTableBody.appendChild(mainRow);
        }
        mainRow.querySelector('.outlet-name-cell').innerHTML = `${outletData.name || outletId}${statusInfo}`;
        mainRow.querySelector('.outlet-watts-cell').textContent = `${(parseFloat(outletData.watts) || 0).toFixed(2)} W`;
        mainRow.querySelector('.outlet-current-cell').textContent = `${(parseFloat(outletData.current) || 0).toFixed(2)} A`;
        mainRow.querySelector('.outlet-voltage-cell').textContent = `${(parseFloat(outletData.voltage) || 0).toFixed(2)} V`;

        const isChecked = ((outletData.status || 'LOW').toUpperCase() === 'HIGH');
        const timerIconClass = outletData.timerSet ? '' : 'text-muted';
        
        let controlRow = document.getElementById(`control-row-${outletId}`);
        if (!controlRow) {
            controlRow = document.createElement('tr'); 
            controlRow.id = `control-row-${outletId}`;
            controlRow.innerHTML = `<td class="control-name-cell"></td><td class="control-status-cell"></td><td class="control-set-time-cell"></td><td class="control-time-left-cell"><span id="timer-countdown-${outletId}">--:--</span></td>`;
            controlPanelBody.appendChild(controlRow);
        }

        controlRow.querySelector('.control-name-cell').textContent = outletData.name || outletId;
        controlRow.querySelector('.control-status-cell').innerHTML = `<label class="switch"><input type="checkbox" class="status-toggle" data-id="${outletId}" ${isChecked ? 'checked' : ''}><span class="slider round"></span></label>`;
        
        const setTimeCell = controlRow.querySelector('.control-set-time-cell');
        const timeLeftSpan = controlRow.querySelector(`#timer-countdown-${outletId}`);
        controlRow.classList.remove('table-warning');

        if (live.continuityCheckPending) {
            controlRow.classList.add('table-warning');
            setTimeCell.innerHTML = `<button type="button" class="btn btn-sm btn-success confirm-use-btn" data-id="${outletId}"><i class="fas fa-check"></i> Confirm Use</button>`;
            if (!continuityTimers[outletId]) {
                continuityTimers[outletId] = setInterval(() => {
                    const distance = (live.continuityShutdownTimestamp || 0) - Date.now();
                    if (distance < 0) {
                        timeLeftSpan.innerHTML = `<span class="text-danger">Shutting down...</span>`;
                        clearInterval(continuityTimers[outletId]);
                        delete continuityTimers[outletId];
                        return;
                    }
                    const m = Math.floor(distance % 36e5 / 6e4);
                    const s = Math.floor(distance % 6e4 / 1e3).toString().padStart(2, '0');
                    timeLeftSpan.innerHTML = `<span class="text-danger">Shuts off in ${m}:${s}</span>`;
                }, 1000);
            }
        } else {
            setTimeCell.innerHTML = `<button type="button" class="btn btn-sm btn-outline-primary set-timer-link" data-id="${outletId}"><i class="fas fa-clock ${timerIconClass}"></i> Set Timer</button>`;
            if (continuityTimers[outletId]) {
                clearInterval(continuityTimers[outletId]);
                delete continuityTimers[outletId];
                timeLeftSpan.textContent = '--:--';
            }
        }

        const newTarget = (outletData.timerSet && outletData.timerTargetTimestamp) ? outletData.timerTargetTimestamp : null;
        if (!newTarget && activeTimers[outletId]) {
            clearInterval(activeTimers[outletId]); 
            delete activeTimers[outletId]; 
            delete lastKnownTimerTargets[outletId];
            if(timeLeftSpan) timeLeftSpan.textContent = '--:--';
            if(document.getElementById(`main-timer-${outletId}`)) document.getElementById(`main-timer-${outletId}`).textContent = '--:--';
        } else if (newTarget && lastKnownTimerTargets[outletId] !== newTarget) {
            if (activeTimers[outletId]) clearInterval(activeTimers[outletId]);
            lastKnownTimerTargets[outletId] = newTarget;
            activeTimers[outletId] = setInterval(() => {
                const mainTimerEl = document.getElementById(`main-timer-${outletId}`);
                if (!timeLeftSpan || !mainTimerEl) { 
                    clearInterval(activeTimers[outletId]); 
                    delete activeTimers[outletId]; 
                    return; 
                }
                const distance = lastKnownTimerTargets[outletId] - Date.now();
                if (distance < 0) {
                    clearInterval(activeTimers[outletId]); 
                    delete activeTimers[outletId];
                    if (!live.continuityCheckPending) timeLeftSpan.textContent = 'Done!'; 
                    mainTimerEl.textContent = 'Done!';
                    return;
                }
                const h = Math.floor(distance / 36e5), m = Math.floor(distance % 36e5 / 6e4), s = Math.floor(distance % 6e4 / 1e3);
                const countdownText = `${h}h ${m}m ${s}s`;
                if (!live.continuityCheckPending) {
                    timeLeftSpan.textContent = countdownText; 
                }
                mainTimerEl.textContent = countdownText;
            }, 1000);
        }
    };
    
    controlPanelBody.addEventListener('click', async e => {
        const confirmBtn = e.target.closest('.confirm-use-btn');
        if (confirmBtn) {
            const outletId = confirmBtn.dataset.id;
            const updates = {};
            updates[`/Outlets/${outletId}/continuityCheckPending`] = null;
            updates[`/Outlets/${outletId}/continuityShutdownTimestamp`] = null;
            updates[`/Outlets/${outletId}/lastStatusChange`] = Date.now();
            await update(ref(db), updates);
            logNotificationForUser(user.uid, `Usage confirmed for outlet '${dashboardData[outletId]?.settings?.name || outletId}'. The timer has been reset.`);
        }
    });
    
    if (!controlPanelBody.dataset.listenerAttached) {
        controlPanelBody.addEventListener('change', async e => {
            if (e.target.classList.contains('status-toggle')) {
                const outletId = e.target.dataset.id;
                const isTurningOn = e.target.checked;
                const now = Date.now();
                
                const ownerIdSnapshot = await get(ref(db, `outletOwnership/${outletId}`));
                if (!ownerIdSnapshot.exists()) {
                    console.error("Could not find owner for this outlet. Aborting.");
                    e.target.checked = !isTurningOn;
                    return;
                }
                const ownerId = ownerIdSnapshot.val();
                
                const updates = { status: isTurningOn ? 'HIGH' : 'LOW', lastStatusChange: now };
                updates.continuityCheckPending = null;
                updates.continuityShutdownTimestamp = null;
                
                if (!isTurningOn) {
                    const liveDataSnap = await get(ref(db, `Outlets/${outletId}`));
                    const liveData = liveDataSnap.val();
                    if (liveData) {
                        const runningTimeMs = now - (liveData.lastStatusChange || now);
                        if (runningTimeMs > 0) {
                            const runningTimeHours = runningTimeMs / 36e5;
                            const kwhThisSession = ((parseFloat(liveData.watts) || 0) / 1000) * runningTimeHours;
                            const billingRef = ref(db, `users/${ownerId}/outletBilling/${outletId}/accumulatedKwh`);
                            await runTransaction(billingRef, (currentKwh) => (currentKwh || 0) + kwhThisSession);
                        }
                    }
                }
                await update(ref(db, `Outlets/${outletId}`), updates);
            }
        });
        controlPanelBody.dataset.listenerAttached = 'true';
    }
}

function initializeNotificationPage(user) {
    const listContainer = document.getElementById('notification-list-container');
    const clearButton = document.getElementById('clear-all-notifications');
    if (!listContainer || !clearButton) return;

    const notificationsRef = ref(db, `users/${user.uid}/notifications`);

    onValue(notificationsRef, (snapshot) => {
        listContainer.innerHTML = '';
        if (!snapshot.exists()) {
            listContainer.innerHTML = '<p class="text-center text-light">No notifications yet.</p>';
            return;
        }

        const notifications = [];
        snapshot.forEach(childSnapshot => {
            notifications.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });

        notifications.sort((a, b) => b.timestamp - a.timestamp);

        notifications.forEach(notif => {
            const notifElement = document.createElement('div');
            notifElement.className = 'notification-item';
            
            const message = notif.message || '';
            const notificationDate = new Date(notif.timestamp);
            const timeString = notificationDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
            const dateString = notificationDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
            
            notifElement.innerHTML = `<span>${message}</span><small class="text-muted d-block">${dateString} at ${timeString}</small>`;
            listContainer.appendChild(notifElement);
        });
    });

    clearButton.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Are you sure you want to clear all notifications?')) {
            remove(notificationsRef).catch(err => alert('Failed to clear notifications: ' + err.message));
        }
    });
}

function initializeSettingsPage(user) {
    const tableBody = document.getElementById('outlet-settings-table-body');
    if (!tableBody) return;

    const rootRef = ref(db);
    onValue(rootRef, (snapshot) => {
        const dbState = snapshot.val() || {};
        const allOwnership = dbState.outletOwnership || {};
        const allSettings = dbState.outletSettings || {};

        const ownedOutletIds = Object.keys(allOwnership).filter(id => allOwnership[id] === user.uid);
        
        tableBody.innerHTML = '';
        if (ownedOutletIds.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="2">You do not own any outlets. Scan a QR code to add one.</td></tr>';
            return;
        }

        ownedOutletIds.sort().forEach(outletId => {
            const outletData = allSettings[outletId] || {};
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${outletData.name || outletId}</td>
                <td class="text-end">
                    <button type="button" class="btn btn-sm btn-warning manage-outlet-btn" data-id="${outletId}" title="Manage Members"><i class="fas fa-users"></i> Manage</button>
                    <button type="button" class="btn btn-sm btn-primary open-schedule-modal" data-id="${outletId}" title="Set Schedule"><i class="fas fa-calendar-alt"></i> Schedule</button>
                    <button type="button" class="btn btn-sm btn-info open-idle-config-modal" data-id="${outletId}" title="Idle Settings"><i class="fas fa-leaf"></i> Idle Settings</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    });

    initializeMemberManagementModal(user);
}

function initializeLogoutButtons() {
    const handleSignOut = (e) => {
        e.preventDefault();
        
        // --- NEW: Add confirmation dialog ---
        if (confirm("Are you sure you want to log out?")) {
            signOut(auth).catch(error => console.error("Sign out error:", error));
        }
    };
    
    // Attach the same handler to both logout buttons
    document.getElementById('logout-button')?.addEventListener('click', handleSignOut);
    document.getElementById('logout-button-dropdown')?.addEventListener('click', handleSignOut);
}

function initializeQrScanner() {
    const qrScannerModalElement = document.getElementById('qr-scanner-modal');
    if (!qrScannerModalElement) return;

    let html5QrCode = null;
    let qrIsScanning = false;

    const stopScanner = () => {
        if (!html5QrCode || !qrIsScanning) return;
        html5QrCode.stop().then(() => {
            qrIsScanning = false;
            const modalInstance = bootstrap.Modal.getInstance(qrScannerModalElement);
            if (modalInstance) {
                modalInstance.hide();
            }
        }).catch(err => {
            console.error("Failed to stop QR scanner.", err);
            qrIsScanning = false;
        });
    };

    const onScanSuccess = async (decodedText) => {
        try {
            const user = auth.currentUser;
            if (!user) {
                alert("You must be logged in to add an outlet.");
                stopScanner();
                return;
            }

            if (qrIsScanning) {
                await html5QrCode.stop();
                qrIsScanning = false;
            }
            
            const qrData = JSON.parse(decodedText);
            if (!qrData.nodeName) {
                alert("Invalid Outlet QR Code format.");
                stopScanner();
                return;
            }

            const outletId = qrData.nodeName;
            const ownerRef = ref(db, `outletOwnership/${outletId}`);
            const ownerSnapshot = await get(ownerRef);

            if (ownerSnapshot.exists()) {
                const ownerId = ownerSnapshot.val();

                if (ownerId === user.uid) {
                    alert(`You are already the Main Owner of "${outletId}".`);
                    stopScanner();
                    return;
                }

                const memberRef = ref(db, `outletMembers/${outletId}/${user.uid}`);
                const memberSnapshot = await get(memberRef);
                if (memberSnapshot.exists()) {
                    alert(`You already have access to "${outletId}".`);
                    stopScanner();
                    return;
                }

                const requestRef = ref(db, `outletSettings/${outletId}/accessRequests/${user.uid}`);
                const requestSnapshot = await get(requestRef);
                if (requestSnapshot.exists()) {
                    alert(`You already have a pending access request for "${outletId}".`);
                    stopScanner();
                    return;
                }

                const requesterUsernameRef = ref(db, `users/${user.uid}/username`);
                const usernameSnapshot = await get(requesterUsernameRef);
                const requesterUsername = usernameSnapshot.val() || user.email;

                await set(requestRef, {
                    requesterId: user.uid,
                    requesterUsername: requesterUsername,
                    timestamp: Date.now()
                });

                const ownerNotificationRef = ref(db, `users/${ownerId}/notifications`);
                await push(ownerNotificationRef, {
                    message: `User '${requesterUsername}' requested access to your outlet '${outletId}'.`,
                    timestamp: Date.now()
                });
                
                alert(`Access request sent for outlet "${outletId}". You will be notified when the owner responds.`);

            } else {
                const updates = {};
                const now = Date.now();

                updates[`/outletOwnership/${outletId}`] = user.uid;
                updates[`/outletMembers/${outletId}/${user.uid}`] = { role: 'main_owner', accessEnabled: true, isAdmin: true };
                updates[`/outletSettings/${outletId}`] = { name: outletId, addedOn: now, schedules: {}, idleConfig: { enabled: false }, accessRequests: {} };
                updates[`/users/${user.uid}/outletBilling/${outletId}`] = { accumulatedKwh: 0, totalAccumulatedKwh: 0 };
                updates[`/Outlets/${outletId}/status`] = qrData.status || 'LOW';
                updates[`/Outlets/${outletId}/voltage`] = qrData.voltage || 0;
                updates[`/Outlets/${outletId}/lastUpdatedTimestamp`] = now;

                await update(ref(db), updates);
                alert(`Congratulations! You are now the Main Owner of the new outlet: ${outletId}`);
            }

            stopScanner();

        } catch (error) {
            console.error("QR Scan Error:", error);
            alert("Scanned QR code is not valid or a database error occurred. Please try again.");
            stopScanner();
        }
    };

    qrScannerModalElement.addEventListener('shown.bs.modal', () => {
        if (qrIsScanning) return;
        try {
            html5QrCode = new Html5Qrcode("qr-reader");
            html5QrCode.start(
                { facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, 
                onScanSuccess, () => {}
            ).then(() => { 
                qrIsScanning = true; 
            }).catch(err => {
                console.error("Could not start camera.", err);
                alert("Could not start camera. Please ensure you have granted camera permissions to this site.");
                stopScanner();
            });
        } catch(err) {
            console.error('QR scanner initialization error', err);
            alert('QR scanner is not available on this browser or an error occurred.');
            stopScanner();
        }
    });

    qrScannerModalElement.addEventListener('hidden.bs.modal', stopScanner);
}

function initializeTimerModal() {
    const timerModalElement = document.getElementById('set-timer-modal');
    if (!timerModalElement) return;

    $('.clockpicker').clockpicker({
        autoclose: true,
        twelvehour: true
    });

    const timerInputElement = document.getElementById('timer-input');
    const timerOkButton = document.getElementById('timer-ok-button');
    const timerCancelButton = document.getElementById('timer-cancel-button');
    let currentOutletId = null;

    const timerModal = new bootstrap.Modal(timerModalElement);

    document.addEventListener('click', (e) => {
        const targetButton = e.target.closest('.set-timer-link');
        if (targetButton) {
            currentOutletId = targetButton.dataset.id;
            timerInputElement.value = '09:30 AM'; 
            timerModal.show();
        }
    });

    timerOkButton.addEventListener('click', async () => {
        if (!currentOutletId) return;
        const timeValue = timerInputElement.value;
        const timeParts = timeValue.match(/(\d+):(\d+)\s*(AM|PM)?/i);

        if (!timeParts) {
            alert('Invalid time format. Please use the clock picker.');
            return;
        }

        let hour = parseInt(timeParts[1], 10);
        const period = timeParts[3];

        if (period && period.toUpperCase() === 'PM' && hour < 12) hour += 12;
        if (period && period.toUpperCase() === 'AM' && hour === 12) hour = 0;

        const targetDate = new Date();
        targetDate.setHours(hour, parseInt(timeParts[2], 10), 0, 0);

        if (targetDate.getTime() < Date.now()) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        const liveDataRef = ref(db, `Outlets/${currentOutletId}`);
        const settingsDataRef = ref(db, `outletSettings/${currentOutletId}`);
        
        const [liveSnap, settingsSnap] = await Promise.all([
            get(liveDataRef),
            get(settingsDataRef)
        ]);

        if (!liveSnap.exists() || !settingsSnap.exists()) {
            alert("Error: Could not retrieve current outlet data. Please try again.");
            return;
        }

        const liveData = liveSnap.val();
        const settingsData = settingsSnap.val();
        
        const currentStatus = liveData.status || 'LOW';
        const targetStatus = currentStatus === 'HIGH' ? 'LOW' : 'HIGH';
        
        await update(settingsDataRef, {
            timerSet: true,
            timerTargetTimestamp: targetDate.getTime(),
            timerTargetStatus: targetStatus,
        });

        const outletName = settingsData.name || currentOutletId;
        const actionText = targetStatus === 'HIGH' ? 'ON' : 'OFF';
        const formattedTime = targetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        showNotification(`Timer Set: ${outletName}`, `This device will turn ${actionText} at approximately ${formattedTime}.`);
        
        await logNotificationForUser(globalUserUID, `Timer set for ${outletName} to turn ${actionText}.`);
        
        timerModal.hide();
    });

    timerCancelButton.addEventListener('click', async () => {
        if (!currentOutletId) return;
        
        const outletSettingsRef = ref(db, `outletSettings/${currentOutletId}`);
        await update(outletSettingsRef, { timerSet: false, timerTargetTimestamp: null, timerTargetStatus: null });
        
        const settingsSnap = await get(ref(db, `outletSettings/${currentOutletId}/name`));
        const outletName = settingsSnap.val() || currentOutletId;

        showNotification(`Timer Cancelled: ${outletName}`, `The scheduled timer has been cancelled.`);
        await logNotificationForUser(globalUserUID, `Timer for ${outletName} was cancelled.`);
        timerModal.hide();
    });
}

function initializeScheduleModal() {
    const scheduleModalElement = document.getElementById('schedule-modal');
    if (!scheduleModalElement) return;

    const scheduleModal = new bootstrap.Modal(scheduleModalElement);
    const outletNameSpan = document.getElementById('schedule-outlet-name');
    const form = document.getElementById('add-schedule-form');
    const existingSchedulesBody = document.getElementById('existing-schedules-body');
    let currentOutletId = null;
    let schedulesUnsub = null;
    let currentUserIsAdmin = false;

    document.addEventListener('click', async e => {
        const targetButton = e.target.closest('.open-schedule-modal');
        if (targetButton) {
            currentOutletId = targetButton.dataset.id;
            
            const memberInfoRef = ref(db, `outletMembers/${currentOutletId}/${globalUserUID}`);
            const memberSnap = await get(memberInfoRef);
            currentUserIsAdmin = memberSnap.exists() && (memberSnap.val().isAdmin || memberSnap.val().role === 'main_owner');
            
            const settingsSnap = await get(ref(db, `outletSettings/${currentOutletId}`));
            outletNameSpan.textContent = settingsSnap.val()?.name || currentOutletId;

            if (schedulesUnsub) { try { schedulesUnsub(); } catch(e){} }
            const schedulesRef = ref(db, `outletSettings/${currentOutletId}/schedules`);
            schedulesUnsub = onValue(schedulesRef, (snap) => populateSchedules(snap.val() || {}));
            
            const formElements = form.querySelectorAll('input, select, button');
            formElements.forEach(el => el.disabled = !currentUserIsAdmin);

            scheduleModal.show();
        }
    });

    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const populateSchedules = (schedules) => {
        existingSchedulesBody.innerHTML = '';
        if (Object.keys(schedules).length === 0) {
            existingSchedulesBody.innerHTML = '<tr><td colspan="5" class="text-center">No schedules set.</td></tr>';
            return;
        }
        for (const id in schedules) {
            const s = schedules[id] || {};
            const days = Array.isArray(s.days) ? s.days.map(d => dayMap[d]).join(', ') : '';
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><div class="form-check form-switch"><input class="form-check-input toggle-schedule" type="checkbox" ${s.enabled ? 'checked' : ''} data-schedule-id="${id}" ${!currentUserIsAdmin ? 'disabled' : ''}></div></td>
                <td>Turn ${s.action === 'HIGH' ? 'ON' : 'OFF'}</td>
                <td>${s.time || ''}</td>
                <td>${days}</td>
                <td><button class="btn btn-sm btn-danger delete-schedule" data-schedule-id="${id}" ${!currentUserIsAdmin ? 'disabled' : ''}><i class="fas fa-trash"></i></button></td>
            `;
            existingSchedulesBody.appendChild(row);
        }
    };

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!currentOutletId || !currentUserIsAdmin) return;
        const days = Array.from(form.querySelectorAll('input[type=checkbox]:checked')).map(cb => parseInt(cb.value));
        if (days.length === 0) return alert("Please select at least one day.");
        
        const newSchedule = {
            action: form.querySelector('#schedule-action').value, time: form.querySelector('#schedule-time').value,
            days: days, enabled: true,
        };

        const schedulesRef = ref(db, `outletSettings/${currentOutletId}/schedules`);
        await push(schedulesRef, newSchedule);
        
        notifyOwnerOfAdminAction("added a new schedule to", currentOutletId);
        form.reset();
    });

    existingSchedulesBody.addEventListener('click', async e => {
        if (!currentUserIsAdmin) return;
        const scheduleId = e.target.closest('[data-schedule-id]')?.dataset.scheduleId;
        if (!scheduleId) return;
        const scheduleRef = ref(db, `outletSettings/${currentOutletId}/schedules/${scheduleId}`);
        
        if (e.target.closest('.delete-schedule')) {
            if (confirm("Are you sure?")) {
                await remove(scheduleRef);
                notifyOwnerOfAdminAction("deleted a schedule from", currentOutletId);
            }
        }
    });

    existingSchedulesBody.addEventListener('change', async e => {
        if (!currentUserIsAdmin) return;
        const scheduleId = e.target.closest('[data-schedule-id]')?.dataset.scheduleId;
        if (!scheduleId || !e.target.classList.contains('toggle-schedule')) return;

        await update(ref(db, `outletSettings/${currentOutletId}/schedules/${scheduleId}`), { enabled: e.target.checked });
        notifyOwnerOfAdminAction("changed a schedule on", currentOutletId);
    });

    scheduleModalElement.addEventListener('hidden.bs.modal', () => { if (schedulesUnsub) { try { schedulesUnsub(); } catch(e){} } });
}

function initializeIdleConfigModal() {
    const idleModalElement = document.getElementById('idle-config-modal');
    if (!idleModalElement) return;

    const idleModal = new bootstrap.Modal(idleModalElement);
    const outletNameSpan = document.getElementById('idle-outlet-name');
    const form = document.getElementById('idle-config-form');
    const saveButton = document.getElementById('save-idle-config-button');
    let currentOutletId = null;
    let idleUnsub = null;
    let currentUserIsAdmin = false;

    document.addEventListener('click', async e => {
        const targetButton = e.target.closest('.open-idle-config-modal');
        if (targetButton) {
            currentOutletId = targetButton.dataset.id;

            const memberInfoRef = ref(db, `outletMembers/${currentOutletId}/${globalUserUID}`);
            const memberSnap = await get(memberInfoRef);
            currentUserIsAdmin = memberSnap.exists() && (memberSnap.val().isAdmin || memberSnap.val().role === 'main_owner');

            const settingsSnap = await get(ref(db, `outletSettings/${currentOutletId}`));
            outletNameSpan.textContent = settingsSnap.val()?.name || currentOutletId;

            if (idleUnsub) { try { idleUnsub(); } catch(e){} }
            const idleConfigRef = ref(db, `outletSettings/${currentOutletId}/idleConfig`);
            idleUnsub = onValue(idleConfigRef, (snap) => {
                const config = snap.val() || {};
                // Phantom Load settings
                form.querySelector('#idle-enabled-switch').checked = !!config.enabled;
                form.querySelector('#idle-threshold-watts').value = config.idleThresholdWatts || 5;
                form.querySelector('#idle-time-minutes').value = config.idleTimeMinutes || 15;
                form.querySelector('#grace-period-minutes').value = config.gracePeriodMinutes || 5;
                // Continuity Check settings
                form.querySelector('#continuity-check-enabled-switch').checked = !!config.continuityCheckEnabled;
                form.querySelector('#continuity-check-hours').value = config.continuityCheckHours || 8;
                form.querySelector('#continuity-grace-period-minutes').value = config.continuityGracePeriodMinutes || 5;
            });

            const formElements = form.querySelectorAll('input, select');
            formElements.forEach(el => el.disabled = !currentUserIsAdmin);
            saveButton.disabled = !currentUserIsAdmin;

            idleModal.show();
        }
    });

    saveButton.addEventListener('click', async () => {
        if (!currentOutletId || !currentUserIsAdmin) return;
        const config = {
            // Phantom Load settings
            enabled: form.querySelector('#idle-enabled-switch').checked,
            idleThresholdWatts: parseFloat(form.querySelector('#idle-threshold-watts').value) || 0,
            idleTimeMinutes: parseInt(form.querySelector('#idle-time-minutes').value, 10) || 1,
            gracePeriodMinutes: parseInt(form.querySelector('#grace-period-minutes').value, 10) || 1, // Correctly reading this value now
            // Continuity Check settings
            continuityCheckEnabled: form.querySelector('#continuity-check-enabled-switch').checked,
            continuityCheckHours: parseInt(form.querySelector('#continuity-check-hours').value, 10) || 8,
            continuityGracePeriodMinutes: parseInt(form.querySelector('#continuity-grace-period-minutes').value, 10) || 5, // Saving the new value
        };
        
        await update(ref(db, `outletSettings/${currentOutletId}/idleConfig`), config);
        
        notifyOwnerOfAdminAction("updated the idle settings for", currentOutletId);

        alert("Idle settings saved!");
        idleModal.hide();
    });

    idleModalElement.addEventListener('hidden.bs.modal', () => { if (idleUnsub) { try { idleUnsub(); } catch(e){} } });
}

function initializeRegisterForm() {
    const registerForm = document.getElementById('register-form');
    if (!registerForm) return;

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = document.getElementById('username').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const passwordRepeat = document.getElementById('register-password-repeat').value;
        
        if (password !== passwordRepeat) {
            alert('Error: Passwords do not match.');
            return;
        }

        sessionStorage.setItem('isRegistering', 'true');
        
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            
            await set(ref(db, 'users/' + userCredential.user.uid), {
                username: username,
                email: email,
                createdAt: new Date().toISOString()
            });

            await signOut(auth);
            
            sessionStorage.removeItem('isRegistering');

            alert('Registration successful! Please log in with your new account.');
            window.location.href = 'login.html';

        } catch (error) {
            sessionStorage.removeItem('isRegistering');
            
            let friendlyMessage = 'An unknown error occurred. Please try again.';
            if (error.code === 'auth/email-already-in-use') {
                friendlyMessage = 'This email address is already registered.';
            } else if (error.code === 'auth/weak-password') {
                friendlyMessage = 'Password is too weak. It should be at least 6 characters.';
            } else if (error.code === 'auth/invalid-email') {
                friendlyMessage = 'The email address is not valid.';
            }
            alert(`Registration Failed: ${friendlyMessage}`);
        }
    });
}

function initializeBillEstimator(user) {
    const tableBody = document.getElementById('bill-estimator-table-body');
    const totalCostDisplay = document.getElementById('total-cost-display');
    const currentDateDisplay = document.getElementById('current-date-display');
    const kwhRateInput = document.getElementById('kwh-rate-input');
    const setKwhButton = document.getElementById('set-kwh-button');
    const clearBillButton = document.getElementById('clear-bill-estimator-button');
    const clearBalanceButton = document.getElementById('clear-balance-button');
    const clearWattsButton = document.getElementById('clear-watts-button');

    if (!tableBody) return;

    if (currentDateDisplay) {
        currentDateDisplay.textContent = new Date().toLocaleString('en-US', { 
            month: 'long', day: 'numeric', year: 'numeric' 
        });
    }

    let currentKwhRate = 14.00;
    let billUpdateInterval = null;
    let accessibleOutletsData = {};
    const userConfigRef = ref(db, `users/${user.uid}/config`);

    const safeNum = v => Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
    const formatCurrency = v => '₱' + safeNum(v).toFixed(2);

    const computeLiveKwh = (outlet, nowMs) => {
        if (!outlet || outlet.status !== 'HIGH') return 0;
        const lastChangeMs = outlet.lastStatusChange || nowMs;
        if (lastChangeMs > nowMs) return 0;
        const runningHours = (nowMs - lastChangeMs) / 36e5;
        return (safeNum(outlet.watts) / 1000) * runningHours;
    };

    onValue(ref(db), (snapshot) => {
        if (!snapshot.exists()) return;
        const dbState = snapshot.val();
        const allMembers = dbState.outletMembers || {};
        const allOwnership = dbState.outletOwnership || {};
        const allSettings = dbState.outletSettings || {};
        const allLive = dbState.Outlets || {};
        const allUsers = dbState.users || {};

        accessibleOutletsData = {};
        for (const outletId in allMembers) {
            if (allMembers[outletId][user.uid]?.accessEnabled) {
                const ownerId = allOwnership[outletId];
                if (ownerId) {
                    accessibleOutletsData[outletId] = {
                        settings: allSettings[outletId] || {},
                        live: allLive[outletId] || {},
                        billing: allUsers[ownerId]?.outletBilling?.[outletId] || {},
                        ownerId: ownerId,
                    };
                }
            }
        }
        
        renderStaticBillData();
        manageLiveUpdateInterval();
    });
    
    const renderStaticBillData = () => {
        tableBody.innerHTML = '';
        if (Object.keys(accessibleOutletsData).length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" class="text-center">No outlets found.</td></tr>';
            if (totalCostDisplay) totalCostDisplay.textContent = "0.00";
            return;
        }

        for (const outletId in accessibleOutletsData) {
            const data = accessibleOutletsData[outletId];
            
            let statusInfo = '';
            if (data.live.lastStatusChange) {
                const statusText = (data.live.status || 'LOW').toUpperCase() === 'HIGH' ? 'Running' : 'Stopped';
                statusInfo = `<br><small class="text-muted" style="font-size: 0.75rem;">${statusText} ${formatTimeAgo(data.live.lastStatusChange)}</small>`;
            }

            const row = document.createElement('tr');
            row.id = `bill-row-${outletId}`;
            row.innerHTML = `
                <td><strong>${data.settings.name || outletId}</strong>${statusInfo}</td>
                <td class="bill-kwh-consumed">...</td> 
                <td class="bill-total-kwh">...</td>
                <td>${safeNum(data.live.highestWatts).toFixed(2)} W</td>
                <td>${safeNum(data.live.lowestWatts).toFixed(2)} W</td>
                <td>₱${currentKwhRate.toFixed(2)}</td>
                <td class="bill-cost">...</td>
                <td class="bill-total-cost">...</td>
            `;
            tableBody.appendChild(row);
        }
        updateLiveCosts();
    };

    const updateLiveCosts = () => {
        const now = Date.now();
        let grandTotalCost = 0;

        for (const outletId in accessibleOutletsData) {
            const data = accessibleOutletsData[outletId];
            const row = document.getElementById(`bill-row-${outletId}`);
            if (!row) continue;

            const lifetimeKwh_db = safeNum(data.billing.totalAccumulatedKwh);
            const cycleKwh_db = safeNum(data.billing.accumulatedKwh);
            const liveSessionKwh = computeLiveKwh(data.live, now);
            
            const currentCycleKwh = cycleKwh_db + liveSessionKwh;
            const currentCycleCost = currentCycleKwh * currentKwhRate;
            const finalTotalKwh = lifetimeKwh_db + currentCycleKwh;
            const finalTotalCost = (lifetimeKwh_db * currentKwhRate) + currentCycleCost;

            grandTotalCost += finalTotalCost;

            row.querySelector('.bill-kwh-consumed').textContent = `${currentCycleKwh.toFixed(4)} kWh`;
            row.querySelector('.bill-total-kwh').textContent = `${finalTotalKwh.toFixed(4)} kWh`;
            row.querySelector('.bill-cost').textContent = formatCurrency(currentCycleCost);
            row.querySelector('.bill-total-cost').textContent = formatCurrency(finalTotalCost);
        }

        if (totalCostDisplay) {
            totalCostDisplay.textContent = grandTotalCost.toFixed(2);
        }
    };
    
    const manageLiveUpdateInterval = () => {
        const hasRunningOutlets = Object.values(accessibleOutletsData).some(d => d.live.status === 'HIGH');
        if (hasRunningOutlets && !billUpdateInterval) {
            billUpdateInterval = setInterval(updateLiveCosts, 1000);
        } else if (!hasRunningOutlets && billUpdateInterval) {
            clearInterval(billUpdateInterval);
            billUpdateInterval = null;
            updateLiveCosts();
        }
    };

    onValue(userConfigRef, (snapshot) => {
        currentKwhRate = safeNum(snapshot.val()?.kwhRate) || 14.00;
        kwhRateInput.value = currentKwhRate.toFixed(2);
        renderStaticBillData();
    });

    setKwhButton?.addEventListener('click', () => {
        const newRate = parseFloat(kwhRateInput.value);
        if (isNaN(newRate) || newRate <= 0) return alert('Invalid kWh rate.');
        update(userConfigRef, { kwhRate: newRate });
    });

    const performOwnerAction = async (confirmationMsg, actionFn) => {
        if (!confirm(confirmationMsg)) return;
        const ownerRef = ref(db, 'outletOwnership');
        const ownerSnap = await get(ownerRef);
        const ownership = ownerSnap.val() || {};
        const updates = {};
        const now = Date.now();
        for (const outletId in ownership) {
            if (ownership[outletId] === user.uid) {
                const liveSnap = await get(ref(db, `Outlets/${outletId}`));
                const billingSnap = await get(ref(db, `users/${user.uid}/outletBilling/${outletId}`));
                const liveData = liveSnap.val() || {};
                const billingData = billingSnap.val() || {};
                actionFn(updates, outletId, liveData, billingData, now);
            }
        }
        if (Object.keys(updates).length > 0) {
            await update(ref(db), updates);
            alert("Action completed for all your owned outlets.");
        } else {
            alert("You do not own any outlets to perform this action on.");
        }
    };

    clearBillButton?.addEventListener('click', () => {
        performOwnerAction("End current billing cycle for ALL your owned outlets?", (updates, outletId, live, billing, now) => {
            let currentCycleKwh = safeNum(billing.accumulatedKwh) + computeLiveKwh(live, now);
            updates[`/users/${user.uid}/outletBilling/${outletId}/totalAccumulatedKwh`] = safeNum(billing.totalAccumulatedKwh) + currentCycleKwh;
            updates[`/users/${user.uid}/outletBilling/${outletId}/accumulatedKwh`] = 0;
            if (live.status === 'HIGH') updates[`/Outlets/${outletId}/lastStatusChange`] = now;
        });
    });

    clearBalanceButton?.addEventListener('click', () => {
        performOwnerAction("WARNING: Reset ALL costs and kWh for ALL your owned outlets to zero?", (updates, outletId, live, billing, now) => {
            updates[`/users/${user.uid}/outletBilling/${outletId}/totalAccumulatedKwh`] = 0;
            updates[`/users/${user.uid}/outletBilling/${outletId}/accumulatedKwh`] = 0;
            if (live.status === 'HIGH') updates[`/Outlets/${outletId}/lastStatusChange`] = now;
        });
    });

    clearWattsButton?.addEventListener('click', () => {
        performOwnerAction("Reset Highest and Lowest Watt records for ALL your owned outlets?", (updates, outletId) => {
            updates[`/Outlets/${outletId}/highestWatts`] = 0;
            updates[`/Outlets/${outletId}/lowestWatts`] = 0;
        });
    });
}

function initializeOutletManagementPage(user) {
    const tableBody = document.getElementById('outlet-management-body');
    const renameModalElement = document.getElementById('rename-outlet-modal');
    if (!tableBody || !renameModalElement) return;

    const renameModal = new bootstrap.Modal(renameModalElement);
    const outletIdDisplay = document.getElementById('rename-outlet-id-display');
    const nameInput = document.getElementById('new-outlet-name-input');
    const saveNameButton = document.getElementById('save-new-name-button');
    let currentOutletIdForRename = null;

    const rootRef = ref(db);
    onValue(rootRef, (snapshot) => {
        const dbState = snapshot.val() || {};
        tableBody.innerHTML = '';

        const accessibleOutlets = {};
        if (dbState.outletMembers) {
            for (const outletId in dbState.outletMembers) {
                if (dbState.outletMembers[outletId][user.uid]?.accessEnabled) {
                    accessibleOutlets[outletId] = {
                        live: dbState.Outlets?.[outletId] || {},
                        settings: dbState.outletSettings?.[outletId] || {},
                        memberInfo: dbState.outletMembers[outletId][user.uid],
                        ownerId: dbState.outletOwnership?.[outletId] || null
                    };
                }
            }
        }
        
        if (Object.keys(accessibleOutlets).length === 0) {
            tableBody.innerHTML = '<tr><td colspan="9" class="text-center">No outlets found. Add one using the "+" button.</td></tr>';
            return;
        }

        Object.keys(accessibleOutlets).sort().forEach(outletId => {
            const data = accessibleOutlets[outletId];
            const live = data.live;
            const settings = data.settings;
            const memberInfo = data.memberInfo;

            let row = document.getElementById(`mgmt-row-${outletId}`);
            if (!row) {
                row = document.createElement('tr'); row.id = `mgmt-row-${outletId}`;
                tableBody.appendChild(row);
            }

            const canManage = memberInfo.role === 'main_owner' || memberInfo.isAdmin;
            const renameButtonHtml = canManage ? 
                `<button class="btn btn-outline-secondary btn-sm rename-outlet-btn" data-id="${outletId}" data-current-name="${settings.name || outletId}"><i class="fas fa-pencil-alt"></i> Rename</button>` :
                `<button class="btn btn-outline-secondary btn-sm" disabled title="Only Admins can rename outlets"><i class="fas fa-pencil-alt"></i> Rename</button>`;

            const isChecked = live.status === 'HIGH';
            let statusText = live.idleState ? 'Idle' : (isChecked ? 'On' : 'Off');
            let statusClass = live.idleState ? 'text-warning fw-bold' : (isChecked ? 'text-success fw-bold' : 'text-muted');
            row.innerHTML = `
                <td><strong>${settings.name || outletId}</strong></td>
                <td>${(parseFloat(live.watts) || 0).toFixed(2)} W</td>
                <td>${(parseFloat(live.current) || 0).toFixed(2)} A</td>
                <td>${(parseFloat(live.voltage) || 0).toFixed(2)} V</td>
                <td>${(parseFloat(live.powerfactor) || 0).toFixed(2)}</td>
                <td>${parseInt(live.readLatencyMs) || 0}</td>
                <td>${parseInt(live.sendLatencyMs) || 0}</td>
                <td class="text-center">${renameButtonHtml}</td>
                <td class="text-center"><div class="${statusClass}">${statusText}</div><label class="switch mt-1"><input type="checkbox" class="status-toggle" data-id="${outletId}" ${isChecked ? 'checked' : ''}><span class="slider round"></span></label></td>
            `;
        });
    });

    tableBody.addEventListener('click', (e) => {
        const renameBtn = e.target.closest('.rename-outlet-btn');
        if (renameBtn) {
            currentOutletIdForRename = renameBtn.dataset.id;
            outletIdDisplay.textContent = currentOutletIdForRename;
            nameInput.value = renameBtn.dataset.currentName;
            renameModal.show();
        }
    });
    
    saveNameButton.addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        if (!newName || !currentOutletIdForRename) return;

        const memberInfoRef = ref(db, `outletMembers/${currentOutletIdForRename}/${user.uid}`);
        const memberSnap = await get(memberInfoRef);
        if (!memberSnap.exists() || !(memberSnap.val().isAdmin || memberSnap.val().role === 'main_owner')) {
            alert("Permission Denied: You do not have admin rights to rename this outlet.");
            return;
        }

        await update(ref(db, `outletSettings/${currentOutletIdForRename}`), { name: newName });
        
        if (memberSnap.val().role !== 'main_owner') {
            const ownerSnap = await get(ref(db, `outletOwnership/${currentOutletIdForRename}`));
            if (ownerSnap.exists()) {
                const ownerId = ownerSnap.val();
                const userSnap = await get(ref(db, `users/${user.uid}/username`));
                const adminName = userSnap.val() || 'An admin';
                logNotificationForUser(ownerId, `${adminName} renamed outlet '${currentOutletIdForRename}' to '${newName}'.`);
            }
        }
        
        renameModal.hide();
    });

    tableBody.addEventListener('change', e => {
        if (e.target.classList.contains('status-toggle')) {
            const outletId = e.target.dataset.id;
            const newStatus = e.target.checked ? 'HIGH' : 'LOW';
            update(ref(db, `Outlets/${outletId}`), {
                status: newStatus, lastStatusChange: Date.now(), idleState: null
            });
        }
    });
}

function initializeProfilePage(user) {
    const emailDisplay = document.getElementById('profile-email-display');
    const usernameInput = document.getElementById('profile-username-input');
    const saveUsernameBtn = document.getElementById('save-username-button');
    const currentPassInput = document.getElementById('profile-current-password');
    const newPassInput = document.getElementById('profile-new-password');
    const confirmPassInput = document.getElementById('profile-confirm-password');
    const changePassBtn = document.getElementById('change-password-button');
    const deleteConfirmInput = document.getElementById('delete-confirm-input');
    const confirmDeleteBtn = document.getElementById('confirm-delete-button');
    const memberSinceDisplay = document.getElementById('profile-member-since');

    if (!emailDisplay || !memberSinceDisplay) return;

    const userDbRef = ref(db, 'users/' + user.uid);
    get(userDbRef).then(snapshot => {
        if (snapshot.exists()) {
            const userData = snapshot.val();
            emailDisplay.textContent = userData.email || user.email;
            usernameInput.value = userData.username || '';
            
            if (userData.createdAt) {
                const joinDate = new Date(userData.createdAt);
                memberSinceDisplay.textContent = joinDate.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric'
                });
            } else {
                memberSinceDisplay.textContent = "N/A";
            }
        }
    });

    saveUsernameBtn?.addEventListener('click', () => {
        const newUsername = usernameInput.value.trim();
        if (newUsername) update(userDbRef, { username: newUsername }).then(() => alert('Username updated!'));
    });

    changePassBtn?.addEventListener('click', async () => {
        const currentPass = currentPassInput.value, newPass = newPassInput.value;
        if (!currentPass || !newPass || newPass !== confirmPassInput.value) return alert('Please check password fields.');
        try {
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPass));
            await updatePassword(user, newPass);
            alert('Password changed successfully!');
            [currentPassInput, newPassInput, confirmPassInput].forEach(i => i.value = '');
        } catch (error) {
            alert('Password change failed: ' + error.message);
        }
    });

    confirmDeleteBtn?.addEventListener('click', async () => {
        if (deleteConfirmInput.value !== 'DELETE') return alert("Type 'DELETE' to confirm.");
        
        try {
            const ownershipSnap = await get(ref(db, 'outletOwnership'));
            const ownershipData = ownershipSnap.val() || {};
            const outletsToDelete = Object.keys(ownershipData).filter(id => ownershipData[id] === user.uid);

            if (outletsToDelete.length > 0) {
                if (!confirm("WARNING: You are the Main Owner of one or more outlets. Deleting your account will permanently delete these outlets for ALL users who have access. This cannot be undone. Do you wish to proceed?")) {
                    return;
                }
            }

            const updates = {};
            for (const outletId of outletsToDelete) {
                updates[`/outletOwnership/${outletId}`] = null;
                updates[`/outletMembers/${outletId}`] = null;
                updates[`/outletSettings/${outletId}`] = null;
                updates[`/Outlets/${outletId}`] = null;
            }
            updates[`/users/${user.uid}`] = null;
            
            await update(ref(db), updates);

            await deleteUser(user);
            alert('Account and all owned outlet data deleted successfully.');
        
        } catch (error) {
            console.error("Account deletion failed:", error);
            alert('Deletion failed. Please log out and log back in before trying again.');
            bootstrap.Modal.getInstance(document.getElementById('delete-account-modal'))?.hide();
        }
    });
}

function initializeBulkControlButtons() {
    const turnOnAllBtn = document.getElementById('turn-on-all-btn');
    const turnOffAllBtn = document.getElementById('turn-off-all-btn');
    if (!turnOnAllBtn || !turnOffAllBtn) return;

    const performBulkAction = async (confirmMsg, targetStatus) => {
        if (!confirm(confirmMsg)) return;

        const dbState = await get(ref(db));
        if (!dbState.exists()) return;

        const allData = dbState.val();
        const allMembers = allData.outletMembers || {};
        const allOwnership = allData.outletOwnership || {};
        const allLive = allData.Outlets || {};

        const updates = {};
        const billingTransactions = [];
        const now = Date.now();

        for (const outletId in allMembers) {
            if (allMembers[outletId][globalUserUID]?.accessEnabled) {
                const liveData = allLive[outletId];
                if (!liveData) continue;

                if (targetStatus === 'HIGH' && liveData.status !== 'HIGH') {
                    updates[`/Outlets/${outletId}/status`] = 'HIGH';
                    updates[`/Outlets/${outletId}/lastStatusChange`] = now;
                    updates[`/Outlets/${outletId}/idleState`] = null;
                } 
                else if (targetStatus === 'LOW' && liveData.status === 'HIGH') {
                    const ownerId = allOwnership[outletId];
                    if (ownerId) {
                        const runningTimeMs = now - (liveData.lastStatusChange || now);
                        if (runningTimeMs > 0) {
                            const runningTimeHours = runningTimeMs / 36e5;
                            const kwhThisSession = (parseFloat(liveData.watts) || 0) / 1000 * runningTimeHours;
                            
                            const billingRef = ref(db, `users/${ownerId}/outletBilling/${outletId}/accumulatedKwh`);
                            billingTransactions.push(
                                runTransaction(billingRef, currentKwh => (currentKwh || 0) + kwhThisSession)
                            );
                        }
                    }
                    updates[`/Outlets/${outletId}/status`] = 'LOW';
                    updates[`/Outlets/${outletId}/lastStatusChange`] = now;
                    updates[`/Outlets/${outletId}/idleState`] = null;
                }
            }
        }

        if (Object.keys(updates).length > 0) await update(ref(db), updates);
        if (billingTransactions.length > 0) await Promise.all(billingTransactions);
        
        alert("Action completed for all accessible outlets.");
    };

    turnOnAllBtn.addEventListener('click', () => performBulkAction('Turn ON all your accessible outlets?', 'HIGH'));
    turnOffAllBtn.addEventListener('click', () => performBulkAction('Turn OFF all your accessible outlets?', 'LOW'));
}

function initializeMemberManagementModal(user) {
    const modalElement = document.getElementById('member-management-modal');
    if (!modalElement) return;

    const modal = new bootstrap.Modal(modalElement);
    const outletNameSpan = document.getElementById('manage-outlet-name');
    const pendingContainer = document.getElementById('pending-requests-container');
    const approvedContainer = document.getElementById('approved-members-container');
    const generateCodeBtn = document.getElementById('generate-code-btn');
    const activeCodesContainer = document.getElementById('active-codes-container');
    
    let currentOutletId = null;
    let requestsUnsub = null;
    let membersUnsub = null;
    let tempCodesUnsub = null; 

    document.body.addEventListener('click', (e) => {
        const manageButton = e.target.closest('.manage-outlet-btn');
        if (!manageButton) return;

        currentOutletId = manageButton.dataset.id;
        const outletSettingsRef = ref(db, `outletSettings/${currentOutletId}`);
        
        get(outletSettingsRef).then(snap => {
            outletNameSpan.textContent = snap.val()?.name || currentOutletId;
        });

        if (requestsUnsub) try { requestsUnsub(); } catch(e){}
        if (membersUnsub) try { membersUnsub(); } catch(e){}
        if (tempCodesUnsub) try { tempCodesUnsub(); } catch(e){} 

        const requestsRef = ref(db, `outletSettings/${currentOutletId}/accessRequests`);
        requestsUnsub = onValue(requestsRef, (snapshot) => renderPendingRequests(snapshot.val()));

        const membersRef = ref(db, `outletMembers/${currentOutletId}`);
        membersUnsub = onValue(membersRef, (snapshot) => renderApprovedMembers(snapshot.val()));
        
        const tempCodesRef = ref(db, 'tempAccessCodes');
        tempCodesUnsub = onValue(tempCodesRef, (snapshot) => {
            const allCodes = snapshot.val() || {};
            const relevantCodes = Object.entries(allCodes).filter(([id, data]) => data.outletId === currentOutletId);
            renderActiveCodes(Object.fromEntries(relevantCodes));
        });
        
        modal.show();
    });

    const renderActiveCodes = (codes) => {
        activeCodesContainer.innerHTML = '';
        if (!codes || Object.keys(codes).length === 0) {
            return;
        }
        let html = '<h6>Active Unused Codes</h6>';
        for (const id in codes) {
            const code = codes[id];
            const expires = new Date(code.expiresAt).toLocaleString();
            html += `
                <div class="d-flex justify-content-between align-items-center mb-2 p-2 bg-secondary rounded">
                    <div>
                        <strong class="font-monospace">${code.code}</strong>
                        <small class="d-block text-muted">${code.permissions.isAdmin ? 'Admin' : 'Guest'} access, expires ${expires}</small>
                    </div>
                    <button class="btn btn-sm btn-outline-danger revoke-code-btn" data-code-id="${id}">Revoke</button>
                </div>`;
        }
        activeCodesContainer.innerHTML = html;
    };

    const renderPendingRequests = (requests) => {
        pendingContainer.innerHTML = '';
        if (!requests || Object.keys(requests).length === 0) {
            pendingContainer.innerHTML = '<p class="text-muted">No pending requests.</p>';
            return;
        }
        for (const userId in requests) {
            const request = requests[userId];
            const div = document.createElement('div');
            div.className = 'd-flex justify-content-between align-items-center mb-2';
            div.innerHTML = `
                <span>${request.requesterUsername || userId}</span>
                <div>
                    <button class="btn btn-sm btn-success approve-request-btn" data-requester-id="${userId}" data-requester-name="${request.requesterUsername || ''}">Approve</button>
                    <button class="btn btn-sm btn-danger deny-request-btn" data-requester-id="${userId}">Deny</button>
                </div>
            `;
            pendingContainer.appendChild(div);
        }
    };
    
    const renderApprovedMembers = (members) => {
        approvedContainer.innerHTML = '';
        if (!members || Object.keys(members).length === 0) {
            approvedContainer.innerHTML = '<p class="text-muted">No approved members.</p>';
            return;
        }
        get(ref(db, 'users')).then(usersSnapshot => {
            const allUsers = usersSnapshot.val() || {};
            approvedContainer.innerHTML = '';

            for (const userId in members) {
                const member = members[userId];
                if (member.role === 'main_owner') continue; 
                
                const username = allUsers[userId]?.username || 'Unknown User';
                const div = document.createElement('div');
                div.className = 'member-row border-bottom border-secondary py-2';
                const isAdminDisabled = !member.accessEnabled ? 'disabled' : '';

                let tempAccessHtml = '';
                if (member.expiresAt) {
                    tempAccessHtml = `
                        <div class="temp-access-info d-flex justify-content-between align-items-center mt-2 ps-3">
                            <small class="text-info">Temporary access expires in: <span class="fw-bold time-left-display" data-expires-at="${member.expiresAt}">Calculating...</span></small>
                            <button class="btn btn-xs btn-outline-warning end-session-btn" data-member-id="${userId}" title="End this user's temporary session immediately">End Now</button>
                        </div>`;
                }

                div.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center">
                        <strong class="member-name">${username}</strong>
                        <div class="form-check form-switch">
                            <input class="form-check-input access-toggle" type="checkbox" role="switch" data-member-id="${userId}" ${member.accessEnabled ? 'checked' : ''}>
                            <label class="form-check-label">Access Enabled</label>
                        </div>
                    </div>
                    ${tempAccessHtml} 
                    <div class="d-flex justify-content-between align-items-center mt-2 ps-3">
                        <small class="text-muted">Can manage settings & other users</small>
                        <div class="form-check form-switch">
                            <input class="form-check-input admin-toggle" type="checkbox" role="switch" data-member-id="${userId}" ${member.isAdmin ? 'checked' : ''} ${isAdminDisabled}>
                            <label class="form-check-label">Grant Admin Access</label>
                        </div>
                    </div>
                `;
                approvedContainer.appendChild(div);
            }

            updateCountdownTimers();
            if (window.memberTimerInterval) clearInterval(window.memberTimerInterval);
            window.memberTimerInterval = setInterval(updateCountdownTimers, 1000);
        });
    };

    const updateCountdownTimers = () => {
        document.querySelectorAll('.time-left-display').forEach(span => {
            const expiresAt = parseInt(span.dataset.expiresAt, 10);
            const distance = expiresAt - Date.now();

            if (distance < 0) {
                span.textContent = "Expired";
                return;
            }
            const h = Math.floor(distance / 36e5);
            const m = Math.floor(distance % 36e5 / 6e4);
            const s = Math.floor(distance % 6e4 / 1e3);
            span.textContent = `${h}h ${m}m ${s}s`;
        });
    };

    generateCodeBtn.addEventListener('click', async () => {
        if (!currentOutletId) return;

        const duration = parseInt(document.getElementById('temp-code-duration').value, 10);
        const isAdmin = document.getElementById('temp-code-is-admin').checked;

        const words = ['RED', 'BLUE', 'GREEN', 'GOLD', 'WOLF', 'FOX', 'LION', 'EAGLE'];
        const randomWord1 = words[Math.floor(Math.random() * words.length)];
        const randomWord2 = words[Math.floor(Math.random() * words.length)];
        const randomNumber = Math.floor(100 + Math.random() * 900);
        const newCode = `${randomWord1}-${randomWord2}-${randomNumber}`;

        const newCodeData = {
            outletId: currentOutletId,
            code: newCode,
            permissions: { isAdmin: isAdmin },
            durationMinutes: duration,
            expiresAt: Date.now() + (duration * 60 * 1000),
            generatedBy: user.uid
        };

        await push(ref(db, 'tempAccessCodes'), newCodeData);
        alert(`Code generated: ${newCode}\nShare this with the user. It is valid for the selected duration.`);
    });

    modalElement.addEventListener('click', async (e) => {
        const target = e.target;
        
        if (target.classList.contains('approve-request-btn')) {
            const requesterId = target.dataset.requesterId;
            const updates = {};
            updates[`/outletMembers/${currentOutletId}/${requesterId}`] = { role: 'guest', accessEnabled: true, isAdmin: false };
            updates[`/outletSettings/${currentOutletId}/accessRequests/${requesterId}`] = null;
            await update(ref(db), updates);
            const userNotificationRef = ref(db, `users/${requesterId}/notifications`);
            const outletName = outletNameSpan.textContent || currentOutletId;
            await push(userNotificationRef, { message: `Your request to access '${outletName}' has been approved.`, timestamp: Date.now() });
        }

        if (target.classList.contains('deny-request-btn')) {
            const requesterId = target.dataset.requesterId;
            await remove(ref(db, `outletSettings/${currentOutletId}/accessRequests/${requesterId}`));
            const userNotificationRef = ref(db, `users/${requesterId}/notifications`);
            const outletName = outletNameSpan.textContent || currentOutletId;
            await push(userNotificationRef, { message: `Your request to access '${outletName}' has been denied.`, timestamp: Date.now() });
        }

        if (e.target.classList.contains('revoke-code-btn')) {
            const codeId = e.target.dataset.codeId;
            if (confirm("Are you sure you want to revoke this unused code?")) {
                await remove(ref(db, `tempAccessCodes/${codeId}`));
            }
        }
        
        if (e.target.classList.contains('end-session-btn')) {
            const memberId = e.target.dataset.memberId;
            if (confirm(`Are you sure you want to end this user's session immediately? Their access will be revoked.`)) {
                const updates = {};
                updates[`/outletMembers/${currentOutletId}/${memberId}/accessEnabled`] = false;
                updates[`/outletMembers/${currentOutletId}/${memberId}/isAdmin`] = false;
                updates[`/outletMembers/${currentOutletId}/${memberId}/expiresAt`] = null;
                await update(ref(db), updates);
            }
        }
    });

    modalElement.addEventListener('change', async (e) => {
        const target = e.target;
        const memberId = target.dataset.memberId;
        if (!memberId) return;

        if (target.classList.contains('access-toggle')) {
            const isEnabled = target.checked;
            const updates = {};
            updates[`/outletMembers/${currentOutletId}/${memberId}/accessEnabled`] = isEnabled;
            if (!isEnabled) {
                updates[`/outletMembers/${currentOutletId}/${memberId}/isAdmin`] = false;
            }
            await update(ref(db), updates);
        }

        if (target.classList.contains('admin-toggle')) {
            const isAdmin = target.checked;
            await update(ref(db, `/outletMembers/${currentOutletId}/${memberId}`), { isAdmin: isAdmin });
        }
    });

    modalElement.addEventListener('hidden.bs.modal', () => {
        if (window.memberTimerInterval) clearInterval(window.memberTimerInterval);
        if (requestsUnsub) try { requestsUnsub(); requestsUnsub = null; } catch(e){}
        if (membersUnsub) try { membersUnsub(); membersUnsub = null; } catch(e){}
        if (tempCodesUnsub) try { tempCodesUnsub(); tempCodesUnsub = null; } catch(e){}
        currentOutletId = null;
    });
}

function initializeTempCodeModal(user) {
    const enterCodeModalElement = document.getElementById('enter-code-modal');
    if (enterCodeModalElement) {
        const form = document.getElementById('submit-code-form');
        const input = document.getElementById('access-code-input');
        const enterCodeModal = new bootstrap.Modal(enterCodeModalElement);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const codeToSubmit = input.value.trim().toUpperCase();
            if (!codeToSubmit) return;

            const membersRef = ref(db, 'outletMembers');
            const membersSnap = await get(membersRef);
            if (membersSnap.exists()) {
                for (const outletId in membersSnap.val()) {
                    const memberData = membersSnap.val()[outletId][user.uid];
                    if (memberData && memberData.expiresAt && memberData.accessEnabled) {
                        alert("You already have an active temporary access session. Please wait for it to expire before entering a new code.");
                        return;
                    }
                }
            }
            
            const codesRef = ref(db, 'tempAccessCodes');
            const snapshot = await get(codesRef);
            if (!snapshot.exists()) {
                alert("Invalid code.");
                return;
            }

            let foundCodeId = null;
            let codeData = null;
            snapshot.forEach(child => {
                const data = child.val();
                if (data.code === codeToSubmit) {
                    foundCodeId = child.key;
                    codeData = data;
                }
            });

            if (!foundCodeId || codeData.expiresAt < Date.now()) {
                alert("This code is invalid or has expired.");
                return;
            }
            
            const expirationTimestamp = Date.now() + (codeData.durationMinutes * 60 * 1000);
            const updates = {};
            updates[`/outletMembers/${codeData.outletId}/${user.uid}`] = {
                role: 'guest',
                accessEnabled: true,
                isAdmin: codeData.permissions.isAdmin,
                expiresAt: expirationTimestamp
            };
            updates[`/tempAccessCodes/${foundCodeId}`] = null;

            await update(ref(db), updates);
            alert(`Success! You now have temporary access to outlet ${codeData.outletId}.`);
            enterCodeModal.hide();
            input.value = '';
        });
    }
}

function initializeProfilePictureUploader(user) {
    const fileInput = document.getElementById('profile-picture-input');
    const previewImage = document.getElementById('profile-picture-preview');
    const uploadButton = document.getElementById('upload-picture-btn');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');

    if (!fileInput) return;

    let selectedFile = null;

    fileInput.addEventListener('change', (e) => {
        selectedFile = e.target.files[0];
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = (event) => {
                previewImage.src = event.target.result;
            };
            reader.readAsDataURL(selectedFile);
        }
    });

    uploadButton.addEventListener('click', () => {
        if (!selectedFile) {
            alert("Please select an image file first.");
            return;
        }

        const filePath = `profilePictures/${user.uid}/${selectedFile.name}`;
        const fileRef = storageRef(storage, filePath);
        const uploadTask = uploadBytesResumable(fileRef, selectedFile);

        uploadTask.on('state_changed', 
            (snapshot) => {
                progressContainer.style.display = 'block';
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                progressBar.style.width = progress + '%';
                progressBar.textContent = Math.round(progress) + '%';
            }, 
            (error) => {
                console.error("Upload failed:", error);
                alert("Upload failed. Please try again.");
                progressContainer.style.display = 'none';
            }, 
            () => {
                getDownloadURL(uploadTask.snapshot.ref).then(async (downloadURL) => {
                    await update(ref(db, `users/${user.uid}`), {
                        profilePictureUrl: downloadURL
                    });
                    alert("Profile picture updated successfully!");
                    progressContainer.style.display = 'none';
                });
            }
        );
    });
}