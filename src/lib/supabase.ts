import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://updzignrofsvyoceeddw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwZHppZ25yb2ZzdnlvY2VlZGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5OTUxNDMsImV4cCI6MjA4OTU3MTE0M30.kYDAPFPiH1O3YOJOK7rrqCHOYy7sXCB8vP6jUFi0ORI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
