/* ============================================================
   features.js — ميزات مساعدة:
   - WakeLock: منع نوم الشاشة
   - COLOR_SYMBOLS: رموز عمى الألوان
   - EMOJIS + spawnEmoji: التفاعل بالإيموجي
   ============================================================ */

// ===== منع نوم الشاشة (Screen Wake Lock API) =====
const WakeLock = {
    _lock: null,
    _requestPromise: null,
    _enabled: false,
    _listening: false,

    enable() {
        this._enabled = true;
        if (!navigator || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
            return Promise.resolve(false);
        }
        if (!this._listening) {
            document.addEventListener('visibilitychange', this._onVisible);
            this._listening = true;
        }
        if (document.visibilityState === 'hidden') return Promise.resolve(false);
        if (this._lock && !this._lock.released) return Promise.resolve(true);
        if (this._lock && this._lock.released) this._lock = null;
        if (this._requestPromise) return this._requestPromise;

        let request;
        try {
            request = navigator.wakeLock.request('screen');
        } catch (e) {
            return Promise.resolve(false);
        }

        const pending = Promise.resolve(request)
            .then(async (sentinel) => {
                if (!sentinel) return false;
                if (!this._enabled || document.visibilityState === 'hidden') {
                    try { await sentinel.release(); } catch (e) {}
                    return false;
                }
                this._lock = sentinel;
                if (typeof sentinel.addEventListener === 'function') {
                    sentinel.addEventListener('release', () => this._handleRelease(sentinel));
                }
                return true;
            })
            .catch(() => false)
            .finally(() => {
                if (this._requestPromise === pending) this._requestPromise = null;
            });
        this._requestPromise = pending;
        return pending;
    },

    async disable() {
        this._enabled = false;
        if (this._listening) {
            document.removeEventListener('visibilitychange', this._onVisible);
            this._listening = false;
        }
        if (this._requestPromise) await this._requestPromise;
        const sentinel = this._lock;
        this._lock = null;
        if (sentinel && !sentinel.released) {
            try { await sentinel.release(); } catch (e) {}
        }
        return true;
    },

    _handleRelease(sentinel) {
        if (this._lock !== sentinel) return;
        this._lock = null;
        if (this._enabled && document.visibilityState === 'visible') {
            setTimeout(() => {
                if (this._enabled && !this._lock) this.enable();
            }, 0);
        }
    },

    _onVisible: async () => {
        if (document.visibilityState === 'visible' && WakeLock._enabled && WakeLock._lock === null) {
            await WakeLock.enable();
        }
    },
};

// ===== رموز عمى الألوان (شكل مميز لكل لون) =====
const COLOR_SYMBOLS = {
    orange: '▲',
    gray:   '●',
    purple: '■',
    black:  '★',
};

// ===== التفاعل بالإيموجي =====
const EMOJIS = ['👍', '😂', '😮', '😎', '😡', '😭', '🔥', '🎉', '🤔', '👏', '💪', '🤡'];

// عرض إيموجي طائر فوق منطقة لاعب معيّن
function spawnEmoji(emoji, playerId) {
    const area = document.getElementById(`player-${playerId}`);
    const target = area || document.body;
    const el = document.createElement('div');
    el.className = 'emoji-float';
    el.textContent = emoji;
    if (area) {
        const rect = area.getBoundingClientRect();
        el.style.left = (rect.left + rect.width / 2) + 'px';
        el.style.top = (rect.top + rect.height / 2) + 'px';
    } else {
        el.style.left = '50%';
        el.style.top = '70%';
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

window.WakeLock = WakeLock;
window.COLOR_SYMBOLS = COLOR_SYMBOLS;
window.EMOJIS = EMOJIS;
window.spawnEmoji = spawnEmoji;
