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

  // Use ilike for case-insensitive match
  const { data: jobs } = await supabase.from("jobs").select("id, job_link, linkedin_id").ilike("job_link", "%linkedin.com%");

  let fixed = 0;
  for (const job of jobs || []) {
    const match = job.job_link?.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i);
    if (match) {
      await supabase.from("jobs").update({
        linkedin_id: match[1],
        job_link: null,
      }).eq("id", job.id);
      fixed++;
    }
  }

  return new Response(JSON.stringify({ total: jobs?.length || 0, fixed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
