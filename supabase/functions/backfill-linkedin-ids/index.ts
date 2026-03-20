import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("EXTERNAL_SUPABASE_URL")!,
    Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Get all jobs, check fingerprints for linkedin job IDs
  const { data: all } = await supabase.from("jobs").select("id, company, fingerprint, linkedin_id").order("created_at", { ascending: false });

  let fixed = 0;
  for (const job of all || []) {
    if (job.linkedin_id) continue; // already has one
    if (!job.fingerprint) continue;

    // fingerprints like "link::https://www.linkedin.com/jobs/view/4382799156/"
    const match = job.fingerprint.match(/linkedin\.com\/jobs\/view\/(\d+)/i);
    if (match) {
      await supabase.from("jobs").update({ linkedin_id: match[1] }).eq("id", job.id);
      fixed++;
    }
  }

  return new Response(JSON.stringify({ total: all?.length, fixed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
