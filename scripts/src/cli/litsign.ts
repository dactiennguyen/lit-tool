import { runCli } from '../core/cli.ts';
import { isSignFlag, litSign, SIGN_FLAG } from '../crypto/litsign.ts';

runCli(() => {
  const [litTime, s = SIGN_FLAG.VALID] = process.argv.slice(2);
  if (!litTime || !/^\d+$/.test(litTime) || !isSignFlag(s)) {
    throw Error('Usage: node src/cli/litsign.ts <litTime ms> [0|1|2]   (self-test cũ: npm test)');
  }
  console.log(litSign(litTime, s));
});
