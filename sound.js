/* ============================================================
   sound.js — مؤثرات صوتية مولّدة بـ Web Audio API (بلا ملفات)
   Sound.play('cardPlay' | 'draw' | 'click' | 'win' | 'lose' |
              'turn' | 'skip' | 'penalty' | 'shuffle')
   تحترم إعداد الصوت (Storage settings.sound)، وتُنشّط عند أول تفاعل.
   ============================================================ */

const Sound = {
    ctx: null,
    enabled: true,

    _ensure() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
    },

    setEnabled(v) { this.enabled = !!v; },

    // نغمة واحدة بمنحنى صعود/هبوط ناعم
    _tone(freq, dur, { type = 'sine', vol = 0.2, when = 0, slideTo = null } = {}) {
        const ctx = this.ctx;
        const t0 = ctx.currentTime + when;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    },

    // ضجيج قصير (لمسة ورق)
    _noise(dur, { vol = 0.15, when = 0 } = {}) {
        const ctx = this.ctx;
        const t0 = ctx.currentTime + when;
        const n = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 1500;
        src.connect(hp).connect(gain).connect(ctx.destination);
        src.start(t0); src.stop(t0 + dur + 0.02);
    },

    play(name) {
        if (!this.enabled) return;
        const ctx = this._ensure();
        if (!ctx) return;
        switch (name) {
            case 'cardPlay':
                this._noise(0.10, { vol: 0.18 });
                this._tone(420, 0.12, { type: 'triangle', vol: 0.18, slideTo: 260 });
                break;
            case 'draw':
                this._noise(0.07, { vol: 0.12 });
                this._tone(300, 0.08, { type: 'sine', vol: 0.1 });
                break;
            case 'click':
                this._tone(520, 0.06, { type: 'square', vol: 0.08, slideTo: 660 });
                break;
            case 'turn':
                this._tone(660, 0.14, { type: 'sine', vol: 0.14 });
                this._tone(880, 0.18, { type: 'sine', vol: 0.12, when: 0.08 });
                break;
            case 'skip':
                this._tone(300, 0.18, { type: 'sawtooth', vol: 0.14, slideTo: 120 });
                break;
            case 'penalty':
                this._tone(200, 0.22, { type: 'sawtooth', vol: 0.16, slideTo: 90 });
                break;
            case 'shuffle':
                this._noise(0.25, { vol: 0.12 });
                break;
            case 'win': {
                const notes = [523, 659, 784, 1047];   // دو-مي-صول-دو
                notes.forEach((f, i) => this._tone(f, 0.32, { type: 'triangle', vol: 0.2, when: i * 0.12 }));
                break;
            }
            case 'lose':
                this._tone(392, 0.3, { type: 'triangle', vol: 0.16, slideTo: 196 });
                break;
        }
    },
};

window.Sound = Sound;
