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

  // Pre-fill from URL params
  if (roomParam) {
    if (privateParam === '1' || privateParam === 'true') {
      setRoomMode('private');
      if (privateRoomInput) privateRoomInput.value = roomParam;
      if (keyParam && privatePasscodeInput) privatePasscodeInput.value = keyParam;
    }
  }

  // 2. Among Us Style Public Room Browser
  let currentFilter = 'all';
  const defaultPublicRooms = [
    { id: 'focus-lobby-1', name: "Red's Reactor", host: "RedScholar", category: 'stem', tag: '🔬 Organic Chem & Physics', timer: '25m', color: 'color-red', online: 5 },
    { id: 'focus-lobby-2', name: "Cyan's Cyber Lab", host: "CyanDev", category: 'code', tag: '💻 Rust & LeetCode Hard', timer: '50m', color: 'color-cyan', online: 3 },
    { id: 'focus-lobby-3', name: "Green's Med Bay", host: "DrGreen", category: 'med', tag: '🩺 Anatomy & MCAT Prep', timer: '50m', color: 'color-green', online: 4 },
    { id: 'focus-lobby-4', name: "Purple's Library", host: "SilentPurple", category: 'silent', tag: '🤫 Absolute Silent Grind', timer: '25m', color: 'color-purple', online: 2 },
    { id: 'focus-lobby-5', name: "Orange's Shield Room", host: "OrangeLaw", category: 'stem', tag: '📚 Calculus & Linear Alg', timer: '90m', color: 'color-orange', online: 6 },
    { id: 'focus-lobby-6', name: "Yellow's Navigation", host: "StarScholar", category: 'code', tag: '💻 Full-Stack Architecture', timer: '25m', color: 'color-yellow', online: 1 }
  ];

  function renderPublicRooms() {
    const listEl = document.getElementById('public-room-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const filtered = defaultPublicRooms.filter(r => currentFilter === 'all' || r.category === currentFilter);

    filtered.forEach(room => {
      const card = document.createElement('div');
      card.className = 'au-room-card';

      // Build 8 Among Us capacity dots
      let dotsHtml = '';
      for (let i = 0; i < 8; i++) {
        if (i < room.online) {
          dotsHtml += '<span class="dot-filled">●</span>';
        } else {
          dotsHtml += '<span class="dot-empty">○</span>';
        }
      }

      card.innerHTML = `
        <div class="au-room-left">
          <div class="au-crewmate-icon ${room.color}"></div>
          <div class="au-room-details">
            <span class="au-room-title">${room.name}</span>
            <div class="au-room-tags">
              <span class="au-tag-chip">${room.tag}</span>
              <span class="au-timer-chip">${room.timer}</span>
            </div>
          </div>
        </div>
        <div class="au-room-right">
          <div class="au-crew-dots" title="${room.online}/8 crew members online">
            ${dotsHtml}
            <span class="au-capacity-text">${room.online}/8</span>
          </div>
          <button type="button" class="au-join-btn" ${room.online >= 8 ? 'disabled' : ''}>${room.online >= 8 ? 'FULL' : 'JOIN'}</button>
        </div>
      `;

      const joinBtn = card.querySelector('.au-join-btn');
      if (joinBtn && room.online < 8) {
        joinBtn.addEventListener('click', () => {
          startStudySession(room.id, false, null);
        });
      }
      listEl.appendChild(card);
    });
  }

  renderPublicRooms();

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      renderPublicRooms();
    });
  });

  const refreshRoomsBtn = document.getElementById('btn-refresh-rooms');
  if (refreshRoomsBtn) {
    refreshRoomsBtn.addEventListener('click', () => {
      defaultPublicRooms.forEach(r => {
        r.online = Math.max(1, Math.min(7, r.online + (Math.random() > 0.5 ? 1 : -1)));
      });
      renderPublicRooms();
    });
  }

  // Quick Join Public Lobby Button
  const quickJoinPublicBtn = document.getElementById('btn-quick-join-public');
  if (quickJoinPublicBtn) {
    quickJoinPublicBtn.addEventListener('click', () => {
      const targetRoom = defaultPublicRooms.find(r => r.online < 8) || { id: 'focus-lobby-1' };
      startStudySession(targetRoom.id, false, null);
    });
  }

  // Enter Private Room Button & Arrow Button
  const joinPrivateBtn = document.getElementById('btn-join-private');
  const submitCodeArrow = document.getElementById('btn-submit-code-arrow');

  function handlePrivateJoin() {
    const roomCode = (privateRoomInput.value || '').trim();
    const passcode = (privatePasscodeInput.value || '').trim();

    if (!roomCode) {
      alert('Please enter a Private Room Code (e.g. "SKELD42").');
      privateRoomInput.focus();
      return;
    }

    startStudySession(`private-${roomCode.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`, true, passcode);
  }

  if (joinPrivateBtn) joinPrivateBtn.addEventListener('click', handlePrivateJoin);
  if (submitCodeArrow) submitCodeArrow.addEventListener('click', handlePrivateJoin);

  // Host / Create Game Button
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
    createHostBtn.addEventListener('click', () => {
      const titleInput = document.getElementById('input-host-room-title');
      const subjectSelect = document.getElementById('select-host-subject');
      const title = (titleInput && titleInput.value.trim()) || "Commander's Bridge";
      const subject = subjectSelect ? subjectSelect.options[subjectSelect.selectedIndex].text : 'General Deep Work';

      // Set host preset on timer
      if (window.StudyTimer) {
        window.StudyTimer.setPreset(hostFocus, hostBreak);
      }

      const generatedId = `host-${title.toLowerCase().replace(/[^a-z0-9_-]/g, '')}-${Math.random().toString(36).substring(2, 6)}`;
      startStudySession(generatedId, false, null);
    });
  }

  // 3. Centralized Study Session Starter
  async function startStudySession(roomId, isPrivate = false, passcode = null) {
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

    // Show loading state
    if (quickJoinPublicBtn) quickJoinPublicBtn.disabled = true;
    if (joinPrivateBtn) joinPrivateBtn.disabled = true;

    // Initialize media
    const mediaSuccess = await window.WebRTCRoom.initLocalMedia({ mode: selectedMode });
    if (!mediaSuccess) {
      if (quickJoinPublicBtn) quickJoinPublicBtn.disabled = false;
      if (joinPrivateBtn) joinPrivateBtn.disabled = false;
      return;
    }

    // Join WebRTC room
    await window.WebRTCRoom.joinStudyRoom(roomId, isPrivate, passcode);

    // Start Trigger Engine monitoring
    const localCamVideo = document.getElementById('local-cam-video');
    const localScreenVideo = document.getElementById('local-screen-video');
    window.TriggerEngine.startMonitoring({
      localVideoEl: localCamVideo,
      screenVideoEl: localScreenVideo,
      localAudioStream: window.WebRTCRoom.localCamStream
    });

    // Update Local Tile HUD
    document.getElementById('local-user-name').textContent = displayName;
    document.getElementById('local-subject-goal').textContent = subjectGoal;

    // Switch from Lobby to Study Room
    document.getElementById('lobby-view').classList.add('hidden');
    document.getElementById('study-room-view').classList.remove('hidden');

    // Initialize Study Timer
    window.StudyTimer.resetTimer();
  }

  // 4. Copy Invite Link
  const copyLinkBtn = document.getElementById('btn-copy-invite');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const currentRoom = window.WebRTCRoom.roomId || 'focus-lobby-1';
      const isPrivate = window.WebRTCRoom.isPrivate;
      const passcode = window.WebRTCRoom.passcode;

      let inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoom)}`;
      if (isPrivate) {
        inviteUrl += '&private=1';
        if (passcode) {
          inviteUrl += `&key=${encodeURIComponent(passcode)}`;
        }
      }

      navigator.clipboard.writeText(inviteUrl).then(() => {
        const originalText = copyLinkBtn.innerHTML;
        copyLinkBtn.innerHTML = '<span>✅ Copied!</span>';
        setTimeout(() => copyLinkBtn.innerHTML = originalText, 2000);
      }).catch(() => {
        prompt('Copy invite link:', inviteUrl);
      });
    });
  }

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

  // Push-to-Talk: Spacebar hold
  let isSpacePressed = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isSpacePressed && pttCheckbox && pttCheckbox.checked) {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      isSpacePressed = true;
      window.WebRTCRoom.muteMic(false);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && isSpacePressed && pttCheckbox && pttCheckbox.checked) {
      isSpacePressed = false;
      window.WebRTCRoom.muteMic(true);
    }
  });

  // 7. Raise Hand Control
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

  // 10. Admin Soundboard Studio Modal & Auth
  const openAdminBtn = document.getElementById('btn-open-admin');
  const closeAdminBtn = document.getElementById('btn-close-admin');
  const adminModal = document.getElementById('admin-studio-modal');
  const adminAuthView = document.getElementById('admin-auth-view');
  const adminContentView = document.getElementById('admin-content-view');
  const adminPinInput = document.getElementById('admin-pin-input');
  const adminUnlockBtn = document.getElementById('admin-unlock-btn');
  const displaySavedPin = document.getElementById('display-saved-pin');
  const adminPinFeedback = document.getElementById('admin-pin-feedback');
  const instantUnlockBtn = document.getElementById('btn-instant-unlock');

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

  function updateSavedPinDisplay() {
    if (displaySavedPin) {
      displaySavedPin.textContent = window.Soundboard?.adminPin || localStorage.getItem('lockedin_admin_pin') || '2027';
    }
  }

  if (openAdminBtn && adminModal) {
    openAdminBtn.addEventListener('click', () => {
      adminModal.classList.remove('hidden');
      updateSavedPinDisplay();
      if (window.Soundboard && window.Soundboard.isAdminAuthenticated) {
        if (adminAuthView) adminAuthView.classList.add('hidden');
        if (adminContentView) adminContentView.classList.remove('hidden');
        try {
          renderAdminSoundboardList();
        } catch (e) {
          console.warn('[Admin] Render list error:', e);
        }
      } else {
        if (adminAuthView) adminAuthView.classList.remove('hidden');
        if (adminContentView) adminContentView.classList.add('hidden');
        if (adminPinFeedback) adminPinFeedback.textContent = '';
      }
    });
  }

  if (instantUnlockBtn) {
    instantUnlockBtn.addEventListener('click', () => {
      unlockAdminStudioUI();
    });
  }

  if (closeAdminBtn && adminModal) {
    closeAdminBtn.addEventListener('click', () => {
      adminModal.classList.add('hidden');
    });
  }

  if (adminUnlockBtn) {
    adminUnlockBtn.addEventListener('click', () => {
      const pin = (adminPinInput.value || '').trim();
      if (!window.Soundboard || window.Soundboard.verifyAdminPin(pin) || !pin) {
        unlockAdminStudioUI();
      } else {
        if (adminPinFeedback) {
          const curPin = window.Soundboard?.adminPin || '2027';
          adminPinFeedback.textContent = `PIN did not match saved PIN (${curPin}). Click "Direct Unlock" or enter 2027.`;
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

  const forgotPinBtn = document.getElementById('btn-forgot-pin');
  if (forgotPinBtn) {
    forgotPinBtn.addEventListener('click', () => {
      if (window.Soundboard) {
        window.Soundboard.resetAdminPinToDefault();
      }
      updateSavedPinDisplay();
      unlockAdminStudioUI();
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

  // Admin Studio: Save Firebase Config Paste Box
  const firebaseConfigTextarea = document.getElementById('firebase-config-json');
  const saveFirebaseBtn = document.getElementById('btn-save-firebase-config');
  const firebaseStatusPill = document.getElementById('firebase-status-pill');

  if (saveFirebaseBtn && firebaseConfigTextarea) {
    // Populate current saved config if present
    const existing = localStorage.getItem('lockedin_firebase_config');
    if (existing) {
      firebaseConfigTextarea.value = existing;
      if (firebaseStatusPill) {
        firebaseStatusPill.textContent = 'Cloud Connected';
        firebaseStatusPill.className = 'pill-online';
      }
    }

    saveFirebaseBtn.addEventListener('click', () => {
      const raw = firebaseConfigTextarea.value.trim();
      if (!raw) {
        localStorage.removeItem('lockedin_firebase_config');
        alert('Cleared Firebase config. App will run in Local/PeerJS Instant Mode.');
        if (firebaseStatusPill) {
          firebaseStatusPill.textContent = 'Local Instant Mode';
          firebaseStatusPill.className = 'pill-local';
        }
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const success = window.FirebaseSync.saveConfig(parsed);
        if (success) {
          alert('Firebase config saved successfully! Connected to cloud.');
          if (firebaseStatusPill) {
            firebaseStatusPill.textContent = 'Cloud Connected';
            firebaseStatusPill.className = 'pill-online';
          }
        } else {
          alert('Saved config. Reloading page to initialize cloud sync...');
          window.location.reload();
        }
      } catch (err) {
        alert('Invalid JSON format. Please paste a valid Firebase Web config JSON object.');
      }
    });
  }

  // Admin Studio: Change PIN
  const changePinBtn = document.getElementById('btn-change-pin');
  if (changePinBtn) {
    changePinBtn.addEventListener('click', () => {
      const oldPin = prompt('Enter Current Admin PIN (or 2027):');
      const newPin = prompt('Enter New Admin PIN (min 4 characters):');
      if (window.Soundboard.changeAdminPin(oldPin, newPin)) {
        alert('Admin PIN updated successfully.');
      } else {
        alert('Failed to update PIN. Verify your current PIN and new PIN format.');
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

  // Preset noise buttons
  document.querySelectorAll('.btn-noise-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-noise-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const noiseType = btn.getAttribute('data-noise');

      if (window.StudyNoise) {
        if (noiseType === 'brown') window.StudyNoise.playBrownNoise();
        else if (noiseType === 'white') window.StudyNoise.playWhiteNoise();
        else if (noiseType === 'pink') window.StudyNoise.playPinkNoise();
        else if (noiseType === 'binaural') window.StudyNoise.playBinauralBeats();
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

  // Set YouTube / External track status
  if (setTrackBtn && customTrackInput) {
    setTrackBtn.addEventListener('click', () => {
      const track = (customTrackInput.value || '').trim();
      const isApproved = checkStudyAudio ? checkStudyAudio.checked : true;
      if (!track) {
        alert('Please enter a track title or YouTube stream name.');
        return;
      }
      if (window.StudyNoise) {
        window.StudyNoise.setCustomStudyTrack(track, isApproved);
        alert(`Broadcasting audio status: "${track}" (${isApproved ? 'Focus Audio' : 'Non-Study Alert!'})`);
      }
      if (noiseModal) noiseModal.classList.add('hidden');
    });
  }

  if (clearTrackBtn) {
    clearTrackBtn.addEventListener('click', () => {
      if (customTrackInput) customTrackInput.value = '';
      if (window.StudyNoise) {
        window.StudyNoise.stopNoise();
        window.StudyNoise.setNowListening('None');
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

  // Initial HUD render
  if (window.Leaderboard) {
    window.Leaderboard.renderHUD();
  }
});
