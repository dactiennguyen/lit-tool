import { printBody, printJson, runCli } from '../core/cli.ts';
import { fetchGet } from '../lit/client.ts';
import { loadEnvProfile } from '../lit/profile.ts';
import { buildUserMeRequest } from '../lit/request.ts';

runCli(async () => {
  const { summary, body } = await fetchGet(buildUserMeRequest(loadEnvProfile()));
  printJson(summary, true);
  if (summary.success) printBody(body, false);
});
