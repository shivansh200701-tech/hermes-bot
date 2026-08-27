export default {
     async fetch(req, env) {
       const url = new URL(req.url);
         if (url.pathname === "/webhook") return this.handle(await req.json(), env);
           return new Response("Hermes Ultimate v5.1 OK");
            },
             async handle(u, env) {
               const chat = u.message?.chat?.id;
                 const text = (u.message?.text || "").trim();
                   if (!chat ||!text) return new Response("ok");
                     const send = (t) => fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:chat,text:String(t).slice(0,4000)})});
                       const key = "h_" + chat;
                         let mem = {skills:[]};
                           if (env.MEMORY) try { mem = await env.MEMORY.get(key,"json") || mem } catch {}
                             const save = async () => { if (env.MEMORY) try { await env.MEMORY.put(key, JSON.stringify(mem)) } catch {} };
                               const think = async (sys, user) => {
                                   const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST", headers:{Authorization:"Bearer " + env.GROQ_API_KEY,"Content-Type":"application/json"}, body: JSON.stringify({model:"llama-3.1-8b-instant", messages:[{role:"system",content:"You are Hermes. Think then answer."},{role:"system",content:sys},{role:"user",content:user}], temperature:0.3})}).then(x=>x.json());
                                       return r.choices[0].message.content;
                                         };
                                           if (/(learn|remember|teach|when i say)/i.test(text)) {
                                               const parsed = await think("Extract JSON with name keywords type action", text);
                                                   let s; try { s = JSON.parse(parsed.match(/\{[\s\S]*\}/)[0]) } catch {}
                                                       if (s && s.name) { s.usage=0; mem.skills = mem.skills.filter(x=>x.name!==s.name); mem.skills.push(s); await save(); await send("Learned " + s.name); return new Response("ok"); }
                                                         }
                                                           for (const s of mem.skills) {
                                                               if (s.keywords.some(k => text.toLowerCase().includes(k.toLowerCase()))) {
                                                                     s.usage++; let out = await think(s.action, text); await save(); await send("[" + s.name + " #" + s.usage + "] " + out); return new Response("ok");
                                                                         }
                                                                           }
                                                                             if (text === "/skills") {
                                                                                 const list = mem.skills.map(s=>s.name).join(", ");
                                                                                     await send(list || "No skills yet");
                                                                                         return new Response("ok");
                                                                                           }
                                                                                             const ans = await think("", text); await send(ans); return new Response("ok");
                                                                                              }
                                                                                              }