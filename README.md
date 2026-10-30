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

## 同步记录与定时任务

默认分支的 RSS 构建、部署成功后，独立的写回任务会比较 RSS 内容的 SHA256。首次发布或内容发生变化时，它会通过 GitHub Contents API 将 `data/sync-state.json` 提交到默认分支，记录以下信息：

- RSS 的 SHA256 和本次使用的上游提交 SHA。
- 最新期号和总期数。
- 成功同步时间和对应的 Actions 运行链接。

RSS 内容不变时，记录文件和提交历史都不更新。新增周刊或修订往期内容都会产生同步记录；首页的生成时间不参与比较。首次记录由成功的工作流自动创建。

构建、部署任务保留 `contents: read` 和 `deployments: write` 权限，只有写回任务申请 `contents: write`。所有 GitHub API 请求都使用仓库自带的 `GITHUB_TOKEN`，无需配置个人访问令牌。工作流产生的提交不会递归触发新的运行。若以后为默认分支设置保护规则，需要允许写回任务提交。

工作流会等待当前运行完成，再开始下一次运行。写回遇到文件冲突时，会重新读取记录并最多重试三次；最终失败则将写回任务标记为失败。非默认分支的手动运行不会写回同步记录。

GitHub 会在公开仓库连续 60 天没有活动时自动停用定时工作流。周刊正常更新并成功发布时，同步提交会产生真实的仓库活动；若长期没有内容变化或持续发布失败，仍可能触发停用。本项目不生成空提交，也不调用工作流启用 API 来保活。详见 [GitHub 定时工作流规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。

如果工作流已停用，在仓库 Actions 页面选择 **Build and deploy RSS**，点击 **Enable workflow**，再从默认分支手动运行一次。也可以使用 GitHub CLI：

```bash
gh workflow enable deploy.yml --repo WenHe233/weekly-rss
gh workflow run deploy.yml --ref main --repo WenHe233/weekly-rss
```

检查构建部署和写回任务是否成功、线上 RSS 是否更新，以及下一次定时运行是否正常。写回失败时，线上部署可能已经成功，应以运行日志和线上内容为准。

## 说明

- 主 feed 是全量归档，不限制最近期数。
- `public/` 是生成产物，不提交到仓库。
- `.upstream/` 是本地拉取的上游仓库，也不提交到仓库。
- 如果某些阅读器对超大的 RSS 文件支持不好，可以后续再额外生成一个只包含最近若干期的 `rss-latest.xml`。
