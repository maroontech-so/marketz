require("dotenv").config();
const db = require("better-sqlite3")("fincapita.sqlite");
const fetch = global.fetch;

async function groqEstimateTokens(text) {
  return Math.ceil((text || '').length / 3.5);
}

async function llmRewrite(text, sourceName) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  const reasoningEffort = process.env.GROQ_REASONING_EFFORT || 'low';
  const baseUrl = 'https://api.groq.com/openai/v1';

  const system = `You are a wire-service editor. Rewrite the article below in 3-5 short factual paragraphs of neutral prose. Preserve every name, number, date, and quoted phrase exactly. Do not add facts not present in the original. Output plain text only.`;

  const userPrompt = `Source: ${sourceName}\n\n${text.slice(0, 6000)}`;

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_completion_tokens: 2000,
        reasoning_effort: reasoningEffort,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`groq ${res.status}: ${errText.slice(0, 160)}`);
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    let content = msg?.content || msg?.reasoning || '';
    if (!content || content.trim().length < 80) return null;
    content = content
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
      .replace(/^.*?<\/thinking>\s*/i, '')
      .replace(/^.*?<\/reasoning>\s*/i, '')
      .replace(/^\s*[\*#]\s*reasoning:?[\s\S]*?(?=\n\w|\n$)/i, '')
      .trim();
    if (content.length < 80) return null;
    const html = content
      .split(/\n{2,}/)
      .map((p) => {
        const safe = p.trim()
          .replace(/&/g, '&')
          .replace(/</g, '<')
          .replace(/>/g, '>')
          .replace(/"/g, '"')
          .replace(/'/g, '&#039;');
        return safe ? `<p>${safe}</p>` : '';
      })
      .filter(Boolean)
      .join('\n');
    return { html, method: `llm:${model}` };
  } catch (err) {
    console.warn('[groq]', err.message);
    return null;
  }
}

async function test() {
  const row = db.prepare("SELECT content_html, source_name FROM articles WHERE id = ?").get("00de7d64-ad9a-498c-9e75-6adf4c513ad3");
  console.log("Input length:", row.content_html.length);
  const result = await llmRewrite(row.content_html, row.source_name);
  console.log("Result:", result);
  if (result) {
    console.log("Output length:", result.html.length);
    console.log("Output end:", result.html.slice(-300));
    db.prepare("UPDATE articles SET rewritten_html = ?, rewrite_method = ? WHERE id = ?").run(result.html, result.method, "00de7d64-ad9a-498c-9e75-6adf4c513ad3");
    console.log("Updated article");
  }
}

test().catch(console.error);