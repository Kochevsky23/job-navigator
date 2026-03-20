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

  const { data: all } = await supabase.from("jobs").select("company, role, job_link, linkedin_id").limit(30);

  const withLinks = (all || []).filter(j => j.job_link && j.job_link.trim() !== "");
  const linkedinInJobLink = withLinks.filter(j => j.job_link.includes("linkedin"));

  return new Response(JSON.stringify({
    total_jobs: all?.length,
    with_job_link: withLinks.length,
    linkedin_in_job_link: linkedinInJobLink.map(j => ({ company: j.company, job_link: j.job_link })),
    sample_links: withLinks.slice(0, 5).map(j => ({ company: j.company, job_link: j.job_link, linkedin_id: j.linkedin_id })),
    with_linkedin_id: (all || []).filter(j => j.linkedin_id).map(j => ({ company: j.company, linkedin_id: j.linkedin_id })),
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
