'use strict';

class MehGameProfileModule {
    runSplash() {
        const s = document.getElementById('splash');
        if (!s) return;
        const profile = typeof FeedbackDirector !== 'undefined' ? FeedbackDirector.profile : 'full';
        if (profile === 'battery') {
            s.remove();
            return;
        }
        const reduced = profile === 'reduced';
        setTimeout(() => s.classList.add('gone'), reduced ? 100 : 280);
        setTimeout(() => s.remove(), reduced ? 220 : 420);
    }

    // ============ الإعدادات ============
    applySettings() {
        I18n.setLang(this.settings.lang);   // يطبّق الترجمة والاتجاه
        document.body.classList.toggle('colorblind', !!this.settings.colorblind);
        document.body.classList.toggle('battery-saver', !!this.settings.batterySaver);
        if (typeof Sound.configure === 'function') Sound.configure(this.settings);
        else if (typeof Sound.setEnabled === 'function') Sound.setEnabled(this.settings.soundMaster === true);
        if (typeof FeedbackDirector !== 'undefined') FeedbackDirector.configure(this.settings);
        this.renderInstructions();
        this._refreshCatalogLocalization();
        this.updateMenuChip();
    }

    bindSettingsEvents() {
        const open = () => { this.showScreen('settings-screen'); this.refreshSettingsUI(); };
        document.getElementById('menu-settings-btn').onclick = open;
        document.getElementById('settings-back-btn').onclick = () => this.navigateBack('main-menu');

        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.onclick = () => {
                this.settings.lang = btn.dataset.lang;
                Storage.setSetting('lang', this.settings.lang);
                this._syncAuthoritativeSettings();
                I18n.setLang(this.settings.lang);
                this.renderInstructions();
                this._refreshCatalogLocalization();
                this.updateMenuChip();
                this.refreshSettingsUI();
            };
        });

        document.querySelectorAll('.toggle-row').forEach(row => {
            const toggleSetting = () => {
                const key = row.dataset.setting;
                this.settings[key] = !this.settings[key];
                this.settings = Storage.setSetting(key, this.settings[key]);
                this._syncAuthoritativeSettings();
                if (key === 'colorblind') document.body.classList.toggle('colorblind', this.settings[key]);
                if (key === 'batterySaver') document.body.classList.toggle('battery-saver', this.settings[key]);
                if (key === 'wakeLock') {
                    if (this.settings[key]) WakeLock.enable(); else WakeLock.disable();
                }
                if (['soundMaster', 'music', 'sfx', 'batterySaver'].includes(key)) {
                    if (typeof Sound.configure === 'function') Sound.configure(this.settings);
                    if (typeof FeedbackDirector !== 'undefined') FeedbackDirector.configure(this.settings);
                }
                Sound.play('tap-soft');
                this.refreshSettingsUI();
            };
            row.onclick = toggleSetting;
            row.onkeydown = (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleSetting();
            };
        });
    }

    refreshSettingsUI() {
        document.querySelectorAll('.lang-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.lang === this.settings.lang));
        document.querySelectorAll('.toggle-row').forEach(row => {
            const key = row.dataset.setting;
            const enabled = !!this.settings[key];
            row.querySelector('.switch').classList.toggle('on', enabled);
            row.setAttribute('aria-checked', String(enabled));
            if (row.classList.contains('sound-setting--child')) {
                row.dataset.masterMuted = String(this.settings.soundMaster !== true);
            }
        });
    }

    // ============ الأعضاء ============
    initProfile() {
        const current = Storage.getCurrentProfile();
        if (current) {
            this.humanProfile = current;
            this.updateMenuChip();
        } else {
            this.showScreen('profile-screen', { replaceHistory: true });
            this.renderProfileList();
        }
    }

    bindProfileEvents() {
        document.getElementById('players-btn').onclick = () => {
            this.showScreen('profile-screen');
            this.renderProfileList();
        };
        document.getElementById('current-player-chip').onclick = () => {
            this.showScreen('profile-screen');
            this.renderProfileList();
        };
        document.getElementById('show-create-profile').onclick = () => {
            document.getElementById('create-profile-form').classList.remove('hidden');
            this.renderAvatarPicker();
            document.getElementById('profile-name-input').focus();
        };
        document.getElementById('profile-back-btn').onclick = () => {
            document.getElementById('create-profile-form').classList.add('hidden');
            this.navigateBack('main-menu');
        };
        document.getElementById('save-profile-btn').onclick = () => {
            const name = document.getElementById('profile-name-input').value.trim();
            if (!name) { document.getElementById('profile-name-input').focus(); return; }
            this.humanProfile = Storage.createProfile(name, this._pendingAvatar);
            document.getElementById('profile-name-input').value = '';
            document.getElementById('create-profile-form').classList.add('hidden');
            this.updateMenuChip();
            this.showScreen('main-menu', { replaceHistory: true });
            this.showToast(I18n.t('welcome', { name }));
        };
    }

    renderAvatarPicker() {
        const wrap = document.getElementById('avatar-picker');
        wrap.replaceChildren();
        this._pendingAvatar = this._pendingAvatar || AVATARS[0];
        AVATARS.forEach(a => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'avatar-option' + (a === this._pendingAvatar ? ' selected' : '');
            b.textContent = a;
            b.setAttribute('aria-label', `${I18n.t('choose_avatar')}: ${a}`);
            b.setAttribute('aria-pressed', String(a === this._pendingAvatar));
            b.onclick = () => {
                this._pendingAvatar = a;
                wrap.querySelectorAll('.avatar-option').forEach(x => {
                    x.classList.remove('selected');
                    x.setAttribute('aria-pressed', 'false');
                });
                b.classList.add('selected');
                b.setAttribute('aria-pressed', 'true');
            };
            wrap.appendChild(b);
        });
    }

    renderProfileList() {
        const list = document.getElementById('profile-list');
        list.replaceChildren();
        const profiles = Storage.getProfiles();
        const currentId = (Storage.getCurrentProfile() || {}).id;
        profiles.forEach(p => {
            const item = document.createElement('div');
            item.className = 'profile-item' + (p.id === currentId ? ' current' : '');
            const s = p.stats || { wins: 0, losses: 0, games: 0 };
            const avatar = this._safeAvatar(p.avatar) || '😎';
            const name = this._safePlayerName(p.name) || I18n.t('guest');
            const wins = Number.isSafeInteger(s.wins) && s.wins >= 0 ? s.wins : 0;
            const games = Number.isSafeInteger(s.games) && s.games >= 0 ? s.games : 0;
            const chooseButton = document.createElement('button');
            chooseButton.type = 'button';
            chooseButton.className = 'profile-select';
            chooseButton.setAttribute('aria-label', `${I18n.t('select_profile')}: ${name}`);
            const deleteButton = this._createTextElement('button', 'profile-del', '×');
            deleteButton.type = 'button';
            deleteButton.title = 'delete';
            deleteButton.setAttribute('aria-label', `${I18n.t('delete_profile')}: ${name}`);
            chooseButton.appendChild(this._createTextElement('span', 'profile-avatar', avatar));
            chooseButton.appendChild(this._createTextElement('span', 'profile-name', name));
            chooseButton.appendChild(this._createTextElement(
                'span', 'profile-stats', `${I18n.t('wins')}: ${wins} · ${I18n.t('games')}: ${games}`,
            ));
            item.appendChild(chooseButton);
            item.appendChild(deleteButton);
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                Storage.deleteProfile(p.id);
                if (this.humanProfile && this.humanProfile.id === p.id) {
                    this.humanProfile = { name: I18n.t('guest'), avatar: '😎', guest: true };
                    this.updateMenuChip();
                }
                this.renderProfileList();
            };
            const chooseProfile = () => {
                Storage.setCurrentProfile(p.id);
                this.humanProfile = p;
                this.updateMenuChip();
                this.showScreen('main-menu', { replaceHistory: true });
                this.showToast(I18n.t('welcome', { name: p.name }));
            };
            chooseButton.onclick = chooseProfile;
            list.appendChild(item);
        });
    }

    updateMenuChip() {
        const chip = document.getElementById('current-player-chip');
        if (!chip) return;
        if (this.humanProfile && !this.humanProfile.guest) {
            const s = this.humanProfile.stats || { wins: 0, games: 0 };
            const avatar = this._safeAvatar(this.humanProfile.avatar) || '😎';
            const name = this._safePlayerName(this.humanProfile.name) || I18n.t('guest');
            const wins = Number.isSafeInteger(s.wins) && s.wins >= 0 ? s.wins : 0;
            const games = Number.isSafeInteger(s.games) && s.games >= 0 ? s.games : 0;
            chip.replaceChildren(
                this._createTextElement('span', 'chip-avatar', `${avatar} `),
                this._createTextElement('strong', 'chip-name', name),
                this._createTextElement('span', 'chip-stats', `  ${I18n.t('wins')}: ${wins} · ${I18n.t('games')}: ${games}`),
            );
            chip.classList.remove('hidden');
        } else {
            chip.classList.add('hidden');
        }
        if (typeof this._syncCatalogEntryVisibility === 'function') this._syncCatalogEntryVisibility();
    }

    // ============ الإيموجي ============
    bindEmojiEvents() {
        const bar = document.getElementById('emoji-bar');
        const toggle = document.getElementById('emoji-toggle-btn');
        EMOJIS.forEach(e => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'emoji-btn';
            b.textContent = e;
            b.setAttribute('aria-label', `${I18n.t('send_emoji')}: ${e}`);
            b.onclick = () => {
                spawnEmoji(e, 'human');
                bar.classList.add('hidden');
            };
            bar.appendChild(b);
        });
        toggle.onclick = () => bar.classList.toggle('hidden');
    }

    botMaybeEmoji(bot) {
        // البوتات تتفاعل أحياناً بالإيموجي
        if (Math.random() < 0.22) {
            spawnEmoji(EMOJIS[Math.floor(Math.random() * EMOJIS.length)], bot.id);
        }
    }
}

const MehGameProfileMethods = MehGameProfileModule.prototype;
delete MehGameProfileMethods.constructor;
Object.freeze(MehGameProfileMethods);
