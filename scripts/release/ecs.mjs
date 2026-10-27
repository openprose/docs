export function verifyDeployment(expected, observed) {
  return [
    { name: 'primary revision', ok: observed.primaryTaskArn === expected.taskArn },
    { name: 'rollout completed', ok: observed.rolloutState === 'COMPLETED' },
    {
      name: 'task counts',
      ok: expected.desiredCount === 1 && observed.desired === 1 && observed.running === 1 && observed.pending === 0 && observed.tasks.length === 1
    },
    {
      name: 'running revision and digest',
      ok: observed.tasks.length > 0 && observed.tasks.every(t => t.taskDefinitionArn === expected.taskArn && t.imageDigest === expected.digest)
    },
  ];
}
export function canRestorePrevious(attempt, current) {
  return typeof attempt.previousTaskArn === 'string' && attempt.previousTaskArn !== attempt.requestedTaskArn && current.primaryTaskArn === attempt.requestedTaskArn;
}
