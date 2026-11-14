#!/usr/bin/env node
'use strict';

const { loadEnvProfile, buildGetRequest, fetchGet } = require('./common');

(async () => {
  const profile = loadEnvProfile();
  const request = buildGetRequest('account/account_info', profile, {});
  const { summary, body } = await fetchGet(request);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.success) {
    try { console.log(JSON.stringify(JSON.parse(body.toString('utf8')), null, 2)); } catch {                            }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
