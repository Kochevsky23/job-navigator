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

    // ── Load candidate profile + rated jobs ───────────────────────────────────
    const { data: profileRow } = await supabase
      .from("user_profiles")
      .select("candidate_profile")
      .eq("id", userId)
      .single();
    const cp = (profileRow as any)?.candidate_profile || {};
    const candidateDesc = [
      cp.experience_level && `${cp.experience_level} candidate`,
      cp.education_field && `in ${cp.education_field}`,
      cp.city && `from ${cp.city}`,
      cp.domains?.length && `(domains: ${cp.domains.join(", ")})`,
    ].filter(Boolean).join(" ") || "a job candidate";

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

    // ── Compute binary metrics (HIGH threshold = score >= 7) ──────────────────
    // User positive = user_score >= 4 (4-5★), negative = 1-2★, neutral 3★ skipped
    const TP = labeled.filter(j => j.user_score >= 4 && j.priority === "HIGH").length;
    const FP = labeled.filter(j => j.user_score <= 2 && j.priority === "HIGH").length;
    const FN = labeled.filter(j => j.user_score >= 4 && j.priority !== "HIGH").length;
    const TN = labeled.filter(j => j.user_score <= 2 && j.priority !== "HIGH").length;

    // Also compute MEDIUM recall (how many 4★ liked jobs are at least MEDIUM)
    const mediumTP = labeled.filter(j => j.user_score >= 4 && (j.priority === "HIGH" || j.priority === "MEDIUM")).length;
    const mediumFN = labeled.filter(j => j.user_score >= 4 && j.priority !== "HIGH" && j.priority !== "MEDIUM").length;
    const mediumRecall = mediumTP + mediumFN > 0 ? mediumTP / (mediumTP + mediumFN) : null;

    const precision = TP + FP > 0 ? TP / (TP + FP) : null;
    const recall = TP + FN > 0 ? TP / (TP + FN) : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0
      ? 2 * precision * recall / (precision + recall) : null;
    const accuracy = TP + TN + FP + FN > 0 ? (TP + TN) / (TP + TN + FP + FN) : null;

    console.log(`[ml-feedback] Labeled: ${labeled.length} | TP:${TP} FP:${FP} FN:${FN} TN:${TN}`);
    console.log(`[ml-feedback] P:${precision?.toFixed(2)} R:${recall?.toFixed(2)} F1:${f1?.toFixed(2)} Acc:${accuracy?.toFixed(2)} MedR:${mediumRecall?.toFixed(2)}`);

    // ── Build job lists for Claude ─────────────────────────────────────────────
    const fpJobs = labeled.filter(j => j.user_score <= 2 && j.priority === "HIGH");
    const fnJobs = labeled.filter(j => j.user_score >= 4 && j.priority !== "HIGH");
    const tpJobs = labeled.filter(j => j.user_score >= 4 && j.priority === "HIGH").slice(0, 5);
    // FN breakdown by priority bucket
    const fnByPriority = {
      MEDIUM: fnJobs.filter(j => j.priority === "MEDIUM").length,
      LOW: fnJobs.filter(j => j.priority === "LOW").length,
      REJECTED: fnJobs.filter(j => j.priority === "REJECTED").length,
    };

    const formatJob = (j: any) =>
      `- ${j.company} | ${j.role} | ${j.location} | exp: ${j.exp_required || "?"} | score: ${j.score} | priority: ${j.priority} | user: ${j.user_score}★\n  reason: ${(j.reason || "").substring(0, 250)}`;

    const fpSection = fpJobs.length > 0
      ? `FALSE POSITIVES (AI=HIGH, user disliked 1-2★ — AI overscored):\n${fpJobs.map(formatJob).join("\n")}`
      : "FALSE POSITIVES: none";

    const fnSection = fnJobs.length > 0
      ? `FALSE NEGATIVES (AI≠HIGH, user liked 4-5★ — AI missed):\nBreakdown: MEDIUM=${fnByPriority.MEDIUM}, LOW=${fnByPriority.LOW}, REJECTED=${fnByPriority.REJECTED}\n${fnJobs.slice(0, 20).map(formatJob).join("\n")}`
      : "FALSE NEGATIVES: none";

    const tpSection = tpJobs.length > 0
      ? `TRUE POSITIVES sample (AI=HIGH AND user liked — correct):\n${tpJobs.map(formatJob).join("\n")}`
      : "";

    // Load previous hints to avoid duplication
    const { data: profileRow2 } = await supabase
      .from("user_profiles")
      .select("scoring_feedback")
      .eq("id", userId)
      .single();
    const prevHints: string = (profileRow2 as any)?.scoring_feedback?.scoring_hints || "";
    const prevHintsSection = prevHints
      ? `\nPREVIOUS SCORING HINTS (already applied — do NOT repeat, only add NEW insights):\n${prevHints.substring(0, 400)}`
      : "";

    const prompt = `You are analyzing AI scoring accuracy for a job-search tool. The AI scores jobs 0-10 (HIGH=7-10, MEDIUM=5-6, LOW=2-4, REJECTED=0-1) for ${candidateDesc}.

Current scoring factors:
- Factor 1: Skills match (0-2 pts)
- Factor 2: Experience level fit (0-4 pts) — PRIMARY
- Factor 3: Field & domain relevance (0-1 pt)
- Factor 4: Location fit (0-1 pt)
- Factor 5: Language match (0-1 pt)
- Factor 6: Job type alignment (0-1 pt)

Metrics this run: Precision=${precision != null ? (precision*100).toFixed(0)+"%" : "N/A"} | Recall=${recall != null ? (recall*100).toFixed(0)+"%" : "N/A"} | F1=${f1 != null ? (f1*100).toFixed(0)+"%" : "N/A"} | MEDIUM+HIGH recall=${mediumRecall != null ? (mediumRecall*100).toFixed(0)+"%" : "N/A"}
${prevHintsSection}

${fpSection}

${fnSection}

${tpSection}

Tasks:
1. Identify specific patterns in the errors — name actual companies, role types, domains, exp levels that are systematically wrong.
2. Write "insights": 3-4 sentences, concrete and specific. Include whether the main issue is precision (too many FP) or recall (too many FN) and WHY.
3. Write "scoring_hints": NEW actionable calibration rules only (no repeats from previous hints). Format as bullet list. Max 250 words. Name specific companies, role keywords, skill gaps, or domain patterns observed. Each bullet must change how a specific type of job gets scored.

Format scoring_hints starting with:
"CALIBRATION FROM USER FEEDBACK (run ${new Date().toISOString().slice(0,10)}):"

Return ONLY valid JSON:
{
  "insights": "...",
  "scoring_hints": "CALIBRATION FROM USER FEEDBACK (run ${new Date().toISOString().slice(0,10)}):\\n- ..."
}`;

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        thinking: { type: "disabled" },
        max_tokens: 1500,
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
      scoringHints = prevHints; // keep previous hints on failure
    }

    // Append new hints to previous (keep last 2 runs, cap at 600 chars total)
    const combinedHints = prevHints && scoringHints && scoringHints !== prevHints
      ? [prevHints, scoringHints].join("\n\n").substring(0, 600)
      : scoringHints || prevHints;

    // ── Store in user_profiles ─────────────────────────────────────────────────
    const scoringFeedback = {
      last_updated: new Date().toISOString(),
      labeled_count: labeled.length,
      metrics: { precision, recall, f1, accuracy, mediumRecall, TP, FP, TN, FN },
      insights,
      scoring_hints: combinedHints,
    };

    await supabase
      .from("user_profiles")
      .update({ scoring_feedback: scoringFeedback })
      .eq("id", userId);

    console.log(`[ml-feedback] Done. P:${precision?.toFixed(2)} R:${recall?.toFixed(2)} F1:${f1?.toFixed(2)}`);

    return new Response(JSON.stringify({ success: true, metrics: scoringFeedback.metrics, insights, scoring_hints: combinedHints }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[ml-feedback] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "ML feedback failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
