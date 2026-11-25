/**
 * LOCKED-IN: Firebase Config & Cloud Sync
 * Connects every visitor directly to Cloud Firestore & Firebase Auth (my-study-project-c37cd).
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDFPaC9mEWz5rdjFR6WC7ANx8lwuxk41z0",
  authDomain: "my-study-project-c37cd.firebaseapp.com",
  projectId: "my-study-project-c37cd",
  storageBucket: "my-study-project-c37cd.firebasestorage.app",
  messagingSenderId: "449695129957",
  appId: "1:449695129957:web:aba918c9ca70729104c18c",
  measurementId: "G-YDKTBLK1FK"
};

class FirebaseManager {
  constructor() {
    this.isConfigured = false;
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.authListeners = [];
    this.eventListeners = new Map();
    this.roomListeners = new Map();
    this.broadcastChannels = new Map();
    this.knownRooms = new Set();
    this.lastAuthError = null;
    this._anonSignInInFlight = null;
    this._authReadyResolve = null;
    this._authReadyPromise = new Promise((resolve) => {
      this._authReadyResolve = resolve;
    });

    this.init();
  }

  getSavedConfig() {
    if (typeof window !== 'undefined' && window.FIREBASE_CONFIG && typeof window.FIREBASE_CONFIG === 'object' && window.FIREBASE_CONFIG.apiKey && window.FIREBASE_CONFIG.projectId) {
      return window.FIREBASE_CONFIG;
    }
    return DEFAULT_FIREBASE_CONFIG;
  }

  saveConfig(configObj) {
    if (!configObj || typeof configObj !== 'object') {
      localStorage.removeItem('lockedin_firebase_config');
      window.FIREBASE_CONFIG = null;
      return this.init();
    }
    try {
      localStorage.setItem('lockedin_firebase_config', JSON.stringify(configObj));
      window.FIREBASE_CONFIG = configObj;
      return this.init();
    } catch (e) {
      console.error('[Firebase] Failed to save config:', e);
      return false;
    }
  }

  init() {
    const config = this.getSavedConfig();
    if (!config || !config.apiKey || !config.projectId || typeof window === 'undefined' || !window.firebase) {
      console.error('[Firebase] Firebase SDK or config unavailable.');
      this.isConfigured = false;
      if (this._authReadyResolve) this._authReadyResolve(null);
      return false;
    }

    try {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(config);
      }
      this.auth = window.firebase.auth();
      this.db = window.firebase.firestore();
      this.isConfigured = true;

      // Enforce persistent local login across page reloads, tab closes, and browser restarts
      if (window.firebase.auth.Auth && window.firebase.auth.Auth.Persistence && window.firebase.auth.Auth.Persistence.LOCAL) {
        this.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
          console.warn('[Firebase] setPersistence warning:', err);
        });
      }

      // Check redirect result FIRST so anonymous auto-login never races with Google redirect
      const redirectPromise = this.initRedirectResult().catch((err) => {
        console.warn('[Firebase] initRedirectResult error:', err);
        return null;
      });

      this.auth.onAuthStateChanged(async (user) => {
        await redirectPromise;
        const activeUser = this.auth.currentUser || user;

        if (activeUser) {
          const isGoogleUser = !activeUser.isAnonymous;
          let callSign = localStorage.getItem('lockedin_display_name') || activeUser.displayName || 'Scholar_' + activeUser.uid.slice(-4);
          let subjectGoal = localStorage.getItem('lockedin_subject_goal') || 'Organic Chemistry & Calculus';
          let photoURL = isGoogleUser ? (activeUser.photoURL || '') : '';
          let cloudProfile = null;

          // Restore cached profile from localStorage backup first
          try {
            const cachedRaw = localStorage.getItem('lockedin_profile_' + activeUser.uid);
            if (cachedRaw) cloudProfile = JSON.parse(cachedRaw);
          } catch (e) {}

          if (isGoogleUser && this.db) {
            try {
              const uDoc = await this.db.collection('users').doc(activeUser.uid).get();
              if (uDoc.exists) {
                const uData = uDoc.data();
                cloudProfile = { ...(cloudProfile || {}), ...uData };
                if (uData.callSign) callSign = uData.callSign;
                if (uData.subjectGoal) subjectGoal = uData.subjectGoal;
                if (uData.photoURL) photoURL = uData.photoURL;
              }
            } catch (e) {
              console.warn('[Firebase] User profile fetch warning:', e);
            }
          }

          if (isGoogleUser) {
            localStorage.setItem('lockedin_display_name', callSign);
            localStorage.setItem('lockedin_subject_goal', subjectGoal);
            if (cloudProfile) {
              try {
                localStorage.setItem('lockedin_profile_' + activeUser.uid, JSON.stringify(cloudProfile));
              } catch (e) {}
            }
          }

          this.currentUser = {
            uid: activeUser.uid,
            isAnonymous: activeUser.isAnonymous,
            displayName: activeUser.displayName || callSign,
            callSign: callSign,
            subjectGoal: subjectGoal,
            photoURL: photoURL,
            isVerified: isGoogleUser
          };

          if (window.Leaderboard && window.Leaderboard.currentUser) {
            window.Leaderboard.currentUser.uid = activeUser.uid;
            window.Leaderboard.currentUser.displayName = callSign;
            window.Leaderboard.currentUser.subjectGoal = subjectGoal;
            if (cloudProfile) {
              if (typeof cloudProfile.totalPoints === 'number') window.Leaderboard.currentUser.totalPoints = Math.max(0, cloudProfile.totalPoints);
              if (typeof cloudProfile.cleanStudyMinutes === 'number') window.Leaderboard.currentUser.cleanStudyMinutes = cloudProfile.cleanStudyMinutes;
              if (typeof cloudProfile.shameCount === 'number') window.Leaderboard.currentUser.shameCount = cloudProfile.shameCount;
              if (cloudProfile.topTrigger) window.Leaderboard.currentUser.topTrigger = cloudProfile.topTrigger;
              if (typeof cloudProfile.xp === 'number') window.Leaderboard.currentUser.xp = cloudProfile.xp;
              if (typeof cloudProfile.coins === 'number') window.Leaderboard.currentUser.coins = cloudProfile.coins;
              if (typeof cloudProfile.level === 'number') window.Leaderboard.currentUser.level = cloudProfile.level;
              if (typeof cloudProfile.dailyStreak === 'number') window.Leaderboard.currentUser.dailyStreak = cloudProfile.dailyStreak;
              if (cloudProfile.lastStudyDate) window.Leaderboard.currentUser.lastStudyDate = cloudProfile.lastStudyDate;
              if (Array.isArray(cloudProfile.unlockedBadges)) window.Leaderboard.currentUser.unlockedBadges = cloudProfile.unlockedBadges;
              if (Array.isArray(cloudProfile.unlockedThemes)) window.Leaderboard.currentUser.unlockedThemes = cloudProfile.unlockedThemes;
              if (cloudProfile.equippedTheme) {
                window.Leaderboard.currentUser.equippedTheme = cloudProfile.equippedTheme;
                if (window.Leaderboard.applyTheme) window.Leaderboard.applyTheme(cloudProfile.equippedTheme);
              }
              if (Array.isArray(cloudProfile.unlockedPets)) window.Leaderboard.currentUser.unlockedPets = cloudProfile.unlockedPets;
              if (cloudProfile.equippedPet) {
                window.Leaderboard.currentUser.equippedPet = cloudProfile.equippedPet;
                window.Leaderboard.currentUser.activePet = cloudProfile.equippedPet;
              }
            }
            if (typeof window.Leaderboard.renderHUD === 'function') window.Leaderboard.renderHUD();
            if (typeof window.Leaderboard.renderBoards === 'function') window.Leaderboard.renderBoards();
          }

          this.authListeners.forEach(cb => cb(this.currentUser));
          if (this._authReadyResolve) {
            this._authReadyResolve(this.currentUser);
            this._authReadyResolve = null;
          }
          return;
        }

        // No user signed in yet — automatically sign in anonymously so Firestore rules work seamlessly
        if (!this._anonSignInInFlight) {
          this._anonSignInInFlight = this.auth.signInAnonymously().catch((anonErr) => {
            console.warn('[Firebase] Automatic anonymous sign-in unavailable:', anonErr.code || anonErr.message);
            this.lastAuthError = anonErr;
            this.currentUser = null;
            this.authListeners.forEach(cb => cb(null));
            if (this._authReadyResolve) {
              this._authReadyResolve(null);
              this._authReadyResolve = null;
            }
            return null;
          }).finally(() => {
            this._anonSignInInFlight = null;
          });
        }
      });

      console.log('[Firebase] Connected to Cloud Project:', config.projectId);
      return true;
    } catch (err) {
      console.error('[Firebase] Initialization error:', err);
      this.isConfigured = false;
      if (this._authReadyResolve) {
        this._authReadyResolve(null);
        this._authReadyResolve = null;
      }
      return false;
    }
  }

  async waitForAuth(timeoutMs = 8000) {
    if (this.auth && this.auth.currentUser && this.currentUser) {
      return this.currentUser;
    }
    const timeout = new Promise((resolve) => setTimeout(() => resolve(this.currentUser), timeoutMs));
    return Promise.race([this._authReadyPromise, timeout]);
  }

  async ensureAuth() {
    if (!this.isConfigured || !this.auth || !this.db) {
      throw new Error('Firebase Cloud is not initialized.');
    }
    await this.waitForAuth();
    if (this.auth.currentUser) {
      return this.auth.currentUser.uid;
    }
    // Retry anonymous sign-in once if still null
    try {
      const cred = await this.auth.signInAnonymously();
      if (cred && cred.user) {
        this.currentUser = {
          uid: cred.user.uid,
          isAnonymous: true,
          displayName: localStorage.getItem('lockedin_display_name') || 'Scholar_' + cred.user.uid.slice(-4),
          callSign: localStorage.getItem('lockedin_display_name') || 'Scholar_' + cred.user.uid.slice(-4),
          photoURL: '',
          isVerified: false
        };
        return cred.user.uid;
      }
    } catch (err) {
      console.error('[Firebase] ensureAuth failed:', err);
      throw new Error('Authentication required: click "Sign in" with Google or enable Anonymous Sign-In in Firebase Console.');
    }
    throw new Error('Authentication failed.');
  }

  onAuth(callback) {
    this.authListeners.push(callback);
    if (this.currentUser !== null) callback(this.currentUser);
  }

  async signInAnonymously() {
    if (this.isConfigured && this.auth) {
      const cred = await this.auth.signInAnonymously();
      return cred.user;
    }
    return null;
  }

  // Google Sign-In with Strict Privacy (Email never in public docs)
  // Returns user object on success. Throws real Error on failure — never fakes verified state.
  async signInWithGoogle() {
    if (!this.isConfigured || !this.auth || !window.firebase) {
      throw new Error('Firebase is not configured.');
    }
    if (window.firebase.auth.Auth && window.firebase.auth.Auth.Persistence && window.firebase.auth.Auth.Persistence.LOCAL) {
      await this.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    }
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    let cred;
    try {
      cred = await this.auth.signInWithPopup(provider);
    } catch (popupErr) {
      // Popup blocked on mobile or restricted browsers — fall back to redirect
      if (popupErr.code === 'auth/popup-blocked' ||
          popupErr.code === 'auth/operation-not-supported-in-this-environment') {
        sessionStorage.setItem('lockedin_pending_redirect', '1');
        await this.auth.signInWithRedirect(provider);
        return null; // Page will reload; result handled in initRedirectResult()
      }
      throw popupErr;
    }

    return this._processGoogleCred(cred);
  }

  // Called once on page load to pick up any pending signInWithRedirect result
  async initRedirectResult() {
    if (!this.isConfigured || !this.auth || !window.firebase) return null;
    try {
      const cred = await this.auth.getRedirectResult();
      sessionStorage.removeItem('lockedin_pending_redirect');
      if (cred && cred.user) {
        return await this._processGoogleCred(cred);
      }
    } catch (err) {
      sessionStorage.removeItem('lockedin_pending_redirect');
      console.warn('[Firebase] Redirect result error:', err);
      this.lastAuthError = err.message || 'Google Sign-In redirect failed.';
      if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(`❌ ${this.lastAuthError}`, 5000);
      }
    }
    return null;
  }

  // Shared post-sign-in logic: writes Firestore profile, returns currentUser
  async _processGoogleCred(cred) {
    const user = cred.user;
    const uid = user.uid;
    const savedLocalName = localStorage.getItem('lockedin_display_name');
    const useGoogleName = !savedLocalName || savedLocalName.startsWith('Scholar_') || savedLocalName === 'FocusScholar';
    const callSign = (useGoogleName ? (user.displayName || savedLocalName) : savedLocalName) || `Scholar_${uid.slice(-4)}`;
    const cleanCallSign = String(callSign).trim().slice(0, 50) || 'Scholar';
    const cleanDisplay = String(user.displayName || cleanCallSign).trim().slice(0, 50) || 'FocusScholar';

    if (useGoogleName && user.displayName) {
      localStorage.setItem('lockedin_display_name', cleanCallSign);
    }

    if (this.db) {
      // PRIVACY: email only in private subcollection — NEVER in public doc
      try {
        await this.db.collection('users').doc(uid).collection('private').doc('info').set({
          email: user.email || null,
          emailVerified: !!user.emailVerified,
          lastLogin: window.firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.warn('[Firebase] Private info sync failed:', e);
      }

      try {
        const userDoc = await this.db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
          await this.db.collection('users').doc(uid).set({
            uid,
            displayName: cleanDisplay,
            callSign: cleanCallSign,
            photoURL: (user.photoURL || '').slice(0, 500),
            subjectGoal: (localStorage.getItem('lockedin_subject_goal') || 'Deep Focus').slice(0, 100),
            isVerified: true,
            totalPoints: 150,
            cleanStudyMinutes: 0,
            shameCount: 0,
            topTrigger: 'None',
            level: 1,
            xp: 0,
            coins: 50,
            dailyStreak: 1,
            lastStudyDate: new Date().toISOString().slice(0, 10),
            unlockedBadges: ['pioneer'],
            createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            isAnonymous: false
          });
        } else {
          await this.db.collection('users').doc(uid).update({
            isVerified: true,
            isAnonymous: false,
            displayName: cleanDisplay,
            photoURL: (user.photoURL || '').slice(0, 500),
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          });
        }
      } catch (e) {
        console.warn('[Firebase] Public profile sync failed:', e);
      }
    }

    this.currentUser = {
      uid,
      isAnonymous: false,
      displayName: cleanDisplay,
      callSign: cleanCallSign,
      photoURL: user.photoURL || '',
      isVerified: true
    };
    this.authListeners.forEach(cb => cb(this.currentUser));
    return this.currentUser;
  }

  async signOut() {
    if (this.isConfigured && this.auth) {
      await this.auth.signOut();
    }
    this.currentUser = null;
    this.authListeners.forEach(cb => cb(null));
  }

  // User Profile
  async updateUserProfile(profile) {
    if (!this.isConfigured || !this.db || !this.auth || !this.auth.currentUser) return null;
    const uid = this.auth.currentUser.uid;
    const isGoogleVerified = !this.auth.currentUser.isAnonymous;
    const displayName = String(profile.displayName || this.currentUser?.displayName || 'Scholar').trim().slice(0, 50) || 'Scholar';
    const callSign = String(profile.callSign || displayName).trim().slice(0, 50) || 'Scholar';
    const subjectGoal = String(profile.subjectGoal || 'Deep Focus').trim().slice(0, 100);

    const fields = {
      uid,
      displayName,
      callSign,
      subjectGoal,
      totalPoints: Math.max(0, Math.min(10000000, Number(profile.totalPoints ?? 150) || 0)),
      cleanStudyMinutes: Math.max(0, Math.min(1000000, Number(profile.cleanStudyMinutes || 0))),
      shameCount: Math.max(0, Math.min(100000, Number(profile.shameCount || 0))),
      topTrigger: String(profile.topTrigger || 'None').slice(0, 100),
      level: Math.max(0, Math.min(10000, Number(profile.level || 1))),
      xp: Math.max(0, Math.min(100000000, Number(profile.xp || 0))),
      coins: Math.max(0, Math.min(10000000, Number(profile.coins ?? 50))),
      dailyStreak: Math.max(0, Math.min(10000, Number(profile.dailyStreak || 1))),
      lastStudyDate: String(profile.lastStudyDate || new Date().toISOString().slice(0, 10)).slice(0, 50),
      unlockedBadges: Array.isArray(profile.unlockedBadges) ? profile.unlockedBadges.slice(0, 100) : ['pioneer'],
      unlockedThemes: Array.isArray(profile.unlockedThemes) ? profile.unlockedThemes.slice(0, 30) : ['obsidian', 'paper'],
      equippedTheme: String(profile.equippedTheme || 'obsidian').slice(0, 40),
      unlockedPets: Array.isArray(profile.unlockedPets) ? profile.unlockedPets.slice(0, 30) : ['cat'],
      equippedPet: String(profile.equippedPet || profile.activePet || 'cat').slice(0, 40),
      isVerified: isGoogleVerified,
      isAnonymous: this.auth.currentUser.isAnonymous,
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };

    localStorage.setItem('lockedin_profile_' + uid, JSON.stringify(fields));
    localStorage.setItem('lockedin_display_name', callSign);
    localStorage.setItem('lockedin_subject_goal', subjectGoal);

    try {
      const userRef = this.db.collection('users').doc(uid);
      await userRef.set({
        ...fields,
        photoURL: (this.auth.currentUser.photoURL || '').slice(0, 500)
      }, { merge: true });
    } catch (err) {
      console.warn('[Firebase] Cloud profile update failed:', err);
    }
    return fields;
  }

  async getUserProfile(uid) {
    if (!uid) return null;
    if (this.isConfigured && this.db) {
      try {
        const doc = await this.db.collection('users').doc(uid).get();
        if (doc.exists) return doc.data();
      } catch (err) {
        console.warn('[Firebase] Cloud profile get failed:', err);
      }
    }
    const local = localStorage.getItem('lockedin_profile_' + uid);
    return local ? JSON.parse(local) : null;
  }

  // =========================================================
  // ROOM CREATION & LIVE LOBBY REFRESH
  // =========================================================

  async createRoom(roomData) {
    const hostUid = await this.ensureAuth();
    const roomId = String(roomData.roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24) || 'STUDY-101';
    const title = String(roomData.title || roomId).trim().slice(0, 100) || roomId;
    const sector = String(roomData.sector || 'stem').trim().slice(0, 50) || 'stem';
    const durationSec = Math.max(60, Math.min(86400, (Number(roomData.focusMinutes) || 25) * 60));

    const timerState = {
      mode: 'POMODORO',
      duration: durationSec,
      startedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      isPaused: false
    };

    const roomRef = this.db.collection('rooms').doc(roomId);
    const existing = await roomRef.get();

    if (!existing.exists) {
      const payload = {
        roomId,
        title,
        name: title,
        sector,
        hostUid,
        hostId: hostUid,
        activeCount: 1,
        participantCount: 1,
        timerState,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        lastPing: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      };
      await roomRef.set(payload);
      this.knownRooms.add(roomId);
      console.log('[Firebase] Room created in Firestore:', roomId);
      return payload;
    } else {
      const prevCount = existing.data()?.activeCount || 0;
      const updatePayload = {
        title,
        name: title,
        sector,
        timerState,
        activeCount: Math.min(100, Math.max(1, prevCount)),
        participantCount: Math.min(100, Math.max(1, prevCount)),
        lastPing: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      };
      await roomRef.update(updatePayload);
      this.knownRooms.add(roomId);
      console.log('[Firebase] Existing room refreshed in Firestore:', roomId);
      return { roomId, ...updatePayload };
    }
  }

  // Heartbeat ping room every 15s while active; creates room doc if joined directly by code/link
  async pingRoom(roomId, activeCount = 1) {
    if (!roomId) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    if (!cleanRoom) return;

    try {
      const uid = await this.ensureAuth();
      const clampedCount = Math.min(100, Math.max(0, Number(activeCount) || 0));
      const roomRef = this.db.collection('rooms').doc(cleanRoom);

      if (!this.knownRooms.has(cleanRoom)) {
        const snap = await roomRef.get();
        if (!snap.exists) {
          const defaultTitle = cleanRoom === 'MAIN-STUDY-HALL'
            ? '⚡ Main Study Hall (24/7 Community)'
            : `Study Lounge (${cleanRoom})`;
          await roomRef.set({
            roomId: cleanRoom,
            title: defaultTitle,
            name: defaultTitle,
            sector: cleanRoom === 'MAIN-STUDY-HALL' ? 'all' : 'stem',
            hostUid: uid,
            hostId: uid,
            activeCount: Math.max(1, clampedCount),
            participantCount: Math.max(1, clampedCount),
            timerState: {
              mode: 'POMODORO',
              duration: 1500,
              startedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
              isPaused: false
            },
            createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            lastPing: window.firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          });
          this.knownRooms.add(cleanRoom);
          return;
        }
        this.knownRooms.add(cleanRoom);
      }

      await roomRef.update({
        lastPing: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        activeCount: clampedCount,
        participantCount: clampedCount
      });
    } catch (e) {
      if (e && e.code === 'not-found') {
        this.knownRooms.delete(cleanRoom);
      }
      console.warn('[Firebase] pingRoom error:', e);
    }
  }

  _filterActiveRooms(snapshot) {
    const rooms = [];
    const now = Date.now();
    snapshot.forEach(doc => {
      const data = doc.data();
      const rId = data.roomId || doc.id;
      const lastPingMs = data.lastPing?.toMillis
        ? data.lastPing.toMillis()
        : (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : now);
      const count = data.activeCount !== undefined ? data.activeCount : 1;
      const isFresh = Math.abs(now - lastPingMs) <= 120000; // 120s (2-min) heartbeat timeout
      if (rId === 'MAIN-STUDY-HALL' || (isFresh && count > 0)) {
        rooms.push({ ...data, roomId: rId, id: rId, _lastPingMs: lastPingMs });
      } else if (rId !== 'MAIN-STUDY-HALL' && doc.ref) {
        // Best-effort auto-cleanup of closed/timed-out user-created rooms (>120s)
        doc.ref.delete().catch(() => {});
      }
    });
    rooms.sort((a, b) => {
      if (a.roomId === 'MAIN-STUDY-HALL') return -1;
      if (b.roomId === 'MAIN-STUDY-HALL') return 1;
      return (b._lastPingMs || 0) - (a._lastPingMs || 0);
    });
    return rooms;
  }

  // Listen to active rooms — automatically waits for Firebase Auth before subscribing,
  // and re-subscribes if user signs in later.
  listenToActiveRooms(callback) {
    let innerUnsub = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled || innerUnsub || !this.isConfigured || !this.db || !this.auth?.currentUser) return;
      innerUnsub = this.db.collection('rooms').onSnapshot((snapshot) => {
        callback(this._filterActiveRooms(snapshot));
      }, (err) => {
        console.warn('[Firebase] listenToActiveRooms error:', err);
        innerUnsub = null;
      });
    };

    this.waitForAuth().then(() => attach());
    this.onAuth((user) => {
      if (user) attach();
    });

    return () => {
      cancelled = true;
      if (innerUnsub) {
        innerUnsub();
        innerUnsub = null;
      }
    };
  }

  // Instant get() fetch for manual refresh button
  async getActiveRoomsOnce() {
    await this.ensureAuth();
    const snap = await this.db.collection('rooms').get();
    return this._filterActiveRooms(snap);
  }

  // Synchronized Room Pomodoro: write timerEndAt, timerMode, isRunning to rooms/{roomId}
  async updateRoomTimer(roomId, timerState) {
    if (!roomId || !this.isConfigured || !this.db || !this.auth?.currentUser) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    if (!cleanRoom) return;
    try {
      await this.db.collection('rooms').doc(cleanRoom).update({
        timerEndAt: timerState.timerEndAt || null,
        timerMode: String(timerState.timerMode || 'FOCUS'),
        isRunning: !!timerState.isRunning,
        secondsLeft: Number(timerState.secondsLeft || 0),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('[Firebase] updateRoomTimer error:', e);
    }
  }

  listenToRoom(roomId, callback) {
    if (!roomId || !this.isConfigured || !this.db) return () => {};
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    let innerUnsub = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled || innerUnsub || !this.auth?.currentUser) return;
      innerUnsub = this.db.collection('rooms').doc(cleanRoom).onSnapshot((doc) => {
        if (doc.exists) callback(doc.data());
      }, (err) => {
        console.warn('[Firebase] listenToRoom error:', err);
      });
    };

    this.waitForAuth().then(() => attach());
    return () => {
      cancelled = true;
      if (innerUnsub) innerUnsub();
    };
  }

  // =========================================================
  // PEER-PAIR SIGNALING & PRESENCE ARCHITECTURE
  // =========================================================

  async setParticipantPresence(roomId, peerId, data) {
    if (!roomId || !peerId) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    const uid = await this.ensureAuth();
    const callSign = String(data.callSign || data.displayName || 'Scholar').trim().slice(0, 50) || 'Scholar';
    const isGoogleVerified = !!(this.auth.currentUser && !this.auth.currentUser.isAnonymous);

    const payload = {
      peerId: String(peerId).slice(0, 100),
      callSign,
      displayName: callSign,
      cameraMode: String(data.cameraMode || 'dual').slice(0, 50),
      isVerified: isGoogleVerified,
      userId: uid,
      status: 'LOCKED_IN',
      isHandRaised: false,
      timerRemaining: 1500,
      joinedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      lastSeen: window.firebase.firestore.FieldValue.serverTimestamp(),
      lastHeartbeat: window.firebase.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('rooms').doc(cleanRoom).collection('participants').doc(peerId).set(payload);
  }

  async updateParticipantHeartbeat(roomId, peerId) {
    if (!roomId || !peerId || !this.isConfigured || !this.db || !this.auth?.currentUser) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    try {
      await this.db.collection('rooms').doc(cleanRoom).collection('participants').doc(peerId).update({
        lastSeen: window.firebase.firestore.FieldValue.serverTimestamp(),
        lastHeartbeat: window.firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('[Firebase] participant heartbeat error:', e);
    }
  }

  async updateParticipantNowPlaying(roomId, peerId, nowPlaying) {
    if (!roomId || !peerId || !this.isConfigured || !this.db || !this.auth?.currentUser) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    try {
      await this.db.collection('rooms').doc(cleanRoom).collection('participants').doc(peerId).update({
        nowPlaying: nowPlaying ? String(nowPlaying).slice(0, 80) : ''
      });
    } catch (e) {
      console.warn('[Firebase] updateParticipantNowPlaying error:', e);
    }
  }

  // Real-Time Room Chat: rooms/{roomId}/messages (last 50, 200 char max)
  async sendRoomMessage(roomId, text, senderName) {
    if (!roomId || !text) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    const cleanText = String(text).trim().slice(0, 200);
    if (!cleanText) return;
    const uid = await this.ensureAuth();
    const author = String(senderName || this.currentUser?.callSign || 'Scholar').trim().slice(0, 40);
    await this.db.collection('rooms').doc(cleanRoom).collection('messages').add({
      uid,
      senderName: author,
      text: cleanText,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      clientTs: Date.now()
    });
  }

  listenToRoomMessages(roomId, callback) {
    if (!roomId || !this.isConfigured || !this.db) return () => {};
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    let innerUnsub = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled || innerUnsub || !this.auth?.currentUser) return;
      innerUnsub = this.db.collection('rooms').doc(cleanRoom).collection('messages')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .onSnapshot((snapshot) => {
          const msgs = [];
          snapshot.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
          msgs.reverse();
          callback(msgs);
        }, (err) => {
          console.warn('[Firebase] listenToRoomMessages error:', err);
        });
    };

    this.waitForAuth().then(() => attach());
    return () => {
      cancelled = true;
      if (innerUnsub) innerUnsub();
    };
  }

  async removeParticipantPresence(roomId, peerId, checkDeleteRoom = false) {
    if (!roomId || !peerId || !this.isConfigured || !this.db) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    try {
      const roomRef = this.db.collection('rooms').doc(cleanRoom);
      await roomRef.collection('participants').doc(peerId).delete();
      if (checkDeleteRoom && cleanRoom !== 'MAIN-STUDY-HALL') {
        const remaining = await roomRef.collection('participants').get();
        const now = Date.now();
        const activeRemaining = remaining.docs.filter(d => {
          const data = d.data();
          const hbMs = data.lastHeartbeat?.toMillis
            ? data.lastHeartbeat.toMillis()
            : (data.lastSeen?.toMillis ? data.lastSeen.toMillis() : (data.joinedAt?.toMillis ? data.joinedAt.toMillis() : now));
          return Math.abs(now - hbMs) <= 120000;
        });
        if (activeRemaining.length === 0) {
          await roomRef.delete().catch(async () => {
            await roomRef.update({ activeCount: 0, participantCount: 0 }).catch(() => {});
          });
        }
      }
    } catch (e) {
      console.warn('[Firebase] removeParticipantPresence error:', e);
    }
  }

  listenToParticipants(roomId, callback) {
    if (!roomId) return () => {};
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    let innerUnsub = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled || innerUnsub || !this.isConfigured || !this.db || !this.auth?.currentUser) return;
      innerUnsub = this.db.collection('rooms').doc(cleanRoom).collection('participants').onSnapshot((snapshot) => {
        const list = [];
        const now = Date.now();
        snapshot.forEach(doc => {
          const data = doc.data();
          const hbMs = data.lastHeartbeat?.toMillis
            ? data.lastHeartbeat.toMillis()
            : (data.lastSeen?.toMillis ? data.lastSeen.toMillis() : (data.joinedAt?.toMillis ? data.joinedAt.toMillis() : now));
          // Ignore & purge disconnected/closed peers whose lastHeartbeat is older than 120 seconds (2 min)
          if (Math.abs(now - hbMs) <= 120000) {
            list.push(data);
          } else if (doc.ref) {
            doc.ref.delete().catch(() => {});
          }
        });
        callback(list);
      }, (err) => {
        console.warn('[Firebase] listenToParticipants error:', err);
      });
    };

    this.waitForAuth().then(() => attach());

    return () => {
      cancelled = true;
      if (innerUnsub) {
        innerUnsub();
        innerUnsub = null;
      }
    };
  }

  // Peer-Pair Connections: rooms/{roomId}/connections/{smallerId}_{largerId}
  async writeConnectionOffer(roomId, connectionId, offerData) {
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    await this.ensureAuth();
    await this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).set({
      ...offerData,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async writeConnectionAnswer(roomId, connectionId, answerData) {
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    await this.ensureAuth();
    await this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).update({
      ...answerData,
      answeredAt: window.firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  listenToConnection(roomId, connectionId, callback) {
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    if (!this.isConfigured || !this.db) return () => {};
    return this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).onSnapshot((doc) => {
      if (doc.exists) callback(doc.data());
    }, (err) => {
      console.warn('[Firebase] listenToConnection error:', err);
    });
  }

  async addIceCandidate(roomId, connectionId, type, candidate) {
    if (!roomId || !connectionId || !candidate || !this.isConfigured || !this.db) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    const candJson = candidate.toJSON ? candidate.toJSON() : JSON.parse(JSON.stringify(candidate));

    try {
      const sub = (type === 'caller') ? 'callerCandidates' : 'calleeCandidates';
      await this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId)
        .collection(sub).add({
          candidate: candJson,
          createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
      console.warn('[Firebase] addIceCandidate error:', e);
    }
  }

  listenToIceCandidates(roomId, connectionId, type, callback) {
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    if (!this.isConfigured || !this.db) return () => {};
    const sub = (type === 'caller') ? 'callerCandidates' : 'calleeCandidates';
    return this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId)
      .collection(sub).onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data && data.candidate) callback(data.candidate);
          }
        });
      }, (err) => {
        console.warn('[Firebase] listenToIceCandidates error:', err);
      });
  }

  async cleanupConnection(roomId, connectionId) {
    if (!roomId || !connectionId || !this.isConfigured || !this.db) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    try {
      await this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).delete();
    } catch (e) {}
  }

  getChannel(name) {
    if (!this.broadcastChannels.has(name)) {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannels.set(name, new BroadcastChannel('lockedin_' + name));
      } else {
        this.broadcastChannels.set(name, {
          postMessage: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          close: () => {}
        });
      }
    }
    return this.broadcastChannels.get(name);
  }

  // Event Broadcasting (Triggers, Peer Callouts, Shame, Timer sync)
  async broadcastEvent(roomId, event) {
    if (!roomId || !event || !this.isConfigured || !this.db) return;
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    try {
      const uid = await this.ensureAuth();
      const { type, senderName, message, targetUserId, ...rest } = event;
      await this.db.collection('rooms').doc(cleanRoom).collection('events').add({
        type: String(type || 'EVENT').slice(0, 50),
        senderId: uid,
        senderName: String(senderName || localStorage.getItem('lockedin_display_name') || 'Scholar').trim().slice(0, 50) || 'Scholar',
        message: message ? String(message).slice(0, 500) : '',
        payload: rest,
        ...(targetUserId ? { targetUserId: String(targetUserId).slice(0, 128) } : {}),
        timestamp: window.firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) {
      console.warn('[Firebase] Broadcast event cloud fail:', err);
    }
  }

  listenToRoomEvents(roomId, onEvent) {
    if (!roomId) return () => {};
    const cleanRoom = String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    let innerUnsub = null;
    let cancelled = false;
    let initialLoad = true;

    const attach = () => {
      if (cancelled || innerUnsub || !this.isConfigured || !this.db || !this.auth?.currentUser) return;
      innerUnsub = this.db.collection('rooms').doc(cleanRoom)
        .collection('events')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .onSnapshot((snapshot) => {
          if (initialLoad) {
            initialLoad = false;
            return;
          }
          snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
              onEvent(change.doc.data());
            }
          });
        }, (err) => {
          console.warn('[Firebase] Event stream listener error:', err);
        });
    };

    this.waitForAuth().then(() => attach());

    return () => {
      cancelled = true;
      if (innerUnsub) {
        innerUnsub();
        innerUnsub = null;
      }
    };
  }

  // Public Shame Log
  async recordPublicShame(shameRecord) {
    try {
      const history = JSON.parse(localStorage.getItem('lockedin_shame_history') || '[]');
      history.unshift({
        ...shameRecord,
        id: 'shame_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        timeString: new Date().toLocaleTimeString()
      });
      if (history.length > 100) history.pop();
      localStorage.setItem('lockedin_shame_history', JSON.stringify(history));
    } catch (e) {}

    if (this.isConfigured && this.db && this.auth?.currentUser) {
      try {
        await this.db.collection('wall_of_shame').add({
          userId: this.auth.currentUser.uid,
          displayName: String(shameRecord.displayName || 'Scholar').slice(0, 50),
          triggerId: String(shameRecord.triggerId || 'DISTRACTION').slice(0, 50),
          triggerName: String(shameRecord.triggerName || 'Focus Break').slice(0, 100),
          pointsDeducted: Math.max(0, Number(shameRecord.pointsDeducted) || 0),
          roomId: String(shameRecord.roomId || '').slice(0, 100),
          timestamp: window.firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn('[Firebase] Wall of shame cloud record fail:', err);
      }
    }
  }

  // =========================================================
  // Peer Doubt Board (Community Questions & Answers)
  // =========================================================
  async createDoubt({ subject, questionText, imageUrl = '', bountyCoins = 20 }) {
    const authorUid = await this.ensureAuth();
    const authorCallSign = String((this.currentUser && this.currentUser.callSign) || localStorage.getItem('lockedin_display_name') || 'Scholar').trim().slice(0, 50) || 'Scholar';
    const doubtId = 'd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const doubtData = {
      doubtId,
      authorUid,
      authorCallSign,
      subject: String(subject || 'General Study').trim().slice(0, 100) || 'General Study',
      questionText: String(questionText || '').trim().slice(0, 5000),
      imageUrl: String(imageUrl || '').slice(0, 500),
      bountyCoins: Math.max(0, Math.min(100000, Number(bountyCoins) || 20)),
      status: 'OPEN',
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('doubts').doc(doubtId).set(doubtData);
    return doubtId;
  }

  listenToDoubts(callback) {
    let innerUnsub = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled || innerUnsub || !this.isConfigured || !this.db || !this.auth?.currentUser) return;
      innerUnsub = this.db.collection('doubts')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .onSnapshot((snapshot) => {
          const list = [];
          snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
          callback(list);
        }, (err) => {
          console.warn('[Firebase] Doubts listener error:', err);
          innerUnsub = null;
        });
    };

    this.waitForAuth().then(() => attach());
    this.onAuth((user) => {
      if (user) attach();
    });

    return () => {
      cancelled = true;
      if (innerUnsub) {
        innerUnsub();
        innerUnsub = null;
      }
    };
  }

  async addDoubtAnswer(doubtId, answerText) {
    const authorUid = await this.ensureAuth();
    const authorCallSign = String((this.currentUser && this.currentUser.callSign) || localStorage.getItem('lockedin_display_name') || 'Scholar').trim().slice(0, 50) || 'Scholar';
    const answerId = 'a_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const answerData = {
      answerId,
      doubtId,
      authorUid,
      authorCallSign,
      answerText: String(answerText || '').trim().slice(0, 5000),
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      isAccepted: false
    };

    await this.db.collection('doubts').doc(doubtId).collection('answers').doc(answerId).set(answerData);
    return answerId;
  }

  listenToDoubtAnswers(doubtId, callback) {
    if (!this.isConfigured || !this.db) return () => {};
    return this.db.collection('doubts').doc(doubtId).collection('answers')
      .orderBy('createdAt', 'asc')
      .onSnapshot((snapshot) => {
        const list = [];
        snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        callback(list);
      }, (err) => {
        console.warn('[Firebase] Answers listener error:', err);
      });
  }

  async acceptDoubtAnswer(doubtId, answerId, solverUid) {
    await this.ensureAuth();
    await this.db.collection('doubts').doc(doubtId).update({
      status: 'RESOLVED',
      acceptedAnswerId: answerId,
      solverUid: solverUid,
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    });
    await this.db.collection('doubts').doc(doubtId).collection('answers').doc(answerId).update({
      isAccepted: true,
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  }
}

// Global instance
window.FirebaseSync = new FirebaseManager();
