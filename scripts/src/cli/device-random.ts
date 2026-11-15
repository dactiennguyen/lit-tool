import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { printJson, runCli } from '../core/cli.ts';

export const DEVICE_PRESETS = [
  ['google', 'Google', 'Pixel 7'],
  ['google', 'Google', 'Pixel 6a'],
  ['google', 'Google', 'Pixel 8 Pro'],
  ['samsung', 'samsung', 'SM-S918B'],
  ['samsung', 'samsung', 'SM-A546B'],
  ['samsung', 'samsung', 'SM-G991B'],
  ['OnePlus', 'OnePlus', 'CPH2449'],
  ['Xiaomi', 'Xiaomi', '2201123G'],
  ['Redmi', 'Xiaomi', '23021RAAEG'],
  ['motorola', 'motorola', 'moto g84 5G'],
  ['Nokia', 'HMD Global', 'Nokia G42 5G'],
] as const;

export const CARRIER_PRESETS = [
  ['310260', 'T-Mobile', 'us', '1'],
  ['310410', 'AT&T', 'us', '1'],
  ['311480', 'Verizon', 'us', '1'],
  ['302720', 'Rogers', 'ca', '1'],
  ['23415', 'Vodafone UK', 'gb', '44'],
  ['23410', 'O2 - UK', 'gb', '44'],
  ['26201', 'Telekom.de', 'de', '49'],
  ['20801', 'Orange F', 'fr', '33'],
  ['22210', 'Vodafone IT', 'it', '39'],
  ['40445', 'Airtel', 'in', '91'],
  ['50501', 'Telstra', 'au', '61'],
] as const;

const SSID_PREFIXES = ['TP-Link', 'NETGEAR', 'Linksys', 'ASUS', 'DIRECT', 'HomeWiFi', 'Tenda', 'dlink'] as const;
const DIGITS = '0123456789';
const HEX = '0123456789abcdef';

export const FIELDS = [
  'imei', 'serial', 'android_id', 'advertising_id', 'media_drm',
  'brand', 'manufacturer', 'model', 'wifi_mac', 'bssid', 'ssid', 'bt_mac',
  'sim_serial', 'sub_id', 'mobile_no', 'sim_operator', 'sim_operator_name', 'sim_country',
] as const;

export type DeviceField = typeof FIELDS[number];
export type DeviceIdentity = Record<DeviceField, string>;

function pick<T>(values: readonly T[]): T {
  return values[randomInt(values.length)]!;
}

function characters(alphabet: string, length: number): string {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]!).join('');
}

export function appendLuhnCheckDigit(digits: string): string {
  if (!digits || /[^0-9]/.test(digits)) throw Error('Luhn input must contain only digits');
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits + ((10 - sum % 10) % 10);
}

function mac(): string {
  const bytes = randomBytes(6);
  bytes[0] = bytes[0]! & 0xfc;
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(':');
}

function modelGroup(): Pick<DeviceIdentity, 'brand' | 'manufacturer' | 'model'> {
  const [brand, manufacturer, model] = pick(DEVICE_PRESETS);
  return { brand, manufacturer, model };
}

function carrierGroup(): Pick<DeviceIdentity, 'sim_operator' | 'sim_operator_name' | 'sim_country'> {
  const [sim_operator, sim_operator_name, sim_country] = pick(CARRIER_PRESETS);
  return { sim_operator, sim_operator_name, sim_country };
}

export function randomizeField(field: DeviceField, operator = ''): Partial<DeviceIdentity> {
  let value: string;
  switch (field) {
    case 'brand':
    case 'manufacturer':
    case 'model': return modelGroup();
    case 'sim_operator':
    case 'sim_operator_name':
    case 'sim_country': return carrierGroup();
    case 'imei': value = appendLuhnCheckDigit('35' + characters(DIGITS, 12)); break;
    case 'serial': value = characters('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 12); break;
    case 'android_id': value = characters(HEX, 16); break;
    case 'advertising_id': value = randomUUID(); break;
    case 'media_drm': value = characters(HEX, 64); break;
    case 'wifi_mac':
    case 'bssid': value = mac(); break;
    case 'bt_mac': value = mac().toUpperCase(); break;
    case 'ssid': value = pick(SSID_PREFIXES) + '_' + characters(HEX, 4).toUpperCase(); break;
    case 'sim_serial': value = appendLuhnCheckDigit('89' + characters(DIGITS, 16)); break;
    case 'sub_id': {
      const valid = operator.length >= 5 && operator.length <= 6 && !/[^0-9]/.test(operator);
      const prefix = valid ? operator : pick(CARRIER_PRESETS)[0];
      value = prefix + characters(DIGITS, 15 - prefix.length);
      break;
    }
    case 'mobile_no': {
      const carrier = CARRIER_PRESETS.find(row => row[0] === operator) ?? pick(CARRIER_PRESETS);
      value = '+' + carrier[3] + (randomInt(8) + 2) + characters(DIGITS, 9);
      break;
    }
    default: throw Error('Unknown device field');
  }
  return { [field]: value };
}

export function randomizeAll(androidId?: string): DeviceIdentity {
  if (androidId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(androidId)) throw Error('Invalid existing Android ID');
  const values: Partial<DeviceIdentity> = { ...carrierGroup(), ...modelGroup(),
    ...(androidId !== undefined ? { android_id: androidId } : {}) };
  for (const field of FIELDS) {
    if (!Object.hasOwn(values, field)) Object.assign(values, randomizeField(field, values.sim_operator));
  }
  return values as DeviceIdentity;
}

const USAGE = 'Usage: npm run device:random -- [--field <name> [--operator <MCCMNC>]]\nFields: ' + FIELDS.join(', ');

if (import.meta.main) runCli(() => {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') return console.log(USAGE);
  if (args.length === 0) return printJson(randomizeAll(), true);
  if (![2, 4].includes(args.length) || args[0] !== '--field' || !FIELDS.includes(args[1] as DeviceField) ||
      (args.length === 4 && (args[2] !== '--operator' || !args[3] || !['sub_id', 'mobile_no'].includes(args[1]!)))) {
    throw Error(USAGE);
  }
  printJson(randomizeField(args[1] as DeviceField, args[3]), true);
});
