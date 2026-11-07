// All existing application modules wait here before querying business data.
import { requireAccess } from './auth-guard.js?v=workspace-2';
await requireAccess();
export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseRaw.js';
