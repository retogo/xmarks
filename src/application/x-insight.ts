import type { PostId } from "../domain/post.ts";
import type { XInsightSource } from "../ports/driven/x-insight.ts";

export type InsightFetcher = {
  article(postId: PostId): Promise<string | undefined>;
  video(postId: PostId): Promise<string | undefined>;
  image(postId: PostId): Promise<string | undefined>;
};

export const createInsightFetcher = (source: XInsightSource): InsightFetcher => ({
  async article(postId: PostId): Promise<string | undefined> {
    return source.fetchArticleBody(postId);
  },
  async video(postId: PostId): Promise<string | undefined> {
    return source.fetchVideoSummary(postId);
  },
  async image(postId: PostId): Promise<string | undefined> {
    return source.fetchImageDescription(postId);
  },
});
