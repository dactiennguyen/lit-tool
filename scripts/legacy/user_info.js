#!/usr/bin/env node
'use strict';

const { loadEnvProfile, buildGetRequest, fetchGet } = require('./common');

const DEFAULT_ID = '69809f293893a66708d442da';

(async () => {
  const profile = loadEnvProfile();
  const targetId = process.argv[2] || DEFAULT_ID;
  if (!/^[A-Za-z0-9_-]+$/.test(targetId)) throw Error('user_id không hợp lệ');

  const request = buildGetRequest('user/get_info/:id', { ...profile, userId: targetId }, {});

  if (profile.userId && profile.userId !== targetId) request.headers['lit-user-id'] = profile.userId;
  else delete request.headers['lit-user-id'];

  const { summary, body } = await fetchGet(request);
  console.log(JSON.stringify(summary, null, 2));
  try { console.log(JSON.stringify(JSON.parse(body.toString('utf8')), null, 2)); }
  catch { console.log(body.toString('utf8')); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
