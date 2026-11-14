import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLitResponse, getAccountInfo, getOnlineUsers, getUserInfo, getUserMe } from '../src/lit/api.ts';
import { litResponse, PROFILE, withFetch } from './helpers.ts';
import sample from './fixtures/user-info-me.example.json' with { type: 'json' };
import type { LitApiResponse, OnlineUsersData, UserInfo, UserInfoMe, Wallet } from '../src/lit/types.ts';

test('typed self profile uses me without an ID and preserves real SIUA only', async () => {
  for (const siua of [undefined, PROFILE.siua]) {
    const { result, calls } = await withFetch(req => litResponse(req, sample), async () => {
      const response = await getUserMe({ profile: { ...PROFILE, userId: undefined, siua } });
      const typed: LitApiResponse<UserInfoMe> = response.response;
      assert.equal(typed.success, true);
      if (!typed.success) throw Error('Expected success');
      assert.equal(typed.data.user_id, sample.data.user_id);
      assert.equal(typed.data.huanxin.password, 'REDACTED');
      assert.equal(response.summary.request_id_matches, true);
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const req = calls[0]!;
    const url = new URL(req.url);
    assert.equal(url.pathname, '/api/sns/v1/lit/user/get_info/me');
    assert.equal(url.searchParams.get('from'), 'me');
    assert.equal(url.searchParams.get('source'), 'me');
    assert.equal(req.headers['lit-user-id'], undefined);
    assert.equal(req.headers['x-siua'], siua);
  }
});

test('typed user profile keeps caller ID separate from target ID', async () => {
  for (const userId of [undefined, PROFILE.userId, 'target_1']) {
    const data = { user_id: 'target_1', nickname: 'test', avatar: '', huanxin_id: 'love_1' };
    const { result, calls } = await withFetch(req => litResponse(req, { success: true, result: 0, data }), async () => {
      const { response } = await getUserInfo(data.user_id, { profile: { ...PROFILE, userId }, query: { source: 'home' } });
      const typed: LitApiResponse<UserInfo> = response;
      if (!typed.success) throw Error('Expected success');
      assert.equal(typed.data.user_id, data.user_id);
    });
    assert.equal(result.ok, true);
    assert.equal(calls[0]!.headers['lit-user-id'], userId === 'target_1' ? undefined : userId);
    assert.equal(new URL(calls[0]!.url).pathname, '/api/sns/v1/lit/user/get_info/target_1');
    assert.equal(new URL(calls[0]!.url).searchParams.get('source'), 'home');
  }
});

test('online users preserves the server cursor even when it is zero', async () => {
  const data: OnlineUsersData = { user_infos: [], has_next: true, next_start: 0 };
  const { result, calls } = await withFetch(req => litResponse(req, { success: true, result: 0, data }, { encrypted: false }), async () => {
    const { response } = await getOnlineUsers({ profile: PROFILE, query: { num: 3, start_pos: 7 } });
    const typed: LitApiResponse<OnlineUsersData> = response;
    if (!typed.success) throw Error('Expected success');
    assert.deepEqual(typed.data, data);
  });
  assert.equal(result.ok, true);
  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get('num'), '3');
  assert.equal(url.searchParams.get('start_pos'), '7');
  assert.equal(url.searchParams.get('from_page'), 'home');
});

test('account API returns typed wallet from encrypted response', async () => {
  const { result } = await withFetch(req => litResponse(req, { success: true, result: 0, data: sample.data.account_info }), async () => {
    const { response } = await getAccountInfo({ profile: PROFILE });
    const typed: LitApiResponse<Wallet> = response;
    if (!typed.success) throw Error('Expected success');
    assert.equal(typed.data.diamonds, sample.data.account_info.diamonds);
  });
  assert.equal(result.ok, true);
});

test('API rejection needs no successful payload and is not retried', async () => {
  const failure = { success: false, result: -15, message: 'restricted' };
  const { result, calls } = await withFetch(req => litResponse(req, failure), async () => {
    const { response } = await getUserMe({ profile: PROFILE });
    assert.deepEqual(response, failure);
    if (response.success) throw Error('Expected rejection');
    assert.equal(response.data, undefined);
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test('envelope rejects malformed JSON and inconsistent success', () => {
  assert.throws(() => decodeLitResponse(Buffer.from('<html>')), /not JSON/);
  assert.throws(() => decodeLitResponse(Buffer.from('<html>'), 503), /not JSON \(HTTP 503\)/);
  for (const body of [null, [], {}, { success: 'true', result: 0 }, { success: true, result: 0 },
    { success: true, result: -15, data: {} }, { success: true, result: 0, data: null },
    { success: false, result: 1.5 }, { success: false, result: -1, message: {} }, { success: false, result: -1, trace_id: 7 }]) {
    assert.throws(() => decodeLitResponse(Buffer.from(JSON.stringify(body))));
  }
});

test('envelope accepts null message / trace_id, as the server sends them', () => {
  for (const body of [
    { success: false, result: -15, message: null },
    { success: false, result: -15, message: null, trace_id: null },
    { success: true, result: 0, data: {}, message: null, trace_id: null },
  ]) {
    assert.deepEqual(decodeLitResponse(Buffer.from(JSON.stringify(body))), body);
  }
});

test('rejection with null message comes back as a typed failure with its result code', async () => {
  const failure = { success: false, result: -15, message: null, trace_id: null };
  const { result } = await withFetch(req => litResponse(req, failure), async () => {
    const { response } = await getUserMe({ profile: PROFILE });
    if (response.success) throw Error('Expected rejection');
    assert.equal(response.result, -15);
    assert.equal(response.message, null);
  });
  assert.equal(result.ok, true);
});

test('success requires HTTP 2xx, like isLitAccepted and the Rust backend', async () => {
  // Non-2xx bodies are not decrypted by the client, so serve plaintext JSON.
  const success = { success: true, result: 0, data: sample.data.account_info };
  const rejected = await withFetch(req => litResponse(req, success, { encrypted: false, status: 500 }),
    () => getAccountInfo({ profile: PROFILE }));
  assert.deepEqual(rejected.result, { ok: false, error: 'API reported success with HTTP 500, result 0' });
  assert.throws(() => decodeLitResponse(Buffer.from(JSON.stringify(success)), 302), /HTTP 302/);

  // A non-2xx rejection keeps its result code.
  const failure = { success: false, result: 1012, message: 'busy' };
  const { result } = await withFetch(req => litResponse(req, failure, { encrypted: false, status: 503 }), async () => {
    const { response, summary } = await getAccountInfo({ profile: PROFILE });
    assert.equal(summary.http_status, 503);
    assert.deepEqual(response, failure);
  });
  assert.equal(result.ok, true);
});

test('invalid targets and pagination reject (never throw synchronously) before fetch', async () => {
  const { result, calls } = await withFetch(() => { throw Error('Unexpected network request'); }, async () => {
    // Called directly, not wrapped: a synchronous throw here would fail the test.
    for (const id of ['../other', '', 'bad id', 'a'.repeat(129)]) {
      const pending = getUserInfo(id, { profile: PROFILE });
      assert.ok(pending instanceof Promise);
      await assert.rejects(pending, /user_id không hợp lệ/);
    }
    for (const query of [{ num: 0 }, { num: 1.5 }, { num: 51 }, { start_pos: -1 }, { start_pos: Infinity },
      { start_pos: 10_001 }, { from_page: '' }]) {
      const pending = getOnlineUsers({ profile: PROFILE, query });
      assert.ok(pending instanceof Promise);
      await assert.rejects(pending);
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
});

test('page and ID limits match the Rust backend (inclusive)', async () => {
  const data: OnlineUsersData = { user_infos: [], has_next: false, next_start: 0 };
  const { result, calls } = await withFetch(req => litResponse(req, { success: true, result: 0, data }), async () => {
    await getOnlineUsers({ profile: PROFILE, query: { num: 50, start_pos: 10_000 } });
    const user = { user_id: 'a'.repeat(128), nickname: '', avatar: '', huanxin_id: 'x' };
    await getUserInfo(user.user_id, { profile: PROFILE });
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
});

test('a missing .env profile rejects instead of throwing synchronously', async () => {
  // helpers.ts points SCRIPTS_ENV_FILE at a missing file and clears LIT_* variables.
  for (const call of [() => getUserMe(), () => getUserInfo('abc'), () => getOnlineUsers(), () => getAccountInfo()]) {
    const pending = call();
    assert.ok(pending instanceof Promise);
    await assert.rejects(pending, /LIT_SID/);
  }
});
