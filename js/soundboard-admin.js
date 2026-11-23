/**
 * LOCKED-IN: Soundboard Admin Studio & Audio Engine
 * Manages audio triggers, 25 sound slots, Web Audio API synthesizers,
 * IndexedDB storage, URL overrides, and Admin authentication.
 */

// Master List of 25 Accountability Triggers
const TRIGGER_DEFINITIONS = [
  // Group A: Device & Browser Discipline Triggers (Automatic)
  {
    id: 'CAM_OFF_MID_SESSION',
    name: 'Camera Turned Off',
    group: 'Device & Browser',
    desc: 'Turning off camera during an active focus block.',
    penalty: 20,
    synthType: 'alarm'
  },
  {
    id: 'SCREEN_OFF_MID_SESSION',
    name: 'Screen Share Stopped',
    group: 'Device & Browser',
    desc: 'Stopping screen share during dual-feed focus session.',
    penalty: 20,
    synthType: 'glitch'
  },
  {
    id: 'TAB_SWITCH_HIDDEN',
    name: 'Tab Switched / App Minimized',
    group: 'Device & Browser',
    desc: 'Switching browser tabs or minimizing the accountability app.',
    penalty: 20,
    synthType: 'siren'
  },
  {
    id: 'WINDOW_SPLIT_RESIZED',
    name: 'Split Window / Resized Below 55%',
    group: 'Device & Browser',
    desc: 'Shrinking browser window below 55% screen width/height to hide distracting apps.',
    penalty: 20,
    synthType: 'buzz'
  },
  {
    id: 'MIC_LEFT_UNMUTED',
    name: 'Mic Left Unmuted > 20s',
    group: 'Device & Browser',
    desc: 'Leaving quick-unmute active for more than 20 seconds during focus block.',
    penalty: 20,
    synthType: 'warning_beep'
  },
  {
    id: 'MIC_NOISE_SPIKE',
    name: 'Sustained Background Noise / Music',
    group: 'Device & Browser',
    desc: 'Sustained loud audio, chatter, or music above decibel limit during focus time.',
    penalty: 20,
    synthType: 'static_burst'
  },
  {
    id: 'SCREEN_FROZEN_IDLE',
    name: 'Screen Frozen / Static > 10m',
    group: 'Device & Browser',
    desc: 'Screen share pixel-diff shows 100% frozen/static screen for over 10 minutes.',
    penalty: 20,
    synthType: 'freeze'
  },
  {
    id: 'INPUT_DEAD_IDLE',
    name: 'Zero Input / AFK > 12m',
    group: 'Device & Browser',
    desc: 'Zero mouse, touch, or keyboard activity for over 12 minutes during screen share.',
    penalty: 20,
    synthType: 'snore'
  },

  // Group B: On-Device Camera AI Triggers (MediaPipe + COCO-SSD + Motion)
  {
    id: 'FACE_MISSING',
    name: 'Left Desk / No Face Found > 10s',
    group: 'On-Device AI',
    desc: 'No face detected in camera frame for more than 10 seconds.',
    penalty: 20,
    synthType: 'fail_horn'
  },
  {
    id: 'FACE_HALF_HIDDEN',
    name: 'Half Face Hiding / Ceiling Cam',
    group: 'On-Device AI',
    desc: 'Face landmarks cropped at frame edge or camera pointed at ceiling/forehead.',
    penalty: 20,
    synthType: 'slap'
  },
  {
    id: 'FACE_TOO_FAR',
    name: 'Leaning Far Back / Slouching on Bed',
    group: 'On-Device AI',
    desc: 'Face area drops below threshold (leaning too far back from study desk).',
    penalty: 20,
    synthType: 'descend_whistle'
  },
  {
    id: 'SECOND_PHONE_DETECTED',
    name: 'Cell Phone Detected in Hand',
    group: 'On-Device AI',
    desc: 'AI vision model spotted a smartphone held in the study area.',
    penalty: 20,
    synthType: 'police_siren'
  },
  {
    id: 'PROP_PHONE_PICKED_UP',
    name: 'Propped Phone Picked Up',
    group: 'On-Device AI',
    desc: 'Gyroscope/accelerometer spike or frame shake indicating phone was picked up.',
    penalty: 20,
    synthType: 'bonk'
  },
  {
    id: 'HEAD_DOWN_SLEEPING',
    name: 'Head Down / Sleeping on Desk',
    group: 'On-Device AI',
    desc: 'Head pitch angled sharply down for over 20 seconds.',
    penalty: 20,
    synthType: 'airhorn'
  },
  {
    id: 'LOOKING_AWAY_PROLONGED',
    name: 'Looking Away from Desk > 15s',
    group: 'On-Device AI',
    desc: 'Head yaw turned > 35 degrees away from study materials for > 15 seconds.',
    penalty: 20,
    synthType: 'gentle_chime'
  },
  {
    id: 'MULTIPLE_FACES_CHATTING',
    name: 'Multiple Faces / Socializing',
    group: 'On-Device AI',
    desc: 'Two or more faces detected in camera frame for > 10 seconds.',
    penalty: 20,
    synthType: 'shhh'
  },

  // Group C: Peer-to-Peer "Snitch & Accountability" Triggers (Social)
  {
    id: 'PEER_NON_STUDY_CONTENT',
    name: 'Peer Callout: Non-Study Content',
    group: 'Peer Accountability',
    desc: 'Peer spotted YouTube, Instagram, anime, or video games on screen.',
    penalty: 25,
    synthType: 'bruh'
  },
  {
    id: 'PEER_DOOMSCROLLING',
    name: 'Peer Callout: Doomscrolling',
    group: 'Peer Accountability',
    desc: 'Peer caught rapid vertical social media scrolling.',
    penalty: 25,
    synthType: 'clown'
  },
  {
    id: 'PEER_ON_PHONE',
    name: 'Peer Callout: Off-Camera Texting',
    group: 'Peer Accountability',
    desc: 'Peer spotted covert phone texting or messaging.',
    penalty: 25,
    synthType: 'wasted'
  },
  {
    id: 'PEER_ZONING_OUT',
    name: 'Peer Callout: Blank Stare / Zoning Out',
    group: 'Peer Accountability',
    desc: 'Peer noticed glazed eyes and lack of focus.',
    penalty: 25,
    synthType: 'drumroll_rimshot'
  },
  {
    id: 'PEER_WAKE_UP_NUDGE',
    name: 'Peer Callout: Wake Up Nudge!',
    group: 'Peer Accountability',
    desc: 'Friendly peer nudge to snap back to focus.',
    penalty: 25,
    synthType: 'alarm'
  },

  // Group D: Session, Admin & Milestone Triggers
  {
    id: 'RAGE_QUIT_EARLY',
    name: 'Rage Quit / Left Session Early',
    group: 'Session & Admin',
    desc: 'Exiting or closing study room with focus timer still running.',
    penalty: 40,
    synthType: 'sad_trombone'
  },
  {
    id: 'LATE_BREAK_RETURN',
    name: 'Break Overstayed (> 60s Late)',
    group: 'Session & Admin',
    desc: 'Failing to resume focus within 60s after break timer expired.',
    penalty: 20,
    synthType: 'ticking_bomb'
  },
  {
    id: 'ADMIN_INSTANT_SMITE',
    name: 'Admin Instant Smite',
    group: 'Session & Admin',
    desc: 'Room moderator caught direct study violation.',
    penalty: 40,
    synthType: 'thunder'
  },
  {
    id: 'FOCUS_BLOCK_VICTORY',
    name: 'Focus Block Victory (Zero Violations)',
    group: 'Session & Admin',
    desc: 'Completed a full focus block with 0 triggers fired. Well done!',
    penalty: -25, // Award points!
    synthType: 'victory_fanfare'
  }
];

class SoundboardManager {
  constructor() {
    this.audioContext = null;
    this.db = null;
    this.soundConfigs = {}; // triggerId -> { url, blob, volume }
    this.lastSoundTime = 0;
    this.cooldownMs = 8000; // 8s global cooldown
    this.isMuted = false;
    this.adminPin = localStorage.getItem('lockedin_admin_pin') || '2027';
    this.isAdminAuthenticated = false;

    this.initAudioContext();
    this.initIndexedDB().then(() => {
      this.loadAllSounds();
    });
  }

  initAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    } catch (e) {
      console.warn('[Audio] Web Audio API init error:', e);
    }
  }

  ensureAudioResumed() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  // IndexedDB Setup for persistent custom sounds (< 800KB each)
  initIndexedDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve();
        return;
      }
      const request = window.indexedDB.open('LockedInSoundboardDB', 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('sounds')) {
          db.createObjectStore('sounds', { keyPath: 'triggerId' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = () => {
        console.warn('[IndexedDB] Sound DB failed to open.');
        resolve();
      };
    });
  }

  async loadAllSounds() {
    // Load URL and volume settings from localStorage
    try {
      const stored = localStorage.getItem('lockedin_sound_configs');
      if (stored) {
        this.soundConfigs = JSON.parse(stored);
      }
    } catch (e) {
      this.soundConfigs = {};
    }

    // Load any binary audio blobs stored in IndexedDB
    if (this.db) {
      try {
        const tx = this.db.transaction('sounds', 'readonly');
        const store = tx.objectStore('sounds');
        const req = store.getAll();
        req.onsuccess = () => {
          if (req.result) {
            req.result.forEach(item => {
              if (item && item.triggerId) {
                if (!this.soundConfigs[item.triggerId]) {
                  this.soundConfigs[item.triggerId] = {};
                }
                this.soundConfigs[item.triggerId].blob = item.audioBlob;
                this.soundConfigs[item.triggerId].fileName = item.fileName;
              }
            });
          }
        };
      } catch (err) {
        console.warn('[IndexedDB] Error loading sounds from DB:', err);
      }
    }
  }

  async saveSoundSlot(triggerId, { url, blob, fileName, volume }) {
    if (!this.soundConfigs[triggerId]) {
      this.soundConfigs[triggerId] = {};
    }

    if (volume !== undefined) this.soundConfigs[triggerId].volume = volume;
    if (url !== undefined) this.soundConfigs[triggerId].url = url;

    // Save metadata in localStorage (without large binary blob)
    const exportable = {};
    for (const [key, val] of Object.entries(this.soundConfigs)) {
      exportable[key] = {
        url: val.url || '',
        fileName: val.fileName || '',
        volume: val.volume !== undefined ? val.volume : 80
      };
    }
    localStorage.setItem('lockedin_sound_configs', JSON.stringify(exportable));

    // Save blob in IndexedDB
    if (blob && this.db) {
      try {
        this.soundConfigs[triggerId].blob = blob;
        this.soundConfigs[triggerId].fileName = fileName;
        const tx = this.db.transaction('sounds', 'readwrite');
        const store = tx.objectStore('sounds');
        store.put({
          triggerId,
          audioBlob: blob,
          fileName,
          updatedAt: Date.now()
        });
      } catch (e) {
        console.warn('[IndexedDB] Failed to save blob:', e);
      }
    }
  }

  async clearSoundSlot(triggerId) {
    if (this.soundConfigs[triggerId]) {
      delete this.soundConfigs[triggerId];
    }
    const exportable = {};
    for (const [key, val] of Object.entries(this.soundConfigs)) {
      exportable[key] = {
        url: val.url || '',
        fileName: val.fileName || '',
        volume: val.volume !== undefined ? val.volume : 80
      };
    }
    localStorage.setItem('lockedin_sound_configs', JSON.stringify(exportable));

    if (this.db) {
      try {
        const tx = this.db.transaction('sounds', 'readwrite');
        tx.objectStore('sounds').delete(triggerId);
      } catch (e) {}
    }
  }

  // Play Sound with Cooldown & Fallback
  async playTrigger(triggerId, forcePlay = false) {
    if (this.isMuted) return;

    const now = Date.now();
    if (!forcePlay && (now - this.lastSoundTime < this.cooldownMs)) {
      console.log(`[Audio] Cooldown active (${Math.round((this.cooldownMs - (now - this.lastSoundTime)) / 1000)}s left). Skipping sound.`);
      return;
    }

    this.lastSoundTime = now;
    this.ensureAudioResumed();

    const conf = this.soundConfigs[triggerId] || {};
    const volume = (conf.volume !== undefined ? conf.volume : 80) / 100;

    // 1. Try playing custom uploaded blob
    if (conf.blob) {
      try {
        const url = URL.createObjectURL(conf.blob);
        const audio = new Audio(url);
        audio.volume = Math.max(0, Math.min(1, volume));
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        return;
      } catch (err) {
        console.warn('[Audio] Failed playing custom blob, trying fallback:', err);
      }
    }

    // 2. Try playing direct URL
    if (conf.url && conf.url.trim().length > 0) {
      try {
        const audio = new Audio(conf.url.trim());
        audio.volume = Math.max(0, Math.min(1, volume));
        await audio.play();
        return;
      } catch (err) {
        console.warn('[Audio] Failed playing audio URL, using synth fallback:', err);
      }
    }

    // 3. Built-in Web Audio API Synthesizer Fallback
    this.playSynthesizedTone(triggerId, volume);
  }

  // Built-in Synthesizer Fallback: Zero network required, instant playback!
  playSynthesizedTone(triggerId, volume = 0.8) {
    if (!this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const triggerDef = TRIGGER_DEFINITIONS.find(t => t.id === triggerId);
    const synthType = triggerDef ? triggerDef.synthType : 'alarm';

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume * 0.4, now);
    masterGain.connect(ctx.destination);

    switch (synthType) {
      case 'alarm':
      case 'warning_beep': {
        // High-pitched double alarm beep
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(440, now + 0.15);
        osc.frequency.setValueAtTime(880, now + 0.3);
        osc.frequency.setValueAtTime(440, now + 0.45);
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.6);
        break;
      }

      case 'police_siren':
      case 'siren': {
        // Rising and falling siren
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.35);
        osc.frequency.linearRampToValueAtTime(600, now + 0.7);
        osc.frequency.linearRampToValueAtTime(1200, now + 1.05);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 1.3);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 1.3);
        break;
      }

      case 'fail_horn':
      case 'sad_trombone': {
        // Wah-wah sad trombone descent
        [300, 280, 260, 220].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, now + idx * 0.28);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.7, now + idx * 0.28);
          g.gain.exponentialRampToValueAtTime(0.01, now + (idx + 1) * 0.28);
          osc.connect(g);
          g.connect(masterGain);
          osc.start(now + idx * 0.28);
          osc.stop(now + (idx + 1) * 0.28);
        });
        break;
      }

      case 'airhorn': {
        // Piercing brassy airhorn triad
        [466.16, 587.33, 700].forEach(freq => {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, now);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.5, now);
          g.gain.linearRampToValueAtTime(0.01, now + 0.8);
          osc.connect(g);
          g.connect(masterGain);
          osc.start(now);
          osc.stop(now + 0.8);
        });
        break;
      }

      case 'bonk':
      case 'slap': {
        // Metallic wooden pop/bonk
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.18);
        const g = ctx.createGain();
        g.gain.setValueAtTime(1, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }

      case 'victory_fanfare': {
        // Uplifting major chord arpeggio
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.8, now + idx * 0.12);
          g.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.6);
          osc.connect(g);
          g.connect(masterGain);
          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.6);
        });
        break;
      }

      case 'buzz':
      default: {
        // Low distorted buzzer
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(120, now);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.8, now);
        g.gain.linearRampToValueAtTime(0.01, now + 0.5);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.5);
        break;
      }
    }
  }

  // Admin PIN Authentication
  verifyAdminPin(enteredPin) {
    if (enteredPin === this.adminPin) {
      this.isAdminAuthenticated = true;
      return true;
    }
    return false;
  }

  changeAdminPin(oldPin, newPin) {
    if (oldPin === this.adminPin && newPin && newPin.length >= 4) {
      this.adminPin = newPin;
      localStorage.setItem('lockedin_admin_pin', newPin);
      return true;
    }
    return false;
  }
}

// Global Soundboard instance
window.Soundboard = new SoundboardManager();
window.TRIGGER_DEFINITIONS = TRIGGER_DEFINITIONS;
