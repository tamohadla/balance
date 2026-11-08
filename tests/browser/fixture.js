const adminId = '11111111-1111-4111-8111-111111111111';
export const item = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  main_category: 'أقمشة',
  sub_category: 'قطن',
  item_name: 'خامة تجريبية',
  color_code: '101',
  color_name: 'أبيض',
  unit_type: 'kg',
  is_active: true,
  image_path: null,
  created_at: '2026-01-01T00:00:00Z',
  balance_main: 20,
  balance_rolls: 10,
};

/** Replace only the API boundary; execute the real application modules and DOM. */
export async function mockBackend(page, { role = 'admin', signedIn = true } = {}) {
  await page.route('**/js/supabaseRaw.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    const item=${JSON.stringify(item)};
    const user=${signedIn ? JSON.stringify({ id: adminId, email: 'test@example.invalid' }) : 'null'};
    const member={user_id:${JSON.stringify(adminId)},display_name:'حساب الاختبار',role:${JSON.stringify(role)},is_active:true,permissions:{}};
    const tables={items:[item],inventory_balances:[item],app_members:[member],printed_mariages:[]};
    function query(table){let single=false;const chain=new Proxy({}, {get(_,key){
      if(key==='then')return (resolve,reject)=>Promise.resolve({data:single?(tables[table]?.[0]||null):(tables[table]||[]),error:null,count:tables[table]?.length||0}).then(resolve,reject);
      if(key==='single'||key==='maybeSingle')return ()=>{single=true;return chain;};
      return ()=>chain;
    }});return chain;}
    export const SUPABASE_URL='https://example.invalid';export const SUPABASE_ANON_KEY='public-test-key';
    export const sessionStorageAdapter={remember(){}};
    export const supabase={from:query,rpc:async()=>({data:null,error:null}),functions:{invoke:async()=>({data:{users:[],events:[]},error:null})},auth:{
      getSession:async()=>({data:{session:user?{user}:null},error:null}),getUser:async()=>({data:{user},error:null}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}),
      signInWithPassword:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({error:null})
    },storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://example.invalid/'+path}})})}};
    export const createClient=()=>supabase;
  `,
    }),
  );
  await page.route(/^https:\/\//, (route) => route.abort());
}
