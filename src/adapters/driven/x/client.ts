import type { Config } from "../../../config.ts";
import type { Post, PostId, Thread, UserId } from "../../../domain/post.ts";
import type { FetchOptions, XSource } from "../../../ports/driven/x-source.ts";
import type { SecretStore } from "../../../ports/driven/secret-store.ts";
import { loadAccessToken } from "./auth.ts";
import { toPost, type ApiIncludes, type ApiTweet } from "./mapper.ts";

type CollectOptions = FetchOptions;

const API_BASE = "https://api.x.com/2";

const TWEET_FIELDS = [
  "id",
  "text",
  "author_id",
  "conversation_id",
  "created_at",
  "in_reply_to_user_id",
  "referenced_tweets",
  "attachments",
  "entities",
  "note_tweet",
  "article",
].join(",");

const USER_FIELDS = ["id", "username", "name"].join(",");
const MEDIA_FIELDS = ["media_key", "type", "url", "preview_image_url"].join(",");
const EXPANSIONS = [
  "author_id",
  "attachments.media_keys",
  "referenced_tweets.id",
  "referenced_tweets.id.author_id",
].join(",");

type ListResponse = {
  data?: ApiTweet[];
  includes?: ApiIncludes;
  meta?: { next_token?: string };
};

export const createXClient = (config: Config, secrets: SecretStore): XSource => {
  const callJson = async <T>(path: string, params: Record<string, string>): Promise<T> => {
    const token = await loadAccessToken(config, secrets);
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`X API ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  };

  const collect = async (
    path: string,
    baseParams: Record<string, string>,
    options: CollectOptions = {},
  ): Promise<Post[]> => {
    const { limit, since, until } = options;
    const sinceMs = since ? Date.parse(since) : undefined;
    const untilMs = until ? Date.parse(until) : undefined;
    const filtersActive = sinceMs !== undefined || untilMs !== undefined;
    const acc: Post[] = [];
    let nextToken: string | undefined;
    do {
      const params: Record<string, string> = {
        ...baseParams,
        "tweet.fields": TWEET_FIELDS,
        "user.fields": USER_FIELDS,
        "media.fields": MEDIA_FIELDS,
        expansions: EXPANSIONS,
        max_results: String(filtersActive ? 100 : (limit ?? 100)),
      };
      if (nextToken) params.pagination_token = nextToken;
      const res = await callJson<ListResponse>(path, params);
      const includes = res.includes ?? {};
      for (const t of res.data ?? []) {
        const post = toPost(t, includes);
        if (filtersActive) {
          const tMs = Date.parse(post.createdAt);
          if (untilMs !== undefined && tMs > untilMs) continue;
          if (sinceMs !== undefined && tMs < sinceMs) {
            return limit ? acc.slice(0, limit) : acc;
          }
        }
        acc.push(post);
        if (limit && acc.length >= limit) return acc.slice(0, limit);
      }
      nextToken = res.meta?.next_token;
    } while (nextToken);
    return acc;
  };

  let mePromise: Promise<{ id: string; username: string; name: string }> | undefined;
  const me = () => {
    if (!mePromise) {
      mePromise = callJson<{ data: { id: string; username: string; name: string } }>(
        "/users/me",
        { "user.fields": USER_FIELDS },
      ).then((res) => ({
        id: res.data.id,
        username: res.data.username,
        name: res.data.name,
      }));
    }
    return mePromise;
  };

  return {
    async getAuthenticatedUser() {
      return me();
    },
    async fetchLikes(userId, options) {
      return collect(`/users/${userId}/liked_tweets`, {}, options);
    },
    async fetchBookmarks(options) {
      const m = await me();
      return collect(`/users/${m.id}/bookmarks`, {}, options);
    },
    async fetchAuthorThread(conversationId: PostId, authorId: UserId): Promise<Thread | undefined> {
      const query = `conversation_id:${conversationId} from:${authorId}`;
      const posts = await collect("/tweets/search/recent", { query });
      if (posts.length === 0) return undefined;
      posts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const root = posts.find((p) => p.id === conversationId) ?? posts[0]!;
      return { rootPostId: root.id, authorId, posts };
    },
    async fetchTweet(id: PostId): Promise<Post | undefined> {
      try {
        const res = await callJson<{ data?: ApiTweet; includes?: ApiIncludes }>(
          `/tweets/${id}`,
          {
            "tweet.fields": TWEET_FIELDS,
            "user.fields": USER_FIELDS,
            "media.fields": MEDIA_FIELDS,
            expansions: EXPANSIONS,
          },
        );
        if (!res.data) return undefined;
        return toPost(res.data, res.includes ?? {});
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes(" 404") || msg.includes(" 403")) return undefined;
        throw err;
      }
    },
  };
};
