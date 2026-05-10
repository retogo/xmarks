import type { XSource } from "../ports/driven/x-source.ts";
import type {
  AuthenticatedUser,
  Harvest,
  HarvestOptions,
  HarvestSource,
  HarvestedPost,
} from "../ports/driving/harvest.ts";
import type { Post, PostId, Thread, UserId } from "../domain/post.ts";

type Deps = { x: XSource };

export const createHarvest = ({ x }: Deps): Harvest => ({
  async me(): Promise<AuthenticatedUser> {
    return x.getAuthenticatedUser();
  },
  async fetch(source: HarvestSource, options?: HarvestOptions): Promise<HarvestedPost[]> {
    if (source === "likes") {
      const me = await x.getAuthenticatedUser();
      const posts = await x.fetchLikes(me.id, options);
      return posts.map((post) => ({ pickedVia: "likes", post }));
    }
    const posts = await x.fetchBookmarks(options);
    return posts.map((post) => ({ pickedVia: "bookmarks", post }));
  },
  async thread(conversationId: PostId, authorId: UserId): Promise<Thread | undefined> {
    return x.fetchAuthorThread(conversationId, authorId);
  },
  async tweet(id: PostId): Promise<Post | undefined> {
    return x.fetchTweet(id);
  },
});
