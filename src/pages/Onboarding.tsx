import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Upload, FileText, CheckCircle2, Loader2, Compass } from 'lucide-react';
import { toast } from 'sonner';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [fileName, setFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    if (!user) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx'].includes(ext || '')) {
      toast.error('Please upload a PDF or DOCX file');
      return;
    }

    setUploading(true);
    setFileName(file.name);

    try {
      // Upload to storage
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('user-cvs')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Extract text via edge function
      const formData = new FormData();
      formData.append('file', file);

      const { data: { session } } = await supabase.auth.getSession();
      const extractResp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-cv-text`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: formData,
        }
      );

      let cvText = '';
      if (extractResp.ok) {
        const result = await extractResp.json();
        cvText = result.text || '';
      }

      // Update profile
      await supabase.from('user_profiles').update({
        cv_filename: file.name,
        cv_text: cvText,
        cv_uploaded_at: new Date().toISOString(),
      }).eq('id', user.id);

      setUploaded(true);
      toast.success('CV uploaded successfully!');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [user]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 animate-fade-up">
        <div className="text-center">
          <div className="h-14 w-14 rounded-2xl gradient-primary flex items-center justify-center shadow-lg mx-auto mb-4">
            <Compass className="h-7 w-7 text-background" />
          </div>
          <h1 className="text-2xl font-display font-bold">Let's get you set up</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload your CV so we can find the best job matches</p>
        </div>

        {!uploaded ? (
          <div
            className={`glass-card rounded-2xl border-2 border-dashed transition-all duration-200 p-8 text-center cursor-pointer ${
              dragActive
                ? 'border-primary bg-[hsl(var(--primary)/0.05)]'
                : 'border-[hsl(var(--glass-border)/0.5)] hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('cv-input')?.click()}
          >
            <input
              id="cv-input"
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={handleInputChange}
            />
            {uploading ? (
              <div className="space-y-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
                <p className="text-sm font-medium">Uploading {fileName}...</p>
                <p className="text-xs text-muted-foreground">Extracting text from your CV</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                <div>
                  <p className="text-sm font-medium">Drop your CV here</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF or DOCX, max 10MB</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-2xl p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-[hsl(var(--success))] mx-auto" />
            <div>
              <p className="text-sm font-semibold">CV uploaded!</p>
              <div className="flex items-center justify-center gap-2 mt-1">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{fileName}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          {!uploaded && (
            <button
              onClick={() => navigate('/dashboard')}
              className="flex-1 rounded-xl border border-[hsl(var(--glass-border)/0.5)] px-4 py-3 text-sm font-medium hover:bg-[hsl(var(--glass-border)/0.2)] transition-colors"
            >
              Skip for now
            </button>
          )}
          {uploaded && (
            <button
              onClick={() => navigate('/dashboard')}
              className="btn-gradient flex-1 flex items-center justify-center gap-2 text-sm"
            >
              Go to Dashboard →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
