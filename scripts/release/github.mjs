import { requireCondition } from './contract.mjs';
export const repository = 'openprose/docs';
export const buildWorkflow = '.github/workflows/build-docs.yml';
const pathOf = run => run.path?.split('@')[0];
const ownMain = run => run.repository?.full_name === repository && run.head_repository?.full_name === repository && run.head_branch === 'main';
export function authenticateBuild(run, jobs, expected, building = false) {
  requireCondition(ownMain(run) && pathOf(run) === buildWorkflow && ['push', 'workflow_dispatch'].includes(run.event), 'Untrusted build producer');
  requireCondition(String(run.id) === expected.runId && String(run.run_attempt) === expected.runAttempt && run.head_sha === expected.sourceSha && /^[a-f0-9]{40}$/.test(run.head_sha), 'Build identity mismatch');
  requireCondition(building ? run.status === 'in_progress' : run.status === 'completed' && run.conclusion === 'success', 'Build not successful');
  const checks = jobs.jobs.filter(job => ['verify', 'checks / verify'].includes(job.name));
  requireCondition(checks.length === 1 && checks[0].head_sha === run.head_sha && checks[0].status === 'completed' && checks[0].conclusion === 'success', 'Exact-source checks unavailable');
  return { sourceSha: run.head_sha, producer: { repository, workflowRef: `${repository}/${buildWorkflow}@refs/heads/main`, runId: expected.runId, runAttempt: expected.runAttempt }, checks: { runId: expected.runId, conclusion: 'success' } };
}
export async function requireFresh(operation, currentSource, candidateSource, compare) {
  if (operation === 'rollback') return;
  requireCondition(/^[a-f0-9]{40}$/.test(currentSource) && /^[a-f0-9]{40}$/.test(candidateSource), 'Invalid source identity');
  const result = await compare(`compare/${currentSource}...${candidateSource}`);
  requireCondition(['ahead', 'identical'].includes(result.status), 'Stale or divergent candidate');
}
export function trustedReleaseRun(run, environment) {
  const allowed = environment === 'staging' ? ['stage-docs.yml', 'rollback-docs.yml', 'bootstrap-docs.yml'] : ['promote-docs.yml', 'rollback-docs.yml', 'bootstrap-docs.yml'];
  return ownMain(run) && allowed.some(file => pathOf(run) === `.github/workflows/${file}`) && ['workflow_run', 'workflow_dispatch'].includes(run.event) && run.status === 'completed' && run.conclusion === 'success';
}
export function createGithub(token = process.env.GH_TOKEN) {
  requireCondition(token, 'GitHub token required');
  return async path => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) });
    requireCondition(response.ok, 'GitHub evidence unavailable');
    return response.json();
  };
}
export async function buildEvidence(github, runId, runAttempt, building = false) {
  requireCondition(/^[1-9][0-9]*$/.test(runId) && /^[1-9][0-9]*$/.test(runAttempt), 'Invalid producer identifiers');
  const run = await github(`actions/runs/${runId}/attempts/${runAttempt}`);
  const jobs = await github(`actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`);
  requireCondition(jobs.total_count <= 100, 'Ambiguous check evidence');
  return authenticateBuild(run, jobs, { runId, runAttempt, sourceSha: run.head_sha }, building);
}
