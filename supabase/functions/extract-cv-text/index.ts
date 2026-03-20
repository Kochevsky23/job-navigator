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
      // For PDF, try basic text extraction
      // Read the raw bytes and look for text streams
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const raw = new TextDecoder("latin1").decode(bytes);
      
      // Extract text between BT and ET markers (PDF text objects)
      const textBlocks: string[] = [];
      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let match;
      while ((match = btEtRegex.exec(raw)) !== null) {
        const block = match[1];
        // Extract text from Tj and TJ operators
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        let tjMatch;
        while ((tjMatch = tjRegex.exec(block)) !== null) {
          textBlocks.push(tjMatch[1]);
        }
        // TJ array
        const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
        let arrMatch;
        while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
          const inner = arrMatch[1];
          const strRegex = /\(([^)]*)\)/g;
          let strMatch;
          while ((strMatch = strRegex.exec(inner)) !== null) {
            textBlocks.push(strMatch[1]);
          }
        }
      }
      text = textBlocks.join(" ").replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
      
      // If basic extraction got very little text, note it
      if (text.length < 50) {
        text = "[PDF text extraction returned limited results. The CV file has been stored. You can update your CV text from settings.]";
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
