import { printBody, printJson, runCli } from '../core/cli.ts';
import { fetchGet } from '../lit/client.ts';
import { loadEnvProfile } from '../lit/profile.ts';
import { buildGetRequest } from '../lit/request.ts';

const DEFAULT_ID = '69809f293893a66708d442da';

runCli(async () => {
  const profile = loadEnvProfile();
  const targetId = process.argv[2] || DEFAULT_ID;
  if (!/^[A-Za-z0-9_-]+$/.test(targetId)) throw Error('user_id không hợp lệ');

  const request = buildGetRequest('user/get_info/:id', { ...profile, userId: targetId }, {});

  if (profile.userId && profile.userId !== targetId) request.headers['lit-user-id'] = profile.userId;
  else delete request.headers['lit-user-id'];

  const { summary, body } = await fetchGet(request);
  printJson(summary, true);
  printBody(body, true);
});
