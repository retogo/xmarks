import { afterEach, expect, mock, test } from "bun:test";
import type { Config } from "../../../config.ts";
import type { SecretStore } from "../../../ports/driven/secret-store.ts";
import { createXClient } from "./client.ts";

const ME = { id: "42", username: "me", name: "Me" };
const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_PAGE_SIZE = 50;

const config: Config = {
  x: { clientId: "client", redirectUri: "http://127.0.0.1:8787/callback" },
  secrets: { backend: "local", localHome: "/unused", gsm: { prefix: "xmarks" } },
};

const secrets: SecretStore = {
  get: async () =>
    JSON.stringify({ accessToken: "token", expiresAt: Date.now() + TOKEN_TTL_MS }),
  put: async () => {},
};

const tweet = (n: number) => ({
  id: String(n),
  text: `post ${n}`,
  author_id: ME.id,
  conversation_id: String(n),
  created_at: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
});

/** Serves `total` bookmarks newest-first, paginating by `max_results` like the X API. */
const fakeBookmarksApi = (total: number) => {
  const requests: URL[] = [];
  const handler = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push(url);
    if (url.pathname.endsWith("/users/me")) return Response.json({ data: ME });
    const pageSize = Number(url.searchParams.get("max_results"));
    const offset = Number(url.searchParams.get("pagination_token") ?? "0");
    const ids = Array.from({ length: total }, (_, i) => total - i).slice(offset, offset + pageSize);
    const next = offset + pageSize < total ? String(offset + pageSize) : undefined;
    return Response.json({
      data: ids.map(tweet),
      includes: { users: [ME] },
      meta: { result_count: ids.length, ...(next ? { next_token: next } : {}) },
    });
  };
  const bookmarkRequests = () => requests.filter((u) => u.pathname.endsWith("/bookmarks"));
  return { handler, bookmarkRequests };
};

const originalFetch = globalThis.fetch;
let api: ReturnType<typeof fakeBookmarksApi>;

const useApi = (total: number) => {
  api = fakeBookmarksApi(total);
  globalThis.fetch = mock(api.handler) as unknown as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("limit 未指定なら 1 ページあたり 50 件以下で要求する", async () => {
  useApi(120);
  await createXClient(config, secrets).fetchBookmarks();
  const sizes = api.bookmarkRequests().map((u) => Number(u.searchParams.get("max_results")));
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) expect(size).toBeLessThanOrEqual(MAX_PAGE_SIZE);
});

test("next_token を辿って全ページを結合する", async () => {
  useApi(120);
  const posts = await createXClient(config, secrets).fetchBookmarks();
  expect(posts.map((p) => p.id)).toEqual(Array.from({ length: 120 }, (_, i) => String(120 - i)));
});

test("limit が 1 ページを超えるなら複数ページから limit 件だけ返す", async () => {
  useApi(120);
  const posts = await createXClient(config, secrets).fetchBookmarks({ limit: 100 });
  expect(posts).toHaveLength(100);
  expect(api.bookmarkRequests()).toHaveLength(2);
});

test("limit が 1 ページに収まるならその件数で要求する", async () => {
  useApi(120);
  const posts = await createXClient(config, secrets).fetchBookmarks({ limit: 20 });
  expect(posts).toHaveLength(20);
  expect(api.bookmarkRequests().map((u) => u.searchParams.get("max_results"))).toEqual(["20"]);
});
