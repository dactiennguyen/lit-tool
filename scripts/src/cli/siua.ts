import { runCli } from '../core/cli.ts';
import { decodeSiua, siua } from '../crypto/siua.ts';

runCli(() => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === undefined) console.log(siua());
  else if (cmd === 'decode' && arg) console.log(decodeSiua(arg));
  else throw Error('Usage: node src/cli/siua.ts [decode <token>]   (self-test cũ: npm test)');
});
