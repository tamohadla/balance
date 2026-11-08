// All existing application modules wait here before querying business data.
import { requireAccess } from './auth-guard.js';
await requireAccess();
export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseRaw.js';
