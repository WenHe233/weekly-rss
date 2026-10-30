import { appendFile } from "node:fs/promises";
import path from "node:path";
import { createSyncSnapshot, publishSyncState } from "../src/sync-state.js";

const mode = process.argv[2];

if (mode === "snapshot") {
  const snapshot = await createSyncSnapshot({
    sourceDir: path.resolve(".upstream/weekly"),
    rssPath: path.resolve("public/rss.xml")
  });
  await appendFile(requiredEnv("GITHUB_OUTPUT"), `snapshot=${JSON.stringify(snapshot)}\n`, "utf8");
  console.log(`Prepared RSS sync record: ${snapshot.issueCount} issues, latest issue ${snapshot.latestIssue}`);
} else if (mode === "publish") {
  const branch = requiredEnv("SYNC_BRANCH");
  if (requiredEnv("GITHUB_REF") !== `refs/heads/${branch}`) {
    throw new Error("Sync records can only be published from the default branch");
  }
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${requiredEnv("GITHUB_RUN_ID")}`;
  const result = await publishSyncState({
    snapshot: JSON.parse(requiredEnv("SYNC_SNAPSHOT")),
    repository,
    branch,
    token: requiredEnv("GH_TOKEN"),
    runUrl,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com"
  });
  console.log(result.updated ? `Recorded successful RSS sync: ${result.commitSha}` : "RSS content is unchanged; no sync commit needed");
} else {
  throw new Error("Usage: node scripts/sync-state.mjs <snapshot|publish>");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}
