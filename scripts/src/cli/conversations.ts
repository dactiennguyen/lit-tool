import { parseArgs } from 'node:util';
import { printJson, runCli } from '../core/cli.ts';
import { CURSOR_PATTERN, isId, parseIntInRange } from '../core/validate.ts';
import { getConversations, getHistory, loadHistoryConfig, type History } from '../hyphenate/history.ts';
import { ensureAccessToken } from '../hyphenate/token.ts';
import { loadEnvProfile } from '../lit/profile.ts';

const HELP = 'Usage: node src/cli/conversations.ts [--to IM_ID | --with-messages]\n' +
  '--limit 20 (1..50), --pages 1 (1..20), --cursor ID (only with --to), --max-conversations 20 (1..100).\n' +
  'Default: Litmatch conversation list only. --to must be in that list. --with-messages fetches a bounded selection.\n' +
  '--dry-run validates config, no network. Reads only; never sends messages/read ACKs or updates phone cache.\n' +
  'Requires LIT_*; history also requires matching HX_* credentials. JSON stdout contains private message data.';

async function main(): Promise<void> {
  const { values: args } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' }, to: { type: 'string' },
    'with-messages': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
    limit: { type: 'string', default: '20' }, pages: { type: 'string', default: '1' },
    cursor: { type: 'string' }, 'max-conversations': { type: 'string', default: '20' },
  } });
  if (args.help) { console.log(HELP); return; }
  if (args.to !== undefined && !isId(args.to)) throw Error('Invalid --to IM ID');
  if (args.to && args['with-messages']) throw Error('Use --to OR --with-messages');
  if (args.cursor !== undefined && !args.to) throw Error('--cursor requires --to');
  const limit = parseIntInRange(args.limit, 1, 50, 'limit');
  const pages = parseIntInRange(args.pages, 1, 20, 'pages');
  const max = parseIntInRange(args['max-conversations'], 1, 100, 'max-conversations');
  const cursor = args.cursor ?? '-1';
  if (!CURSOR_PATTERN.test(cursor)) throw Error('Invalid --cursor');

  const wantsHistory = !!args.to || args['with-messages'];
  const profile = loadEnvProfile();
  const config = wantsHistory ? loadHistoryConfig() : null;
  if (args['dry-run']) {
    printJson({ dryRun: true, conversations: true, history: wantsHistory, to: args.to ?? null, limit, pages, maxConversations: max });
    return;
  }

  const { summary, conversations } = await getConversations(profile);
  const output: Record<string, unknown> = { summary, conversations };
  if (config) {
    const selected = args.to ? conversations.filter(c => c.conversation_id === args.to) : conversations.slice(0, max);
    if (args.to && !selected.length) throw Error('--to was not found in this Litmatch account conversation list');
    if (selected.some(c => c.conversation_type !== 0 && c.conversation_type !== 1)) {
      throw Error('Unsupported conversation type in selected list');
    }
    const history: History[] = [];
    output.history = history;
    output.conversationsSkipped = conversations.length - selected.length;

    if (selected.length) config.accessToken = await ensureAccessToken(config);
    for (const c of selected) {
      history.push(await getHistory(config, { to: c.conversation_id, type: c.conversation_type, limit, pages, cursor }));
    }
  }
  printJson(output, true);
}

runCli(main);
