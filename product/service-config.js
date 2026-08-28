'use strict';

// Deployments set MEH_SERVICE_URL before this file. Local development opts in
// explicitly with ?service=local so PeerJS fallback and its tests stay isolated.
const localServiceRequested = new URLSearchParams(window.location.search).get('service') === 'local';
if (!window.MEH_SERVICE_URL && localServiceRequested
    && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    window.MEH_SERVICE_URL = 'ws://127.0.0.1:8787/v1/realtime';
    window.MEH_SERVICE_HTTP_URL = 'http://127.0.0.1:8787';
}
