import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToyGift, UserInfoMe, UserInfoMeResponse } from '../src/lit/types.ts';
import sample from './fixtures/user-info-me.example.json' with { type: 'json' };

// Compile-time check: `npm run typecheck` fails if the types drift from the
// (anonymised) real response.
const typed = { ...sample, success: true, result: 0 } satisfies UserInfoMeResponse;

// The assignment above catches fields missing from the sample. These catch the
// reverse: a key present in the response but not declared in the type. On
// failure the error message names the undeclared key(s).
type Undeclared<Sample, Declared> = Exclude<keyof Sample, keyof Declared>;
type MustBeEmpty<K> = [K] extends [never] ? true : K;
const noUndeclaredProfileKeys: MustBeEmpty<Undeclared<typeof sample.data, UserInfoMe>> = true;
const noUndeclaredToyKeys: MustBeEmpty<Undeclared<(typeof sample.data.toys.gifts)[number], ToyGift>> = true;

test('user/get_info/me fixture matches the declared type', () => {
  assert.equal(sample.success, true);
  assert.equal(sample.result, 0);
  assert.equal(typed.success, true);
  assert.equal(typed.result, 0);
  assert.equal(typed.data.toys.gifts[0]?.resource_level_info.name, 'SSR');
  assert.ok(noUndeclaredProfileKeys && noUndeclaredToyKeys);
});

test('fixture contains no real secrets', () => {
  assert.equal(typed.data.session, 'REDACTED');
  assert.equal(typed.data.huanxin.password, 'REDACTED');
});
