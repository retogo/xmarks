import type { Post, PostId, Thread, UserId } from "../../domain/post.ts";

export type { Post } from "../../domain/post.ts";

export type HarvestSource = "likes" | "bookmarks";

export type HarvestOptions = {
  limit?: number;
  since?: string;
  until?: string;
};

export type HarvestedPost = {
  pickedVia: HarvestSource;
  post: Post;
};

export type AuthenticatedUser = {
  id: UserId;
  username: string;
  name: string;
};

export interface Harvest {
  me(): Promise<AuthenticatedUser>;
  fetch(source: HarvestSource, options?: HarvestOptions): Promise<HarvestedPost[]>;
  thread(conversationId: PostId, authorId: UserId): Promise<Thread | undefined>;
  tweet(id: PostId): Promise<Post | undefined>;
}
