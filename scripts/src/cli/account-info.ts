import { printBody, printJson, runCli } from '../core/cli.ts';
import { fetchGet } from '../lit/client.ts';
import { loadEnvProfile } from '../lit/profile.ts';
import { buildGetRequest } from '../lit/request.ts';

runCli(async () => {
  const { summary, body } = await fetchGet(buildGetRequest('account/account_info', loadEnvProfile(), {}));
  printJson(summary, true);
  if (summary.success) printBody(body, false);
});
