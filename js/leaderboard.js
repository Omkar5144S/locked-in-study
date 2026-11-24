/**
 * LOCKED-IN: Leaderboard & Points Economy
 * Tracks study points, vigilance/snitch rewards, trigger penalties,
 * Top Grinders board, and the public Wall of Shame.
 */

class LeaderboardManager {
  constructor() {
    this.currentUser = {
      uid: localStorage.getItem('lockedin_local_uid') || 'scholar_' + Math.random().toString(36).substring(2, 7),
      displayName: localStorage.getItem('lockedin_display_name') || 'FocusScholar',
      totalPoints: parseInt(localStorage.getItem('lockedin_total_points') || '150', 10),
      cleanStudyMinutes: parseInt(localStorage.getItem('lockedin_clean_minutes') || '45', 10),
      shameCount: parseInt(localStorage.getItem('lockedin_shame_count') || '0', 10),
      topTrigger: localStorage.getItem('lockedin_top_trigger') || 'None',
      pointsLost: parseInt(localStorage.getItem('lockedin_points_lost') || '0', 10),
      xp: parseInt(localStorage.getItem('lockedin_xp') || '0', 10),
      coins: parseInt(localStorage.getItem('lockedin_coins') || '50', 10),
      dailyStreak: parseInt(localStorage.getItem('lockedin_daily_streak') || '1', 10),
      lastStudyDate: localStorage.getItem('lockedin_last_study_date') || new Date().toISOString().split('T')[0],
      activePet: localStorage.getItem('lockedin_active_pet') || 'cat',
      unlockedBadges: JSON.parse(localStorage.getItem('lockedin_unlocked_badges') || '["FOUNDING_SCHOLAR"]'),
      inventory: JSON.parse(localStorage.getItem('lockedin_inventory') || '{"pets":["cat"],"frames":[],"themes":[]}')
    };
    this.currentUser.level = Math.floor(this.currentUser.xp / 500) + 1;

    this.defaultSeedData = [];
    this.initStorage();
  }

  initStorage() {
    try {
      const existing = JSON.parse(localStorage.getItem('lockedin_leaderboard_users') || '[]');
      // Strip out any legacy fake demo users
      const realUsers = existing.filter(u => u && !u.uid?.startsWith('user_') && u.uid !== 'mock');
      localStorage.setItem('lockedin_leaderboard_users', JSON.stringify(realUsers));
    } catch (e) {
      localStorage.setItem('lockedin_leaderboard_users', '[]');
    }
  }

  saveCurrentUser() {
    localStorage.setItem('lockedin_total_points', this.currentUser.totalPoints.toString());
    localStorage.setItem('lockedin_clean_minutes', this.currentUser.cleanStudyMinutes.toString());
    localStorage.setItem('lockedin_shame_count', this.currentUser.shameCount.toString());
    localStorage.setItem('lockedin_top_trigger', this.currentUser.topTrigger);
    localStorage.setItem('lockedin_points_lost', this.currentUser.pointsLost.toString());
    localStorage.setItem('lockedin_xp', (this.currentUser.xp || 0).toString());
    localStorage.setItem('lockedin_coins', (this.currentUser.coins || 0).toString());
    localStorage.setItem('lockedin_daily_streak', (this.currentUser.dailyStreak || 1).toString());
    localStorage.setItem('lockedin_last_study_date', this.currentUser.lastStudyDate || '');
    localStorage.setItem('lockedin_active_pet', this.currentUser.activePet || 'cat');
    localStorage.setItem('lockedin_inventory', JSON.stringify(this.currentUser.inventory || { pets: ['cat'], frames: [], themes: [] }));

    // Update in user list
    const users = this.getAllUsers();
    const idx = users.findIndex(u => u.uid === this.currentUser.uid);
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...this.currentUser };
    } else {
      users.push({ ...this.currentUser });
    }
    localStorage.setItem('lockedin_leaderboard_users', JSON.stringify(users));

    // Update cloud if available
    if (window.FirebaseSync) {
      window.FirebaseSync.updateUserProfile(this.currentUser);
    }
  }

  getAllUsers() {
    try {
      const data = JSON.parse(localStorage.getItem('lockedin_leaderboard_users') || '[]');
      // Ensure current user is in list
      const hasMe = data.some(u => u.uid === this.currentUser.uid);
      if (!hasMe) {
        data.push({ ...this.currentUser });
      }
      return data;
    } catch (e) {
      return this.defaultSeedData;
    }
  }

  // Points Modifications
  awardCleanStudyMinute() {
    this.currentUser.totalPoints += 2;
    this.currentUser.cleanStudyMinutes += 1;
    this.saveCurrentUser();
    this.renderHUD();
  }

  awardBlockVictoryBonus() {
    this.currentUser.totalPoints += 25;
    this.saveCurrentUser();
    this.renderHUD();
  }

  awardSnitchBounty() {
    this.currentUser.totalPoints += 15;
    this.saveCurrentUser();
    this.renderHUD();
  }

  penalizeTrigger(triggerId, customPenalty = null) {
    let penalty = 20;
    if (customPenalty !== null) {
      penalty = customPenalty;
    } else {
      const def = (window.TRIGGER_DEFINITIONS || []).find(t => t.id === triggerId);
      if (def) penalty = def.penalty;
    }

    if (penalty > 0) {
      this.currentUser.totalPoints -= penalty;
      this.currentUser.pointsLost += penalty;
      this.currentUser.shameCount += 1;
      this.currentUser.topTrigger = triggerId;
      this.saveCurrentUser();
      this.renderHUD();
    }
  }

  penalizeFalseReport() {
    this.currentUser.totalPoints -= 10;
    this.currentUser.pointsLost += 10;
    this.saveCurrentUser();
    this.renderHUD();
  }

  renderHUD() {
    const pointsBadge = document.getElementById('user-points-badge');
    if (pointsBadge) {
      pointsBadge.textContent = `${this.currentUser.totalPoints} pts`;
    }
    const cleanTimeEl = document.getElementById('user-clean-time');
    if (cleanTimeEl) {
      const hrs = Math.floor(this.currentUser.cleanStudyMinutes / 60);
      const mins = this.currentUser.cleanStudyMinutes % 60;
      cleanTimeEl.textContent = `${hrs}h ${mins}m`;
    }
    const streakBadge = document.getElementById('user-streak-badge');
    if (streakBadge) {
      streakBadge.textContent = `🔥 ${this.currentUser.dailyStreak || 1} Day`;
    }
    const gamificationPill = document.getElementById('user-gamification-pill');
    if (gamificationPill) {
      gamificationPill.textContent = `⭐ Lvl ${this.currentUser.level || 1} | 🔥 ${this.currentUser.dailyStreak || 1}d | 🪙 ${this.currentUser.coins || 0}`;
    }
    const petEl = document.getElementById('study-pet-hud');
    if (petEl) {
      const petMap = {
        cat: { icon: '🐱', name: 'Pixel Cat' },
        owl: { icon: '🦉', name: 'Cyber Owl' },
        shiba: { icon: '🐕', name: 'Shiba Inu' }
      };
      const p = petMap[this.currentUser.activePet] || petMap.cat;
      petEl.innerHTML = `<span class="pet-icon">${p.icon}</span> <span class="pet-name">${p.name}</span>`;
      petEl.title = `Your Study Companion: ${p.name}`;
    }
  }

  // Gamification Economy
  awardPomodoroComplete(focusMinutes = 25) {
    let coinsEarned = 50;
    let xpEarned = 100;
    if (focusMinutes >= 90) {
      coinsEarned = 180;
      xpEarned = 360;
    } else if (focusMinutes >= 60) {
      coinsEarned = 120;
      xpEarned = 240;
    } else if (focusMinutes >= 50) {
      coinsEarned = 100;
      xpEarned = 200;
    }

    this.currentUser.totalPoints += 25;
    this.currentUser.coins = (this.currentUser.coins || 0) + coinsEarned;
    this.currentUser.xp = (this.currentUser.xp || 0) + xpEarned;

    // Daily streak logic
    const today = new Date().toISOString().split('T')[0];
    if (this.currentUser.lastStudyDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (this.currentUser.lastStudyDate === yesterday) {
        this.currentUser.dailyStreak = (this.currentUser.dailyStreak || 0) + 1;
      } else if (!this.currentUser.lastStudyDate) {
        this.currentUser.dailyStreak = 1;
      }
      this.currentUser.lastStudyDate = today;
    }

    // Level progression (500 XP per level)
    const oldLevel = this.currentUser.level || 1;
    this.currentUser.level = Math.floor(this.currentUser.xp / 500) + 1;
    const leveledUp = this.currentUser.level > oldLevel;

    this.saveCurrentUser();
    this.renderHUD();
    this.triggerPetCelebration();

    return { coinsEarned, xpEarned, leveledUp, newLevel: this.currentUser.level };
  }

  awardDoubtSolved(solverUid) {
    if (solverUid === this.currentUser.uid) {
      this.currentUser.coins = (this.currentUser.coins || 0) + 50;
      this.currentUser.xp = (this.currentUser.xp || 0) + 100;
      this.currentUser.level = Math.floor(this.currentUser.xp / 500) + 1;
      this.saveCurrentUser();
      this.renderHUD();
      this.triggerPetCelebration();
    }
  }

  spendCoins(amount) {
    if ((this.currentUser.coins || 0) < amount) return false;
    this.currentUser.coins -= amount;
    this.saveCurrentUser();
    this.renderHUD();
    return true;
  }

  buyItem(type, itemId, cost) {
    if (!this.spendCoins(cost)) return false;
    if (!this.currentUser.inventory) this.currentUser.inventory = { pets: ['cat'], frames: [], themes: [] };
    if (!this.currentUser.inventory[type]) this.currentUser.inventory[type] = [];
    if (!this.currentUser.inventory[type].includes(itemId)) {
      this.currentUser.inventory[type].push(itemId);
    }
    this.saveCurrentUser();
    return true;
  }

  setActivePet(petId) {
    this.currentUser.activePet = petId;
    localStorage.setItem('lockedin_active_pet', petId);
    this.saveCurrentUser();
    this.renderHUD();
  }

  triggerPetCelebration() {
    const petEl = document.getElementById('study-pet-hud');
    if (petEl) {
      petEl.classList.remove('studying', 'idle');
      petEl.classList.add('celebrating');
      setTimeout(() => {
        petEl.classList.remove('celebrating');
        petEl.classList.add('studying');
      }, 4000);
    }
  }

  // Register or update remote peer in the live leaderboard
  upsertPeer(peerData) {
    if (!peerData || !peerData.uid) return;
    const users = this.getAllUsers();
    const idx = users.findIndex(u => u.uid === peerData.uid);
    const entry = {
      uid: peerData.uid,
      displayName: peerData.displayName || 'Peer',
      subjectGoal: peerData.subject || 'Deep Focus',
      totalPoints: peerData.points !== undefined ? peerData.points : 150,
      cleanStudyMinutes: peerData.cleanStudyMinutes || 0,
      shameCount: peerData.shameCount || 0,
      topTrigger: peerData.topTrigger || 'None',
      pointsLost: peerData.pointsLost || 0
    };
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...entry };
    } else {
      users.push(entry);
    }
    try {
      localStorage.setItem('lockedin_leaderboard_users', JSON.stringify(users));
    } catch (e) {}
    this.renderBoards();
  }

  // Render Top Grinders & Wall of Shame
  renderBoards() {
    const users = this.getAllUsers();

    // 1. Top Grinders (Sorted by Total Points descending)
    const grindersList = [...users].sort((a, b) => b.totalPoints - a.totalPoints);
    const grindersTbody = document.getElementById('grinders-list-body');
    if (grindersTbody) {
      grindersTbody.innerHTML = '';
      if (grindersList.length === 0) {
        grindersTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No other students active today. Study cleanly to claim #1!</td></tr>`;
      } else {
        grindersList.forEach((u, index) => {
          const tr = document.createElement('tr');
          tr.className = u.uid === this.currentUser.uid ? 'current-user-row' : '';

          let rankBadge = `${index + 1}`;
          if (index === 0) rankBadge = '🥇';
          else if (index === 1) rankBadge = '🥈';
          else if (index === 2) rankBadge = '🥉';

          const hours = (u.cleanStudyMinutes / 60).toFixed(1);

          tr.innerHTML = `
            <td class="rank-col">${rankBadge}</td>
            <td class="user-col">
              <span class="user-name">${this.escapeHtml(u.displayName)}</span>
              <span class="user-sub">${this.escapeHtml(u.subjectGoal || 'Deep Focus')}</span>
            </td>
            <td class="hours-col">${hours} hrs</td>
            <td class="points-col"><strong>${u.totalPoints}</strong></td>
          `;
          grindersTbody.appendChild(tr);
        });
      }
    }

    // 2. Wall of Shame (Sorted by Shame Count & Points Lost descending)
    const shameList = [...users]
      .filter(u => (u.shameCount || 0) > 0)
      .sort((a, b) => (b.shameCount * 50 + b.pointsLost) - (a.shameCount * 50 + a.pointsLost));

    const shameTbody = document.getElementById('shame-list-body');
    if (shameTbody) {
      shameTbody.innerHTML = '';
      if (shameList.length === 0) {
        shameTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No one has been shamed yet. Stay locked in!</td></tr>`;
      } else {
        shameList.forEach((u, index) => {
          const tr = document.createElement('tr');
          tr.className = u.uid === this.currentUser.uid ? 'current-user-shame-row' : '';

          let rankBadge = `${index + 1}`;
          if (index === 0) rankBadge = '🤡 #1 Slacker';

          const readableTrigger = (u.topTrigger || 'None')
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/\b\w/g, c => c.toUpperCase());

          tr.innerHTML = `
            <td class="rank-col">${rankBadge}</td>
            <td class="user-col">
              <span class="user-name shame-text">${this.escapeHtml(u.displayName)}</span>
              <span class="shame-reason">Top: ${this.escapeHtml(readableTrigger)}</span>
            </td>
            <td class="shame-count-col">🚨 ${u.shameCount}x</td>
            <td class="penalty-col"><span class="minus-points">-${u.pointsLost || u.shameCount * 20}</span></td>
          `;
          shameTbody.appendChild(tr);
        });
      }
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.Leaderboard = new LeaderboardManager();
