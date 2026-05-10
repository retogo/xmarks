export type PostId = string;
export type UserId = string;

export type PostAuthor = {
  id: UserId;
  username: string;
  name: string;
};

export type PostMedia = {
  type: "photo" | "video" | "animated_gif";
  url: string;
};

export type ReferenceType = "quoted" | "retweeted";

export type PostUrl = {
  shortUrl: string;
  expandedUrl: string;
  displayUrl: string;
  title?: string;
  description?: string;
};

export type ArticleInfo = {
  title: string;
  previewText?: string;
};

export type Post = {
  id: PostId;
  url: string;
  author: PostAuthor;
  text: string;
  createdAt: string;
  conversationId: PostId;
  inReplyToPostId?: PostId;
  media: PostMedia[];
  urls: PostUrl[];
  article?: ArticleInfo;
  referencedPost?: { type: ReferenceType; post: Post };
};

export type Thread = {
  rootPostId: PostId;
  authorId: UserId;
  posts: Post[];
};
