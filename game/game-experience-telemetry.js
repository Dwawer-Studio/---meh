'use strict';

class MehGameExperienceTelemetryModule {
    bindExperienceTelemetry() {
        const checkbox = document.getElementById('experience-consent');
        if (checkbox) checkbox.onchange = () => {
            ProductTelemetry.setConsent(checkbox.checked ? 'granted' : 'denied');
            this._soloWaitStarted = null;
            this._refreshExperienceTelemetry();
        };
        const button = document.getElementById('experience-export-btn');
        if (button) button.onclick = () => {
            if (ProductTelemetry.consent !== 'granted' || !ProductTelemetry.queue.length) {
                this.showToast(I18n.t('telemetry_empty')); return;
            }
            const blob = new Blob([JSON.stringify(ProductTelemetry.export(), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url; link.download = 'meh-experience.json';
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        this._refreshExperienceTelemetry();
    }

    _refreshExperienceTelemetry() {
        const checkbox = document.getElementById('experience-consent');
        if (checkbox) checkbox.checked = ProductTelemetry.consent === 'granted';
    }

    _measureSoloWait(stop = false) {
        if (typeof ProductTelemetry === 'undefined' || ProductTelemetry.consent !== 'granted') {
            this._soloWaitStarted = null; return;
        }
        const active = document.getElementById('game-screen');
        const ownDecision = this._decisionContext && this.players && this.players[0]
            && this._decisionContext.actorId === this.players[0].id;
        const waiting = !stop && !this.online && !this._practice && !this._localPaused
            && active && active.classList.contains('active') && !this.humanCanPlay && !ownDecision;
        const now = Date.now();
        if (waiting && this._soloWaitStarted == null) this._soloWaitStarted = now;
        else if (!waiting && this._soloWaitStarted != null) {
            const durationMs = Math.max(0, Math.min(3600000, now - this._soloWaitStarted));
            this._soloWaitStarted = null;
            if (durationMs) this._trackProductEvent('solo.control_wait', { durationMs });
        }
    }
}

const MehGameExperienceTelemetryMethods = MehGameExperienceTelemetryModule.prototype;
delete MehGameExperienceTelemetryMethods.constructor;
Object.freeze(MehGameExperienceTelemetryMethods);
