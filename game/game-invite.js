'use strict';

class MehGameInviteModule {
    bindInviteEvents() {
        document.getElementById('invite-join-btn').onclick = () => this._joinFromInvite();
        document.getElementById('invite-back-btn').onclick = () => {
            this._pendingInvite = null;
            this.showScreen('main-menu');
        };
        document.getElementById('copy-invite-btn').onclick = () => this._copyInviteLink();
        document.getElementById('share-invite-btn').onclick = () => this._shareInviteLink();
        document.getElementById('whatsapp-invite-btn').onclick = () => this._shareInviteOnWhatsApp();
        document.getElementById('qr-invite-btn').onclick = () => this._toggleInviteQr();
    }

    _initializeInviteEntry() {
        if (!this._productFeatureEnabled('deep_link_join')) return false;
        let url;
        try { url = new URL(window.location.href); }
        catch (error) { return false; }
        if (!url.searchParams.has('join')) return false;
        const token = (url.searchParams.get('join') || '').trim().toUpperCase();
        const version = url.searchParams.get('v');
        const valid = /^[A-HJ-NP-Z2-9]{5}$/.test(token) && version === '1';
        this._pendingInvite = valid ? { token, version: 1 } : null;
        this._trackProductEvent('invite.opened', { method: 'link' });

        const name = this.humanProfile && !this.humanProfile.guest
            ? this._safePlayerName(this.humanProfile.name)
            : null;
        const profile = document.getElementById('invite-profile-summary');
        const input = document.getElementById('invite-guest-name');
        profile.textContent = name ? I18n.t('invite_join_as', { name }) : I18n.t('invite_guest_prompt');
        input.classList.toggle('hidden', !!name);
        input.value = '';
        document.getElementById('invite-join-btn').disabled = !valid;
        this._setInviteStatus(valid ? I18n.t('invite_seat_check') : I18n.t('invite_invalid'), !valid);
        this.showScreen('invite-screen');
        return valid;
    }

    _setInviteStatus(message, isError = false) {
        const status = document.getElementById('invite-status');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('error', !!isError);
    }

    _joinFromInvite() {
        if (!this._pendingInvite) return;
        let name = this.humanProfile && !this.humanProfile.guest
            ? this._safePlayerName(this.humanProfile.name)
            : null;
        if (!name) {
            name = this._safePlayerName(document.getElementById('invite-guest-name').value);
            if (!name) {
                this._setInviteStatus(I18n.t('invite_name_required'), true);
                document.getElementById('invite-guest-name').focus();
                return;
            }
            this.humanProfile = { name, avatar: '😎', guest: true };
        }
        document.getElementById('room-code-input').value = this._pendingInvite.token;
        this._setInviteStatus(I18n.t('connecting'));
        this.joinRoom({ method: 'link', surface: 'invite' });
    }

    _buildInviteUrl(code = Net.roomCode) {
        if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code || '')) return '';
        try {
            const url = new URL(window.location.href);
            url.search = '';
            url.hash = '';
            url.searchParams.set('join', code);
            url.searchParams.set('v', '1');
            return url.toString();
        } catch (error) { return ''; }
    }

    _setLobbyInvite(code) {
        const enabled = this._productFeatureEnabled('deep_link_join');
        this._activeInviteUrl = enabled ? this._buildInviteUrl(code) : '';
        const actions = document.getElementById('invite-actions');
        if (actions) actions.classList.toggle('hidden', !enabled || !this._activeInviteUrl || !Net.isHost);
        const qrWrap = document.getElementById('invite-qr-wrap');
        if (qrWrap) qrWrap.classList.add('hidden');
    }

    async _copyText(text) {
        if (!text) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {}
        try {
            const input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', '');
            input.className = 'copy-fallback';
            document.body.appendChild(input);
            input.select();
            const copied = document.execCommand('copy');
            input.remove();
            return copied;
        } catch (error) { return false; }
    }

    async _copyInviteLink() {
        const copied = await this._copyText(this._activeInviteUrl || this._buildInviteUrl());
        this.showToast(I18n.t(copied ? 'invite_copied' : 'invite_copy_failed'));
        if (copied) this._trackProductEvent('invite.created', { method: 'link' });
    }

    async _shareInviteLink() {
        const url = this._activeInviteUrl || this._buildInviteUrl();
        if (!url) return;
        if (navigator.share) {
            try {
                await navigator.share({ title: I18n.t('invite_share_title'), text: I18n.t('invite_share_text'), url });
                this._trackProductEvent('invite.created', { method: 'share' });
                return;
            } catch (error) {
                if (error && error.name === 'AbortError') return;
            }
        }
        await this._copyInviteLink();
    }

    _shareInviteOnWhatsApp() {
        const url = this._activeInviteUrl || this._buildInviteUrl();
        if (!url) return;
        const text = `${I18n.t('invite_share_text')} ${url}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
        this._trackProductEvent('invite.created', { method: 'share' });
    }

    _toggleInviteQr() {
        const wrap = document.getElementById('invite-qr-wrap');
        const image = document.getElementById('invite-qr-image');
        if (!wrap || !image) return;
        if (!wrap.classList.contains('hidden')) {
            wrap.classList.add('hidden');
            return;
        }
        const url = this._activeInviteUrl || this._buildInviteUrl();
        try {
            const qr = qrcode(0, 'M');
            qr.addData(url);
            qr.make();
            image.src = qr.createDataURL(6, 12);
            wrap.classList.remove('hidden');
            this._trackProductEvent('invite.created', { method: 'qr' });
        } catch (error) {
            this.showToast(I18n.t('invite_qr_failed'));
        }
    }
}

const MehGameInviteMethods = MehGameInviteModule.prototype;
delete MehGameInviteMethods.constructor;
Object.freeze(MehGameInviteMethods);
