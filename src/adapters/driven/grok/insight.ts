import type { PostId } from "../../../domain/post.ts";
import type { XInsightSource } from "../../../ports/driven/x-insight.ts";
import { createGrokClient, type GrokClient } from "./api.ts";

const articlePrompt = (postId: PostId): string =>
  `Use the x_search tool with x_thread_fetch and post_id=${postId} to retrieve the X article attached to that post. Return ONLY the article body content as clean markdown — preserve headings, lists, code blocks, and inline links. Do not add commentary, summary, or framing text. If the post has no article body or the body cannot be retrieved, output exactly the literal string "<no-article>".`;

const videoPrompt = (postId: PostId): string =>
  `Use x_thread_fetch on post_id=${postId} to load the X post, then use view_x_video on every video URL attached to that post (or to its quoted/referenced post). Return a concise markdown summary of WHAT IS ACTUALLY SHOWN AND SAID in the video(s) — UI elements, code, demo steps, key claims, on-screen metrics, narration. If multiple videos exist, label each as "### Video N". If no video can be retrieved or analyzed, output exactly "<no-video>". Never speculate beyond what the video shows.`;

const imagePrompt = (postId: PostId): string =>
  `Use x_thread_fetch on post_id=${postId} to load the X post, then use view_image on every image URL attached to that post (or to its quoted/referenced post). Return a concise markdown description of WHAT IS ACTUALLY SHOWN IN THE IMAGES — transcribe any visible text VERBATIM, describe charts/diagrams structure, identify code language and content, list UI elements, surface URLs/citations/paper names if any. Label multiple images as "### Image N". If no image can be retrieved or analyzed, output exactly "<no-image>". Never speculate beyond what the image shows.`;

export type GrokInsightOptions = {
  apiKey: string;
  model?: string;
  client?: GrokClient;
};

export const createGrokInsightSource = ({
  apiKey,
  model = "grok-4-fast-non-reasoning",
  client,
}: GrokInsightOptions): XInsightSource => {
  const grok = client ?? createGrokClient(apiKey);

  const run = async (prompt: string, enableVideo: boolean): Promise<string | undefined> => {
    const { text } = await grok.call({
      model,
      input: [{ role: "user", content: prompt }],
      tools: [
        {
          type: "x_search",
          enable_image_understanding: true,
          enable_video_understanding: enableVideo,
        },
      ],
    });
    if (!text) return undefined;
    const trimmed = text.trim();
    if (
      trimmed === "<no-article>" ||
      trimmed === "<no-video>" ||
      trimmed === "<no-image>"
    ) {
      return undefined;
    }
    return text;
  };

  return {
    async fetchArticleBody(postId: PostId): Promise<string | undefined> {
      return run(articlePrompt(postId), false);
    },
    async fetchVideoSummary(postId: PostId): Promise<string | undefined> {
      return run(videoPrompt(postId), true);
    },
    async fetchImageDescription(postId: PostId): Promise<string | undefined> {
      return run(imagePrompt(postId), false);
    },
  };
};
