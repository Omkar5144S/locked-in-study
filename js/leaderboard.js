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
      pointsLost: parseInt(localStorage.getItem('lockedin_points_lost') || '0', 10)
    };

    this.defaultSeedData = [
      {
        uid: 'user_alex',
        displayName: 'DeepWorkAlex',
        subjectGoal: 'Calculus III & Linear Alg',
        totalPoints: 1240,
        cleanStudyMinutes: 580,
        shameCount: 1,
        topTrigger: 'MIC_NOISE_SPIKE',
        pointsLost: 20
      },
      {
        uid: 'user_sophia',
        displayName: 'SophiaGrinds',
        subjectGoal: 'MCAT Biology Review',
        totalPoints: 1085,
        cleanStudyMinutes: 510,
        shameCount: 2,
        topTrigger: 'LOOKING_AWAY_PROLONGED',
        pointsLost: 40
      },
      {
        uid: 'user_kai',
        displayName: 'Kai_CodeWarrior',
        subjectGoal: 'Distributed Systems in Rust',
        totalPoints: 920,
        cleanStudyMinutes: 440,
        shameCount: 0,
        topTrigger: 'None',
        pointsLost: 0
      },
      {
        uid: 'user_slacker',
        displayName: 'DoomScroller99',
        subjectGoal: 'Supposedly History Essay',
        totalPoints: -110,
        cleanStudyMinutes: 35,
        shameCount: 9,
        topTrigger: 'SECOND_PHONE_DETECTED',
        pointsLost: 240
      },
      {
        uid: 'user_sleepy',
        displayName: 'NapKing_Rohan',
        subjectGoal: 'Macroeconomics PSET',
        totalPoints: 60,
        cleanStudyMinutes: 70,
        shameCount: 6,
        topTrigger: 'HEAD_DOWN_SLEEPING',
        pointsLost: 140
      }
    ];

    this.initStorage();
  }

  initStorage() {
    if (!localStorage.getItem('lockedin_leaderboard_users')) {
      localStorage.setItem('lockedin_leaderboard_users', JSON.stringify(this.defaultSeedData));
    }
  }

  saveCurrentUser() {
    localStorage.setItem('lockedin_total_points', this.currentUser.totalPoints.toString());
    localStorage.setItem('lockedin_clean_minutes', this.currentUser.cleanStudyMinutes.toString());
    localStorage.setItem('lockedin_shame_count', this.currentUser.shameCount.toString());
    localStorage.setItem('lockedin_top_trigger', this.currentUser.topTrigger);
    localStorage.setItem('lockedin_points_lost', this.currentUser.pointsLost.toString());

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
  }

  // Render Top Grinders & Wall of Shame
  renderBoards() {
    const users = this.getAllUsers();

    // 1. Top Grinders (Sorted by Total Points descending)
    const grindersList = [...users].sort((a, b) => b.totalPoints - a.totalPoints);
    const grindersTbody = document.getElementById('grinders-list-body');
    if (grindersTbody) {
      grindersTbody.innerHTML = '';
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
