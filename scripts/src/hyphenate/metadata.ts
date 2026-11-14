import { isId } from '../core/validate.ts';
import { fetchPost, isLitAccepted, type ResponseSummary } from '../lit/client.ts';
import type { LitProfile } from '../lit/profile.ts';
import { buildPostRequest, type ImPostEndpoint, type ImPostPayloads } from '../lit/request.ts';
import type { EventSink } from './connection.ts';

export type MetadataStep = { [E in ImPostEndpoint]: { endpoint: E; payload: ImPostPayloads[E] } }[ImPostEndpoint];

export function metadataPlan(to: string, firstContact = false): MetadataStep[] {
  if (!isId(to)) throw Error('Invalid recipient IM ID');
  return [
    ...(firstContact ? [{ endpoint: 'user/accost_count', payload: { targetId: to } } as const] : []),
    { endpoint: 'user/conversation', payload: { conversation_id: to, conversation_type: 0 } },
    { endpoint: 'user/conversation/source', payload: { source: 'other', target_user_id: to } },
  ];
}

export function validateMetadataPlan(plan: readonly MetadataStep[], profile: LitProfile): void {
  for (const step of plan) buildStep(step, profile);
}

const buildStep = (step: MetadataStep, profile: LitProfile) =>
  buildPostRequest(step.endpoint, profile, step.payload as never);

export async function syncLitmatchMetadata({ profile, to, firstContact = false, onEvent = () => {} }:
  { profile: LitProfile; to: string; firstContact?: boolean; onEvent?: EventSink }): Promise<(ResponseSummary & { accepted: boolean })[]> {
  const results: (ResponseSummary & { accepted: boolean })[] = [];
  for (const step of metadataPlan(to, firstContact)) {
    const { endpoint } = step;
    onEvent({ event: 'metadata_request', endpoint });
    let summary: ResponseSummary;
    try { ({ summary } = await fetchPost(buildStep(step, profile))); }
    catch { throw Error(`Metadata outcome unknown at ${endpoint}; no automatic retry. Do not resend chat`); }
    const accepted = isLitAccepted(summary);
    results.push({ ...summary, accepted });
    onEvent({ event: 'metadata_response', ...summary, accepted });
    if (!accepted) {
      throw Error(`Metadata rejected at ${endpoint} (HTTP ${summary.http_status}, result=${summary.result}); do not resend chat`);
    }
  }
  return results;
}
