import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { db } from '@/lib/supabase-external';
import { runDailyScan } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ScanRun } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Radar, Mail, Brain, FileText, Clock, Upload, User, MapPin, Save, CheckCircle2, AtSign, Lock, Camera, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';

export default function ScanSettings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [scanning, setScanning] = useState(false);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile state
  const [fullName, setFullName] = useState('');
  const [city, setCity] = useState('');
  const [cvText, setCvText] = useState('');
  const [cvFilename, setCvFilename] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  // Handle ?gmail= callback from OAuth redirect
  useEffect(() => {
    const gmailParam = searchParams.get('gmail');
    if (gmailParam === 'connected') {
      toast.success('Gmail connected successfully!');
      setGmailConnected(true);
      setSearchParams({}, { replace: true });
    } else if (gmailParam === 'error') {
      const reason = searchParams.get('reason') || 'unknown';
      toast.error(`Gmail connection failed: ${reason}`);
      setSearchParams({}, { replace: true });
    }
  }, []);

  const fetchProfile = async () => {
    if (!user) return;
    const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();
    if (data) {
      setFullName((data as any).full_name || '');
      setCity((data as any).city || '');
      setCvText((data as any).cv_text || '');
      setCvFilename((data as any).cv_filename || '');
      setAvatarUrl((data as any).avatar_url || '');
      setGmailConnected(!!(data as any).google_refresh_token);
    }
    setEmail(user?.email || '');
    setProfileLoading(false);
  };

  const handleReanalyzeJobs = async () => {
    setReanalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('reanalyze-jobs');
      if (error) throw new Error(error.message || 'Reanalysis failed');
      toast.success(`Updated ${data.updated} job${data.updated !== 1 ? 's' : ''} with improved reasoning.`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to reanalyze jobs');
    } finally {
      setReanalyzing(false);
    }
  };

  const handleConnectGmail = async () => {
    if (!user) return;
    setConnectingGmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', {
        body: { redirect_url: `${window.location.origin}/settings` },
      });
      if (error || !data?.url) throw new Error(error?.message || 'Failed to get OAuth URL');
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(e.message || 'Failed to start Gmail connection');
      setConnectingGmail(false);
    }
  };

  const fetchScans = async () => {
    const { data } = await db.from('scan_runs').select('*').order('started_at', { ascending: false }).limit(20);
    if (data) setScans(data as unknown as ScanRun[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchProfile();
    fetchScans();
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Get old CV to detect if CV actually changed
      const { data: oldProfile } = await supabase.from('user_profiles').select('cv_text').eq('id', user.id).single();
      const cvChanged = cvText !== (oldProfile as any)?.cv_text;

      const { error } = await supabase.from('user_profiles').update({
        full_name: fullName,
        city,
        cv_text: cvText,
      }).eq('id', user.id);
      if (error) throw error;
      toast.success('Profile updated!');

      // Feature 2: Auto-rescore all jobs when CV changes
      if (cvChanged && cvText) {
        toast.info('CV changed — re-scoring your jobs in background...');
        supabase.functions.invoke('rescore-jobs').then(({ data, error: rescoreErr }) => {
          if (rescoreErr) return;
          if (data?.updated > 0) toast.success(`Re-scored ${data.updated} jobs with new CV.`);
        });
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!email || email === user?.email) return;
    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      await supabase.from('user_profiles').update({ email }).eq('id', user!.id);
      toast.success('Confirmation email sent to your new address. Please check your inbox.');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword) return;
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleFileUpload = useCallback(async (file: File) => {
    if (!user) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx'].includes(ext || '')) {
      toast.error('Please upload a PDF or DOCX file');
      return;
    }

    setUploading(true);
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

      let extractedText = '';
      if (extractResp.ok) {
        const result = await extractResp.json();
        extractedText = result.text || '';
      }

      await supabase.from('user_profiles').update({
        cv_filename: file.name,
        cv_text: extractedText,
        cv_uploaded_at: new Date().toISOString(),
      }).eq('id', user.id);

      setCvFilename(file.name);
      setCvText(extractedText);
      toast.success('CV uploaded and extracted!');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [user]);

  const handleAvatarUpload = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filePath = `${user.id}/avatar.${ext}`;
      
      // Remove old avatar if exists
      await supabase.storage.from('avatars').remove([filePath]);
      
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Add cache-buster
      const url = `${publicUrl}?t=${Date.now()}`;
      
      await supabase.from('user_profiles').update({
        avatar_url: url,
      }).eq('id', user.id);

      setAvatarUrl(url);
      toast.success('Profile picture updated!');
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await runDailyScan();
      toast.success(`Scan complete! Found ${result.jobs_found} jobs, added ${result.jobs_added} new.`);
      fetchScans();
    } catch (e: any) {
      toast.error(e.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="container py-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-display font-bold">Settings</h1>

      {/* Profile Section */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {profileLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Profile Picture */}
              <div className="flex items-center gap-5">
                <div className="relative group">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Profile"
                      className="h-20 w-20 rounded-full object-cover border-2 border-[hsl(var(--glass-border)/0.4)]"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center border-2 border-[hsl(var(--glass-border)/0.4)]">
                      <User className="h-8 w-8 text-primary/50" />
                    </div>
                  )}
                  <button
                    onClick={() => document.getElementById('avatar-input')?.click()}
                    disabled={uploadingAvatar}
                    className="absolute inset-0 rounded-full bg-background/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                    ) : (
                      <Camera className="h-5 w-5 text-foreground" />
                    )}
                  </button>
                  <input
                    id="avatar-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleAvatarUpload(file);
                    }}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Profile Picture</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Hover to change · JPG, PNG, or WebP</p>
                </div>
              </div>

              {/* Full Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  Full Name
                </label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="bg-secondary border-[hsl(var(--glass-border)/0.3)]"
                />
                <p className="text-xs text-muted-foreground">Shown in your dashboard greeting</p>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
                  Email Address
                </label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="bg-secondary border-[hsl(var(--glass-border)/0.3)]"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingEmail || email === user?.email}
                    onClick={handleChangeEmail}
                    className="shrink-0 gap-1.5"
                  >
                    {savingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Update
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">A confirmation will be sent to your new email</p>
              </div>

              {/* City */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  City
                </label>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Kfar Saba"
                  className="bg-secondary border-[hsl(var(--glass-border)/0.3)]"
                />
                <p className="text-xs text-muted-foreground">Used for location scoring in job matches</p>
              </div>

              {/* CV Upload */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                  CV File
                </label>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => document.getElementById('cv-settings-input')?.click()}
                    className="gap-2"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? 'Uploading...' : 'Upload New CV'}
                  </Button>
                  {cvFilename && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      {cvFilename}
                    </span>
                  )}
                </div>
                <input
                  id="cv-settings-input"
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
              </div>

              {/* CV Text */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  CV Text
                </label>
                <Textarea
                  value={cvText}
                  onChange={(e) => setCvText(e.target.value)}
                  placeholder="Your CV text will appear here after upload, or paste it manually..."
                  className="bg-secondary border-[hsl(var(--glass-border)/0.3)] min-h-[200px] text-xs font-mono"
                  rows={10}
                />
                <p className="text-xs text-muted-foreground">This text is used for scoring and tailored CV generation</p>
              </div>

              <Button onClick={handleSaveProfile} disabled={saving} className="w-full gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save Profile'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Password Change */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              className="bg-secondary border-[hsl(var(--glass-border)/0.3)]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Confirm New Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="bg-secondary border-[hsl(var(--glass-border)/0.3)]"
            />
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={savingPassword || !newPassword || !confirmPassword}
            className="w-full gap-2"
          >
            {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {savingPassword ? 'Updating...' : 'Update Password'}
          </Button>
        </CardContent>
      </Card>

      {/* Scan Configuration */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            Scan Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <Mail className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Gmail Source</p>
                <p className="text-xs text-muted-foreground">Label: "Job Alerts" — Last 24 hours</p>
              </div>
              {gmailConnected ? (
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[hsl(var(--success))] border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.08)]">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={connectingGmail}
                    onClick={handleConnectGmail}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {connectingGmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    <span className="ml-1">Reconnect</span>
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={connectingGmail}
                  onClick={handleConnectGmail}
                  className="shrink-0 h-7 px-3 text-xs gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  {connectingGmail ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                  Connect Gmail
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <Brain className="h-5 w-5 text-accent shrink-0" />
              <div>
                <p className="text-sm font-medium">AI Analysis</p>
                <p className="text-xs text-muted-foreground">Claude — Extract, score & classify jobs</p>
              </div>
              <Badge variant="outline" className="ml-auto">Active</Badge>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <FileText className="h-5 w-5 text-[hsl(var(--success))] shrink-0" />
              <div>
                <p className="text-sm font-medium">CV Tailoring</p>
                <p className="text-xs text-muted-foreground">Auto-generate for jobs with score &gt; 6</p>
              </div>
              <Badge variant="outline" className="ml-auto">Active</Badge>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary">
              <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Deduplication</p>
                <p className="text-xs text-muted-foreground">Fingerprint: link or company+role+location</p>
              </div>
              <Badge variant="outline" className="ml-auto">Active</Badge>
            </div>
          </div>
          <Button onClick={handleScan} disabled={scanning} className="w-full gap-2" size="lg">
            {scanning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radar className="h-5 w-5" />}
            {scanning ? 'Running Scan...' : 'Run Manual Scan'}
          </Button>
          <Button onClick={handleReanalyzeJobs} disabled={reanalyzing} variant="outline" className="w-full gap-2" size="sm">
            {reanalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            {reanalyzing ? 'Re-analyzing...' : 'Fix Old Job Reasoning'}
          </Button>
        </CardContent>
      </Card>

      {/* Scan History */}
      <Card className="glass-card border-border">
        <CardHeader>
          <CardTitle className="font-display text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Scan History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : scans.length === 0 ? (
            <p className="text-muted-foreground text-sm">No scan history yet.</p>
          ) : (
            <div className="rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-[hsl(var(--glass-border)/0.3)]">
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Time</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Status</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Found</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Added</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scans.map((s) => (
                    <TableRow key={s.id} className="border-b border-[hsl(var(--glass-border)/0.2)] hover:bg-[hsl(var(--glass-border)/0.15)] transition-colors">
                      <TableCell className="text-sm">{format(new Date(s.started_at), 'MMM d, HH:mm')}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.success
                            ? 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]'
                            : 'bg-[hsl(var(--destructive)/0.12)] text-destructive'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${s.success ? 'bg-[hsl(var(--success))]' : 'bg-destructive'}`} />
                          {s.success ? 'Success' : 'Failed'}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{s.jobs_found}</TableCell>
                      <TableCell className="tabular-nums">{s.jobs_added}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                        {s.error_text || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
