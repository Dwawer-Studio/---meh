'use strict';

const test = require('node:test');

// تتحول هذه البنود إلى اختبارات فعلية عند بدء المرحلة المسؤولة عنها.
test.todo('SEC-01: untrusted lobby and card data never reaches innerHTML');
test.todo('NET-01: an invalid remote action cannot cancel the active turn timeout');
test.todo('NET-02: stale prompt responses cannot resolve a newer prompt');
test.todo('NET-03: a fifth player and late joins are rejected cleanly');
test.todo('RULE-01: the 60-card conservation invariant holds after every effect');
test.todo('RULE-02: every card effect is identical for bot, host, and remote players');
test.todo('PLATFORM-01: blocked localStorage never prevents the app from starting');
test.todo('PLATFORM-02: Wake Lock keeps at most one live sentinel and always releases it');
test.todo('A11Y-01: a full human turn can be completed using only the keyboard');
