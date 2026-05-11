import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Exa Search ───────────────────────────────────────────────────────────────

interface ExaResult {
  title: string;
  url: string;
  publishedDate?: string;
  highlights?: string[];
}

async function searchExa(company: string, domain: string): Promise<string> {
  const apiKey = Deno.env.get("EXA_API_KEY");
  if (!apiKey) return "";

  const query = domain
    ? `site:${domain} OR "${company}" company overview funding news`
    : `"${company}" company overview funding recent news`;

  try {
    const resp = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        num_results: 4,
        type: "auto",
        contents: { highlights: true },
      }),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    const results: ExaResult[] = data.results ?? [];
    if (!results.length) return "";

    return results.map(r => {
      const date = r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : "";
      const snippets = (r.highlights ?? []).join(" ");
      return `- ${r.title}${date}\n  ${r.url}\n  ${snippets}`;
    }).join("\n\n");
  } catch {
    return "";
  }
}

// ─── Exa Salary Search ────────────────────────────────────────────────────────

async function searchExaSalary(role: string, location: string): Promise<string> {
  const apiKey = Deno.env.get("EXA_API_KEY");
  if (!apiKey) return "";

  const year = new Date().getFullYear();
  const isIsrael = /israel|tel.?aviv|haifa|jerusalem|beer.?sheva|herzliya|ra'anana|petah|rishon/i.test(location || "");
  const query = isIsrael
    ? `${role} salary Israel tech ILS NIS shekel ${year} site:glassdoor.com OR site:jobmaster.co.il OR site:alljobs.co.il OR site:drushim.co.il`
    : `${role} salary ${location || "tech"} ${year}`;

  try {
    const resp = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        num_results: 3,
        type: "auto",
        contents: { highlights: true },
      }),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    const results: ExaResult[] = data.results ?? [];
    if (!results.length) return "";

    return results.map(r => {
      const snippets = (r.highlights ?? []).join(" ");
      return `- ${r.title}\n  ${r.url}\n  ${snippets}`;
    }).join("\n\n");
  } catch {
    return "";
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { jobId } = await req.json();
    if (!jobId || !UUID_RE.test(jobId)) throw new Error("Invalid jobId");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("company, role, location, description, company_domain, user_id")
      .eq("id", jobId)
      .single();
    if (jobError || !job) throw new Error("Job not found");

    const rl = await checkRateLimit(supabase, job.user_id, "company-research", 20);
    if (!rl.allowed) throw new Error(`Rate limit reached. Try again in ${Math.ceil((rl.retryAfterSeconds ?? 3600) / 60)} minutes.`);

    // Fetch Exa + Brave in parallel — both optional, never block on failure
    const jobLocation = job.location ?? "";
    const isIsraelJob = /israel|tel.?aviv|haifa|jerusalem|beer.?sheva|herzliya|ra'anana|petah|rishon/i.test(jobLocation);
    const [exaResults, salaryResults] = await Promise.all([
      searchExa(job.company, job.company_domain ?? ""),
      searchExaSalary(job.role, jobLocation),
    ]);

    const webContext = exaResults
      ? `\nRECENT WEB SEARCH RESULTS (Exa):\n${exaResults}\n`
      : "";
    const salaryContext = salaryResults
      ? `\nSALARY BENCHMARK DATA (Exa):\n${salaryResults}\n`
      : "";
    const dataSourceNote = (exaResults || salaryResults)
      ? "Use the web search results and salary data above to make your brief more specific and up-to-date. Cite specific findings where relevant."
      : "Base your brief on what you know about this company.";

    const prompt = `You are a company research analyst. Generate a concise company brief for a job candidate preparing to apply.

Company: ${job.company}
Role: ${job.role}
Location: ${job.location}
Company domain: ${job.company_domain || "unknown"}

Job description context:
${job.description?.substring(0, 2000) || "Not available"}
${webContext}${salaryContext}
${dataSourceNote}

Write a structured company brief covering:

WHAT THEY DO
2–3 sentences: core product/service, customers, market.

SIZE & STAGE
Employee count range, funding stage, founding year.

TECH & TOOLS
Technologies and tools used (from job description + search results).

CULTURE SIGNALS
2–3 observations about what it's like to work there. Include watch points.

WHY THIS ROLE MATTERS
How ${job.role} fits into the company and what impact it has.

SALARY RANGE
${isIsraelJob
  ? "Estimated gross monthly salary in ILS (₪) for this role in Israel. IMPORTANT: Ignore USD figures from Levels.fyi/PayScale/TalentUp — those reflect US/global markets (3-5x inflated for Israel). Israeli tech salaries: junior ~₪12,000–18,000/mo, mid ~₪18,000–28,000/mo, senior ~₪28,000–45,000/mo gross. Use these baselines unless Israeli-specific sources (Glassdoor IL, jobmaster.co.il, drushim.co.il) show different figures."
  : `Estimated salary range for this role in ${jobLocation || "this market"}. Use local market data where available. State the range, currency, and note it is an estimate.`
}

SMART QUESTIONS TO RESEARCH BEFORE THE INTERVIEW
2 specific things to look up or read before applying.

Be specific. Cite findings from web results when available. Plain text with section headers.`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        system: [
          {
            type: "text",
            text: "You are a company research analyst who helps job candidates understand companies before applying. You give honest, practical, and specific company briefs. When web search results are provided, incorporate them for accuracy.",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const companyResearch = claudeData.content?.[0]?.text?.trim() || "";
    if (!companyResearch) throw new Error("Claude returned empty response");

    await supabase.from("jobs").update({ company_research: companyResearch }).eq("id", jobId);

    return new Response(
      JSON.stringify({
        success: true,
        enriched: { exa: !!exaResults, salary: !!salaryResults },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Company research error:", error);
    return new Response(JSON.stringify({ error: error.message || "Company research failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
