import { createClient } from 'npm:@supabase/supabase-js@2.102.1';
import { makeHandler } from './handler.js';

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
const publicClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, options);
Deno.serve(makeHandler(admin, publicClient));
