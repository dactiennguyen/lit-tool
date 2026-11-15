import { randomUUID } from 'node:crypto';
import { printJson, readJson, runCli } from '../core/cli.ts';
import { isPlainObject } from '../core/validate.ts';
import { buildPlaintext, decodeSiua, encodeSiua, FORMAT_VER, EYE_VER } from '../crypto/siua.ts';
import { decodeDetect, postDetect, prepareFields } from '../lit/eye-device.ts';
import { COMMON_QUERY_DEFAULTS, validateProfile } from '../lit/profile.ts';
import { buildUserMeRequest } from '../lit/request.ts';
import { fetchGet, isLitAccepted } from '../lit/client.ts';

const USAGE = 'node src/cli/verify-eye-headers.ts --capture <hook.json> --version <app-version> [--dry-run]';

runCli(async () => {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') return console.log(USAGE);
  if (![4, 5].includes(args.length) || args[0] !== '--capture' || args[2] !== '--version' ||
      (args.length === 5 && args[4] !== '--dry-run')) throw Error(USAGE);
  const capture = readJson(args[1]!, 'Cannot read hook capture');
  if (!isPlainObject(capture) || typeof capture.appSiua !== 'string' ||
      typeof capture.detect !== 'string' || typeof capture.model !== 'string') {
    throw Error('Capture must contain appSiua, detect and model');
  }
  const profile = validateProfile({
    sid: capture.sid, uuid: capture.uuid, userId: capture.userId,
    version: args[3], platform: 'android',
  });
  if (!profile.userId) throw Error('Capture must contain userId for response verification');
  profile.commonQuery = { ...COMMON_QUERY_DEFAULTS, model: capture.model };
  const fields = prepareFields(decodeDetect(capture.detect), {});
  if (fields.android_id_secure !== profile.uuid || fields.model !== capture.model) {
    throw Error('Capture device identity does not match request profile');
  }
  const sourcePlaintext = decodeSiua(capture.appSiua);
  const parts = sourcePlaintext.split('}}');
  if (parts.length !== 4 || parts[0] !== FORMAT_VER || parts[3] !== '' ||
      !parts[1]?.startsWith(`${EYE_VER}|`) || !parts[2]) throw Error('Unsupported SIUA format');
  const plaintext = buildPlaintext({ ts: Date.now(), uuid: randomUUID(), scan: parts[2] });
  const siua = encodeSiua(plaintext);
  if (decodeSiua(siua) !== plaintext) throw Error('Generated SIUA round-trip failed');
  printJson({
    phase: 'local', fieldCount: Object.keys(fields).length,
    scanSource: 'previous app hook snapshot; not a fresh device scan',
    querySource: 'capture identity/model + supplied version + script common defaults',
    siuaGeneratedInNode: true, siuaRoundTrip: true,
    capturedSiuaReencodedByteMatch: encodeSiua(sourcePlaintext) === capture.appSiua,
    siuaBytesChanged: siua !== capture.appSiua,
  }, true);
  if (args.includes('--dry-run')) return;

  const eye = await postDetect(fields, {
    ...profile.commonQuery, sid: profile.sid, uuid: profile.uuid,
    version: profile.version, platform: profile.platform,
  });
  const body = isPlainObject(eye.body) ? eye.body : null;
  const data = body && isPlainObject(body.data) ? body.data : null;
  const dfpid = data?.dfpId;
  const eyeAccepted = eye.httpStatus >= 200 && eye.httpStatus < 300 && body?.code === 0 &&
    typeof dfpid === 'string' && dfpid.length > 0;
  printJson({ phase: 'eye', httpStatus: eye.httpStatus, accepted: eyeAccepted,
    dfpidPresent: typeof dfpid === 'string' && dfpid.length > 0 }, true);
  if (!eyeAccepted) throw Error('Eye did not issue a DFPID');

  const request = buildUserMeRequest(validateProfile({ ...profile, siua, dfpid }));
  const requiredHeaders = ['X-SIUA', 'X-DFPID', 'litSign', 'sts-sign', 'ts', 'litTime',
    'X-Application-Info', 'X-request-Id', 'lit-user-id'];
  if (!requiredHeaders.every(key => !!request.headers[key]) ||
      request.headers['X-SIUA'] !== siua || request.headers['X-DFPID'] !== dfpid) {
    throw Error('Request header verification failed');
  }
  const response = await fetchGet(request);
  let decoded: unknown;
  try { decoded = JSON.parse(response.body.toString('utf8')); }
  catch { throw Error('Self-profile response is not JSON'); }
  const responseData = isPlainObject(decoded) && isPlainObject(decoded.data) ? decoded.data : null;
  const userMatches = responseData?.user_id === profile.userId;
  printJson({ phase: 'self-profile', ...response.summary, userIdMatches: userMatches,
    attachedHeaders: requiredHeaders }, true);
  if (!isLitAccepted(response.summary) || response.summary.request_id_matches !== true || !userMatches) {
    throw Error('Self-profile verification failed');
  }
}, () => {
  console.error('Verification failed. Check input schema, session validity and network; sensitive error details suppressed.');
});
