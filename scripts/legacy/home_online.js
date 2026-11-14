#!/usr/bin/env node
'use strict';

const { loadEnvProfile, buildGetRequest, fetchGet } = require('./common');

(async () => {
  const profile = loadEnvProfile();
  const request = buildGetRequest('home/online_users', profile, { start_pos: '0', num: '15', from_page: 'home' });
  const { summary, body } = await fetchGet(request);
  console.log(JSON.stringify(summary, null, 2));
  try { console.log(JSON.stringify(JSON.parse(body.toString('utf8')), null, 2)); }
  catch { console.log(body.toString('utf8')); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
