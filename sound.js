/* ============================================================================
   Bug Wars — sound.js
   ----------------------------------------------------------------------------
   Tiny procedural sound effects via the Web Audio API — no audio files. Browsers
   block audio until a user gesture, so the context is unlocked on first click/key.
   Everything is guarded so the game runs fine if audio is unavailable.
   ========================================================================== */

window.BW = window.BW || {};

(function () {
  let ctx = null, enabled = true;
  const last = {};

  function ensure() {
    if (ctx || !enabled) return ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { enabled = false; }
    return ctx;
  }
  function unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function tone(freq, dur, type, gain, delay) {
    const c = ensure(); if (!c) return;
    const t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.05, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  }

  const FX = {
    select: () => tone(520, 0.08, 'triangle', 0.045),
    move:   () => tone(360, 0.10, 'sine', 0.05),
    attack: () => tone(300, 0.11, 'sawtooth', 0.05),
    gather: () => tone(640, 0.09, 'sine', 0.04),
    build:  () => { tone(440, 0.10, 'square', 0.04); tone(660, 0.11, 'square', 0.04, 0.07); },
    train:  () => { tone(720, 0.09, 'triangle', 0.05); tone(940, 0.10, 'triangle', 0.05, 0.08); },
    alert:  () => { tone(330, 0.18, 'sawtooth', 0.06); tone(270, 0.20, 'sawtooth', 0.06, 0.14); },
    win:    () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.055, i * 0.12)),
    lose:   () => [440, 350, 262].forEach((f, i) => tone(f, 0.24, 'sawtooth', 0.055, i * 0.14)),
  };

  function play(name) {
    if (!enabled) return;
    const c = ensure(); if (!c) return;
    const now = c.currentTime;
    if (last[name] && now - last[name] < 0.05) return;   // throttle spam
    last[name] = now;
    if (FX[name]) FX[name]();
  }

  BW.sound = { play, toggle() { enabled = !enabled; return enabled; }, isOn() { return enabled; } };
})();
