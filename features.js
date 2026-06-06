/* ============================================================
   features.js — ميزات مساعدة:
   - WakeLock: منع نوم الشاشة
   - COLOR_SYMBOLS: رموز عمى الألوان
   - EMOJIS + spawnEmoji: التفاعل بالإيموجي
   ============================================================ */

// ===== منع نوم الشاشة (Screen Wake Lock API) =====
const WakeLock = {
    _lock: null,
    async enable() {
        if (!('wakeLock' in navigator)) return false;
        try {
            this._lock = await navigator.wakeLock.request('screen');
            // إعادة الطلب تلقائياً عند العودة للتبويب
            document.addEventListener('visibilitychange', this._onVisible);
            return true;
        } catch (e) {
            return false;
        }
    },
    async disable() {
        document.removeEventListener('visibilitychange', this._onVisible);
        if (this._lock) {
            try { await this._lock.release(); } catch (e) {}
            this._lock = null;
        }
    },
    _onVisible: async () => {
        if (document.visibilityState === 'visible' && WakeLock._lock === null
            && Storage.getSettings().wakeLock) {
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
