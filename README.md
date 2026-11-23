# 🔒 LOCKED-IN — Dual-Feed Public Study Accountability Web App

> **Zero-Cost, Static-Hosted Public Study Accountability Web Application** featuring dual-feed WebRTC mesh (Camera + Screen Share in Picture-in-Picture), on-device client AI distraction detection, meme soundboard shaming, and competitive live leaderboards.

🌐 **Live GitHub Pages URL:** [https://Omkar5144S.github.io/locked-in-study/](https://Omkar5144S.github.io/locked-in-study/)

---

## ⚡ Key Highlights
- **100% Free Tier & Zero-Server Cost:** Runs purely on client-side HTML5, CSS3, and modern modular ES6+ JavaScript. Deployed directly on **GitHub Pages**.
- **Instant Demo Mode (Zero-Config):** Works immediately on first load using **Local/PeerJS Instant Mode** (browser `localStorage` + `IndexedDB` + free public PeerServer WebRTC signaling), with seamless upgrade to global Cloud Firestore synchronization whenever a Firebase config is pasted.
- **Dual-Feed PiP Video Grid:** Streams active **Screen Share** as the main tile with **Desk/Face Camera** as an interactive Picture-in-Picture (PiP) overlay (1-click swap).
- **8-Person WebRTC Mesh:** Connects up to 8 active students per room with automated room overflow (`Room #1`, `Room #2`, etc.) and instant invite link generation (`?room=ROOM_ID`).
- **5-Second Anti-False-Positive Grace Countdown:** Flashing amber warning banner giving the student 5 seconds to adjust posture or press "False Alarm / Cancel" before punishment triggers.
- **Meme Soundboard Shaming & Red 'X' Strike:** Slashes a bold red `X` across the study timer, plays custom or synthesized alarm/meme sound effects, slaps an animated **SHAMED** badge onto the video tile, and deducts points.
- **Dual Live Leaderboards:** **Top Grinders** (Daily & All-Time clean study minutes & points) vs. public **Wall of Shame** (highest slacker violations and points lost).
- **Admin Soundboard Studio:** Protected by Admin PIN (default: `2027`), offering 25 customizable audio slots (< 800KB offline IndexedDB or direct URL) with built-in Web Audio API synthesizers.

---

## 🎯 The 25 Distraction & Accountability Triggers

### Group A: Device & Browser Discipline Triggers (Automatic)
1. `CAM_OFF_MID_SESSION` (-20 pts): Turning off camera during an active focus block.
2. `SCREEN_OFF_MID_SESSION` (-20 pts): Stopping screen share during an active focus block.
3. `TAB_SWITCH_HIDDEN` (-20 pts): Switching browser tabs or minimizing the app (`document.visibilitychange`).
4. `WINDOW_SPLIT_RESIZED` (-20 pts): Shrinking browser window below 55% screen area to hide a distraction.
5. `MIC_LEFT_UNMUTED` (-20 pts): Leaving quick-unmute active for > 20s during focus time.
6. `MIC_NOISE_SPIKE` (-20 pts): Sustained loud audio/music/chatter above decibel threshold.
7. `SCREEN_FROZEN_IDLE` (-20 pts): Canvas pixel-diff shows shared screen is 100% static for > 10 minutes.
8. `INPUT_DEAD_IDLE` (-20 pts): Zero pointer/keyboard/scroll events for > 12 minutes while studying.

### Group B: On-Device Camera AI Triggers (MediaPipe + COCO-SSD + Motion)
9. `FACE_MISSING` (-20 pts): No face detected in camera frame for > 10 seconds (left desk).
10. `FACE_HALF_HIDDEN` (-20 pts): Camera tilted to ceiling or showing only forehead.
11. `FACE_TOO_FAR` (-20 pts): Face area drops below threshold (slouching/leaning back onto bed).
12. `SECOND_PHONE_DETECTED` (-20 pts): TensorFlow.js COCO-SSD detects a `cell phone` held in frame.
13. `PROP_PHONE_PICKED_UP` (-20 pts): Gyroscope/accelerometer spike (`devicemotion`) indicating phone was picked up.
14. `HEAD_DOWN_SLEEPING` (-20 pts): Head pitch tilted sharply downward for > 20 seconds.
15. `LOOKING_AWAY_PROLONGED` (-20 pts): Head turned > 35° away from desk for > 15 seconds.
16. `MULTIPLE_FACES_CHATTING` (-20 pts): 2+ faces detected in frame chatting for > 10 seconds.

### Group C: Peer-to-Peer "Snitch & Accountability" Triggers (Social)
17. `PEER_NON_STUDY_CONTENT` (-25 pts): Peer clicks "Non-Study Content!" (YouTube, Instagram, anime, gaming).
18. `PEER_DOOMSCROLLING` (-25 pts): Peer clicks "Doomscrolling!" on rapid social feeds.
19. `PEER_ON_PHONE` (-25 pts): Peer spots off-camera texting.
20. `PEER_ZONING_OUT` (-25 pts): Peer spots blank staring/zoning out.
21. `PEER_WAKE_UP_NUDGE` (-25 pts): Peer sends a quick focus wake-up callout.
*(Requires 2 votes in an 8-person room, 1 vote in a 2-person room, or 1 instant vote from an Admin).*

### Group D: Session, Admin & Milestone Triggers
22. `RAGE_QUIT_EARLY` (-40 pts): Exiting room while focus timer has > 2 minutes remaining.
23. `LATE_BREAK_RETURN` (-20 pts): Failing to click "I'm Back" within 60s after break expires.
24. `ADMIN_INSTANT_SMITE` (-40 pts): Room Admin directly penalizes a blatant rule violation.
25. `FOCUS_BLOCK_VICTORY` (+25 pts Bonus): Completing a full focus block with **0 triggers fired**!

---

## 💰 Points Economy
- **+2 Points:** Per verified clean study minute.
- **+25 Points:** Bonus for completing a full distraction-free focus block.
- **+15 Points:** Vigilance bounty for accurately calling out a distracted peer.
- **-20 to -40 Points:** Deducted upon distraction confirmation.
- **-10 Points:** Penalty for spamming false peer callouts.

---

## 🛠️ Project File Structure
```
locked-in-study/
├── index.html            # Main web application shell
├── styles.css            # Dark "Focus Studio" UI, Red X, and Shame slam animations
├── firestore.rules       # Hardened Cloud Firestore Security Rules
├── README.md             # Documentation & deployment guide
└── js/
    ├── app.js            # Main application coordinator & UI event bindings
    ├── firebase-config.js# Firebase SDK v10 init + Local/PeerJS instant fallback
    ├── leaderboard.js    # Points calculation, Top Grinders, and Wall of Shame
    ├── soundboard-admin.js# 25-trigger audio manager, Web Audio synthesizers & Admin PIN
    ├── timer.js          # Pomodoro presets, break lounge, and Red X strike reset
    ├── trigger-engine.js # All 25 triggers with 5-second grace period & AI checks
    └── webrtc-room.js    # PeerJS 8-person WebRTC mesh with PiP dual-feed layout
```

---

## 🚀 Setup & Deployment

### Quick Local Test
Open `index.html` directly in any modern browser (Chrome/Edge/Safari/Firefox), or run a lightweight local static server:
```bash
python3 -m http.server 8080
```
Visit `http://localhost:8080`.

### GitHub Pages Deployment
1. Commit and push repository to GitHub.
2. Under **Repository Settings → Pages**, set branch to `main` and folder to `/ (root)`.
3. The site is live at `https://<username>.github.io/locked-in-study/`.
