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

  // Room Type Switcher (Public vs Private)
  const tabBtnPublic = document.getElementById('tab-btn-public');
  const tabBtnPrivate = document.getElementById('tab-btn-private');
  const secPublic = document.getElementById('section-public-room');
  const secPrivate = document.getElementById('section-private-room');
  const privateRoomInput = document.getElementById('input-private-room');
  const privatePasscodeInput = document.getElementById('input-private-passcode');

  function setRoomMode(mode) {
    if (mode === 'private') {
      tabBtnPrivate.classList.add('active');
      tabBtnPublic.classList.remove('active');
      secPrivate.classList.remove('hidden');
      secPublic.classList.add('hidden');
    } else {
      tabBtnPublic.classList.add('active');
      tabBtnPrivate.classList.remove('active');
      secPublic.classList.remove('hidden');
      secPrivate.classList.add('hidden');
    }
  }

  if (tabBtnPublic && tabBtnPrivate) {
    tabBtnPublic.addEventListener('click', () => setRoomMode('public'));
    tabBtnPrivate.addEventListener('click', () => setRoomMode('private'));
  }

  // Pre-fill from URL params
  if (roomParam) {
    if (privateParam === '1' || privateParam === 'true') {
      setRoomMode('private');
      if (privateRoomInput) privateRoomInput.value = roomParam;
      if (keyParam && privatePasscodeInput) privatePasscodeInput.value = keyParam;
    }
  }

  // 2. Public Room Browser Data & Rendering
  const defaultPublicRooms = [
    { id: 'focus-lobby-1', name: 'Public Lobby #1', tag: '🔬 STEM & Pre-Med Grinders', online: 4 },
    { id: 'focus-lobby-2', name: 'Public Lobby #2', tag: '💻 Coding, Algo & LeetCode', online: 3 },
    { id: 'focus-lobby-3', name: 'Public Lobby #3', tag: '📚 Law, Humanities & UPSC', online: 2 },
    { id: 'focus-lobby-4', name: 'Public Lobby #4', tag: '⚡ Open Silent Focus Room', online: 1 }
  ];

  function renderPublicRooms() {
    const listEl = document.getElementById('public-room-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    defaultPublicRooms.forEach(room => {
      const item = document.createElement('div');
      item.className = 'public-room-item';
      item.innerHTML = `
        <div class="public-room-meta">
          <span class="public-room-name">${room.name}</span>
          <span class="public-room-tag">${room.tag}</span>
        </div>
        <div class="public-room-right">
          <span class="public-room-count ${room.online >= 8 ? 'full' : ''}">${room.online}/8 Online</span>
          <button class="btn-mini-join" ${room.online >= 8 ? 'disabled' : ''}>${room.online >= 8 ? 'Full' : 'Join'}</button>
        </div>
      `;

      const joinBtn = item.querySelector('.btn-mini-join');
      if (joinBtn && room.online < 8) {
        joinBtn.addEventListener('click', () => {
          startStudySession(room.id, false, null);
        });
      }
      listEl.appendChild(item);
    });
  }

  renderPublicRooms();

  const refreshRoomsBtn = document.getElementById('btn-refresh-rooms');
  if (refreshRoomsBtn) {
    refreshRoomsBtn.addEventListener('click', () => {
      // Simulate random active peer discovery updates
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
      // Find first room with < 8 participants or create next overflow
      const targetRoom = defaultPublicRooms.find(r => r.online < 8) || { id: 'focus-lobby-overflow' };
      startStudySession(targetRoom.id, false, null);
    });
  }

  // Enter Private Room Button
  const joinPrivateBtn = document.getElementById('btn-join-private');
  if (joinPrivateBtn) {
    joinPrivateBtn.addEventListener('click', () => {
      const roomCode = (privateRoomInput.value || '').trim();
      const passcode = (privatePasscodeInput.value || '').trim();

      if (!roomCode) {
        alert('Please enter a Private Room Code or Name (e.g. "chem-study-squad").');
        privateRoomInput.focus();
        return;
      }

      startStudySession(`private-${roomCode.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`, true, passcode);
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

  if (openAdminBtn && adminModal) {
    openAdminBtn.addEventListener('click', () => {
      adminModal.classList.remove('hidden');
      if (window.Soundboard.isAdminAuthenticated) {
        adminAuthView.classList.add('hidden');
        adminContentView.classList.remove('hidden');
        renderAdminSoundboardList();
      } else {
        adminAuthView.classList.remove('hidden');
        adminContentView.classList.add('hidden');
      }
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
      if (window.Soundboard.verifyAdminPin(pin)) {
        adminAuthView.classList.add('hidden');
        adminContentView.classList.remove('hidden');
        renderAdminSoundboardList();
      } else {
        alert('Incorrect Admin PIN. Default PIN is 2027.');
      }
    });
  }

  // Render 25 Triggers in Admin Soundboard
  function renderAdminSoundboardList() {
    const container = document.getElementById('soundboard-cards-container');
    if (!container) return;
    container.innerHTML = '';

    const triggers = window.TRIGGER_DEFINITIONS || [];
    triggers.forEach(t => {
      const conf = window.Soundboard.soundConfigs[t.id] || {};
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
          window.Soundboard.saveSoundSlot(t.id, {
            blob: file,
            fileName: file.name,
            volume: parseInt(volSlider.value, 10)
          });
          dropLabel.textContent = file.name;
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
      const oldPin = prompt('Enter Current Admin PIN:');
      const newPin = prompt('Enter New Admin PIN (min 4 characters):');
      if (window.Soundboard.changeAdminPin(oldPin, newPin)) {
        alert('Admin PIN updated successfully.');
      } else {
        alert('Failed to update PIN. Verify your current PIN and new PIN format.');
      }
    });
  }

  // Initial HUD render
  if (window.Leaderboard) {
    window.Leaderboard.renderHUD();
  }
});
