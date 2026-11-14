import { parseArgs } from 'node:util';
import { EASEMOB_REST_BASE } from '../core/constants.ts';
import { printJson, runCli } from '../core/cli.ts';
import { loadEnv } from '../core/env.ts';
import { connectAndCheck, type HxEvent } from '../hyphenate/connection.ts';
import { buildTextMessage } from '../hyphenate/message.ts';
import { metadataPlan, syncLitmatchMetadata, validateMetadataPlan, type MetadataStep } from '../hyphenate/metadata.ts';
import { loadTemplate } from '../hyphenate/template.ts';
import { requestUserToken } from '../hyphenate/token.ts';
import { loadEnvProfile, type LitProfile } from '../lit/profile.ts';

const HELP = [
  'Usage: node src/cli/hyphenate-connect.ts [--dry-run] [--to IM_ID --text TEXT]',
  'TCP modes require HX_LOGIN_TEMPLATE_B64, HX_IM_HOST, HX_PASSWORD or HX_ACCESS_TOKEN.',
  'Optional: HX_USERNAME (must match template), HX_IM_PORT, HX_REST_BASE.',
  'Password is the IM hxPwd, not a Google password. Token overrides password.',
  'Without --to/--text: checks login + followup, then closes; no chat sent.',
  'With --to AND --text: sends exactly one experimental plain TXT, waits for matched server ACK, then closes.',
  'Add --litmatch: after TCP acceptance, POST conversation + conversation/source using LIT_* credentials.',
  'LIT_SID and LIT_UUID must come from the same account/session as the HX_* credentials.',
  '--sync-only --to IM_ID: only these HTTPS writes; no token request, TCP login or chat send.',
  '--first-contact: also POST accost_count; only for a genuine new contact, never blindly retry it.',
  'No retries. ACK means server acceptance, not delivery/read. Risk checks, push metadata and phone cache sync are not implemented.',
  'The template remains account-specific; login may disconnect the phone app.',
].join('\n');

async function main(): Promise<void> {
  const { values: options } = parseArgs({ options: {
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
    to: { type: 'string' },
    text: { type: 'string' },
    litmatch: { type: 'boolean', default: false },
    'sync-only': { type: 'boolean', default: false },
    'first-contact': { type: 'boolean', default: false },
  } });
  if (options.help) { console.log(HELP); return; }

  const syncOnly = options['sync-only'];
  const firstContact = options['first-contact'];
  const metadata = options.litmatch || syncOnly;
  if (syncOnly) {
    if (!options.to || options.text !== undefined) throw Error('--sync-only requires --to and forbids --text');
  } else if ((options.to !== undefined) !== (options.text !== undefined)) throw Error('Supply both --to and --text');
  if (metadata && !options.to) throw Error('Metadata mode requires --to');
  if (firstContact && !metadata) throw Error('--first-contact requires --litmatch or --sync-only');

  let profile: LitProfile | undefined;
  let plan: MetadataStep[] = [];
  if (metadata) {
    plan = metadataPlan(options.to!, firstContact);
    profile = loadEnvProfile();
    validateMetadataPlan(plan, profile);
  }
  const log = (event: HxEvent | Record<string, unknown>) => printJson(event);

  if (syncOnly) {
    if (options['dry-run']) { log({ metadataPlan: plan, chatSent: false }); return; }
    await syncLitmatchMetadata({ profile: profile!, to: options.to!, firstContact, onEvent: log });
    log({ event: 'metadata_complete', chatSent: false });
    return;
  }

  const env = loadEnv();
  const template = loadTemplate(env);
  const message = options.to !== undefined
    ? buildTextMessage({ from: template.username, to: options.to, text: options.text! })
    : undefined;
  let accessToken = env.HX_ACCESS_TOKEN;
  const password = env.HX_PASSWORD;
  const authSource = accessToken ? 'supplied_token' : password ? 'username_password' : 'missing';
  if (options['dry-run']) {
    printJson({ appKey: template.appKey, username: template.username,
      host: template.host, port: template.port, authSource, templateSource: 'env',
      ...(metadata ? { metadataPlan: plan } : {}),
      ...(message ? { sendPreview: { to: message.to, text: options.text, bytes: message.frame.length }, chatSent: false } : {}) }, true);
    return;
  }
  if (authSource === 'missing') throw Error('Set HX_PASSWORD or HX_ACCESS_TOKEN');

  if (!accessToken) {
    const token = await requestUserToken({ appKey: template.appKey, username: template.username,
      password, restBase: env.HX_REST_BASE || EASEMOB_REST_BASE });
    accessToken = token.accessToken;
    log({ event: 'token_obtained', expiresIn: token.expiresIn });
  }

  const result = await connectAndCheck({ template, accessToken, message, onEvent: log });
  log(message
    ? { event: 'send_complete', serverAccepted: result.sendResult!.accepted, serverId: result.sendResult!.serverId, deliveryConfirmed: false }
    : { event: 'handshake_complete', chatSent: false });
  if (metadata) {
    const serverId = result.sendResult?.serverId;
    try {
      await syncLitmatchMetadata({ profile: profile!, to: options.to!, firstContact, onEvent: log });
    } catch (error) {
      log({ event: 'workflow_partial', serverAccepted: true, serverId, metadataComplete: false, retryChat: false });
      throw error;
    }
    log({ event: 'workflow_complete', serverAccepted: true, serverId,
      metadataComplete: true, phoneSyncConfirmed: false, deliveryConfirmed: false });
  }
}

runCli(main);
