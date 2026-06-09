# weekly-rss

Generate a full RSS archive for [ruanyf/weekly](https://github.com/ruanyf/weekly), then deploy the static feed to Cloudflare Pages.

## What It Publishes

- `rss.xml`: all weekly issues found in upstream `README.md`, sorted by issue number descending.
- `index.html`: a small landing page that links to the feed.

Each RSS item uses the upstream GitHub issue Markdown page as its stable `guid`, and the item date comes from the last upstream git commit touching that issue file.

## Local Usage

Clone the upstream repository with sparse checkout:

```bash
git clone --filter=blob:none --no-checkout https://github.com/ruanyf/weekly.git .upstream/weekly
cd .upstream/weekly
git sparse-checkout init --no-cone
git sparse-checkout set "/README.md" "/docs/issue-*.md"
git checkout master
cd ../..
```

Generate the site:

```bash
npm ci
npm test
npm run build -- --source-dir .upstream/weekly --output-dir public --feed-url https://weekly-rss.pages.dev/rss.xml
```

## Cloudflare Pages Deployment

The included GitHub Actions workflow runs every day at `12:30 UTC`, which is `20:30` in China Standard Time, and can also be triggered manually.

Create these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token that can deploy Pages projects.
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.

Optional GitHub repository variables:

- `CLOUDFLARE_PAGES_PROJECT`: Cloudflare Pages project name. Defaults to `weekly-rss`.
- `FEED_URL`: final RSS URL. Defaults to `https://weekly-rss.pages.dev/rss.xml`.

After the workflow succeeds, subscribe to:

```text
https://weekly-rss.pages.dev/rss.xml
```
