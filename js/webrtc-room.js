/**
 * LOCKED-IN: WebRTC Peer-Pair Signaling & Video Mesh Architecture
 * Deterministic Peer-Pair Signaling over Firestore (with Local BroadcastChannel fallback)
 * Full Android ↔ PC video & screen mesh with zero black-feed race conditions.
 */

const VIDEO_QUALITY_PRESETS = {
  '1080p60': { width: 1920, height: 1080, fps: 60, maxBitrate: 3000000 },
  '720p60':  { width: 1280, height: 720,  fps: 60, maxBitrate: 1800000 },
  '540p':    { width: 960,  height: 540,  fps: 30, maxBitrate: 900000 },
  '480p':    { width: 854,  height: 480,  fps: 24, maxBitrate: 600000 },
  '360p':    { width: 640,  height: 360,  fps: 15, maxBitrate: 350000 }
};
const AUTO_QUALITY_TIERS = ['1080p60', '720p60', '540p', '480p', '360p'];

class WebRTCRoomManager {
  constructor() {
    this.peerId = null;
    this.roomId = null;
    this.cleanRoom = null;
    this.isHost = false;
    this.isPrivate = false;
    this.passcode = null;

    // Streams
    this.localCamStream = null;
    this.localScreenStream = null;
    this.isDualFeedActive = false;
    this.isCamSwapped = false;
    this.isScreenSharing = false;
    this.isCameraPrivacyActive = false;

    // Active Peer connections: remotePeerId -> { pc, connectionId, isCaller, participant, candidateQueue, stream, unsubsConn, unsubsCand }
    this.peers = new Map();
    this.maxRoomCapacity = 8;

    // Audio & Status
    this.isMicMuted = true;
    this.isHandRaised = false;
    this.wakeLock = null;
    this._wakeLockListener = null;

    // RTC Configuration with STUN & open TURN fallbacks
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
      ],
      iceCandidatePoolSize: 4
    };

    // Subscriptions & intervals
    this.unsubscribeParticipants = null;
    this.pingInterval = null;
    this.adaptiveQualityInterval = null;
    this.videoQualityMode = localStorage.getItem('lockedin_video_quality') || 'auto';
    this._autoQualityTierIndex = 1; // Starts at 720p60 in Auto mode
    this._healthyStatsCount = 0;
  }

  // Generate a silent WebAudio track to guarantee SDP audio negotiations never fail
  createSilentAudioTrack() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const dst = ctx.createMediaStreamDestination();
      osc.connect(dst);
      osc.start();
      const track = dst.stream.getAudioTracks()[0];
      if (track) track.enabled = false;
      return track;
    } catch (e) {
      return null;
    }
  }

  ensureAudioTrack(stream) {
    if (!stream) return stream;
    if (stream.getAudioTracks().length === 0) {
      const silentTrack = this.createSilentAudioTrack();
      if (silentTrack) stream.addTrack(silentTrack);
    }
    return stream;
  }

  // Outgoing stream that peers receive (Screen share if sharing, else Camera)
  getOutgoingStream() {
    if (this.isScreenSharing && this.localScreenStream && this.localScreenStream.active) {
      const combined = new MediaStream();
      const screenVidTrack = this.localScreenStream.getVideoTracks()[0];
      if (screenVidTrack) combined.addTrack(screenVidTrack);

      const audioTrack = this.localCamStream && this.localCamStream.getAudioTracks()[0];
      if (audioTrack) {
        combined.addTrack(audioTrack);
      } else {
        const silent = this.createSilentAudioTrack();
        if (silent) combined.addTrack(silent);
      }
      return combined;
    }

    return this.ensureAudioTrack(this.localCamStream);
  }

  // Hot-replace outgoing video track on all connected peers with zero reload
  replaceOutgoingVideoTrack(newTrack) {
    if (!newTrack) return;
    this.peers.forEach((peerObj) => {
      if (peerObj.pc) {
        try {
          const senders = peerObj.pc.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(newTrack).catch(err => {
              console.warn('[WebRTC] replaceTrack error:', err);
            });
          }
        } catch (e) {
          console.warn('[WebRTC] getSenders error:', e);
        }
      }
    });
  }

  // Initialize Local Media Streams with Multi-Tier Fallback
  async initLocalMedia({ mode, videoDeviceId, audioDeviceId }) {
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.innerWidth < 768;
    const isBatterySaver = localStorage.getItem('lockedin_battery_saver') === 'true';
    const maxFps = isBatterySaver ? 12 : 24;
    this.isDualFeedActive = (mode === 'dual') && !isMobile;

    const camConstraints = {
      video: videoDeviceId 
        ? { deviceId: { exact: videoDeviceId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: maxFps } } 
        : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: maxFps } },
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
    };

    // 1. Attempt standard camera + mic
    try {
      this.localCamStream = await navigator.mediaDevices.getUserMedia(camConstraints);
    } catch (e1) {
      console.warn('[WebRTC] Exact getUserMedia failed. Trying video-only fallback...', e1);
      try {
        this.localCamStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch (e2) {
        console.warn('[WebRTC] Camera unavailable. Starting in synthetic canvas standby mode...', e2);
        const name = localStorage.getItem('lockedin_display_name') || 'Scholar';
        this.localCamStream = this.createFallbackAvatarStream(name);
      }
    }

    this.ensureAudioTrack(this.localCamStream);
    this.muteMic(true);

    // 2. If Dual Feed requested on desktop, request Screen Share
    if (this.isDualFeedActive) {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
          this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: false
          });

          this.isScreenSharing = true;

          this.localScreenStream.getVideoTracks()[0].onended = () => {
            this.stopScreenShare();
            if (window.TriggerEngine) {
              window.TriggerEngine.triggerCandidate('SCREEN_OFF_MID_SESSION', 'Screen sharing was ended!');
            }
          };
        } else {
          this.isDualFeedActive = false;
        }
      } catch (screenErr) {
        console.warn('[WebRTC] Screen share declined or cancelled:', screenErr);
        this.isDualFeedActive = false;
      }
    }

    // Attach to DOM
    const localCamVideo = document.getElementById('local-cam-video');
    const localScreenVideo = document.getElementById('local-screen-video');
    const pipWrapper = document.getElementById('local-pip-wrapper');
    const pipSwapBtn = document.getElementById('btn-pip-swap');
    const screenBtn = document.getElementById('toggle-screen-btn');

    if (this.isDualFeedActive && this.localScreenStream) {
      if (localScreenVideo) {
        localScreenVideo.srcObject = this.localScreenStream;
        localScreenVideo.muted = true;
        localScreenVideo.playsInline = true;
        localScreenVideo.play().catch(e => console.log(e));
      }
      if (localCamVideo && this.localCamStream) {
        localCamVideo.srcObject = this.localCamStream;
        localCamVideo.muted = true;
        localCamVideo.playsInline = true;
        localCamVideo.play().catch(e => console.log(e));
      }
      if (pipWrapper) pipWrapper.style.display = 'block';
      if (pipSwapBtn) pipSwapBtn.style.display = 'inline-flex';
      if (screenBtn) {
        screenBtn.innerHTML = '<span>🛑 Stop Sharing</span>';
        screenBtn.className = 'control-btn screen-active';
      }
    } else {
      if (localScreenVideo && this.localCamStream) {
        localScreenVideo.srcObject = this.localCamStream;
        localScreenVideo.muted = true;
        localScreenVideo.playsInline = true;
        localScreenVideo.play().catch(e => console.log(e));
      }
      if (pipWrapper) pipWrapper.style.display = 'none';
      if (pipSwapBtn) pipSwapBtn.style.display = 'none';
      if (screenBtn) {
        screenBtn.innerHTML = '<span>🖥️ Share Screen</span>';
        screenBtn.className = 'control-btn';
      }
    }

    this.updateTileLayout();
    return true;
  }

  createFallbackAvatarStream(displayName) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    const draw = () => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const grad = ctx.createLinearGradient(160, 100, 480, 380);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(320, 200, 75, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎓', 320, 200);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(displayName || 'Scholar', 320, 320);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px sans-serif';
      ctx.fillText('LOCKED IN (Standby Cam)', 320, 355);
    };

    draw();
    setInterval(draw, 1000);
    return canvas.captureStream ? canvas.captureStream(10) : null;
  }

  // =========================================================
  // ROOM JOINING & PEER-PAIR ORCHESTRATION
  // =========================================================

  async joinStudyRoom(requestedRoomId, isPrivate = false, passcode = null) {
    // Clean, uppercase 6+ char code
    const rawCode = requestedRoomId || 'MAIN-STUDY-HALL';
    const cleanRoom = String(rawCode).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24) || 'STUDY-101';
    
    this.roomId = cleanRoom;
    this.cleanRoom = cleanRoom;
    this.isPrivate = isPrivate;
    this.passcode = passcode ? String(passcode).trim() : null;

    // Unique per-tab Peer ID
    this.peerId = 'p_' + Math.random().toString(36).substring(2, 9);
    console.log(`[WebRTC] Joining Room: ${cleanRoom} as Peer: ${this.peerId}`);

    // Update Room Code & Share Bar
    this.renderRoomCodeBar();
    this.requestWakeLock();

    const callSign = window.FirebaseSync?.currentUser?.callSign || window.FirebaseSync?.currentUser?.displayName || localStorage.getItem('lockedin_display_name') || 'Scholar_' + this.peerId.slice(-4);
    this.updateLocalAvatarDisplay(callSign);
    const isVerified = !!(window.FirebaseSync?.currentUser && !window.FirebaseSync.currentUser.isAnonymous && window.FirebaseSync.currentUser.isVerified);

    // 1. Write Presence to rooms/{roomId}/participants/{peerId}
    await window.FirebaseSync.setParticipantPresence(this.roomId, this.peerId, {
      callSign: callSign,
      displayName: callSign,
      cameraMode: this.isDualFeedActive ? 'dual' : 'single',
      isVerified: isVerified
    });

    // 2. Start 20s Room & Participant Heartbeat Ping
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      window.FirebaseSync.pingRoom(this.roomId, 1 + this.peers.size);
      window.FirebaseSync.updateParticipantHeartbeat(this.roomId, this.peerId);
    }, 20000);
    await window.FirebaseSync.pingRoom(this.roomId, 1);

    // Clean up presence if browser tab closes abruptly
    if (this._unloadHandler) {
      window.removeEventListener('pagehide', this._unloadHandler);
      window.removeEventListener('beforeunload', this._unloadHandler);
    }
    this._unloadHandler = () => {
      if (this.roomId && this.peerId) {
        window.FirebaseSync.removeParticipantPresence(this.roomId, this.peerId, this.peers.size === 0);
        if (this.peers.size === 0 && this.roomId !== 'MAIN-STUDY-HALL') {
          window.FirebaseSync.pingRoom(this.roomId, 0);
        }
      }
    };
    window.addEventListener('pagehide', this._unloadHandler);
    window.addEventListener('beforeunload', this._unloadHandler);

    // 3. Listen to Participants & Negotiate Peer-Pairs
    this.unsubscribeParticipants = window.FirebaseSync.listenToParticipants(this.roomId, (participants) => {
      this.handleParticipantsUpdate(participants);
    });

    // 4. Listen to Room Events
    this.unsubscribeEvents = window.FirebaseSync.listenToRoomEvents(this.roomId, (event) => {
      if (event && event.type) this.handleIncomingData(event, event.payload?.senderPeerId || event.senderId);
    });

    // 5. Synchronized Room Pomodoro listener
    if (window.FirebaseSync.listenToRoom) {
      this.unsubscribeRoomDoc = window.FirebaseSync.listenToRoom(this.roomId, (roomData) => {
        if (window.StudyTimer && window.StudyTimer.syncFromRoomDoc) {
          window.StudyTimer.syncFromRoomDoc(roomData);
        }
      });
    }

    this.updateGridLayout();
    if (this.videoQualityMode === 'auto') {
      this.startAdaptiveQualityMonitor();
    } else {
      this.applyVideoQualityPreset(this.videoQualityMode);
    }
    return true;
  }

  renderRoomCodeBar() {
    const codeText = document.getElementById('active-room-code-text');
    if (codeText) codeText.textContent = this.roomId;

    const shareBar = document.getElementById('room-code-share-bar');
    if (shareBar) shareBar.classList.remove('hidden');

    const badge = document.getElementById('room-id-badge');
    if (badge) {
      badge.innerHTML = `ROOM: <strong>${this.escapeHtml(this.roomId)}</strong>`;
      badge.style.borderColor = 'rgba(59, 130, 246, 0.4)';
    }
  }

  // Deterministic Peer-Pair Signaling:
  // For any pair (peerA, peerB): smaller ID initiates offer, larger ID answers.
  handleParticipantsUpdate(participants) {
    if (!Array.isArray(participants)) return;

    const activeRemoteIds = new Set();

    participants.forEach((p) => {
      const remotePeerId = p.peerId;
      if (!remotePeerId || remotePeerId === this.peerId) return;

      activeRemoteIds.add(remotePeerId);

      // Register remote participant on Leaderboard
      if (window.Leaderboard && window.Leaderboard.upsertPeer) {
        window.Leaderboard.upsertPeer({
          uid: p.userId || remotePeerId,
          displayName: p.callSign || p.displayName || 'Peer',
          subject: 'Deep Work',
          points: 150
        });
      }

      // Render remote tile immediately so both peers see each other even before video tracks arrive
      this.renderRemoteTile(remotePeerId, p);

      // If we don't already have an active connection with this peer:
      if (!this.peers.has(remotePeerId)) {
        const smallerId = (this.peerId < remotePeerId) ? this.peerId : remotePeerId;
        const largerId = (this.peerId < remotePeerId) ? remotePeerId : this.peerId;
        const connectionId = `${smallerId}_${largerId}`;

        if (this.peerId === smallerId) {
          // We are CALLER
          console.log(`[WebRTC] Enforcing rule: We (${this.peerId}) are CALLER to (${remotePeerId})`);
          this.initiateCaller(connectionId, remotePeerId, p);
        } else {
          // We are CALLEE
          console.log(`[WebRTC] Enforcing rule: We (${this.peerId}) are CALLEE for (${remotePeerId})`);
          this.listenAsCallee(connectionId, remotePeerId, p);
        }
      }
    });

    // Cleanup peers that left the room
    this.peers.forEach((peerObj, remoteId) => {
      if (!activeRemoteIds.has(remoteId)) {
        console.log(`[WebRTC] Peer ${remoteId} left. Cleaning up...`);
        this.removeRemotePeer(remoteId);
      }
    });

    this.updateGridLayout();
    this.updateRoomParticipantCount();
    this.updateGridLayout();
  }

  // CALLER: Creates RTCPeerConnection, adds tracks, writes offer, listens for answer & ICE
  async initiateCaller(connectionId, remotePeerId, participantData) {
    const pc = new RTCPeerConnection(this.rtcConfig);
    const peerObj = {
      pc,
      connectionId,
      isCaller: true,
      participant: participantData,
      candidateQueue: [],
      stream: null,
      remoteStream: new MediaStream(),
      answerApplied: false,
      unsubsConn: null,
      unsubsCand: null
    };
    this.peers.set(remotePeerId, peerObj);

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC Caller] ICE state (${remotePeerId}):`, pc.iceConnectionState);
    };

    // Add local tracks BEFORE offer creation
    const outStream = this.getOutgoingStream();
    if (outStream) {
      outStream.getTracks().forEach(track => pc.addTrack(track, outStream));
    }

    // ICE Candidate generation -> send to callerCandidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.FirebaseSync.addIceCandidate(this.roomId, connectionId, 'caller', event.candidate);
      }
    };

    // Incoming remote track binding with mobile MediaStream fallback
    // Use a single persistent MediaStream per peer to avoid srcObject churn on each track event
    peerObj.remoteStream = peerObj.remoteStream || new MediaStream();
    pc.ontrack = (event) => {
      console.log(`[WebRTC Caller] Track received from ${remotePeerId}:`, event.track.kind);
      // Add track to the persistent stream (avoids black frames from srcObject re-assignment)
      if (!peerObj.remoteStream.getTracks().find(t => t.id === event.track.id)) {
        peerObj.remoteStream.addTrack(event.track);
      }
      peerObj.stream = peerObj.remoteStream;
      this.attachRemoteStream(remotePeerId, peerObj.remoteStream, participantData);
    };

    // Listen for Callee's ICE candidates
    peerObj.unsubsCand = window.FirebaseSync.listenToIceCandidates(this.roomId, connectionId, 'callee', (candidate) => {
      this.handleRemoteIceCandidate(remotePeerId, candidate);
    });

    // Create & set local offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const myUid = window.FirebaseSync.auth?.currentUser?.uid || window.FirebaseSync.currentUser?.uid || this.peerId;
      const remoteUid = participantData?.userId || remotePeerId;

      await window.FirebaseSync.writeConnectionOffer(this.roomId, connectionId, {
        callerId: myUid,
        calleeId: remoteUid,
        offer: { type: offer.type, sdp: offer.sdp }
      });

      // Listen for Callee's Answer
      peerObj.unsubsConn = window.FirebaseSync.listenToConnection(this.roomId, connectionId, async (data) => {
        if (data && data.answer && !peerObj.answerApplied && pc.signalingState !== 'stable') {
          peerObj.answerApplied = true;
          console.log(`[WebRTC Caller] Answer received from ${remotePeerId}`);
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          this.drainCandidateQueue(remotePeerId);
        }
      });
    } catch (err) {
      console.error('[WebRTC Caller] Negotiation error:', err);
    }
  }

  // CALLEE: Listens for offer on connection doc, creates RTCPeerConnection, adds tracks, writes answer
  listenAsCallee(connectionId, remotePeerId, participantData) {
    const peerObj = {
      pc: null,
      connectionId,
      isCaller: false,
      participant: participantData,
      candidateQueue: [],
      stream: null,
      remoteStream: new MediaStream(),
      unsubsConn: null,
      unsubsCand: null
    };
    this.peers.set(remotePeerId, peerObj);

    peerObj.unsubsConn = window.FirebaseSync.listenToConnection(this.roomId, connectionId, async (data) => {
      if (data && data.offer && !peerObj.pc) {
        console.log(`[WebRTC Callee] Offer received from ${remotePeerId}`);
        const pc = new RTCPeerConnection(this.rtcConfig);
        peerObj.pc = pc;

        // Add local tracks BEFORE answer creation
        const outStream = this.getOutgoingStream();
        if (outStream) {
          outStream.getTracks().forEach(track => pc.addTrack(track, outStream));
        }

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            window.FirebaseSync.addIceCandidate(this.roomId, connectionId, 'callee', event.candidate);
          }
        };

        pc.ontrack = (event) => {
          console.log(`[WebRTC Callee] Track received from ${remotePeerId}:`, event.track.kind);
          // Use a single persistent MediaStream per peer to avoid srcObject churn
          peerObj.remoteStream = peerObj.remoteStream || new MediaStream();
          if (!peerObj.remoteStream.getTracks().find(t => t.id === event.track.id)) {
            peerObj.remoteStream.addTrack(event.track);
          }
          peerObj.stream = peerObj.remoteStream;
          this.attachRemoteStream(remotePeerId, peerObj.remoteStream, participantData);
        };

        // Listen for Caller's ICE candidates
        peerObj.unsubsCand = window.FirebaseSync.listenToIceCandidates(this.roomId, connectionId, 'caller', (candidate) => {
          this.handleRemoteIceCandidate(remotePeerId, candidate);
        });

        // Set remote offer, drain early candidates, and reply with answer
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          this.drainCandidateQueue(remotePeerId);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          await window.FirebaseSync.writeConnectionAnswer(this.roomId, connectionId, {
            answer: { type: answer.type, sdp: answer.sdp }
          });
        } catch (err) {
          console.error('[WebRTC Callee] Answer error:', err);
        }
      }
    });
  }

  // Early ICE Candidate Queuing (prevents dropping early ICE candidates)
  async handleRemoteIceCandidate(remotePeerId, candidateData) {
    const peerObj = this.peers.get(remotePeerId);
    if (!peerObj) return;

    const cand = new RTCIceCandidate(candidateData);
    if (peerObj.pc && peerObj.pc.remoteDescription && peerObj.pc.remoteDescription.type) {
      try {
        await peerObj.pc.addIceCandidate(cand);
      } catch (e) {
        console.warn('[WebRTC] addIceCandidate error:', e);
      }
    } else {
      peerObj.candidateQueue.push(cand);
    }
  }

  async drainCandidateQueue(remotePeerId) {
    const peerObj = this.peers.get(remotePeerId);
    if (!peerObj || !peerObj.pc || !peerObj.pc.remoteDescription) return;

    while (peerObj.candidateQueue && peerObj.candidateQueue.length > 0) {
      const cand = peerObj.candidateQueue.shift();
      try {
        await peerObj.pc.addIceCandidate(cand);
      } catch (e) {
        console.warn('[WebRTC] drain candidate error:', e);
      }
    }
  }

  // Attach Remote MediaStream to Video Tile with Autoplay Fallback
  attachRemoteStream(remotePeerId, stream, participantData) {
    let tile = document.getElementById(`tile-${remotePeerId}`);
    if (!tile) {
      tile = this.renderRemoteTile(remotePeerId, participantData);
    }

    const video = tile.querySelector('.remote-video');
    if (video) {
      // Only reassign srcObject if it changed (prevents black-frame flicker on each track event)
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.playsInline = true;
      video.autoplay = true;
      video.muted = true; // MUST be muted for autoplay policy on mobile/Android

      video.play().catch(err => {
        console.warn(`[WebRTC] Remote video autoplay blocked for ${remotePeerId}:`, err);
        this.showPlayFallbackOverlay(tile, video);
      });
    }

    this.updateGridLayout();
    this.updateGridLayout();
    this.updateRoomParticipantCount();
  }

  showPlayFallbackOverlay(tile, video) {
    let fallback = tile.querySelector('.autoplay-fallback-btn');
    if (!fallback) {
      fallback = document.createElement('button');
      fallback.className = 'autoplay-fallback-btn';
      fallback.innerHTML = '<span>▶ Tap to start video</span>';
      fallback.onclick = () => {
        video.muted = true; // Keep muted — required for mobile autoplay
        video.play().then(() => fallback.remove()).catch(e => console.log(e));
      };
      tile.querySelector('.video-container')?.appendChild(fallback);
    }
  }

  renderRemoteTile(remotePeerId, participantData) {
    const grid = document.getElementById('study-grid');
    if (!grid) return null;

    let tile = document.getElementById(`tile-${remotePeerId}`);
    if (tile) return tile;

    const callSign = participantData?.callSign || participantData?.displayName || 'Scholar';
    const isVerified = !!participantData?.isVerified;
    const isDeskCam = (participantData?.cameraMode === 'single');

    tile = document.createElement('div');
    tile.id = `tile-${remotePeerId}`;
    tile.className = 'study-tile remote-tile';

    tile.innerHTML = `
      <div class="video-container">
        <video autoplay playsinline muted class="remote-video"></video>
        <div class="tile-avatar-card hidden">
          <div class="avatar-circle">${this.escapeHtml(callSign.slice(0, 2).toUpperCase())}</div>
          <span class="avatar-title">${this.escapeHtml(callSign)}</span>
          <span class="avatar-status">🔒 Camera Off</span>
        </div>
      </div>
      <div class="tile-hud">
        <div class="hud-top">
          <span class="user-badge">${this.escapeHtml(callSign)} ${isVerified ? '✓' : ''}</span>
          <span class="subject-badge">${isDeskCam ? '📱 Desk Cam' : '🖥️ Dual Feed'}</span>
          <span class="listening-badge hidden">🎧 Focus</span>
          <button type="button" class="nudge-peer-btn" title="Send silent desk bell nudge">🔔 Nudge</button>
        </div>
        <div class="hud-bottom">
          <div class="timer-display">25:00</div>
          <span class="status-pill status-locked">LOCKED IN</span>
          <span class="hand-indicator hidden">✋ Hand Raised</span>
        </div>
      </div>
    `;

    grid.appendChild(tile);

    const nudgeBtn = tile.querySelector('.nudge-peer-btn');
    if (nudgeBtn) {
      nudgeBtn.addEventListener('click', () => {
        this.broadcastData({
          type: 'SILENT_NUDGE',
          targetPeerId: remotePeerId
        });
        nudgeBtn.textContent = '✓ Nudged';
        setTimeout(() => { nudgeBtn.textContent = '🔔 Nudge'; }, 2000);
      });
    }
    return tile;
  }

  removeRemotePeer(remotePeerId) {
    const peerObj = this.peers.get(remotePeerId);
    if (peerObj) {
      if (peerObj.unsubsConn) peerObj.unsubsConn();
      if (peerObj.unsubsCand) peerObj.unsubsCand();
      if (peerObj.pc) {
        try { peerObj.pc.close(); } catch(e){}
      }
      this.peers.delete(remotePeerId);
    }
    const tile = document.getElementById(`tile-${remotePeerId}`);
    if (tile) tile.remove();

    this.updateGridLayout();
    this.updateGridLayout();
    this.updateRoomParticipantCount();
  }

  // Responsive Zoom-Style Grid System
  updateGridLayout() {
    const grid = document.getElementById('study-grid');
    if (!grid) return;

    const totalActive = 1 + this.peers.size;
    grid.classList.remove('grid-1-user', 'grid-2-users', 'grid-3-4-users', 'grid-5-8-users');

    if (totalActive === 1) {
      grid.classList.add('grid-1-user');
    } else if (totalActive === 2) {
      grid.classList.add('grid-2-users');
    } else if (totalActive <= 4) {
      grid.classList.add('grid-3-4-users');
    } else {
      grid.classList.add('grid-5-8-users');
    }
  }

  updateRoomParticipantCount() {
    const total = 1 + this.peers.size;
    const countBadge = document.getElementById('room-count-badge');
    if (countBadge) {
      countBadge.innerHTML = `<span style="color:#10b981; font-weight:800;">🟢 ${total}</span> Active ${total === 1 ? 'Scholar' : 'Scholars'}`;
      countBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }
  }

  // =========================================================
  // HARDWARE PRIVACY CONTROLS & CAMERA / SCREEN TOGGLES
  // =========================================================

  updateLocalAvatarDisplay(nameOverride) {
    const raw = nameOverride ||
      window.FirebaseSync?.currentUser?.callSign ||
      window.FirebaseSync?.currentUser?.displayName ||
      localStorage.getItem('lockedin_display_name') ||
      'Scholar';
    const clean = String(raw).trim() || 'Scholar';
    const parts = clean.split(/\s+/).filter(Boolean);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : clean.slice(0, 2).toUpperCase();

    const initialsEl = document.getElementById('local-avatar-initials');
    const nameEl = document.getElementById('local-avatar-name');
    if (initialsEl) initialsEl.textContent = initials;
    if (nameEl) nameEl.textContent = clean;
  }

  toggleCamera() {
    this.updateLocalAvatarDisplay();
    this.isCameraPrivacyActive = !this.isCameraPrivacyActive;
    const camBtn = document.getElementById('toggle-cam-btn');
    const avatarCard = document.getElementById('local-avatar-card');
    const localScreenVideo = document.getElementById('local-screen-video');

    if (this.localCamStream) {
      const vidTrack = this.localCamStream.getVideoTracks()[0];
      if (vidTrack) vidTrack.enabled = !this.isCameraPrivacyActive;
    }

    if (this.isCameraPrivacyActive) {
      if (camBtn) {
        camBtn.innerHTML = '<span>📹 Cam</span>';
        camBtn.className = 'control-btn cam-muted';
      }
      if (avatarCard) avatarCard.classList.remove('hidden');
      if (localScreenVideo && !this.isScreenSharing) localScreenVideo.style.opacity = '0';
    } else {
      if (camBtn) {
        camBtn.innerHTML = '<span>📹 Cam</span>';
        camBtn.className = 'control-btn cam-active';
      }
      if (avatarCard) avatarCard.classList.add('hidden');
      if (localScreenVideo) localScreenVideo.style.opacity = '1';
    }

    this.broadcastData({
      type: 'CAMERA_PRIVACY_TOGGLED',
      peerId: this.peerId,
      isMuted: this.isCameraPrivacyActive
    });
  }

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  async startScreenShare() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert('Screen sharing is not supported by your current browser.');
        return;
      }

      this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      this.isScreenSharing = true;
      const screenVidTrack = this.localScreenStream.getVideoTracks()[0];
      this.replaceOutgoingVideoTrack(screenVidTrack);

      const localScreenVideo = document.getElementById('local-screen-video');
      const pipWrapper = document.getElementById('local-pip-wrapper');
      const pipSwapBtn = document.getElementById('btn-pip-swap');
      const avatarCard = document.getElementById('local-avatar-card');

      if (avatarCard) avatarCard.classList.add('hidden');
      if (localScreenVideo) {
        localScreenVideo.srcObject = this.localScreenStream;
        localScreenVideo.style.opacity = '1';
        localScreenVideo.play().catch(e => console.log(e));
      }
      if (pipWrapper) pipWrapper.style.display = 'block';
      if (pipSwapBtn) pipSwapBtn.style.display = 'inline-flex';

      const screenBtn = document.getElementById('toggle-screen-btn');
      if (screenBtn) {
        screenBtn.innerHTML = '<span>🛑 Stop Sharing</span>';
        screenBtn.className = 'control-btn screen-active';
      }

      screenVidTrack.onended = () => this.stopScreenShare();

      this.broadcastData({
        type: 'SCREEN_SHARE_STARTED',
        peerId: this.peerId
      });
    } catch (err) {
      console.warn('[WebRTC] Screen share failed/cancelled:', err);
    }
  }

  stopScreenShare() {
    if (!this.isScreenSharing) return;
    this.isScreenSharing = false;

    if (this.localScreenStream) {
      try { this.localScreenStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      this.localScreenStream = null;
    }

    const camTrack = this.localCamStream && this.localCamStream.getVideoTracks()[0];
    if (camTrack) this.replaceOutgoingVideoTrack(camTrack);

    const localScreenVideo = document.getElementById('local-screen-video');
    const pipWrapper = document.getElementById('local-pip-wrapper');
    const pipSwapBtn = document.getElementById('btn-pip-swap');
    const avatarCard = document.getElementById('local-avatar-card');

    if (this.isCameraPrivacyActive) {
      if (avatarCard) avatarCard.classList.remove('hidden');
      if (localScreenVideo) localScreenVideo.style.opacity = '0';
    } else {
      if (avatarCard) avatarCard.classList.add('hidden');
      if (localScreenVideo && this.localCamStream) {
        localScreenVideo.srcObject = this.localCamStream;
        localScreenVideo.style.opacity = '1';
        localScreenVideo.play().catch(e => console.log(e));
      }
    }

    if (pipWrapper) pipWrapper.style.display = 'none';
    if (pipSwapBtn) pipSwapBtn.style.display = 'none';

    const screenBtn = document.getElementById('toggle-screen-btn');
    if (screenBtn) {
      screenBtn.innerHTML = '<span>🖥️ Share Screen</span>';
      screenBtn.className = 'control-btn';
    }

    this.broadcastData({
      type: 'SCREEN_SHARE_STOPPED',
      peerId: this.peerId
    });
  }

  swapPiP() {
    if (!this.localScreenStream || !this.localCamStream) return;
    this.isCamSwapped = !this.isCamSwapped;
    this.updateTileLayout();
  }

  updateTileLayout() {
    const localScreenVideo = document.getElementById('local-screen-video');
    const localCamVideo = document.getElementById('local-cam-video');

    if (this.isDualFeedActive && this.localScreenStream && this.localCamStream) {
      if (this.isCamSwapped) {
        if (localScreenVideo) localScreenVideo.srcObject = this.localCamStream;
        if (localCamVideo) localCamVideo.srcObject = this.localScreenStream;
      } else {
        if (localScreenVideo) localScreenVideo.srcObject = this.localScreenStream;
        if (localCamVideo) localCamVideo.srcObject = this.localCamStream;
      }
    }
  }

  muteMic(shouldMute) {
    this.isMicMuted = shouldMute;
    if (this.localCamStream) {
      const audioTracks = this.localCamStream.getAudioTracks();
      audioTracks.forEach(t => t.enabled = !shouldMute);
    }
    const micBtn = document.getElementById('toggle-mic-btn');
    if (micBtn) {
      if (shouldMute) {
        micBtn.innerHTML = '<span>🎤 Mic</span>';
        micBtn.className = 'control-btn mic-muted';
      } else {
        micBtn.innerHTML = '<span>🎤 Mic</span>';
        micBtn.className = 'control-btn mic-active';
      }
    }
  }

  toggleMic() {
    this.muteMic(!this.isMicMuted);
  }

  toggleRaiseHand() {
    this.isHandRaised = !this.isHandRaised;
    const handBtn = document.getElementById('raise-hand-btn');
    const indicator = document.getElementById('local-hand-indicator');

    if (handBtn) {
      handBtn.classList.toggle('active', this.isHandRaised);
      handBtn.style.background = this.isHandRaised ? 'rgba(245, 158, 11, 0.3)' : '';
    }
    if (indicator) {
      indicator.classList.toggle('hidden', !this.isHandRaised);
    }

    this.broadcastData({
      type: 'HAND_RAISED',
      peerId: this.peerId,
      isHandRaised: this.isHandRaised
    });
  }

  broadcastData(data) {
    if (this.roomId) {
      window.FirebaseSync.broadcastEvent(this.roomId, {
        ...data,
        senderId: this.peerId,
        senderName: localStorage.getItem('lockedin_display_name') || 'Scholar'
      });
    }
  }

  handleIncomingData(data, fromPeerId) {
    if (!data) return;
    const evt = (data.payload && typeof data.payload === 'object') ? { ...data, ...data.payload } : data;
    const peerKey = evt.senderPeerId || evt.peerId || fromPeerId;
    if (!peerKey || peerKey === this.peerId) return;

    if (evt.type === 'HAND_RAISED') {
      const tile = document.getElementById(`tile-${peerKey}`);
      if (tile) {
        const ind = tile.querySelector('.hand-indicator');
        if (ind) ind.classList.toggle('hidden', !evt.isHandRaised);
      }
    } else if (evt.type === 'CAMERA_PRIVACY_TOGGLED') {
      const tile = document.getElementById(`tile-${peerKey}`);
      if (tile) {
        const avatar = tile.querySelector('.tile-avatar-card');
        const video = tile.querySelector('.remote-video');
        if (avatar && video) {
          if (evt.isMuted) {
            avatar.classList.remove('hidden');
            video.style.opacity = '0';
          } else {
            avatar.classList.add('hidden');
            video.style.opacity = '1';
          }
        }
      }
    } else if (evt.type === 'SHAME_TRIGGER') {
      if (window.TriggerEngine && window.TriggerEngine.showShameToast) {
        window.TriggerEngine.showShameToast(`🚨 ${evt.senderName || 'A peer'} was caught: ${evt.reason || 'Distracted!'}`);
      }
    } else if (evt.type === 'STATUS_TAG_UPDATED') {
      const tile = document.getElementById(`tile-${peerKey}`);
      if (tile && evt.statusTag) {
        const badge = tile.querySelector('.subject-badge');
        if (badge) badge.textContent = evt.statusTag;
      }
    } else if (evt.type === 'SILENT_NUDGE' && evt.targetPeerId === this.peerId) {
      if (window.Soundboard && window.Soundboard.playSynthesizedTone) {
        window.Soundboard.playSynthesizedTone('gentle_chime', 0.45);
      }
      if (window.TriggerEngine && window.TriggerEngine.showShameToast) {
        window.TriggerEngine.showShameToast(`🔔 ${evt.senderName || 'Study partner'} sent you a gentle focus nudge!`);
      }
    }
  }

  setBatterySaver(enabled) {
    localStorage.setItem('lockedin_battery_saver', enabled ? 'true' : 'false');
    if (this.localCamStream) {
      const vidTrack = this.localCamStream.getVideoTracks()[0];
      if (vidTrack && vidTrack.applyConstraints) {
        vidTrack.applyConstraints({
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { max: enabled ? 12 : 24 }
        }).catch(err => console.warn('[WebRTC] Battery saver constraint warning:', err));
      }
    }
  }

  async setVideoQuality(mode) {
    const cleanMode = (mode === 'auto' || VIDEO_QUALITY_PRESETS[mode]) ? mode : 'auto';
    this.videoQualityMode = cleanMode;
    localStorage.setItem('lockedin_video_quality', cleanMode);

    if (cleanMode === 'auto') {
      this._autoQualityTierIndex = 1; // 720p60 starting tier
      this._healthyStatsCount = 0;
      await this.applyVideoQualityPreset(AUTO_QUALITY_TIERS[this._autoQualityTierIndex]);
      if (this.roomId) this.startAdaptiveQualityMonitor();
    } else {
      this.stopAdaptiveQualityMonitor();
      await this.applyVideoQualityPreset(cleanMode);
    }
  }

  async applyVideoQualityPreset(presetKey) {
    const preset = VIDEO_QUALITY_PRESETS[presetKey] || VIDEO_QUALITY_PRESETS['540p'];

    // 1. Live camera track constraint update (no reconnect)
    if (this.localCamStream) {
      const vidTrack = this.localCamStream.getVideoTracks()[0];
      if (vidTrack && vidTrack.applyConstraints) {
        try {
          await vidTrack.applyConstraints({
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.fps, max: preset.fps }
          });
        } catch (err) {
          console.warn(`[WebRTC] applyConstraints (${presetKey}) warning:`, err);
        }
      }
    }

    // 2. Live RTCRtpSender bitrate update on all connected peers
    this.peers.forEach(async (peerObj) => {
      if (!peerObj.pc) return;
      try {
        const videoSender = peerObj.pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoSender.getParameters && videoSender.setParameters) {
          const params = videoSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = preset.maxBitrate;
          await videoSender.setParameters(params);
        }
      } catch (err) {
        console.warn(`[WebRTC] setParameters (${presetKey}) warning:`, err);
      }
    });
  }

  startAdaptiveQualityMonitor() {
    this.stopAdaptiveQualityMonitor();
    this.adaptiveQualityInterval = setInterval(async () => {
      if (this.videoQualityMode !== 'auto' || this.peers.size === 0) return;

      let worstLossRate = 0;
      let worstRtt = 0;
      let sampled = false;

      for (const peerObj of this.peers.values()) {
        if (!peerObj.pc || typeof peerObj.pc.getStats !== 'function') continue;
        try {
          const stats = await peerObj.pc.getStats();
          let packetsSent = 0;
          let packetsLost = 0;
          stats.forEach((report) => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              packetsSent += report.packetsSent || 0;
            }
            if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
              packetsLost += Math.max(0, report.packetsLost || 0);
              if (typeof report.roundTripTime === 'number') {
                worstRtt = Math.max(worstRtt, report.roundTripTime);
              }
            }
          });
          if (packetsSent > 0) {
            sampled = true;
            worstLossRate = Math.max(worstLossRate, packetsLost / (packetsSent + packetsLost));
          }
        } catch (e) {}
      }

      if (!sampled) return;

      if (worstLossRate > 0.05 || worstRtt > 0.35) {
        this._healthyStatsCount = 0;
        if (this._autoQualityTierIndex < AUTO_QUALITY_TIERS.length - 1) {
          this._autoQualityTierIndex++;
          const nextTier = AUTO_QUALITY_TIERS[this._autoQualityTierIndex];
          console.log(`[WebRTC Auto] Scaling down to ${nextTier} (loss=${(worstLossRate * 100).toFixed(1)}%, rtt=${Math.round(worstRtt * 1000)}ms)`);
          this.applyVideoQualityPreset(nextTier);
        }
      } else if (worstLossRate < 0.01 && worstRtt < 0.15) {
        this._healthyStatsCount++;
        if (this._healthyStatsCount >= 2 && this._autoQualityTierIndex > 0) {
          this._healthyStatsCount = 0;
          this._autoQualityTierIndex--;
          const nextTier = AUTO_QUALITY_TIERS[this._autoQualityTierIndex];
          console.log(`[WebRTC Auto] Network healthy — scaling up to ${nextTier}`);
          this.applyVideoQualityPreset(nextTier);
        }
      } else {
        this._healthyStatsCount = 0;
      }
    }, 5000);
  }

  stopAdaptiveQualityMonitor() {
    if (this.adaptiveQualityInterval) {
      clearInterval(this.adaptiveQualityInterval);
      this.adaptiveQualityInterval = null;
    }
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[WebRTC] Screen WakeLock acquired.');
        this.wakeLock.addEventListener('release', () => {
          console.log('[WebRTC] Screen WakeLock released.');
        });
      } catch (err) {
        console.warn('[WebRTC] WakeLock request error:', err);
      }
    }
    if (!this._wakeLockListener) {
      this._wakeLockListener = async () => {
        if (this.roomId && document.visibilityState === 'visible') {
          await this.requestWakeLock();
        }
      };
      document.addEventListener('visibilitychange', this._wakeLockListener);
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch (e) {}
      this.wakeLock = null;
    }
  }

  leaveStudyRoom() {
    console.log('[WebRTC] Leaving study room:', this.roomId);
    this.releaseWakeLock();
    this.stopAdaptiveQualityMonitor();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.unsubscribeParticipants) {
      this.unsubscribeParticipants();
      this.unsubscribeParticipants = null;
    }
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    if (this.unsubscribeRoomDoc) {
      this.unsubscribeRoomDoc();
      this.unsubscribeRoomDoc = null;
    }

    // Clean up Firestore presence & update room activeCount if empty
    if (this._unloadHandler) {
      window.removeEventListener('pagehide', this._unloadHandler);
      window.removeEventListener('beforeunload', this._unloadHandler);
      this._unloadHandler = null;
    }
    if (this.roomId && this.peerId) {
      window.FirebaseSync.removeParticipantPresence(this.roomId, this.peerId);
      if (this.peers.size === 0) {
        window.FirebaseSync.pingRoom(this.roomId, 0);
      }
    }

    // Stop tracks
    if (this.localCamStream) {
      try { this.localCamStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      this.localCamStream = null;
    }
    if (this.localScreenStream) {
      try { this.localScreenStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      this.localScreenStream = null;
    }

    // Close connections & clear tiles
    this.peers.forEach((p, rId) => {
      if (p.unsubsConn) p.unsubsConn();
      if (p.unsubsCand) p.unsubsCand();
      if (p.pc) {
        try { p.pc.close(); } catch (e) {}
      }
      const tile = document.getElementById(`tile-${rId}`);
      if (tile) tile.remove();
    });
    this.peers.clear();

    // Reset DOM
    const localCamVideo = document.getElementById('local-cam-video');
    if (localCamVideo) localCamVideo.srcObject = null;
    const localScreenVideo = document.getElementById('local-screen-video');
    if (localScreenVideo) localScreenVideo.srcObject = null;

    if (window.TriggerEngine) window.TriggerEngine.stopMonitoring();
    if (window.StudyTimer) window.StudyTimer.pauseTimer();

    const roomBadge = document.getElementById('room-id-badge');
    if (roomBadge) {
      roomBadge.innerHTML = 'Lobby';
      roomBadge.style.color = '';
      roomBadge.style.borderColor = '';
    }
    const countBadge = document.getElementById('room-count-badge');
    if (countBadge) countBadge.textContent = '1/8 Online';

    const shareBar = document.getElementById('room-code-share-bar');
    if (shareBar) shareBar.classList.add('hidden');

    const leaveBtnHeader = document.getElementById('btn-leave-room-header');
    if (leaveBtnHeader) leaveBtnHeader.style.display = 'none';

    const studyView = document.getElementById('study-room-view');
    const lobbyView = document.getElementById('lobby-view');
    if (studyView) studyView.classList.add('hidden');
    if (lobbyView) lobbyView.classList.remove('hidden');
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.WebRTCRoom = new WebRTCRoomManager();
