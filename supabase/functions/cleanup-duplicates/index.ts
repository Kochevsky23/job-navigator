import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("EXTERNAL_SUPABASE_URL")!,
    Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, company, role, location, score, created_at, tailored_cv")
      .order("created_at", { ascending: true });

    if (error) throw error;
    if (!jobs) return new Response(JSON.stringify({ deleted: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Group by lowercase company + role
    const seen = new Map<string, typeof jobs[0]>();
    const toDelete: string[] = [];

    for (const job of jobs) {
      const key = `${(job.company || '').trim().toLowerCase()}::${(job.role || '').trim().toLowerCase()}`;
      const existing = seen.get(key);
      if (existing) {
        // Keep the one with higher score, or the one with a tailored_cv, or the newer one
        const keepExisting = (existing.tailored_cv && !job.tailored_cv) ||
          (!job.tailored_cv && !existing.tailored_cv && existing.score >= job.score);
        if (keepExisting) {
          toDelete.push(job.id);
        } else {
          toDelete.push(existing.id);
          seen.set(key, job);
        }
      } else {
        seen.set(key, job);
      }
    }

    // Delete duplicates
    for (const id of toDelete) {
      await supabase.from("jobs").delete().eq("id", id);
    }

    return new Response(JSON.stringify({ deleted: toDelete.length, remaining: seen.size }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
