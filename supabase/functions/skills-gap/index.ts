import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduled-secret",
};

const PROJECT_CONTEXT = `Job Navigator (Job Compass) is a React + TypeScript + Vite + Tailwind CSS web app backed by Supabase (Postgres + Edge Functions) and the Anthropic Claude API.

WHAT IT DOES:
- Connects to Gmail via OAuth and scans job alert emails daily (pg_cron scheduled Edge Function)
- Extracts job listings from emails using Claude (claude-sonnet-4)
- Scores every job 0-10 against the user's CV using a two-step Claude pipeline (experience 0-5pts, skills 0-3pts, location 0-1pt, role fit 0-1pt)
- Stores jobs in Supabase Postgres; shows a kanban Pipeline page and a Dashboard
- Auto-runs ml-feedback to tune scoring hints based on user's Applied/Rejected history
- Auto-detects job status changes (Interviewing, Offer, Rejected) by re-reading Gmail
- Generates cover letters and interview prep via Claude
- Skills-gap analysis: identifies missing skills from recent job descriptions

CURRENT TECH STACK:
- Frontend: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, @hello-pangea/dnd (drag & drop), date-fns, Lucide icons
- Backend: Supabase Edge Functions (Deno/TypeScript), Supabase Postgres, pg_cron
- AI: Anthropic Claude API (claude-sonnet-4-20250514), prompt caching
- Auth: Supabase Auth + Google OAuth for Gmail
- Email: Resend API for digest emails
- Deployment: Supabase hosted

KEY PAIN POINTS / AREAS TO IMPROVE:
- Scoring accuracy (Claude sometimes misreads experience level)
- Gmail scanning speed (150s edge function timeout is tight)
- Job status change detection relies on keyword matching in email subjects
- No real-time notifications
- No mobile app`;

async function fetchSmitheryServers(): Promise<string> {
  try {
    const resp = await fetch("https://registry.smithery.ai/servers?pageSize=40&sort=createdAt&q=", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Smithery ${resp.status}`);
    const data = await resp.json();
    const servers = (data.servers || data.items || data || []).slice(0, 40);
    if (!Array.isArray(servers) || servers.length === 0) return "Smithery: no results";
    return "=== SMITHERY MCP REGISTRY (newest servers) ===\n" +
      servers.map((s: any) =>
        `- ${s.displayName || s.name || s.qualifiedName}: ${(s.description || "").substring(0, 120)}`
      ).join("\n");
  } catch (e: any) {
    console.warn("Smithery fetch failed:", e.message);
    return "Smithery: unavailable";
  }
}

async function fetchGitHubReadme(url: string, label: string): Promise<string> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`${label} ${resp.status}`);
    const text = await resp.text();
    // Take first 6000 chars (READMEs are huge)
    return `=== ${label} ===\n${text.substring(0, 6000)}`;
  } catch (e: any) {
    console.warn(`${label} fetch failed:`, e.message);
    return `${label}: unavailable`;
  }
}

async function searchWeb(query: string): Promise<string> {
  // DuckDuckGo instant answer API (no key needed, limited but free)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return "";
    const data = await resp.json();
    const results: string[] = [];
    if (data.AbstractText) results.push(data.AbstractText.substring(0, 300));
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics.slice(0, 8)) {
        if (t.Text) results.push(`• ${t.Text.substring(0, 150)}`);
      }
    }
    return results.length > 0 ? `=== WEB SEARCH: ${query} ===\n${results.join("\n")}` : "";
  } catch {
    return "";
  }
}

function buildEmailHtml(findings: any): string {
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const toolsHtml = (findings.top_tools || []).map((t: any) => `
    <div style="background:#1a1a2e;border:1px solid #2a2a4a;border-radius:10px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="background:#6c63ff;color:white;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:uppercase;">${t.impact || "tool"}</span>
        <span style="color:#e0e0ff;font-weight:600;font-size:15px;">${t.name}</span>
      </div>
      <p style="color:#aaa;font-size:13px;margin:0 0 8px 0;">${t.description || ""}</p>
      <p style="color:#6c63ff;font-size:12px;margin:0;"><strong>How it helps Job Compass:</strong> ${t.use_case || ""}</p>
      ${t.url ? `<a href="${t.url}" style="color:#aaa;font-size:11px;text-decoration:none;display:inline-block;margin-top:6px;">→ ${t.url}</a>` : ""}
    </div>
  `).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:28px;font-weight:800;background:linear-gradient(135deg,#6c63ff,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px;">
        Job Compass
      </div>
      <div style="color:#666;font-size:13px;">Weekly AI Skills Digest · ${date}</div>
    </div>

    <div style="background:#13132a;border:1px solid #2a2a4a;border-radius:14px;padding:24px;margin-bottom:24px;">
      <h2 style="color:#e0e0ff;font-size:16px;font-weight:700;margin:0 0 12px 0;">🔍 This Week's Top Claude / MCP Discoveries</h2>
      <p style="color:#999;font-size:13px;margin:0;">${findings.summary || "New tools and capabilities discovered from the MCP ecosystem."}</p>
    </div>

    ${toolsHtml}

    ${findings.integration_ideas?.length > 0 ? `
    <div style="background:#13132a;border:1px solid #2a2a4a;border-radius:14px;padding:20px;margin-top:20px;">
      <h3 style="color:#a78bfa;font-size:14px;font-weight:700;margin:0 0 10px 0;">💡 Integration Ideas</h3>
      <ul style="color:#aaa;font-size:13px;margin:0;padding-left:18px;">
        ${findings.integration_ideas.map((idea: string) => `<li style="margin-bottom:6px;">${idea}</li>`).join("")}
      </ul>
    </div>` : ""}

    <div style="text-align:center;margin-top:28px;color:#444;font-size:11px;">
      Job Compass · Weekly digest · Auto-generated by Claude
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: scheduled secret only (no user auth — this is a system job)
  const scheduledSecret = req.headers.get("x-scheduled-secret");
  const authHeader = req.headers.get("Authorization") || "";
  const expectedSecret = Deno.env.get("SCHEDULED_SCAN_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const isAuthorized =
    (scheduledSecret && expectedSecret && scheduledSecret === expectedSecret) ||
    authHeader.replace("Bearer ", "") === serviceRoleKey;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  try {
    console.log("[skills-gap] Starting weekly discovery...");

    // ── 1. Gather sources in parallel ─────────────────────────────────────────
    const [smithery, awesomeMcp, officialMcp, webSearch1, webSearch2] = await Promise.all([
      fetchSmitheryServers(),
      fetchGitHubReadme(
        "https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md",
        "awesome-mcp-servers"
      ),
      fetchGitHubReadme(
        "https://raw.githubusercontent.com/modelcontextprotocol/servers/main/README.md",
        "official MCP servers"
      ),
      searchWeb("new Claude MCP tools 2026 developer productivity"),
      searchWeb("Anthropic Claude new capabilities features 2026"),
    ]);

    const corpus = [smithery, awesomeMcp, officialMcp, webSearch1, webSearch2]
      .filter(Boolean)
      .join("\n\n")
      .substring(0, 18000); // stay within Claude context budget

    console.log(`[skills-gap] Corpus ready (${corpus.length} chars)`);

    // ── 2. Ask Claude to evaluate against the project ─────────────────────────
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: `You are an expert AI/developer tools researcher. You evaluate new Claude capabilities, MCP servers, and developer tools against a specific project and suggest actionable integrations. Be specific, not generic.`,
        messages: [{
          role: "user",
          content: `Here is the project context:\n\n${PROJECT_CONTEXT}\n\n---\n\nHere are the latest tools and capabilities from various sources:\n\n${corpus}\n\n---\n\nEvaluate these findings and return a JSON object with this exact structure:\n{\n  "summary": "2-3 sentence executive summary of what's most exciting this week",\n  "top_tools": [\n    {\n      "name": "tool/server name",\n      "description": "what it does in 1 sentence",\n      "use_case": "specific way it could improve Job Compass — be concrete",\n      "impact": "high | medium | low",\n      "url": "url if known, else null"\n    }\n  ],\n  "integration_ideas": ["idea 1", "idea 2", "idea 3"]\n}\n\nRules:\n- top_tools: pick the 4-6 most relevant tools for Job Compass specifically\n- Sort by impact descending\n- Avoid generic tools that don't specifically help this type of app\n- integration_ideas: 2-4 concrete implementation suggestions\n- Return ONLY valid JSON, ASCII only`,
        }],
      }),
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.text();
      throw new Error(`Claude error ${claudeResp.status}: ${err.substring(0, 200)}`);
    }

    const claudeData = await claudeResp.json();
    const rawText = (claudeData.content?.[0]?.text || "").replace(/[^\x20-\x7E\n\r\t]/g, "");

    const startIdx = rawText.indexOf("{");
    if (startIdx === -1) throw new Error("No JSON in Claude response");
    let depth = 0, jsonStr = "";
    for (let i = startIdx; i < rawText.length; i++) {
      const ch = rawText[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      jsonStr += ch;
      if (depth === 0) break;
    }

    let findings: any;
    try {
      findings = JSON.parse(jsonStr.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      throw new Error("Failed to parse Claude JSON");
    }

    console.log(`[skills-gap] Claude found ${findings.top_tools?.length || 0} tools`);

    // ── 3. Get all users to email ──────────────────────────────────────────────
    const { data: users } = await supabase.auth.admin.listUsers();
    const emails = (users?.users || [])
      .map((u: any) => u.email)
      .filter(Boolean) as string[];

    if (emails.length === 0) {
      console.log("[skills-gap] No users to email");
      return new Response(JSON.stringify({ success: true, emailed: 0, tools_found: findings.top_tools?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Send email via Resend ───────────────────────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const htmlBody = buildEmailHtml(findings);
    let emailed = 0;

    for (const email of emails) {
      try {
        const emailResp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: "Job Compass <onboarding@resend.dev>",
            to: [email],
            subject: `🔍 Weekly Claude Skills Digest — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
            html: htmlBody,
          }),
        });
        if (emailResp.ok) {
          emailed++;
          console.log(`[skills-gap] Email sent to ${email}`);
        } else {
          const errText = await emailResp.text();
          console.error(`[skills-gap] Email failed for ${email}:`, errText.substring(0, 200));
        }
      } catch (e: any) {
        console.error(`[skills-gap] Email error for ${email}:`, e.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, emailed, tools_found: findings.top_tools?.length || 0, summary: findings.summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[skills-gap] Fatal error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
