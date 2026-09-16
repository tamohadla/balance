const origins = new Map([
  ['https://tamohadla.github.io', 'https://tamohadla.github.io/balance/login.html?mode=password'],
  ['http://127.0.0.1:49165', 'http://127.0.0.1:49165/login.html?mode=password']
]);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function makeHandler(admin, publicClient) {
  return async req => {
    const origin = req.headers.get('origin') || '';
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://tamohadla.github.io',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !origins.has(origin)) return reply(403, { error: 'ORIGIN_DENIED' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'METHOD_DENIED' });
    try {
      const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
      if (!token) return reply(401, { error: 'SIGN_IN_REQUIRED' });
      const { data: auth, error: authError } = await admin.auth.getUser(token);
      if (authError || !auth?.user || auth.user.is_anonymous) return reply(401, { error: 'SIGN_IN_REQUIRED' });
      const { data: member, error: memberError } = await admin.from('app_members').select('role,is_active').eq('user_id', auth.user.id).maybeSingle();
      if (memberError) throw memberError;
      if (!member?.is_active || member.role !== 'admin') return reply(403, { error: 'ADMIN_REQUIRED' });
      const raw = await req.text();
      if (raw.length > 8192) return reply(413, { error: 'INVALID_REQUEST' });
      let body;
      try { body = JSON.parse(raw); } catch { return reply(400, { error: 'INVALID_REQUEST' }); }
      if (!body || typeof body !== 'object') return reply(400, { error: 'INVALID_REQUEST' });
      const actor = auth.user.id;
      if (body.action === 'list') {
        const page = Number.isInteger(body.page) && body.page >= 1 && body.page <= 10000 ? body.page : 1;
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
        if (error) throw error;
        const ids = data.users.map(u => u.id);
        const result = ids.length ? await admin.from('app_members').select('user_id,display_name,role,is_active').in('user_id', ids) : { data: [], error: null };
        if (result.error) throw result.error;
        const members = new Map(result.data.map(m => [m.user_id, m]));
        const security = await admin.rpc('inventory_access_enforced');
        if (security.error) throw security.error;
        return reply(200, { users: data.users.map(u => ({ id: u.id, email: u.email || '',
          created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null,
          confirmed: Boolean(u.email_confirmed_at), member: members.get(u.id) || null })), page, hasMore: Boolean(data.nextPage), enforced: security.data === true });
      }
      if (body.action === 'history') {
        const page = Number.isInteger(body.page) && body.page > 0 && body.page <= 10000 ? body.page : 1;
        const { data, error } = await admin.from('account_events').select('id,actor_id,target_id,action,details,created_at')
          .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page-1)*50, page*50);
        if (error) throw error;
        return reply(200, { events: data.slice(0,50), hasMore: data.length > 50 });
      }
      if (body.action === 'save') {
        if (!uuid(body.id) || typeof body.name !== 'string' || body.name.length > 100 || !['admin','viewer'].includes(body.role) || typeof body.active !== 'boolean') return reply(400, { error: 'INVALID_MEMBER' });
        const { error } = await admin.rpc('admin_save_member', { actor, target: body.id, member_name: body.name, member_role: body.role, active: body.active });
        if (error) {
          if (error.message?.includes('LAST_ADMIN')) return reply(409, { error: 'LAST_ADMIN' });
          if (error.message?.includes('ADMIN_REQUIRED')) return reply(403, { error: 'ADMIN_REQUIRED' });
          throw error;
        }
        return reply(200, { ok: true });
      }
      if (body.action === 'invite') {
        if (typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || typeof body.name !== 'string' || body.name.length > 100 || !['admin','viewer'].includes(body.role)) return reply(400, { error: 'INVALID_MEMBER' });
        const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email.trim(), { redirectTo: origins.get(origin) || origins.get('https://tamohadla.github.io') });
        if (error) return reply(error.status === 429 ? 429 : 400, { error: 'INVITE_FAILED' });
        const { error: saveError } = await admin.rpc('admin_save_member', { actor, target: data.user.id, member_name: body.name, member_role: body.role, active: true });
        if (saveError) return reply(409, { error: 'INVITED_NOT_ACTIVATED' });
        return reply(200, { ok: true });
      }
      if (body.action === 'reset') {
        if (!uuid(body.id)) return reply(400, { error: 'INVALID_MEMBER' });
        const { data, error } = await admin.auth.admin.getUserById(body.id);
        if (error || !data?.user?.email) return reply(404, { error: 'USER_NOT_FOUND' });
        const { error: sendError } = await publicClient.auth.resetPasswordForEmail(data.user.email, { redirectTo: origins.get(origin) || origins.get('https://tamohadla.github.io') });
        if (sendError) return reply(sendError.status === 429 ? 429 : 400, { error: 'RESET_FAILED' });
        const { error: logError } = await admin.from('account_events').insert({ actor_id: actor, target_id: body.id, action: 'password_reset_requested' });
        return reply(200, { ok: true, warning: logError ? 'AUDIT_FAILED' : null });
      }
      return reply(400, { error: 'INVALID_REQUEST' });
    } catch {
      return reply(500, { error: 'SERVER_ERROR' });
    }
  };
}
