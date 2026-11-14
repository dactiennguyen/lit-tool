import { runCli } from '../core/cli.ts';
import { decodeShadow, encodeShadow, isShadowMode } from '../crypto/shadow.ts';

const USAGE = 'Usage: node src/cli/shadow.ts decode <value> [mode 1-5] | encode <text> [mode 1-5]   (self-test cũ: npm test)';

runCli(() => {
  const [cmd, value, modeArg = '3'] = process.argv.slice(2);
  const mode = Number(modeArg);
  if (value === undefined || !isShadowMode(mode)) throw Error(USAGE);
  if (cmd === 'decode') console.log(decodeShadow(value, mode));
  else if (cmd === 'encode') console.log(encodeShadow(value, mode));
  else throw Error(USAGE);
});
