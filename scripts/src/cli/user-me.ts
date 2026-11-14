import { printBody, printJson, runCli } from '../core/cli.ts';
import { fetchGet } from '../lit/client.ts';
import { loadEnvProfile } from '../lit/profile.ts';
import { buildGetRequest } from '../lit/request.ts';

// GET user/get_info/me?from=me&source=me: the logged-in account's own profile.
runCli(async () => {
  const profile = loadEnvProfile();
  const request = buildGetRequest('user/get_info/me', profile, { from: 'me', source: 'me' });
  // Only send X-SIUA when a real device value is configured (LIT_SIUA);
  // never the self-generated placeholder.
  if (!profile.siua) delete request.headers['X-SIUA'];
  const { summary, body } = await fetchGet(request);
  printJson(summary, true);
  if (summary.success) printBody(body, false);
});
