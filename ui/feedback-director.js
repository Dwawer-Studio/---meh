/* ============================================================
   UIX-6 feedback director
   الحركة طبقة عرض قابلة للمقاطعة؛ لا تغيّر حالة المباراة أو مؤقّتها.
   ============================================================ */

'use strict';

const FeedbackDirector = {
    MAX_BLOCKING_MS: 420,
    MAX_FLASHES_PER_SECOND: 0,
    profile: 'full',
    settings: Object.freeze({ batterySaver: false }),
    lastTurnIndex: null,
    lastTurnPlayerId: null,
    _motionQuery: null,
    _motionListenerBound: false,
    _timers: new Map(),

    configure(settings = {}) {
        this.settings = Object.freeze({ batterySaver: settings.batterySaver === true });
        if (!this._motionQuery && typeof window.matchMedia === 'function') {
            this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        }
        if (this._motionQuery && !this._motionListenerBound) {
            const listener = () => this.configure(this.settings);
            if (typeof this._motionQuery.addEventListener === 'function') {
                this._motionQuery.addEventListener('change', listener);
            }
            this._motionListenerBound = true;
        }
        this.profile = this.settings.batterySaver
            ? 'battery'
            : (this._motionQuery && this._motionQuery.matches ? 'reduced' : 'full');
        if (document.body) {
            document.body.dataset.feedbackProfile = this.profile;
            document.body.dataset.uiMotion = this.profile === 'full' ? 'full' : 'reduced';
        }
        if (this.profile === 'battery') this.cancelAll();
        return this.profile;
    },

    duration(full, reduced = 120) {
        if (this.profile === 'battery') return 0;
        return this.profile === 'reduced' ? reduced : Math.min(full, this.MAX_BLOCKING_MS);
    },

    _schedule(key, callback, delay) {
        if (this._timers.has(key)) clearTimeout(this._timers.get(key));
        const timer = setTimeout(() => {
            this._timers.delete(key);
            callback();
        }, delay);
        this._timers.set(key, timer);
        return timer;
    },

    cancelAll() {
        this._timers.forEach(timer => clearTimeout(timer));
        this._timers.clear();
        document.querySelectorAll('[data-feedback-flight]').forEach(element => element.remove());
        document.querySelectorAll('.feedback-impact, .turn-arrival, .turn-departure, .ui-screen-enter')
            .forEach(element => element.classList.remove(
                'feedback-impact', 'turn-arrival', 'turn-departure', 'ui-screen-enter',
            ));
    },

    transition(current, target) {
        if (!target || current === target) return;
        if (target.id === 'game-screen') {
            this.lastTurnIndex = null;
            this.lastTurnPlayerId = null;
        }
        target.classList.remove('ui-screen-enter');
        if (this.profile !== 'battery') {
            void target.offsetWidth;
            target.classList.add('ui-screen-enter');
            this._schedule('screen-transition', () => target.classList.remove('ui-screen-enter'), this.duration(320) + 40);
        }
        const scene = target.id === 'game-screen' ? 'table' : (target.id === 'end-screen' ? 'result' : 'home');
        if (typeof Sound !== 'undefined' && typeof Sound.setScene === 'function') Sound.setScene(scene);
    },

    animateCardPlay(startRect, endElement, cardElement) {
        if (!startRect || !endElement || !cardElement || this.profile === 'battery') return 0;
        document.querySelectorAll('[data-feedback-flight="play"]').forEach(element => element.remove());
        const endRect = endElement.getBoundingClientRect();
        const duration = this.duration(260);
        const flight = cardElement;
        flight.dataset.feedbackFlight = 'play';
        flight.classList.add(this.profile === 'reduced' ? 'feedback-card-crossfade' : 'feedback-card-flight');
        flight.style.setProperty('--feedback-from-x', `${startRect.left}px`);
        flight.style.setProperty('--feedback-from-y', `${startRect.top}px`);
        flight.style.setProperty('--feedback-to-x', `${endRect.left}px`);
        flight.style.setProperty('--feedback-to-y', `${endRect.top}px`);
        flight.style.setProperty('--feedback-mid-x', `${(startRect.left + endRect.left) / 2}px`);
        flight.style.setProperty('--feedback-mid-y', `${(startRect.top + endRect.top) / 2 - 24}px`);
        flight.style.setProperty('--feedback-card-w', `${startRect.width}px`);
        flight.style.setProperty('--feedback-card-h', `${startRect.height}px`);
        flight.style.setProperty('--feedback-duration', `${duration}ms`);
        document.body.appendChild(flight);
        endElement.classList.add('feedback-settle-target');
        this._schedule('card-play', () => {
            flight.remove();
            endElement.classList.remove('feedback-settle-target');
        }, duration + 40);
        return duration;
    },

    animateDraw(fromElement, toElement) {
        if (!fromElement || !toElement || this.profile === 'battery') return 0;
        const duration = this.duration(280);
        if (this.profile === 'reduced') {
            toElement.classList.remove('feedback-count-pulse');
            void toElement.offsetWidth;
            toElement.classList.add('feedback-count-pulse');
            this._schedule(`draw-pulse-${toElement.id || 'seat'}`,
                () => toElement.classList.remove('feedback-count-pulse'), duration + 40);
            return duration;
        }
        const fromRect = fromElement.getBoundingClientRect();
        const toRect = toElement.getBoundingClientRect();
        const flight = document.createElement('div');
        flight.className = 'card back feedback-draw-flight';
        flight.dataset.feedbackFlight = 'draw';
        flight.setAttribute('aria-hidden', 'true');
        flight.style.setProperty('--feedback-from-x', `${fromRect.left + fromRect.width / 2 - 30}px`);
        flight.style.setProperty('--feedback-from-y', `${fromRect.top + fromRect.height / 2 - 43}px`);
        flight.style.setProperty('--feedback-to-x', `${toRect.left + toRect.width / 2 - 30}px`);
        flight.style.setProperty('--feedback-to-y', `${toRect.top + toRect.height / 2 - 43}px`);
        flight.style.setProperty('--feedback-mid-x',
            `${(fromRect.left + toRect.left) / 2 + (fromRect.width + toRect.width) / 4 - 30}px`);
        flight.style.setProperty('--feedback-mid-y',
            `${(fromRect.top + toRect.top) / 2 + (fromRect.height + toRect.height) / 4 - 61}px`);
        flight.style.setProperty('--feedback-duration', `${duration}ms`);
        document.body.appendChild(flight);
        setTimeout(() => flight.remove(), duration + 40);
        return duration;
    },

    turn(screen, index, direction = 1, playerId = '') {
        if (!screen || !Number.isSafeInteger(index)) return;
        const previous = this.lastTurnIndex;
        const previousPlayerId = this.lastTurnPlayerId;
        this.lastTurnIndex = index;
        this.lastTurnPlayerId = playerId;
        screen.dataset.feedbackTurn = String(index);
        screen.dataset.feedbackDirection = direction === -1 ? 'counterclockwise' : 'clockwise';
        if (previous === index || document.hidden || this.profile === 'battery') return;
        const areas = [...screen.querySelectorAll('.player-area')];
        const previousArea = previousPlayerId
            ? document.getElementById(`player-${previousPlayerId}`)
            : (areas[previous] || null);
        const nextArea = playerId
            ? document.getElementById(`player-${playerId}`)
            : (areas[index] || null);
        if (previousArea) previousArea.classList.add('turn-departure');
        if (nextArea) nextArea.classList.add('turn-arrival');
        this._schedule('turn', () => {
            if (previousArea) previousArea.classList.remove('turn-departure');
            if (nextArea) nextArea.classList.remove('turn-arrival');
        }, this.duration(180) + 80);
    },

    impact(screen, kind) {
        if (!screen || this.profile === 'battery') return;
        screen.dataset.feedbackImpact = kind;
        screen.classList.remove('feedback-impact');
        void screen.offsetWidth;
        screen.classList.add('feedback-impact');
        this._schedule('impact', () => {
            screen.classList.remove('feedback-impact');
            delete screen.dataset.feedbackImpact;
        }, this.duration(360) + 40);
    },

    result(screen, won) {
        if (!screen) return;
        // النتيجة تقطع أي choreography قديمة؛ لا تعيد حركة توزيع/دور بعد حسم الجولة.
        this.cancelAll();
        screen.dataset.resultOutcome = won ? 'win' : 'settled';
        screen.classList.remove('result-moment-active');
        if (this.profile === 'battery') return;
        void screen.offsetWidth;
        screen.classList.add('result-moment-active');
        this._schedule('result', () => screen.classList.remove('result-moment-active'), this.duration(420) + 120);
    },
};

window.FeedbackDirector = FeedbackDirector;
