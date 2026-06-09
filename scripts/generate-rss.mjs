import path from "node:path";
import { generateSite } from "../src/weekly.js";

const options = parseArgs(process.argv.slice(2));
const sourceDir = path.resolve(options["source-dir"] ?? ".upstream/weekly");
const outputDir = path.resolve(options["output-dir"] ?? "public");
const feedUrl = options["feed-url"] ?? process.env.FEED_URL ?? "https://weekly-rss.pages.dev/rss.xml";

const result = await generateSite({
  sourceDir,
  outputDir,
  feedUrl
});

console.log(`Generated ${result.count} RSS items in ${result.outputDir}`);
console.log(`Latest: ${result.latest.title}`);

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return parsed;
}
