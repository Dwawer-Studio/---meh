'use strict';

class MehGamePacingModule {
    _pace(kind, legacy) {
        if (this.online) return legacy;
        const timings = { deal: 35, dealt: 160, bot: 380, skip: 460,
            forcedNotice: 520, drawn: 240, shield: 180, draw: 80,
            penaltyEnd: 280, extraTurn: 420, settle: 460, ordinary: 220 };
        return timings[kind] ?? legacy;
    }

    _scheduleTurn(callback, delay) {
        if (typeof callback !== 'function') return null;
        if (!this._turnTasks) this._turnTasks = new Set();
        const task = { callback, remaining: Math.max(0, delay), handle: null, due: null };
        this._turnTasks.add(task);
        this._armTurnTask(task);
        return task;
    }

    _armTurnTask(task) {
        if (this._localPaused && !this.online) return;
        task.due = Date.now() + task.remaining;
        task.handle = setTimeout(() => {
            if (!this._turnTasks || !this._turnTasks.delete(task)) return;
            task.callback();
        }, task.remaining);
    }

    _pauseLocalClock() {
        if (this.online || this._localPaused) return false;
        this._localPaused = true;
        for (const task of this._turnTasks || []) {
            task.remaining = Math.max(0, task.due - Date.now());
            clearTimeout(task.handle);
            task.handle = null;
        }
        return true;
    }

    _resumeLocalClock() {
        if (!this._localPaused || this.online) return false;
        this._localPaused = false;
        for (const task of this._turnTasks || []) this._armTurnTask(task);
        return true;
    }

    _cancelTurnWork() {
        for (const task of this._turnTasks || []) clearTimeout(task.handle);
        this._turnTasks = new Set();
        this._localPaused = false;
    }
}

const MehGamePacingMethods = MehGamePacingModule.prototype;
delete MehGamePacingMethods.constructor;
Object.freeze(MehGamePacingMethods);
