import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("EXTERNAL_SUPABASE_URL")!,
    Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!
  );

  // First deduplicate any remaining dupes
  const { data: jobs } = await supabase.from("jobs").select("id, company, role, fingerprint, score, tailored_cv, created_at").order("created_at", { ascending: true });
  if (jobs) {
    const seen = new Map<string, any>();
    for (const job of jobs) {
      const key = `${(job.company||'').trim().toLowerCase()}::${(job.role||'').trim().toLowerCase()}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        const keepExisting = (existing.tailored_cv && !job.tailored_cv) || (existing.score >= job.score);
        if (keepExisting) {
          await supabase.from("jobs").delete().eq("id", job.id);
        } else {
          await supabase.from("jobs").delete().eq("id", existing.id);
          seen.set(key, job);
        }
      } else {
        seen.set(key, job);
      }
    }

    // Also deduplicate by fingerprint
    const fpSeen = new Map<string, any>();
    const { data: remaining } = await supabase.from("jobs").select("id, fingerprint, score, tailored_cv").order("created_at", { ascending: true });
    if (remaining) {
      for (const job of remaining) {
        if (!job.fingerprint) continue;
        if (fpSeen.has(job.fingerprint)) {
          await supabase.from("jobs").delete().eq("id", job.id);
        } else {
          fpSeen.set(job.fingerprint, job);
        }
      }
    }
  }

  // Now add unique constraint via raw SQL using the service role
  const resp = await fetch(`${Deno.env.get("EXTERNAL_SUPABASE_URL")}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
      "Authorization": `Bearer ${Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!}`,
    },
  });

  return new Response(JSON.stringify({ success: true, message: "Duplicates cleaned. Add UNIQUE constraint manually via SQL editor." }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
