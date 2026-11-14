import { parseArgs } from 'node:util';
import { printJson, runCli } from '../core/cli.ts';
import { parseIntInRange } from '../core/validate.ts';
import { getFeedPageStructure, getForYouFeeds, getPopularFeeds } from '../lit/api.ts';

runCli(async () => {
  const { values, positionals } = parseArgs({
    options: { 'start-pos': { type: 'string' }, num: { type: 'string' }, help: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log('node scripts/feed.js [structure|popular|recommended|associate] [--start-pos 0] [--num 20]');
    return;
  }
  const [mode = 'popular'] = positionals;
  if (positionals.length > 1 || !['structure', 'popular', 'recommended', 'associate'].includes(mode)) {
    throw Error('Choose structure, popular, recommended, or associate');
  }
  if (mode === 'structure' && (values['start-pos'] !== undefined || values.num !== undefined)) {
    throw Error('structure does not use --start-pos or --num');
  }
  const query = {
    start_pos: parseIntInRange(values['start-pos'] ?? 0, 0, 2_147_483_647, 'start_pos'),
    num: parseIntInRange(values.num ?? 20, 1, 50, 'num'),
  };
  const result = mode === 'structure' ? await getFeedPageStructure()
    : mode === 'associate' ? await getForYouFeeds({ type: 'Associate', query })
    : mode === 'recommended' ? await getForYouFeeds({ query })
    : await getPopularFeeds({ query });
  printJson({ summary: result.summary, response: result.response }, true);
  if (!result.response.success) process.exitCode = 1;
});
