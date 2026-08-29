'use strict';

const MAJLIS_QUICK_PHRASES = Object.freeze([
    'salam', 'yalla', 'kafo', 'meh', 'good_game', 'one_more',
]);
const MAJLIS_REPORT_REASONS = Object.freeze([
    'spam', 'harassment', 'stalling', 'collusion',
]);
const MAJLIS_BANNERS = Object.freeze({ pearl: '🦪', dhow: '⛵', falcon: '🦅' });

class MehGameMajlisModule {
    _initializeMajlisRuntime() {
        this._recentMajalis = [];
        this._activeMajlis = null;
        this._majlisRoom = null;
        this._majlisSeats = [];
        this._mutedSeatIds = new Set();
        this._quickChatLocked = false;
        this._quickChatLastFocus = null;
        this._majlisReminderTimer = null;
        this._majlisExperimentExposures = new Set();
        this._majlisTrackedSessions = new Set();
        this._majlisTrackedCompletions = new Set();
    }

    bindMajlisEvents() {
        const on = (id, handler) => {
            const element = document.getElementById(id);
            if (element) element.addEventListener('click', handler);
        };
        on('refresh-majalis-btn', () => this._loadRecentMajalis());
        on('majlis-create-btn', () => this._createMajlisFromResults());
        on('majlis-accept-btn', () => this._acceptCurrentMajlis());
        on('majlis-schedule-btn', () => this._scheduleCurrentMajlis());
        on('quick-chat-toggle', () => this._setQuickChatOpen(true));
        on('quick-chat-close', () => this._setQuickChatOpen(false));
        const quickChatPanel = document.getElementById('quick-chat-panel');
        if (quickChatPanel) quickChatPanel.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            this._setQuickChatOpen(false);
        });
        this._renderQuickChatPhrases();
    }

    async _loadRecentMajalis() {
        const section = document.getElementById('recent-majalis');
        const list = document.getElementById('recent-majalis-list');
        const enabled = this._productFeatureEnabled('recent_majalis') && this._authoritativeServiceAvailable();
        if (section) section.classList.toggle('hidden', !enabled);
        if (!enabled || !list) return [];
        list.textContent = I18n.t('majlis_loading');
        try {
            await this._ensureAuthoritativeClient();
            this._recentMajalis = await AuthoritativeAccountClient.listMajalis(
                this._authoritativeHttpUrl, this._authoritativeAccessToken,
            );
            this._renderRecentMajalis();
            this._startMajlisReminderPolling();
            this._trackProductEvent('majlis.list_viewed', { count: this._recentMajalis.length });
            return this._recentMajalis;
        } catch (error) {
            list.textContent = I18n.t('majlis_load_failed');
            return [];
        }
    }

    _renderRecentMajalis() {
        const list = document.getElementById('recent-majalis-list');
        if (!list) return;
        list.replaceChildren();
        if (!this._recentMajalis.length) {
            const empty = document.createElement('p');
            empty.className = 'majlis-empty';
            empty.textContent = I18n.t('majlis_empty');
            list.appendChild(empty);
            return;
        }
        this._recentMajalis.forEach(majlis => {
            const article = document.createElement('article');
            article.className = 'majlis-card';
            const identity = document.createElement('div');
            identity.className = 'majlis-card-identity';
            const mark = document.createElement('span');
            mark.className = 'majlis-mark';
            mark.setAttribute('aria-hidden', 'true');
            mark.textContent = MAJLIS_BANNERS[majlis.bannerId] || MAJLIS_BANNERS.pearl;
            const copy = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = majlis.displayName;
            const context = document.createElement('small');
            context.textContent = I18n.t('majlis_member_count', { count: majlis.members.length });
            copy.append(title, context);
            identity.append(mark, copy);
            article.appendChild(identity);
            if (this._productFeatureEnabled('one_tap_reinvite')) {
                const regroup = document.createElement('button');
                regroup.type = 'button';
                regroup.className = 'btn secondary-btn majlis-regroup-btn';
                regroup.textContent = I18n.t('majlis_regroup');
                regroup.addEventListener('click', () => {
                    this._trackProductEvent('majlis.regroup_started', {
                        memberCount: Math.max(1, Math.min(4, majlis.members.length)),
                        groupToken: majlis.analyticsGroupToken,
                    });
                    if (majlis.activeRoom && majlis.activeRoom.phase === 'FORMING') {
                        this._joinAuthoritativeRoom({ code: majlis.activeRoom.roomCode, surface: 'online' });
                    } else if (!majlis.activeRoom) {
                        this._createAuthoritativeRoom('private', majlis.majlisId);
                    }
                });
                if (majlis.activeRoom && majlis.activeRoom.phase === 'IN_MATCH') {
                    regroup.disabled = true;
                    regroup.textContent = I18n.t('majlis_session_active');
                }
                article.appendChild(regroup);
            }
            list.appendChild(article);
        });
        this._recordMajlisExperimentExposure('p3_one_tap_reinvite', 'one_tap_reinvite');
    }

    _syncMajlisFromSnapshot(room, seats) {
        this._majlisRoom = room;
        this._majlisSeats = seats;
        const chatEnabled = this._productFeatureEnabled('safe_quick_chat')
            && ['IN_MATCH', 'RESULTS'].includes(room.phase);
        const chat = document.getElementById('quick-chat-control');
        if (chat) chat.classList.toggle('hidden', !chatEnabled);
        const emoji = document.getElementById('emoji-toggle-btn');
        if (emoji && this._authoritativeClient) emoji.classList.toggle('hidden', chatEnabled);
        if (chatEnabled) this._renderTableSafety();
        if (room.phase === 'IN_MATCH' && room.analyticsGroupToken && room.analyticsMatchToken
            && !this._majlisTrackedSessions.has(room.analyticsMatchToken)) {
            this._majlisTrackedSessions.add(room.analyticsMatchToken);
            this._trackProductEvent('majlis.session_started', {
                groupToken: room.analyticsGroupToken,
                sessionToken: room.analyticsMatchToken,
                humanSeats: Math.max(1, Math.min(4, seats.filter(seat => !seat.isBot).length)),
            });
        }
        if (room.phase === 'RESULTS' && room.analyticsGroupToken && room.analyticsMatchToken
            && !this._majlisTrackedCompletions.has(room.analyticsMatchToken)) {
            this._majlisTrackedCompletions.add(room.analyticsMatchToken);
            this._trackProductEvent('majlis.session_completed', {
                groupToken: room.analyticsGroupToken,
                sessionToken: room.analyticsMatchToken,
            });
        }
        if (room.phase === 'RESULTS') void this._renderMajlisResults();
    }

    async _renderMajlisResults() {
        const panel = document.getElementById('majlis-result-panel');
        if (!panel || !this._majlisRoom || !this._authoritativeClient) return;
        const humans = this._majlisSeats.filter(seat => !seat.isBot);
        panel.classList.toggle('hidden', humans.length < 2);
        if (humans.length < 2) return;
        const createControls = document.getElementById('majlis-create-controls');
        const acceptButton = document.getElementById('majlis-accept-btn');
        const detail = document.getElementById('majlis-detail');
        createControls.classList.toggle('hidden', !!this._majlisRoom.majlisId);
        acceptButton.classList.add('hidden');
        detail.classList.add('hidden');
        if (!this._majlisRoom.majlisId) {
            this._setMajlisStatus(I18n.t('majlis_create_ready'));
            this._trackProductEvent('majlis.create_prompted', {
                humanSeats: Math.max(2, Math.min(4, humans.length)),
            });
            return;
        }
        this._setMajlisStatus(I18n.t('majlis_checking_membership'));
        try {
            const majlis = await this._fetchMajlis(this._majlisRoom.majlisId);
            this._activeMajlis = majlis;
            this._renderMajlisDetail(majlis);
        } catch (error) {
            if (error.code === 'MAJLIS_MEMBERSHIP_REQUIRED') {
                this._setMajlisStatus(I18n.t('majlis_consent_prompt'));
                acceptButton.classList.remove('hidden');
            } else {
                this._setMajlisStatus(I18n.t('majlis_load_failed'), true);
            }
        }
    }

    async _createMajlisFromResults() {
        const input = document.getElementById('majlis-name-input');
        const displayName = input && input.value.trim();
        if (!displayName || Array.from(displayName).length > 32) {
            this._setMajlisStatus(I18n.t('majlis_name_invalid'), true);
            return;
        }
        try {
            const response = await this._authoritativeClient.createMajlis({
                displayName,
                bannerId: document.getElementById('majlis-banner-select').value,
                tableThemeId: document.getElementById('majlis-theme-select').value,
            });
            this._activeMajlis = response.payload.majlis;
            this._majlisRoom = { ...this._majlisRoom, majlisId: this._activeMajlis.majlisId };
            document.getElementById('majlis-create-controls').classList.add('hidden');
            this._renderMajlisDetail(this._activeMajlis);
            this._trackProductEvent('majlis.created', {
                memberCount: Math.max(1, Math.min(4, this._activeMajlis.members.length)),
                groupToken: this._activeMajlis.analyticsGroupToken,
            });
        } catch (error) {
            this._setMajlisStatus(I18n.t('majlis_create_failed'), true);
        }
    }

    async _acceptCurrentMajlis() {
        if (!this._majlisRoom || !this._majlisRoom.majlisId) return;
        try {
            const response = await this._authoritativeClient.acceptMajlis(this._majlisRoom.majlisId);
            this._activeMajlis = response.payload.majlis;
            document.getElementById('majlis-accept-btn').classList.add('hidden');
            this._renderMajlisDetail(this._activeMajlis);
            this._trackProductEvent('majlis.join_accepted', {
                source: 'results',
                groupToken: this._activeMajlis.analyticsGroupToken,
                memberCount: Math.max(1, Math.min(4, this._activeMajlis.members.length)),
            });
        } catch (error) {
            this._setMajlisStatus(I18n.t('majlis_accept_failed'), true);
        }
    }

    _fetchMajlis(majlisId) {
        return AuthoritativeAccountClient.getMajlis(
            this._authoritativeHttpUrl, this._authoritativeAccessToken, majlisId,
        );
    }

    _renderMajlisDetail(majlis) {
        const detail = document.getElementById('majlis-detail');
        if (!detail) return;
        detail.replaceChildren();
        detail.classList.remove('hidden');
        this._setMajlisStatus(`${MAJLIS_BANNERS[majlis.bannerId] || '🦪'} ${majlis.displayName}`);
        const members = document.createElement('p');
        members.className = 'majlis-member-line';
        members.textContent = I18n.t('majlis_members_named', {
            members: majlis.members.map(member => member.displayName).join(' · '),
        });
        detail.appendChild(members);
        if (this._productFeatureEnabled('majlis_session_score') && majlis.sessionScore.length) {
            const heading = document.createElement('h3');
            heading.textContent = I18n.t('majlis_friendly_score');
            const score = document.createElement('ol');
            score.className = 'majlis-score-list';
            majlis.sessionScore.forEach(player => {
                const row = document.createElement('li');
                row.textContent = I18n.t('majlis_score_row', {
                    player: player.displayName, wins: player.wins, matches: player.matches,
                });
                score.appendChild(row);
            });
            detail.append(heading, score);
        }
        this._recordMajlisExperimentExposure(
            'p3_majlis_session_score', 'majlis_session_score', majlis.analyticsGroupToken,
        );
        if (this._productFeatureEnabled('majlis_schedule')) {
            const schedule = document.getElementById('majlis-schedule-controls');
            schedule.classList.remove('hidden');
            const input = document.getElementById('majlis-schedule-input');
            input.min = this._localDateTimeValue(Date.now() + 15 * 60 * 1000);
            this._renderMajlisInvitations(detail, majlis.upcomingInvitations);
        }
        this._recordMajlisExperimentExposure(
            'p3_majlis_schedule', 'majlis_schedule', majlis.analyticsGroupToken,
        );
    }

    _renderMajlisInvitations(container, invitations) {
        if (!Array.isArray(invitations) || !invitations.length) return;
        const list = document.createElement('div');
        list.className = 'majlis-invitations';
        invitations.forEach(invitation => {
            const row = document.createElement('div');
            const time = document.createElement('time');
            time.dateTime = invitation.scheduledFor;
            time.textContent = new Intl.DateTimeFormat(I18n.lang === 'ar' ? 'ar-BH' : 'en-GB', {
                dateStyle: 'medium', timeStyle: 'short',
            }).format(new Date(invitation.scheduledFor));
            const reminder = document.createElement('button');
            reminder.type = 'button';
            reminder.className = 'compact-action';
            reminder.textContent = I18n.t(invitation.reminderEnabled ? 'reminder_on' : 'reminder_off');
            reminder.addEventListener('click', async () => {
                const enabled = !invitation.reminderEnabled;
                try {
                    await AuthoritativeAccountClient.setMajlisReminder(
                        this._authoritativeHttpUrl, this._authoritativeAccessToken,
                        invitation.invitationId, enabled,
                    );
                    invitation.reminderEnabled = enabled;
                    reminder.textContent = I18n.t(enabled ? 'reminder_on' : 'reminder_off');
                    if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                        void Notification.requestPermission();
                    }
                    this._trackProductEvent('majlis.reminder_changed', { enabled });
                } catch (error) { this._setMajlisStatus(I18n.t('majlis_schedule_failed'), true); }
            });
            row.append(time, reminder);
            list.appendChild(row);
        });
        container.appendChild(list);
    }

    async _scheduleCurrentMajlis() {
        const input = document.getElementById('majlis-schedule-input');
        const scheduledMs = Date.parse(input && input.value);
        if (!this._activeMajlis || !Number.isFinite(scheduledMs)) {
            this._setMajlisStatus(I18n.t('majlis_schedule_invalid'), true);
            return;
        }
        try {
            await AuthoritativeAccountClient.scheduleMajlis(
                this._authoritativeHttpUrl, this._authoritativeAccessToken,
                this._activeMajlis.majlisId, new Date(scheduledMs).toISOString(),
            );
            this._trackProductEvent('majlis.invitation_scheduled', {
                leadMinutes: Math.max(15, Math.min(43_200, Math.round((scheduledMs - Date.now()) / 60_000))),
                groupToken: this._activeMajlis.analyticsGroupToken,
            });
            this._activeMajlis = await this._fetchMajlis(this._activeMajlis.majlisId);
            this._renderMajlisDetail(this._activeMajlis);
        } catch (error) {
            this._setMajlisStatus(I18n.t('majlis_schedule_failed'), true);
        }
    }

    _localDateTimeValue(timeMs) {
        const date = new Date(timeMs - new Date(timeMs).getTimezoneOffset() * 60_000);
        return date.toISOString().slice(0, 16);
    }

    _startMajlisReminderPolling() {
        if (this._majlisReminderTimer) return;
        const poll = async () => {
            try { await this._checkMajlisReminders(); } catch (error) {}
            this._majlisReminderTimer = setTimeout(poll, 60_000);
        };
        void poll();
    }

    async _checkMajlisReminders() {
        if (!this._authoritativeHttpUrl || !this._authoritativeAccessToken
            || !this._productFeatureEnabled('majlis_schedule')) return [];
        const reminders = await AuthoritativeAccountClient.claimDueMajlisReminders(
            this._authoritativeHttpUrl, this._authoritativeAccessToken,
        );
        reminders.forEach(reminder => {
            const message = I18n.t('majlis_reminder_due', { majlis: reminder.majlisDisplayName });
            this.showToast(message);
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification(I18n.t('majlis_reminder_title'), { body: message, tag: reminder.invitationId });
            }
        });
        return reminders;
    }

    _setMajlisStatus(message, isError = false) {
        const status = document.getElementById('majlis-result-status');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('error', isError);
    }

    _recordMajlisExperimentExposure(experimentId, flagName, groupToken = null) {
        if (this._majlisExperimentExposures.has(experimentId)) return;
        const assignments = typeof window !== 'undefined' && window.MEH_EXPERIMENT_ASSIGNMENTS;
        const flagMap = typeof window !== 'undefined' && window.P3_EXPERIMENT_FLAG_MAP;
        if (!flagMap || flagMap[experimentId] !== flagName) return;
        const variant = assignments && assignments[experimentId];
        if (!['control', 'treatment'].includes(variant)) return;
        const properties = {
            experimentId,
            variant,
        };
        if (groupToken) properties.groupToken = groupToken;
        if (this._trackProductEvent('experiment.exposed', properties)) {
            this._majlisExperimentExposures.add(experimentId);
        }
    }

    _renderQuickChatPhrases() {
        const container = document.getElementById('quick-chat-phrases');
        if (!container) return;
        container.replaceChildren();
        MAJLIS_QUICK_PHRASES.forEach(phraseId => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'quick-phrase';
            button.textContent = I18n.t(`chat_${phraseId}`);
            button.addEventListener('click', () => this._sendQuickPhrase(phraseId));
            container.appendChild(button);
        });
    }

    async _sendQuickPhrase(phraseId) {
        if (!this._authoritativeClient || this._quickChatLocked) return;
        this._quickChatLocked = true;
        this._setQuickPhraseDisabled(true);
        try {
            const response = await this._authoritativeClient.sendQuickChat(phraseId);
            this._showQuickPhrase(response.payload);
            this._trackProductEvent('chat.phrase_sent', { phraseId });
        } catch (error) {
            this.showToast(I18n.t(error.code === 'CHAT_COOLDOWN' ? 'chat_slow_down' : 'conn_error'));
        } finally {
            setTimeout(() => {
                this._quickChatLocked = false;
                this._setQuickPhraseDisabled(false);
            }, 4_000);
        }
    }

    _setQuickPhraseDisabled(disabled) {
        document.querySelectorAll('#quick-chat-phrases button').forEach(button => { button.disabled = disabled; });
    }

    _handleMajlisEvent(message) {
        if (!message || message.type !== 'chat.phrase') return;
        const chat = message.payload;
        if (!chat || !MAJLIS_QUICK_PHRASES.includes(chat.phraseId)
            || this._mutedSeatIds.has(chat.seatId)) return;
        this._showQuickPhrase(chat);
    }

    _showQuickPhrase(chat) {
        const feed = document.getElementById('quick-chat-feed');
        if (!feed || !chat || !MAJLIS_QUICK_PHRASES.includes(chat.phraseId)) return;
        const seat = this._majlisSeats.find(item => item.seatId === chat.seatId);
        const line = document.createElement('p');
        line.textContent = `${seat ? seat.displayName : I18n.t('guest')}: ${I18n.t(`chat_${chat.phraseId}`)}`;
        feed.appendChild(line);
        while (feed.childElementCount > 3) feed.firstElementChild.remove();
        setTimeout(() => line.remove(), 6_000);
    }

    _setQuickChatOpen(open) {
        const panel = document.getElementById('quick-chat-panel');
        if (!panel) return;
        panel.classList.toggle('hidden', !open);
        panel.inert = !open;
        panel.toggleAttribute('inert', !open);
        panel.setAttribute('aria-hidden', String(!open));
        if (open) {
            this._quickChatLastFocus = document.activeElement;
            this._renderTableSafety();
            const close = document.getElementById('quick-chat-close');
            if (close) close.focus();
            return;
        }
        const fallback = document.getElementById('quick-chat-toggle');
        const restore = this._quickChatLastFocus && this._quickChatLastFocus.isConnected
            ? this._quickChatLastFocus : fallback;
        this._quickChatLastFocus = null;
        if (restore) restore.focus();
    }

    _renderTableSafety() {
        const list = document.getElementById('table-safety-list');
        if (!list || !this._authoritativeClient) return;
        list.replaceChildren();
        this._majlisSeats.filter(seat => !seat.isBot && seat.seatId !== this._authoritativeClient.seatId)
            .forEach(seat => {
                const row = document.createElement('div');
                row.className = 'table-safety-row';
                const name = document.createElement('span');
                name.textContent = seat.displayName;
                const mute = document.createElement('button');
                mute.type = 'button';
                mute.className = 'compact-action';
                const refreshMute = () => {
                    mute.textContent = I18n.t(this._mutedSeatIds.has(seat.seatId) ? 'unmute_player' : 'mute_player');
                };
                refreshMute();
                mute.addEventListener('click', () => {
                    if (this._mutedSeatIds.has(seat.seatId)) this._mutedSeatIds.delete(seat.seatId);
                    else this._mutedSeatIds.add(seat.seatId);
                    refreshMute();
                    this._trackProductEvent('chat.player_muted', { muted: this._mutedSeatIds.has(seat.seatId) });
                });
                row.append(name, mute);
                if (this._majlisRoom && this._majlisRoom.mode === 'quick') {
                    const reason = document.createElement('select');
                    reason.setAttribute('aria-label', I18n.t('report_reason'));
                    MAJLIS_REPORT_REASONS.forEach(reasonCode => {
                        const option = document.createElement('option');
                        option.value = reasonCode;
                        option.textContent = I18n.t(`report_${reasonCode}`);
                        reason.appendChild(option);
                    });
                    const report = document.createElement('button');
                    report.type = 'button';
                    report.className = 'compact-action danger-action';
                    report.textContent = I18n.t('report_player');
                    report.addEventListener('click', () => this._reportSeat(seat.seatId, reason.value, report));
                    row.append(reason, report);
                }
                list.appendChild(row);
            });
        if (!list.childElementCount) {
            const empty = document.createElement('p');
            empty.textContent = I18n.t('safety_no_players');
            list.appendChild(empty);
        }
    }

    async _reportSeat(seatId, reasonCode, button) {
        button.disabled = true;
        try {
            await this._authoritativeClient.reportSeat(seatId, reasonCode);
            button.textContent = I18n.t('report_sent');
            this._trackProductEvent('moderation.report_submitted', { reasonCode });
        } catch (error) {
            button.disabled = false;
            this.showToast(I18n.t(error.code === 'REPORT_ALREADY_SUBMITTED' ? 'report_already_sent' : 'conn_error'));
        }
    }
}

const MehGameMajlisMethods = MehGameMajlisModule.prototype;
delete MehGameMajlisMethods.constructor;
Object.freeze(MehGameMajlisMethods);
