/* ============================================================
   storage.js — حفظ محلي للأعضاء والإعدادات (localStorage)
   لا يحتاج خادماً ولا إنترنت. كل شيء يُحفظ على جهاز اللاعب.
   ============================================================ */

const Storage = {
    KEYS: {
        profiles: 'meh_profiles',       // قائمة الأعضاء
        current: 'meh_current_profile', // معرّف العضو الحالي
        settings: 'meh_settings',       // الإعدادات العامة
    },

    // ---- وصول آمن للتخزين وJSON ----
    _getItem(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    },
    _setItem(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            return false;
        }
    },
    _removeItem(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    },
    _read(key, fallback) {
        const raw = this._getItem(key);
        if (!raw) return fallback;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    },
    _write(key, value) {
        try {
            return this._setItem(key, JSON.stringify(value));
        } catch (e) {
            return false;
        }
    },

    // ============ الإعدادات ============
    defaultSettings() {
        return {
            lang: 'ar',          // 'ar' | 'en'
            colorblind: false,   // مراعاة عمى الألوان
            batterySaver: false, // وضع توفير البطارية
            wakeLock: true,      // منع نوم الشاشة أثناء اللعب
            confirmPlay: true,   // ضغطة للمعاينة ثم تأكيد
            sound: true,
        };
    },
    getSettings() {
        const stored = this._read(this.KEYS.settings, {});
        const overrides = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        return Object.assign(this.defaultSettings(), overrides);
    },
    setSetting(key, value) {
        const s = this.getSettings();
        s[key] = value;
        this._write(this.KEYS.settings, s);
        return s;
    },
    saveSettings(settings) {
        this._write(this.KEYS.settings, settings);
    },

    // ============ الأعضاء ============
    getProfiles() {
        const profiles = this._read(this.KEYS.profiles, []);
        return Array.isArray(profiles) ? profiles : [];
    },
    getCurrentProfile() {
        const id = this._getItem(this.KEYS.current);
        if (!id) return null;
        return this.getProfiles().find(p => p.id === id) || null;
    },
    setCurrentProfile(id) {
        return this._setItem(this.KEYS.current, id);
    },
    createProfile(name, avatar) {
        const profiles = this.getProfiles();
        const profile = {
            id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: name,
            avatar: avatar || '😎',
            stats: { wins: 0, losses: 0, games: 0 },
            createdAt: Date.now(),
        };
        profiles.push(profile);
        this._write(this.KEYS.profiles, profiles);
        this.setCurrentProfile(profile.id);
        return profile;
    },
    updateProfile(id, changes) {
        const profiles = this.getProfiles();
        const p = profiles.find(x => x.id === id);
        if (!p) return null;
        Object.assign(p, changes);
        this._write(this.KEYS.profiles, profiles);
        return p;
    },
    deleteProfile(id) {
        let profiles = this.getProfiles().filter(p => p.id !== id);
        this._write(this.KEYS.profiles, profiles);
        if (this._getItem(this.KEYS.current) === id) {
            this._removeItem(this.KEYS.current);
        }
    },
    // تسجيل نتيجة مباراة للعضو الحالي
    recordResult(won) {
        const p = this.getCurrentProfile();
        if (!p) return;
        p.stats = p.stats || { wins: 0, losses: 0, games: 0 };
        p.stats.games++;
        if (won) p.stats.wins++; else p.stats.losses++;
        this.updateProfile(p.id, { stats: p.stats });
    },
};

window.Storage = Storage;
