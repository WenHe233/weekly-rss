# weekly-rss

为 [ruanyf/weekly](https://github.com/ruanyf/weekly) 生成全量 RSS 归档，并通过 Cloudflare Pages 发布成一个可订阅的静态 feed。

适合 FreshRSS、Miniflux、Reeder、NetNewsWire 等 RSS 阅读器或后端订阅。

## 发布内容

- `rss.xml`：上游 `README.md` 中列出的所有周刊，按期号倒序排列。
- `index.html`：一个简单的订阅入口页。

每个 RSS 条目会使用对应的 GitHub Markdown 原文地址作为稳定 `guid`，发布时间来自上游仓库中该 issue 文件的最后一次提交时间。

## 本地使用

先用 sparse checkout 拉取上游仓库，只取 `README.md` 和 `docs/issue-*.md`，避免下载图片目录：

```bash
git clone --filter=blob:none --no-checkout https://github.com/ruanyf/weekly.git .upstream/weekly
cd .upstream/weekly
git sparse-checkout init --no-cone
git sparse-checkout set "/README.md" "/docs/issue-*.md"
git checkout master
cd ../..
```

生成静态站点：

```bash
npm ci
npm test
npm run build -- --source-dir .upstream/weekly --output-dir public --feed-url https://weekly-rss.pages.dev/rss.xml
```

生成结果会写入 `public/`，其中 `public/rss.xml` 就是最终订阅源。

## Cloudflare Pages 部署

仓库内置的 GitHub Actions workflow 会在每天 `12:30 UTC` 自动运行，也就是北京时间 `20:30`。也可以在 GitHub Actions 页面手动触发。

需要在 GitHub 仓库中添加以下 Secrets：

- `CLOUDFLARE_API_TOKEN`：有权限部署 Cloudflare Pages 项目的 API Token。
- `CLOUDFLARE_ACCOUNT_ID`：你的 Cloudflare Account ID。

可选的 GitHub 仓库 Variables：

- `CLOUDFLARE_PAGES_PROJECT`：Cloudflare Pages 项目名，默认是 `weekly-rss`。
- `FEED_URL`：最终 RSS 地址，默认是 `https://weekly-rss.pages.dev/rss.xml`。

workflow 成功后，在 RSS 阅读器中订阅：

```text
https://weekly-rss.pages.dev/rss.xml
```

如果绑定了自定义域名，就把 `FEED_URL` 改成你的最终地址，例如：

```text
https://weekly.example.com/rss.xml
```

## 说明

- 主 feed 是全量归档，不限制最近期数。
- `public/` 是生成产物，不提交到仓库。
- `.upstream/` 是本地拉取的上游仓库，也不提交到仓库。
- 如果某些阅读器对超大的 RSS 文件支持不好，可以后续再额外生成一个只包含最近若干期的 `rss-latest.xml`。
