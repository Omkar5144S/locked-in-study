/**
 * LOCKED-IN: Distraction Trigger Engine (All 25 Triggers)
 * Features:
 * - 5-Second Anti-False-Positive Grace Countdown
 * - Audio decibel monitoring & 20s mic auto-mute warning
 * - Browser visibility & split-screen detection
 * - DeviceMotion & frame-diff shake detection
 * - COCO-SSD AI cell phone detection (throttled every 2.5s)
 * - Face presence / posture / multiple faces tracking
 * - Peer vote collection & consensus (2 votes in 8-person room, 1 in 2-person, 1 for Admin)
 * - Shame slap, Red X timer strike, and soundboard broadcast
 */

class TriggerEngine {
  constructor() {
    this.isActive = false;
    this.currentGraceTimer = null;
    this.activeGraceTrigger = null;
    this.graceSecondsRemaining = 5;

    // AI Models
    this.cocoModel = null;
    this.isAiLoading = false;
    this.aiDetectionInterval = null;

    // Monitoring State
    this.audioAnalyser = null;
    this.audioDataArray = null;
    this.micMonitoringInterval = null;
    this.loudNoiseDurationSec = 0;
    this.micUnmutedDurationSec = 0;

    this.motionLastTimestamp = 0;
    this.motionShakeCount = 0;

    this.lastInputTime = Date.now();
    this.lastScreenDiffTime = Date.now();
    this.staticScreenDurationMs = 0;
    this.lastScreenFrameData = null;

    // Face Tracking Metrics
    this.missingFaceDurationSec = 0;
    this.headDownDurationSec = 0;
    this.lookingAwayDurationSec = 0;
    this.multipleFacesDurationSec = 0;

    // Peer votes tracker: { targetUserId: { triggerId: Set([voterUid]) } }
    this.peerVotes = {};

    // Dynamic Shame Redemption Tracking
    this.isCurrentlyShamed = false;
    this.shameCleanSeconds = 0;
    this.isTabBlockerEnabled = localStorage.getItem('lockedin_tab_blocker_enabled') !== 'false';

    this.initEventListeners();
  }

  setTabBlockerEnabled(enabled) {
    this.isTabBlockerEnabled = !!enabled;
    localStorage.setItem('lockedin_tab_blocker_enabled', this.isTabBlockerEnabled ? 'true' : 'false');
  }

  initEventListeners() {
    // 1. Tab visibility change (TAB_SWITCH_HIDDEN)
    document.addEventListener('visibilitychange', () => {
      if (!this.isFocusActive()) return;
      if (!this.isTabBlockerEnabled) return;
      if (document.hidden) {
        this.triggerCandidate('TAB_SWITCH_HIDDEN', 'You switched browser tabs or minimized the app!');
      }
    });

    // 2. Window resizing (WINDOW_SPLIT_RESIZED)
    window.addEventListener('resize', () => {
      if (!this.isFocusActive()) return;
      if (window.screen && window.screen.width) {
        const widthRatio = window.innerWidth / window.screen.width;
        const heightRatio = window.innerHeight / window.screen.height;
        if (widthRatio < 0.54 || heightRatio < 0.54) {
          this.triggerCandidate('WINDOW_SPLIT_RESIZED', 'Browser window was resized below 55% screen area!');
        }
      }
    });

    // 3. Activity tracking (INPUT_DEAD_IDLE)
    const resetInputTimer = () => {
      this.lastInputTime = Date.now();
    };
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
      window.addEventListener(evt, resetInputTimer, { passive: true });
    });

    // 4. Device motion / phone pickup (PROP_PHONE_PICKED_UP)
    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', (e) => {
        if (!this.isFocusActive()) return;
        const acc = e.accelerationIncludingGravity || e.acceleration;
        if (!acc) return;
        const total = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
        // Normal gravity is ~9.8. Sudden pickup causes spikes > 16.5 or < 3
        if (total > 17.5 || total < 2.5) {
          const now = Date.now();
          if (now - this.motionLastTimestamp < 2500) {
            this.motionShakeCount++;
            if (this.motionShakeCount >= 2) {
              this.triggerCandidate('PROP_PHONE_PICKED_UP', 'Propped study phone was picked up or moved!');
              this.motionShakeCount = 0;
            }
          } else {
            this.motionShakeCount = 1;
          }
          this.motionLastTimestamp = now;
        }
      }, { passive: true });
    }

    // 5. Early exit / rage quit alert
    window.addEventListener('beforeunload', (e) => {
      if (this.isFocusActive() && window.StudyTimer && window.StudyTimer.secondsLeft > 120) {
        // Fire rage quit penalty
        if (window.Leaderboard) {
          window.Leaderboard.penalizeTrigger('RAGE_QUIT_EARLY', 40);
        }
      }
    });
  }

  isFocusActive() {
    const studyView = document.getElementById('study-room-view');
    const inStudyRoom = studyView && !studyView.classList.contains('hidden');
    if (!this.isActive || !inStudyRoom) return false;

    // ONLY fire triggers when the Pomodoro timer is actively counting down in FOCUS mode.
    // If idle, paused, stopped, or on a break — disable all distraction detection.
    if (!window.StudyTimer || !window.StudyTimer.isRunning) return false;
    if (String(window.StudyTimer.mode || '').toUpperCase() !== 'FOCUS') return false;

    return true;
  }

  // Load COCO-SSD for AI Phone Detection
  async loadAiModels() {
    if (this.cocoModel || this.isAiLoading) return;
    this.isAiLoading = true;
    try {
      if (window.cocoSsd) {
        this.cocoModel = await window.cocoSsd.load();
        console.log('[AI] TensorFlow COCO-SSD loaded for cell-phone distraction detection.');
      } else {
        console.log('[AI] COCO-SSD script not loaded yet; will retry on demand.');
      }
    } catch (err) {
      console.warn('[AI] COCO-SSD failed to load:', err);
    } finally {
      this.isAiLoading = false;
    }
  }

  // Start continuous active session monitoring
  startMonitoring({ localVideoEl, screenVideoEl, localAudioStream }) {
    this.isActive = true;
    this.loadAiModels();

    // Setup audio decibel meter
    if (localAudioStream) {
      this.setupAudioMeter(localAudioStream);
    }

    // AI vision & face loop (throttled every 2.5s)
    if (this.aiDetectionInterval) clearInterval(this.aiDetectionInterval);
    this.aiDetectionInterval = setInterval(() => {
      if (!this.isFocusActive()) return;

      // Dynamically locate whichever element currently holds the camera stream
      const camEl = (localVideoEl && localVideoEl.srcObject)
        ? localVideoEl
        : (screenVideoEl && screenVideoEl.srcObject && !window.WebRTCRoom?.isDualFeedActive ? screenVideoEl : document.getElementById('local-cam-video') || document.getElementById('local-screen-video'));

      // 1. Camera turned off check
      if (camEl && camEl.srcObject) {
        const videoTrack = camEl.srcObject.getVideoTracks()[0];
        if (!videoTrack || !videoTrack.enabled || videoTrack.readyState === 'ended') {
          this.triggerCandidate('CAM_OFF_MID_SESSION', 'Camera feed was turned off during focus session!');
        }
      }

      // 2. Screen share stopped check (only when dual-feed screen share is explicitly active)
      if (window.WebRTCRoom && window.WebRTCRoom.isDualFeedActive) {
        if (!screenVideoEl || !screenVideoEl.srcObject) {
          this.triggerCandidate('SCREEN_OFF_MID_SESSION', 'Screen share was stopped during dual-feed session!');
        } else {
          const screenTrack = screenVideoEl.srcObject.getVideoTracks()[0];
          if (!screenTrack || !screenTrack.enabled || screenTrack.readyState === 'ended') {
            this.triggerCandidate('SCREEN_OFF_MID_SESSION', 'Screen share was stopped during dual-feed session!');
          }
        }
      }

      // 3. Zero Input AFK check (> 12 minutes = 720,000ms)
      if (Date.now() - this.lastInputTime > 720000) {
        this.triggerCandidate('INPUT_DEAD_IDLE', 'Zero input / AFK detected for over 12 minutes!');
      }

      // 4. Run AI vision check if camera is active
      if (camEl && camEl.readyState >= 2) {
        this.runAiVisionFrame(camEl);
      }

      // 5. Screen pixel-freeze check (dual feed only)
      if (window.WebRTCRoom && window.WebRTCRoom.isDualFeedActive && screenVideoEl && screenVideoEl.readyState >= 2) {
        this.runScreenDiffCheck(screenVideoEl);
      }
    }, 1500);
  }

  stopMonitoring() {
    this.isActive = false;
    if (this.aiDetectionInterval) clearInterval(this.aiDetectionInterval);
    if (this.micMonitoringInterval) clearInterval(this.micMonitoringInterval);
    this.clearGrace();
  }

  // Audio Decibel and Mic Unmute Monitoring
  setupAudioMeter(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = window.Soundboard ? window.Soundboard.audioContext || new AudioCtx() : new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      this.audioAnalyser = ctx.createAnalyser();
      this.audioAnalyser.fftSize = 256;
      source.connect(this.audioAnalyser);

      const bufferLength = this.audioAnalyser.frequencyBinCount;
      this.audioDataArray = new Uint8Array(bufferLength);

      if (this.micMonitoringInterval) clearInterval(this.micMonitoringInterval);
      this.micMonitoringInterval = setInterval(() => {
        if (!this.isFocusActive() || !this.audioAnalyser) return;

        // Check if mic is unmuted
        const audioTrack = stream.getAudioTracks()[0];
        const isMicUnmuted = audioTrack && audioTrack.enabled;

        if (isMicUnmuted) {
          this.micUnmutedDurationSec += 1;
          if (this.micUnmutedDurationSec > 20) {
            this.triggerCandidate('MIC_LEFT_UNMUTED', 'Microphone was left unmuted for more than 20 seconds!');
            // Auto mute to protect room
            audioTrack.enabled = false;
            this.micUnmutedDurationSec = 0;
          }
        } else {
          this.micUnmutedDurationSec = 0;
        }

        // Noise spike check
        this.audioAnalyser.getByteFrequencyData(this.audioDataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += this.audioDataArray[i];
        }
        const avgDecibel = sum / bufferLength;

        // Threshold around ~65/255 for sustained loud noise
        if (avgDecibel > 68) {
          this.loudNoiseDurationSec += 1;
          if (this.loudNoiseDurationSec >= 4) {
            this.triggerCandidate('MIC_NOISE_SPIKE', 'Sustained background noise or loud chatter detected!');
            this.loudNoiseDurationSec = 0;
          }
        } else {
          this.loudNoiseDurationSec = Math.max(0, this.loudNoiseDurationSec - 0.5);
        }
      }, 1000);
    } catch (e) {
      console.warn('[Audio] Could not setup audio analyser:', e);
    }
  }

  // AI Vision & Object Detection
  async runAiVisionFrame(videoEl) {
    // 1. COCO-SSD Phone Detection
    if (this.cocoModel && !this.isAiLoading) {
      try {
        const predictions = await this.cocoModel.detect(videoEl);
        const phone = predictions.find(p => p.class === 'cell phone' && p.score > 0.52);
        if (phone) {
          this.triggerCandidate('SECOND_PHONE_DETECTED', 'Cell phone spotted in study area by AI vision!');
          return;
        }

        // Check for multiple persons
        const persons = predictions.filter(p => p.class === 'person' && p.score > 0.5);
        if (persons.length >= 2) {
          this.multipleFacesDurationSec += 2.5;
          if (this.multipleFacesDurationSec >= 10) {
            this.triggerCandidate('MULTIPLE_FACES_CHATTING', 'Multiple people detected in frame chatting/distracting!');
            this.multipleFacesDurationSec = 0;
          }
        } else {
          this.multipleFacesDurationSec = 0;
        }

        // Check face missing / leaving desk
        if (persons.length === 0) {
          this.missingFaceDurationSec += 2.5;
          if (this.missingFaceDurationSec >= 10) {
            this.triggerCandidate('FACE_MISSING', 'No student detected at desk for over 10 seconds!');
            this.missingFaceDurationSec = 0;
          }
        } else {
          this.missingFaceDurationSec = 0;
          const mainPerson = persons[0];
          const bbox = mainPerson.bbox; // [x, y, width, height]
          const vidArea = videoEl.videoWidth * videoEl.videoHeight;
          const personArea = (bbox[2] * bbox[3]) / (vidArea || 1);

          // Leaning too far back
          if (personArea < 0.08) {
            this.triggerCandidate('FACE_TOO_FAR', 'Leaning too far back or slouching away from desk!');
          }

          // Cropped half-face / pointing camera at ceiling
          if (bbox[1] <= 5 && bbox[3] < videoEl.videoHeight * 0.4) {
            this.triggerCandidate('FACE_HALF_HIDDEN', 'Camera showing only forehead or ceiling!');
          }
        }
      } catch (e) {
        // AI detection frame error fallback
      }
    } else {
      // Lightweight fallback when COCO-SSD is still downloading
      this.runCanvasBrightnessCheck(videoEl);
    }
  }

  // Canvas Fallback: Dark screen / camera covered check
  runCanvasBrightnessCheck(videoEl) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, 64, 48);
      const imgData = ctx.getImageData(0, 0, 64, 48).data;
      let totalLuma = 0;
      for (let i = 0; i < imgData.length; i += 4) {
        totalLuma += (imgData[i] * 0.299 + imgData[i + 1] * 0.587 + imgData[i + 2] * 0.114);
      }
      const avgLuma = totalLuma / (64 * 48);
      if (avgLuma < 8) {
        // Completely covered black camera
        this.triggerCandidate('FACE_MISSING', 'Camera appears covered or blacked out!');
      }
    } catch (e) {}
  }

  // Screen Frozen Idle Check (> 10m)
  runScreenDiffCheck(screenVideoEl) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 25;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(screenVideoEl, 0, 0, 40, 25);
      const data = ctx.getImageData(0, 0, 40, 25).data;

      if (!this.lastScreenFrameData) {
        this.lastScreenFrameData = data;
        return;
      }

      let diffCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        const diff = Math.abs(data[i] - this.lastScreenFrameData[i]) +
                     Math.abs(data[i + 1] - this.lastScreenFrameData[i + 1]) +
                     Math.abs(data[i + 2] - this.lastScreenFrameData[i + 2]);
        if (diff > 30) diffCount++;
      }

      if (diffCount < 5) {
        // Very little change on screen
        this.staticScreenDurationMs += 2500;
        if (this.staticScreenDurationMs >= 600000) { // 10 minutes
          this.triggerCandidate('SCREEN_FROZEN_IDLE', 'Shared screen has been completely static for 10 minutes!');
          this.staticScreenDurationMs = 0;
        }
      } else {
        this.staticScreenDurationMs = 0;
      }
      this.lastScreenFrameData = data;
    } catch (e) {}
  }

  // ==========================================
  // GRACE PERIOD & SHAME PUNISHMENT PIPELINE
  // ==========================================

  triggerCandidate(triggerId, reasonText) {
    if (!this.isFocusActive()) return;
    if (this.currentGraceTimer) return; // Already in grace countdown

    this.activeGraceTrigger = { id: triggerId, reason: reasonText };
    this.graceSecondsRemaining = 8;

    // Show Grace Banner UI
    const banner = document.getElementById('grace-warning-banner');
    const reasonEl = document.getElementById('grace-warning-reason');
    const countEl = document.getElementById('grace-countdown-num');

    if (banner) {
      if (reasonEl) reasonEl.textContent = reasonText;
      if (countEl) countEl.textContent = '8';
      banner.classList.remove('hidden');
      banner.classList.add('flash-amber');
    }

    // Update local tile HUD status pill
    this.updateLocalTileStatus('GRACE WARNING (8s)', 'status-grace');

    // Beep warning tick
    if (window.Soundboard) {
      window.Soundboard.ensureAudioResumed();
    }

    this.currentGraceTimer = setInterval(() => {
      if (!this.isFocusActive()) {
        this.clearGrace();
        return;
      }
      this.graceSecondsRemaining--;
      if (countEl) countEl.textContent = this.graceSecondsRemaining.toString();

      if (this.graceSecondsRemaining <= 0) {
        this.clearGrace();
        this.executePunishment(triggerId, reasonText);
      }
    }, 1000);
  }

  cancelGraceByFalseAlarm() {
    this.clearGrace();
    this.clearLocalShame('False alarm confirmed');
    console.log('[TriggerEngine] Grace period cancelled by user (False Alarm marked).');
  }

  // Increment clean focus seconds and auto-redeem shame status
  recordCleanSecond() {
    if (!this.isCurrentlyShamed) return;
    this.shameCleanSeconds++;

    // Update remaining countdown on the badge if present
    const localTile = document.getElementById('local-user-tile');
    if (localTile) {
      const hint = localTile.querySelector('.shame-stamp-badge div');
      if (hint) {
        const remaining = Math.max(0, 60 - this.shameCleanSeconds);
        hint.textContent = `Focus cleanly for ${remaining}s to redeem`;
      }
    }

    if (this.shameCleanSeconds >= 60) {
      this.clearLocalShame('60s clean focus completed');
    }
  }

  // Clear shame state and restore Locked In status
  clearLocalShame(reason = 'Clean focus sustained') {
    if (!this.isCurrentlyShamed) return;
    this.isCurrentlyShamed = false;
    this.shameCleanSeconds = 0;

    const localTile = document.getElementById('local-user-tile');
    if (localTile) {
      const badge = localTile.querySelector('.shame-stamp-badge');
      if (badge) {
        badge.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        badge.style.opacity = '0';
        badge.style.transform = 'translate(-50%, -50%) scale(0.7)';
        setTimeout(() => badge.remove(), 600);
      }
    }

    this.updateLocalTileStatus('LOCKED IN', 'status-locked');
    this.showShameToast(`✨ REDEEMED! Shame stamp cleared (${reason}) — locked back in!`);

    if (window.Soundboard) {
      window.Soundboard.playSynthesizedTone('gentle_chime', 0.5);
    }

    if (window.WebRTCRoom) {
      window.WebRTCRoom.broadcastData({
        type: 'SHAME_CLEARED',
        userId: (window.Leaderboard && window.Leaderboard.currentUser.uid) || window.WebRTCRoom.peerId
      });
    }
  }

  clearGrace() {
    if (this.currentGraceTimer) {
      clearInterval(this.currentGraceTimer);
      this.currentGraceTimer = null;
    }
    this.activeGraceTrigger = null;
    const banner = document.getElementById('grace-warning-banner');
    if (banner) {
      banner.classList.add('hidden');
      banner.classList.remove('flash-amber');
    }
  }

  // Execute Punishment after Grace Expires
  executePunishment(triggerId, reasonText) {
    console.warn(`[TriggerEngine] EXECUTING SHAME PUNISHMENT: ${triggerId} - ${reasonText}`);

    // 1. Play meme sound for trigger ID
    if (window.Soundboard) {
      window.Soundboard.playTrigger(triggerId);
    }

    // 2. Bold Red X strike across timer + Reset progress to 00:00
    if (window.StudyTimer) {
      window.StudyTimer.punishAndReset();
    }

    // 3. Slap Shame Badge on video tile
    this.isCurrentlyShamed = true;
    this.shameCleanSeconds = 0;
    this.updateLocalTileStatus(`SHAMED: ${reasonText}`, 'status-shamed');
    const localTile = document.getElementById('local-user-tile');
    if (localTile) {
      const existingBadge = localTile.querySelector('.shame-stamp-badge');
      if (existingBadge) existingBadge.remove();

      const shameBadge = document.createElement('div');
      shameBadge.className = 'shame-stamp-badge slam-animation';
      shameBadge.innerHTML = `<span>🚨 SHAMED</span><small>${this.escapeHtml(reasonText)}</small><div style="font-size:0.68rem; margin-top:4px; opacity:0.85;">Hold 60s clean focus to redeem</div>`;
      localTile.appendChild(shameBadge);
    }

    // 4. Points penalty
    if (window.Leaderboard) {
      window.Leaderboard.penalizeTrigger(triggerId);
    }

    // 5. Broadcast to room peers & Wall of Shame
    const currentUserName = (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Student';
    const soundConf = (window.Soundboard && window.Soundboard.soundConfigs[triggerId]) || {};
    const broadcastAudio = soundConf.url || soundConf.dataUrl || null;

    const shameEvent = {
      type: 'USER_SHAMED',
      triggerId,
      triggerName: reasonText,
      audioUrl: broadcastAudio,
      userName: currentUserName,
      userId: (window.Leaderboard && window.Leaderboard.currentUser.uid) || 'local',
      timestamp: Date.now()
    };

    if (window.WebRTCRoom) {
      window.WebRTCRoom.broadcastData(shameEvent);
    }
    if (window.FirebaseSync) {
      window.FirebaseSync.recordPublicShame(shameEvent);
    }

    // Show toast
    this.showShameToast(`🚨 SHAMED: ${reasonText} (-20 pts & Timer Reset!)`);
  }

  // Peer-to-Peer Social Accountability Callout
  recordPeerCallout(targetUserId, triggerId, reasonText, voterId) {
    if (!this.peerVotes[targetUserId]) {
      this.peerVotes[targetUserId] = {};
    }
    if (!this.peerVotes[targetUserId][triggerId]) {
      this.peerVotes[targetUserId][triggerId] = new Set();
    }

    this.peerVotes[targetUserId][triggerId].add(voterId);
    const voteCount = this.peerVotes[targetUserId][triggerId].size;
    const roomSize = window.WebRTCRoom ? window.WebRTCRoom.getPeerCount() : 1;

    // Consensus rule: 1 vote in 2-person room, 2 votes in larger room, or Admin
    const isAdmin = window.Soundboard && window.Soundboard.isAdminAuthenticated;
    const requiredVotes = (isAdmin || roomSize <= 2) ? 1 : 2;

    if (voteCount >= requiredVotes) {
      // Consensus reached! Punish target
      delete this.peerVotes[targetUserId][triggerId];

      const isMe = window.Leaderboard && window.Leaderboard.currentUser.uid === targetUserId;
      if (isMe) {
        this.executePunishment(triggerId, `Peer Confirmed: ${reasonText}`);
      }

      // Award snitch points to voter
      if (voterId === (window.Leaderboard && window.Leaderboard.currentUser.uid)) {
        window.Leaderboard.awardSnitchBounty();
        this.showShameToast(`🎯 Vigilance Bounty Awarded! +15 pts for calling out distraction.`);
      }
    }
  }

  updateLocalTileStatus(text, className) {
    const statusPill = document.querySelector('#local-user-tile .status-pill');
    if (statusPill) {
      statusPill.textContent = text;
      statusPill.className = `status-pill ${className}`;
    }
  }

  showShameToast(message) {
    const toast = document.createElement('div');
    toast.className = 'shame-toast-popup';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.TriggerEngine = new TriggerEngine();
