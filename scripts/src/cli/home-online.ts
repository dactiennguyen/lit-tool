import { printBody, printJson, runCli } from '../core/cli.ts';
import { fetchGet } from '../lit/client.ts';
import { loadEnvProfile } from '../lit/profile.ts';
import { buildGetRequest } from '../lit/request.ts';

runCli(async () => {
  const request = buildGetRequest('home/online_users', loadEnvProfile(), { start_pos: '0', num: '15', from_page: 'home' });
  const { summary, body } = await fetchGet(request);
  printJson(summary, true);
  printBody(body, true);
});
