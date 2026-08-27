export default {
  async fetch(request, env) {
    if (request.method!== "POST") {
      return new Response("Hermes Employee FREE OK");
    }
    try {
      const update = await request.json();
      const chatId = update.message?.chat?.id;
      const text = update.message?.text || "";
      if (!chatId ||!text) return new Response("ok");

      const KV = env.MEMORY || env.SKILLS;
      const memKey = "mem_" + chatId;
      let mem = KV? await KV.get(memKey, "json") : null;
      if (!mem) mem = { history: [], facts: [], skills: [] };

      const webSearch = async (q) => {
        try {
          const r = await fetch("https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json");
          const j = await r.json();
          return j.AbstractText || "No result";
        } catch { return "Search failed"; }
      };

      const webBrowse = async (u) => {
        try {
          const clean = u.replace(/^https?:\/\//, "");
          const r = await fetch("https://r.jina.ai/http://" + clean);
          return (await r.text()).slice(0, 8000);
        } catch (e) { return "Browse failed"; }
      };

      const scheduleTask = async (task, mins) => {
        if (!KV) return "No KV";
        const due = Date.now() + mins * 60000;
        await KV.put("task_" + due + "_" + chatId, JSON.stringify({ chat_id: chatId, task: task, due: due }));
        return "Scheduled in " + mins + "m: " + task;
      };

      const factsText = mem.facts.join(", ");
      const skillsText = mem.skills.map(s => s.name).join(", ");
      const systemPrompt = "You are Hermes Employee AI. Facts: " + factsText + ". Skills: " + skillsText + ". Tools: web_search, web_browse, schedule_task, create_skill. Learn organically.";

      let messages = [
        { role: "system", content: systemPrompt }
      ];
      for (let h of mem.history.slice(-6)) {
        messages.push({ role: "user", content: h.u });
        messages.push({ role: "assistant", content: h.a });
      }
      messages.push({ role: "user", content: text });

      const tools = [
        { type: "function", function: { name: "web_search", description: "Search web", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
        { type: "function", function: { name: "web_browse", description: "Browse URL", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
        { type: "function", function: { name: "schedule_task", description: "Schedule task", parameters: { type: "object", properties: { task: { type: "string" }, delay_minutes: { type: "number" } }, required: ["task", "delay_minutes"] } } },
        { type: "function", function: { name: "create_skill", description: "Create skill", parameters: { type: "object", properties: { name: { type: "string" }, instruction: { type: "string" } }, required: ["name", "instruction"] } } }
      ];

      let reply = "";
      for (let i = 0; i < 4; i++) {
        const g = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.GROQ_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: messages, tools: tools, tool_choice: "auto" })
        });
        const j = await g.json();
        const ch = j.choices && j.choices[0]? j.choices[0].message : null;
        if (!ch) break;
        if (ch.tool_calls) {
          messages.push(ch);
          for (let tc of ch.tool_calls) {
            let fn = tc.function.name;
            let ar = JSON.parse(tc.function.arguments || "{}");
            let rs = "";
            if (fn === "web_search") rs = await webSearch(ar.query);
            if (fn === "web_browse") rs = await webBrowse(ar.url);
            if (fn === "schedule_task") rs = await scheduleTask(ar.task, ar.delay_minutes);
            if (fn === "create_skill") {
              mem.skills.push({ name: ar.name, instruction: ar.instruction });
              rs = "Skill " + ar.name + " saved";
            }
            messages.push({ role: "tool", tool_call_id: tc.id, content: rs });
          }
        } else {
          reply = ch.content;
          break;
        }
      }

      if (KV) {
        mem.history.push({ u: text, a: reply });
        mem.history = mem.history.slice(-20);
        await KV.put(memKey, JSON.stringify(mem));
      }

      await fetch("https://api.telegram.org/bot" + env.TELEGRAM_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: reply || "Done" })
      });

      return new Response("ok");
    } catch (e) {
      return new Response("ok");
    }
  },

  async scheduled(event, env, ctx) {
    const KV = env.MEMORY || env.SKILLS;
    if (!KV) return;
    const list = await KV.list({ prefix: "task_" });
    for (let k of list.keys) {
      const v = await KV.get(k.name);
      if (!v) continue;
      const t = JSON.parse(v);
      if (t.due <= Date.now()) {
        await fetch("https://api.telegram.org/bot" + env.TELEGRAM_TOKEN + "/sendMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: t.chat_id, text: "Task: " + t.task })
        });
        await KV.delete(k.name);
      }
    }
  }
}