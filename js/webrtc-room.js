/**
 * LOCKED-IN: WebRTC & PeerJS 8-Person Mesh Architecture
 * Handles dual-feed (Camera + Screen Share with PiP swap),
 * audio streams, automatic room overflow, peer data channels,
 * and peer moderation controls.
 */

class WebRTCRoomManager {
  constructor() {
    this.peer = null;
    this.peerId = null;
    this.roomId = null;
    this.isHost = false;

    // Streams
    this.localCamStream = null;
    this.localScreenStream = null;
    this.isDualFeedActive = false;
    this.isCamSwapped = false; // For PiP swap
    this.isScreenSharing = false;
    this.isCameraPrivacyActive = false;

    // Peer connections
    this.peers = new Map(); // peerId -> { call, dataConn, meta, videoEl, stream }
    this.maxRoomCapacity = 8;

    // Audio controls
    this.isMicMuted = true;
    this.isPushToTalkActive = false;
    this.isHandRaised = false;

    // Room state
    this.participants = new Map(); // uid -> data
  }

  // Generate a silent WebAudio track to ensure SDP negotiations never fail
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
      if (silentTrack) {
        stream.addTrack(silentTrack);
      }
    }
    return stream;
  }

  // Returns the active stream that peers should see (Screen share if sharing, else Camera)
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

  // Replace outgoing video track on all connected peers in real time (Zero reload)
  replaceOutgoingVideoTrack(newTrack) {
    if (!newTrack) return;
    this.peers.forEach((peerObj) => {
      if (peerObj.call && peerObj.call.peerConnection) {
        try {
          const senders = peerObj.call.peerConnection.getSenders();
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
    // Detect mobile touch devices: disable forcing getDisplayMedia on mobile
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.innerWidth < 768;
    this.isDualFeedActive = (mode === 'dual') && !isMobile;

    const camConstraints = {
      video: videoDeviceId ? { deviceId: { exact: videoDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } } : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
    };

    // 1. Attempt standard camera + mic
    try {
      this.localCamStream = await navigator.mediaDevices.getUserMedia(camConstraints);
    } catch (e1) {
      console.warn('[WebRTC] Exact getUserMedia constraints failed. Trying video-only fallback...', e1);
      try {
        this.localCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e2) {
        console.warn('[WebRTC] Camera unavailable or permission denied. Starting in standby avatar mode...', e2);
        const name = (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Scholar';
        this.localCamStream = this.createFallbackAvatarStream(name);
      }
    }

    // Ensure audio track is present
    this.ensureAudioTrack(this.localCamStream);

    // Mute mic by default during study session
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
        console.warn('[WebRTC] Screen share was declined or cancelled. Running camera-only mode:', screenErr);
        this.isDualFeedActive = false;
      }
    }

    // Attach streams to DOM elements based on layout mode
    const localCamVideo = document.getElementById('local-cam-video');
    const localScreenVideo = document.getElementById('local-screen-video');
    const pipWrapper = document.getElementById('local-pip-wrapper');
    const pipSwapBtn = document.getElementById('btn-pip-swap');
    const screenBtn = document.getElementById('toggle-screen-btn');

    if (this.isDualFeedActive && this.localScreenStream) {
      // Dual Feed: Screen is main feed, Camera is in PiP overlay
      if (localScreenVideo) {
        localScreenVideo.srcObject = this.localScreenStream;
        localScreenVideo.muted = true;
        localScreenVideo.play().catch(e => console.log('[WebRTC] Screen play:', e));
      }
      if (localCamVideo && this.localCamStream) {
        localCamVideo.srcObject = this.localCamStream;
        localCamVideo.muted = true;
        localCamVideo.play().catch(e => console.log('[WebRTC] Cam play:', e));
      }
      if (pipWrapper) pipWrapper.style.display = 'block';
      if (pipSwapBtn) pipSwapBtn.style.display = 'inline-flex';
      if (screenBtn) {
        screenBtn.innerHTML = '<span>🛑 Stop Sharing</span>';
        screenBtn.className = 'control-btn screen-active';
      }
    } else {
      // Single Camera / Mobile Mode: Camera takes up the FULL tile!
      if (localScreenVideo && this.localCamStream) {
        localScreenVideo.srcObject = this.localCamStream;
        localScreenVideo.muted = true;
        localScreenVideo.play().catch(e => console.log('[WebRTC] Main cam play:', e));
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

  // Generates an animated placeholder video stream if camera is unavailable
  createFallbackAvatarStream(displayName) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    const draw = () => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Gradient circle avatar
      const grad = ctx.createLinearGradient(160, 100, 480, 380);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(320, 200, 75, 0, Math.PI * 2);
      ctx.fill();

      // Emoji
      ctx.font = '64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎓', 320, 200);

      // Name
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(displayName || 'Scholar', 320, 320);

      // Status
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px sans-serif';
      ctx.fillText('LOCKED IN (Standby Cam)', 320, 355);
    };

    draw();
    setInterval(draw, 1000);
    return canvas.captureStream ? canvas.captureStream(5) : null;
  }

  // Connect to PeerJS Mesh with Deterministic Slot Allocation (Zero-Config Mesh)
  async joinStudyRoom(requestedRoomId, isPrivate = false, passcode = null) {
    this.roomId = requestedRoomId || 'focus-lobby-1';
    this.isPrivate = isPrivate;
    this.passcode = passcode ? String(passcode).trim() : null;

    // Clean room ID: lowercase, alphanumeric and dashes, max 24 chars
    const cleanRoom = (this.roomId || 'focus-lobby-1').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'lobby';
    this.cleanRoom = cleanRoom;

    // BroadcastChannel for instant same-browser / multi-tab discovery
    this.initBroadcastChannel(cleanRoom);

    // Find and claim an available deterministic slot (0..7)
    return new Promise((resolve, reject) => {
      this.attemptSlotAllocation(cleanRoom, 0, resolve, reject);
    });
  }

  initBroadcastChannel(cleanRoom) {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        if (this.broadcastChannel) this.broadcastChannel.close();
        this.broadcastChannel = new BroadcastChannel('lockedin_room_' + cleanRoom);
        this.broadcastChannel.onmessage = (e) => {
          const msg = e.data;
          if (!msg || !msg.peerId || msg.peerId === this.peerId) return;
          if (msg.type === 'PEER_JOINED' || msg.type === 'ANNOUNCE_SLOT') {
            if (!this.peers.has(msg.peerId)) {
              console.log('[BroadcastChannel] Discovered peer in room:', msg.peerId);
              this.callPeer(msg.peerId);
            }
          } else if (msg.type === 'PEER_LEFT') {
            this.removeRemoteTile(msg.peerId);
          }
        };
      } catch (err) {
        console.warn('[BroadcastChannel] Not supported or failed:', err);
      }
    }
  }

  postBroadcast(data) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(data);
      } catch (e) {}
    }
  }

  attemptSlotAllocation(cleanRoom, slotIndex, resolve, reject) {
    if (slotIndex >= this.maxRoomCapacity) {
      alert(`Room "${this.roomId}" is currently full (8/8 online). Please try another room.`);
      reject(new Error('Room full'));
      return;
    }

    const candidatePeerId = `li_${cleanRoom}_${slotIndex}`;
    console.log(`[WebRTC] Probing room slot ${slotIndex}: ${candidatePeerId}`);

    let isClaimed = false;
    let peer = null;

    try {
      peer = new window.Peer(candidatePeerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });
    } catch (e) {
      console.error('[WebRTC] Peer initialization failed:', e);
      reject(e);
      return;
    }

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && !isClaimed) {
        console.log(`[WebRTC] Slot ${slotIndex} (${candidatePeerId}) is in use. Trying next slot...`);
        try { peer.destroy(); } catch (e) {}
        setTimeout(() => {
          this.attemptSlotAllocation(cleanRoom, slotIndex + 1, resolve, reject);
        }, 120);
        return;
      }
      
      // Benign errors: clean up peer-unavailable for unoccupied slots
      if (err.type === 'peer-unavailable') {
        const match = err.message && err.message.match(/peer\s+([a-zA-Z0-9_-]+)/i);
        const failedId = match ? match[1] : null;
        if (failedId) {
          this.peers.delete(failedId);
          this.removeRemoteTile(failedId);
        }
        return;
      }

      console.warn('[WebRTC] Peer error:', err);
    });

    peer.on('open', (id) => {
      isClaimed = true;
      this.mySlot = slotIndex;
      this.peerId = id;
      this.peer = peer;
      console.log(`[WebRTC] 🚀 Connected as slot ${slotIndex} (${id}) in room: ${this.roomId}`);
      this.updateRoomHeader();

      // Setup incoming event handlers on this peer
      this.setupPeerListeners();

      // Post local broadcast
      this.postBroadcast({
        type: 'PEER_JOINED',
        peerId: this.peerId,
        slot: this.mySlot
      });

      // Firebase sync if configured
      if (window.FirebaseSync && window.FirebaseSync.isConfigured) {
        const myUid = (window.Leaderboard && window.Leaderboard.currentUser.uid) || 'u' + Math.random().toString(36).substring(2, 7);
        window.FirebaseSync.joinRoom(this.roomId, {
          userId: myUid,
          displayName: (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Scholar',
          peerId: this.peerId,
          status: 'LOCKED_IN',
          isHandRaised: false
        });
        window.FirebaseSync.listenToRoomEvents(this.roomId, (event) => {
          this.handleIncomingData(event);
        });
        window.FirebaseSync.listenToRoom(this.roomId, (participantList) => {
          participantList.forEach(p => {
            if (p.peerId && p.peerId !== this.peerId && !this.peers.has(p.peerId)) {
              this.callPeer(p.peerId, p);
            }
          });
        });
      }

      // Connect to other 7 deterministic slots in this room
      this.connectToRoomMesh();

      // Start periodic probe loop for dynamic arrivals/departures
      this.startMeshProbeLoop();

      resolve(this.peerId);
    });
  }

  setupPeerListeners() {
    if (!this.peer) return;

    // Handle Incoming Calls (Media Streams)
    this.peer.on('call', (call) => {
      console.log(`[WebRTC] Incoming call from peer: ${call.peer}`);
      call.answer(this.getOutgoingStream());
      this.handlePeerCall(call);

      // Connect reciprocal data connection if not present
      if (!this.peers.has(call.peer) || !this.peers.get(call.peer).dataConn) {
        const conn = this.peer.connect(call.peer);
        this.handleDataConnection(conn);
      }
    });

    // Handle Incoming Data Connections
    this.peer.on('connection', (conn) => {
      console.log(`[WebRTC] Incoming data connection from: ${conn.peer}`);
      this.handleDataConnection(conn);
    });
  }

  connectToRoomMesh() {
    for (let s = 0; s < this.maxRoomCapacity; s++) {
      if (s === this.mySlot) continue;
      const targetPeerId = `li_${this.cleanRoom}_${s}`;
      if (!this.peers.has(targetPeerId)) {
        this.callPeer(targetPeerId);
      }
    }
  }

  startMeshProbeLoop() {
    if (this.meshProbeInterval) clearInterval(this.meshProbeInterval);
    this.meshProbeInterval = setInterval(() => {
      if (!this.peer || this.peer.destroyed) return;
      for (let s = 0; s < this.maxRoomCapacity; s++) {
        if (s === this.mySlot) continue;
        const targetPeerId = `li_${this.cleanRoom}_${s}`;
        if (!this.peers.has(targetPeerId)) {
          this.callPeer(targetPeerId);
        }
      }
    }, 4500);
  }

  // Call a peer with our active outgoing stream & establish data connection
  callPeer(remotePeerId, meta = {}) {
    if (!this.peer || this.peer.destroyed || this.peers.has(remotePeerId)) return;

    try {
      const call = this.peer.call(remotePeerId, this.getOutgoingStream(), {
        metadata: {
          displayName: (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Student',
          subject: (window.Leaderboard && window.Leaderboard.currentUser.subjectGoal) || 'Focus',
          isDualFeed: this.isDualFeedActive,
          passcode: this.passcode,
          slot: this.mySlot
        }
      });
      if (call) {
        this.handlePeerCall(call, meta);
      }

      const conn = this.peer.connect(remotePeerId);
      if (conn) {
        this.handleDataConnection(conn);
      }
    } catch (e) {
      console.warn('[WebRTC] Error calling peer:', e);
    }
  }

  handlePeerCall(call, initialMeta = {}) {
    const remotePeerId = call.peer;

    call.on('stream', (remoteStream) => {
      console.log(`[WebRTC] Received remote stream from ${remotePeerId}`);
      if (!this.peers.has(remotePeerId)) {
        this.peers.set(remotePeerId, {});
      }
      this.peers.get(remotePeerId).stream = remoteStream;
      this.peers.get(remotePeerId).call = call;
      this.renderRemoteTile(remotePeerId, remoteStream, call.metadata || initialMeta);
      this.updateRoomParticipantCount();
    });

    call.on('close', () => {
      this.removeRemoteTile(remotePeerId);
    });

    call.on('error', (err) => {
      console.warn('[WebRTC] Call error with peer:', remotePeerId, err);
      this.removeRemoteTile(remotePeerId);
    });
  }

  handleDataConnection(conn) {
    const remotePeerId = conn.peer;

    conn.on('open', () => {
      console.log(`[WebRTC] Data channel established with ${remotePeerId}`);
      if (!this.peers.has(remotePeerId)) {
        this.peers.set(remotePeerId, {});
      }
      this.peers.get(remotePeerId).dataConn = conn;
      this.updateRoomParticipantCount();

      // Send initial state handshake with passcode
      conn.send({
        type: 'HANDSHAKE',
        displayName: (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Student',
        subject: (window.Leaderboard && window.Leaderboard.currentUser.subjectGoal) || 'Focus',
        points: (window.Leaderboard && window.Leaderboard.currentUser.totalPoints) || 0,
        status: 'LOCKED_IN',
        isHandRaised: this.isHandRaised,
        passcode: this.passcode,
        slot: this.mySlot
      });

      // If we are authenticated Admin, automatically push our custom soundboard to this peer!
      if (window.Soundboard && window.Soundboard.isAdminAuthenticated) {
        conn.send({
          type: 'ADMIN_SOUNDBOARD_SYNC',
          adminName: (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Admin',
          soundConfigs: window.Soundboard.getExportableConfigs()
        });
      }
    });

    conn.on('data', (data) => {
      this.handleIncomingData(data, remotePeerId);
    });

    conn.on('close', () => {
      this.removeRemoteTile(remotePeerId);
    });

    conn.on('error', (err) => {
      console.warn('[WebRTC] Data channel error with peer:', remotePeerId, err);
      this.removeRemoteTile(remotePeerId);
    });
  }

  // Broadcast data payload to all connected peers
  broadcastData(payload) {
    this.peers.forEach((peerObj) => {
      if (peerObj.dataConn && peerObj.dataConn.open) {
        peerObj.dataConn.send(payload);
      }
    });

    if (window.FirebaseSync) {
      window.FirebaseSync.broadcastEvent(this.roomId, payload);
    }
  }

  // Handle Incoming Data Messages
  handleIncomingData(data, senderPeerId) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'ADMIN_SOUNDBOARD_SYNC':
        if (data.soundConfigs && window.Soundboard) {
          console.log('[WebRTC] Received room-wide soundboard sync from Admin:', data.adminName);
          window.Soundboard.applyRemoteSoundConfigs(data.soundConfigs);
          if (window.TriggerEngine && window.TriggerEngine.showShameToast) {
            window.TriggerEngine.showShameToast(`🔊 Custom sounds synced from Admin (${data.adminName || 'Admin'})!`);
          }
        }
        break;

      case 'HANDSHAKE':
        this.updateRemoteTileHUD(senderPeerId, data);
        if (window.Leaderboard && window.Leaderboard.upsertPeer) {
          window.Leaderboard.upsertPeer({
            uid: senderPeerId,
            displayName: data.displayName,
            subject: data.subject,
            points: data.points
          });
        }
        break;

      case 'CAMERA_PRIVACY_TOGGLED': {
        const tile = document.getElementById(`tile-${senderPeerId}`);
        if (tile) {
          const avatar = tile.querySelector('.remote-avatar-card');
          const video = tile.querySelector('video');
          if (data.isCameraOff) {
            if (avatar) avatar.classList.remove('hidden');
            if (video) video.style.opacity = '0';
          } else {
            if (avatar) avatar.classList.add('hidden');
            if (video) video.style.opacity = '1';
          }
        }
        break;
      }

      case 'SCREEN_SHARE_STARTED': {
        const tile = document.getElementById(`tile-${senderPeerId}`);
        if (tile) {
          const badge = tile.querySelector('.subject-badge');
          if (badge) badge.textContent = '🖥️ Screen Sharing';
          const avatar = tile.querySelector('.remote-avatar-card');
          const video = tile.querySelector('video');
          if (avatar) avatar.classList.add('hidden');
          if (video) video.style.opacity = '1';
        }
        break;
      }

      case 'SCREEN_SHARE_STOPPED': {
        const tile = document.getElementById(`tile-${senderPeerId}`);
        if (tile) {
          const badge = tile.querySelector('.subject-badge');
          if (badge) badge.textContent = 'Deep Focus';
        }
        break;
      }

      case 'TIMER_SYNC':
        if (!this.isHost && window.StudyTimer && window.StudyTimer.isSyncedWithHost) {
          window.StudyTimer.syncFromHost(data);
        }
        break;

      case 'HAND_RAISE':
        this.setRemoteHandRaise(data.userId || senderPeerId, data.isRaised);
        break;

      case 'USER_SHAMED':
        this.applyRemoteShame(data);
        break;

      case 'SHAME_CLEARED':
        this.clearRemoteShame(data.userId);
        break;

      case 'PEER_CALLOUT_VOTE':
        if (window.TriggerEngine) {
          window.TriggerEngine.recordPeerCallout(data.targetUserId, data.triggerId, data.triggerName, data.voterId);
        }
        break;

      case 'ADMIN_MUTE':
        if (data.targetUserId === (window.Leaderboard && window.Leaderboard.currentUser.uid)) {
          this.muteMic(true);
          alert('You were muted by a Room Admin.');
        }
        break;

      case 'ADMIN_KICK':
        if (data.targetUserId === (window.Leaderboard && window.Leaderboard.currentUser.uid)) {
          alert('You have been removed from the study room by an Admin.');
          window.location.reload();
        }
        break;

      case 'NOW_LISTENING':
        this.updateRemoteListeningStatus(senderPeerId, data);
        break;

      default:
        break;
    }
  }

  // Render Remote Participant Video Tile (Max 8 Grid)
  renderRemoteTile(remotePeerId, stream, meta) {
    const grid = document.getElementById('study-grid');
    if (!grid) return;

    // Check if tile already exists
    let tile = document.getElementById(`tile-${remotePeerId}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.id = `tile-${remotePeerId}`;
      tile.className = 'study-tile remote-tile';

      const displayName = meta.displayName || 'Peer_' + remotePeerId.slice(-4);
      const subject = meta.subject || 'Deep Focus';

      tile.innerHTML = `
        <div class="video-container">
          <video autoplay playsinline class="remote-video"></video>
          <div class="tile-avatar-card remote-avatar-card hidden">
            <div class="avatar-circle">${this.escapeHtml((displayName.trim().slice(0, 2)).toUpperCase())}</div>
            <span class="avatar-title">${this.escapeHtml(displayName)}</span>
            <span class="avatar-status">🔒 Camera Off (Privacy Mode)</span>
          </div>
        </div>
        <div class="tile-hud">
          <div class="hud-top">
            <span class="user-badge">${this.escapeHtml(displayName)}</span>
            <span class="subject-badge">${this.escapeHtml(subject)}</span>
            <span class="listening-badge-remote hidden">🎧</span>
            <span class="points-pill">150 pts</span>
          </div>
          <div class="hud-bottom">
            <div class="timer-display-remote">25:00</div>
            <span class="status-pill status-locked">LOCKED IN</span>
            <span class="hand-indicator hidden">✋ Hand Raised</span>
          </div>
        </div>
        <div class="peer-mod-overlay">
          <button class="mod-btn mute-tile-btn" title="Mute audio locally">🔊 Mute</button>
          <button class="mod-btn hide-tile-btn" title="Hide video">👁️ Hide</button>
          <button class="mod-btn snitch-btn" title="Call out distraction">🎯 Call Out</button>
          <div class="snitch-menu hidden">
            <button data-trigger="PEER_NON_STUDY_MUSIC">🎶 Not Study Music!</button>
            <button data-trigger="PEER_NON_STUDY_CONTENT">📺 Non-Study Screen</button>
            <button data-trigger="PEER_DOOMSCROLLING">📱 Doomscrolling</button>
            <button data-trigger="PEER_ON_PHONE">🤳 On Phone</button>
            <button data-trigger="PEER_ZONING_OUT">😴 Zoning Out</button>
            <button data-trigger="PEER_WAKE_UP_NUDGE">⚡ Wake Up Nudge!</button>
          </div>
        </div>
      `;

      grid.appendChild(tile);
      this.setupTileModerationEvents(tile, remotePeerId);
    }

    const videoEl = tile.querySelector('video');
    const avatarCard = tile.querySelector('.remote-avatar-card');

    if (videoEl && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.autoplay = true;

      const videoTrack = stream && stream.getVideoTracks()[0];
      if (videoTrack) {
        if (!videoTrack.enabled) {
          if (avatarCard) avatarCard.classList.remove('hidden');
        } else {
          if (avatarCard) avatarCard.classList.add('hidden');
        }

        videoTrack.addEventListener('mute', () => {
          if (avatarCard) avatarCard.classList.remove('hidden');
        });
        videoTrack.addEventListener('unmute', () => {
          if (avatarCard) avatarCard.classList.add('hidden');
        });
      }

      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('[WebRTC] Autoplay unmuted was blocked. Falling back to muted playback:', err);
          videoEl.muted = true;
          videoEl.play().catch(e => console.error('[WebRTC] Remote video playback failed:', e));
        });
      }
    }

    this.updateRoomParticipantCount();
  }

  setupTileModerationEvents(tile, remotePeerId) {
    const videoEl = tile.querySelector('video');
    const muteBtn = tile.querySelector('.mute-tile-btn');
    const hideBtn = tile.querySelector('.hide-tile-btn');
    const snitchBtn = tile.querySelector('.snitch-btn');
    const snitchMenu = tile.querySelector('.snitch-menu');

    if (muteBtn && videoEl) {
      muteBtn.addEventListener('click', () => {
        videoEl.muted = !videoEl.muted;
        muteBtn.textContent = videoEl.muted ? '🔇 Unmute' : '🔊 Mute';
      });
    }

    if (hideBtn && videoEl) {
      hideBtn.addEventListener('click', () => {
        videoEl.style.opacity = (videoEl.style.opacity === '0') ? '1' : '0';
        hideBtn.textContent = (videoEl.style.opacity === '0') ? '👁️ Show' : '👁️ Hide';
      });
    }

    if (snitchBtn && snitchMenu) {
      snitchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        snitchMenu.classList.toggle('hidden');
      });

      snitchMenu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const triggerId = btn.getAttribute('data-trigger');
          const triggerDef = (window.TRIGGER_DEFINITIONS || []).find(t => t.id === triggerId);
          const reason = triggerDef ? triggerDef.name : 'Peer Distraction Callout';
          const myUid = (window.Leaderboard && window.Leaderboard.currentUser.uid) || 'peer';

          this.broadcastData({
            type: 'PEER_CALLOUT_VOTE',
            targetUserId: remotePeerId,
            triggerId,
            triggerName: reason,
            voterId: myUid
          });

          snitchMenu.classList.add('hidden');
          alert(`Callout vote registered: "${reason}". If confirmed by peers/admin, points will be penalized.`);
        });
      });
    }
  }

  removeRemoteTile(remotePeerId) {
    const tile = document.getElementById(`tile-${remotePeerId}`);
    if (tile) tile.remove();
    this.peers.delete(remotePeerId);
    this.updateRoomParticipantCount();
  }

  updateRemoteTileHUD(remotePeerId, data) {
    const tile = document.getElementById(`tile-${remotePeerId}`);
    if (!tile) return;
    if (data.displayName) {
      tile.querySelector('.user-badge').textContent = data.displayName;
    }
    if (data.subject) {
      tile.querySelector('.subject-badge').textContent = data.subject;
    }
    if (data.points !== undefined) {
      tile.querySelector('.points-pill').textContent = `${data.points} pts`;
    }
  }

  updateRemoteListeningStatus(remotePeerId, data) {
    const tile = document.getElementById(`tile-${remotePeerId}`);
    if (!tile) return;
    const badge = tile.querySelector('.listening-badge-remote');
    if (!badge) return;

    if (!data.trackTitle || data.trackTitle === 'None') {
      badge.classList.add('hidden');
    } else {
      badge.classList.remove('hidden');
      badge.innerHTML = `🎧 ${this.escapeHtml(data.trackTitle)}`;
      if (data.isStudyApproved) {
        badge.className = 'listening-badge-remote listening-badge study-approved';
      } else {
        badge.className = 'listening-badge-remote listening-badge non-study-warning';
      }
    }
  }

  setRemoteHandRaise(remotePeerId, isRaised) {
    const tile = document.getElementById(`tile-${remotePeerId}`);
    if (!tile) return;
    const handIndicator = tile.querySelector('.hand-indicator');
    if (handIndicator) {
      if (isRaised) {
        handIndicator.classList.remove('hidden');
        tile.classList.add('hand-raised-glow');
        if (window.Soundboard) window.Soundboard.playSynthesizedTone('gentle_chime', 0.5);
      } else {
        handIndicator.classList.add('hidden');
        tile.classList.remove('hand-raised-glow');
      }
    }
  }

  applyRemoteShame(event) {
    const tile = document.getElementById(`tile-${event.userId}`);
    if (tile) {
      const statusPill = tile.querySelector('.status-pill');
      if (statusPill) {
        statusPill.textContent = `SHAMED: ${event.triggerName}`;
        statusPill.className = 'status-pill status-shamed';
      }
      // Add red X
      const timerDisplay = tile.querySelector('.timer-display-remote');
      if (timerDisplay) {
        timerDisplay.classList.add('timer-struck-red-x');
        setTimeout(() => timerDisplay.classList.remove('timer-struck-red-x'), 5000);
      }
      // Show shame stamp badge on remote peer tile
      const existingBadge = tile.querySelector('.shame-stamp-badge');
      if (existingBadge) existingBadge.remove();
      const badge = document.createElement('div');
      badge.className = 'shame-stamp-badge slam-animation';
      badge.innerHTML = `<span>🚨 SHAMED</span><small>${this.escapeHtml(event.triggerName)}</small>`;
      tile.appendChild(badge);
    }

    if (window.Soundboard) {
      if (event.audioUrl) {
        window.Soundboard.playAudioFromUrl(event.audioUrl, event.triggerId);
      } else {
        window.Soundboard.playTrigger(event.triggerId);
      }
    }
  }

  clearRemoteShame(userId) {
    const tile = document.getElementById(`tile-${userId}`);
    if (tile) {
      const statusPill = tile.querySelector('.status-pill');
      if (statusPill) {
        statusPill.textContent = 'LOCKED IN';
        statusPill.className = 'status-pill status-locked';
      }
      const existingBadge = tile.querySelector('.shame-stamp-badge');
      if (existingBadge) {
        existingBadge.style.transition = 'opacity 0.6s ease';
        existingBadge.style.opacity = '0';
        setTimeout(() => existingBadge.remove(), 600);
      }
    }
  }

  // Microphones & Push to Talk
  muteMic(shouldMute) {
    this.isMicMuted = shouldMute;
    if (this.localCamStream) {
      const track = this.localCamStream.getAudioTracks()[0];
      if (track) track.enabled = !shouldMute;
    }
    const micBtn = document.getElementById('toggle-mic-btn');
    if (micBtn) {
      micBtn.innerHTML = shouldMute ? '<span>🎤 Unmute</span>' : '<span>🎙️ Mute</span>';
      micBtn.className = shouldMute ? 'control-btn mic-muted' : 'control-btn mic-active';
    }
  }

  // Camera Privacy Toggle (Zoom Style)
  toggleCamera() {
    this.isCameraPrivacyActive = !this.isCameraPrivacyActive;

    if (this.localCamStream) {
      const videoTrack = this.localCamStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !this.isCameraPrivacyActive;
      }
    }

    const avatarCard = document.getElementById('local-avatar-card');
    const localScreenVideo = document.getElementById('local-screen-video');
    const localCamVideo = document.getElementById('local-cam-video');
    const camBtn = document.getElementById('toggle-cam-btn');

    if (this.isCameraPrivacyActive) {
      if (avatarCard && !this.isScreenSharing) avatarCard.classList.remove('hidden');
      if (localScreenVideo && !this.isScreenSharing) localScreenVideo.style.opacity = '0';
      if (localCamVideo) localCamVideo.style.opacity = '0';
      if (camBtn) {
        camBtn.innerHTML = '<span>📷 Start Video</span>';
        camBtn.className = 'control-btn cam-muted';
      }
    } else {
      if (avatarCard) avatarCard.classList.add('hidden');
      if (localScreenVideo) localScreenVideo.style.opacity = '1';
      if (localCamVideo) localCamVideo.style.opacity = '1';
      if (camBtn) {
        camBtn.innerHTML = '<span>📹 Stop Video</span>';
        camBtn.className = 'control-btn cam-active';
      }
    }

    this.broadcastData({
      type: 'CAMERA_PRIVACY_TOGGLED',
      userId: (window.Leaderboard && window.Leaderboard.currentUser.uid) || this.peerId,
      isCameraOff: this.isCameraPrivacyActive
    });

    if (window.TriggerEngine && window.TriggerEngine.showShameToast) {
      window.TriggerEngine.showShameToast(this.isCameraPrivacyActive ? '🔒 Camera paused (Privacy Mode)' : '📹 Camera resumed');
    }
  }

  // Screen Share Toggle (Zoom Style)
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
        alert('Screen sharing is not supported on this device/browser.');
        return;
      }

      this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      this.isScreenSharing = true;
      const screenVidTrack = this.localScreenStream.getVideoTracks()[0];

      // Replace outgoing video track on all active peer connections
      this.replaceOutgoingVideoTrack(screenVidTrack);

      // Update Local Tile
      const localScreenVideo = document.getElementById('local-screen-video');
      const localCamVideo = document.getElementById('local-cam-video');
      const pipWrapper = document.getElementById('local-pip-wrapper');
      const pipSwapBtn = document.getElementById('btn-pip-swap');
      const avatarCard = document.getElementById('local-avatar-card');

      if (avatarCard) avatarCard.classList.add('hidden');
      if (localScreenVideo) {
        localScreenVideo.srcObject = this.localScreenStream;
        localScreenVideo.style.opacity = '1';
        localScreenVideo.play().catch(e => console.log(e));
      }
      if (localCamVideo && this.localCamStream) {
        localCamVideo.srcObject = this.localCamStream;
        localCamVideo.play().catch(e => console.log(e));
      }
      if (pipWrapper) pipWrapper.style.display = 'block';
      if (pipSwapBtn) pipSwapBtn.style.display = 'inline-flex';

      const screenBtn = document.getElementById('toggle-screen-btn');
      if (screenBtn) {
        screenBtn.innerHTML = '<span>🛑 Stop Sharing</span>';
        screenBtn.className = 'control-btn screen-active';
      }

      screenVidTrack.onended = () => {
        this.stopScreenShare();
      };

      this.broadcastData({
        type: 'SCREEN_SHARE_STARTED',
        userId: (window.Leaderboard && window.Leaderboard.currentUser.uid) || this.peerId
      });

      if (window.TriggerEngine && window.TriggerEngine.showShameToast) {
        window.TriggerEngine.showShameToast('🖥️ Screen sharing is now live to all peers!');
      }
    } catch (err) {
      console.warn('[WebRTC] getDisplayMedia error/cancelled:', err);
    }
  }

  stopScreenShare() {
    if (!this.isScreenSharing) return;
    this.isScreenSharing = false;

    if (this.localScreenStream) {
      try {
        this.localScreenStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      this.localScreenStream = null;
    }

    // Revert outgoing video track back to camera
    const camTrack = this.localCamStream && this.localCamStream.getVideoTracks()[0];
    if (camTrack) {
      this.replaceOutgoingVideoTrack(camTrack);
    }

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
      userId: (window.Leaderboard && window.Leaderboard.currentUser.uid) || this.peerId
    });
  }

  toggleRaiseHand() {
    this.isHandRaised = !this.isHandRaised;
    const handBtn = document.getElementById('raise-hand-btn');
    const localIndicator = document.getElementById('local-hand-indicator');

    if (this.isHandRaised) {
      if (handBtn) handBtn.classList.add('active-hand');
      if (localIndicator) localIndicator.classList.remove('hidden');
      if (window.Soundboard) window.Soundboard.playSynthesizedTone('gentle_chime', 0.6);
    } else {
      if (handBtn) handBtn.classList.remove('active-hand');
      if (localIndicator) localIndicator.classList.add('hidden');
    }

    this.broadcastData({
      type: 'HAND_RAISE',
      userId: (window.Leaderboard && window.Leaderboard.currentUser.uid) || this.peerId,
      isRaised: this.isHandRaised
    });
  }

  // Picture in Picture Swap
  swapPiP() {
    if (!this.isDualFeedActive) return;
    this.isCamSwapped = !this.isCamSwapped;
    const localCamVideo = document.getElementById('local-cam-video');
    const localScreenVideo = document.getElementById('local-screen-video');
    if (localCamVideo && localScreenVideo) {
      const temp = localScreenVideo.srcObject;
      localScreenVideo.srcObject = localCamVideo.srcObject;
      localCamVideo.srcObject = temp;
    }
    const localTile = document.getElementById('local-user-tile');
    if (localTile) {
      localTile.classList.toggle('pip-swapped', this.isCamSwapped);
    }
  }

  updateTileLayout() {
    const localTile = document.getElementById('local-user-tile');
    if (!localTile) return;

    if (this.isDualFeedActive) {
      localTile.classList.add('dual-feed');
      localTile.classList.remove('cam-only');
    } else {
      localTile.classList.remove('dual-feed');
      localTile.classList.add('cam-only');
    }
  }

  updateRoomHeader() {
    const roomBadge = document.getElementById('room-id-badge');
    if (roomBadge) {
      if (this.isPrivate) {
        roomBadge.innerHTML = `🔒 Private: <strong>${this.escapeHtml(this.roomId)}</strong>`;
        roomBadge.style.borderColor = '#6366f1';
        roomBadge.style.color = '#c7d2fe';
      } else {
        const cleanName = this.roomId.replace(/^focus-/, '').replace(/^lockedin-/, '');
        roomBadge.innerHTML = `🌐 Public: <strong>${this.escapeHtml(cleanName)}</strong>`;
        roomBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        roomBadge.style.color = '#a7f3d0';
      }
    }
    this.updateRoomParticipantCount();
  }

  updateRoomParticipantCount() {
    let activePeers = 0;
    this.peers.forEach((p, id) => {
      const hasStream = p.stream && p.stream.active;
      const hasConn = p.dataConn && p.dataConn.open;
      const hasTile = !!document.getElementById(`tile-${id}`);
      if (hasStream || hasConn || hasTile) {
        activePeers++;
      }
    });

    const total = 1 + activePeers;
    const countBadge = document.getElementById('room-count-badge');
    if (countBadge) {
      countBadge.innerHTML = `<span style="color:#10b981; font-weight:800;">🟢 ${total}</span> Active ${total === 1 ? 'Scholar' : 'Scholars'}`;
      countBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    }

    const headerActivePill = document.getElementById('header-live-active-pill');
    if (headerActivePill) {
      headerActivePill.textContent = `🟢 ${total} Active`;
    }
  }

  leaveStudyRoom() {
    console.log('[WebRTC] Leaving study room...');

    // Stop local camera and screen share tracks
    if (this.localCamStream) {
      try {
        this.localCamStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      this.localCamStream = null;
    }
    if (this.localScreenStream) {
      try {
        this.localScreenStream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      this.localScreenStream = null;
    }

    // Clear video elements
    const localCamVideo = document.getElementById('local-cam-video');
    if (localCamVideo) localCamVideo.srcObject = null;
    const localScreenVideo = document.getElementById('local-screen-video');
    if (localScreenVideo) localScreenVideo.srcObject = null;

    // Clear mesh probe loop
    if (this.meshProbeInterval) {
      clearInterval(this.meshProbeInterval);
      this.meshProbeInterval = null;
    }

    // Post broadcast that we are leaving
    this.postBroadcast({
      type: 'PEER_LEFT',
      peerId: this.peerId,
      slot: this.mySlot
    });

    // Close all peer calls and connections
    this.peers.forEach((p, remoteId) => {
      try { p.call?.close(); } catch(e){}
      try { p.dataConn?.close(); } catch(e){}
      const tile = document.getElementById(`tile-${remoteId}`);
      if (tile) tile.remove();
    });
    this.peers.clear();

    // Destroy Peer instance so slot is immediately released
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {}
      this.peer = null;
    }

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch (e) {}
      this.broadcastChannel = null;
    }

    // Stop AI Trigger Engine
    if (window.TriggerEngine) {
      window.TriggerEngine.stopMonitoring();
    }

    // Pause timer
    if (window.StudyTimer) {
      window.StudyTimer.pauseTimer();
    }

    // Reset Header Badges
    const roomBadge = document.getElementById('room-id-badge');
    if (roomBadge) {
      roomBadge.innerHTML = 'Lobby';
      roomBadge.style.color = '';
      roomBadge.style.borderColor = '';
    }
    const countBadge = document.getElementById('room-count-badge');
    if (countBadge) {
      countBadge.textContent = '1/8 Online';
    }

    // Hide Leave buttons
    const leaveBtnHeader = document.getElementById('btn-leave-room-header');
    if (leaveBtnHeader) leaveBtnHeader.style.display = 'none';

    // Switch view back to Lobby
    const studyView = document.getElementById('study-room-view');
    const lobbyView = document.getElementById('lobby-view');
    if (studyView) studyView.classList.add('hidden');
    if (lobbyView) lobbyView.classList.remove('hidden');
  }

  getPeerCount() {
    return 1 + this.peers.size;
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.WebRTCRoom = new WebRTCRoomManager();
