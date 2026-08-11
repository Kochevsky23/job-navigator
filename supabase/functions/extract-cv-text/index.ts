const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return new Response(JSON.stringify({ error: "Expected multipart/form-data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = file.name.toLowerCase();
    let text = "";

    if (name.endsWith(".docx")) {
      // DOCX: unzip and extract text from word/document.xml
      const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file("word/document.xml")?.async("string");
      if (docXml) {
        // Strip XML tags, keep text content
        text = docXml
          .replace(/<w:br[^>]*\/>/g, "\n")
          .replace(/<\/w:p>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    } else if (name.endsWith(".pdf")) {
      // Claude reads the PDF directly. The previous implementation regex-scanned
      // raw bytes for uncompressed BT/ET text operators, which finds nothing in
      // any PDF whose content streams are FlateDecode-compressed (i.e. almost
      // all of them — Word, Google Docs, Canva) and cannot handle non-Latin
      // scripts at all.
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const CHUNK = 0x8000; // chunk the conversion — spreading a multi-MB array blows the call stack
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);

      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": Deno.env.get("CLAUDE_API_KEY")!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-5",
          max_tokens: 16000,
          messages: [{
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              {
                type: "text",
                text: "Transcribe this CV to plain text, preserving the reading order, section headings, job titles, dates, and bullet points. Keep the original language — do not translate. Output only the transcription, with no preamble or commentary.",
              },
            ],
          }],
        }),
      });

      const claudeData = await claudeResp.json();
      if (!claudeResp.ok) {
        throw new Error(claudeData?.error?.message || `PDF extraction failed (${claudeResp.status})`);
      }
      // Find the text block rather than assuming content[0]: this model thinks by
      // default, and a thinking block occupies content[0] when it does.
      text = (claudeData.content ?? [])
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text ?? "")
        .join("\n")
        .trim();
      if (!text) {
        throw new Error(
          `PDF extraction returned no text (stop_reason=${claudeData?.stop_reason}, blocks=${(claudeData.content ?? []).map((b: any) => b?.type).join(",") || "none"})`
        );
      }
    } else {
      // Try plain text
      text = await file.text();
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("CV extraction error:", error);
    return new Response(JSON.stringify({ error: error.message, text: "" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
