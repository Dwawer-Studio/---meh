/* ============================================================
   sound.js — mute-first Web Audio mixer (Master / Music / SFX)
   لا يُنشئ AudioContext ولا يهز الجهاز قبل موافقة اللاعب الصريحة.
   ============================================================ */

'use strict';

const Sound = {
    ctx: null,
    masterGain: null,
    musicGain: null,
    sfxGain: null,
    musicTimer: null,
    musicStep: 0,
    scene: 'home',
    settings: Object.freeze({ master: false, music: false, sfx: true, batterySaver: false }),

    configure(settings = {}) {
        const master = settings.soundMaster === true;
        this.settings = Object.freeze({
            master,
            music: settings.music === true,
            sfx: settings.sfx !== false,
            batterySaver: settings.batterySaver === true,
        });
        if (this.ctx && this.masterGain) {
            this.masterGain.gain.setValueAtTime(master ? 0.72 : 0, this.ctx.currentTime);
            this.musicGain.gain.setValueAtTime(this.settings.music ? 0.12 : 0, this.ctx.currentTime);
            this.sfxGain.gain.setValueAtTime(this.settings.sfx ? 0.78 : 0, this.ctx.currentTime);
        }
        if (!master || !this.settings.music || this.settings.batterySaver) this._stopMusic();
        else this._startMusic();
    },

    setEnabled(value) {
        this.configure({
            soundMaster: value === true,
            music: this.settings.music,
            sfx: this.settings.sfx,
            batterySaver: this.settings.batterySaver,
        });
    },

    isEnabled(bus = 'sfx') {
        if (!this.settings.master) return false;
        if (bus === 'music') return this.settings.music && !this.settings.batterySaver;
        return this.settings.sfx;
    },

    _ensure(bus = 'sfx') {
        if (!this.isEnabled(bus)) return null;
        if (!this.ctx) {
            const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextConstructor) return null;
            this.ctx = new AudioContextConstructor();
            this.masterGain = this.ctx.createGain();
            this.musicGain = this.ctx.createGain();
            this.sfxGain = this.ctx.createGain();
            this.musicGain.connect(this.masterGain);
            this.sfxGain.connect(this.masterGain);
            this.masterGain.connect(this.ctx.destination);
            this.masterGain.gain.value = 0.72;
            this.musicGain.gain.value = 0.12;
            this.sfxGain.gain.value = 0.78;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return this.ctx;
    },

    _destination(bus) {
        return bus === 'music' ? this.musicGain : this.sfxGain;
    },

    _tone(freq, dur, { type = 'sine', vol = 0.12, when = 0, slideTo = null, bus = 'sfx' } = {}) {
        const ctx = this._ensure(bus);
        if (!ctx) return;
        const t0 = ctx.currentTime + when;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(freq, t0);
        if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, dur / 3));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        oscillator.connect(gain).connect(this._destination(bus));
        oscillator.start(t0);
        oscillator.stop(t0 + dur + 0.02);
    },

    _noise(dur, { vol = 0.1, when = 0 } = {}) {
        const ctx = this._ensure('sfx');
        if (!ctx) return;
        const t0 = ctx.currentTime + when;
        const sampleCount = Math.floor(ctx.sampleRate * dur);
        const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const highpass = ctx.createBiquadFilter();
        source.buffer = buffer;
        highpass.type = 'highpass';
        highpass.frequency.value = 1500;
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        source.connect(highpass).connect(gain).connect(this.sfxGain);
        source.start(t0);
        source.stop(t0 + dur + 0.02);
    },

    play(requestedName) {
        if (!this.isEnabled('sfx')) return false;
        const names = {
            click: 'tap-soft', cardPlay: 'card-settle', turn: 'turn-ready',
            penalty: 'penalty-double', win: 'round-resolve-win', lose: 'round-resolve',
        };
        const name = names[requestedName] || requestedName;
        if (!this._ensure('sfx')) return false;
        switch (name) {
            case 'tap-soft':
                this._tone(460, 0.045, { type: 'triangle', vol: 0.045, slideTo: 520 });
                break;
            case 'card-lift':
                this._noise(0.045, { vol: 0.05 });
                break;
            case 'card-settle':
                this._noise(0.085, { vol: 0.11 });
                this._tone(310, 0.09, { type: 'triangle', vol: 0.07, slideTo: 230 });
                break;
            case 'draw':
                this._noise(0.055, { vol: 0.075 });
                break;
            case 'turn-ready':
                this._tone(520, 0.095, { type: 'sine', vol: 0.08 });
                this._tone(690, 0.12, { type: 'sine', vol: 0.065, when: 0.075 });
                break;
            case 'skip':
                this._tone(270, 0.14, { type: 'triangle', vol: 0.075, slideTo: 150 });
                break;
            case 'penalty-double':
                this._tone(185, 0.08, { type: 'triangle', vol: 0.09 });
                this._tone(150, 0.09, { type: 'triangle', vol: 0.085, when: 0.12 });
                break;
            case 'shuffle':
                this._noise(0.18, { vol: 0.07 });
                break;
            case 'round-resolve-win':
                [330, 440, 523].forEach((frequency, index) =>
                    this._tone(frequency, 0.19, { type: 'triangle', vol: 0.075, when: index * 0.09 }));
                break;
            case 'round-resolve':
                this._tone(330, 0.18, { type: 'triangle', vol: 0.065, slideTo: 247 });
                break;
            default:
                return false;
        }
        return true;
    },

    setScene(scene) {
        this.scene = ['home', 'table', 'result'].includes(scene) ? scene : 'home';
        if (this.scene === 'table') this._startMusic();
        else this._stopMusic();
    },

    _startMusic() {
        if (this.scene !== 'table' || !this.isEnabled('music') || this.musicTimer) return;
        const playStep = () => {
            if (document.hidden || !this.isEnabled('music') || this.scene !== 'table') return;
            const motif = [110, 146.83, 123.47, 164.81];
            const frequency = motif[this.musicStep % motif.length];
            this.musicStep += 1;
            this._tone(frequency, 1.6, { type: 'sine', vol: 0.035, bus: 'music' });
            this._tone(frequency * 2, 0.7, { type: 'triangle', vol: 0.012, when: 0.35, bus: 'music' });
        };
        playStep();
        this.musicTimer = setInterval(playStep, 2200);
    },

    _stopMusic() {
        if (this.musicTimer) clearInterval(this.musicTimer);
        this.musicTimer = null;
    },
};

document.addEventListener('visibilitychange', () => {
    if (document.hidden) Sound._stopMusic();
    else Sound.setScene(Sound.scene);
});

window.Sound = Sound;
