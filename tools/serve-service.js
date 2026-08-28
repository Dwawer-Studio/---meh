'use strict';

const crypto = require('node:crypto');

if (process.env.NODE_ENV === 'production') {
    throw new Error('The development launcher cannot run in production');
}
if (!process.env.MEH_APP_SECRET) process.env.MEH_APP_SECRET = crypto.randomBytes(32).toString('base64url');
require('../server/start').main();
