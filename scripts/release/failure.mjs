// Only fixed codes enter diagnostics; exception text and operational values stay out.
const reasons = new Map([
  ['Deployment deadline exceeded', 'deadline_exceeded'],
  ['Rollout failed or replaced', 'rollout_failed_or_replaced'],
  ['Service changed before update', 'service_replaced'],
  ['Service changed during probes', 'service_replaced'],
  ['Restored task differs from contract', 'template_incompatible'],
  ['Unexpected restored container setting', 'template_incompatible'],
  ['Unexpected restored task setting', 'template_incompatible'],
  ['Unsafe restoration refused', 'restoration_refused'],
  ['HTTP probes failed', 'http_failed'],
  ['Recovery HTTP probes failed', 'http_failed'],
  ['AWS command failed', 'aws_command_failed'],
  ['Object reference mismatch', 'object_reference_mismatch'],
  ['Current contract differs from approval', 'contract_replaced'],
  ['Current verified receipt unavailable; provide exact previous run/attempt', 'current_proof_unavailable'],
  ['Current approved staging proof unavailable', 'staging_proof_unavailable'],
  ['Retained rollback proof unavailable', 'target_proof_unavailable'],
  ['Stale or divergent candidate', 'stale_candidate']
]);
const stages = new Set(['validation', 'current_revision', 'registration', 'update', 'rollout', 'http', 'final_observation', 'recovery', 'preparation', 'runner']);
export function failureDetails(stage, error) {
  return `stage=${stages.has(stage) ? stage : 'runner'};reason=${reasons.get(error?.message) ?? 'rejected_or_unavailable'}`;
}
