import { parseArgs } from "node:util";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadConfig } from "../../../config.ts";
import { createSecretStore } from "../../driven/secrets/index.ts";
import { exchangeCode, persistTokens, startAuthorization } from "../../driven/x/auth.ts";
import { createXClient } from "../../driven/x/client.ts";
import { createGrokInsightSource } from "../../driven/grok/insight.ts";
import { createHarvest } from "../../../application/harvest.ts";
import { createInsightFetcher } from "../../../application/x-insight.ts";
import type { HarvestSource } from "../../../ports/driving/harvest.ts";

const HELP = `xmarks — atomic ops for harvesting X likes/bookmarks

Usage:
  xmarks auth                                  Run X OAuth 2.0 PKCE flow and store tokens
  xmarks me                                    Print authenticated user as JSON
  xmarks fetch --source <likes|bookmarks>      Fetch posts as JSON array (stdout)
                [--limit <5..100>] [--since <iso>] [--until <iso>] [--out <file>]
  xmarks thread <conversation-id> <author-id>  Fetch author thread as JSON object (stdout)
                [--out <file>]
  xmarks tweet <tweet-id>                      Fetch a single tweet/article by ID (stdout)
                [--out <file>]
  xmarks article <tweet-id>                    Fetch X article body via Grok (stdout, markdown)
                [--out <file>]   (requires XAI_API_KEY)
  xmarks video <tweet-id>                      Summarize attached video via Grok (stdout, markdown)
                [--out <file>]   (requires XAI_API_KEY)
  xmarks image <tweet-id>                      Describe attached image(s) via Grok (stdout, markdown)
                [--out <file>]   (requires XAI_API_KEY)

All non-auth commands print machine-readable JSON to stdout.
With --out, also write the same JSON to <file> (for caching across runs).
Persistence to Notion is handled by Claude Code via the /xmarks skill (Notion MCP).
`;

const writeJsonOut = async (data: unknown, out: string | undefined): Promise<void> => {
  const json = JSON.stringify(data);
  console.log(json);
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await Bun.write(out, json);
    const count = Array.isArray(data) ? data.length : data === null ? 0 : 1;
    console.error(`✓ wrote ${count} item(s) to ${out}`);
  }
};

const buildHarvest = () => {
  const config = loadConfig();
  const secrets = createSecretStore(config);
  const x = createXClient(config, secrets);
  return createHarvest({ x });
};

const runAuth = async (): Promise<void> => {
  const config = loadConfig();
  const secrets = createSecretStore(config);
  const { url, state, codeVerifier } = startAuthorization(config);

  const redirect = new URL(config.x.redirectUri);
  const port = Number(redirect.port || "8787");

  console.error("\nOpen this URL in your browser to authorize xmarks:\n");
  console.error(url.toString());
  console.error(`\nWaiting for callback on ${redirect.origin}${redirect.pathname} ...`);

  const tokens = await new Promise<Awaited<ReturnType<typeof exchangeCode>>>((resolve, reject) => {
    const server = Bun.serve({
      port,
      hostname: redirect.hostname,
      async fetch(req) {
        const reqUrl = new URL(req.url);
        if (reqUrl.pathname !== redirect.pathname) {
          return new Response("Not found", { status: 404 });
        }
        const code = reqUrl.searchParams.get("code");
        const returnedState = reqUrl.searchParams.get("state");
        if (!code || returnedState !== state) {
          server.stop();
          reject(new Error("Invalid callback (missing code or state mismatch)"));
          return new Response("Authorization failed", { status: 400 });
        }
        try {
          const result = await exchangeCode(config, code, codeVerifier);
          server.stop();
          resolve(result);
          return new Response("Authorized! You can close this tab.");
        } catch (err) {
          server.stop();
          reject(err as Error);
          return new Response("Token exchange failed", { status: 500 });
        }
      },
    });
  });

  await persistTokens(secrets, tokens);
  console.error("✓ X OAuth tokens stored.");
};

const runMe = async (): Promise<void> => {
  const harvest = buildHarvest();
  const me = await harvest.me();
  console.log(JSON.stringify(me));
};

const parseIsoDate = (input: string | undefined, name: string): string | undefined => {
  if (input === undefined) return undefined;
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) {
    throw new Error(
      `Invalid ${name}: ${input} (expect ISO 8601, e.g. 2026-05-01 or 2026-05-01T00:00:00Z)`,
    );
  }
  return new Date(ms).toISOString();
};

const runFetch = async (rawArgs: string[]): Promise<void> => {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      source: { type: "string" },
      limit: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      out: { type: "string" },
    },
    allowPositionals: false,
  });

  const source = values.source as HarvestSource | undefined;
  if (source !== "likes" && source !== "bookmarks") {
    throw new Error("--source must be one of: likes, bookmarks");
  }
  const limit = values.limit ? Number(values.limit) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 5 || limit > 100)) {
    throw new Error(`Invalid --limit: ${values.limit} (must be 5..100; X API max_results minimum is 5)`);
  }
  const since = parseIsoDate(values.since, "--since");
  const until = parseIsoDate(values.until, "--until");
  if (since && until && Date.parse(since) > Date.parse(until)) {
    throw new Error(`--since (${since}) is after --until (${until})`);
  }

  const harvest = buildHarvest();
  const items = await harvest.fetch(source, { limit, since, until });
  await writeJsonOut(items, values.out);
};

const runThread = async (rawArgs: string[]): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    options: { out: { type: "string" } },
    allowPositionals: true,
  });
  const [conversationId, authorId] = positionals;
  if (!conversationId || !authorId) {
    throw new Error("Usage: xmarks thread <conversation-id> <author-id> [--out <file>]");
  }
  const harvest = buildHarvest();
  const thread = await harvest.thread(conversationId, authorId);
  await writeJsonOut(thread ?? null, values.out);
};

const runTweet = async (rawArgs: string[]): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    options: { out: { type: "string" } },
    allowPositionals: true,
  });
  const [tweetId] = positionals;
  if (!tweetId) {
    throw new Error("Usage: xmarks tweet <tweet-id> [--out <file>]");
  }
  const harvest = buildHarvest();
  const post = await harvest.tweet(tweetId);
  await writeJsonOut(post ?? null, values.out);
};

const runInsight = async (
  kind: "article" | "video" | "image",
  rawArgs: string[],
): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    options: { out: { type: "string" } },
    allowPositionals: true,
  });
  const [tweetId] = positionals;
  if (!tweetId) {
    throw new Error(`Usage: xmarks ${kind} <tweet-id> [--out <file>]`);
  }
  const config = loadConfig();
  if (!config.xai) {
    throw new Error(`XAI_API_KEY is not set. Set it in .env to enable ${kind} retrieval.`);
  }
  const grok = createGrokInsightSource({ apiKey: config.xai.apiKey, model: config.xai.model });
  const fetcher = createInsightFetcher(grok);
  const body =
    kind === "article"
      ? await fetcher.article(tweetId)
      : kind === "video"
        ? await fetcher.video(tweetId)
        : await fetcher.image(tweetId);
  if (values.out) {
    await Bun.write(values.out, body ?? "");
    console.error(`✓ wrote ${body?.length ?? 0} chars to ${values.out}`);
  }
  if (body) {
    console.log(body);
  } else {
    console.error(`[${kind}] nothing retrieved`);
    process.exitCode = 2;
  }
};

export const main = async (argv: string[]): Promise<number> => {
  const [, , command, ...rest] = argv;
  try {
    switch (command) {
      case "auth":
        await runAuth();
        return 0;
      case "me":
        await runMe();
        return 0;
      case "fetch":
        await runFetch(rest);
        return 0;
      case "thread":
        await runThread(rest);
        return 0;
      case "tweet":
        await runTweet(rest);
        return 0;
      case "article":
        await runInsight("article", rest);
        return typeof process.exitCode === "number" ? process.exitCode : 0;
      case "video":
        await runInsight("video", rest);
        return typeof process.exitCode === "number" ? process.exitCode : 0;
      case "image":
        await runInsight("image", rest);
        return typeof process.exitCode === "number" ? process.exitCode : 0;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return 0;
      default:
        console.error(`Unknown command: ${command}\n`);
        console.error(HELP);
        return 1;
    }
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
};
