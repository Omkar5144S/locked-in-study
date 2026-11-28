/**
 * growth-features.js
 * Implements:
 * 1. Daily Study Heatmap (84-day GitHub-style grid) + Streak Freeze
 * 2. Exam Countdown & Daily Focus Target Widget
 * 3. 1v1 Accountability Focus Duels (Coin Wagers)
 * 4. Smart AI Study Coach (Gemini 3.8 Flash Session Recap & Quiz)
 * 5. Referral & Invite Coin Rewards (?ref=CODE)
 */

(function () {
  const KEY_HEATMAP = 'lockedin_daily_heatmap';
  const KEY_EXAM = 'lockedin_exam_target';
  const KEY_FREEZES = 'lockedin_streak_freezes';
  const KEY_DUEL = 'lockedin_active_duel';
  const KEY_REF_CLAIMED = 'lockedin_ref_claimed';

  function getTodayKey(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function getHeatmap() {
    try {
      return JSON.parse(localStorage.getItem(KEY_HEATMAP) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveHeatmap(map) {
    try {
      localStorage.setItem(KEY_HEATMAP, JSON.stringify(map));
    } catch (e) {}
  }

  function getExamConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY_EXAM) || 'null');
      if (saved && saved.name) return saved;
    } catch (e) {}
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 45);
    return {
      name: 'Target Exam',
      date: defaultDate.toISOString().slice(0, 10),
      dailyGoalMins: 120
    };
  }

  function saveExamConfig(cfg) {
    try {
      localStorage.setItem(KEY_EXAM, JSON.stringify(cfg));
    } catch (e) {}
  }

  function getFreezeCount() {
    return Math.max(0, parseInt(localStorage.getItem(KEY_FREEZES) || '0', 10) || 0);
  }

  function setFreezeCount(n) {
    localStorage.setItem(KEY_FREEZES, String(Math.max(0, n)));
  }

  function getCoins() {
    if (window.Leaderboard && typeof window.Leaderboard.coins === 'number') {
      return window.Leaderboard.coins;
    }
    return parseInt(localStorage.getItem('lockedin_coins') || '50', 10) || 0;
  }

  function addCoins(delta) {
    if (window.Leaderboard) {
      window.Leaderboard.coins = Math.max(0, (window.Leaderboard.coins || 0) + delta);
      if (window.Leaderboard.saveLocalState) window.Leaderboard.saveLocalState();
      if (window.Leaderboard.renderHUD) window.Leaderboard.renderHUD();
      if (window.FirebaseSync && window.FirebaseSync.saveUserEconomy) {
        window.FirebaseSync.saveUserEconomy(window.Leaderboard.getEconomyState());
      }
    } else {
      const next = Math.max(0, getCoins() + delta);
      localStorage.setItem('lockedin_coins', String(next));
    }
  }

  function toast(msg) {
    if (window.showToast) window.showToast(msg, 3500);
    else if (window.StudyTimer && window.StudyTimer.showToast) window.StudyTimer.showToast(msg);
  }

  function renderExamAndHeatmap() {
    const cfg = getExamConfig();
    const map = getHeatmap();
    const todayMins = map[getTodayKey(0)] || 0;
    const goal = Math.max(15, parseInt(cfg.dailyGoalMins, 10) || 120);
    const pct = Math.min(100, Math.round((todayMins / goal) * 100));

    const targetMs = new Date(cfg.date + 'T00:00:00').getTime();
    const daysLeft = Math.max(0, Math.ceil((targetMs - Date.now()) / 86400000));

    const titleEl = document.getElementById('growth-exam-title');
    const daysEl = document.getElementById('growth-exam-days');
    const progTextEl = document.getElementById('growth-daily-text');
    const progFillEl = document.getElementById('growth-daily-fill');
    const freezeEl = document.getElementById('growth-freeze-count');

    if (titleEl) titleEl.textContent = `🎯 ${cfg.name}`;
    if (daysEl) daysEl.textContent = daysLeft === 0 ? 'Today!' : `${daysLeft}d left`;
    if (progTextEl) progTextEl.textContent = `${todayMins}m / ${goal}m today (${pct}%)`;
    if (progFillEl) progFillEl.style.width = `${pct}%`;
    if (freezeEl) freezeEl.textContent = `${getFreezeCount()} ❄️`;

    const grid = document.getElementById('growth-heatmap-grid');
    if (grid) {
      grid.innerHTML = '';
      // 84 days (12 weeks)
      for (let i = 83; i >= 0; i--) {
        const key = getTodayKey(i);
        const mins = map[key] || 0;
        const cell = document.createElement('span');
        cell.className = 'heatmap-cell';
        if (mins >= 120) cell.classList.add('lvl-4');
        else if (mins >= 60) cell.classList.add('lvl-3');
        else if (mins >= 25) cell.classList.add('lvl-2');
        else if (mins > 0) cell.classList.add('lvl-1');
        cell.title = `${key}: ${mins} min focused`;
        grid.appendChild(cell);
      }
    }
  }

  function renderDuelUI() {
    const statusBox = document.getElementById('duel-active-box');
    const setupBox = document.getElementById('duel-setup-box');
    const wagerLabel = document.getElementById('duel-active-wager');
    let duel = null;
    try {
      duel = JSON.parse(localStorage.getItem(KEY_DUEL) || 'null');
    } catch (e) {}

    if (duel && duel.wager > 0) {
      if (statusBox) statusBox.classList.remove('hidden');
      if (setupBox) setupBox.classList.add('hidden');
      if (wagerLabel) wagerLabel.textContent = `${duel.wager} 🪙 → Win ${duel.wager * 2} 🪙`;
    } else {
      if (statusBox) statusBox.classList.add('hidden');
      if (setupBox) setupBox.classList.remove('hidden');
    }
  }

  function checkReferralOnLoad() {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = (params.get('ref') || '').trim();
      const myName = (localStorage.getItem('lockedin_display_name') || '').trim().toUpperCase();
      if (ref && !localStorage.getItem(KEY_REF_CLAIMED) && ref.toUpperCase() !== myName) {
        localStorage.setItem(KEY_REF_CLAIMED, ref);
        setTimeout(() => {
          addCoins(50);
          toast(`🎁 Referral bonus! +50 🪙 Coins awarded via ${ref}'s invite!`);
        }, 1200);
      }
    } catch (e) {}
  }

  const GrowthFeatures = {
    init() {
      renderExamAndHeatmap();
      renderDuelUI();
      checkReferralOnLoad();

      // Edit Exam Target
      const editBtn = document.getElementById('btn-edit-exam-target');
      const editorBox = document.getElementById('growth-exam-editor');
      const saveExamBtn = document.getElementById('btn-save-exam-target');
      if (editBtn && editorBox) {
        editBtn.addEventListener('click', () => {
          const cfg = getExamConfig();
          const n = document.getElementById('input-exam-name');
          const d = document.getElementById('input-exam-date');
          const g = document.getElementById('input-exam-goal');
          if (n) n.value = cfg.name;
          if (d) d.value = cfg.date;
          if (g) g.value = cfg.dailyGoalMins;
          editorBox.classList.toggle('hidden');
        });
      }
      if (saveExamBtn) {
        saveExamBtn.addEventListener('click', () => {
          const name = (document.getElementById('input-exam-name')?.value || 'Target Exam').trim().slice(0, 28);
          const date = document.getElementById('input-exam-date')?.value || getTodayKey(-30);
          const dailyGoalMins = Math.max(15, Math.min(720, parseInt(document.getElementById('input-exam-goal')?.value || '120', 10) || 120));
          saveExamConfig({ name, date, dailyGoalMins });
          if (editorBox) editorBox.classList.add('hidden');
          renderExamAndHeatmap();
          toast(`🎯 Updated goal: ${name} (${dailyGoalMins}m/day)`);
        });
      }

      // Buy Streak Freeze (100c)
      const buyFreezeBtn = document.getElementById('btn-buy-streak-freeze');
      if (buyFreezeBtn) {
        buyFreezeBtn.addEventListener('click', () => {
          if (getCoins() < 100) {
            toast('⚠️ Need 100 🪙 Coins for a Streak Freeze!');
            return;
          }
          addCoins(-100);
          setFreezeCount(getFreezeCount() + 1);
          renderExamAndHeatmap();
          toast('❄️ Streak Freeze equipped! Protects 1 missed day.');
        });
      }

      // Copy Referral Link (+50c)
      const refBtn = document.getElementById('btn-copy-referral-link');
      if (refBtn) {
        refBtn.addEventListener('click', () => {
          const code = (localStorage.getItem('lockedin_display_name') || 'SCHOLAR').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() || 'SCHOLAR';
          const url = `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(code)}`;
          navigator.clipboard?.writeText(url).then(() => {
            toast('🎁 Referral link copied! Friends get +50 🪙 when they join.');
          }).catch(() => {
            toast(`🎁 Share link: ?ref=${code}`);
          });
        });
      }

      // Focus Duel Wager Buttons
      document.querySelectorAll('.btn-start-duel').forEach(btn => {
        btn.addEventListener('click', () => {
          const wager = parseInt(btn.getAttribute('data-wager') || '25', 10);
          if (getCoins() < wager) {
            toast(`⚠️ You need ${wager} 🪙 Coins to start this duel.`);
            return;
          }
          addCoins(-wager);
          localStorage.setItem(KEY_DUEL, JSON.stringify({ wager, startedAt: Date.now() }));
          renderDuelUI();
          // Broadcast challenge in Room Chat if available
          const chatInput = document.getElementById('room-chat-input');
          const sendBtn = document.getElementById('btn-send-room-chat');
          if (chatInput && sendBtn) {
            chatInput.value = `⚔️ I wagered ${wager} 🪙 to finish this Pomodoro with 0 distractions! Who's joining?`;
            sendBtn.click();
          }
          toast(`⚔️ ${wager} 🪙 Duel Active! Finish this Pomodoro clean to win ${wager * 2} 🪙!`);
        });
      });

      const cancelDuelBtn = document.getElementById('btn-forfeit-duel');
      if (cancelDuelBtn) {
        cancelDuelBtn.addEventListener('click', () => {
          localStorage.removeItem(KEY_DUEL);
          renderDuelUI();
          toast('🏳️ Duel forfeited.');
        });
      }

      // Smart AI Study Coach (Gemini 3.8 Flash Session Recap & Quiz)
      const coachBtn = document.getElementById('btn-ai-session-coach');
      if (coachBtn) {
        coachBtn.addEventListener('click', () => {
          const goal = document.getElementById('input-subject-goal')?.value || document.getElementById('local-subject-goal')?.textContent || 'General Study';
          const todoEls = Array.from(document.querySelectorAll('#todo-list li'));
          const tasks = todoEls.slice(0, 8).map(li => li.textContent.replace(/[✕✓]/g, '').trim()).filter(Boolean);
          const promptEl = document.getElementById('ai-tutor-question');
          if (promptEl) {
            promptEl.value = `Summarize my study topic "${goal}" into 3 ultra-crisp revision bullets, then give me 2 quick active-recall quiz questions (with answers hidden at the bottom).${tasks.length ? '\n\nMy tasks:\n- ' + tasks.join('\n- ') : ''}`;
          }
          document.getElementById('btn-ask-gemini')?.click();
        });
      }
    },

    onFocusComplete(minutes, isClean) {
      const mins = Math.max(1, parseInt(minutes, 10) || 25);
      const map = getHeatmap();
      const today = getTodayKey(0);
      map[today] = (map[today] || 0) + mins;
      saveHeatmap(map);
      renderExamAndHeatmap();

      // Settle active Focus Duel
      try {
        const duel = JSON.parse(localStorage.getItem(KEY_DUEL) || 'null');
        if (duel && duel.wager > 0) {
          localStorage.removeItem(KEY_DUEL);
          if (isClean) {
            const payout = duel.wager * 2;
            addCoins(payout);
            toast(`🏆 DUEL WON! +${payout} 🪙 Coins credited!`);
          } else {
            toast('💥 Duel lost due to distraction strike.');
          }
          renderDuelUI();
        }
      } catch (e) {}
    },

    onDuelStrike() {
      try {
        const duel = JSON.parse(localStorage.getItem(KEY_DUEL) || 'null');
        if (duel && duel.wager > 0) {
          localStorage.removeItem(KEY_DUEL);
          renderDuelUI();
          toast(`💥 Tab Guard strike! Lost your ${duel.wager} 🪙 duel wager.`);
        }
      } catch (e) {}
    }
  };

  window.GrowthFeatures = GrowthFeatures;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GrowthFeatures.init());
  } else {
    GrowthFeatures.init();
  }
})();
