/**
 * LOCKED-IN: Pomodoro & Study Timer Engine
 * Handles focus/break cycles, clean study points rewards,
 * victory milestones, Red X punishment strike, and host synchronization.
 */

class StudyTimerManager {
  constructor() {
    this.mode = 'FOCUS'; // 'FOCUS' or 'BREAK'
    this.focusDurationMinutes = 25;
    this.breakDurationMinutes = 5;
    this.totalSeconds = 25 * 60;
    this.secondsLeft = 25 * 60;
    this.isRunning = false;
    this.timerInterval = null;
    this.isSyncedWithHost = false;

    // Track zero-distraction focus block
    this.triggersInCurrentBlock = 0;
    this.breakOverstaySeconds = 0;
  }

  setPreset(focusMins, breakMins) {
    this.focusDurationMinutes = focusMins;
    this.breakDurationMinutes = breakMins;
    if (!this.isRunning) {
      this.resetTimer();
    }
  }

  setCustom(focusMins, breakMins) {
    const f = Math.max(15, Math.min(180, parseInt(focusMins, 10) || 25));
    const b = Math.max(5, Math.min(60, parseInt(breakMins, 10) || 5));
    this.setPreset(f, b);
  }

  syncRoomTimerToFirestore() {
    if (window.WebRTCRoom && window.WebRTCRoom.roomId && window.FirebaseSync && window.FirebaseSync.updateRoomTimer) {
      window.FirebaseSync.updateRoomTimer(window.WebRTCRoom.roomId, {
        timerEndAt: this.isRunning ? (Date.now() + this.secondsLeft * 1000) : null,
        timerMode: this.mode,
        isRunning: this.isRunning,
        secondsLeft: this.secondsLeft
      });
    }
  }

  startTimer(skipSync = false) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateControlsUI();

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.tick();
    }, 1000);

    if (!skipSync) this.syncRoomTimerToFirestore();
  }

  pauseTimer(skipSync = false) {
    this.isRunning = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (window.TriggerEngine && window.TriggerEngine.resetAndHideAllOverlays) {
      window.TriggerEngine.resetAndHideAllOverlays();
    }
    this.updateControlsUI();

    if (!skipSync) this.syncRoomTimerToFirestore();
  }

  resetTimer(skipSync = false) {
    this.pauseTimer(true);
    this.mode = 'FOCUS';
    this.totalSeconds = this.focusDurationMinutes * 60;
    this.secondsLeft = this.totalSeconds;
    this.triggersInCurrentBlock = 0;
    if (window.TriggerEngine && window.TriggerEngine.resetAndHideAllOverlays) {
      window.TriggerEngine.resetAndHideAllOverlays();
    }
    this.renderDisplay();
    this.updateModePill();

    if (!skipSync) this.syncRoomTimerToFirestore();
  }

  tick() {
    if (this.secondsLeft > 0) {
      this.secondsLeft--;
      this.renderDisplay();

      // Award +2 points for every clean focused minute
      if (this.mode === 'FOCUS') {
        // Track continuous clean focus for shame redemption
        if (window.TriggerEngine && window.TriggerEngine.recordCleanSecond) {
          window.TriggerEngine.recordCleanSecond();
        }

        if (this.secondsLeft % 60 === 0) {
          if (window.Leaderboard) {
            window.Leaderboard.awardCleanStudyMinute();
          }
        }
      }

      // Sync with peers if host
      if (window.WebRTCRoom && window.WebRTCRoom.isHost) {
        window.WebRTCRoom.broadcastData({
          type: 'TIMER_SYNC',
          mode: this.mode,
          secondsLeft: this.secondsLeft,
          isRunning: this.isRunning
        });
      }
    } else {
      // Timer hit 00:00!
      this.handleCycleCompletion();
    }
  }

  handleCycleCompletion() {
    if (this.mode === 'FOCUS') {
      // Completed Focus Block!
      if (this.triggersInCurrentBlock === 0) {
        // VICTORY TRIGGER: bonus points, coins & XP
        let rewardMsg = '+25 bonus points!';
        if (window.Leaderboard && window.Leaderboard.awardPomodoroComplete) {
          const res = window.Leaderboard.awardPomodoroComplete(this.focusDurationMinutes);
          rewardMsg = `+${res.coinsEarned} 🪙 Coins, +${res.xpEarned} XP!`;
          if (res.leveledUp) {
            rewardMsg += ` 🎉 LEVELED UP TO LVL ${res.newLevel}!`;
          }
        } else if (window.Leaderboard) {
          window.Leaderboard.awardBlockVictoryBonus();
        }
        if (window.Soundboard) {
          window.Soundboard.playTrigger('FOCUS_BLOCK_VICTORY', true);
        }
        this.showToast(`🏆 FOCUS BLOCK VICTORY! Distraction-Free (${rewardMsg})`);
      }

      // Auto-clear any lingering shame stamp on focus block completion
      if (window.TriggerEngine && window.TriggerEngine.clearLocalShame) {
        window.TriggerEngine.clearLocalShame('Focus block completed');
      }

      // Transition to Break Mode
      this.mode = 'BREAK';
      this.totalSeconds = this.breakDurationMinutes * 60;
      this.secondsLeft = this.totalSeconds;
      this.updateModePill();

      // UNLOCK MICS FOR CASUAL VOICE LOUNGE
      if (window.WebRTCRoom) {
        window.WebRTCRoom.muteMic(false);
      }
      this.showToast('☕ Break Time! Microphones unlocked for voice lounge.');
    } else {
      // Break Expired!
      this.showToast('🔔 Break expired! Ready to lock back in? Click "Start Focus" within 60s.');
      // Monitor late return
      let lateTimer = 0;
      const lateCheck = setInterval(() => {
        if (this.mode === 'FOCUS') {
          clearInterval(lateCheck);
          return;
        }
        lateTimer += 5;
        if (lateTimer >= 60) {
          clearInterval(lateCheck);
          if (window.TriggerEngine) {
            window.TriggerEngine.triggerCandidate('LATE_BREAK_RETURN', 'Break overstayed by more than 60 seconds!');
          }
        }
      }, 5000);
    }
  }

  // Distraction Strike: Bold Red X across timer & reset current block progress
  punishAndReset() {
    this.triggersInCurrentBlock++;
    const timerDisplay = document.getElementById('local-timer-display');
    if (timerDisplay) {
      timerDisplay.classList.add('timer-struck-red-x');
      setTimeout(() => {
        timerDisplay.classList.remove('timer-struck-red-x');
      }, 4000);
    }

    // Reset current focus block
    this.secondsLeft = this.focusDurationMinutes * 60;
    this.renderDisplay();
  }

  syncFromRoomDoc(roomData) {
    if (!roomData || typeof roomData.isRunning !== 'boolean') return;
    const nextMode = String(roomData.timerMode || 'FOCUS').toUpperCase();
    const shouldRun = !!roomData.isRunning;

    if (nextMode !== this.mode) {
      this.mode = nextMode;
      this.updateModePill();
    }

    if (shouldRun && roomData.timerEndAt) {
      const remaining = Math.max(0, Math.round((roomData.timerEndAt - Date.now()) / 1000));
      this.secondsLeft = remaining;
      this.renderDisplay();
      if (!this.isRunning) {
        this.startTimer(true);
      }
    } else {
      if (typeof roomData.secondsLeft === 'number') {
        this.secondsLeft = Math.max(0, roomData.secondsLeft);
      }
      this.renderDisplay();
      if (this.isRunning) {
        this.pauseTimer(true);
      } else {
        this.updateControlsUI();
      }
    }
  }

  syncFromHost(data) {
    if (!this.isSyncedWithHost) return;
    this.mode = data.mode;
    this.secondsLeft = data.secondsLeft;
    this.isRunning = data.isRunning;
    this.renderDisplay();
    this.updateModePill();
  }

  renderDisplay() {
    const mins = Math.floor(this.secondsLeft / 60);
    const secs = this.secondsLeft % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const timerDisplay = document.getElementById('local-timer-display');
    if (timerDisplay) {
      timerDisplay.textContent = formatted;
    }

    // Update document title for background visibility
    document.title = `(${formatted}) LOCKED-IN Study`;
  }

  updateModePill() {
    const pill = document.querySelector('#local-user-tile .status-pill');
    if (pill) {
      if (this.mode === 'BREAK') {
        pill.textContent = 'ON BREAK';
        pill.className = 'status-pill status-break';
      } else {
        pill.textContent = 'LOCKED IN';
        pill.className = 'status-pill status-locked';
      }
    }
  }

  updateControlsUI() {
    const playBtn = document.getElementById('timer-start-btn');
    if (playBtn) {
      playBtn.textContent = this.isRunning ? '⏸️ Pause' : '▶️ Start Focus';
      playBtn.className = this.isRunning ? 'btn-timer btn-pause' : 'btn-timer btn-play';
    }
  }

  showToast(msg) {
    if (window.TriggerEngine) {
      window.TriggerEngine.showShameToast(msg);
    } else {
      alert(msg);
    }
  }
}

window.StudyTimer = new StudyTimerManager();
