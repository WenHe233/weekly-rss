import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  absolutizeUrl,
  generateSite,
  parseReadmeIndex,
  renderMarkdown
} from "../src/weekly.js";

test("parseReadmeIndex reads all issues and sorts them descending", () => {
  const readme = `
## 2026

* 第 399 期：[中国 AI 大厂访问记](docs/issue-399.md)
* 第 283 期：[[年终感想] 没有目的地，向前走](docs/issue-283.md)
* 第 1 期：[开刊的话](docs/issue-1.md)
`;

  assert.deepEqual(parseReadmeIndex(readme), [
    {
      number: 399,
      title: "中国 AI 大厂访问记",
      path: "docs/issue-399.md",
      url: "https://github.com/ruanyf/weekly/blob/master/docs/issue-399.md"
    },
    {
      number: 283,
      title: "[年终感想] 没有目的地，向前走",
      path: "docs/issue-283.md",
      url: "https://github.com/ruanyf/weekly/blob/master/docs/issue-283.md"
    },
    {
      number: 1,
      title: "开刊的话",
      path: "docs/issue-1.md",
      url: "https://github.com/ruanyf/weekly/blob/master/docs/issue-1.md"
    }
  ]);
});

test("renderMarkdown rewrites relative links and images", () => {
  const html = renderMarkdown(
    [
      "# 标题",
      "",
      "![封面](../images/cover.png)",
      "",
      "请看 [第一期](issue-1.md) 和 `code`。"
    ].join("\n"),
    { issuePath: "docs/issue-399.md" }
  );

  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /src="https:\/\/raw\.githubusercontent\.com\/ruanyf\/weekly\/master\/images\/cover\.png"/);
  assert.match(html, /href="https:\/\/github\.com\/ruanyf\/weekly\/blob\/master\/docs\/issue-1\.md"/);
  assert.match(html, /<code>code<\/code>/);
});

test("absolutizeUrl keeps external URLs and anchors useful", () => {
  assert.equal(
    absolutizeUrl("https://example.com/a.png", { issuePath: "docs/issue-1.md" }, "image"),
    "https://example.com/a.png"
  );
  assert.equal(
    absolutizeUrl("#tools", { issuePath: "docs/issue-1.md" }, "link"),
    "https://github.com/ruanyf/weekly/blob/master/docs/issue-1.md#tools"
  );
});

test("generateSite writes a full RSS archive and landing page", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "weekly-rss-"));

  try {
    const sourceDir = path.join(tempDir, "source");
    const outputDir = path.join(tempDir, "public");
    await mkdir(path.join(sourceDir, "docs"), { recursive: true });

    await writeFile(
      path.join(sourceDir, "README.md"),
      [
        "# 科技爱好者周刊",
        "",
        "* 第 399 期：[中国 AI 大厂访问记](docs/issue-399.md)",
        "* 第 200 期：[中间一期](docs/issue-200.md)",
        "* 第 1 期：[开刊的话](docs/issue-1.md)"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(sourceDir, "docs", "issue-399.md"),
      "# 科技爱好者周刊（第 399 期）：中国 AI 大厂访问记\n\n![封面](../images/cover.png)\n\n正文。",
      "utf8"
    );
    await writeFile(path.join(sourceDir, "docs", "issue-200.md"), "# 科技爱好者周刊（第 200 期）：中间一期\n\n正文。", "utf8");
    await writeFile(path.join(sourceDir, "docs", "issue-1.md"), "# 科技爱好者周刊（第 1 期）：开刊的话\n\n正文。", "utf8");

    const dates = new Map([
      ["docs/issue-399.md", new Date("2026-06-05T12:00:00Z")],
      ["docs/issue-200.md", new Date("2022-06-01T12:00:00Z")],
      ["docs/issue-1.md", new Date("2018-04-01T12:00:00Z")]
    ]);

    const result = await generateSite({
      sourceDir,
      outputDir,
      feedUrl: "https://weekly-rss.pages.dev/rss.xml",
      dateResolver: async (_sourceDir, relativePath) => dates.get(relativePath)
    });

    assert.equal(result.count, 3);

    const rss = await readFile(path.join(outputDir, "rss.xml"), "utf8");
    const indexHtml = await readFile(path.join(outputDir, "index.html"), "utf8");

    assert.equal([...rss.matchAll(/<item>/g)].length, 3);
    assert.ok(rss.indexOf("issue-399.md") < rss.indexOf("issue-200.md"));
    assert.ok(rss.indexOf("issue-200.md") < rss.indexOf("issue-1.md"));
    assert.match(rss, /<content:encoded><!\[CDATA\[/);
    assert.match(rss, /raw\.githubusercontent\.com\/ruanyf\/weekly\/master\/images\/cover\.png/);
    assert.match(indexHtml, /当前包含 3 期/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
