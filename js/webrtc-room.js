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

    // Peer connections
    this.peers = new Map(); // peerId -> { call, dataConn, meta, videoEl }
    this.maxRoomCapacity = 8;

    // Audio controls
    this.isMicMuted = true;
    this.isPushToTalkActive = false;
    this.isHandRaised = false;

    // Room state
    this.participants = new Map(); // uid -> data
  }

  // Initialize Local Media Streams
  async initLocalMedia({ mode, videoDeviceId, audioDeviceId }) {
    this.isDualFeedActive = (mode === 'dual');

    try {
      // 1. Get Camera + Mic Stream
      const camConstraints = {
        video: videoDeviceId ? { deviceId: { exact: videoDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } } : { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
      };

      this.localCamStream = await navigator.mediaDevices.getUserMedia(camConstraints);
      // Mute audio by default during study session
      this.muteMic(true);

      // Attach to Local Camera Video
      const localCamVideo = document.getElementById('local-cam-video');
      if (localCamVideo) {
        localCamVideo.srcObject = this.localCamStream;
        localCamVideo.muted = true;
      }

      // 2. If Dual Feed requested, request Screen Share
      if (this.isDualFeedActive) {
        try {
          if (navigator.mediaDevices.getDisplayMedia) {
            this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
              video: { cursor: 'always' },
              audio: false
            });

            const localScreenVideo = document.getElementById('local-screen-video');
            if (localScreenVideo) {
              localScreenVideo.srcObject = this.localScreenStream;
              localScreenVideo.muted = true;
            }

            // Detect user stopping screen share from browser banner
            this.localScreenStream.getVideoTracks()[0].onended = () => {
              if (window.TriggerEngine) {
                window.TriggerEngine.triggerCandidate('SCREEN_OFF_MID_SESSION', 'Screen sharing was ended!');
              }
            };
          } else {
            console.warn('[WebRTC] getDisplayMedia not supported on this browser/device; falling back to single cam.');
            this.isDualFeedActive = false;
          }
        } catch (screenErr) {
          console.warn('[WebRTC] Screen share was declined or cancelled. Running camera-only mode:', screenErr);
          this.isDualFeedActive = false;
        }
      }

      this.updateTileLayout();
      return true;
    } catch (err) {
      console.error('[WebRTC] Failed to access local camera/mic:', err);
      alert('Camera access is required for accountability verification. Please check browser camera permissions.');
      return false;
    }
  }

  // Connect to PeerJS Mesh
  async joinStudyRoom(requestedRoomId, isPrivate = false, passcode = null) {
    this.roomId = requestedRoomId || 'focus-lobby-1';
    this.isPrivate = isPrivate;
    this.passcode = passcode ? String(passcode).trim() : null;

    // Construct a sanitized peer ID
    const myUid = (window.Leaderboard && window.Leaderboard.currentUser.uid) || 'u' + Math.random().toString(36).substring(2, 7);
    this.peerId = `${this.roomId}_${myUid}`;

    return new Promise((resolve, reject) => {
      // Connect to free public PeerServer cloud
      this.peer = new window.Peer(this.peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        console.log(`[WebRTC] Connected to PeerServer as ${id} in room: ${this.roomId}`);
        this.updateRoomHeader();

        // Register with Firebase cloud presence if enabled
        if (window.FirebaseSync) {
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
        }

        // Query open peers in room via room naming convention or connect
        this.discoverAndConnectPeers();
        resolve(this.peerId);
      });

      // Handle Incoming Calls (Media Streams)
      this.peer.on('call', (call) => {
        const streamToSend = this.localCamStream;
        call.answer(streamToSend);
        this.handlePeerCall(call);
      });

      // Handle Incoming Data Connections
      this.peer.on('connection', (conn) => {
        this.handleDataConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.warn('[WebRTC] Peer error:', err);
        // Handle automatic room overflow if room capacity reached
        if (err.type === 'unavailable-id') {
          console.log('[WebRTC] ID collision, shifting to alternate peer ID...');
        }
      });
    });
  }

  // Discover peers in the current room
  discoverAndConnectPeers() {
    // In decentralized mesh mode without central signaling server query,
    // we broadcast heartbeat / probe known participants or sync via Firebase
    if (window.FirebaseSync && window.FirebaseSync.isConfigured) {
      window.FirebaseSync.listenToRoom(this.roomId, (participantList) => {
        participantList.forEach(p => {
          if (p.peerId && p.peerId !== this.peerId && !this.peers.has(p.peerId)) {
            this.callPeer(p.peerId, p);
          }
        });
      });
    }
  }

  // Call a peer with our local camera stream & establish data connection
  callPeer(remotePeerId, meta = {}) {
    if (!this.peer || this.peers.has(remotePeerId)) return;

    try {
      const call = this.peer.call(remotePeerId, this.localCamStream, {
        metadata: {
          displayName: (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Student',
          subject: (window.Leaderboard && window.Leaderboard.currentUser.subjectGoal) || 'Focus',
          isDualFeed: this.isDualFeedActive
        }
      });
      this.handlePeerCall(call, meta);

      const conn = this.peer.connect(remotePeerId);
      this.handleDataConnection(conn);
    } catch (e) {
      console.warn('[WebRTC] Error calling peer:', e);
    }
  }

  handlePeerCall(call, initialMeta = {}) {
    const remotePeerId = call.peer;

    call.on('stream', (remoteStream) => {
      console.log(`[WebRTC] Received remote stream from ${remotePeerId}`);
      this.renderRemoteTile(remotePeerId, remoteStream, call.metadata || initialMeta);
    });

    call.on('close', () => {
      this.removeRemoteTile(remotePeerId);
    });

    call.on('error', (err) => {
      console.warn('[WebRTC] Call error with peer:', remotePeerId, err);
      this.removeRemoteTile(remotePeerId);
    });

    if (!this.peers.has(remotePeerId)) {
      this.peers.set(remotePeerId, {});
    }
    this.peers.get(remotePeerId).call = call;
  }

  handleDataConnection(conn) {
    const remotePeerId = conn.peer;

    conn.on('open', () => {
      console.log(`[WebRTC] Data channel established with ${remotePeerId}`);
      // Send initial state handshake
      conn.send({
        type: 'HANDSHAKE',
        displayName: (window.Leaderboard && window.Leaderboard.currentUser.displayName) || 'Student',
        subject: (window.Leaderboard && window.Leaderboard.currentUser.subjectGoal) || 'Focus',
        points: (window.Leaderboard && window.Leaderboard.currentUser.totalPoints) || 0,
        status: 'LOCKED_IN',
        isHandRaised: this.isHandRaised
      });
    });

    conn.on('data', (data) => {
      this.handleIncomingData(data, remotePeerId);
    });

    conn.on('close', () => {
      this.removeRemoteTile(remotePeerId);
    });

    if (!this.peers.has(remotePeerId)) {
      this.peers.set(remotePeerId, {});
    }
    this.peers.get(remotePeerId).dataConn = conn;
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
      case 'HANDSHAKE':
        this.updateRemoteTileHUD(senderPeerId, data);
        break;

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
    if (videoEl && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
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
    }

    if (window.Soundboard) {
      window.Soundboard.playTrigger(event.triggerId);
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
      micBtn.innerHTML = shouldMute ? '<span>🎤 Unmute</span>' : '<span>🎙️ Muted (Live)</span>';
      micBtn.className = shouldMute ? 'control-btn mic-muted' : 'control-btn mic-active';
    }
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
    this.isCamSwapped = !this.isCamSwapped;
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
    const countBadge = document.getElementById('room-count-badge');
    if (countBadge) {
      const total = 1 + this.peers.size;
      countBadge.textContent = `${total}/${this.maxRoomCapacity} Online`;
    }
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
