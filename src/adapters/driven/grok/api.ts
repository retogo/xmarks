const ENDPOINT = "https://api.x.ai/v1/responses";

export type XSearchTool = {
  type: "x_search";
  enable_image_understanding?: boolean;
  enable_video_understanding?: boolean;
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
};

export type WebSearchTool = { type: "web_search" };

export type GrokTool = XSearchTool | WebSearchTool;

export type GrokMessage = {
  role: "user" | "system" | "assistant";
  content: string;
};

export type GrokRequest = {
  model: string;
  input: GrokMessage[];
  tools?: GrokTool[];
};

export type GrokRawOutput =
  | { type: "message"; content?: Array<{ type: string; text?: string }> }
  | { type: string };

export type GrokRawResponse = {
  output?: GrokRawOutput[];
  usage?: { cost_in_usd_ticks?: number };
};

export type GrokCallResult = {
  text: string | undefined;
  raw: GrokRawResponse;
};

export type GrokClient = {
  call(req: GrokRequest): Promise<GrokCallResult>;
};

const extractText = (raw: GrokRawResponse): string | undefined => {
  const message = raw.output?.find(
    (o): o is Extract<GrokRawOutput, { type: "message" }> => o.type === "message",
  );
  return message?.content?.find((c) => c.type === "output_text")?.text;
};

export const createGrokClient = (apiKey: string): GrokClient => ({
  async call(req: GrokRequest): Promise<GrokCallResult> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`xAI API failed: ${res.status} ${await res.text()}`);
    }
    const raw = (await res.json()) as GrokRawResponse;
    if (raw.usage?.cost_in_usd_ticks !== undefined) {
      const usd = raw.usage.cost_in_usd_ticks / 1_000_000_000;
      console.error(`[grok] cost: $${usd.toFixed(4)}`);
    }
    return { text: extractText(raw), raw };
  },
});
