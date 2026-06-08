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

    onPlayerJoin: null,
    onPlayerLeave: null,
    onData: null,
    onError: null,

    available() { return typeof Peer !== 'undefined'; },

    _genCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا أحرف ملتبسة
        let c = '';
        for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
        return c;
    },

    _peerId(code) { return 'meh-game-' + code; },

    // ===== المضيف =====
    host(cb) {
        if (!this.available()) { this.onError && this.onError({ type: 'no-lib' }); return; }
        this.isHost = true;
        this.conns = [];
        this.roomCode = this._genCode();
        this.peer = new Peer(this._peerId(this.roomCode));

        this.peer.on('open', () => { cb && cb(this.roomCode); });

        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                this.conns.push(conn);
                this.onPlayerJoin && this.onPlayerJoin(conn);
            });
            conn.on('data', (d) => this.onData && this.onData(d, conn));
            conn.on('close', () => {
                this.conns = this.conns.filter(c => c !== conn);
                this.onPlayerLeave && this.onPlayerLeave(conn);
            });
        });

        this.peer.on('error', (e) => this.onError && this.onError(e));
    },

    // ===== العميل =====
    join(code, cb) {
        if (!this.available()) { this.onError && this.onError({ type: 'no-lib' }); return; }
        this.isHost = false;
        this.roomCode = code;
        this.peer = new Peer();

        this.peer.on('open', () => {
            const conn = this.peer.connect(this._peerId(code), { reliable: true });
            this.hostConn = conn;
            conn.on('open', () => {
                cb && cb();
            });
            conn.on('data', (d) => this.onData && this.onData(d, conn));
            conn.on('close', () => this.onPlayerLeave && this.onPlayerLeave(conn));
            conn.on('error', (e) => this.onError && this.onError(e));
        });

        this.peer.on('error', (e) => this.onError && this.onError(e));
    },

    // ===== إرسال =====
    broadcast(msg) {
        this.conns.forEach(c => { if (c.open) c.send(msg); });
    },
    // المضيف يرسل لعميل محدد
    sendTo(conn, msg) {
        if (conn && conn.open) conn.send(msg);
    },
    // العميل يرسل للمضيف
    send(msg) {
        if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
    },

    // ===== إنهاء =====
    close() {
        try { if (this.peer) this.peer.destroy(); } catch (e) {}
        this.peer = null; this.conns = []; this.hostConn = null;
        this.isHost = false; this.roomCode = null;
    },
};

window.Net = Net;
