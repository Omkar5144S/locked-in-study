/**
 * LOCKED-IN: Firebase Config & Cloud Sync with Zero-Config Fallback
 * Works 100% out-of-the-box in Local/PeerJS Instant Mode.
 * Upgrades seamlessly to global Firestore cloud sync when config is provided.
 */

// Default placeholder / local fallback config
const DEFAULT_FIREBASE_CONFIG = null;

class FirebaseManager {
  constructor() {
    this.isConfigured = false;
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.authListeners = [];
    this.eventListeners = new Map();
    this.roomListeners = new Map();
    
    // Attempt initialization from localStorage or inline constant
    this.init();
  }

  getSavedConfig() {
    try {
      const saved = localStorage.getItem('lockedin_firebase_config');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('[Firebase] Could not parse stored config:', e);
    }
    return DEFAULT_FIREBASE_CONFIG;
  }

  saveConfig(configObj) {
    if (!configObj || typeof configObj !== 'object') {
      localStorage.removeItem('lockedin_firebase_config');
      this.isConfigured = false;
      return false;
    }
    try {
      localStorage.setItem('lockedin_firebase_config', JSON.stringify(configObj));
      return this.init();
    } catch (e) {
      console.error('[Firebase] Failed to save config:', e);
      return false;
    }
  }

  init() {
    const config = this.getSavedConfig();
    if (!config || !config.apiKey || !config.projectId) {
      console.log('[Firebase] Running in Local/PeerJS Instant Mode (No cloud config detected).');
      this.isConfigured = false;
      this.setupLocalFallbackUser();
      return false;
    }

    try {
      if (window.firebase && !window.firebase.apps.length) {
        window.firebase.initializeApp(config);
        this.auth = window.firebase.auth();
        this.db = window.firebase.firestore();
        this.isConfigured = true;

        this.auth.onAuthStateChanged((user) => {
          this.currentUser = user;
          this.authListeners.forEach(cb => cb(user));
        });

        console.log('[Firebase] Successfully connected to Firebase Project:', config.projectId);
        return true;
      }
    } catch (err) {
      console.warn('[Firebase] Initialization error. Falling back to local mode:', err);
      this.isConfigured = false;
      this.setupLocalFallbackUser();
      return false;
    }
    return false;
  }

  setupLocalFallbackUser() {
    // Generate or fetch local pseudo-user
    let localUid = localStorage.getItem('lockedin_local_uid');
    if (!localUid) {
      localUid = 'user_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('lockedin_local_uid', localUid);
    }
    this.currentUser = {
      uid: localUid,
      isAnonymous: true,
      displayName: localStorage.getItem('lockedin_display_name') || 'Scholar_' + localUid.slice(-4)
    };
    // Notify listeners
    setTimeout(() => {
      this.authListeners.forEach(cb => cb(this.currentUser));
    }, 50);
  }

  onAuth(callback) {
    this.authListeners.push(callback);
    if (this.currentUser) callback(this.currentUser);
  }

  async signInAnonymously() {
    if (this.isConfigured && this.auth) {
      try {
        const cred = await this.auth.signInAnonymously();
        this.currentUser = cred.user;
        return this.currentUser;
      } catch (err) {
        console.error('[Firebase] Anonymous auth error:', err);
      }
    }
    return this.currentUser;
  }

  async signInWithGoogle() {
    if (this.isConfigured && this.auth && window.firebase) {
      try {
        const provider = new window.firebase.auth.GoogleAuthProvider();
        const cred = await this.auth.signInWithPopup(provider);
        this.currentUser = cred.user;
        return this.currentUser;
      } catch (err) {
        console.error('[Firebase] Google sign-in error:', err);
        throw err;
      }
    }
    throw new Error('Firebase cloud sync is not configured. Connect your Firebase project in Admin Studio.');
  }

  // User Profile
  async updateUserProfile(profile) {
    if (!this.currentUser) return;
    const uid = this.currentUser.uid;
    const updated = {
      uid,
      displayName: profile.displayName || this.currentUser.displayName || 'Scholar',
      subjectGoal: profile.subjectGoal || 'Deep Focus',
      totalPoints: profile.totalPoints !== undefined ? profile.totalPoints : 0,
      cleanStudyMinutes: profile.cleanStudyMinutes || 0,
      shameCount: profile.shameCount || 0,
      topTrigger: profile.topTrigger || 'None',
      updatedAt: Date.now()
    };

    // Always update local cache
    localStorage.setItem('lockedin_profile_' + uid, JSON.stringify(updated));
    localStorage.setItem('lockedin_display_name', updated.displayName);
    localStorage.setItem('lockedin_subject_goal', updated.subjectGoal);

    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('users').doc(uid).set(updated, { merge: true });
      } catch (err) {
        console.warn('[Firebase] Cloud profile update failed:', err);
      }
    }
    return updated;
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

  // Room presence & state sync
  async joinRoom(roomId, participant) {
    if (!roomId || !participant) return;
    const uid = participant.userId || (this.currentUser ? this.currentUser.uid : 'anon');

    if (this.isConfigured && this.db) {
      try {
        const roomRef = this.db.collection('rooms').doc(roomId);
        const partRef = roomRef.collection('participants').doc(uid);
        
        await partRef.set({
          ...participant,
          joinedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          lastSeen: window.firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Update participant count
        const partsSnap = await roomRef.collection('participants').get();
        await roomRef.set({
          name: roomId,
          updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          participantCount: partsSnap.size
        }, { merge: true });
      } catch (err) {
        console.warn('[Firebase] Cloud join room failed:', err);
      }
    }
  }

  async leaveRoom(roomId, participantId) {
    if (!roomId || !participantId) return;
    if (this.isConfigured && this.db) {
      try {
        const roomRef = this.db.collection('rooms').doc(roomId);
        await roomRef.collection('participants').doc(participantId).delete();
        const partsSnap = await roomRef.collection('participants').get();
        await roomRef.update({
          participantCount: partsSnap.size,
          updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn('[Firebase] Cloud leave room failed:', err);
      }
    }
  }

  listenToRoom(roomId, onUpdate) {
    if (this.isConfigured && this.db) {
      const unsubscribe = this.db.collection('rooms').doc(roomId)
        .collection('participants')
        .onSnapshot((snapshot) => {
          const list = [];
          snapshot.forEach(doc => list.push(doc.data()));
          onUpdate(list);
        }, (err) => {
          console.warn('[Firebase] Room listener error:', err);
        });
      return unsubscribe;
    }
    return () => {};
  }

  // Event Broadcasting (Triggers, Peer Callouts, Shame, Timer sync)
  async broadcastEvent(roomId, event) {
    if (!roomId || !event) return;
    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('rooms').doc(roomId).collection('events').add({
          ...event,
          timestamp: window.firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn('[Firebase] Broadcast event cloud fail:', err);
      }
    }
  }

  listenToRoomEvents(roomId, onEvent) {
    if (this.isConfigured && this.db) {
      const now = new Date();
      const unsubscribe = this.db.collection('rooms').doc(roomId)
        .collection('events')
        .where('timestamp', '>=', now)
        .onSnapshot((snapshot) => {
          snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
              onEvent(change.doc.data());
            }
          });
        }, (err) => {
          console.warn('[Firebase] Event stream listener error:', err);
        });
      return unsubscribe;
    }
    return () => {};
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
      // Keep last 100 entries locally
      if (history.length > 100) history.pop();
      localStorage.setItem('lockedin_shame_history', JSON.stringify(history));
    } catch (e) {
      console.warn('[Storage] Local shame history record error:', e);
    }

    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('wall_of_shame').add({
          ...shameRecord,
          timestamp: window.firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn('[Firebase] Wall of shame cloud record fail:', err);
      }
    }
  }
}

// Global instance
window.FirebaseSync = new FirebaseManager();
