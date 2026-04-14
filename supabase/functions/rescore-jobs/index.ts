import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized", detail: userError?.message }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const userId = user.id;

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("jobs")
      .select("id, role, company, location, reason, score")
      .eq("user_id", userId)
      .not("reason", "ilike", "Requirements:%");

    if (jobsError) throw jobsError;

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ updated: 0, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[RESCORE] Found ${jobs.length} job(s) with old-format reasons`);

    let updated = 0;
    const errors: string[] = [];

    for (const job of jobs) {
      try {
        const prompt = `You are rewriting a job scoring reason into a cleaner format.

Job: ${job.role} at ${job.company} in ${job.location || "Unknown"}
Current reason: ${job.reason || "(none)"}
Score: ${job.score}/10

Rewrite this into exactly this format:
"Requirements: [extract what the job requires based on the current reason — skills, experience level, location, field].
Match: [explain in 1-2 sentences why the candidate matches or doesn't, based on the current reason]."

Return ONLY the rewritten reason text. No preamble.`;

        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 300,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        const data = await resp.json();
        const newReason = (data.content?.[0]?.text || "").trim();

        if (newReason && newReason.startsWith("Requirements:")) {
          await supabaseAdmin.from("jobs").update({ reason: newReason }).eq("id", job.id);
          updated++;
          console.log(`[RESCORE] Updated: ${job.company} — ${job.role}`);
        } else {
          console.warn(`[RESCORE] Bad output for ${job.company} — ${job.role}: "${newReason.substring(0, 60)}"`);
        }
      } catch (e: any) {
        console.error(`[RESCORE] Error on ${job.company} — ${job.role}:`, e.message);
        errors.push(`${job.company} — ${job.role}: ${e.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    console.log(`[RESCORE] Done: ${updated}/${jobs.length} updated`);

    return new Response(
      JSON.stringify({ updated, total: jobs.length, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[RESCORE] Fatal error:", e.message, e.stack);
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
