import type {
  ArticleInfo,
  Post,
  PostMedia,
  PostUrl,
  ReferenceType,
} from "../../../domain/post.ts";

type ApiUser = { id: string; username: string; name: string };

type ApiMedia = {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
};

type ApiUrlEntity = {
  url: string;
  expanded_url: string;
  display_url: string;
  unwound_url?: string;
  title?: string;
  description?: string;
};

export type ApiTweet = {
  id: string;
  text: string;
  author_id: string;
  conversation_id: string;
  created_at: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: { type: "replied_to" | "quoted" | "retweeted"; id: string }[];
  attachments?: { media_keys?: string[] };
  entities?: { urls?: ApiUrlEntity[] };
  note_tweet?: { text: string; entities?: { urls?: ApiUrlEntity[] } };
  article?: { title?: string; preview_text?: string };
};

export type ApiIncludes = {
  users?: ApiUser[];
  media?: ApiMedia[];
  tweets?: ApiTweet[];
};

const toMedia = (keys: string[] | undefined, includes: ApiIncludes): PostMedia[] => {
  if (!keys || !includes.media) return [];
  const byKey = new Map(includes.media.map((m) => [m.media_key, m]));
  return keys
    .map((key) => byKey.get(key))
    .filter((m): m is ApiMedia => m !== undefined)
    .map((m) => ({ type: m.type, url: m.url ?? m.preview_image_url ?? "" }))
    .filter((m) => m.url.length > 0);
};

const REFERENCE_TYPES: ReferenceType[] = ["quoted", "retweeted"];

const toUrls = (entities: ApiTweet["entities"]): PostUrl[] => {
  if (!entities?.urls) return [];
  return entities.urls.map((u) => ({
    shortUrl: u.url,
    expandedUrl: u.unwound_url ?? u.expanded_url,
    displayUrl: u.display_url,
    title: u.title,
    description: u.description,
  }));
};

export const toPost = (tweet: ApiTweet, includes: ApiIncludes, depth = 0): Post => {
  const author = includes.users?.find((u) => u.id === tweet.author_id);
  if (!author) throw new Error(`Author not in includes for tweet ${tweet.id}`);
  const repliedTo = tweet.referenced_tweets?.find((r) => r.type === "replied_to");

  let referencedPost: Post["referencedPost"];
  if (depth < 1) {
    const ref = tweet.referenced_tweets?.find((r) =>
      REFERENCE_TYPES.includes(r.type as ReferenceType),
    );
    if (ref) {
      const refTweet = includes.tweets?.find((t) => t.id === ref.id);
      if (refTweet) {
        referencedPost = {
          type: ref.type as ReferenceType,
          post: toPost(refTweet, includes, depth + 1),
        };
      }
    }
  }

  const text = tweet.note_tweet?.text ?? tweet.text;
  const baseUrls = toUrls(tweet.entities);
  const noteUrls = tweet.note_tweet?.entities ? toUrls(tweet.note_tweet.entities) : [];
  const urls = noteUrls.length > 0 ? noteUrls : baseUrls;
  const article: ArticleInfo | undefined = tweet.article?.title
    ? { title: tweet.article.title, previewText: tweet.article.preview_text }
    : undefined;

  return {
    id: tweet.id,
    url: `https://x.com/${author.username}/status/${tweet.id}`,
    author: { id: author.id, username: author.username, name: author.name },
    text,
    createdAt: tweet.created_at,
    conversationId: tweet.conversation_id,
    inReplyToPostId: repliedTo?.id,
    media: toMedia(tweet.attachments?.media_keys, includes),
    urls,
    article,
    referencedPost,
  };
};
