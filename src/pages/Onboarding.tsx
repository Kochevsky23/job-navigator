import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Upload, FileText, CheckCircle2, Loader2, Compass, X, User, MapPin, Briefcase, GraduationCap, Code } from 'lucide-react';
import { toast } from 'sonner';

interface CvSummary {
  name: string;
  location: string;
  education: string;
  experience: string[];
  skills: string[];
}

function parseCvSummary(text: string): CvSummary {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Name: usually first line
  const name = lines[0] || '';
  
  // Location: look for city/country patterns
  const locationLine = lines.find(l => /kfar saba|tel aviv|israel|haifa|jerusalem|ramat gan|netanya|herzliya/i.test(l)) || '';
  const locationMatch = locationLine.match(/([\w\s]+,\s*Israel|Kfar Saba|Tel Aviv|Haifa|Jerusalem|Ramat Gan|Netanya|Herzliya)/i);
  const location = locationMatch ? locationMatch[1].trim() : '';

  // Education
  const eduIdx = lines.findIndex(l => /education/i.test(l));
  let education = '';
  if (eduIdx >= 0) {
    for (let i = eduIdx + 1; i < Math.min(eduIdx + 4, lines.length); i++) {
      if (/b\.sc|bachelor|master|m\.sc|phd|college|university|engineering/i.test(lines[i])) {
        education = lines[i];
        break;
      }
    }
  }

  // Experience
  const experience: string[] = [];
  const expIdx = lines.findIndex(l => /work experience|experience/i.test(l));
  if (expIdx >= 0) {
    for (let i = expIdx + 1; i < lines.length; i++) {
      if (/education|skills|languages|projects/i.test(lines[i])) break;
      if (lines[i].includes('|') || /\d{4}/.test(lines[i])) {
        experience.push(lines[i]);
      }
    }
  }

  // Skills
  const skills: string[] = [];
  const skillIdx = lines.findIndex(l => /technical|skills/i.test(l));
  if (skillIdx >= 0) {
    for (let i = skillIdx; i < Math.min(skillIdx + 5, lines.length); i++) {
      const found = lines[i].match(/Python|SQL|Excel|Git|JavaScript|TypeScript|React|Node|Java|C\+\+|R\b|Tableau|Power BI|Matlab|Data Analysis|Machine Learning/gi);
      if (found) skills.push(...found);
    }
  }

  return { name, location, education, experience: experience.slice(0, 3), skills: [...new Set(skills)].slice(0, 8) };
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [fileName, setFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [cvSummary, setCvSummary] = useState<CvSummary | null>(null);
  const [showSummary, setShowSummary] = useState(false);

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
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('user-cvs')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const formData = new FormData();
      formData.append('file', file);
      const { data: { session } } = await supabase.auth.getSession();
      const extractResp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-cv-text`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}` },
          body: formData,
        }
      );

      let cvText = '';
      if (extractResp.ok) {
        const result = await extractResp.json();
        cvText = result.text || '';
      }

      await supabase.from('user_profiles').update({
        cv_filename: file.name,
        cv_text: cvText,
        cv_uploaded_at: new Date().toISOString(),
      }).eq('id', user.id);

      if (cvText) {
        const summary = parseCvSummary(cvText);
        setCvSummary(summary);
        setShowSummary(true);
      }

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
      <div className="w-full max-w-md space-y-6 animate-fade-up">
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
            <input id="cv-input" type="file" accept=".pdf,.docx" className="hidden" onChange={handleInputChange} />
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
          <div className="space-y-4">
            <div className="glass-card rounded-2xl p-6 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-[hsl(var(--success))] mx-auto" />
              <div>
                <p className="text-sm font-semibold">CV uploaded!</p>
                <div className="flex items-center justify-center gap-2 mt-1">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{fileName}</p>
                </div>
              </div>
            </div>

            {/* CV Summary */}
            {showSummary && cvSummary && (
              <div className="glass-card rounded-2xl p-5 space-y-4 animate-fade-up relative">
                <button
                  onClick={() => setShowSummary(false)}
                  className="absolute top-3 right-3 p-1 rounded-lg hover:bg-[hsl(var(--glass-border)/0.3)] transition-colors"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
                <h3 className="text-sm font-display font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  What we found in your CV
                </h3>

                <div className="space-y-3">
                  {cvSummary.name && (
                    <div className="flex items-start gap-2.5">
                      <User className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Name</p>
                        <p className="text-sm font-medium">{cvSummary.name}</p>
                      </div>
                    </div>
                  )}

                  {cvSummary.location && (
                    <div className="flex items-start gap-2.5">
                      <MapPin className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Location</p>
                        <p className="text-sm font-medium">{cvSummary.location}</p>
                      </div>
                    </div>
                  )}

                  {cvSummary.education && (
                    <div className="flex items-start gap-2.5">
                      <GraduationCap className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Education</p>
                        <p className="text-sm font-medium">{cvSummary.education}</p>
                      </div>
                    </div>
                  )}

                  {cvSummary.experience.length > 0 && (
                    <div className="flex items-start gap-2.5">
                      <Briefcase className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Experience</p>
                        {cvSummary.experience.map((exp, i) => (
                          <p key={i} className="text-sm">{exp}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {cvSummary.skills.length > 0 && (
                    <div className="flex items-start gap-2.5">
                      <Code className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5">Skills</p>
                        <div className="flex flex-wrap gap-1.5">
                          {cvSummary.skills.map(skill => (
                            <span key={skill} className="px-2 py-0.5 rounded-full bg-[hsl(var(--primary)/0.1)] text-primary text-xs font-medium">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
