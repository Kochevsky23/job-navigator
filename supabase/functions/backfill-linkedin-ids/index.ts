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

  const { data: jobs } = await supabase.from("jobs").select("id, company, role, job_link, linkedin_id").not("job_link", "is", null).neq("job_link", "").limit(10);

  return new Response(JSON.stringify(jobs?.map(j => ({ company: j.company, job_link: j.job_link, linkedin_id: j.linkedin_id })), null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
