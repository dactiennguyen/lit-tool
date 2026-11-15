import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendLuhnCheckDigit, CARRIER_PRESETS, DEVICE_PRESETS, FIELDS, randomizeAll, randomizeField } from '../src/cli/device-random.ts';
import { runNode } from './helpers.ts';

function validLuhn(value: string): boolean {
  return [...value].reverse().reduce((sum, digit, index) => {
    const n = Number(digit) * (index % 2 ? 2 : 1);
    return sum + Math.floor(n / 10) + n % 10;
  }, 0) % 10 === 0;
}

test('Luhn matches published example numbers and rejects non-digits', () => {
  assert.equal(appendLuhnCheckDigit('49015420323751'), '490154203237518');
  assert.equal(appendLuhnCheckDigit('7992739871'), '79927398713');
  assert.equal(appendLuhnCheckDigit('0'), '00');
  for (const bad of ['', '12x', '123\n', '-1']) assert.throws(() => appendLuhnCheckDigit(bad));
});

test('random-all keeps model/carrier groups consistent and all 18 fields valid', () => {
  for (let i = 0; i < 300; i++) {
    const v = randomizeAll();
    assert.deepEqual(Object.keys(v).sort(), [...FIELDS].sort());
    assert.ok(DEVICE_PRESETS.some(row => row[0] === v.brand && row[1] === v.manufacturer && row[2] === v.model));
    const carrier = CARRIER_PRESETS.find(row => row[0] === v.sim_operator);
    assert.ok(carrier);
    assert.equal(v.sim_operator_name, carrier[1]);
    assert.equal(v.sim_country, carrier[2]);
    assert.match(v.imei, /^35[0-9]{13}$/);
    assert.ok(validLuhn(v.imei));
    assert.match(v.sim_serial, /^89[0-9]{17}$/);
    assert.ok(validLuhn(v.sim_serial));
    assert.match(v.serial, /^[0-9A-HJ-NP-Z]{12}$/);
    assert.match(v.android_id, /^[0-9a-f]{16}$/);
    assert.match(v.advertising_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(v.media_drm, /^[0-9a-f]{64}$/);
    for (const k of ['wifi_mac', 'bssid', 'bt_mac'] as const) {
      assert.match(v[k], k === 'bt_mac' ? /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/ : /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/);
      assert.equal(parseInt(v[k].slice(0, 2), 16) & 3, 0);
    }
    assert.match(v.ssid, /^(TP-Link|NETGEAR|Linksys|ASUS|DIRECT|HomeWiFi|Tenda|dlink)_[0-9A-F]{4}$/);
    assert.match(v.sub_id, /^[0-9]{15}$/);
    assert.ok(v.sub_id.startsWith(v.sim_operator));
    assert.match(v.mobile_no, new RegExp('^\\+' + carrier[3] + '[2-9][0-9]{9}$'));
  }
});

test('single-field randomization returns the same grouped updates as the app', () => {
  for (const field of FIELDS) {
    const result = randomizeField(field);
    const keys = ['brand', 'manufacturer', 'model'].includes(field) ? ['brand', 'manufacturer', 'model'] :
      ['sim_operator', 'sim_operator_name', 'sim_country'].includes(field) ? ['sim_operator', 'sim_operator_name', 'sim_country'] : [field];
    assert.deepEqual(Object.keys(result).sort(), keys.sort());
  }
  assert.throws(() => randomizeField('hardware' as never));
});

test('IMSI accepts any 5/6-digit operator; phone uses known country codes or a preset fallback', () => {
  for (const row of CARRIER_PRESETS) {
    assert.ok(randomizeField('sub_id', row[0]).sub_id!.startsWith(row[0]));
    assert.match(randomizeField('mobile_no', row[0]).mobile_no!, new RegExp('^\\+' + row[3] + '[2-9][0-9]{9}$'));
  }
  for (const custom of ['99999', '999999']) {
    assert.ok(randomizeField('sub_id', custom).sub_id!.startsWith(custom));
  }
  for (const invalid of ['', '123', 'abcdef', '99999\n', '1234567']) {
    const imsi = randomizeField('sub_id', invalid).sub_id!;
    assert.equal(imsi.length, 15);
    assert.ok(CARRIER_PRESETS.some(row => imsi.startsWith(row[0])));
  }
  assert.match(randomizeField('mobile_no', '99999').mobile_no!, /^\+(1|44|49|33|39|91|61)[2-9][0-9]{9}$/);
});

test('device-random CLI prints JSON and validates options', async () => {
  const all = await runNode(['src/cli/device-random.ts']);
  assert.equal(all.code, 0, all.stderr);
  assert.equal(Object.keys(JSON.parse(all.stdout)).length, 18);
  const model = await runNode(['src/cli/device-random.ts', '--field', 'model']);
  assert.equal(model.code, 0, model.stderr);
  assert.deepEqual(Object.keys(JSON.parse(model.stdout)).sort(), ['brand', 'manufacturer', 'model']);
  const imsi = await runNode(['src/cli/device-random.ts', '--field', 'sub_id', '--operator', '99999']);
  assert.equal(imsi.code, 0, imsi.stderr);
  assert.match(JSON.parse(imsi.stdout).sub_id, /^99999[0-9]{10}$/);
  for (const args of [['--field', 'hardware'], ['--field'], ['--operator', '310260'], ['--field', 'model', '--operator', '310260']]) {
    const bad = await runNode(['src/cli/device-random.ts', ...args]);
    assert.notEqual(bad.code, 0);
    assert.equal(bad.stdout, '');
  }
});

test('importing the combined module does not execute the CLI', async () => {
  const result = await runNode(['--input-type=module', '-e',
    "await import('./src/cli/device-random.ts');", '--', '--field', 'invalid']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
