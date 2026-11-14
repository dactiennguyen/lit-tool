import { errorMessage, printJson, runCli } from '../core/cli.ts';
import { fetchGet, savePrivateResponse } from '../lit/client.ts';
import { loadEnvProfile, loadJsonProfile, loadQuery } from '../lit/profile.ts';
import { buildGetRequest } from '../lit/request.ts';
import { assertStartupEndpoint, STARTUP_ENDPOINTS } from '../lit/startup.ts';

const HELP = `Usage:
  node src/cli/startup-api.ts --list
  node src/cli/startup-api.ts <endpoint> [--send] [--save] [--query-file <json>]
  node src/cli/startup-api.ts <endpoint> --profile <private-json> [--send] [--save]

By default reads LIT_SID, LIT_UUID, LIT_VERSION, LIT_PLATFORM from scripts/.env
(tùy chọn LIT_USER_ID, LIT_DFPID, LIT_BASE_URL). Mọi request được ký mặc định
(litSign/ts/litTime/sts-sign/X-Application-Info + X-SIUA tự tạo bằng siua();
X-DFPID chỉ gửi nếu có LIT_DFPID trong .env).
Without --send only a preview is printed; --save stores the response in .private/.`;

interface Args {
  list?: true; help?: true; send?: true; save?: true;
  'query-file'?: string; profile?: string; 'env-file'?: string;
  endpoint?: string;
}

const FLAGS = ['--list', '--help', '--send', '--save'] as const;
const VALUED = ['--query-file', '--profile', '--env-file'] as const;
const isIn = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

function parseCliArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (isIn(FLAGS, arg)) {
      args[arg.slice(2) as 'list' | 'help' | 'send' | 'save'] = true;
    } else if (isIn(VALUED, arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw Error('Thiếu giá trị cho ' + arg);
      args[arg.slice(2) as 'query-file' | 'profile' | 'env-file'] = value;
      i++;
    } else if (!arg.startsWith('-') && !args.endpoint) {
      args.endpoint = arg;
    } else throw Error('Đối số không hợp lệ');
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.list) return console.log([...STARTUP_ENDPOINTS].join('\n'));
  assertStartupEndpoint(args.endpoint);
  if (args.save && !args.send) throw Error('--save cần --send');
  if (args.profile && args['env-file']) throw Error('--profile không dùng cùng --env-file');

  const profile = args.profile ? loadJsonProfile(args.profile) : loadEnvProfile(args['env-file']);
  const request = buildGetRequest(args.endpoint, profile, loadQuery(args['query-file']));
  if (!args.send) {
    return printJson({
      mode: 'preview', method: 'GET', endpoint: args.endpoint, host: request.url.host,
      query_keys: [...request.url.searchParams.keys()], session_present: true, body: false,
      header_names: Object.keys(request.headers),
    }, true);
  }

  const { summary, body } = await fetchGet(request);
  if (args.save) summary.saved_private_response = savePrivateResponse(body);
  printJson(summary, true);
}

runCli(main, error => console.error(JSON.stringify({
  error: error instanceof TypeError ? 'network_or_response_error'
    : (error as Error)?.name === 'TimeoutError' ? 'request_timeout' : errorMessage(error),
})));
