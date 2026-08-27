export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Health check
    if (request.method!== "POST") {
      return new Response("Hermes Employee v9 - Auto Learning + Browser + Scheduler is Live");
    }

    try {
      const update = await request.json();
      const chatId = update.message?.chat?.id;
      const text = update.message?.text || "";
      if (!chatId ||!text) return new Response("ok");

      // KV - supports MEMORY or SKILLS binding
      const KV = env.MEMORY || env.SKILLS;
      const memKey = `mem_${chatId}`;
      let mem = KV? await KV.get(memKey, "json") : null;
      if (!mem) mem = { history: [], facts: [], skills: [], tasks: [] };

      // --- Helpers ---
      const webSearch = async (q) => {
        try {
          const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&pretty=1`);
          const j = await r.json();
          return j.AbstractText || j.RelatedTopics?.[0]?.Text || JSON.stringify(j).slice(0, 2000);
        } catch { return "Search failed"; }
      };

      const webBrowse = async (targetUrl) => {
        try {
          if (env.BROWSER) {
            const puppeteer = await import("@cloudflare/puppeteer");
            const browser = await puppeteer.launch(env.BROWSER);
            const page = await browser.newPage();
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
            const content = await page.content();
            await browser.close();
            return content.slice(0, 10000);
          } else {
            // Fallback to Jina AI reader - best for text
            const cleanUrl = targetUrl.replace(/^https?:\/\//, "");
            const r = await fetch(`https://r.jina.ai/http://${cleanUrl}`, {
              headers: { "User-Agent": "Mozilla/5.0" }
            });
            return (await r.text()).slice(0, 8000);
          }
        } catch (e) { return "Browse failed: " + e.message; }
      };

      const scheduleTask = async (task, delayMinutes) => {
        if (!KV) return "KV not connected, can't schedule";
        const due = Date.now() + delayMinutes * 60000;
        const key = `task_${due}_${chatId}_${Date.now()}`;
        await KV.put(key, JSON.stringify({ chat_id: chatId, task, due }));
        return `✅ Scheduled: "${task}" in ${delayMinutes} minutes`;
      };

      // --- System Prompt with Memory ---
      const systemPrompt = `
You are Hermes, an autonomous employee AI like ChatGPT, but you work 24/7.
You have permanent memory and you learn organically.

Current Time: ${new Date().toISOString()}
User Facts you remember forever: ${mem.facts.join("; ") || "none yet"}
Skills you already learned: ${mem.skills.map(s => `${s.name}: ${s.instruction}`).join("; ") || "none"}

Capabilities:
- web_search: search the internet
- web_browse: open any URL with real browser and read it
- schedule_task: schedule reminders, tasks, periodic checks (employee work)
- create_skill: when user teaches you something new, save it forever as a skill

Organic Learning Rules:
1. If user teaches you a pattern ("when I say X, do Y" or "always do Z for me"), call create_skill automatically.
2. If user shares personal info (name, location, likes