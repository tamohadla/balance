import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.102.1/+esm";
import { createSessionStorage } from './auth-storage.js';

export const SUPABASE_URL = "https://zgcwnshcafxrtucbmdck.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnY3duc2hjYWZ4cnR1Y2JtZGNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MzYyNTYsImV4cCI6MjA4NjQxMjI1Nn0.prIum7M0zHf_5093ofAl_ep3egXhM5mGr7zqvkRzn-w";

export const sessionStorageAdapter = createSessionStorage(localStorage, sessionStorage);
const authFlow = new URLSearchParams(location.hash.slice(1)).get('type');
if (new URLSearchParams(location.search).get('mode') === 'password' || ['invite', 'recovery'].includes(authFlow)) {
  sessionStorageAdapter.remember(false);
}
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: sessionStorageAdapter, persistSession: true, autoRefreshToken: true }
});


export { createClient };

