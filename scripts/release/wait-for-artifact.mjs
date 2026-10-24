#!/usr/bin/env node
// Waits until an artifact of the current workflow run exists, so a job can do its setup
// (checkout, toolchains, npm ci) while the job that produces the artifact is still running,
// instead of `needs:`-waiting for it first. Used by publish.yml: the client and Android
// builds start with build-payload and wait here, just before they first need the ELFs.
//
//   node scripts/release/wait-for-artifact.mjs <artifact name> <producing job name>
//
// Exits 0 once the artifact is listed, 1 as soon as the producing job has finished without
// success (a bad tag, a broken payload), and 1 after PS5UPLOAD_WAIT_MINUTES (default 20).
// Needs GITHUB_TOKEN with actions: read; GITHUB_REPOSITORY and GITHUB_RUN_ID come from Actions.

const [artifact, producer] = process.argv.slice(2);
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
if (!artifact || !producer || !GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) {
  console.error(
    "usage: wait-for-artifact.mjs <artifact> <producing job> (GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID set)",
  );
  process.exit(2);
}
const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28",
};
const deadline = Date.now() + Number(process.env.PS5UPLOAD_WAIT_MINUTES || 20) * 60_000;

async function get(url) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

for (;;) {
  try {
    const list = await get(`${api}/artifacts?name=${encodeURIComponent(artifact)}`);
    if ((list.artifacts || []).some((a) => a.name === artifact && !a.expired)) {
      console.log(`artifact ${artifact} is ready`);
      process.exit(0);
    }
    // filter=latest: on a re-run, the producing job of this attempt (or the one carried over).
    const jobs = await get(`${api}/jobs?filter=latest&per_page=100`);
    const job = (jobs.jobs || []).find((j) => j.name === producer);
    if (job && job.status === "completed" && job.conclusion !== "success") {
      console.error(`::error::${producer} finished '${job.conclusion}' without producing ${artifact}`);
      process.exit(1);
    }
  } catch (err) {
    // A transient API error is not a verdict; keep polling until the deadline.
    console.log(`(retrying: ${err.message})`);
  }
  if (Date.now() > deadline) {
    console.error(`::error::artifact ${artifact} did not appear in time`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
