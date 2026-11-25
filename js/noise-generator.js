/**
 * LOCKED-IN: Built-in Study Noise & Music Accountability Engine
 * Generates Web Audio Brown Noise, White Noise, Pink Noise, and Binaural Beats.
 * Synchronizes live "Now Listening" track status across the WebRTC room mesh,
 * and allows peers to call out non-study music.
 */

class StudyNoiseManager {
  constructor() {
    this.audioCtx = null;
    this.noiseNode = null;
    this.gainNode = null;
    this.binauralOsc1 = null;
    this.binauralOsc2 = null;

    this.isPlaying = false;
    this.currentMode = 'none'; // 'brown', 'white', 'pink', 'binaural', 'youtube', 'custom'
    this.currentTrackTitle = 'None';
    this.volume = 0.5;

    this.initAudioContext();
    this.setupIOSAudioUnlock();
  }

  setupIOSAudioUnlock() {
    const unlock = () => {
      this.ensureAudio();
      if (window.Soundboard && window.Soundboard.ensureAudioResumed) {
        window.Soundboard.ensureAudioResumed();
      }
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  initAudioContext() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    } catch (e) {
      console.warn('[StudyNoise] Web Audio API init error:', e);
    }
  }

  ensureAudio() {
    if (!this.audioCtx) this.initAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(this.volume * 0.4, this.audioCtx.currentTime);
    }
  }

  stopNoise() {
    if (this.noiseNode) {
      try { this.noiseNode.stop(); } catch (e) {}
      try { this.noiseNode.disconnect(); } catch (e) {}
      this.noiseNode = null;
    }
    if (this._lfoNode) {
      try { this._lfoNode.stop(); } catch (e) {}
      try { this._lfoNode.disconnect(); } catch (e) {}
      this._lfoNode = null;
    }
    if (this._extraNodes && this._extraNodes.length) {
      this._extraNodes.forEach(n => {
        try { if (n.stop) n.stop(); } catch (e) {}
        try { n.disconnect(); } catch (e) {}
      });
      this._extraNodes = [];
    }
    if (this.binauralOsc1) {
      try { this.binauralOsc1.stop(); this.binauralOsc2.stop(); } catch (e) {}
      try { this.binauralOsc1.disconnect(); this.binauralOsc2.disconnect(); } catch (e) {}
      this.binauralOsc1 = null;
      this.binauralOsc2 = null;
    }
    this.isPlaying = false;
  }

  playSoundscape(type) {
    const binauralMap = {
      delta: { hz: 2, label: 'Delta (2Hz)' },
      theta: { hz: 6, label: 'Theta (6Hz)' },
      alpha: { hz: 10, label: 'Alpha (10Hz)' },
      beta: { hz: 18, label: 'Beta (18Hz)' },
      gamma: { hz: 40, label: 'Gamma (40Hz)' },
      binaural: { hz: 40, label: 'Gamma (40Hz)' }
    };
    if (binauralMap[type]) {
      return this.playBinauralBeats(binauralMap[type].hz, binauralMap[type].label, type);
    }
    if (type === 'brown') return this.playBrownNoise();
    if (type === 'white') return this.playWhiteNoise();
    if (type === 'pink') return this.playPinkNoise();
    if (type === 'green') return this.playGreenNoise();
    if (type === 'rain') return this.playSoftRain();
    if (type === 'fireplace') return this.playFireplaceCrackle();
    if (type === 'wind') return this.playMidnightWind();
  }

  // Real-time Brown Noise Generator (Brownian walk)
  playBrownNoise() {
    this.ensureAudio();
    this.stopNoise();

    const bufferSize = this.audioCtx.sampleRate * 2;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5; // Gain compensation
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.45, this.audioCtx.currentTime);

    this.noiseNode.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.noiseNode.start();

    this.isPlaying = true;
    this.currentMode = 'brown';
    this.setNowListening('Deep Brown Noise (40Hz)', true);
  }

  // Real-time White Noise Generator
  playWhiteNoise() {
    this.ensureAudio();
    this.stopNoise();

    const bufferSize = this.audioCtx.sampleRate * 2;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.25;
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.25, this.audioCtx.currentTime);

    this.noiseNode.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.noiseNode.start();

    this.isPlaying = true;
    this.currentMode = 'white';
    this.setNowListening('Gentle White Noise', true);
  }

  // Pink Noise Generator (1/f filter approximation)
  playPinkNoise() {
    this.ensureAudio();
    this.stopNoise();

    const bufferSize = this.audioCtx.sampleRate * 2;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.35, this.audioCtx.currentTime);

    this.noiseNode.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.noiseNode.start();

    this.isPlaying = true;
    this.currentMode = 'pink';
    this.setNowListening('Smooth Pink Noise (Rain)', true);
  }

  // Green Noise (Bandpass-filtered nature noise ~500Hz)
  playGreenNoise() {
    this.ensureAudio();
    this.stopNoise();

    const bufferSize = this.audioCtx.sampleRate * 2;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, this.audioCtx.currentTime);
    filter.Q.setValueAtTime(0.7, this.audioCtx.currentTime);

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.4, this.audioCtx.currentTime);

    this.noiseNode.connect(filter);
    filter.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.noiseNode.start();
    this._extraNodes = [filter];

    this.isPlaying = true;
    this.currentMode = 'green';
    this.setNowListening('Green Noise', true);
  }

  // Soft Rain (Lowpass pink noise + subtle droplet modulation)
  playSoftRain() {
    this.ensureAudio();
    this.stopNoise();

    const bufferSize = this.audioCtx.sampleRate * 3;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.05) * 0.7;
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, this.audioCtx.currentTime);

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.45, this.audioCtx.currentTime);

    this.noiseNode.connect(filter);
    filter.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.noiseNode.start();
    this._extraNodes = [filter];

    this.isPlaying = true;
    this.currentMode = 'rain';
    this.setNowListening('Soft Rain', true);
  }

  // Fireplace Crackle (Warm rumble + randomized sparse crackle pops)
  playFireplaceCrackle() {
    this.ensureAudio();
    this.stopNoise();

    const sr = this.audioCtx.sampleRate;
    const bufferSize = sr * 3;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, sr);
    const data = buffer.getChannelData(0);
    let rumble = 0;
    for (let i = 0; i < bufferSize; i++) {
      const w = Math.random() * 2 - 1;
      rumble = (rumble + 0.015 * w) / 1.015;
      const crackle = Math.random() < 0.0018 ? (Math.random() * 2 - 1) * 0.75 : 0;
      data[i] = rumble * 2.8 + crackle;
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, this.audioCtx.currentTime);

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.45, this.audioCtx.currentTime);

    this.noiseNode.connect(filter);
    filter.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.noiseNode.start();
    this._extraNodes = [filter];

    this.isPlaying = true;
    this.currentMode = 'fireplace';
    this.setNowListening('Fireplace Crackle', true);
  }

  // Midnight Wind (Slow LFO-swept bandpass noise)
  playMidnightWind() {
    this.ensureAudio();
    this.stopNoise();

    const bufferSize = this.audioCtx.sampleRate * 3;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.03 * w) / 1.03;
      data[i] = last * 2.5;
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, this.audioCtx.currentTime);
    filter.Q.setValueAtTime(1.8, this.audioCtx.currentTime);

    this._lfoNode = this.audioCtx.createOscillator();
    this._lfoNode.frequency.setValueAtTime(0.12, this.audioCtx.currentTime);
    const lfoGain = this.audioCtx.createGain();
    lfoGain.gain.setValueAtTime(160, this.audioCtx.currentTime);
    this._lfoNode.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    this._lfoNode.start();

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.4, this.audioCtx.currentTime);

    this.noiseNode.connect(filter);
    filter.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);
    this.noiseNode.start();
    this._extraNodes = [filter, lfoGain];

    this.isPlaying = true;
    this.currentMode = 'wind';
    this.setNowListening('Midnight Wind', true);
  }

  // Binaural Focus Beats (True stereo left/right offset)
  playBinauralBeats(beatHz = 40, label = 'Gamma (40Hz)', modeKey = 'gamma') {
    this.ensureAudio();
    this.stopNoise();

    const baseHz = 200;
    this.binauralOsc1 = this.audioCtx.createOscillator();
    this.binauralOsc2 = this.audioCtx.createOscillator();
    this.binauralOsc1.type = 'sine';
    this.binauralOsc2.type = 'sine';
    this.binauralOsc1.frequency.setValueAtTime(baseHz, this.audioCtx.currentTime);
    this.binauralOsc2.frequency.setValueAtTime(baseHz + beatHz, this.audioCtx.currentTime);

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.22, this.audioCtx.currentTime);

    if (this.audioCtx.createStereoPanner) {
      const panL = this.audioCtx.createStereoPanner();
      const panR = this.audioCtx.createStereoPanner();
      panL.pan.setValueAtTime(-1, this.audioCtx.currentTime);
      panR.pan.setValueAtTime(1, this.audioCtx.currentTime);
      this.binauralOsc1.connect(panL);
      this.binauralOsc2.connect(panR);
      panL.connect(this.gainNode);
      panR.connect(this.gainNode);
      this._extraNodes = [panL, panR];
    } else {
      this.binauralOsc1.connect(this.gainNode);
      this.binauralOsc2.connect(this.gainNode);
    }

    this.gainNode.connect(this.audioCtx.destination);
    this.binauralOsc1.start();
    this.binauralOsc2.start();

    this.isPlaying = true;
    this.currentMode = modeKey;
    this.setNowListening(`Binaural ${label}`, true);
  }

  // Zero-Key YouTube IFrame Player API Music Search
  _ensureYouTubeApi() {
    if (this._ytApiPromise) return this._ytApiPromise;
    this._ytApiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }
      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevReady === 'function') prevReady();
        resolve(window.YT);
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.async = true;
        document.head.appendChild(s);
      }
    });
    return this._ytApiPromise;
  }

  async searchStudyMusic(query) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return;
    this.stopNoise();
    this.currentMode = 'youtube';

    const wrapper = document.getElementById('yt-player-wrapper');
    if (wrapper) wrapper.classList.remove('hidden');

    const YT = await this._ensureYouTubeApi();
    if (!this.ytPlayer) {
      this.ytPlayer = new YT.Player('yt-player-container', {
        height: '180',
        width: '100%',
        playerVars: { autoplay: 1, playsinline: 1 },
        events: {
          onReady: (e) => {
            e.target.setVolume(Math.round(this.volume * 100));
            e.target.loadPlaylist({ listType: 'search', list: cleanQuery });
          }
        }
      });
    } else if (typeof this.ytPlayer.loadPlaylist === 'function') {
      this.ytPlayer.loadPlaylist({ listType: 'search', list: cleanQuery });
    }

    this.setNowListening(cleanQuery, true);
  }

  toggleYouTubePlayPause() {
    if (!this.ytPlayer || typeof this.ytPlayer.getPlayerState !== 'function') return;
    const state = this.ytPlayer.getPlayerState();
    if (state === 1) this.ytPlayer.pauseVideo();
    else this.ytPlayer.playVideo();
  }

  nextYouTubeTrack() {
    if (this.ytPlayer && typeof this.ytPlayer.nextVideo === 'function') {
      this.ytPlayer.nextVideo();
    }
  }

  setYouTubeVolume(vol0to100) {
    const v = Math.max(0, Math.min(100, Number(vol0to100) || 60));
    if (this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
      this.ytPlayer.setVolume(v);
    }
  }

  clearStudyMusic() {
    this.stopNoise();
    if (this.ytPlayer && typeof this.ytPlayer.stopVideo === 'function') {
      try { this.ytPlayer.stopVideo(); } catch (e) {}
    }
    const wrapper = document.getElementById('yt-player-wrapper');
    if (wrapper) wrapper.classList.add('hidden');
    this.setNowListening('None', true);
  }

  // User sets external audio (e.g. YouTube Music, Lofi Stream)
  setCustomStudyTrack(trackTitle, isStudyApproved = true) {
    this.stopNoise();
    this.currentMode = 'custom';
    this.setNowListening(trackTitle || 'Lofi Study Beats', isStudyApproved);
  }

  // Update local HUD and broadcast to peer mesh
  setNowListening(trackName, isStudyApproved = true) {
    this.currentTrackTitle = trackName;

    // Update local HUD badge
    const localListeningBadge = document.getElementById('local-listening-badge');
    if (localListeningBadge) {
      if (!trackName || trackName === 'None') {
        localListeningBadge.classList.add('hidden');
      } else {
        localListeningBadge.classList.remove('hidden');
        localListeningBadge.innerHTML = `🎧 ${this.escapeHtml(trackName)}`;
        if (isStudyApproved) {
          localListeningBadge.className = 'listening-badge study-approved';
        } else {
          localListeningBadge.className = 'listening-badge non-study-warning';
        }
      }
    }

    // Sync { nowPlaying } to participant doc in Firestore + broadcast to peers
    const nowPlayingVal = (!trackName || trackName === 'None') ? '' : String(trackName).slice(0, 80);
    if (window.WebRTCRoom && window.WebRTCRoom.roomId && window.WebRTCRoom.peerId && window.FirebaseSync && window.FirebaseSync.updateParticipantNowPlaying) {
      window.FirebaseSync.updateParticipantNowPlaying(window.WebRTCRoom.roomId, window.WebRTCRoom.peerId, nowPlayingVal);
    }

    // Broadcast to peers
    if (window.WebRTCRoom) {
      window.WebRTCRoom.broadcastData({
        type: 'NOW_LISTENING',
        nowPlaying: nowPlayingVal,
        userId: (window.Leaderboard && window.Leaderboard.currentUser.uid) || 'me',
        trackTitle: trackName,
        isStudyApproved: isStudyApproved
      });
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

window.StudyNoise = new StudyNoiseManager();
