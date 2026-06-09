import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import posixPath from "node:path/posix";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_FEED_URL = "https://weekly-rss.pages.dev/rss.xml";
const UPSTREAM_REPO_URL = "https://github.com/ruanyf/weekly";
const UPSTREAM_BLOB_BASE = "https://github.com/ruanyf/weekly/blob/master";
const UPSTREAM_RAW_BASE = "https://raw.githubusercontent.com/ruanyf/weekly/master";

export function parseReadmeIndex(readme) {
  const entries = [];
  const seen = new Set();

  for (const line of readme.split(/\r?\n/)) {
    const item = line.match(/^\s*[-*]\s*第\s*(\d+)\s*期[:：]\s*(.+?)\s*$/);
    if (!item) {
      continue;
    }

    const number = Number.parseInt(item[1], 10);
    const rest = item[2];
    const pathMatch = rest.match(/\]\((docs\/issue-(\d+)\.md)\)/);
    if (!pathMatch) {
      continue;
    }

    const issueNumber = Number.parseInt(pathMatch[2], 10);
    if (issueNumber !== number || seen.has(number)) {
      continue;
    }

    const titleStart = rest.indexOf("[");
    const titleEnd = pathMatch.index;
    const title = stripMarkdownEscapes(rest.slice(titleStart + 1, titleEnd).trim());

    entries.push({
      number,
      title,
      path: pathMatch[1],
      url: `${UPSTREAM_BLOB_BASE}/${pathMatch[1]}`
    });
    seen.add(number);
  }

  return entries.sort((a, b) => b.number - a.number);
}

export async function generateSite({
  sourceDir,
  outputDir,
  feedUrl = DEFAULT_FEED_URL,
  dateResolver = getGitLastCommitDate
}) {
  const readmePath = path.join(sourceDir, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const entries = parseReadmeIndex(readme);

  if (entries.length === 0) {
    throw new Error(`No weekly issues found in ${readmePath}`);
  }

  const items = [];

  for (const entry of entries) {
    const issuePath = path.join(sourceDir, ...entry.path.split("/"));
    const markdown = await readFile(issuePath, "utf8");
    const issueTitle = extractIssueTitle(markdown) ?? `科技爱好者周刊（第 ${entry.number} 期）：${entry.title}`;
    const html = renderMarkdown(markdown, { issuePath: entry.path });
    const pubDate = await dateResolver(sourceDir, entry.path);

    items.push({
      ...entry,
      title: issueTitle,
      html: addSourceFooter(html, entry.url),
      summary: extractSummary(markdown),
      pubDate
    });
  }

  const generatedAt = new Date();
  const rss = buildRss({ items, feedUrl, generatedAt });
  const indexHtml = buildIndexHtml({ items, feedUrl, generatedAt });

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "rss.xml"), rss, "utf8");
  await writeFile(path.join(outputDir, "index.html"), indexHtml, "utf8");

  return {
    count: items.length,
    latest: items[0],
    outputDir
  };
}

export async function getGitLastCommitDate(sourceDir, relativeFilePath) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%cI", "--", relativeFilePath],
      { cwd: sourceDir, timeout: 30_000 }
    );
    const value = stdout.trim();
    if (value) {
      return new Date(value);
    }
  } catch {
    // The generator should still be useful for fixture builds or incomplete clones.
  }

  return new Date(0);
}

export function extractIssueTitle(markdown) {
  const heading = markdown.match(/^#\s+(.+?)\s*$/m);
  return heading ? stripMarkdownEscapes(heading[1].trim()) : null;
}

export function extractSummary(markdown) {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#+\s*/, "")
        .replace(/!\[[^\]]*]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
        .replace(/[*_`>#-]/g, "")
        .trim()
    )
    .filter(Boolean);

  const firstUsefulLine =
    lines.find((line) => !line.includes("这里记录每周值得分享的科技内容")) ?? lines[0] ?? "";

  return firstUsefulLine.length > 180 ? `${firstUsefulLine.slice(0, 177)}...` : firstUsefulLine;
}

export function renderMarkdown(markdown, context) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      html.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2], context)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderMarkdown(quote.join("\n"), context)}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item, context)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item, context)}</li>`).join("")}</ol>`);
      continue;
    }

    if (/^\s*</.test(line.trim()) && />\s*$/.test(line.trim())) {
      html.push(rewriteHtmlUrls(line.trim(), context));
      index += 1;
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "), context)}</p>`);
  }

  return html.join("\n");
}

export function renderInline(text, context) {
  const tokens = [];
  const save = (value) => {
    tokens.push(value);
    return `\u0000${tokens.length - 1}\u0000`;
  };

  let value = text;

  value = value.replace(/!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) =>
    save(`<img src="${escapeAttribute(absolutizeUrl(url, context, "image"))}" alt="${escapeAttribute(alt)}">`)
  );

  value = value.replace(/\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) =>
    save(`<a href="${escapeAttribute(absolutizeUrl(url, context, "link"))}">${escapeHtml(label)}</a>`)
  );

  value = value.replace(/`([^`]+)`/g, (_, code) => save(`<code>${escapeHtml(code)}</code>`));
  value = escapeHtml(value);
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return value.replace(/\u0000(\d+)\u0000/g, (_, tokenIndex) => tokens[Number(tokenIndex)]);
}

export function absolutizeUrl(url, context, kind) {
  const trimmed = url.trim();

  if (/^(?:https?:|mailto:|tel:|data:)/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (trimmed.startsWith("#")) {
    return `${UPSTREAM_BLOB_BASE}/${context.issuePath}${trimmed}`;
  }

  const parts = trimmed.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const rawPath = parts?.[1] ?? trimmed;
  const query = parts?.[2] ?? "";
  const hash = parts?.[3] ?? "";
  const baseDir = posixPath.dirname(context.issuePath);
  const normalized = posixPath
    .normalize(rawPath.startsWith("/") ? rawPath.slice(1) : posixPath.join(baseDir, rawPath))
    .replace(/^\.\//, "");

  const base = kind === "image" ? UPSTREAM_RAW_BASE : UPSTREAM_BLOB_BASE;
  return `${base}/${normalized}${query}${hash}`;
}

export function buildRss({ items, feedUrl, generatedAt }) {
  const latestDate = items
    .map((item) => item.pubDate)
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a)[0];
  const lastBuildDate = latestDate ?? generatedAt;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xmlEscape("阮一峰科技爱好者周刊")}</title>
    <link>${xmlEscape(UPSTREAM_REPO_URL)}</link>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${xmlEscape("ruanyf/weekly 的全量 RSS 归档。")}</description>
    <language>zh-CN</language>
    <lastBuildDate>${formatRssDate(lastBuildDate)}</lastBuildDate>
    <generator>weekly-rss</generator>
${items.map(renderRssItem).join("\n")}
  </channel>
</rss>
`;
}

export function buildIndexHtml({ items, feedUrl, generatedAt }) {
  const latest = items[0];

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>阮一峰科技爱好者周刊 RSS</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Georgia, "Noto Serif SC", "Source Han Serif SC", serif;
        background: #f7efe1;
        color: #1e241f;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(219, 134, 55, 0.25), transparent 34rem),
          linear-gradient(135deg, #fbf5e8, #e7eddc);
      }
      main {
        width: min(46rem, calc(100% - 2rem));
        border: 1px solid rgba(30, 36, 31, 0.16);
        border-radius: 28px;
        padding: clamp(1.5rem, 5vw, 3rem);
        background: rgba(255, 253, 247, 0.76);
        box-shadow: 0 24px 80px rgba(78, 60, 31, 0.18);
      }
      h1 {
        margin: 0 0 1rem;
        font-size: clamp(2rem, 7vw, 4.8rem);
        line-height: 0.95;
        letter-spacing: -0.06em;
      }
      p {
        font-size: 1.05rem;
        line-height: 1.8;
      }
      a {
        color: #96580f;
        font-weight: 700;
      }
      .meta {
        margin-top: 2rem;
        padding-top: 1.25rem;
        border-top: 1px solid rgba(30, 36, 31, 0.14);
        color: #596154;
        font-size: 0.95rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>阮一峰科技爱好者周刊 RSS</h1>
      <p>这是 <a href="${escapeAttribute(UPSTREAM_REPO_URL)}">ruanyf/weekly</a> 的全量 RSS 归档，适合 FreshRSS 和其他 RSS 阅读器订阅。</p>
      <p><a href="${escapeAttribute(feedUrl)}">订阅 rss.xml</a></p>
      <p class="meta">当前包含 ${items.length} 期。最新一期：${escapeHtml(latest.title)}。生成时间：${escapeHtml(generatedAt.toISOString())}。</p>
    </main>
  </body>
</html>
`;
}

function renderRssItem(item) {
  return `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.url)}</link>
      <guid isPermaLink="true">${xmlEscape(item.url)}</guid>
      <pubDate>${formatRssDate(item.pubDate)}</pubDate>
      <description>${cdata(item.summary)}</description>
      <content:encoded>${cdata(item.html)}</content:encoded>
    </item>`;
}

function addSourceFooter(html, sourceUrl) {
  return `${html}
<hr>
<p>原文：<a href="${escapeAttribute(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p>`;
}

function rewriteHtmlUrls(html, context) {
  return html
    .replace(/\s(src)=["']([^"']+)["']/gi, (_, attr, url) => ` ${attr}="${escapeAttribute(absolutizeUrl(url, context, "image"))}"`)
    .replace(/\s(href)=["']([^"']+)["']/gi, (_, attr, url) => ` ${attr}="${escapeAttribute(absolutizeUrl(url, context, "link"))}"`);
}

function formatRssDate(date) {
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
}

function stripMarkdownEscapes(value) {
  return value.replace(/\\([\\`*_[\]{}()#+\-.!])/g, "$1");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function xmlEscape(value) {
  return escapeAttribute(value).replace(/'/g, "&apos;");
}

function cdata(value) {
  return `<![CDATA[${String(value).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
