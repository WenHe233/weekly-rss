import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createSyncSnapshot, publishSyncState } from "../src/sync-state.js";
import { generateSite } from "../src/weekly.js";

const execFileAsync = promisify(execFile);
const snapshot = {
  rssSha256: "a".repeat(64),
  upstreamCommit: "b".repeat(40),
  latestIssue: 2,
  issueCount: 2
};
const runUrl = "https://github.com/example/weekly-rss/actions/runs/123";
const syncedAt = "2026-10-30T12:30:00.000Z";

function response(status, value) {
  return new Response(JSON.stringify(value), { status });
}

function storedRecord(value, sha = "old-file-sha") {
  return response(200, {
    type: "file",
    encoding: "base64",
    sha,
    content: Buffer.from(JSON.stringify(value)).toString("base64")
  });
}

function harness(responses) {
  const requests = [];
  const options = {
    snapshot,
    repository: "example/weekly-rss",
    branch: "main",
    token: "test-token",
    runUrl,
    now: () => new Date(syncedAt),
    fetchImpl: async (url, init) => {
      requests.push({ url, ...init });
      assert.ok(responses.length, "Unexpected GitHub API request");
      return responses.shift();
    }
  };
  return { requests, options };
}

function writtenRecord(request) {
  return JSON.parse(Buffer.from(JSON.parse(request.body).content, "base64").toString("utf8"));
}

test("createSyncSnapshot follows RSS additions and corrections, ignoring the landing page timestamp", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "weekly-rss-sync-"));
  const sourceDir = path.join(tempDir, ".upstream", "weekly");
  const outputDir = path.join(tempDir, "public");
  const rssPath = path.join(outputDir, "rss.xml");
  const readme = "* 第 2 期：[第二期](docs/issue-2.md)\n* 第 1 期：[第一期](docs/issue-1.md)\n";
  const git = (...args) => execFileAsync("git", args, { cwd: sourceDir });
  const commit = async (message) => {
    await git("-c", "core.autocrlf=false", "add", "README.md", "docs");
    await git("-c", "user.name=Sync Test", "-c", "user.email=sync-test@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message);
  };
  const build = () => generateSite({
    sourceDir,
    outputDir,
    dateResolver: async () => new Date("2026-10-01T00:00:00Z")
  });

  try {
    await mkdir(path.join(sourceDir, "docs"), { recursive: true });
    await writeFile(path.join(sourceDir, "README.md"), readme);
    await writeFile(path.join(sourceDir, "docs", "issue-1.md"), "# 第一期\n\n原始内容。\n");
    await writeFile(path.join(sourceDir, "docs", "issue-2.md"), "# 第二期\n\n第二期内容。\n");
    await git("init", "--quiet");
    await commit("Initial issues");
    await build();

    const initial = await createSyncSnapshot({ sourceDir, rssPath });
    assert.deepEqual(initial, {
      rssSha256: createHash("sha256").update(await readFile(rssPath)).digest("hex"),
      upstreamCommit: (await git("rev-parse", "HEAD")).stdout.trim(),
      latestIssue: 2,
      issueCount: 2
    });

    const outputPath = path.join(tempDir, "github-output");
    const scriptPath = fileURLToPath(new URL("../scripts/sync-state.mjs", import.meta.url));
    await execFileAsync(process.execPath, [scriptPath, "snapshot"], {
      cwd: tempDir,
      env: { ...process.env, GITHUB_OUTPUT: outputPath }
    });
    assert.equal(await readFile(outputPath, "utf8"), `snapshot=${JSON.stringify(initial)}\n`);

    await writeFile(path.join(outputDir, "index.html"), "<p>New generation timestamp</p>");
    assert.deepEqual(await createSyncSnapshot({ sourceDir, rssPath }), initial);

    await writeFile(path.join(sourceDir, "README.md"), `* 第 3 期：[第三期](docs/issue-3.md)\n${readme}`);
    await writeFile(path.join(sourceDir, "docs", "issue-3.md"), "# 第三期\n\n新增内容。\n");
    await commit("Add issue 3");
    await build();
    const added = await createSyncSnapshot({ sourceDir, rssPath });
    assert.equal(added.latestIssue, 3);
    assert.equal(added.issueCount, 3);
    assert.notEqual(added.rssSha256, initial.rssSha256);
    assert.notEqual(added.upstreamCommit, initial.upstreamCommit);

    await writeFile(path.join(sourceDir, "docs", "issue-1.md"), "# 第一期\n\n修订后的内容。\n");
    await commit("Correct issue 1");
    await build();
    const corrected = await createSyncSnapshot({ sourceDir, rssPath });
    assert.equal(corrected.latestIssue, added.latestIssue);
    assert.equal(corrected.issueCount, added.issueCount);
    assert.notEqual(corrected.rssSha256, added.rssSha256);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("publishSyncState creates the first successful sync record on the target branch", async () => {
  const { requests, options } = harness([
    response(404, { message: "Not Found" }),
    response(201, { commit: { sha: "created-commit" } })
  ]);

  assert.deepEqual(await publishSyncState(options), { updated: true, commitSha: "created-commit" });
  assert.equal(requests[0].url, "https://api.github.com/repos/example/weekly-rss/contents/data/sync-state.json?ref=main");
  assert.equal(requests[1].url, "https://api.github.com/repos/example/weekly-rss/contents/data/sync-state.json");
  assert.equal(requests[1].method, "PUT");
  const body = JSON.parse(requests[1].body);
  assert.equal(body.branch, "main");
  assert.equal(Object.hasOwn(body, "sha"), false);
  assert.deepEqual(writtenRecord(requests[1]), { ...snapshot, syncedAt, runUrl });
});

test("publishSyncState preserves the record when RSS is unchanged despite a new upstream commit or run", async () => {
  const { requests, options } = harness([
    storedRecord({ ...snapshot, upstreamCommit: "c".repeat(40), syncedAt: "2026-10-01T00:00:00Z", runUrl: "previous-run" })
  ]);
  options.now = () => assert.fail("Unchanged RSS must not refresh the sync timestamp");

  assert.deepEqual(await publishSyncState(options), { updated: false });
  assert.equal(requests.length, 1);
});

for (const [name, next] of [
  ["a new issue", { ...snapshot, rssSha256: "c".repeat(64), latestIssue: 3, issueCount: 3 }],
  ["a correction to an existing issue", { ...snapshot, rssSha256: "d".repeat(64) }]
]) {
  test(`publishSyncState records ${name} using the existing file SHA`, async () => {
    const { requests, options } = harness([
      storedRecord(snapshot),
      response(200, { commit: { sha: "updated-commit" } })
    ]);

    await publishSyncState({ ...options, snapshot: next });
    assert.equal(JSON.parse(requests[1].body).sha, "old-file-sha");
    assert.deepEqual(writtenRecord(requests[1]), { ...next, syncedAt, runUrl });
  });
}

test("publishSyncState rereads the latest file SHA after a conflict", async () => {
  const { requests, options } = harness([
    storedRecord({ rssSha256: "c".repeat(64) }, "first-sha"),
    response(409, { message: "Conflict" }),
    storedRecord({ rssSha256: "d".repeat(64) }, "latest-sha"),
    response(200, { commit: { sha: "retry-commit" } })
  ]);

  assert.deepEqual(await publishSyncState(options), { updated: true, commitSha: "retry-commit" });
  assert.equal(JSON.parse(requests[1].body).sha, "first-sha");
  assert.equal(JSON.parse(requests[3].body).sha, "latest-sha");
});

test("publishSyncState stops retrying if another writer has already recorded the same RSS", async () => {
  const { requests, options } = harness([
    response(404, { message: "Not Found" }),
    response(409, { message: "Conflict" }),
    storedRecord(snapshot)
  ]);

  assert.deepEqual(await publishSyncState(options), { updated: false });
  assert.equal(requests.length, 3);
});

test("publishSyncState reports persistent conflicts after three retries", async () => {
  const responses = Array.from({ length: 4 }, (_, index) => [
    storedRecord({ rssSha256: "c".repeat(64) }, `file-sha-${index}`),
    response(409, { message: "Conflict" })
  ]).flat();
  const { requests, options } = harness(responses);

  await assert.rejects(publishSyncState(options), /after 3 conflict retries \(409\)/);
  assert.equal(requests.length, 8);
});

test("publishSyncState reports write failures without retrying unrelated errors", async () => {
  const { requests, options } = harness([
    storedRecord({ rssSha256: "c".repeat(64) }),
    response(403, { message: "Resource not accessible by integration" })
  ]);

  await assert.rejects(publishSyncState(options), /write sync record \(403\): Resource not accessible by integration/);
  assert.equal(requests.length, 2);
});

test("publishSyncState does not treat read permission failures as a missing file", async () => {
  const { requests, options } = harness([response(403, { message: "Forbidden" })]);

  await assert.rejects(publishSyncState(options), /read sync record \(403\)/);
  assert.equal(requests.length, 1);
});

test("publishSyncState refuses to overwrite a malformed existing record", async () => {
  const { requests, options } = harness([
    response(200, { type: "file", encoding: "base64", sha: "old-sha", content: Buffer.from("invalid JSON").toString("base64") })
  ]);

  await assert.rejects(publishSyncState(options), SyntaxError);
  assert.equal(requests.length, 1);
});

test("publishSyncState rejects an invalid snapshot before making API requests", async () => {
  const { requests, options } = harness([]);

  await assert.rejects(publishSyncState({ ...options, snapshot: {} }), /Invalid RSS sync snapshot/);
  assert.equal(requests.length, 0);
});

test("the publish command refuses to write from a non-default branch", async () => {
  const scriptPath = fileURLToPath(new URL("../scripts/sync-state.mjs", import.meta.url));

  await assert.rejects(execFileAsync(process.execPath, [scriptPath, "publish"], {
    env: { ...process.env, SYNC_BRANCH: "main", GITHUB_REF: "refs/heads/feature" }
  }), (error) => {
    assert.match(error.stderr, /Sync records can only be published from the default branch/);
    return true;
  });
});
