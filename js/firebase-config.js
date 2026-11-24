/**
 * LOCKED-IN: Firebase Config & Cloud Sync with Zero-Config Fallback
 * Works 100% out-of-the-box in Local/Peer-Pair Instant Mode.
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
    this.broadcastChannels = new Map();
    
    // Attempt initialization from localStorage, window.FIREBASE_CONFIG, or inline constant
    this.init();
  }

  getSavedConfig() {
    if (typeof window !== 'undefined' && window.FIREBASE_CONFIG && typeof window.FIREBASE_CONFIG === 'object') {
      return window.FIREBASE_CONFIG;
    }
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
      console.log('[Firebase] Running in Local Instant Mode (No cloud config detected).');
      this.isConfigured = false;
      this.setupLocalFallbackUser();
      return false;
    }

    try {
      if (window.firebase) {
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp(config);
        }
        this.auth = window.firebase.auth();
        this.db = window.firebase.firestore();
        this.isConfigured = true;

        this.auth.onAuthStateChanged(async (user) => {
          if (user) {
            // Check if user has verified profile in Firestore
            let isVerified = !user.isAnonymous;
            let callSign = localStorage.getItem('lockedin_display_name') || user.displayName || 'Scholar_' + user.uid.slice(-4);
            try {
              const uDoc = await this.db.collection('users').doc(user.uid).get();
              if (uDoc.exists) {
                const uData = uDoc.data();
                if (uData.callSign) callSign = uData.callSign;
                if (uData.isVerified !== undefined) isVerified = uData.isVerified;
              }
            } catch (e) {}

            this.currentUser = {
              uid: user.uid,
              isAnonymous: user.isAnonymous,
              displayName: user.displayName || callSign,
              callSign: callSign,
              photoURL: user.photoURL || '',
              isVerified: isVerified
            };
          } else {
            this.setupLocalFallbackUser();
          }
          this.authListeners.forEach(cb => cb(this.currentUser));
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
    let localUid = localStorage.getItem('lockedin_local_uid');
    if (!localUid) {
      localUid = 'user_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('lockedin_local_uid', localUid);
    }
    const savedName = localStorage.getItem('lockedin_display_name') || 'Scholar_' + localUid.slice(-4);
    this.currentUser = {
      uid: localUid,
      isAnonymous: true,
      displayName: savedName,
      callSign: savedName,
      photoURL: '',
      isVerified: localStorage.getItem('lockedin_is_verified') === 'true'
    };
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
        return cred.user;
      } catch (err) {
        console.error('[Firebase] Anonymous auth error:', err);
      }
    }
    return this.currentUser;
  }

  // Google Sign-In with Strict Privacy (Email never in public docs)
  async signInWithGoogle() {
    if (this.isConfigured && this.auth && window.firebase) {
      try {
        const provider = new window.firebase.auth.GoogleAuthProvider();
        const cred = await this.auth.signInWithPopup(provider);
        const user = cred.user;
        const uid = user.uid;

        // PRIVACY ENFORCEMENT: Never store email in public doc.
        // Store email strictly in private subcollection: users/{uid}/private/info
        if (this.db) {
          try {
            await this.db.collection('users').doc(uid).collection('private').doc('info').set({
              email: user.email || null,
              emailVerified: !!user.emailVerified,
              lastLogin: window.firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          } catch (e) {
            console.warn('[Firebase] Private info sync failed:', e);
          }

          // Fetch or initialize public profile WITHOUT email
          try {
            const userDoc = await this.db.collection('users').doc(uid).get();
            const callSign = localStorage.getItem('lockedin_display_name') || user.displayName || `Scholar_${uid.slice(-4)}`;
            if (!userDoc.exists) {
              await this.db.collection('users').doc(uid).set({
                uid: uid,
                displayName: user.displayName || 'FocusScholar',
                callSign: callSign,
                photoURL: user.photoURL || '',
                subjectGoal: localStorage.getItem('lockedin_subject_goal') || 'Deep Focus',
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
                photoURL: user.photoURL || '',
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
              });
            }
          } catch (e) {
            console.warn('[Firebase] Public profile sync failed:', e);
          }
        }

        localStorage.setItem('lockedin_is_verified', 'true');
        this.currentUser = {
          uid: uid,
          isAnonymous: false,
          displayName: user.displayName || 'FocusScholar',
          callSign: localStorage.getItem('lockedin_display_name') || user.displayName || `Scholar_${uid.slice(-4)}`,
          photoURL: user.photoURL || '',
          isVerified: true
        };
        this.authListeners.forEach(cb => cb(this.currentUser));
        return this.currentUser;
      } catch (err) {
        console.error('[Firebase] Google sign-in error:', err);
        throw err;
      }
    }

    // Local simulation fallback
    localStorage.setItem('lockedin_is_verified', 'true');
    this.currentUser.isVerified = true;
    this.currentUser.isAnonymous = false;
    this.authListeners.forEach(cb => cb(this.currentUser));
    return this.currentUser;
  }

  async signOut() {
    if (this.isConfigured && this.auth) {
      await this.auth.signOut();
    }
    localStorage.removeItem('lockedin_is_verified');
    this.setupLocalFallbackUser();
  }

  // User Profile
  async updateUserProfile(profile) {
    if (!this.currentUser) return;
    const uid = this.currentUser.uid;
    const updated = {
      uid,
      displayName: profile.displayName || this.currentUser.displayName || 'Scholar',
      callSign: profile.callSign || profile.displayName || this.currentUser.callSign || 'Scholar',
      subjectGoal: profile.subjectGoal || 'Deep Focus',
      totalPoints: profile.totalPoints !== undefined ? profile.totalPoints : 150,
      cleanStudyMinutes: profile.cleanStudyMinutes || 0,
      shameCount: profile.shameCount || 0,
      topTrigger: profile.topTrigger || 'None',
      level: profile.level || 1,
      xp: profile.xp || 0,
      coins: profile.coins || 50,
      dailyStreak: profile.dailyStreak || 1,
      lastStudyDate: profile.lastStudyDate || new Date().toISOString().slice(0, 10),
      unlockedBadges: profile.unlockedBadges || ['pioneer'],
      isVerified: !!this.currentUser.isVerified,
      updatedAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };

    localStorage.setItem('lockedin_profile_' + uid, JSON.stringify(updated));
    localStorage.setItem('lockedin_display_name', updated.callSign);
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

  // =========================================================
  // ROOM CREATION & LIVE LOBBY REFRESH
  // =========================================================

  // Create room immediately with Firestore confirmation
  async createRoom(roomData) {
    const roomId = String(roomData.roomId).trim().toUpperCase();
    const title = roomData.title || roomId;
    const sector = roomData.sector || 'stem';
    const hostUid = this.currentUser ? this.currentUser.uid : 'anon_host';

    const payload = {
      roomId: roomId,
      title: title,
      name: title,
      sector: sector,
      hostUid: hostUid,
      hostId: hostUid,
      activeCount: 1,
      participantCount: 1,
      timerState: {
        mode: 'POMODORO',
        duration: (roomData.focusMinutes || 25) * 60,
        startedAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : null,
        isPaused: false
      },
      createdAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date(),
      lastPing: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date(),
      updatedAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };

    if (this.isConfigured && this.db) {
      const roomRef = this.db.collection('rooms').doc(roomId);
      await roomRef.set(payload, { merge: true });
      console.log('[Firebase] Room created in Firestore:', roomId);
      return payload;
    }

    // Local storage fallback for instant demo/multi-tab testing
    try {
      const localRooms = JSON.parse(localStorage.getItem('lockedin_active_rooms') || '[]');
      const idx = localRooms.findIndex(r => r.roomId === roomId || r.id === roomId);
      const entry = { ...payload, id: roomId };
      if (idx >= 0) localRooms[idx] = entry;
      else localRooms.unshift(entry);
      localStorage.setItem('lockedin_active_rooms', JSON.stringify(localRooms));
      this.getChannel('global_lobby').postMessage({ type: 'ROOM_CREATED', room: entry });
    } catch (e) {}

    return payload;
  }

  // Heartbeat ping room every 15s while active
  async pingRoom(roomId, activeCount = 1) {
    if (!roomId) return;
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('rooms').doc(cleanRoom).set({
          lastPing: window.firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          activeCount: Math.max(1, activeCount),
          participantCount: Math.max(1, activeCount)
        }, { merge: true });
      } catch (e) {
        console.warn('[Firebase] pingRoom error:', e);
      }
    } else {
      // Local ping
      try {
        const localRooms = JSON.parse(localStorage.getItem('lockedin_active_rooms') || '[]');
        const idx = localRooms.findIndex(r => r.roomId === cleanRoom || r.id === cleanRoom);
        if (idx >= 0) {
          localRooms[idx].lastPing = Date.now();
          localRooms[idx].activeCount = activeCount;
          localStorage.setItem('lockedin_active_rooms', JSON.stringify(localRooms));
        }
      } catch (e) {}
    }
  }

  // Listen to active rooms (filtered lastPing < 60s)
  listenToActiveRooms(callback) {
    if (this.isConfigured && this.db) {
      return this.db.collection('rooms').onSnapshot((snapshot) => {
        const rooms = [];
        const now = Date.now();
        snapshot.forEach(doc => {
          const data = doc.data();
          const rId = data.roomId || doc.id;
          const lastPingMs = data.lastPing?.toMillis ? data.lastPing.toMillis() : (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : now);
          // Keep rooms pinged within last 60 seconds (or standard Main Hall)
          if (now - lastPingMs <= 60000 || rId === 'MAIN-STUDY-HALL') {
            rooms.push({ ...data, roomId: rId, id: rId });
          }
        });
        callback(rooms);
      }, (err) => {
        console.warn('[Firebase] listenToActiveRooms error:', err);
      });
    }

    // Local / BroadcastChannel listener fallback
    const ch = this.getChannel('global_lobby');
    const updateLocal = () => {
      const rooms = this.getLocalActiveRooms();
      callback(rooms);
    };
    ch.onmessage = () => updateLocal();
    updateLocal();
    return () => {};
  }

  getLocalActiveRooms() {
    try {
      const localRooms = JSON.parse(localStorage.getItem('lockedin_active_rooms') || '[]');
      const now = Date.now();
      return localRooms.filter(r => {
        const ping = (typeof r.lastPing === 'number') ? r.lastPing : now;
        return (now - ping <= 60000) || r.id === 'MAIN-STUDY-HALL';
      });
    } catch (e) {
      return [];
    }
  }

  // Instant getDocs fetch for manual refresh button with spinning animation
  async getActiveRoomsOnce() {
    if (this.isConfigured && this.db) {
      const snap = await this.db.collection('rooms').get();
      const rooms = [];
      const now = Date.now();
      snap.forEach(doc => {
        const data = doc.data();
        const rId = data.roomId || doc.id;
        const lastPingMs = data.lastPing?.toMillis ? data.lastPing.toMillis() : (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : now);
        if (now - lastPingMs <= 60000 || rId === 'MAIN-STUDY-HALL') {
          rooms.push({ ...data, roomId: rId, id: rId });
        }
      });
      return rooms;
    }
    return this.getLocalActiveRooms();
  }

  // =========================================================
  // PEER-PAIR SIGNALING & PRESENCE ARCHITECTURE
  // =========================================================

  // Participant Presence
  async setParticipantPresence(roomId, peerId, data) {
    if (!roomId || !peerId) return;
    const cleanRoom = String(roomId).trim().toUpperCase();
    const payload = {
      peerId: peerId,
      callSign: data.callSign || data.displayName || 'Scholar',
      displayName: data.callSign || data.displayName || 'Scholar',
      cameraMode: data.cameraMode || 'dual',
      isVerified: !!data.isVerified,
      userId: this.currentUser ? this.currentUser.uid : peerId,
      status: 'LOCKED_IN',
      isHandRaised: false,
      timerRemaining: 1500,
      joinedAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date(),
      lastSeen: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date()
    };

    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('rooms').doc(cleanRoom).collection('participants').doc(peerId).set(payload, { merge: true });
      } catch (e) {
        console.warn('[Firebase] setParticipantPresence fail:', e);
      }
    } else {
      // Local BroadcastChannel presence
      this.getChannel('room_' + cleanRoom).postMessage({
        type: 'PRESENCE_JOIN',
        participant: payload
      });
    }
  }

  async removeParticipantPresence(roomId, peerId) {
    if (!roomId || !peerId) return;
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('rooms').doc(cleanRoom).collection('participants').doc(peerId).delete();
      } catch (e) {}
    } else {
      this.getChannel('room_' + cleanRoom).postMessage({
        type: 'PRESENCE_LEAVE',
        peerId: peerId
      });
    }
  }

  listenToParticipants(roomId, callback) {
    if (!roomId) return () => {};
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      return this.db.collection('rooms').doc(cleanRoom).collection('participants').onSnapshot((snapshot) => {
        const list = [];
        snapshot.forEach(doc => list.push(doc.data()));
        callback(list);
      }, (err) => {
        console.warn('[Firebase] listenToParticipants error:', err);
      });
    }

    // Local presence tracker
    const participants = new Map();
    const ch = this.getChannel('room_' + cleanRoom);
    const handler = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'PRESENCE_JOIN' && msg.participant) {
        participants.set(msg.participant.peerId, msg.participant);
        callback(Array.from(participants.values()));
      } else if (msg.type === 'PRESENCE_LEAVE' && msg.peerId) {
        participants.delete(msg.peerId);
        callback(Array.from(participants.values()));
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }

  // Peer-Pair Connections: rooms/{roomId}/connections/{smallerId}_{largerId}
  async writeConnectionOffer(roomId, connectionId, offerData) {
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      await this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).set({
        ...offerData,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      this.getChannel('conn_' + cleanRoom + '_' + connectionId).postMessage({
        type: 'OFFER',
        data: offerData
      });
    }
  }

  async writeConnectionAnswer(roomId, connectionId, answerData) {
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      await this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).set({
        ...answerData,
        answeredAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      this.getChannel('conn_' + cleanRoom + '_' + connectionId).postMessage({
        type: 'ANSWER',
        data: answerData
      });
    }
  }

  listenToConnection(roomId, connectionId, callback) {
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      return this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).onSnapshot((doc) => {
        if (doc.exists) callback(doc.data());
      }, (err) => {
        console.warn('[Firebase] listenToConnection error:', err);
      });
    }

    const ch = this.getChannel('conn_' + cleanRoom + '_' + connectionId);
    const handler = (e) => {
      const msg = e.data;
      if (msg && msg.data) callback(msg.data);
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }

  async addIceCandidate(roomId, connectionId, type, candidate) {
    if (!roomId || !connectionId || !candidate) return;
    const cleanRoom = String(roomId).trim().toUpperCase();
    const candJson = candidate.toJSON ? candidate.toJSON() : JSON.parse(JSON.stringify(candidate));

    if (this.isConfigured && this.db) {
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
    } else {
      this.getChannel('cand_' + cleanRoom + '_' + connectionId).postMessage({
        type: type,
        candidate: candJson
      });
    }
  }

  listenToIceCandidates(roomId, connectionId, type, callback) {
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
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

    const ch = this.getChannel('cand_' + cleanRoom + '_' + connectionId);
    const handler = (e) => {
      const msg = e.data;
      if (msg && msg.type === type && msg.candidate) {
        callback(msg.candidate);
      }
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }

  async cleanupConnection(roomId, connectionId) {
    if (!roomId || !connectionId) return;
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('rooms').doc(cleanRoom).collection('connections').doc(connectionId).delete();
      } catch (e) {}
    }
  }

  // BroadcastChannel helper for zero-config multi-tab local signaling
  getChannel(name) {
    if (!this.broadcastChannels.has(name)) {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannels.set(name, new BroadcastChannel('lockedin_' + name));
      } else {
        // Mock channel if BroadcastChannel is unsupported
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
    if (!roomId || !event) return;
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('rooms').doc(cleanRoom).collection('events').add({
          ...event,
          timestamp: window.firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn('[Firebase] Broadcast event cloud fail:', err);
      }
    } else {
      this.getChannel('events_' + cleanRoom).postMessage(event);
    }
  }

  listenToRoomEvents(roomId, onEvent) {
    if (!roomId) return () => {};
    const cleanRoom = String(roomId).trim().toUpperCase();
    if (this.isConfigured && this.db) {
      const now = new Date();
      return this.db.collection('rooms').doc(cleanRoom)
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
    }

    const ch = this.getChannel('events_' + cleanRoom);
    const handler = (e) => onEvent(e.data);
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
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

  // =========================================================
  // Peer Doubt Board (Community Questions & Answers)
  // =========================================================
  async createDoubt({ subject, questionText, imageUrl = '', bountyCoins = 20 }) {
    const authorUid = this.currentUser ? this.currentUser.uid : 'anon_' + Date.now();
    const authorCallSign = (this.currentUser && this.currentUser.callSign) || localStorage.getItem('lockedin_display_name') || 'Scholar';
    const doubtId = 'd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const doubtData = {
      doubtId,
      authorUid,
      authorCallSign,
      subject: subject || 'General Study',
      questionText: questionText.trim(),
      imageUrl: imageUrl || '',
      bountyCoins: bountyCoins || 20,
      status: 'OPEN',
      createdAt: (this.isConfigured && window.firebase) ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now(),
      updatedAt: (this.isConfigured && window.firebase) ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now()
    };

    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('doubts').doc(doubtId).set(doubtData);
        return doubtId;
      } catch (err) {
        console.warn('[Firebase] Create doubt error:', err);
      }
    }

    // Local fallback
    try {
      const doubts = JSON.parse(localStorage.getItem('lockedin_local_doubts') || '[]');
      doubts.unshift({ ...doubtData, createdAt: Date.now(), updatedAt: Date.now() });
      localStorage.setItem('lockedin_local_doubts', JSON.stringify(doubts.slice(0, 50)));
      const ch = this.getChannel('doubts_global');
      ch.postMessage({ type: 'DOUBT_CREATED', doubt: doubtData });
    } catch (e) {}
    return doubtId;
  }

  listenToDoubts(callback) {
    if (this.isConfigured && this.db) {
      return this.db.collection('doubts')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .onSnapshot((snapshot) => {
          const list = [];
          snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
          callback(list);
        }, (err) => {
          console.warn('[Firebase] Doubts listener error:', err);
        });
    }

    // Local fallback
    const loadLocal = () => {
      try {
        const doubts = JSON.parse(localStorage.getItem('lockedin_local_doubts') || '[]');
        callback(doubts);
      } catch (e) {
        callback([]);
      }
    };
    loadLocal();
    const ch = this.getChannel('doubts_global');
    const handler = () => loadLocal();
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }

  async addDoubtAnswer(doubtId, answerText) {
    const authorUid = this.currentUser ? this.currentUser.uid : 'anon_' + Date.now();
    const authorCallSign = (this.currentUser && this.currentUser.callSign) || localStorage.getItem('lockedin_display_name') || 'Scholar';
    const answerId = 'a_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const answerData = {
      answerId,
      doubtId,
      authorUid,
      authorCallSign,
      answerText: answerText.trim(),
      createdAt: (this.isConfigured && window.firebase) ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now(),
      isAccepted: false
    };

    if (this.isConfigured && this.db) {
      try {
        await this.db.collection('doubts').doc(doubtId).collection('answers').doc(answerId).set(answerData);
        return answerId;
      } catch (err) {
        console.warn('[Firebase] Add answer error:', err);
      }
    }

    // Local fallback
    try {
      const key = `lockedin_doubt_answers_${doubtId}`;
      const answers = JSON.parse(localStorage.getItem(key) || '[]');
      answers.push({ ...answerData, createdAt: Date.now() });
      localStorage.setItem(key, JSON.stringify(answers));
      const ch = this.getChannel('doubts_global');
      ch.postMessage({ type: 'ANSWER_ADDED', doubtId, answer: answerData });
    } catch (e) {}
    return answerId;
  }

  listenToDoubtAnswers(doubtId, callback) {
    if (this.isConfigured && this.db) {
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

    // Local fallback
    const key = `lockedin_doubt_answers_${doubtId}`;
    const loadLocal = () => {
      try {
        const answers = JSON.parse(localStorage.getItem(key) || '[]');
        callback(answers);
      } catch (e) {
        callback([]);
      }
    };
    loadLocal();
    const ch = this.getChannel('doubts_global');
    const handler = (e) => {
      if (e.data && e.data.doubtId === doubtId) loadLocal();
    };
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }

  async acceptDoubtAnswer(doubtId, answerId, solverUid) {
    if (this.isConfigured && this.db) {
      try {
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
      } catch (err) {
        console.warn('[Firebase] Accept answer error:', err);
      }
    }

    // Local fallback
    try {
      const doubts = JSON.parse(localStorage.getItem('lockedin_local_doubts') || '[]');
      const d = doubts.find(x => x.doubtId === doubtId);
      if (d) {
        d.status = 'RESOLVED';
        d.acceptedAnswerId = answerId;
        d.solverUid = solverUid;
        localStorage.setItem('lockedin_local_doubts', JSON.stringify(doubts));
      }
      const key = `lockedin_doubt_answers_${doubtId}`;
      const answers = JSON.parse(localStorage.getItem(key) || '[]');
      const a = answers.find(x => x.answerId === answerId);
      if (a) {
        a.isAccepted = true;
        localStorage.setItem(key, JSON.stringify(answers));
      }
      const ch = this.getChannel('doubts_global');
      ch.postMessage({ type: 'ANSWER_ACCEPTED', doubtId, answerId, solverUid });
    } catch (e) {}
    return true;
  }
}

// Global instance
window.FirebaseSync = new FirebaseManager();
