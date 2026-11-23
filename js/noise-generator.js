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
      this.noiseNode.disconnect();
      this.noiseNode = null;
    }
    if (this.binauralOsc1) {
      try { this.binauralOsc1.stop(); this.binauralOsc2.stop(); } catch (e) {}
      this.binauralOsc1.disconnect();
      this.binauralOsc2.disconnect();
      this.binauralOsc1 = null;
      this.binauralOsc2 = null;
    }
    this.isPlaying = false;
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

  // Binaural Focus Beats (Twin stereo frequencies)
  playBinauralBeats() {
    this.ensureAudio();
    this.stopNoise();

    this.binauralOsc1 = this.audioCtx.createOscillator();
    this.binauralOsc2 = this.audioCtx.createOscillator();

    this.binauralOsc1.type = 'sine';
    this.binauralOsc2.type = 'sine';
    this.binauralOsc1.frequency.setValueAtTime(200, this.audioCtx.currentTime);
    this.binauralOsc2.frequency.setValueAtTime(240, this.audioCtx.currentTime); // 40Hz Gamma Focus

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.volume * 0.25, this.audioCtx.currentTime);

    this.binauralOsc1.connect(this.gainNode);
    this.binauralOsc2.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);

    this.binauralOsc1.start();
    this.binauralOsc2.start();

    this.isPlaying = true;
    this.currentMode = 'binaural';
    this.setNowListening('Binaural Gamma Waves (40Hz)', true);
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

    // Broadcast to peers
    if (window.WebRTCRoom) {
      window.WebRTCRoom.broadcastData({
        type: 'NOW_LISTENING',
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
