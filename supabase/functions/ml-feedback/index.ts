import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isServiceCall = token === serviceRoleKey;

    let userId: string;
    if (isServiceCall) {
      const body = await req.json().catch(() => ({}));
      userId = body.userId;
      if (!userId) return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      userId = user.id;
    }

    // ── Load all rated jobs ────────────────────────────────────────────────────
    const { data: ratedJobs, error: jobsError } = await supabase
      .from("jobs")
      .select("company, role, location, score, priority, exp_required, reason, user_score, description")
      .eq("user_id", userId)
      .not("user_score", "is", null)
      .order("created_at", { ascending: false });

    if (jobsError) throw new Error(jobsError.message);

    const labeled = (ratedJobs || []).filter(j => j.user_score !== 3); // skip neutral
    if (labeled.length < 3) {
      return new Response(JSON.stringify({
        success: false,
        message: "Need at least 3 rated jobs (not counting neutral 3★). Rate more jobs first.",
        labeled_count: labeled.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Compute binary metrics ─────────────────────────────────────────────────
    // AI positive = HIGH priority (score >= 8)
    // User positive = user_score >= 4
    const TP = labeled.filter(j => j.user_score >= 4 && j.priority === "HIGH").length;
    const FP = labeled.filter(j => j.user_score <= 2 && j.priority === "HIGH").length;
    const FN = labeled.filter(j => j.user_score >= 4 && j.priority !== "HIGH").length;
    const TN = labeled.filter(j => j.user_score <= 2 && j.priority !== "HIGH").length;

    const precision = TP + FP > 0 ? TP / (TP + FP) : null;
    const recall = TP + FN > 0 ? TP / (TP + FN) : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0
      ? 2 * precision * recall / (precision + recall) : null;
    const accuracy = TP + TN + FP + FN > 0 ? (TP + TN) / (TP + TN + FP + FN) : null;

    console.log(`[ml-feedback] Labeled: ${labeled.length} | TP:${TP} FP:${FP} FN:${FN} TN:${TN}`);
    console.log(`[ml-feedback] Precision:${precision?.toFixed(2)} Recall:${recall?.toFixed(2)} F1:${f1?.toFixed(2)} Accuracy:${accuracy?.toFixed(2)}`);

    // ── Build FP and FN lists for Claude ──────────────────────────────────────
    const fpJobs = labeled.filter(j => j.user_score <= 2 && j.priority === "HIGH");
    const fnJobs = labeled.filter(j => j.user_score >= 4 && j.priority !== "HIGH");
    const tpJobs = labeled.filter(j => j.user_score >= 4 && j.priority === "HIGH").slice(0, 5);

    const formatJob = (j: any) =>
      `- ${j.company} | ${j.role} | ${j.location} | exp: ${j.exp_required || "?"} | AI score: ${j.score} | AI priority: ${j.priority} | User rating: ${j.user_score}★\n  AI reason: ${(j.reason || "").substring(0, 200)}`;

    const fpSection = fpJobs.length > 0
      ? `FALSE POSITIVES (AI said HIGH, user disliked — AI overscored):\n${fpJobs.map(formatJob).join("\n")}`
      : "FALSE POSITIVES: none";

    const fnSection = fnJobs.length > 0
      ? `FALSE NEGATIVES (AI didn't say HIGH, user liked — AI missed):\n${fnJobs.map(formatJob).join("\n")}`
      : "FALSE NEGATIVES: none";

    const tpSection = tpJobs.length > 0
      ? `TRUE POSITIVES (AI said HIGH AND user liked — correct):\n${tpJobs.map(formatJob).join("\n")}`
      : "";

    const prompt = `You are analyzing AI scoring errors for a job search tool. The AI scores jobs 0-10 (HIGH=8+, MEDIUM=5-7, LOW=2-4, REJECTED<2) for a student candidate in Industrial Engineering from Kfar Saba, Israel.

Scoring factors:
- Factor 1: Skills match (0-3 pts)
- Factor 2: Experience level fit (0-5 pts) — PRIMARY
- Factor 3: Field relevance (0-1 pt)
- Factor 4: Location fit (0-1 pt)

${fpSection}

${fnSection}

${tpSection}

Task:
1. Analyze what patterns explain the false positives and false negatives.
2. Write a SHORT "insights" summary (2-3 sentences, specific, no generic advice).
3. Write "scoring_hints" — specific adjustments to inject into the scoring prompt. These MUST be actionable rules that change how scores are assigned. Be concrete: name specific role types, skills, company types. Max 200 words.

Format scoring_hints as a bullet list starting with:
"CALIBRATION FROM USER FEEDBACK (apply these adjustments):"

Return ONLY valid JSON:
{
  "insights": "...",
  "scoring_hints": "CALIBRATION FROM USER FEEDBACK (apply these adjustments):\\n- ..."
}`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const rawText = claudeData.content?.[0]?.text?.trim() || "{}";

    let insights = "";
    let scoringHints = "";
    try {
      const startIdx = rawText.indexOf("{");
      const endIdx = rawText.lastIndexOf("}");
      const jsonStr = startIdx !== -1 ? rawText.slice(startIdx, endIdx + 1) : rawText;
      const parsed = JSON.parse(jsonStr);
      insights = parsed.insights || "";
      scoringHints = parsed.scoring_hints || "";
    } catch {
      console.error("[ml-feedback] Claude JSON parse failed:", rawText);
      insights = "Could not analyze patterns.";
      scoringHints = "";
    }

    // ── Store in user_profiles ─────────────────────────────────────────────────
    const scoringFeedback = {
      last_updated: new Date().toISOString(),
      labeled_count: labeled.length,
      metrics: { precision, recall, f1, accuracy, TP, FP, TN, FN },
      insights,
      scoring_hints: scoringHints,
    };

    await supabase
      .from("user_profiles")
      .update({ scoring_feedback: scoringFeedback })
      .eq("id", userId);

    console.log(`[ml-feedback] Done. Insights: ${insights.substring(0, 100)}`);

    return new Response(JSON.stringify({ success: true, metrics: scoringFeedback.metrics, insights, scoring_hints: scoringHints }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[ml-feedback] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "ML feedback failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
