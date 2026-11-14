import { printJson, runCli } from '../core/cli.ts';
import { decodeEye, encodeEye, parseEye } from '../crypto/eye.ts';

const USAGE = 'Usage: node src/cli/eye.ts decode <base64> | parse <base64> | encode <text>   (self-test cũ: npm test)';

runCli(() => {
  const [cmd, arg] = process.argv.slice(2);
  if (arg === undefined) throw Error(USAGE);
  if (cmd === 'decode') console.log(decodeEye(arg));
  else if (cmd === 'parse') printJson(parseEye(decodeEye(arg)), true);
  else if (cmd === 'encode') console.log(encodeEye(arg));
  else throw Error(USAGE);
});
