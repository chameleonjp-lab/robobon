import { mkdir, writeFile } from 'node:fs/promises';

const required = {
  repository: process.env.REVIEW_REPOSITORY,
  event: process.env.REVIEW_EVENT,
  runId: process.env.REVIEW_RUN_ID,
  runAttempt: process.env.REVIEW_RUN_ATTEMPT,
  workflowSha: process.env.REVIEW_WORKFLOW_SHA,
  headSha: process.env.REVIEW_HEAD_SHA,
  baseSha: process.env.REVIEW_BASE_SHA,
  artifactName: process.env.REVIEW_ARTIFACT_NAME,
};

for (const [key, value] of Object.entries(required)) {
  if (!value) throw new Error(`review manifest value is missing: ${key}`);
}

const shaPattern = /^[0-9a-f]{40}$/;
for (const key of ['workflowSha', 'headSha', 'baseSha']) {
  if (!shaPattern.test(required[key])) throw new Error(`review manifest SHA is invalid: ${key}`);
}

const positiveInteger = /^(?:[1-9][0-9]*)$/;
for (const key of ['runId', 'runAttempt']) {
  if (!positiveInteger.test(required[key])) throw new Error(`review manifest number is invalid: ${key}`);
}

const manifest = {
  schemaVersion: 1,
  repository: required.repository,
  event: required.event,
  runId: Number(required.runId),
  runAttempt: Number(required.runAttempt),
  workflowSha: required.workflowSha,
  headSha: required.headSha,
  baseSha: required.baseSha,
  artifactName: required.artifactName,
  basePath: '/robobon/',
};

await mkdir('dist', { recursive: true });
await writeFile('dist/review-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`review manifest written: ${manifest.artifactName}`);
