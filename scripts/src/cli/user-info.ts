import { printBody, printJson, runCli } from '../core/cli.ts';
import { fetchGet } from '../lit/client.ts';
import { loadEnvProfile } from '../lit/profile.ts';
import { buildUserInfoRequest } from '../lit/request.ts';

const DEFAULT_ID = '69809f293893a66708d442da';

runCli(async () => {
  const profile = loadEnvProfile();
  const targetId = process.argv[2] || DEFAULT_ID;
  // Same check as the legacy CLI (no length cap), kept for output parity.
  if (!/^[A-Za-z0-9_-]+$/.test(targetId)) throw Error('user_id không hợp lệ');
  const { summary, body } = await fetchGet(buildUserInfoRequest(profile, targetId));
  printJson(summary, true);
  printBody(body, true);
});
