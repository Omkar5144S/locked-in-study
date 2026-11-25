/**
 * LOCKED-IN: Main Application Coordinator
 * Binds UI controls, lobby flow, grid rendering, Admin Studio,
 * drawers, Push-to-Talk keyboard handlers, and room lifecycle.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial State & Defaults
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  const privateParam = urlParams.get('private');
  const keyParam = urlParams.get('key');

  const displayNameInput = document.getElementById('input-display-name');
  const subjectGoalInput = document.getElementById('input-subject-goal');
  const setupModeRadios = document.getElementsByName('setup-mode');

  // Load saved profile
  if (displayNameInput) {
    displayNameInput.value = localStorage.getItem('lockedin_display_name') || `Scholar_${Math.floor(1000 + Math.random() * 9000)}`;
  }
  if (subjectGoalInput) {
    subjectGoalInput.value = localStorage.getItem('lockedin_subject_goal') || 'Organic Chemistry & Calculus';
  }

  // Room Type Switcher (Among Us Style: Public, Private, Host)
  const tabBtnPublic = document.getElementById('tab-btn-public');
  const tabBtnPrivate = document.getElementById('tab-btn-private');
  const tabBtnHost = document.getElementById('tab-btn-host');
  const secPublic = document.getElementById('section-public-room');
  const secPrivate = document.getElementById('section-private-room');
  const secHost = document.getElementById('section-host-room');
  const privateRoomInput = document.getElementById('input-private-room');
  const privatePasscodeInput = document.getElementById('input-private-passcode');

  function setRoomMode(mode) {
    [tabBtnPublic, tabBtnPrivate, tabBtnHost].forEach(b => b && b.classList.remove('active'));
    [secPublic, secPrivate, secHost].forEach(s => s && s.classList.add('hidden'));

    if (mode === 'private') {
      if (tabBtnPrivate) tabBtnPrivate.classList.add('active');
      if (secPrivate) secPrivate.classList.remove('hidden');
    } else if (mode === 'host') {
      if (tabBtnHost) tabBtnHost.classList.add('active');
      if (secHost) secHost.classList.remove('hidden');
    } else {
      if (tabBtnPublic) tabBtnPublic.classList.add('active');
      if (secPublic) secPublic.classList.remove('hidden');
    }
  }

  if (tabBtnPublic) tabBtnPublic.addEventListener('click', () => setRoomMode('public'));
  if (tabBtnPrivate) tabBtnPrivate.addEventListener('click', () => setRoomMode('private'));
  if (tabBtnHost) tabBtnHost.addEventListener('click', () => setRoomMode('host'));

  // Pre-fill & Handle Smart Room Invites from URL params
  if (roomParam) {
    const isPrivate = (privateParam === '1' || privateParam === 'true');
    const inviteBanner = document.getElementById('invite-banner');
    const inviteRoomName = document.getElementById('invite-room-name');
    const acceptInviteBtn = document.getElementById('btn-accept-invite');
    const cleanRoomParam = roomParam.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);

    // Hide lobby tabs to keep invite landing clean and focused
    const terminalNav = document.querySelector('.amongus-terminal-nav');
    if (terminalNav) terminalNav.style.display = 'none';

    if (inviteBanner && inviteRoomName) {
      inviteBanner.classList.remove('hidden');
      inviteRoomName.textContent = cleanRoomParam + (isPrivate ? ' (Private Room)' : ' (Public Lobby)');
    }

    if (isPrivate) {
      setRoomMode('private');
      if (privateRoomInput) privateRoomInput.value = cleanRoomParam;
      if (keyParam && privatePasscodeInput) privatePasscodeInput.value = keyParam;
    }

    if (acceptInviteBtn) {
      acceptInviteBtn.addEventListener('click', () => {
        startStudySession(cleanRoomParam, isPrivate, keyParam || null);
      });
    }

    // Auto-join invited room automatically once Firebase Auth settles
    setTimeout(() => {
      const lobbyViewEl = document.getElementById('lobby-view');
      if (lobbyViewEl && !lobbyViewEl.classList.contains('hidden')) {
        showToast(`🔗 Joining room ${cleanRoomParam}...`, 2500);
        startStudySession(cleanRoomParam, isPrivate, keyParam || null);
      }
    }, 500);
  }

  // Toast Notification System
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, duration = 2500) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'app-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('visible');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, duration);
  }
  window.showToast = showToast;

  // 2. Real Active Public Rooms (Synced with Firestore)
  let currentFilter = 'all';
  const DEFAULT_MAIN_HALL = {
    id: 'MAIN-STUDY-HALL',
    roomId: 'MAIN-STUDY-HALL',
    name: '⚡ Main Study Hall (24/7 Community)',
    title: '⚡ Main Study Hall (24/7 Community)',
    host: 'Community',
    category: 'all',
    sector: 'all',
    tag: '🌐 Open Study Hall',
    timer: '25m',
    color: 'color-green',
    activeCount: 1
  };
  let activeRoomsCache = [{ ...DEFAULT_MAIN_HALL }];

  function mergeRoomsWithMainHall(freshRooms) {
    const list = Array.isArray(freshRooms) ? [...freshRooms] : [];
    const hasMain = list.some(r => (r.roomId || r.id) === 'MAIN-STUDY-HALL');
    if (!hasMain) {
      list.unshift({ ...DEFAULT_MAIN_HALL });
    }
    return list;
  }

  function renderPublicRooms(roomsList = activeRoomsCache) {
    const listEl = document.getElementById('public-room-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const filtered = roomsList.filter(r => currentFilter === 'all' || (r.sector || r.category) === currentFilter);

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 24px 16px; text-align: center; color: var(--text-secondary);">
          <div style="font-size: 1.8rem; margin-bottom: 8px;">📭</div>
          <p style="font-size: 0.9rem; margin-bottom: 8px; font-weight: 500;">No active rooms in this sector right now.</p>
          <p style="font-size: 0.8rem; color: var(--text-tertiary);">Launch your own in the <strong>HOST</strong> tab or enter the Main Study Hall!</p>
        </div>
      `;
      return;
    }

    filtered.forEach(room => {
      const card = document.createElement('div');
      card.className = 'au-room-card';
      const rId = room.roomId || room.id;
      const count = room.activeCount || room.participantCount || 1;

      card.innerHTML = `
        <div class="au-room-left">
          <div class="au-crewmate-icon ${room.color || 'color-orange'}"></div>
          <div class="au-room-details">
            <span class="au-room-title">${room.title || room.name || rId}</span>
            <div class="au-room-tags">
              <span class="au-tag-chip">${room.tag || (room.sector ? room.sector.toUpperCase() : 'FOCUS')}</span>
              <span class="au-timer-chip">${room.timer || '25m'}</span>
              <span class="au-timer-chip" style="color:#10b981; border-color:rgba(16,185,129,0.4);">🟢 ${count} Active</span>
            </div>
          </div>
        </div>
        <div class="au-room-right">
          <button type="button" class="au-join-btn">JOIN</button>
        </div>
      `;

      const joinBtn = card.querySelector('.au-join-btn');
      if (joinBtn) {
        joinBtn.addEventListener('click', () => {
          startStudySession(rId, false, null);
        });
      }
      listEl.appendChild(card);
    });
  }

  // Connect Active Rooms to Real-Time Firestore Listener
  window.FirebaseSync.listenToActiveRooms((freshRooms) => {
    activeRoomsCache = mergeRoomsWithMainHall(freshRooms);
    renderPublicRooms(activeRoomsCache);
  });

  // Render default immediately until Firestore snapshot arrives
  renderPublicRooms(activeRoomsCache);

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      renderPublicRooms(activeRoomsCache);
    });
  });

  // Wire 🔄 Refresh button with spinning animation & immediate get() fetch
  const refreshRoomsBtn = document.getElementById('btn-refresh-rooms');
  if (refreshRoomsBtn) {
    refreshRoomsBtn.addEventListener('click', async () => {
      refreshRoomsBtn.classList.add('is-spinning');
      try {
        const fresh = await window.FirebaseSync.getActiveRoomsOnce();
        activeRoomsCache = mergeRoomsWithMainHall(fresh);
        renderPublicRooms(activeRoomsCache);
        showToast(`🔄 Refreshed (${activeRoomsCache.length} active ${activeRoomsCache.length === 1 ? 'room' : 'rooms'})`);
      } catch (err) {
        console.warn('Refresh error:', err);
        showToast('❌ Refresh failed: ' + (err.message || 'Check Firestore connection'), 4000);
      } finally {
        setTimeout(() => refreshRoomsBtn.classList.remove('is-spinning'), 650);
      }
    });
  }

  // Quick Join Public Lobby Button
  const quickJoinPublicBtn = document.getElementById('btn-quick-join-public');
  if (quickJoinPublicBtn) {
    quickJoinPublicBtn.addEventListener('click', () => {
      startStudySession('MAIN-STUDY-HALL', false, null);
    });
  }

  // Enter Room by Code Button & Arrow Button (Case-insensitive trim)
  const joinPrivateBtn = document.getElementById('btn-join-private');
  const submitCodeArrow = document.getElementById('btn-submit-code-arrow');

  function handlePrivateJoin() {
    const rawCode = (privateRoomInput.value || '').trim();
    const passcode = (privatePasscodeInput.value || '').trim();

    if (!rawCode) {
      alert('Please enter a Room Code (e.g. "STUDY-492" or "MATH").');
      privateRoomInput.focus();
      return;
    }

    const cleanCode = rawCode.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    startStudySession(cleanCode, !!passcode, passcode || null);
  }

  if (joinPrivateBtn) joinPrivateBtn.addEventListener('click', handlePrivateJoin);
  if (submitCodeArrow) submitCodeArrow.addEventListener('click', handlePrivateJoin);

  // Host / Create Room Button
  const hostTimerBtns = document.querySelectorAll('.host-timer-btn');
  let hostFocus = 25;
  let hostBreak = 5;

  hostTimerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      hostTimerBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      hostFocus = parseInt(btn.getAttribute('data-focus'), 10);
      hostBreak = parseInt(btn.getAttribute('data-break'), 10);
    });
  });

  const createHostBtn = document.getElementById('btn-create-host-room');
  if (createHostBtn) {
    createHostBtn.addEventListener('click', async () => {
      const titleInput = document.getElementById('input-host-room-title');
      const subjectSelect = document.getElementById('select-host-subject');
      const rawTitle = (titleInput && titleInput.value.trim()) || '';
      const sector = subjectSelect ? subjectSelect.value : 'stem';

      // Clean 6-character uppercase code e.g. STUDY-492 OR custom room name
      let cleanId;
      if (rawTitle) {
        cleanId = rawTitle.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
      } else {
        cleanId = 'STUDY-' + Math.floor(100 + Math.random() * 900);
      }
      if (!cleanId) cleanId = 'STUDY-' + Math.floor(100 + Math.random() * 900);

      const displayTitle = rawTitle || `Study Lounge (${cleanId})`;

      if (window.StudyTimer) {
        window.StudyTimer.setPreset(hostFocus, hostBreak);
      }

      createHostBtn.disabled = true;
      createHostBtn.textContent = '⏳ Creating Room...';

      try {
        // Immediately write rooms/{roomId} to Firestore & await confirmation before entering!
        await window.FirebaseSync.createRoom({
          roomId: cleanId,
          title: displayTitle,
          sector: sector,
          focusMinutes: hostFocus
        });

        showToast(`🚀 Room ${cleanId} launched!`);
        await startStudySession(cleanId, false, null);
      } catch (err) {
        console.error('[App] Failed to launch host session:', err);
        alert('Room creation failed: ' + (err.message || 'Please try again.'));
      } finally {
        createHostBtn.disabled = false;
        createHostBtn.textContent = '🚀 Launch New Study Lobby';
      }
    });
  }

  let watermarkInterval = null;
  function updateWatermark(name) {
    const overlay = document.getElementById('study-watermark-overlay');
    if (!overlay) return;
    const dateStr = new Date().toLocaleTimeString();
    const watermarkText = `🔒 LOCKED-IN • CONFIDENTIAL • ${name} • ${dateStr}`;
    let html = '';
    for (let i = 0; i < 20; i++) {
      html += `<span class="watermark-unit">${watermarkText}</span>`;
    }
    overlay.innerHTML = html;
  }

  // 3. Centralized Study Session Starter (strictly single-flight to prevent duplicate joins on multi-tap)
  let isJoiningSession = false;
  async function startStudySession(roomId, isPrivate = false, passcode = null) {
    if (isJoiningSession || (window.WebRTCRoom && window.WebRTCRoom.roomId)) {
      return;
    }
    isJoiningSession = true;

    const cleanRoom = roomId ? String(roomId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24) : 'MAIN-STUDY-HALL';
    const displayName = (displayNameInput.value || '').trim() || 'FocusScholar';
    const subjectGoal = (subjectGoalInput.value || '').trim() || 'General Deep Study';
    let selectedMode = 'dual';
    for (const radio of setupModeRadios) {
      if (radio.checked) selectedMode = radio.value;
    }

    // Save profile
    localStorage.setItem('lockedin_display_name', displayName);
    localStorage.setItem('lockedin_subject_goal', subjectGoal);

    if (window.Leaderboard) {
      window.Leaderboard.currentUser.displayName = displayName;
      window.Leaderboard.currentUser.subjectGoal = subjectGoal;
      window.Leaderboard.saveCurrentUser();
      window.Leaderboard.renderHUD();
    }

    // Lock ALL entry buttons immediately so rapid multi-taps cannot queue duplicate joins
    const allJoinBtns = [
      quickJoinPublicBtn,
      joinPrivateBtn,
      submitCodeArrow,
      createHostBtn,
      document.getElementById('btn-accept-invite'),
      ...document.querySelectorAll('.au-join-btn')
    ].filter(Boolean);
    allJoinBtns.forEach(b => { b.disabled = true; });

    if (quickJoinPublicBtn) quickJoinPublicBtn.textContent = '⏳ Connecting...';
    if (joinPrivateBtn) joinPrivateBtn.textContent = '⏳ Entering...';

    try {
      // Initialize media with multi-tier fallback (never blocks joining!)
      await window.WebRTCRoom.initLocalMedia({ mode: selectedMode });

      // Join WebRTC room with normalized uppercase room ID
      try {
        await window.WebRTCRoom.joinStudyRoom(cleanRoom, isPrivate, passcode);
      } catch (joinErr) {
        console.error('[App] Failed to join cloud study room:', joinErr);
        showToast('❌ ' + (joinErr.message || 'Could not join study room in Cloud Firestore.'), 5000);
        window.WebRTCRoom.leaveStudyRoom();
        return;
      }

      // Start Trigger Engine monitoring with active camera element
      const localCamVideo = document.getElementById('local-cam-video');
      const localScreenVideo = document.getElementById('local-screen-video');
      const activeCam = (window.WebRTCRoom && window.WebRTCRoom.isDualFeedActive) ? localCamVideo : localScreenVideo;

      window.TriggerEngine.startMonitoring({
        localVideoEl: activeCam,
        screenVideoEl: localScreenVideo,
        localAudioStream: window.WebRTCRoom.localCamStream
      });

      // Ensure audio context is ready for meme triggers
      if (window.Soundboard) {
        window.Soundboard.ensureAudioResumed();
      }

      // Update Local Tile HUD
      document.getElementById('local-user-name').textContent = displayName;
      document.getElementById('local-subject-goal').textContent = subjectGoal;

      // Switch from Lobby to Study Room
      document.getElementById('lobby-view').classList.add('hidden');
      document.getElementById('study-room-view').classList.remove('hidden');
    } finally {
      isJoiningSession = false;
      allJoinBtns.forEach(b => { b.disabled = false; });
      if (quickJoinPublicBtn) quickJoinPublicBtn.textContent = '⚡ Enter Main Study Hall (24/7 Community)';
      if (joinPrivateBtn) joinPrivateBtn.textContent = 'Join Room ➔';
    }

    // Show Leave Room button in header
    const leaveBtnHeader = document.getElementById('btn-leave-room-header');
    if (leaveBtnHeader) leaveBtnHeader.style.display = 'inline-flex';

    // Initialize & auto-start Study Timer so focus triggers are live immediately
    window.StudyTimer.resetTimer();
    window.StudyTimer.startTimer();

    // Start dynamic anti-leak watermark
    updateWatermark(displayName);
    if (watermarkInterval) clearInterval(watermarkInterval);
    watermarkInterval = setInterval(() => {
      updateWatermark(displayName);
    }, 15000);

    // Subscribe to Real-Time Room Chat
    if (typeof subscribeRoomChat === 'function') {
      subscribeRoomChat(cleanRoom);
    }
  }

  // Leave Room Handlers (Header & Dock)
  const leaveBtnHeader = document.getElementById('btn-leave-room-header');
  const leaveBtnDock = document.getElementById('btn-leave-room-dock');
  [leaveBtnHeader, leaveBtnDock].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        if (confirm('Leave current study room and return to the lobby?')) {
          if (watermarkInterval) {
            clearInterval(watermarkInterval);
            watermarkInterval = null;
          }
          if (typeof cleanupRoomChat === 'function') cleanupRoomChat();
          window.WebRTCRoom.leaveStudyRoom();
        }
      });
    }
  });

  // 4. Prominent Room Code & Invite Link Actions
  const btnCopyRoomCode = document.getElementById('btn-copy-room-code');
  if (btnCopyRoomCode) {
    btnCopyRoomCode.addEventListener('click', () => {
      const code = window.WebRTCRoom.roomId || 'STUDY-101';
      navigator.clipboard.writeText(code).then(() => {
        showToast('📋 Room Code copied: ' + code);
      }).catch(() => {
        prompt('Copy Room Code:', code);
      });
    });
  }

  const btnCopyRoomLink = document.getElementById('btn-copy-room-link');
  if (btnCopyRoomLink) {
    btnCopyRoomLink.addEventListener('click', async () => {
      const code = window.WebRTCRoom.roomId || 'STUDY-101';
      const inviteUrl = `https://omkar5144s.github.io/locked-in-study/?room=${encodeURIComponent(code)}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: 'LOCKED-IN Study Room',
            text: `Join my LOCKED-IN study room (#${code})!`,
            url: inviteUrl
          });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }

      navigator.clipboard.writeText(inviteUrl).then(() => {
        showToast('🔗 Invite Link copied!');
      }).catch(() => {
        prompt('Copy Invite Link:', inviteUrl);
      });
    });
  }

  const copyLinkBtn = document.getElementById('btn-copy-invite');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const currentRoom = window.WebRTCRoom.roomId || 'STUDY-101';
      const isPrivate = window.WebRTCRoom.isPrivate;
      const passcode = window.WebRTCRoom.passcode;

      let inviteUrl = `https://omkar5144s.github.io/locked-in-study/?room=${encodeURIComponent(currentRoom)}`;
      if (isPrivate) {
        inviteUrl += '&private=1';
        if (passcode) {
          inviteUrl += `&key=${encodeURIComponent(passcode)}`;
        }
      }

      navigator.clipboard.writeText(inviteUrl).then(() => {
        showToast('🔗 Invite Link copied!');
      }).catch(() => {
        prompt('Copy invite link:', inviteUrl);
      });
    });
  }

  // Google Sign-In & Verified Profile Chip
  const googleAuthBtn = document.getElementById('btn-google-auth');
  const userProfileChip = document.getElementById('user-profile-chip');
  const headerAvatarInitial = document.getElementById('header-avatar-initial');
  const headerUserCallsign = document.getElementById('header-user-callsign');

  function updateAuthUI(user) {
    // Show verified chip ONLY for genuinely authenticated Firebase Google users (never anonymous/local)
    const fbAuthUser = window.FirebaseSync && window.FirebaseSync.auth ? window.FirebaseSync.auth.currentUser : null;
    if (user && fbAuthUser && !fbAuthUser.isAnonymous && user.isVerified) {
      if (googleAuthBtn) googleAuthBtn.style.display = 'none';
      if (userProfileChip) {
        userProfileChip.classList.remove('hidden');
        userProfileChip.title = 'Signed in with Google (Click to sign out)';
        const label = user.callSign || user.displayName || 'Scholar';
        const initial = label.slice(0, 1).toUpperCase();
        if (headerAvatarInitial) {
          headerAvatarInitial.textContent = '';
          if (user.photoURL) {
            const img = document.createElement('img');
            img.src = user.photoURL;
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
            img.onerror = () => { headerAvatarInitial.textContent = initial; };
            headerAvatarInitial.appendChild(img);
          } else {
            headerAvatarInitial.textContent = initial;
          }
        }
        if (headerUserCallsign) headerUserCallsign.textContent = label;
        if (window.WebRTCRoom && window.WebRTCRoom.updateLocalAvatarDisplay) {
          window.WebRTCRoom.updateLocalAvatarDisplay(label);
        }
        if (displayNameInput && (!displayNameInput.value || displayNameInput.value.startsWith('Scholar_') || displayNameInput.value === 'FocusScholar')) {
          displayNameInput.value = label;
        }
        if (subjectGoalInput && user.subjectGoal && (!subjectGoalInput.value || subjectGoalInput.value === 'Organic Chemistry & Calculus')) {
          subjectGoalInput.value = user.subjectGoal;
        }
      }
    } else {
      if (googleAuthBtn) googleAuthBtn.style.display = 'inline-flex';
      if (userProfileChip) userProfileChip.classList.add('hidden');
    }
  }

  if (userProfileChip) {
    userProfileChip.style.cursor = 'pointer';
    userProfileChip.addEventListener('click', async () => {
      if (confirm('Sign out of your Google Scholar account?')) {
        try {
          await window.FirebaseSync.signOut();
          showToast('Signed out.');
        } catch (err) {
          showToast('❌ ' + (err.message || 'Sign-out failed.'));
        }
      }
    });
  }

  if (googleAuthBtn) {
    googleAuthBtn.addEventListener('click', async () => {
      if (!window.FirebaseSync.isConfigured) {
        showToast('⚠️ Firebase not configured. Paste your config in Admin → Firebase Setup first.', 4000);
        return;
      }
      try {
        googleAuthBtn.disabled = true;
        googleAuthBtn.innerHTML = '<span>⏳ Signing in...</span>';
        const user = await window.FirebaseSync.signInWithGoogle();
        if (user) {
          updateAuthUI(user);
          showToast(`✅ Welcome, ${user.callSign || user.displayName}! Google account verified.`);
        }
        // If user is null, a redirect was triggered — page will reload
      } catch (err) {
        console.warn('[Auth] Sign-in error:', err);
        const msg = err.message || 'Sign-in failed.';
        // Show the real error — never silently swallow it
        showToast(`❌ ${msg}`, 5000);
      } finally {
        googleAuthBtn.disabled = false;
        googleAuthBtn.innerHTML = '<span id="auth-btn-icon">🌐</span> <span id="auth-btn-label">Sign in</span>';
      }
    });
  }

  window.FirebaseSync.onAuth(updateAuthUI);

  // 4. Picture-in-Picture Swap
  const pipSwapBtn = document.getElementById('btn-pip-swap');
  const pipOverlay = document.getElementById('local-pip-wrapper');
  if (pipSwapBtn) {
    pipSwapBtn.addEventListener('click', () => window.WebRTCRoom.swapPiP());
  }
  if (pipOverlay) {
    pipOverlay.addEventListener('click', () => window.WebRTCRoom.swapPiP());
  }

  // 5. Timer Controls & Presets
  const timerStartBtn = document.getElementById('timer-start-btn');
  const timerResetBtn = document.getElementById('timer-reset-btn');
  if (timerStartBtn) {
    timerStartBtn.addEventListener('click', () => {
      if (window.StudyTimer.isRunning) {
        window.StudyTimer.pauseTimer();
      } else {
        window.StudyTimer.startTimer();
      }
    });
  }
  if (timerResetBtn) {
    timerResetBtn.addEventListener('click', () => window.StudyTimer.resetTimer());
  }

  // Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const focus = parseInt(btn.getAttribute('data-focus'), 10);
      const brk = parseInt(btn.getAttribute('data-break'), 10);
      window.StudyTimer.setPreset(focus, brk);
    });
  });

  // Custom Timer Form
  const customTimerBtn = document.getElementById('btn-apply-custom-timer');
  if (customTimerBtn) {
    customTimerBtn.addEventListener('click', () => {
      const fVal = document.getElementById('custom-focus-mins').value;
      const bVal = document.getElementById('custom-break-mins').value;
      window.StudyTimer.setCustom(fVal, bVal);
      alert(`Applied custom timer: ${fVal}m Focus / ${bVal}m Break`);
    });
  }

  // 6. Push-to-Talk & Microphone Controls
  const micBtn = document.getElementById('toggle-mic-btn');
  const pttCheckbox = document.getElementById('ptt-mode-toggle');

  if (micBtn) {
    micBtn.addEventListener('click', () => {
      window.WebRTCRoom.muteMic(!window.WebRTCRoom.isMicMuted);
    });

    // Hold on mobile touch
    micBtn.addEventListener('touchstart', (e) => {
      if (pttCheckbox && pttCheckbox.checked) {
        e.preventDefault();
        window.WebRTCRoom.muteMic(false);
      }
    });
    micBtn.addEventListener('touchend', () => {
      if (pttCheckbox && pttCheckbox.checked) {
        window.WebRTCRoom.muteMic(true);
      }
    });
  }

  // Push-to-Talk & Desktop Keyboard Shortcuts (Space = Pause/Resume Timer, M = Toggle Mic)
  let isSpacePressed = false;
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const activeTag = activeEl ? activeEl.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || (activeEl && activeEl.isContentEditable)) return;

    const studyView = document.getElementById('study-room-view');
    const inRoom = studyView && !studyView.classList.contains('hidden');
    if (!inRoom) return;

    if (e.code === 'Space') {
      if (pttCheckbox && pttCheckbox.checked) {
        if (!isSpacePressed) {
          isSpacePressed = true;
          window.WebRTCRoom.muteMic(false);
        }
      } else {
        e.preventDefault();
        if (window.StudyTimer) {
          if (window.StudyTimer.isRunning) window.StudyTimer.pauseTimer();
          else window.StudyTimer.startTimer();
        }
      }
    } else if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (window.WebRTCRoom) window.WebRTCRoom.toggleMic();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && isSpacePressed && pttCheckbox && pttCheckbox.checked) {
      isSpacePressed = false;
      window.WebRTCRoom.muteMic(true);
    }
  });

  // Live Focus Status Tag Cycling on Local Tile
  const localSubjectBadge = document.getElementById('local-subject-goal');
  const FOCUS_STATUS_TAGS = ['Deep Focus', 'Solving PYQs', '5m Break', 'Stuck / Doubt'];
  if (localSubjectBadge) {
    localSubjectBadge.addEventListener('click', () => {
      const current = localSubjectBadge.textContent.trim();
      const idx = FOCUS_STATUS_TAGS.indexOf(current);
      const nextStatus = FOCUS_STATUS_TAGS[(idx + 1) % FOCUS_STATUS_TAGS.length];
      localSubjectBadge.textContent = nextStatus;
      if (window.WebRTCRoom && window.WebRTCRoom.roomId) {
        window.WebRTCRoom.broadcastData({
          type: 'STATUS_TAG_UPDATED',
          statusTag: nextStatus
        });
      }
      showToast(`🏷️ Status: ${nextStatus}`);
    });
  }

  // Camera Background / Privacy Filter Selector & Quick Cycle Button
  const VIDEO_FILTERS = ['none', 'bg-blur', 'privacy-blur', 'bg-dim', 'bw'];
  const videoFilterSelect = document.getElementById('video-filter-select');
  const cycleFilterBtn = document.getElementById('btn-cycle-filter');

  if (videoFilterSelect) {
    const savedFilter = localStorage.getItem('lockedin_video_filter') || 'none';
    videoFilterSelect.value = savedFilter;
    videoFilterSelect.addEventListener('change', async () => {
      const mode = videoFilterSelect.value;
      if (window.WebRTCRoom && window.WebRTCRoom.setVideoFilter) {
        await window.WebRTCRoom.setVideoFilter(mode);
      } else {
        localStorage.setItem('lockedin_video_filter', mode);
      }
      showToast(`🎭 Filter: ${videoFilterSelect.options[videoFilterSelect.selectedIndex].text}`);
    });
  }

  if (cycleFilterBtn) {
    cycleFilterBtn.addEventListener('click', async () => {
      const cur = (window.WebRTCRoom && window.WebRTCRoom.activeVideoFilter) || localStorage.getItem('lockedin_video_filter') || 'none';
      const idx = VIDEO_FILTERS.indexOf(cur);
      const next = VIDEO_FILTERS[(idx + 1) % VIDEO_FILTERS.length];
      if (window.WebRTCRoom && window.WebRTCRoom.setVideoFilter) {
        await window.WebRTCRoom.setVideoFilter(next);
      }
      if (videoFilterSelect) videoFilterSelect.value = next;
    });
  }

  // Video Quality Selector (Auto, 1080p 60fps, 720p 60fps, 540p, 480p, 360p)
  const videoQualitySelect = document.getElementById('video-quality-select');
  if (videoQualitySelect) {
    const savedQuality = localStorage.getItem('lockedin_video_quality') || 'auto';
    videoQualitySelect.value = savedQuality;
    videoQualitySelect.addEventListener('change', async () => {
      const mode = videoQualitySelect.value;
      if (window.WebRTCRoom && window.WebRTCRoom.setVideoQuality) {
        await window.WebRTCRoom.setVideoQuality(mode);
      } else {
        localStorage.setItem('lockedin_video_quality', mode);
      }
      showToast(`🎥 Video Quality: ${videoQualitySelect.options[videoQualitySelect.selectedIndex].text}`);
    });
  }

  // Battery Saver Toggle (480p @ 12fps)
  const batterySaverToggle = document.getElementById('battery-saver-toggle');
  if (batterySaverToggle) {
    batterySaverToggle.checked = localStorage.getItem('lockedin_battery_saver') === 'true';
    batterySaverToggle.addEventListener('change', () => {
      const enabled = batterySaverToggle.checked;
      if (window.WebRTCRoom && window.WebRTCRoom.setBatterySaver) {
        window.WebRTCRoom.setBatterySaver(enabled);
      } else {
        localStorage.setItem('lockedin_battery_saver', enabled ? 'true' : 'false');
      }
      showToast(enabled ? '🔋 Battery Saver ON (480p @ 12fps)' : '⚡ Standard Video Quality (24fps)');
    });
  }

  // 7. Zoom-Style Media & Privacy Controls
  const toggleCamBtn = document.getElementById('toggle-cam-btn');
  if (toggleCamBtn) {
    toggleCamBtn.addEventListener('click', () => {
      window.WebRTCRoom.toggleCamera();
    });
  }

  const toggleScreenBtn = document.getElementById('toggle-screen-btn');
  if (toggleScreenBtn) {
    toggleScreenBtn.addEventListener('click', () => {
      window.WebRTCRoom.toggleScreenShare();
    });
  }

  const dockNoiseBtn = document.getElementById('dock-noise-btn');
  if (dockNoiseBtn) {
    dockNoiseBtn.addEventListener('click', () => {
      const modal = document.getElementById('study-noise-modal');
      if (modal) modal.classList.remove('hidden');
    });
  }

  // 8. Raise Hand Control
  const raiseHandBtn = document.getElementById('raise-hand-btn');
  if (raiseHandBtn) {
    raiseHandBtn.addEventListener('click', () => {
      window.WebRTCRoom.toggleRaiseHand();
    });
  }

  // 8. Grace Period Banner False Alarm Button
  const cancelGraceBtn = document.getElementById('btn-cancel-grace');
  if (cancelGraceBtn) {
    cancelGraceBtn.addEventListener('click', () => {
      window.TriggerEngine.cancelGraceByFalseAlarm();
    });
  }

  // 9. Leaderboard Drawer
  const openLeaderboardBtn = document.getElementById('btn-open-leaderboard');
  const closeLeaderboardBtn = document.getElementById('btn-close-leaderboard');
  const leaderboardDrawer = document.getElementById('leaderboard-drawer');

  if (openLeaderboardBtn && leaderboardDrawer) {
    openLeaderboardBtn.addEventListener('click', () => {
      leaderboardDrawer.classList.remove('hidden');
      window.Leaderboard.renderBoards();
    });
  }
  if (closeLeaderboardBtn && leaderboardDrawer) {
    closeLeaderboardBtn.addEventListener('click', () => {
      leaderboardDrawer.classList.add('hidden');
    });
  }

  // Leaderboard Tab Switching (Top Grinders vs Wall of Shame)
  document.querySelectorAll('.board-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.board-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      if (target === 'grinders') {
        document.getElementById('tab-grinders').classList.remove('hidden');
        document.getElementById('tab-shame').classList.add('hidden');
      } else {
        document.getElementById('tab-grinders').classList.add('hidden');
        document.getElementById('tab-shame').classList.remove('hidden');
      }
    });
  });

  // Mobile Compact Menu Drawer (<=768px)
  const mobileMenuBtn = document.getElementById('btn-mobile-menu');
  const mobileMenuDrawer = document.getElementById('mobile-menu-drawer');
  if (mobileMenuBtn && mobileMenuDrawer) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pts = document.getElementById('user-points-badge');
      const gami = document.getElementById('user-gamification-pill');
      const mPts = document.getElementById('mobile-menu-points');
      const mGami = document.getElementById('mobile-menu-gamification');
      if (pts && mPts) mPts.textContent = pts.textContent;
      if (gami && mGami) mGami.textContent = gami.textContent;
      mobileMenuDrawer.classList.toggle('hidden');
    });

    mobileMenuDrawer.querySelectorAll('.mobile-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        const targetId = item.getAttribute('data-target');
        const targetBtn = targetId ? document.getElementById(targetId) : null;
        mobileMenuDrawer.classList.add('hidden');
        if (targetBtn) targetBtn.click();
      });
    });

    document.addEventListener('click', (e) => {
      if (!mobileMenuDrawer.classList.contains('hidden') &&
          !mobileMenuDrawer.contains(e.target) &&
          !mobileMenuBtn.contains(e.target)) {
        mobileMenuDrawer.classList.add('hidden');
      }
    });
  }

  // 10. Settings & Admin Soundboard Studio Modal & Auth
  const openSettingsBtn = document.getElementById('btn-open-settings') || document.getElementById('btn-open-admin');
  const closeAdminBtn = document.getElementById('btn-close-admin');
  const adminModal = document.getElementById('admin-studio-modal');
  const adminAuthView = document.getElementById('admin-auth-view');
  const adminContentView = document.getElementById('admin-content-view');
  const adminPinInput = document.getElementById('admin-pin-input');
  const adminUnlockBtn = document.getElementById('admin-unlock-btn');
  const adminPinFeedback = document.getElementById('admin-pin-feedback');

  function unlockAdminStudioUI() {
    if (window.Soundboard) {
      window.Soundboard.isAdminAuthenticated = true;
    }
    localStorage.setItem('lockedin_admin_authenticated', 'true');
    if (adminAuthView) adminAuthView.classList.add('hidden');
    if (adminContentView) adminContentView.classList.remove('hidden');
    if (adminPinFeedback) adminPinFeedback.textContent = '';
    try {
      renderAdminSoundboardList();
    } catch (e) {
      console.warn('[Admin] Render list error:', e);
    }
  }

  const settingsModalTitle = document.getElementById('settings-modal-title');
  let adminRevealClicks = 0;
  let adminPromptRevealed = (urlParams.get('admin') === 'true');

  if (settingsModalTitle) {
    settingsModalTitle.addEventListener('click', () => {
      adminRevealClicks++;
      if (adminRevealClicks >= 5) {
        adminPromptRevealed = true;
        adminRevealClicks = 0;
        if (window.Soundboard && !window.Soundboard.isAdminAuthenticated && adminAuthView) {
          adminAuthView.classList.remove('hidden');
        }
      }
    });
  }

  function isOwnerAccount() {
    const email = window.FirebaseSync?.auth?.currentUser?.email;
    if (!email) return false;
    const ownerEmail = localStorage.getItem('lockedin_owner_email');
    return !!(ownerEmail && email.toLowerCase() === ownerEmail.toLowerCase());
  }

  if (openSettingsBtn && adminModal) {
    openSettingsBtn.addEventListener('click', () => {
      const settingsCloudPill = document.getElementById('settings-cloud-status-pill');
      if (settingsCloudPill && window.FirebaseSync) {
        const cfg = window.FirebaseSync.getSavedConfig();
        const isSignedIn = !!(window.FirebaseSync.auth?.currentUser && !window.FirebaseSync.auth.currentUser.isAnonymous);
        settingsCloudPill.textContent = window.FirebaseSync.isConfigured
          ? (isSignedIn ? `✓ Signed In (${cfg?.projectId || 'my-study-project-c37cd'})` : `Cloud Ready (${cfg?.projectId || 'my-study-project-c37cd'})`)
          : 'Cloud Disconnected';
      }
      adminModal.classList.remove('hidden');
      if (window.Soundboard && window.Soundboard.isAdminAuthenticated) {
        if (adminAuthView) adminAuthView.classList.add('hidden');
        if (adminContentView) adminContentView.classList.remove('hidden');
        try {
          renderAdminSoundboardList();
        } catch (e) {
          console.warn('[Admin] Render list error:', e);
        }
      } else if (adminPromptRevealed || isOwnerAccount()) {
        if (adminAuthView) adminAuthView.classList.remove('hidden');
        if (adminContentView) adminContentView.classList.add('hidden');
        if (adminPinFeedback) adminPinFeedback.textContent = '';
      } else {
        // Hide Admin Studio completely from regular users
        if (adminAuthView) adminAuthView.classList.add('hidden');
        if (adminContentView) adminContentView.classList.add('hidden');
      }
    });
  }

  if (closeAdminBtn && adminModal) {
    closeAdminBtn.addEventListener('click', () => {
      adminModal.classList.add('hidden');
    });
  }

  if (adminUnlockBtn) {
    adminUnlockBtn.addEventListener('click', async () => {
      const pin = (adminPinInput.value || '').trim();
      const ok = window.Soundboard ? await window.Soundboard.verifyAdminPin(pin) : false;
      if (ok) {
        if (window.FirebaseSync?.auth?.currentUser?.email) {
          localStorage.setItem('lockedin_owner_email', window.FirebaseSync.auth.currentUser.email);
        }
        unlockAdminStudioUI();
      } else {
        if (adminPinFeedback) {
          adminPinFeedback.textContent = 'Incorrect passcode.';
        }
      }
    });
  }

  if (adminPinInput) {
    adminPinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (adminUnlockBtn) adminUnlockBtn.click();
      }
    });
  }

  const togglePinVisibilityBtn = document.getElementById('btn-toggle-pin-visibility');
  if (togglePinVisibilityBtn && adminPinInput) {
    togglePinVisibilityBtn.addEventListener('click', () => {
      const isPassword = adminPinInput.type === 'password';
      adminPinInput.type = isPassword ? 'text' : 'password';
      togglePinVisibilityBtn.textContent = isPassword ? '🙈' : '👁️';
    });
  }

  // Render 25 Triggers in Admin Soundboard
  function renderAdminSoundboardList() {
    const container = document.getElementById('soundboard-cards-container');
    if (!container) return;
    container.innerHTML = '';

    const triggers = window.TRIGGER_DEFINITIONS || [];
    triggers.forEach(t => {
      const conf = (window.Soundboard && window.Soundboard.soundConfigs && window.Soundboard.soundConfigs[t.id]) || {};
      const card = document.createElement('div');
      card.className = 'soundboard-card';
      card.innerHTML = `
        <div class="card-header">
          <span class="trigger-group-tag">${t.group}</span>
          <span class="trigger-points-tag">-${t.penalty} pts</span>
        </div>
        <h4>${t.name}</h4>
        <p class="trigger-desc">${t.desc}</p>
        <div class="sound-inputs">
          <label class="file-drop-label" for="file-${t.id}">
            📁 <span>${conf.fileName || 'Drop/Upload Audio (<800KB)'}</span>
            <input type="file" id="file-${t.id}" accept=".mp3,.wav,.ogg" class="hidden-file-input">
          </label>
          <input type="url" class="sound-url-input" placeholder="Or paste direct MP3/Audio URL..." value="${conf.url || ''}">
        </div>
        <div class="card-actions">
          <div class="vol-wrapper">
            <span>🔊</span>
            <input type="range" class="vol-slider" min="0" max="100" value="${conf.volume !== undefined ? conf.volume : 80}">
          </div>
          <button class="test-play-btn" title="Test Play Sound">▶ Play</button>
          <button class="clear-slot-btn" title="Clear custom sound">🗑 Reset</button>
        </div>
      `;

      // Event handlers
      const fileInput = card.querySelector(`#file-${t.id}`);
      const dropLabel = card.querySelector('.file-drop-label span');
      const urlInput = card.querySelector('.sound-url-input');
      const volSlider = card.querySelector('.vol-slider');
      const playBtn = card.querySelector('.test-play-btn');
      const clearBtn = card.querySelector('.clear-slot-btn');

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (file.size > 800 * 1024) {
            alert('Audio file size exceeds 800KB limit for free offline storage.');
            return;
          }
          const reader = new FileReader();
          reader.onload = (re) => {
            const dataUrl = re.target.result;
            window.Soundboard.saveSoundSlot(t.id, {
              blob: file,
              dataUrl: dataUrl,
              fileName: file.name,
              volume: parseInt(volSlider.value, 10)
            });
            dropLabel.textContent = file.name;
          };
          reader.readAsDataURL(file);
        }
      });

      urlInput.addEventListener('change', () => {
        window.Soundboard.saveSoundSlot(t.id, {
          url: urlInput.value.trim(),
          volume: parseInt(volSlider.value, 10)
        });
      });

      volSlider.addEventListener('input', () => {
        window.Soundboard.saveSoundSlot(t.id, {
          volume: parseInt(volSlider.value, 10)
        });
      });

      playBtn.addEventListener('click', () => {
        window.Soundboard.playTrigger(t.id, true);
      });

      clearBtn.addEventListener('click', () => {
        window.Soundboard.clearSoundSlot(t.id);
        dropLabel.textContent = 'Drop/Upload Audio (<800KB)';
        urlInput.value = '';
      });

      container.appendChild(card);
    });
  }

  // Admin Studio: Search Filter
  const soundSearchInput = document.getElementById('search-soundboard-triggers');
  if (soundSearchInput) {
    soundSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.soundboard-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? 'flex' : 'none';
      });
    });
  }

  // Admin Studio: Change Passcode
  const changePinBtn = document.getElementById('btn-change-pin');
  if (changePinBtn) {
    changePinBtn.addEventListener('click', async () => {
      const oldPin = prompt('Enter Current Admin Passcode:');
      const newPin = prompt('Enter New Admin Passcode (min 4 characters):');
      const ok = window.Soundboard ? await window.Soundboard.changeAdminPin(oldPin, newPin) : false;
      if (ok) {
        alert('Admin passcode updated successfully.');
      } else {
        alert('Failed to update passcode. Verify your current passcode and new format (min 4 characters).');
      }
    });
  }

  // Admin Studio: Broadcast Soundboard to Room
  const broadcastSoundboardBtn = document.getElementById('btn-broadcast-soundboard');
  if (broadcastSoundboardBtn) {
    broadcastSoundboardBtn.addEventListener('click', () => {
      if (window.Soundboard) {
        const ok = window.Soundboard.broadcastSoundboardToRoom();
        if (ok) {
          alert('Custom soundboard successfully broadcast to all study room members!');
        }
      }
    });
  }

  // Admin Studio: Export & Import Soundboard Backups
  const exportSoundboardBtn = document.getElementById('btn-export-soundboard');
  if (exportSoundboardBtn) {
    exportSoundboardBtn.addEventListener('click', () => {
      window.Soundboard.exportSoundboardBackup();
    });
  }

  const importSoundboardInput = document.getElementById('input-import-soundboard');
  if (importSoundboardInput) {
    importSoundboardInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (re) => {
        const ok = window.Soundboard.importSoundboardBackup(re.target.result);
        if (ok) {
          alert('Soundboard backup restored successfully! All custom triggers are loaded.');
          renderAdminSoundboardList();
        } else {
          alert('Failed to parse soundboard backup file. Please ensure it is a valid JSON export.');
        }
      };
      reader.readAsText(file);
    });
  }

  // 11. Focus Audio & Study Noise Lounge
  const openNoiseBtn = document.getElementById('btn-open-noise');
  const closeNoiseBtn = document.getElementById('btn-close-noise');
  const noiseModal = document.getElementById('study-noise-modal');
  const noiseVolSlider = document.getElementById('noise-volume-slider');
  const stopNoiseBtn = document.getElementById('btn-stop-noise');
  const customTrackInput = document.getElementById('input-custom-track');
  const checkStudyAudio = document.getElementById('check-is-study-audio');
  const setTrackBtn = document.getElementById('btn-set-custom-track');
  const clearTrackBtn = document.getElementById('btn-clear-track');

  if (openNoiseBtn && noiseModal) {
    openNoiseBtn.addEventListener('click', () => {
      noiseModal.classList.remove('hidden');
    });
  }

  if (closeNoiseBtn && noiseModal) {
    closeNoiseBtn.addEventListener('click', () => {
      noiseModal.classList.add('hidden');
    });
  }

  // Audio Drawer Tabs (Soundscapes | Study Music)
  document.querySelectorAll('.audio-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.audio-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-audiotab');
      const tabSounds = document.getElementById('audio-tab-soundscapes');
      const tabMusic = document.getElementById('audio-tab-music');
      if (tabSounds) tabSounds.classList.toggle('hidden', target !== 'soundscapes');
      if (tabMusic) tabMusic.classList.toggle('hidden', target !== 'music');
    });
  });

  // 12 Pure Web Audio Soundscape Buttons
  document.querySelectorAll('.btn-noise-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-noise-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const noiseType = btn.getAttribute('data-noise');

      if (window.StudyNoise) {
        window.StudyNoise.ensureAudio();
        if (window.StudyNoise.playSoundscape) {
          window.StudyNoise.playSoundscape(noiseType);
        }
      }
    });
  });

  if (noiseVolSlider) {
    noiseVolSlider.addEventListener('input', (e) => {
      if (window.StudyNoise) {
        window.StudyNoise.setVolume(parseInt(e.target.value, 10) / 100);
      }
    });
  }

  if (stopNoiseBtn) {
    stopNoiseBtn.addEventListener('click', () => {
      document.querySelectorAll('.btn-noise-preset').forEach(b => b.classList.remove('active'));
      if (window.StudyNoise) {
        window.StudyNoise.stopNoise();
        window.StudyNoise.setNowListening('None');
      }
    });
  }

  // Zero-Key YouTube Study Music Search & Controls
  const ytPlayPauseBtn = document.getElementById('btn-yt-play-pause');
  const ytNextBtn = document.getElementById('btn-yt-next');
  const ytVolSlider = document.getElementById('yt-volume-slider');

  if (setTrackBtn && customTrackInput) {
    const triggerSearch = () => {
      const query = (customTrackInput.value || '').trim();
      if (!query) {
        showToast('Enter a song or study mix to search.');
        return;
      }
      if (window.StudyNoise && window.StudyNoise.searchStudyMusic) {
        window.StudyNoise.searchStudyMusic(query);
        showToast(`🎵 Searching: ${query}`);
      }
    };
    setTrackBtn.addEventListener('click', triggerSearch);
    customTrackInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerSearch();
      }
    });
  }

  if (ytPlayPauseBtn) {
    ytPlayPauseBtn.addEventListener('click', () => {
      if (window.StudyNoise && window.StudyNoise.toggleYouTubePlayPause) {
        window.StudyNoise.toggleYouTubePlayPause();
      }
    });
  }
  if (ytNextBtn) {
    ytNextBtn.addEventListener('click', () => {
      if (window.StudyNoise && window.StudyNoise.nextYouTubeTrack) {
        window.StudyNoise.nextYouTubeTrack();
      }
    });
  }
  if (ytVolSlider) {
    ytVolSlider.addEventListener('input', (e) => {
      if (window.StudyNoise && window.StudyNoise.setYouTubeVolume) {
        window.StudyNoise.setYouTubeVolume(e.target.value);
      }
    });
  }

  if (clearTrackBtn) {
    clearTrackBtn.addEventListener('click', () => {
      if (customTrackInput) customTrackInput.value = '';
      if (window.StudyNoise && window.StudyNoise.clearStudyMusic) {
        window.StudyNoise.clearStudyMusic();
      }
    });
  }

  // 12. Theme Switcher (Vibrant Daylight vs Dark Studio)
  const toggleThemeBtn = document.getElementById('btn-toggle-theme');
  const themeIcon = document.getElementById('theme-icon');
  const themeLabel = document.getElementById('theme-label');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('lockedin_theme', theme);

    if (theme === 'vibrant') {
      document.documentElement.style.colorScheme = 'light';
      document.body.style.colorScheme = 'light';
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute('content', '#f8fafc');
      if (themeIcon) themeIcon.textContent = '☀️';
      if (themeLabel) themeLabel.textContent = 'Vibrant';
    } else {
      document.documentElement.style.colorScheme = 'dark';
      document.body.style.colorScheme = 'dark';
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute('content', '#070709');
      if (themeIcon) themeIcon.textContent = '🌙';
      if (themeLabel) themeLabel.textContent = 'Dark';
    }
  }

  const savedTheme = localStorage.getItem('lockedin_theme') || 'vibrant';
  applyTheme(savedTheme);

  if (toggleThemeBtn) {
    toggleThemeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const current = document.documentElement.getAttribute('data-theme') || 'vibrant';
      const next = (current === 'vibrant') ? 'dark' : 'vibrant';
      applyTheme(next);
    });
  }

  // 13. Fullscreen Immersive Study Mode
  const fullscreenBtn = document.getElementById('btn-toggle-fullscreen');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        fullscreenBtn.innerHTML = '<span>✕ Exit</span>';
      } else {
        document.exitFullscreen().catch(() => {});
        fullscreenBtn.innerHTML = '<span>⛶ Immersive</span>';
      }
    });
  }

  // 14. Study Streak Tracker
  const streakBadge = document.getElementById('user-streak-badge');
  if (streakBadge) {
    const lastStudyDate = localStorage.getItem('lockedin_last_study_date');
    const today = new Date().toISOString().slice(0, 10);
    let streak = parseInt(localStorage.getItem('lockedin_study_streak') || '1', 10);

    if (lastStudyDate) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (lastStudyDate === yesterday) {
        streak++;
        localStorage.setItem('lockedin_study_streak', streak.toString());
      } else if (lastStudyDate !== today) {
        streak = 1;
        localStorage.setItem('lockedin_study_streak', '1');
      }
    }
    localStorage.setItem('lockedin_last_study_date', today);
    streakBadge.textContent = `🔥 ${streak} ${streak === 1 ? 'Day' : 'Days'}`;
  }

  // 15. Tab-Switch Blocker Toggle in Dock
  const tabBlockerBtn = document.getElementById('toggle-tab-blocker-btn');
  const tabBlockerLabel = document.getElementById('tab-blocker-label');
  if (tabBlockerBtn && window.TriggerEngine) {
    const updateTabBlockerUI = () => {
      const isEnabled = window.TriggerEngine.isTabBlockerEnabled;
      tabBlockerBtn.classList.toggle('tab-blocker-active', isEnabled);
      tabBlockerBtn.classList.toggle('tab-blocker-inactive', !isEnabled);
      if (tabBlockerLabel) tabBlockerLabel.textContent = isEnabled ? '🛡️ Tab Guard: ON' : '🛡️ Tab Guard: OFF';
    };
    updateTabBlockerUI();
    tabBlockerBtn.addEventListener('click', () => {
      window.TriggerEngine.setTabBlockerEnabled(!window.TriggerEngine.isTabBlockerEnabled);
      updateTabBlockerUI();
      showToast(window.TriggerEngine.isTabBlockerEnabled ? 'Tab Guard Active (8s grace)' : 'Tab Guard Paused');
    });
  }

  // 16. Session To-Do List Widget
  const todoWidget = document.getElementById('session-todo-widget');
  const todoToggleBtn = document.getElementById('todo-toggle-btn');
  const todoInput = document.getElementById('todo-input');
  const addTodoBtn = document.getElementById('btn-add-todo');
  const todoList = document.getElementById('todo-list');
  const todoProgressCount = document.getElementById('todo-progress-count');

  let sessionTodos = [];
  try {
    sessionTodos = JSON.parse(localStorage.getItem('lockedin_session_todos') || '[]');
  } catch (e) {
    sessionTodos = [];
  }

  function renderTodos() {
    if (!todoList) return;
    todoList.innerHTML = '';
    const total = sessionTodos.length;
    const doneCount = sessionTodos.filter(t => t.done).length;
    if (todoProgressCount) {
      todoProgressCount.textContent = `${doneCount}/${total}`;
      todoProgressCount.style.color = (doneCount === total && total > 0) ? 'var(--apple-green)' : 'inherit';
    }

    if (sessionTodos.length === 0) {
      todoList.innerHTML = '<li style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding:8px;">No tasks added for this study block.</li>';
      return;
    }

    sessionTodos.forEach((task, idx) => {
      const li = document.createElement('li');
      li.className = `todo-item ${task.done ? 'done' : ''}`;
      li.innerHTML = `
        <label style="display:flex; align-items:center; gap:8px; flex:1; cursor:pointer;">
          <input type="checkbox" class="todo-check" data-idx="${idx}" ${task.done ? 'checked' : ''}>
          <span style="word-break:break-word;">${escapeHtml(task.text)}</span>
        </label>
        <button type="button" class="todo-del-btn" data-idx="${idx}" title="Delete task">&times;</button>
      `;
      todoList.appendChild(li);
    });

    todoList.querySelectorAll('.todo-check').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const i = parseInt(e.target.dataset.idx, 10);
        if (sessionTodos[i]) {
          sessionTodos[i].done = e.target.checked;
          saveTodos();
          renderTodos();
          if (sessionTodos[i].done && window.Leaderboard) {
            window.Leaderboard.awardCleanStudyMinute();
            showToast('✅ Task completed (+2 study points!)');
          }
        }
      });
    });

    todoList.querySelectorAll('.todo-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(e.target.dataset.idx, 10);
        sessionTodos.splice(i, 1);
        saveTodos();
        renderTodos();
      });
    });
  }

  function saveTodos() {
    localStorage.setItem('lockedin_session_todos', JSON.stringify(sessionTodos));
  }

  function addTodoItem() {
    if (!todoInput) return;
    const text = todoInput.value.trim();
    if (!text) return;
    sessionTodos.push({ text, done: false, id: Date.now() });
    todoInput.value = '';
    saveTodos();
    renderTodos();
  }

  // Tabbed Room Drawer (💬 Chat | ✅ To-Do) & Unread Dot
  const dockRoomBtn = document.getElementById('dock-room-btn');
  const roomDrawer = document.getElementById('room-drawer');
  const closeRoomDrawerBtn = document.getElementById('btn-close-room-drawer');
  const roomUnreadDot = document.getElementById('room-unread-dot');
  const roomChatMessagesEl = document.getElementById('room-chat-messages');
  const roomChatInput = document.getElementById('room-chat-input');
  const sendRoomChatBtn = document.getElementById('btn-send-room-chat');
  let unsubscribeRoomChat = null;
  let lastSeenMessageCount = 0;

  function cleanupRoomChat() {
    if (unsubscribeRoomChat) {
      unsubscribeRoomChat();
      unsubscribeRoomChat = null;
    }
    lastSeenMessageCount = 0;
    if (roomUnreadDot) roomUnreadDot.classList.add('hidden');
    if (roomChatMessagesEl) {
      roomChatMessagesEl.innerHTML = '<div class="empty-state">No messages yet. Say hi or share a quick status!</div>';
    }
  }

  function renderRoomChatMessages(messages) {
    if (!roomChatMessagesEl) return;
    const isDrawerClosed = !roomDrawer || roomDrawer.classList.contains('hidden');
    if (isDrawerClosed && messages.length > lastSeenMessageCount && lastSeenMessageCount > 0) {
      if (roomUnreadDot) roomUnreadDot.classList.remove('hidden');
    } else if (!isDrawerClosed) {
      lastSeenMessageCount = messages.length;
      if (roomUnreadDot) roomUnreadDot.classList.add('hidden');
    }
    if (lastSeenMessageCount === 0 && messages.length > 0 && isDrawerClosed) {
      // Mark initial load count so only new incoming messages trigger the unread dot
      lastSeenMessageCount = messages.length;
    }

    if (!messages.length) {
      roomChatMessagesEl.innerHTML = '<div class="empty-state">No messages yet. Say hi or share a quick status!</div>';
      return;
    }

    roomChatMessagesEl.innerHTML = '';
    messages.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'chat-msg-item';
      const timeStr = m.clientTs ? new Date(m.clientTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      div.innerHTML = `
        <div class="chat-msg-meta">
          <strong>${escapeHtml(m.senderName || 'Scholar')}</strong>
          <span>${escapeHtml(timeStr)}</span>
        </div>
        <div>${escapeHtml(m.text)}</div>
      `;
      roomChatMessagesEl.appendChild(div);
    });
    roomChatMessagesEl.scrollTop = roomChatMessagesEl.scrollHeight;
  }

  function subscribeRoomChat(roomId) {
    cleanupRoomChat();
    if (window.FirebaseSync && window.FirebaseSync.listenToRoomMessages) {
      unsubscribeRoomChat = window.FirebaseSync.listenToRoomMessages(roomId, renderRoomChatMessages);
    }
  }

  async function sendChatText(text) {
    const clean = String(text || '').trim().slice(0, 200);
    const roomId = window.WebRTCRoom && window.WebRTCRoom.roomId;
    if (!clean || !roomId || !window.FirebaseSync?.sendRoomMessage) return;
    try {
      await window.FirebaseSync.sendRoomMessage(roomId, clean, (displayNameInput && displayNameInput.value) || 'Scholar');
    } catch (err) {
      showToast('❌ Failed to send message: ' + (err.message || 'Check connection'));
    }
  }

  if (dockRoomBtn && roomDrawer) {
    dockRoomBtn.addEventListener('click', () => {
      const opening = roomDrawer.classList.contains('hidden');
      roomDrawer.classList.toggle('hidden');
      if (opening && roomUnreadDot) {
        roomUnreadDot.classList.add('hidden');
        if (roomChatMessagesEl) roomChatMessagesEl.scrollTop = roomChatMessagesEl.scrollHeight;
      }
    });
  }
  if (closeRoomDrawerBtn && roomDrawer) {
    closeRoomDrawerBtn.addEventListener('click', () => roomDrawer.classList.add('hidden'));
  }

  document.querySelectorAll('.room-drawer-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.room-drawer-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-roomtab');
      const chatTab = document.getElementById('room-tab-chat');
      const todoTab = document.getElementById('room-tab-todo');
      if (chatTab) chatTab.classList.toggle('hidden', tab !== 'chat');
      if (todoTab) todoTab.classList.toggle('hidden', tab !== 'todo');
    });
  });

  if (sendRoomChatBtn && roomChatInput) {
    sendRoomChatBtn.addEventListener('click', () => {
      const txt = roomChatInput.value;
      roomChatInput.value = '';
      sendChatText(txt);
    });
    roomChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const txt = roomChatInput.value;
        roomChatInput.value = '';
        sendChatText(txt);
      }
    });
  }

  document.querySelectorAll('.chat-chip-btn').forEach(chip => {
    chip.addEventListener('click', () => {
      const msg = chip.getAttribute('data-msg');
      if (msg) sendChatText(msg);
    });
  });

  if (addTodoBtn) {
    addTodoBtn.addEventListener('click', addTodoItem);
  }

  if (todoInput) {
    todoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTodoItem();
      }
    });
  }
  renderTodos();

  // 17. Coin Shop & Study Pets Modal
  const openShopBtn = document.getElementById('btn-open-shop');
  const closeShopBtn = document.getElementById('btn-close-shop');
  const shopBackdrop = document.getElementById('coin-shop-backdrop');
  const shopModal = document.getElementById('coin-shop-modal');
  const shopUserCoins = document.getElementById('shop-user-coins');

  function updateShopUI() {
    // Ensure Leaderboard is ready with safe defaults
    if (!window.Leaderboard) return;
    const cu = window.Leaderboard.currentUser;
    if (!cu) return;

    // Guarantee inventory has correct defaults
    if (!cu.inventory) cu.inventory = { pets: ['cat'], frames: [], themes: ['obsidian', 'paper'] };
    if (!cu.inventory.pets) cu.inventory.pets = ['cat'];
    if (!cu.inventory.themes) cu.inventory.themes = ['obsidian', 'paper'];
    if (!cu.equippedPet) cu.equippedPet = cu.activePet || 'cat';
    if (!cu.equippedTheme) cu.equippedTheme = localStorage.getItem('lockedin_theme') || 'obsidian';
    if (!cu.inventory.pets.includes('cat')) cu.inventory.pets.push('cat');
    if (!cu.inventory.themes.includes('obsidian')) cu.inventory.themes.push('obsidian');
    if (!cu.inventory.themes.includes('paper')) cu.inventory.themes.push('paper');

    if (shopUserCoins) {
      shopUserCoins.textContent = `🪙 ${cu.coins || 0} Coins`;
    }
    const inv = cu.inventory;
    const activePet = cu.equippedPet || cu.activePet;
    const activeTheme = cu.equippedTheme;

    // Update Pet buttons (5 Peaceful Desk Pets)
    document.querySelectorAll('#shop-tab-pets .shop-card').forEach(card => {
      const id = card.dataset.item;
      const btn = card.querySelector('.shop-action-btn');
      if (!btn) return;
      if (id === activePet) {
        btn.className = 'shop-action-btn equip-btn';
        btn.textContent = 'Equipped ✓';
        btn.onclick = null;
      } else if (inv.pets && inv.pets.includes(id)) {
        btn.className = 'shop-action-btn equip-btn';
        btn.textContent = 'Equip';
        btn.onclick = () => {
          window.Leaderboard.setActivePet(id);
          updateShopUI();
          showToast(`Equipped pet: ${card.querySelector('h4').textContent}`);
        };
      } else {
        btn.className = 'shop-action-btn buy-btn';
        btn.textContent = 'Buy';
        btn.onclick = () => {
          const cost = parseInt(card.dataset.cost, 10);
          if (window.Leaderboard.buyItem('pets', id, cost)) {
            window.Leaderboard.setActivePet(id);
            updateShopUI();
            showToast(`Unlocked & equipped: ${card.querySelector('h4').textContent}! 🎉`);
          } else {
            showToast('⚠️ Not enough coins! Earn +1 coin/min during focus.');
          }
        };
      }
    });

    // Update Theme buttons (8 CSS-Variable Themes)
    document.querySelectorAll('#shop-tab-themes .shop-card').forEach(card => {
      const id = card.dataset.item;
      const btn = card.querySelector('.shop-action-btn');
      if (!btn) return;
      const isEquipped = id === activeTheme;
      const isOwned = inv.themes && inv.themes.includes(id);
      if (isEquipped) {
        btn.className = 'shop-action-btn equip-btn';
        btn.textContent = 'Equipped ✓';
        btn.onclick = null;
      } else if (isOwned) {
        btn.className = 'shop-action-btn equip-btn';
        btn.textContent = 'Equip';
        btn.onclick = () => {
          window.Leaderboard.setActiveTheme(id);
          updateShopUI();
          showToast(`Applied theme: ${card.querySelector('h4').textContent} 🎨`);
        };
      } else {
        btn.className = 'shop-action-btn buy-btn';
        btn.textContent = 'Buy';
        btn.onclick = () => {
          const cost = parseInt(card.dataset.cost, 10);
          if (window.Leaderboard.buyItem('themes', id, cost)) {
            window.Leaderboard.setActiveTheme(id);
            updateShopUI();
            showToast(`Unlocked & applied: ${card.querySelector('h4').textContent}! 🎨`);
          } else {
            showToast('⚠️ Not enough coins! Earn +1 coin/min during focus.');
          }
        };
      }
    });
  }

  if (openShopBtn && shopModal) {
    openShopBtn.addEventListener('click', () => {
      updateShopUI();
      shopModal.classList.remove('hidden');
    });
  }
  if (closeShopBtn && shopModal) closeShopBtn.addEventListener('click', () => shopModal.classList.add('hidden'));
  if (shopBackdrop && shopModal) shopBackdrop.addEventListener('click', () => shopModal.classList.add('hidden'));

  document.querySelectorAll('.shop-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.querySelectorAll('.shop-tab-content').forEach(c => c.classList.add('hidden'));
      const activeContent = document.getElementById(`shop-tab-${target}`);
      if (activeContent) activeContent.classList.remove('hidden');
    });
  });

  // 18. Peer Doubt Board & BYOK Gemini AI Tutor
  const openDoubtsBtn = document.getElementById('btn-open-doubts');
  const closeDoubtsBtn = document.getElementById('btn-close-doubts');
  const doubtsDrawer = document.getElementById('doubt-board-drawer');
  const submitDoubtBtn = document.getElementById('btn-submit-doubt');
  const doubtSubjectInput = document.getElementById('doubt-subject-input');
  const doubtQuestionInput = document.getElementById('doubt-question-input');
  const doubtImageFile = document.getElementById('doubt-image-file');
  const doubtImageFilename = document.getElementById('doubt-image-filename');
  const doubtImagePreviewBox = document.getElementById('doubt-image-preview-box');
  const doubtImagePreview = document.getElementById('doubt-image-preview');
  const doubtsListEl = document.getElementById('doubts-list');

  let activeDoubtFilter = 'all';
  let cachedDoubts = [];
  let compressedDoubtImage = '';

  // Client-side Canvas Image Compression (<90KB, maxWidth 800px)
  function compressImageClient(file, maxWidth = 800, quality = 0.65) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  if (doubtImageFile) {
    doubtImageFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (doubtImageFilename) doubtImageFilename.textContent = file.name;
      try {
        compressedDoubtImage = await compressImageClient(file);
        if (doubtImagePreview && doubtImagePreviewBox) {
          doubtImagePreview.src = compressedDoubtImage;
          doubtImagePreviewBox.classList.remove('hidden');
        }
      } catch (err) {
        console.warn('[Doubt] Image compression error:', err);
      }
    });
  }

  if (openDoubtsBtn && doubtsDrawer) {
    openDoubtsBtn.addEventListener('click', () => {
      doubtsDrawer.classList.remove('hidden');
    });
  }
  if (closeDoubtsBtn && doubtsDrawer) {
    closeDoubtsBtn.addEventListener('click', () => {
      doubtsDrawer.classList.add('hidden');
    });
  }

  // Switch between Peer Doubts and AI Tutor tabs
  document.querySelectorAll('.doubt-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.doubt-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.doubt-tab-view').forEach(v => v.classList.add('hidden'));
      const activeView = document.getElementById(`doubt-tab-${tab}`);
      if (activeView) activeView.classList.remove('hidden');
    });
  });

  // Filter doubts (All | Open | Resolved)
  document.querySelectorAll('.doubt-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.doubt-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDoubtFilter = btn.dataset.filter;
      renderDoubtCards(cachedDoubts);
    });
  });

  function renderDoubtCards(doubts) {
    cachedDoubts = doubts || [];
    if (!doubtsListEl) return;
    doubtsListEl.innerHTML = '';

    let filtered = cachedDoubts;
    if (activeDoubtFilter === 'open') {
      filtered = cachedDoubts.filter(d => d.status === 'OPEN');
    } else if (activeDoubtFilter === 'resolved') {
      filtered = cachedDoubts.filter(d => d.status === 'RESOLVED');
    }

    if (filtered.length === 0) {
      doubtsListEl.innerHTML = '<div class="empty-state">No doubts matching current filter. Post one above!</div>';
      return;
    }

    filtered.forEach(d => {
      const card = document.createElement('div');
      card.className = 'doubt-card';
      const isOpen = d.status === 'OPEN';
      card.innerHTML = `
        <div class="doubt-card-top">
          <span class="doubt-subject-badge">${escapeHtml(d.subject || 'Study Question')}</span>
          <span class="${isOpen ? 'doubt-status-open' : 'doubt-status-resolved'}">
            ${isOpen ? '⏳ Open (20 🪙 Bounty)' : '✅ Solved'}
          </span>
        </div>
        <div class="doubt-card-text">${escapeHtml(d.questionText || '')}</div>
        <div class="doubt-card-footer">
          <span>By ${escapeHtml(d.authorCallSign || 'Scholar')}</span>
          <span style="color:var(--apple-blue); font-weight:600;">View & Solve ➔</span>
        </div>
      `;
      card.addEventListener('click', () => openDoubtDetail(d));
      doubtsListEl.appendChild(card);
    });
  }

  // Real-time listener for doubts
  if (window.FirebaseSync) {
    window.FirebaseSync.listenToDoubts((doubts) => {
      renderDoubtCards(doubts);
    });
  }

  // Post doubt
  if (submitDoubtBtn) {
    submitDoubtBtn.addEventListener('click', async () => {
      const subject = (doubtSubjectInput ? doubtSubjectInput.value : '').trim();
      const questionText = (doubtQuestionInput ? doubtQuestionInput.value : '').trim();
      if (!questionText) {
        showToast('⚠️ Please write your question or doubt first.');
        return;
      }

      // Check coins (cost 20)
      if (window.Leaderboard && !window.Leaderboard.spendCoins(20)) {
        showToast('⚠️ Posting a community doubt costs 20 Coins. Finish a focus block to earn coins!');
        return;
      }

      submitDoubtBtn.disabled = true;
      submitDoubtBtn.textContent = 'Posting...';

      try {
        await window.FirebaseSync.createDoubt({
          subject: subject || 'General Doubt',
          questionText: questionText,
          imageUrl: compressedDoubtImage || '',
          bountyCoins: 20
        });

        showToast('✅ Doubt posted with 20 coin bounty!');
        if (doubtSubjectInput) doubtSubjectInput.value = '';
        if (doubtQuestionInput) doubtQuestionInput.value = '';
        if (doubtImageFilename) doubtImageFilename.textContent = '';
        if (doubtImagePreviewBox) doubtImagePreviewBox.classList.add('hidden');
        compressedDoubtImage = '';
      } catch (err) {
        showToast('⚠️ Failed to post doubt. Try again.');
      } finally {
        submitDoubtBtn.disabled = false;
        submitDoubtBtn.textContent = 'Post Doubt (20 🪙)';
      }
    });
  }

  // Doubt Detail Modal & Solution Answering
  const doubtDetailModal = document.getElementById('doubt-detail-modal');
  const closeDoubtDetailBtn = document.getElementById('btn-close-doubt-detail');
  const doubtDetailBackdrop = document.getElementById('doubt-detail-backdrop');
  const doubtDetailSubject = document.getElementById('doubt-detail-subject');
  const doubtDetailAuthor = document.getElementById('doubt-detail-author');
  const doubtDetailQuestion = document.getElementById('doubt-detail-question');
  const doubtDetailImageBox = document.getElementById('doubt-detail-image-box');
  const doubtDetailImage = document.getElementById('doubt-detail-image');
  const doubtAnswersList = document.getElementById('doubt-answers-list');
  const doubtAnswerInput = document.getElementById('doubt-answer-input');
  const submitAnswerBtn = document.getElementById('btn-submit-answer');

  let currentActiveDoubt = null;
  let unsubscribeAnswers = null;

  function openDoubtDetail(doubt) {
    currentActiveDoubt = doubt;
    if (doubtDetailSubject) doubtDetailSubject.textContent = doubt.subject || 'Doubt Details';
    if (doubtDetailAuthor) doubtDetailAuthor.textContent = `Asked by ${doubt.authorCallSign || 'Scholar'} • Status: ${doubt.status}`;
    if (doubtDetailQuestion) doubtDetailQuestion.textContent = doubt.questionText || '';

    if (doubt.imageUrl && doubtDetailImageBox && doubtDetailImage) {
      doubtDetailImage.src = doubt.imageUrl;
      doubtDetailImageBox.classList.remove('hidden');
    } else if (doubtDetailImageBox) {
      doubtDetailImageBox.classList.add('hidden');
    }

    if (unsubscribeAnswers) unsubscribeAnswers();
    if (window.FirebaseSync) {
      unsubscribeAnswers = window.FirebaseSync.listenToDoubtAnswers(doubt.doubtId, (answers) => {
        renderDoubtAnswers(answers, doubt);
      });
    }

    if (doubtDetailModal) doubtDetailModal.classList.remove('hidden');
  }

  function renderDoubtAnswers(answers, doubt) {
    if (!doubtAnswersList) return;
    doubtAnswersList.innerHTML = '';
    const myUid = (window.FirebaseSync && window.FirebaseSync.currentUser) ? window.FirebaseSync.currentUser.uid : '';
    const isAuthor = (myUid && doubt.authorUid === myUid);

    if (!answers || answers.length === 0) {
      doubtAnswersList.innerHTML = '<div class="empty-state">No answers submitted yet. Provide a solution below!</div>';
      return;
    }

    answers.forEach(a => {
      const item = document.createElement('div');
      item.className = `doubt-answer-item ${a.isAccepted ? 'accepted' : ''}`;
      item.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="font-size:0.8rem;">${escapeHtml(a.authorCallSign || 'Scholar')}</strong>
          ${a.isAccepted ? '<span class="doubt-status-resolved">✓ ACCEPTED SOLUTION (+50 🪙)</span>' : ''}
        </div>
        <div style="font-size:0.85rem; line-height:1.4; white-space:pre-wrap; margin-bottom:6px;">${escapeHtml(a.answerText || '')}</div>
        ${(isAuthor && !a.isAccepted && doubt.status !== 'RESOLVED') ? `
          <div style="display:flex; justify-content:flex-end;">
            <button type="button" class="btn-timer btn-play accept-btn" data-aid="${a.answerId}" data-suid="${a.authorUid}" style="padding:3px 10px; font-size:0.75rem;">Accept Solution ✓ (+50 🪙)</button>
          </div>
        ` : ''}
      `;

      const acceptBtn = item.querySelector('.accept-btn');
      if (acceptBtn) {
        acceptBtn.addEventListener('click', async () => {
          await window.FirebaseSync.acceptDoubtAnswer(doubt.doubtId, a.answerId, a.authorUid);
          if (window.Leaderboard) {
            window.Leaderboard.awardDoubtSolved(a.authorUid);
          }
          showToast('🎉 Solution accepted! Bounty awarded to solver.');
        });
      }
      doubtAnswersList.appendChild(item);
    });
  }

  if (submitAnswerBtn && doubtAnswerInput) {
    submitAnswerBtn.addEventListener('click', async () => {
      const text = doubtAnswerInput.value.trim();
      if (!text || !currentActiveDoubt) return;
      submitAnswerBtn.disabled = true;
      try {
        await window.FirebaseSync.addDoubtAnswer(currentActiveDoubt.doubtId, text);
        doubtAnswerInput.value = '';
        showToast('Solution submitted!');
      } catch (e) {
        showToast('⚠️ Could not submit answer.');
      } finally {
        submitAnswerBtn.disabled = false;
      }
    });
  }

  if (closeDoubtDetailBtn && doubtDetailModal) {
    closeDoubtDetailBtn.addEventListener('click', () => {
      if (unsubscribeAnswers) unsubscribeAnswers();
      doubtDetailModal.classList.add('hidden');
    });
  }
  if (doubtDetailBackdrop && doubtDetailModal) {
    doubtDetailBackdrop.addEventListener('click', () => {
      if (unsubscribeAnswers) unsubscribeAnswers();
      doubtDetailModal.classList.add('hidden');
    });
  }

  // 19. BYOK Gemini AI Tutor Integration
  const geminiKeyInput = document.getElementById('gemini-api-key-input');
  const saveGeminiKeyBtn = document.getElementById('btn-save-gemini-key');
  const geminiKeyStatus = document.getElementById('gemini-key-status');
  const askGeminiBtn = document.getElementById('btn-ask-gemini');
  const aiTutorQuestion = document.getElementById('ai-tutor-question');
  const aiTutorImageFile = document.getElementById('ai-tutor-image-file');
  const aiTutorImageFilename = document.getElementById('ai-tutor-image-filename');
  const aiTutorImagePreviewBox = document.getElementById('ai-tutor-image-preview-box');
  const aiTutorImagePreview = document.getElementById('ai-tutor-image-preview');
  const aiTutorResponseBox = document.getElementById('ai-tutor-response-box');
  const aiTutorOutput = document.getElementById('ai-tutor-output');
  const copyAiResponseBtn = document.getElementById('btn-copy-ai-response');

  let compressedAiImage = '';

  function checkGeminiKeyStatus() {
    const savedKey = localStorage.getItem('lockedin_gemini_api_key');
    if (savedKey && geminiKeyStatus) {
      geminiKeyStatus.textContent = '✓ Active';
      geminiKeyStatus.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      geminiKeyStatus.style.color = '#10b981';
      if (geminiKeyInput) geminiKeyInput.value = savedKey;
    } else if (geminiKeyStatus) {
      geminiKeyStatus.textContent = 'Not Set';
      geminiKeyStatus.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      geminiKeyStatus.style.color = 'var(--apple-red)';
    }
  }
  checkGeminiKeyStatus();

  if (saveGeminiKeyBtn && geminiKeyInput) {
    saveGeminiKeyBtn.addEventListener('click', () => {
      const key = geminiKeyInput.value.trim();
      if (!key) {
        localStorage.removeItem('lockedin_gemini_api_key');
        showToast('Gemini key removed.');
      } else {
        localStorage.setItem('lockedin_gemini_api_key', key);
        showToast('Gemini key saved securely in browser storage! 🔑');
      }
      checkGeminiKeyStatus();
    });
  }

  if (aiTutorImageFile) {
    aiTutorImageFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (aiTutorImageFilename) aiTutorImageFilename.textContent = file.name;
      try {
        compressedAiImage = await compressImageClient(file, 800, 0.7);
        if (aiTutorImagePreview && aiTutorImagePreviewBox) {
          aiTutorImagePreview.src = compressedAiImage;
          aiTutorImagePreviewBox.classList.remove('hidden');
        }
      } catch (err) {
        console.warn('[AI Tutor] Image compression error:', err);
      }
    });
  }

  if (askGeminiBtn) {
    askGeminiBtn.addEventListener('click', async () => {
      const apiKey = localStorage.getItem('lockedin_gemini_api_key');
      if (!apiKey) {
        showToast('⚠️ Please enter and save your Gemini API key above first.');
        return;
      }
      const question = (aiTutorQuestion ? aiTutorQuestion.value : '').trim();
      if (!question) {
        showToast('⚠️ Please enter a question or problem to explain.');
        return;
      }

      askGeminiBtn.disabled = true;
      askGeminiBtn.textContent = 'Thinking...';
      if (aiTutorResponseBox) aiTutorResponseBox.classList.remove('hidden');
      if (aiTutorOutput) aiTutorOutput.textContent = 'Analyzing question and generating step-by-step solution...';

      try {
        const parts = [
          { text: "You are an expert, encouraging academic tutor in the LOCKED-IN study hall. Explain this concept or problem clearly, providing step-by-step reasoning, key formulas, and practical intuition:\n\n" + question }
        ];

        if (compressedAiImage) {
          const match = compressedAiImage.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2]
              }
            });
          }
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
        if (aiTutorOutput) {
          aiTutorOutput.textContent = reply;
        }
        showToast('✓ Gemini Tutor explained the concept!');
      } catch (err) {
        console.error('[AI Tutor] Query error:', err);
        if (aiTutorOutput) {
          aiTutorOutput.textContent = `⚠️ Error querying Gemini API: ${err.message}. Please check your API key and network connection.`;
        }
      } finally {
        askGeminiBtn.disabled = false;
        askGeminiBtn.textContent = '⚡ Ask Gemini 2.5 Flash';
      }
    });
  }

  if (copyAiResponseBtn && aiTutorOutput) {
    copyAiResponseBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(aiTutorOutput.textContent || '').then(() => {
        showToast('Copied explanation to clipboard!');
      }).catch(() => {});
    });
  }

  // Initial HUD render
  if (window.Leaderboard) {
    window.Leaderboard.renderHUD();
  }
});
