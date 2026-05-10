import type { PostId } from "../../domain/post.ts";

export interface XInsightSource {
  fetchArticleBody(postId: PostId): Promise<string | undefined>;
  fetchVideoSummary(postId: PostId): Promise<string | undefined>;
  fetchImageDescription(postId: PostId): Promise<string | undefined>;
}
