// This runs on the server, hidden from the public
export default async function handler(req, res) {
  const { userMessage, userKey, history } = req.body;
  const pool = process.env.MY_KEYS_POOL.split(','); // Secret keys stored in Vercel/Netlify settings

  const keysToTry = userKey ? [userKey, ...pool] : pool;
  const models = ["google/gemini-2.0-flash-001", "openai/gpt-4o-mini"]; // Fallback models

  for (const key of keysToTry) {
    for (const model of models) {
      const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model, messages: [...history, {role: "user", content: userMessage}] })
      });

      if (orResponse.ok) {
        const data = await orResponse.json();
        return res.status(200).json({ reply: data.choices[0].message.content });
      }
    }
  }
  res.status(500).json({ error: "All keys/models failed" });
}