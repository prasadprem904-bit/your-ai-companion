import { createServerFn } from "@tanstack/react-start";

type Msg = { role: "user" | "assistant" | "system"; content: string };

export const chatWithCora = createServerFn({ method: "POST" })
  .inputValidator((data: { messages: Msg[] }) => data)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You are Cora, an AI assistant powered by CoreAI. Whenever you introduce yourself, always say exactly: \"Hi, I'm Cora — your AI assistant powered by CoreAI.\" Never claim to be made by Google, OpenAI, or any other company. Keep replies short, natural, and conversational — usually 1-3 sentences. Reply in the same language the user speaks (Hindi, Hinglish, or English).",
          },
          ...data.messages,
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      if (res.status === 429) throw new Error("Rate limit. Try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      throw new Error(`AI error: ${t}`);
    }
    const json = await res.json();
    const reply: string = json.choices?.[0]?.message?.content ?? "";
    return { reply };
  });
