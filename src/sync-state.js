import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseReadmeIndex } from "./weekly.js";

const execFileAsync = promisify(execFile);
const SYNC_STATE_PATH = "data/sync-state.json";
const MAX_CONFLICT_RETRIES = 3;

export async function createSyncSnapshot({ sourceDir, rssPath }) {
  const [readme, rss, { stdout }] = await Promise.all([
    readFile(path.join(sourceDir, "README.md"), "utf8"),
    readFile(rssPath),
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: sourceDir, timeout: 30_000 })
  ]);
  const entries = parseReadmeIndex(readme);
  if (entries.length === 0) {
    throw new Error("Cannot record a sync without weekly issues");
  }

  return {
    rssSha256: createHash("sha256").update(rss).digest("hex"),
    upstreamCommit: stdout.trim(),
    latestIssue: entries[0].number,
    issueCount: entries.length
  };
}

export async function publishSyncState({
  snapshot,
  repository,
  branch,
  token,
  runUrl,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
  now = () => new Date()
}) {
  if (
    !/^[a-f0-9]{64}$/.test(snapshot?.rssSha256 ?? "") ||
    !/^[a-f0-9]{40}$/.test(snapshot?.upstreamCommit ?? "") ||
    !Number.isSafeInteger(snapshot?.latestIssue) || snapshot.latestIssue < 1 ||
    !Number.isSafeInteger(snapshot?.issueCount) || snapshot.issueCount < 1
  ) {
    throw new Error("Invalid RSS sync snapshot");
  }
  if (!repository || !branch || !token || !runUrl) {
    throw new Error("Repository, branch, token and run URL are required to publish a sync record");
  }

  const endpoint = `${apiUrl.replace(/\/$/, "")}/repos/${repository}/contents/${SYNC_STATE_PATH}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
    const currentResponse = await fetchImpl(`${endpoint}?ref=${encodeURIComponent(branch)}`, {
      headers,
      signal: AbortSignal.timeout(30_000)
    });
    let current;
    if (currentResponse.status !== 404) {
      if (!currentResponse.ok) {
        throw await apiError("read sync record", currentResponse);
      }
      current = await currentResponse.json();
      if (current.type !== "file" || current.encoding !== "base64" || !current.sha || typeof current.content !== "string") {
        throw new Error(`Unexpected GitHub contents response for ${SYNC_STATE_PATH}`);
      }
      const previous = JSON.parse(Buffer.from(current.content, "base64").toString("utf8"));
      if (previous.rssSha256 === snapshot.rssSha256) {
        return { updated: false };
      }
    } else {
      await currentResponse.body?.cancel();
    }

    const record = {
      rssSha256: snapshot.rssSha256,
      upstreamCommit: snapshot.upstreamCommit,
      latestIssue: snapshot.latestIssue,
      issueCount: snapshot.issueCount,
      syncedAt: now().toISOString(),
      runUrl
    };
    const response = await fetchImpl(endpoint, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `chore: record RSS sync for issue ${snapshot.latestIssue}`,
        branch,
        content: Buffer.from(`${JSON.stringify(record, null, 2)}\n`).toString("base64"),
        ...(current ? { sha: current.sha } : {})
      }),
      signal: AbortSignal.timeout(30_000)
    });

    if (response.status === 409 && attempt < MAX_CONFLICT_RETRIES) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      throw await apiError(
        response.status === 409 ? `write sync record after ${MAX_CONFLICT_RETRIES} conflict retries` : "write sync record",
        response
      );
    }
    const result = await response.json();
    return { updated: true, commitSha: result.commit.sha };
  }
}

async function apiError(operation, response) {
  const body = await response.json().catch(() => ({}));
  return new Error(`GitHub API failed to ${operation} (${response.status}): ${body.message ?? response.statusText}`);
}
