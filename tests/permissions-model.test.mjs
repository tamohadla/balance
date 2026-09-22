import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessPage,canView,canManage,canCreateOrder,homePage} from '../js/permissions.js';
const viewer={role:'viewer',is_active:true};
test('viewer is limited to inventory, order creation/review and own account',()=>{
 for(const page of ['inventory.html','orders.html','preorders.html','account.html'])assert.equal(canAccessPage(viewer,page),true,page);
 for(const page of ['index.html','items.html','sales.html','sales-review.html','purchases-review.html','users.html','import-batches.html','adjustments.html'])assert.equal(canAccessPage(viewer,page),false,page);
 assert.equal(homePage(viewer),'inventory.html');assert.equal(canCreateOrder(viewer),true);assert.equal(canManage(viewer,'orders'),false);
});
test('assistant permissions are explicit, read does not grant write and entry pages require manage',()=>{
 const member={role:'assistant',is_active:true,permissions:{purchases:'read',sales:'manage',orders:'read'}};
 assert.equal(canAccessPage(member,'purchases-review.html'),true);assert.equal(canAccessPage(member,'purchases.html'),false);
 assert.equal(canAccessPage(member,'sales.html'),true);assert.equal(canAccessPage(member,'preorders.html'),false);
 assert.equal(canAccessPage(member,'users.html'),false);assert.equal(canAccessPage(member,'inventory.html'),false);
 assert.equal(canManage(member,'purchases'),false);assert.equal(canCreateOrder(member),false);
 assert.equal(canView({...member,is_active:false},'sales'),false);
 assert.equal(homePage({role:'assistant',is_active:true,permissions:{}}),'account.html');
});
