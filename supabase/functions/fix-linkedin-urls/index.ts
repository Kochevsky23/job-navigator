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

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, job_link")
    .like("job_link", "%linkedin.com%jobs/view/%");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let fixed = 0;
  for (const job of jobs || []) {
    let cleaned = job.job_link
      .replace(/\/comm\/jobs\/view\//gi, "/jobs/view/")
      .replace(/(linkedin\.com\/jobs\/view\/\d+\/?)(\?.*)?$/i, "$1");

    if (cleaned !== job.job_link) {
      await supabase.from("jobs").update({ job_link: cleaned }).eq("id", job.id);
      fixed++;
    }
  }

  return new Response(JSON.stringify({ total: jobs?.length || 0, fixed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
