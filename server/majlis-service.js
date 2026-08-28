'use strict';

const { randomId } = require('./security');

const BANNER_IDS = Object.freeze(['pearl', 'dhow', 'falcon']);
const TABLE_THEME_IDS = Object.freeze(['classic', 'night', 'sea']);
const QUICK_CHAT_PHRASES = Object.freeze([
    'salam', 'yalla', 'kafo', 'meh', 'good_game', 'one_more',
]);
const REPORT_REASONS = Object.freeze(['spam', 'harassment', 'stalling', 'collusion']);

function normalizeMajlisName(value) {
    if (typeof value !== 'string') return null;
    const name = value.normalize('NFKC').trim();
    if (!name || Array.from(name).length > 32
        || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) return null;
    return name;
}

class MajlisError extends Error {
    constructor(code) {
        super(code);
        this.name = 'MajlisError';
        this.code = code;
    }
}

class MajlisService {
    constructor(store, options = {}) {
        this.store = store;
        this.now = options.now || Date.now;
        this.chatCooldownMs = options.chatCooldownMs || 4_000;
        this.chatCooldowns = new Map();
        this.analyticsToken = options.analyticsToken || (() => null);
    }

    async createFromRoom(account, roomId, input = {}) {
        const current = await this.store.getRoom(roomId);
        if (!current || current.room.phase !== 'RESULTS') throw new MajlisError('COMPLETED_ROOM_REQUIRED');
        const humans = current.seats.filter(seat => !seat.isBot && seat.accountId);
        if (humans.length < 2 || !humans.some(seat => seat.accountId === account.accountId)) {
            throw new MajlisError('ROOM_MEMBERSHIP_REQUIRED');
        }
        if (current.room.majlisId) throw new MajlisError('ROOM_ALREADY_LINKED');
        const displayName = normalizeMajlisName(input.displayName);
        if (!displayName) throw new MajlisError('INVALID_MAJLIS_NAME');
        const bannerId = BANNER_IDS.includes(input.bannerId) ? input.bannerId : 'pearl';
        const tableThemeId = TABLE_THEME_IDS.includes(input.tableThemeId) ? input.tableThemeId : 'classic';
        const nowIso = new Date(this.now()).toISOString();
        const majlis = {
            majlisId: randomId('majlis'),
            displayName,
            ownerAccountId: account.accountId,
            sourceRoomId: roomId,
            bannerId,
            tableThemeId,
            majlisStatus: 'active',
            revision: 1,
            createdAt: nowIso,
            updatedAt: nowIso,
        };
        try {
            await this.store.createMajlis(majlis, [{
                accountId: account.accountId,
                memberRole: 'owner',
                membershipStatus: 'active',
                consentedAt: nowIso,
                updatedAt: nowIso,
            }]);
        } catch (error) {
            if (['SOURCE_ROOM_UNAVAILABLE', 'MAJLIS_EXISTS'].includes(error.code)) {
                const latest = await this.store.getRoom(roomId);
                if (latest && latest.room.majlisId) throw new MajlisError('ROOM_ALREADY_LINKED');
            }
            throw error;
        }
        return this._present(await this.store.getMajlisForMember(majlis.majlisId, account.accountId));
    }

    async acceptFromSourceRoom(account, roomId, majlisId) {
        const majlis = await this.store.getMajlisDefinition(majlisId);
        if (!majlis || majlis.majlisStatus !== 'active' || majlis.sourceRoomId !== roomId) {
            throw new MajlisError('MAJLIS_PROPOSAL_UNAVAILABLE');
        }
        const current = await this.store.getRoom(roomId);
        if (!current || !current.seats.some(seat => !seat.isBot && seat.accountId === account.accountId)) {
            throw new MajlisError('ROOM_MEMBERSHIP_REQUIRED');
        }
        await this.store.acceptMajlisMembership(majlisId, account.accountId, new Date(this.now()).toISOString());
        return this._present(await this.store.getMajlisForMember(majlisId, account.accountId));
    }

    async list(accountId) {
        return (await this.store.listAccountMajalis(accountId)).map(item => this._present(item));
    }

    async detail(accountId, majlisId) {
        const detail = await this.store.getMajlisForMember(majlisId, accountId);
        if (!detail) throw new MajlisError('MAJLIS_MEMBERSHIP_REQUIRED');
        return this._present(detail);
    }

    async assertMembership(majlisId, accountId) {
        if (!await this.store.isMajlisMember(majlisId, accountId)) {
            throw new MajlisError('MAJLIS_MEMBERSHIP_REQUIRED');
        }
        return true;
    }

    async schedule(accountId, majlisId, scheduledFor) {
        await this.assertMembership(majlisId, accountId);
        const scheduledMs = Date.parse(scheduledFor);
        const nowMs = this.now();
        if (!Number.isFinite(scheduledMs) || scheduledMs < nowMs + 15 * 60 * 1000
            || scheduledMs > nowMs + 30 * 24 * 60 * 60 * 1000) {
            throw new MajlisError('INVALID_SCHEDULE');
        }
        const invitation = {
            invitationId: randomId('invite'),
            majlisId,
            createdByAccountId: accountId,
            scheduledFor: new Date(scheduledMs).toISOString(),
            expiresAt: new Date(scheduledMs + 6 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date(nowMs).toISOString(),
            canceledAt: null,
        };
        await this.store.createMajlisInvitation(invitation);
        return invitation;
    }

    async setReminder(accountId, invitationId, enabled) {
        const invitation = await this.store.getMajlisInvitation(invitationId);
        if (!invitation || Date.parse(invitation.expiresAt) <= this.now()) {
            throw new MajlisError('INVITATION_NOT_FOUND');
        }
        await this.assertMembership(invitation.majlisId, accountId);
        const remindAtMs = Math.max(this.now(), Date.parse(invitation.scheduledFor) - 15 * 60 * 1000);
        return this.store.setMajlisReminder({
            invitationId,
            accountId,
            remindAt: new Date(remindAtMs).toISOString(),
            enabled: enabled === true,
            updatedAt: new Date(this.now()).toISOString(),
        });
    }

    async claimDueReminders(accountId) {
        return this.store.claimDueMajlisReminders(accountId, new Date(this.now()).toISOString());
    }

    async recordCompletedMatch(roomId) {
        const current = await this.store.getRoom(roomId);
        const match = current && current.room.matchState;
        if (!current || !current.room.majlisId || current.room.phase !== 'RESULTS'
            || !match || match.phase !== 'COMPLETE') return null;
        const winnerSeat = current.seats.find(seat => seat.seatId === match.winnerId);
        return this.store.recordMajlisSession({
            majlisSessionId: randomId('msession'),
            majlisId: current.room.majlisId,
            roomId,
            matchId: current.room.matchId,
            completedAt: new Date(this.now()).toISOString(),
            players: current.seats.filter(seat => !seat.isBot && seat.accountId).map(seat => ({
                playerIndex: seat.seatIndex,
                accountId: seat.accountId,
                displayName: seat.displayName,
                won: !!winnerSeat && winnerSeat.accountId === seat.accountId,
            })),
        });
    }

    async sendQuickChat(accountId, roomId, phraseId) {
        if (!QUICK_CHAT_PHRASES.includes(phraseId)) throw new MajlisError('INVALID_CHAT_PHRASE');
        const current = await this.store.getRoom(roomId);
        if (!current || !['IN_MATCH', 'RESULTS'].includes(current.room.phase)) {
            throw new MajlisError('ROOM_REQUIRED');
        }
        const seat = current.seats.find(item => !item.isBot && item.accountId === accountId);
        if (!seat) throw new MajlisError('SEAT_NOT_CONNECTED');
        const key = `${roomId}:${accountId}`;
        const nowMs = this.now();
        const lastSentAt = this.chatCooldowns.get(key) || 0;
        if (nowMs - lastSentAt < this.chatCooldownMs) throw new MajlisError('CHAT_COOLDOWN');
        this.chatCooldowns.set(key, nowMs);
        if (this.chatCooldowns.size > 5_000) {
            for (const [cooldownKey, sentAt] of this.chatCooldowns) {
                if (nowMs - sentAt >= this.chatCooldownMs) this.chatCooldowns.delete(cooldownKey);
            }
        }
        return { roomId, seatId: seat.seatId, phraseId, sentAt: new Date(nowMs).toISOString() };
    }

    async submitReport(accountId, roomId, reportedSeatId, reasonCode) {
        if (!REPORT_REASONS.includes(reasonCode)) throw new MajlisError('INVALID_REPORT_REASON');
        const current = await this.store.getRoom(roomId);
        if (!current || current.room.mode !== 'quick' || !current.room.matchId
            || !['IN_MATCH', 'RESULTS'].includes(current.room.phase)) {
            throw new MajlisError('PUBLIC_ROOM_REQUIRED');
        }
        const reporter = current.seats.find(seat => !seat.isBot && seat.accountId === accountId);
        const reported = current.seats.find(seat => !seat.isBot && seat.seatId === reportedSeatId && seat.accountId);
        if (!reporter || !reported || reporter.seatId === reported.seatId) throw new MajlisError('INVALID_REPORT_TARGET');
        return this.store.createModerationReport({
            reportId: randomId('report'),
            roomId,
            matchId: current.room.matchId,
            reporterAccountId: reporter.accountId,
            reportedAccountId: reported.accountId,
            reasonCode,
            reportStatus: 'open',
            createdAt: new Date(this.now()).toISOString(),
            reviewedAt: null,
        });
    }

    _present(majlis) {
        if (!majlis) return majlis;
        const analyticsGroupToken = this.analyticsToken(majlis.majlisId, 'majlis');
        const presented = {
            ...majlis,
            upcomingInvitations: (majlis.upcomingInvitations || [])
                .filter(invitation => Date.parse(invitation.expiresAt) > this.now()),
        };
        return analyticsGroupToken ? { ...presented, analyticsGroupToken } : presented;
    }
}

module.exports = {
    BANNER_IDS,
    MajlisError,
    MajlisService,
    QUICK_CHAT_PHRASES,
    REPORT_REASONS,
    TABLE_THEME_IDS,
};
