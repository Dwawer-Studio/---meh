/* ============================================================
   net.js — طبقة الاتصال للّعب الجماعي عبر PeerJS (بلا خادم)
   - Net.host(cb)      : أنشئ غرفة، cb يستقبل كود الغرفة
   - Net.join(code,cb) : ادخل غرفة بالكود
   - Net.broadcast(msg): المضيف يرسل للجميع
   - Net.send(msg)     : العميل يرسل للمضيف
   أحداث (عيّنها من الخارج):
   - Net.onPlayerJoin(conn) / onPlayerLeave(conn) / onData(msg, conn)
   - Net.onError(err)
   ============================================================ */

const Net = {
    peer: null,
    conns: [],        // المضيف: اتصالات العملاء
    hostConn: null,   // العميل: الاتصال بالمضيف
    isHost: false,
    roomCode: null,
    _disconnecting: new WeakSet(),
    _epoch: 0,
    _connecting: false,
    _everConnected: false,
    _dataReconnectAttempts: 0,
    _dataReconnectTimer: null,
    _signalReconnectTimer: null,
    _maxReconnectAttempts: 6,
    _initialConnectCallback: null,

    onPlayerJoin: null,
    onPlayerLeave: null,
    onData: null,
    onError: null,
    onReconnecting: null,
    onReconnect: null,
    onSignalReconnect: null,

    available() { return typeof Peer !== 'undefined'; },

    _genCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا أحرف ملتبسة
        let c = '';
        for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
        return c;
    },

    _peerId(code) { return 'meh-game-' + code; },

    _validCode(code) {
        return typeof code === 'string' && /^[A-HJ-NP-Z2-9]{5}$/.test(code);
    },

    _active(peer, epoch) {
        return this.peer === peer && this._epoch === epoch;
    },

    _clearReconnectTimers() {
        if (this._dataReconnectTimer) clearTimeout(this._dataReconnectTimer);
        if (this._signalReconnectTimer) clearTimeout(this._signalReconnectTimer);
        this._dataReconnectTimer = null;
        this._signalReconnectTimer = null;
    },

    _beginSession(isHost, roomCode) {
        const oldPeer = this.peer;
        this._epoch++;
        this._clearReconnectTimers();
        this.peer = null;
        this.conns = [];
        this.hostConn = null;
        this._disconnecting = new WeakSet();
        this._connecting = false;
        this._everConnected = false;
        this._dataReconnectAttempts = 0;
        this._initialConnectCallback = null;
        this.isHost = isHost;
        this.roomCode = roomCode;
        try { if (oldPeer) oldPeer.destroy(); } catch (e) {}
        return this._epoch;
    },

    _scheduleSignalReconnect(peer, epoch) {
        if (!this._active(peer, epoch) || this._signalReconnectTimer || peer.destroyed) return;
        this.onReconnecting && this.onReconnecting({ kind: 'signal' });
        this._signalReconnectTimer = true;
        const timer = setTimeout(() => {
            this._signalReconnectTimer = null;
            if (!this._active(peer, epoch) || peer.destroyed || !peer.disconnected) return;
            try { peer.reconnect(); } catch (error) {
                this.onError && this.onError({ type: 'reconnect-failed', error });
            }
        }, 500);
        if (this._signalReconnectTimer === true) this._signalReconnectTimer = timer;
    },

    _bindPeerLifecycle(peer, epoch, onOpen) {
        let opened = false;
        peer.on('open', () => {
            if (!this._active(peer, epoch)) return;
            const recovered = opened;
            opened = true;
            if (this._signalReconnectTimer) clearTimeout(this._signalReconnectTimer);
            this._signalReconnectTimer = null;
            onOpen(recovered);
            if (recovered) this.onSignalReconnect && this.onSignalReconnect();
        });
        peer.on('disconnected', () => this._scheduleSignalReconnect(peer, epoch));
        peer.on('error', (error) => {
            if (!this._active(peer, epoch)) return;
            this.onError && this.onError(error);
            if (!this.isHost && error && error.type === 'peer-unavailable' && this._connecting) {
                const failedConnection = this.hostConn;
                this.hostConn = null;
                this._connecting = false;
                try { if (failedConnection) failedConnection.close(); } catch (e) {}
                this._scheduleDataReconnect(peer, epoch, this._initialConnectCallback);
            }
            if (peer.disconnected && !peer.destroyed) this._scheduleSignalReconnect(peer, epoch);
        });
        peer.on('close', () => {
            if (this._active(peer, epoch)) this.onError && this.onError({ type: 'reconnect-failed' });
        });
    },

    // ===== المضيف =====
    host(cb) {
        if (!this.available()) { this.onError && this.onError({ type: 'no-lib' }); return; }
        const code = this._genCode();
        const epoch = this._beginSession(true, code);
        const peer = new Peer(this._peerId(code));
        this.peer = peer;

        this._bindPeerLifecycle(peer, epoch, (recovered) => {
            if (!recovered) cb && cb(code);
        });

        peer.on('connection', (conn) => {
            if (!this._active(peer, epoch)) { try { conn.close(); } catch (e) {} return; }
            let closed = false;
            conn.on('open', () => {
                if (!this._active(peer, epoch) || closed) { try { conn.close(); } catch (e) {} return; }
                if (this.conns.includes(conn)) return;
                this.conns.push(conn);
                this.onPlayerJoin && this.onPlayerJoin(conn);
            });
            conn.on('data', (d) => {
                if (this._active(peer, epoch) && !closed) this.onData && this.onData(d, conn);
            });
            conn.on('close', () => {
                if (!this._active(peer, epoch) || closed) return;
                closed = true;
                this.conns = this.conns.filter(c => c !== conn);
                this.onPlayerLeave && this.onPlayerLeave(conn);
            });
            conn.on('error', (error) => {
                if (this._active(peer, epoch)) this.onError && this.onError(error);
            });
        });
    },

    // ===== العميل =====
    join(code, cb) {
        if (!this.available()) { this.onError && this.onError({ type: 'no-lib' }); return; }
        if (!this._validCode(code)) { this.onError && this.onError({ type: 'invalid-code' }); return; }
        const epoch = this._beginSession(false, code);
        this._initialConnectCallback = cb;
        const peer = new Peer();
        this.peer = peer;

        this._bindPeerLifecycle(peer, epoch, () => {
            this._connectToHost(peer, epoch, cb);
        });
    },

    _connectToHost(peer, epoch, initialCallback) {
        if (!this._active(peer, epoch) || this.isHost || this._connecting) return;
        if (this.hostConn && this.hostConn.open) return;
        this._connecting = true;
        let conn;
        try {
            conn = peer.connect(this._peerId(this.roomCode), { reliable: true });
        } catch (error) {
            this._connecting = false;
            this.onError && this.onError(error);
            this._scheduleDataReconnect(peer, epoch, initialCallback);
            return;
        }
        this.hostConn = conn;
        let closed = false;
        conn.on('open', () => {
            if (!this._active(peer, epoch) || closed) { try { conn.close(); } catch (e) {} return; }
            this._connecting = false;
            this.hostConn = conn;
            this._dataReconnectAttempts = 0;
            if (this._dataReconnectTimer) clearTimeout(this._dataReconnectTimer);
            this._dataReconnectTimer = null;
            if (this._everConnected) this.onReconnect && this.onReconnect(conn);
            else {
                this._everConnected = true;
                initialCallback && initialCallback(conn);
            }
        });
        conn.on('data', (data) => {
            if (this._active(peer, epoch) && !closed && this.hostConn === conn) {
                this.onData && this.onData(data, conn);
            }
        });
        conn.on('close', () => {
            if (!this._active(peer, epoch) || closed) return;
            closed = true;
            if (this.hostConn === conn) this.hostConn = null;
            this._connecting = false;
            this.onPlayerLeave && this.onPlayerLeave(conn);
            this._scheduleDataReconnect(peer, epoch, initialCallback);
        });
        conn.on('error', (error) => {
            if (!this._active(peer, epoch) || closed) return;
            this.onError && this.onError(error);
        });
    },

    _scheduleDataReconnect(peer, epoch, initialCallback) {
        if (!this._active(peer, epoch) || this.isHost || this._dataReconnectTimer || this._connecting) return;
        if (this.hostConn && this.hostConn.open) return;
        if (this._dataReconnectAttempts >= this._maxReconnectAttempts) {
            this.onError && this.onError({ type: 'reconnect-failed' });
            return;
        }
        const attempt = ++this._dataReconnectAttempts;
        this.onReconnecting && this.onReconnecting({
            kind: 'data',
            attempt,
            maxAttempts: this._maxReconnectAttempts,
        });
        const delay = Math.min(4000, 300 * (2 ** (attempt - 1)));
        this._dataReconnectTimer = true;
        const timer = setTimeout(() => {
            this._dataReconnectTimer = null;
            if (!this._active(peer, epoch)) return;
            if (peer.disconnected && !peer.destroyed) {
                this._scheduleSignalReconnect(peer, epoch);
                this._scheduleDataReconnect(peer, epoch, initialCallback);
                return;
            }
            this._connectToHost(peer, epoch, initialCallback);
        }, delay);
        if (this._dataReconnectTimer === true) this._dataReconnectTimer = timer;
    },

    // ===== إرسال =====
    broadcast(msg) {
        this.conns.forEach(c => {
            if (!c.open) return;
            try { c.send(msg); } catch (e) {}
        });
    },
    // المضيف يرسل لعميل محدد
    sendTo(conn, msg) {
        if (conn && conn.open) {
            try { conn.send(msg); } catch (e) {}
        }
    },
    // العميل يرسل للمضيف
    send(msg) {
        if (this.hostConn && this.hostConn.open) {
            try { this.hostConn.send(msg); } catch (e) {}
        }
    },

    // المضيف يزيل اتصالاً غير مقبول فوراً من قائمة البث، ثم يغلقه بعد منح
    // رسالة الرفض زمناً قصيراً للوصول إلى العميل.
    disconnect(conn) {
        if (!conn) return;
        if (this._disconnecting.has(conn)) return;
        this._disconnecting.add(conn);
        this.conns = this.conns.filter(c => c !== conn);
        setTimeout(() => {
            try { conn.close(); } catch (e) {}
        }, 60);
    },

    // ===== إنهاء =====
    close() {
        const peer = this.peer;
        const connections = [...this.conns, this.hostConn].filter(Boolean);
        this._epoch++;
        this._clearReconnectTimers();
        this.peer = null; this.conns = []; this.hostConn = null;
        this._connecting = false; this._everConnected = false; this._dataReconnectAttempts = 0;
        this._initialConnectCallback = null;
        this._disconnecting = new WeakSet();
        this.isHost = false; this.roomCode = null;
        connections.forEach(conn => { try { conn.close(); } catch (e) {} });
        try { if (peer) peer.destroy(); } catch (e) {}
    },
};

window.Net = Net;
