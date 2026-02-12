import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const SUPABASE_URL = "https://zgcwnshcafxrtucbmdck.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnY3duc2hjYWZ4cnR1Y2JtZGNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4MzYyNTYsImV4cCI6MjA4NjQxMjI1Nn0.prIum7M0zHf_5093ofAl_ep3egXhM5mGr7zqvkRzn-w";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
