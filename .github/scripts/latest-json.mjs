// Writes latest.json, what the updater of the installed app reads from the latest release (src-tauri/src/update.rs):
// for each platform, the bundle that installs it and the signature from its .sig, which stage-bundles.mjs staged beside
// it. Fails when a platform has no signed bundle, which happens when the signing key is not in the repository secrets.
// Used by .github/workflows/release.yml.
//   node .github/scripts/latest-json.mjs <assets dir> <version> <owner/repo> <tag> <notes file> > latest.json
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Asset name suffix (stage-bundles.mjs) → the updater targets it serves: `{os}-{arch}-{installer}` first, which the
 * updater looks for by the bundle the app was installed from, then `{os}-{arch}` for the main bundle of that machine. */
export const PLATFORMS = [
  ['_macos_aarch64.app.tar.gz', ['darwin-aarch64-app', 'darwin-aarch64']],
  ['_macos_x64.app.tar.gz', ['darwin-x86_64-app', 'darwin-x86_64']],
  ['_windows_x64-setup.exe', ['windows-x86_64-nsis', 'windows-x86_64']],
  ['_windows_x64.msi', ['windows-x86_64-msi']],
];

/** The body of the release commit without a last paragraph of git trailers (Co-Authored-By: …): "Có gì mới" in the app. */
export function releaseNotes(body) {
  const paragraphs = body.trim().split(/\n\s*\n/);
  const trailers = paragraphs.length > 0 && paragraphs.at(-1).split('\n').every(line => /^[A-Za-z][\w-]*-by: \S/i.test(line));
  return (trailers ? paragraphs.slice(0, -1) : paragraphs).join('\n\n').trim();
}

/**
 * The manifest of a release. `files` are the asset names; `signature(name)` reads the .sig asset `name`.
 * @param {{ files: string[], signature: (name: string) => string, version: string, repo: string, tag: string,
 *   notes: string, date: string }} release
 */
export function latestJson({ files, signature, version, repo, tag, notes, date }) {
  /** @type {Record<string, { signature: string, url: string }>} */
  const platforms = {};
  const missing = [];
  for (const [suffix, targets] of PLATFORMS) {
    const asset = files.find(f => f.endsWith(suffix));
    if (!asset || !files.includes(`${asset}.sig`)) {
      missing.push(`*${suffix}${asset ? '.sig' : ''}`);
      continue;
    }
    const entry = {
      signature: signature(`${asset}.sig`).trim(),
      url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`,
    };
    for (const target of targets) platforms[target] = entry;
  }
  if (missing.length) {
    throw new Error(`no signed bundle for ${missing.join(', ')}: is TAURI_SIGNING_PRIVATE_KEY in the repository secrets?`);
  }
  return { version: version.replace(/^v/, ''), notes: releaseNotes(notes), pub_date: date, platforms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, version, repo, tag, notesFile] = process.argv.slice(2);
  if (!dir || !version || !repo || !tag || !notesFile) {
    console.error('usage: node .github/scripts/latest-json.mjs <assets dir> <version> <owner/repo> <tag> <notes file>');
    process.exit(2);
  }
  const manifest = latestJson({
    files: readdirSync(dir),
    signature: name => readFileSync(join(dir, name), 'utf8'),
    version,
    repo,
    tag,
    notes: readFileSync(notesFile, 'utf8'),
    date: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
