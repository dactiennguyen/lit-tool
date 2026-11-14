import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { getFeedPageStructure, getForYouFeeds, getPopularFeeds } from '../src/lit/api.ts';
import type { FeedListData, FeedPageStructure, ForYouFeedType } from '../src/lit/types.ts';
import { litResponse, PROFILE, withFetch } from './helpers.ts';

test('feed structure keeps server labels and nesting', async () => {
  const data: FeedPageStructure = { pages: [{
    name: 'Foryou', translate_name: 'Gợi ý', priority: 1, special: false,
    sub_pages: [{ name: 'Trends', translate_name: 'Phổ biến', priority: 10, special: true, sub_pages: [] }],
  }] };
  const { result, calls } = await withFetch(req => litResponse(req, { success: true, result: 0, data }), async () => {
    const r = await getFeedPageStructure({ profile: PROFILE });
    if (!r.response.success) throw Error('Expected success');
    assert.deepEqual(r.response.data, data);
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, '/api/sns/v1/lit/feed/feed_page_structure');
  assert.equal(url.searchParams.has('start_pos'), false);
});

test('popular and default For You use hq, Associate uses its separate feed endpoint', async () => {
  for (const [fn, path] of [
    [() => getPopularFeeds({ profile: PROFILE }), 'feed/hq'],
    [() => getForYouFeeds({ profile: PROFILE }), 'feed/hq'],
    [() => getForYouFeeds({ profile: PROFILE, type: 'Associate' }), 'feed/sep_page_feeds/Associate'],
  ] as const) {
    const { result, calls } = await withFetch(req => litResponse(req, {
      success: true, result: 0, data: { feeds: [], next_start: 0, has_next: false },
    }), fn);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const req = calls[0]!;
    const url = new URL(req.url);
    assert.equal(url.pathname, '/api/sns/v1/lit/' + path);
    assert.equal(url.searchParams.get('start_pos'), '0');
    assert.equal(url.searchParams.get('num'), '20');
    assert.equal(req.method, 'GET');
    assert.equal(req.headers['lit-user-id'], PROFILE.userId);
    assert.equal(req.headers['x-dfpid'], PROFILE.dfpid);
  }
});

test('feed pagination preserves server cursor and extra fields without clipping the batch', async () => {
  const data: FeedListData = {
    feeds: Array.from({ length: 10 }, (_, i) => ({ id: `post-${i}`, content: 'Example', custom_field: i })),
    next_start: 1, has_next: true, pinned: null,
  };
  const { result, calls } = await withFetch(req => litResponse(req, { success: true, result: 0, data }), async () => {
    const r = await getPopularFeeds({ profile: PROFILE, query: { num: 2 } });
    if (!r.response.success) throw Error('Expected success');
    assert.equal(r.response.data.feeds.length, 10);
    assert.deepEqual(r.response.data, data);
    assert.equal(r.summary.request_id_matches, true);
    await getPopularFeeds({ profile: PROFILE, query: { start_pos: r.response.data.next_start, num: 2 } });
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]!.url).searchParams.get('start_pos'), '1');
});

test('invalid feed type and paging fail before any request', async () => {
  const { result, calls } = await withFetch(() => { throw Error('Must not fetch'); }, async () => {
    for (const type of ['Foryou', '../user/get_info/me', 'Nearby']) {
      await assert.rejects(getForYouFeeds({ profile: PROFILE, type: type as ForYouFeedType }), /Feed type/);
    }
    for (const query of [{ start_pos: -1 }, { start_pos: 0.5 }, { start_pos: 2_147_483_648 },
      { num: 0 }, { num: 51 }, { num: NaN }]) {
      await assert.rejects(getForYouFeeds({ profile: PROFILE, query }), /must be an integer/);
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
});

test('feed API preserves a session rejection without retrying', async () => {
  const failure = { success: false, result: -10, message: null };
  const { result, calls } = await withFetch(req => litResponse(req, failure), async () => {
    const r = await getForYouFeeds({ profile: PROFILE, type: 'Associate' });
    assert.deepEqual(r.response, failure);
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test('feed CLI has help and rejects invalid modes/options before loading a profile', () => {
  const entry = new URL('../feed.js', import.meta.url);
  const run = (args: string[]) => spawnSync(process.execPath, [entry.pathname, ...args], {
    encoding: 'utf8', env: { ...process.env, SCRIPTS_ENV_FILE: '/nonexistent/feed-test-env' },
  });
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /structure\|popular\|recommended\|associate/);
  for (const args of [['invalid'], ['popular', 'extra'], ['structure', '--num', '2'], ['popular', '--num', '0']]) {
    const r = run(args);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stderr, /LIT_SID/);
  }
});
