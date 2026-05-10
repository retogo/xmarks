import type { Post, PostId, Thread, UserId } from "../../domain/post.ts";
import type { AuthenticatedUser } from "../driving/harvest.ts";

export type FetchOptions = {
  limit?: number;
  since?: string;
  until?: string;
};

export interface XSource {
  fetchLikes(userId: UserId, options?: FetchOptions): Promise<Post[]>;
  fetchBookmarks(options?: FetchOptions): Promise<Post[]>;
  fetchAuthorThread(conversationId: PostId, authorId: UserId): Promise<Thread | undefined>;
  fetchTweet(id: PostId): Promise<Post | undefined>;
  getAuthenticatedUser(): Promise<AuthenticatedUser>;
}
