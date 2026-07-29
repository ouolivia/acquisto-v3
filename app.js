const STORE_KEY = 'procure-easy-data-v3';
const PHOTO_RENDER_VERSION = 2;
const DEFAULT_COLORS = ['-1','-2','-13','nero','bianco','黑','白'];
const STORES = [1,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19];
const state = loadState();
let screen = 'home';
let activeBatchId = null;
let draft = freshDraft();
let modal = null;
let lastRenderedScreen = null;
let detailSearchTerm = '';
let colorCategory = 'number';
let colorManageMode = false;
let suppressColorClickUntil = 0;

function today(){ const d=new Date(); const local=new Date(d.getTime()-d.getTimezoneOffset()*60000); return local.toISOString().slice(0,10); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function freshDraft(){ return {model:'',originalModel:'',cost:'',sale:'',unit:'piece',packSize:'',qty:'1',note:'',colors:[],stores:[],editIds:[],editContext:'',rawPhotoFile:null,photoBlob:null,photoUrl:''}; }
function loadState(){ try{ const x=JSON.parse(localStorage.getItem(STORE_KEY)); if(x&&Array.isArray(x.batches)) return {...x,colors:Array.isArray(x.colors)?x.colors:DEFAULT_COLORS}; }catch(e){} return {batches:[],colors:[...DEFAULT_COLORS]}; }
function save(){ localStorage.setItem(STORE_KEY,JSON.stringify(state)); }
function esc(v){ return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function pricePending(v){ return v===null||v===''||typeof v==='undefined'; }
function money(v){ return pricePending(v)?'待定':Number(v).toFixed(2); }
function euro(v){ return pricePending(v)?'待定':Number(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function priceDisplay(v){ return pricePending(v)?'待定':`€${money(v)}`; }
function draftPrice(v){ return pricePending(v)?'':String(v); }
function getBatch(){ return state.batches.find(b=>b.id===activeBatchId); }
function toast(msg){ const el=document.querySelector('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),1800); }
function parseQuantity(value,unit){ const s=String(value??'').trim(); if(unit==='pack'&&s==='半')return .5; return Number(s.replace(',','.')); }
function compactNumber(value){ const n=Number(value); return Number.isInteger(n)?String(n):String(Number(n.toFixed(2))); }
function totalPieces(line){ return line.unit==='pack'?Number(line.qty)*Number(line.packSize):Number(line.qty); }
function draftQuantity(line){ return line.unit==='pack'&&Number(line.qty)===.5?'半':String(line.qty); }
function quantityDisplay(line){ const pieces=compactNumber(totalPieces(line)); return line.unit==='pack'&&Number(line.qty)===.5?`半包（${pieces}件）`:`${pieces}件`; }
function exportQuantity(line){ return line.unit==='pack'?(Number(line.qty)===.5?'半包':`${compactNumber(line.qty)}包`):compactNumber(line.qty); }
function pdfQuantity(line){ return line.unit==='pack'?exportQuantity(line):`${compactNumber(line.qty)}件`; }
function isNumericColor(color){ return /^-?\d+(?:[.,]\d+)?$/.test(String(color||'').trim()); }
function batchStats(b){ const pieces=b.lines.reduce((s,l)=>s+totalPieces(l),0); const models=new Set(b.lines.map(l=>l.model)).size; const amount=b.lines.reduce((s,l)=>s+(pricePending(l.cost)?0:Number(l.cost)*totalPieces(l)),0); const hasPendingCost=b.lines.some(l=>pricePending(l.cost)); return {pieces,models,amount,hasPendingCost}; }
function storeSummary(b){
  const stores=new Map();
  for(const line of b.lines){
    if(!stores.has(line.store))stores.set(line.store,{store:line.store,models:new Set(),pieces:0,amount:0,hasPendingCost:false});
    const row=stores.get(line.store);row.models.add(line.model);row.pieces+=totalPieces(line);
    if(pricePending(line.cost))row.hasPendingCost=true;else row.amount+=Number(line.cost)*totalPieces(line);
  }
  return [...stores.values()].sort((a,z)=>a.store-z.store).map(row=>({...row,models:row.models.size}));
}
function detailGroups(b,order='sorted'){
  const groups=new Map();
  const rows=order==='input'?[...b.lines]:exportRows(b);
  for(const line of rows){
    const key=[line.model,line.cost,line.sale,line.color,line.unit,line.qty,line.packSize].join('\u001f');
    if(!groups.has(key))groups.set(key,{...line,ids:[],stores:[]});
    const group=groups.get(key); group.ids.push(line.id); group.stores.push(line.store);
  }
  return [...groups.values()].map(g=>({...g,stores:[...new Set(g.stores)].sort((a,b)=>a-b)}));
}
function modelDetailGroups(b,order='sorted'){
  const models=new Map();
  for(const g of detailGroups(b,order)){
    if(!models.has(g.model))models.set(g.model,{model:g.model,cost:g.cost,sale:g.sale,note:g.note||'',ids:[],items:new Map()});
    const model=models.get(g.model); model.ids.push(...g.ids); if(g.note)model.note=g.note;
    const key=[g.cost,g.sale,g.unit,g.qty,g.packSize,g.stores.join(',')].join('\u001f');
    if(!model.items.has(key))model.items.set(key,{...g,colors:[],ids:[]});
    const item=model.items.get(key); item.colors.push(g.color); item.ids.push(...g.ids);
  }
  return [...models.values()].map(m=>({...m,items:[...m.items.values()]}));
}
function fuzzyMatch(text,query){ const t=text.toLowerCase(),q=query.trim().toLowerCase();if(!q)return true;if(t.includes(q))return true;let i=0;for(const c of t)if(c===q[i])i++;return i===q.length; }
function icon(name){
  if(name==='edit')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
  if(name==='sort')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h11M8 12h8M8 19h5"/><path d="m3 7 2-2 2 2M5 5v14m-2-2 2 2 2-2"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>';
}
function cameraIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3v12H4Z"/><circle cx="12" cy="13" r="3.5"/></svg>';}
function releaseDraftPhoto(){if(draft.photoUrl)URL.revokeObjectURL(draft.photoUrl);draft.photoUrl='';draft.rawPhotoFile=null;draft.photoBlob=null;}
function setDraftPhoto(blob){if(draft.photoUrl)URL.revokeObjectURL(draft.photoUrl);draft.rawPhotoFile=null;draft.photoBlob=blob;draft.photoUrl=blob?URL.createObjectURL(blob):'';}
function setRawPhoto(file){if(draft.photoUrl)URL.revokeObjectURL(draft.photoUrl);draft.rawPhotoFile=file;draft.photoBlob=null;draft.photoUrl=file?URL.createObjectURL(file):'';}
function openPhotoCrop(file,finishAfterCrop=false){
  if(!file?.type?.startsWith('image/'))return toast('请选择照片文件');
  const sourceUrl=URL.createObjectURL(file);
  modal={type:'photo-crop',file,sourceUrl,finishAfterCrop,crop:{zoom:1,x:0,y:0}};
  render();
}
async function loadDraftPhoto(model){
  const record=await V3Photos.get(activeBatchId,model);
  if(record?.sourceBlob)setDraftPhoto(record.sourceBlob);
}
function header(title,subtitle='待录入'){ return `<header class="topbar"><div class="brand"><div class="brand-left"><div><h1>${esc(title)}</h1><span class="brand-kicker">OF-V3.0</span></div></div><span class="status-chip"><small>${esc(subtitle)}</small></span></div></header>`; }

function render(){
  const app=document.querySelector('#app');
  const screenChanged=lastRenderedScreen!==screen;
  document.body.dataset.screen=screen;
  if(screen==='home') app.innerHTML=homeView();
  if(screen==='entry') app.innerHTML=entryView();
  if(screen==='details') app.innerHTML=detailsView();
  if(modal) app.insertAdjacentHTML('beforeend',modalView());
  bind();
  if(screenChanged)requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'auto'}));
  lastRenderedScreen=screen;
}

function homeView(){
  const batches=[...state.batches].sort((a,b)=>b.createdAt-a.createdAt);
  return `${header('采购录入','待录入')}<div class="wrap">
    <section class="card"><h2>新建一批采购</h2><div class="stack">
      <div><label class="label">供应商名称</label><input id="supplier" class="field" placeholder="例如：Milano Trading" autocomplete="off"></div>
      <div><label class="label">采购日期</label><input id="date" class="field" type="date" value="${today()}"></div>
      <button class="btn btn-primary btn-wide" data-action="start">开始录入采购</button>
    </div></section>
    <div class="section-head"><h2>历史采购</h2><span class="muted">${batches.length} 批</span></div>
    ${batches.length?batches.map(b=>{const s=batchStats(b);return `<button class="card batch btn-wide" data-open="${b.id}" style="text-align:left"><div class="batch-main"><b>${esc(b.supplier)} <em>${esc(b.date)}</em></b><span>总金额：${s.hasPendingCost?'待定':`€${euro(s.amount)}`}　款式：${s.models}　总件数：${s.pieces}</span></div><span class="arrow">›</span></button>`}).join(''):`<div class="card empty"><div class="empty-icon">🧾</div>还没有采购记录<br><small>新建后，数据会自动保存在本机</small></div>`}
  </div>`;
}

function entryView(){
  const b=getBatch(); if(!b){screen='home';return homeView();}
  const numberColors=state.colors.filter(isNumericColor),textColors=state.colors.filter(c=>!isNumericColor(c));
  const visibleColors=colorCategory==='number'?numberColors:textColors;
  const allocatedStores=new Set(b.lines.filter(l=>l.model===draft.model&&(!draft.colors.length||draft.colors.includes(l.color))).map(l=>l.store));
  const previewLines=b.lines.filter(l=>l.model===draft.model).sort((a,z)=>a.store-z.store||a.color.localeCompare(z.color));
  const previewTotal=previewLines.reduce((sum,l)=>sum+totalPieces(l),0);
  const previewStores=[...previewLines.reduce((map,l)=>{if(!map.has(l.store))map.set(l.store,{store:l.store,lines:[],ids:[]});const g=map.get(l.store);g.lines.push(l);g.ids.push(l.id);return map;},new Map()).values()];
  return `${header('采购录入',`${b.supplier} · ${b.date}`)}<div class="wrap">
    <section class="card photo-capture-card">
      <button type="button" class="photo-capture-preview" data-action="take-photo" aria-label="${draft.photoUrl?'重新拍摄商品照片':'拍摄商品照片'}">${draft.photoUrl?`<img src="${draft.photoUrl}" alt="当前型号商品照片">`:cameraIcon()}</button>
      <div class="photo-entry-panel"><div class="photo-entry-heading"><h2>商品照片 *</h2><p>${draft.photoUrl?'已确认；点击照片可重拍。':'点击照片拍摄并确认。'}</p></div><input id="photoInput" type="file" accept="image/*" capture="environment" hidden>
        <div class="inside-field"><span>型号 *</span><input id="model" value="${esc(draft.model)}" placeholder="例如：001" autocomplete="off"></div>
        <div class="grid2"><div class="inside-field"><span>进价</span><input id="cost" type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="next" value="${esc(draft.cost)}" placeholder="0.00"></div>
        <div class="inside-field"><span>卖价</span><input id="sale" type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="done" value="${esc(draft.sale)}" placeholder="0.00"></div></div>
        <div class="unit-switch"><button class="choice ${draft.unit==='piece'?'active':''}" data-unit="piece">件</button><button class="choice ${draft.unit==='pack'?'active':''}" data-unit="pack">包</button></div>
        ${draft.unit==='pack'?`<div class="inside-field pack-size-field"><span>每包件数 *</span><input id="packSize" type="number" min="1" step="1" inputmode="numeric" value="${esc(draft.packSize)}" placeholder="例如：12"></div>`:''}
      </div>
    </section>
    <section class="card"><div class="section-head color-section-head"><div class="color-category-switch"><button class="${colorCategory==='number'?'active':''}" data-color-category="number">数字</button><button class="${colorCategory==='text'?'active':''}" data-color-category="text">文字</button></div><div class="color-head-actions"><button class="color-manage-btn" data-action="edit-colors" aria-label="修改全部颜色" title="修改全部颜色">${icon('edit')}</button><div class="color-quick-add"><input id="quickColor" placeholder="新增颜色" autocomplete="off"><button type="button" data-action="quick-add-color" aria-label="添加颜色">＋</button></div>${colorManageMode?`<button class="color-done-btn" data-action="finish-color-manage">完成整理</button>`:''}<button class="color-clear-btn" data-action="clear-colors" ${draft.colors.length?'':'disabled'}>取消选择</button></div></div><div class="chips color-sortable ${colorManageMode?'managing':''}">${colorManageMode?visibleColors.map(c=>`<div class="chip color-manage-chip ${draft.colors.includes(c)?'active':''}" data-drag-color="${esc(c)}"><span>${esc(c)}</span><button type="button" data-delete-color="${esc(c)}" aria-label="删除颜色 ${esc(c)}">×</button></div>`).join(''):visibleColors.map(c=>`<button type="button" class="chip ${draft.colors.includes(c)?'active':''}" data-color="${esc(c)}">${esc(c)}</button>`).join('')}</div>${colorManageMode?'<p class="color-manage-hint">拖动颜色可上下、左右排序；点击 × 删除预设颜色。</p>':'<p class="color-longpress-hint">长按颜色可整理顺序或删除。</p>'}</section>
    <section class="card"><div class="section-head"><h2>数量与门店</h2><button class="link-btn" data-action="toggle-stores">${draft.stores.filter(n=>STORES.includes(n)).length===STORES.length?'取消全选':'全选'}</button></div>
      <div class="qty-allocate-row"><div class="qty-input-wrap"><button type="button" class="qty-step" data-qty-step="-1" aria-label="减少数量">−</button><input id="qty" type="${draft.unit==='pack'?'text':'number'}" ${draft.unit==='pack'?'inputmode="decimal"':'min="1" step="1" inputmode="numeric"'} value="${esc(draft.qty)}" aria-label="数量"><span>${draft.unit==='pack'?'包':'件'}</span><button type="button" class="qty-step" data-qty-step="1" aria-label="增加数量">＋</button></div><button class="btn btn-primary" data-action="allocate">${draft.editIds.length?'保存修改':'分配到所选门店'}</button></div>
      <div class="store-grid">${STORES.map(n=>`<button class="store ${draft.stores.includes(n)?'active':''} ${allocatedStores.has(n)?'allocated':''}" data-store="${n}">${allocatedStores.has(n)?'<span class="allocated-mark">✓</span>':''}${n}</button>`).join('')}</div><p class="hint">已选 ${draft.stores.filter(n=>STORES.includes(n)).length} 家门店 · <span class="allocated-legend">✓ 已分配过</span></p>
    </section>
    <section class="card model-note-card"><div class="section-head"><h2>型号备注 <small class="optional">选填</small></h2></div><textarea id="note" class="model-note-input" rows="2" placeholder="例如：包装要求、尺码或其他说明">${esc(draft.note)}</textarea></section>
    <section class="card compact-action-card">${draft.editIds.length?`<button class="btn btn-light btn-wide" data-action="cancel-edit">取消修改</button>`:`<button class="btn btn-secondary btn-wide" data-action="finish-model">确认提交且输入下一个</button>`}</section>
    ${previewStores.length?`<section class="allocation-preview"><div class="preview-head"><div><h2>已分配预览</h2><div class="preview-model"><b>${esc(draft.model)}</b><span>${priceDisplay(previewLines[0]?.cost)} <em>/</em> ${priceDisplay(previewLines[0]?.sale)}</span></div></div><strong>共 ${compactNumber(previewTotal)} 件</strong></div><div class="preview-list">${previewStores.map(g=>`<div class="preview-row ${draft.editContext==='preview'&&g.ids.some(id=>draft.editIds.includes(id))?'editing':''}"><span class="preview-store">${g.store}店</span><div class="preview-items">${g.lines.map(l=>`<div>${l.color?`<small>${esc(l.color)}</small>`:'<small>无颜色</small>'}<b>× ${quantityDisplay(l)}</b></div>`).join('')}</div><div class="preview-actions"><button data-edit-preview-store="${g.store}" aria-label="修改 ${g.store} 店分配" title="修改">${icon('edit')}</button><button class="delete" data-delete-preview-store="${g.store}" aria-label="删除 ${g.store} 店分配" title="删除">${icon('delete')}</button></div></div>`).join('')}</div></section>`:''}
  </div><nav class="bottom"><div class="bottom-inner"><button class="btn btn-light" data-action="back-home">采购列表</button><button class="btn btn-primary" data-action="details">查看明细（${b.lines.length}）</button></div></nav>`;
}

function detailsView(){
  const b=getBatch(); if(!b){screen='home';return homeView();}
  const modelGroups=modelDetailGroups(b,'input').reverse();
  return `${header('采购明细',`${b.supplier} · ${b.date}`)}<div class="wrap">
    <section class="detail-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><input id="detailSearch" value="${esc(detailSearchTerm)}" placeholder="模糊搜索当前采购型号" autocomplete="off"><button data-action="clear-search" aria-label="清除搜索">×</button></section>
    <section class="card no-print"><div class="toolbar detail-toolbar"><button class="btn btn-secondary" data-action="photos">图片分享</button><button class="btn btn-secondary" data-action="summary">查看汇总</button><button class="btn btn-secondary" data-action="excel">导出 Excel</button><button class="btn btn-secondary" data-action="pdf">导出 PDF</button></div></section>
    <div id="modelList">${modelGroups.length?modelGroups.map(m=>`<div class="swipe-wrap" data-search-model="${esc(m.model.toLowerCase())}"><div class="swipe-actions no-print"><button data-edit-model="${esc(m.model)}">修改</button><button class="delete" data-delete-model="${esc(m.model)}">删除</button></div><section class="card purchase-model swipe-content"><div class="purchase-top"><b>${esc(m.model)}</b><span class="purchase-price"><i>进价/卖价</i><strong>${priceDisplay(m.cost)} <em>/</em> ${priceDisplay(m.sale)}</strong></span></div>${m.note?`<div class="model-note-detail"><span>备注</span><p>${esc(m.note)}</p></div>`:''}<div class="color-list">${m.items.map(g=>{const colors=g.colors.filter(Boolean);return `<div class="color-row"><div class="color-info ${colors.length?'':'no-color'}">${colors.length?`<small>${colors.map(esc).join('　')}</small>`:''}<p>门店 ${g.stores.join(', ')} <strong>× ${quantityDisplay(g)}</strong></p></div></div>`;}).join('')}</div></section></div>`).join(''):`<div class="card empty"><div class="empty-icon">📦</div>还没有分配商品</div>`}</div>
  </div><nav class="bottom"><div class="bottom-inner"><button class="btn btn-light" data-action="home-from-details">采购列表</button><button class="btn btn-primary" data-action="continue">继续录入</button></div></nav>`;
}

function modalView(){
  if(modal.type==='photo-crop') return `<div class="modal-backdrop centered-modal"><section class="modal photo-crop-modal" role="dialog" aria-modal="true" aria-label="裁剪商品照片"><div class="color-manager-head"><span class="color-manager-icon">${cameraIcon()}</span><div><h2>裁剪商品照片</h2><p class="modal-hint">单指拖动调整位置，双指捏合放大或缩小。</p></div></div><div class="photo-crop-stage" id="photoCropStage"><img id="photoCropImage" src="${modal.sourceUrl}" alt="待裁剪照片"></div><div class="modal-actions"><button class="btn btn-light" data-action="retake-photo">重新拍照</button><button class="btn btn-primary" data-action="save-photo-crop">使用照片</button></div></section></div>`;
  if(modal.type==='photo-gallery'){
    const selected=modal.selected||new Set(),ready=modal.items.filter(item=>item.record?.renderedBlob);
    return `<div class="modal-backdrop centered-modal"><section class="modal photo-gallery-modal" role="dialog" aria-modal="true" aria-label="商品图片分享"><div class="photo-gallery-head"><div><h2>商品图片</h2><p>${esc(getBatch().supplier)} · 已保存 ${ready.length}/${modal.items.length} 张</p></div><button data-action="close-modal" aria-label="关闭图片分享">×</button></div><div class="photo-gallery-tools"><button class="btn btn-light" data-action="select-all-photos">${selected.size===ready.length&&ready.length?'取消全选':'全选'}</button><button class="btn btn-light" data-action="refresh-photos">重新生成</button></div><p class="photo-gallery-status">已选 ${selected.size} 张；批量分享会打开手机系统分享面板，再选择微信工作群。</p><div class="photo-grid">${modal.items.map(item=>`<button class="photo-item ${selected.has(item.model)?'selected':''}" data-photo-model="${esc(item.model)}" ${item.record?.renderedBlob?'':'disabled'}>${item.url?`<img src="${item.url}" alt="${esc(item.model)} 商品图片">`:'<span class="photo-missing">缺少照片</span>'}<b>${esc(item.model)}</b><small>${item.record?.renderedBlob?esc(item.record.filename):'未拍照'}</small>${selected.has(item.model)?'<i>✓</i>':''}</button>`).join('')}</div><div class="photo-gallery-actions"><button class="btn btn-light" data-action="save-photos">保存选中图片</button><button class="btn btn-primary" data-action="share-photos">批量分享到工作群</button></div></section></div>`;
  }
  if(modal.type==='color') return `<div class="modal-backdrop centered-modal"><div class="modal color-add-modal"><div class="color-manager-head"><span class="color-manager-icon color-add-icon">＋</span><div><h2>增加颜色</h2><p class="modal-hint">支持数字编号、外文或中文颜色，增加后会自动选中。</p></div></div><div class="color-add-field"><label for="newColor">颜色名称或编号</label><input id="newColor" class="field" placeholder="例如：-5、rosso、红" autocomplete="off"></div><div class="modal-actions"><button class="btn btn-light" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-color">增加并选中</button></div></div></div>`;
  if(modal.type==='edit-colors') return `<div class="modal-backdrop centered-modal"><div class="modal color-manager"><div class="color-manager-head"><span class="color-manager-icon">${icon('edit')}</span><div><h2>修改全部颜色</h2><p class="modal-hint">直接修改名称，保存后所有采购记录中的对应颜色会同步更新。</p></div></div><div class="color-edit-list">${state.colors.map((c,i)=>`<div><label>${i+1}</label><input class="field" data-color-original="${esc(c)}" value="${esc(c)}" autocomplete="off"></div>`).join('')}</div><div class="modal-actions"><button class="btn btn-light" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-colors-edit">保存全部</button></div></div></div>`;
  if(modal.type==='sort-colors') return `<div class="modal-backdrop centered-modal color-sort-backdrop"><div class="modal color-sort-manager"><div class="color-manager-head"><span class="color-manager-icon">${icon('sort')}</span><div><h2>调整颜色顺序</h2><p class="modal-hint">${modal.selected?'再点一个目标位置，颜色会移动到那里。':'先点要移动的颜色，再点目标位置，可跨行上下、左右调整。'}</p></div></div><div class="color-sort-grid">${modal.order.map((c,i)=>`<button type="button" class="color-sort-item ${modal.selected===c?'selected':''}" data-sort-color="${esc(c)}"><span>${i+1}</span><b>${esc(c)}</b><i>${modal.selected===c?'已选中':'点击选择'}</i></button>`).join('')}</div><div class="modal-actions"><button class="btn btn-light" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-color-order">保存顺序</button></div></div></div>`;
  if(modal.type==='summary'){
    const b=getBatch(),stats=batchStats(b),sortKey=modal.sortKey||'store',sortDir=modal.sortDir||'asc',factor=sortDir==='asc'?1:-1;
    const rows=storeSummary(b).sort((a,z)=>{if(sortKey==='amount'&&a.hasPendingCost!==z.hasPendingCost)return a.hasPendingCost?1:-1;const av=a[sortKey],zv=z[sortKey];return (av-zv||a.store-z.store)*factor;});
    const sortHead=(key,label)=>`<th aria-sort="${sortKey===key?(sortDir==='asc'?'ascending':'descending'):'none'}"><button type="button" data-summary-sort="${key}">${label}<i>${sortKey===key?(sortDir==='asc'?'↑':'↓'):'↕'}</i></button></th>`;
    return `<div class="modal-backdrop centered-modal summary-backdrop"><section class="modal store-summary-modal" role="dialog" aria-modal="true" aria-label="门店采购汇总"><div class="summary-modal-head"><div><h2>门店采购汇总</h2><p>${esc(b.supplier)} · ${esc(b.date)}</p></div><button data-action="close-modal" aria-label="关闭汇总">×</button></div><div class="summary-table-wrap"><table class="store-summary-table"><thead><tr>${sortHead('store','门店')}${sortHead('models','总款式')}${sortHead('pieces','总件数')}${sortHead('amount','总额')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr><td><b>${row.store}</b>店</td><td>${row.models}</td><td>${compactNumber(row.pieces)}</td><td>${row.hasPendingCost?'待定':`€${euro(row.amount)}`}</td></tr>`).join(''):`<tr><td colspan="4" class="summary-empty">暂无采购数据</td></tr>`}</tbody>${rows.length?`<tfoot><tr><th>合计</th><th>${stats.models}</th><th>${compactNumber(stats.pieces)}</th><th>${stats.hasPendingCost?'待定':`€${euro(stats.amount)}`}</th></tr></tfoot>`:''}</table></div><p class="summary-note">点击表头可切换排序；同一型号的全部颜色，在每家门店只计算为 1 个款式。</p><button class="btn btn-primary summary-close-btn" data-action="close-modal">完成</button></section></div>`;
  }
  if(modal.type==='pdf-preview') return `<div class="modal-backdrop pdf-preview-backdrop"><section class="pdf-preview-modal" role="dialog" aria-modal="true" aria-label="PDF 预览"><header class="pdf-preview-head"><div><h2>PDF 预览</h2><p>A4 供应商分货单 · ${modal.output.pages.length} 页</p></div><button data-action="close-modal" aria-label="关闭 PDF 预览">×</button></header><div class="pdf-preview-pages">${modal.output.pages.map((src,i)=>`<figure><img src="${src}" alt="PDF 第 ${i+1} 页预览"><figcaption>第 ${i+1} 页</figcaption></figure>`).join('')}</div><footer class="pdf-preview-actions"><button class="btn btn-light" data-action="close-modal">返回修改</button><button class="btn btn-primary" data-action="export-pdf-file">确认导出 PDF</button></footer></section></div>`;
  return '';
}

function syncDraft(){
  for(const [id,key] of [['model','model'],['cost','cost'],['sale','sale'],['packSize','packSize'],['qty','qty'],['note','note']]){const el=document.querySelector('#'+id);if(el)draft[key]=el.value.trim();}
}
function persistDraftNote(){
  syncDraft();const b=getBatch();if(!b||!draft.model)return [];
  const lines=b.lines.filter(line=>line.model===draft.model);let changed=false;
  lines.forEach(line=>{if((line.note||'')!==draft.note){line.note=draft.note;changed=true;}});
  if(changed){save();V3Photos.markDirty(b.id,draft.model);}return lines;
}
function normalizeSale(v){ const s=String(v).trim(); if(!s)return ''; return s.includes('.')?Number(s).toFixed(2):`${parseInt(s,10)}.99`; }
function validDraft(){ syncDraft(); if(!draft.model)return '请输入型号'; if(draft.cost!==''&&(!Number.isFinite(Number(draft.cost))||Number(draft.cost)<0))return '请输入正确的进价'; if(draft.sale!==''&&(!Number.isFinite(Number(draft.sale))||Number(draft.sale)<0))return '请输入正确的卖价'; if(draft.unit==='pack'&&Number(draft.packSize)<1)return '请输入每包件数'; const qty=parseQuantity(draft.qty,draft.unit); if(!Number.isFinite(qty)||qty<=0||(draft.unit==='piece'&&(!Number.isInteger(qty)||qty<1)))return '请输入正确的数量'; if(!draft.stores.length)return '请选择至少一家门店'; return ''; }
function applyDetailFilter(){const input=document.querySelector('#detailSearch');if(!input)return;detailSearchTerm=input.value;document.querySelectorAll('[data-search-model]').forEach(el=>el.hidden=!fuzzyMatch(el.dataset.searchModel,detailSearchTerm));}

function bind(){
  document.querySelectorAll('[data-unit]').forEach(x=>x.onclick=()=>{syncDraft();draft.unit=x.dataset.unit;const q=parseQuantity(draft.qty,draft.unit);if(!Number.isFinite(q)||q<1)draft.qty='1';else if(draft.unit==='piece')draft.qty=String(Math.max(1,Math.round(q)));render();});
  document.querySelectorAll('[data-color-category]').forEach(x=>x.onclick=()=>{syncDraft();colorCategory=x.dataset.colorCategory;render();});
  document.querySelectorAll('[data-color]').forEach(x=>{
    x.onclick=()=>{if(Date.now()<suppressColorClickUntil)return;syncDraft();const c=x.dataset.color;draft.colors=draft.colors.includes(c)?draft.colors.filter(v=>v!==c):[...draft.colors,c];render();};
    let timer=null,start=null;
    const cancelHold=()=>{clearTimeout(timer);timer=null;};
    x.onpointerdown=e=>{if(typeof e.button==='number'&&e.button!==0)return;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>{suppressColorClickUntil=Date.now()+700;syncDraft();colorManageMode=true;render();toast('已进入颜色整理：拖动排序，点击 × 删除');},520);};
    x.onpointermove=e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>9)cancelHold();};
    x.onpointerup=cancelHold;x.onpointercancel=cancelHold;x.onpointerleave=cancelHold;
  });
  document.querySelectorAll('[data-delete-color]').forEach(x=>x.onclick=e=>{e.stopPropagation();syncDraft();const color=x.dataset.deleteColor;state.colors=state.colors.filter(c=>c!==color);draft.colors=draft.colors.filter(c=>c!==color);save();render();toast(`已删除预设颜色 ${color}`);});
  document.querySelectorAll('[data-drag-color]').forEach(x=>{
    let dragging=false,start=null;
    const finish=()=>{
      if(!start)return;
      const container=x.closest('.color-sortable'),visibleSet=new Set([...container.querySelectorAll('[data-drag-color]')].map(item=>item.dataset.dragColor)),displayed=[...container.querySelectorAll('[data-drag-color]')].map(item=>item.dataset.dragColor);
      state.colors=state.colors.map(color=>visibleSet.has(color)?displayed.shift():color);
      x.classList.remove('dragging');x.style.pointerEvents='';start=null;dragging=false;save();render();
    };
    x.onpointerdown=e=>{if(e.target.closest('[data-delete-color]'))return;start={x:e.clientX,y:e.clientY};x.setPointerCapture?.(e.pointerId);};
    x.onpointermove=e=>{
      if(!start)return;
      if(!dragging&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<6)return;
      dragging=true;x.classList.add('dragging');x.style.pointerEvents='none';
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('[data-drag-color]');
      x.style.pointerEvents='';
      if(!target||target===x||target.parentElement!==x.parentElement)return;
      const rect=target.getBoundingClientRect(),before=e.clientY<rect.top+rect.height/2||(Math.abs(e.clientY-(rect.top+rect.height/2))<rect.height*.34&&e.clientX<rect.left+rect.width/2);
      target.parentElement.insertBefore(x,before?target:target.nextSibling);
    };
    x.onpointerup=e=>{try{x.releasePointerCapture?.(e.pointerId);}catch(error){}finish();};
    x.onpointercancel=finish;
  });
  document.querySelectorAll('[data-summary-sort]').forEach(x=>x.onclick=()=>{const key=x.dataset.summarySort;modal.sortDir=modal.sortKey===key&&modal.sortDir==='asc'?'desc':'asc';modal.sortKey=key;render();});
  document.querySelectorAll('[data-sort-color]').forEach(x=>{
    x.onclick=()=>{const target=x.dataset.sortColor;if(!modal.selected){modal.selected=target;render();return;}if(modal.selected===target){modal.selected=null;render();return;}const from=modal.order.indexOf(modal.selected),to=modal.order.indexOf(target);if(from>=0&&to>=0){const [moving]=modal.order.splice(from,1);modal.order.splice(to,0,moving);}modal.selected=null;render();};
  });
  document.querySelectorAll('[data-qty-step]').forEach(x=>x.onclick=()=>{syncDraft();const step=Number(x.dataset.qtyStep);let q=parseQuantity(draft.qty,draft.unit);if(!Number.isFinite(q)||q<=0)q=1;if(draft.unit==='pack'){if(step<0)q=q<=1?.5:Math.max(1,Math.round(q)-1);else q=q<1?1:Math.max(1,Math.round(q)+1);draft.qty=q===.5?'半':String(q);}else{draft.qty=String(Math.max(1,Math.round(q)+step));}render();});
  document.querySelectorAll('[data-store]').forEach(x=>x.onclick=()=>{syncDraft();const n=Number(x.dataset.store);draft.stores=draft.stores.includes(n)?draft.stores.filter(v=>v!==n):[...draft.stores,n];render();});
  document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{activeBatchId=x.dataset.open;detailSearchTerm='';screen='details';render();});
  document.querySelectorAll('[data-edit-model]').forEach(x=>x.onclick=async()=>{
    const batch=getBatch(),lines=batch.lines.filter(l=>l.model===x.dataset.editModel),first=lines[0];
    if(!first)return;
    let photoRecord=null;
    try{photoRecord=await V3Photos.get(batch.id,first.model);}catch(error){}
    releaseDraftPhoto();
    draft={...freshDraft(),model:first.model,originalModel:first.model,cost:draftPrice(first.cost),sale:draftPrice(first.sale),unit:first.unit,packSize:first.unit==='pack'?String(first.packSize):'',qty:draftQuantity(first),note:first.note||'',colors:[...new Set(lines.map(l=>l.color).filter(Boolean))],stores:[...new Set(lines.map(l=>l.store).filter(n=>STORES.includes(n)))].sort((a,b)=>a-b),editIds:lines.map(l=>l.id),editContext:'model'};
    if(photoRecord?.sourceBlob)setDraftPhoto(photoRecord.sourceBlob);
    screen='entry';render();
    if(!photoRecord?.sourceBlob)toast('未找到原照片，可修改数据或重新拍照');
  });
  document.querySelectorAll('[data-edit-preview-store]').forEach(x=>x.onclick=()=>{const store=Number(x.dataset.editPreviewStore),lines=getBatch().lines.filter(l=>l.model===draft.model&&l.store===store),first=lines[0];if(!first)return;const rawPhotoFile=draft.rawPhotoFile,photoBlob=draft.photoBlob,photoUrl=draft.photoUrl,originalModel=draft.originalModel||first.model;draft={...freshDraft(),model:first.model,originalModel,cost:draftPrice(first.cost),sale:draftPrice(first.sale),unit:first.unit,packSize:first.unit==='pack'?String(first.packSize):'',qty:draftQuantity(first),note:first.note||'',colors:[...new Set(lines.map(l=>l.color).filter(Boolean))],stores:[store],editIds:lines.map(l=>l.id),editContext:'preview',rawPhotoFile,photoBlob,photoUrl};render();requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'smooth'}));toast(`正在修改 ${store} 店`);});
  document.querySelectorAll('[data-delete-preview-store]').forEach(x=>x.onclick=async()=>{const store=Number(x.dataset.deletePreviewStore),model=draft.model;if(confirm(`确定删除 ${store} 店在型号 ${model} 下的全部分配吗？`)){const b=getBatch();b.lines=b.lines.filter(l=>!(l.model===model&&l.store===store));save();await regenerateModelPhoto(b,model);render();toast(`已删除 ${store} 店分配`);}});
  document.querySelectorAll('[data-delete-model]').forEach(x=>x.onclick=async()=>{const model=x.dataset.deleteModel;if(confirm(`确定删除型号 ${model} 的全部采购信息和照片吗？`)){const b=getBatch();b.lines=b.lines.filter(l=>l.model!==model);save();await V3Photos.remove(b.id,model);render();toast(`型号 ${model} 已删除`);}});
  document.querySelectorAll('.swipe-content').forEach(x=>{let startX=null,dx=0;x.onpointerdown=e=>{if(e.target.closest('button'))return;startX=e.clientX;dx=0;x.style.transition='none';x.setPointerCapture?.(e.pointerId);};x.onpointermove=e=>{if(startX===null)return;dx=Math.max(-132,Math.min(0,e.clientX-startX));if(Math.abs(dx)>6)x.style.transform=`translateX(${dx}px)`;};x.onpointerup=e=>{if(startX===null)return;x.style.transition='transform .2s ease';x.style.transform=dx<-45?'translateX(-132px)':'translateX(0)';x.closest('.swipe-wrap')?.classList.toggle('open',dx<-45);startX=null;x.releasePointerCapture?.(e.pointerId);};});
  const search=document.querySelector('#detailSearch');if(search){search.oninput=applyDetailFilter;applyDetailFilter();}
  document.querySelectorAll('[data-photo-model]').forEach(x=>x.onclick=()=>{const model=x.dataset.photoModel;if(modal.selected.has(model))modal.selected.delete(model);else modal.selected.add(model);render();});
  document.querySelectorAll('[data-action]').forEach(x=>x.onclick=()=>action(x.dataset.action));
  const photoInput=document.querySelector('#photoInput');
  if(photoInput)photoInput.onchange=()=>{const file=photoInput.files?.[0];if(file)openPhotoCrop(file);photoInput.value='';};
  const quickColor=document.querySelector('#quickColor');
  if(quickColor)quickColor.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();action('quick-add-color');}};
  const cropStage=document.querySelector('#photoCropStage'),cropImage=document.querySelector('#photoCropImage');
  if(cropStage&&cropImage){
    const applyCropTransform=()=>{cropImage.style.transform=`translate(${modal.crop.x}px,${modal.crop.y}px) scale(${modal.crop.zoom})`;};
    const points=new Map();
    const point=e=>({x:e.clientX,y:e.clientY});
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const beginPan=p=>({type:'pan',start:p,ox:modal.crop.x,oy:modal.crop.y});
    const beginPinch=()=>{
      const [a,b]=[...points.values()],mid=midpoint(a,b);
      return {type:'pinch',distance:Math.max(1,distance(a,b)),zoom:modal.crop.zoom,mid,ox:modal.crop.x,oy:modal.crop.y};
    };
    let gesture=null;
    cropStage.onpointerdown=e=>{
      points.set(e.pointerId,point(e));
      cropStage.setPointerCapture?.(e.pointerId);
      gesture=points.size>=2?beginPinch():beginPan(point(e));
    };
    cropStage.onpointermove=e=>{
      if(!points.has(e.pointerId))return;
      points.set(e.pointerId,point(e));
      if(points.size>=2){
        if(gesture?.type!=='pinch')gesture=beginPinch();
        const [a,b]=[...points.values()],mid=midpoint(a,b);
        modal.crop.zoom=Math.max(1,Math.min(4,gesture.zoom*distance(a,b)/gesture.distance));
        modal.crop.x=gesture.ox+mid.x-gesture.mid.x;
        modal.crop.y=gesture.oy+mid.y-gesture.mid.y;
      }else if(gesture?.type==='pan'){
        const current=point(e);
        modal.crop.x=gesture.ox+current.x-gesture.start.x;
        modal.crop.y=gesture.oy+current.y-gesture.start.y;
      }
      applyCropTransform();
    };
    const endPointer=e=>{
      points.delete(e.pointerId);
      try{cropStage.releasePointerCapture?.(e.pointerId);}catch(error){}
      gesture=points.size>=2?beginPinch():points.size===1?beginPan([...points.values()][0]):null;
    };
    cropStage.onpointerup=endPointer;
    cropStage.onpointercancel=endPointer;
    applyCropTransform();
  }
  const cost=document.querySelector('#cost'),sale=document.querySelector('#sale');
  if(cost)cost.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();syncDraft();sale?.focus();}};
  if(sale)sale.onblur=()=>{draft.sale=normalizeSale(sale.value);sale.value=draft.sale;};
}

async function completeCurrentModel(){
  try{await saveAndRenderModelPhoto(getBatch(),draft.model,draft.photoBlob,draft.originalModel);}
  catch(error){toast(error.message||'图片保存失败');return false;}
  releaseDraftPhoto();draft=freshDraft();render();setTimeout(()=>document.querySelector('#model')?.focus(),0);toast('图片已保存，可以输入下一个型号');return true;
}

async function action(name){
  if(name==='start'){const supplier=document.querySelector('#supplier').value.trim();const date=document.querySelector('#date').value;if(!supplier)return toast('请填写供应商名称');const b={id:uid(),supplier,date:date||today(),createdAt:Date.now(),lines:[]};state.batches.push(b);activeBatchId=b.id;colorManageMode=false;releaseDraftPhoto();draft=freshDraft();save();V3Photos.requestPersistence();screen='entry';render();}
  if(name==='back-home'||name==='home-from-details'){persistDraftNote();colorManageMode=false;releaseDraftPhoto();screen='home';activeBatchId=null;render();}
  if(name==='details'){const lines=persistDraftNote();if(draft.model&&lines.length){try{await saveAndRenderModelPhoto(getBatch(),draft.model,draft.photoBlob,draft.originalModel);}catch(error){}}colorManageMode=false;screen='details';render();}
  if(name==='continue'){screen='entry';render();}
  if(name==='take-photo'){document.querySelector('#photoInput')?.click();}
  if(name==='retake-photo'){if(modal?.type==='photo-crop'&&modal.sourceUrl)URL.revokeObjectURL(modal.sourceUrl);modal=null;render();setTimeout(()=>document.querySelector('#photoInput')?.click(),0);}
  if(name==='save-photo-crop'){const stage=document.querySelector('#photoCropStage');if(!stage)return;try{const rect=stage.getBoundingClientRect(),finishAfterCrop=modal.finishAfterCrop,blob=await V3Photos.crop(modal.file,{...modal.crop,frameW:rect.width,frameH:rect.height});URL.revokeObjectURL(modal.sourceUrl);setDraftPhoto(blob);modal=null;if(finishAfterCrop)await completeCurrentModel();else{render();setTimeout(()=>document.querySelector('#model')?.focus(),0);toast('照片已确认，可以录入商品数据');}}catch(error){toast(error.message||'照片裁剪失败');}}
  if(name==='add-color'){syncDraft();modal={type:'color'};render();setTimeout(()=>document.querySelector('#newColor')?.focus(),0);}
  if(name==='clear-colors'){syncDraft();draft.colors=[];render();toast('已取消颜色选择');}
  if(name==='edit-colors'){syncDraft();modal={type:'edit-colors'};render();setTimeout(()=>document.querySelector('[data-color-original]')?.focus(),0);}
  if(name==='sort-colors'){syncDraft();modal={type:'sort-colors',order:[...state.colors],selected:null};render();}
  if(name==='close-modal'){if(modal?.type==='photo-crop'&&modal.sourceUrl)URL.revokeObjectURL(modal.sourceUrl);revokeGalleryUrls();modal=null;render();}
  if(name==='save-color'){const c=document.querySelector('#newColor').value.trim();if(!c)return toast('请输入颜色');if(!state.colors.includes(c))state.colors.push(c);if(!draft.colors.includes(c))draft.colors.push(c);colorCategory=isNumericColor(c)?'number':'text';save();modal=null;render();toast('颜色已增加');}
  if(name==='quick-add-color'){syncDraft();const input=document.querySelector('#quickColor'),c=input?.value.trim();if(!c)return toast('请输入颜色');if(state.colors.includes(c))return toast('这个颜色已经存在');state.colors.push(c);draft.colors=[...new Set([...draft.colors,c])];colorCategory=isNumericColor(c)?'number':'text';save();render();toast(`已增加并选中 ${c}`);}
  if(name==='finish-color-manage'){syncDraft();colorManageMode=false;render();toast('颜色顺序已保存');}
  if(name==='save-colors-edit'){const inputs=[...document.querySelectorAll('[data-color-original]')],nextColors=inputs.map(input=>input.value.trim());if(inputs.length!==state.colors.length)return toast('颜色数据未加载完整，请重新打开');if(nextColors.some(c=>!c))return toast('颜色名称不能为空');if(new Set(nextColors).size!==nextColors.length)return toast('颜色名称不能重复');const changes=new Map(inputs.map(input=>[input.dataset.colorOriginal,input.value.trim()]));state.colors=nextColors;draft.colors=draft.colors.map(c=>changes.get(c)??c);state.batches.forEach(batch=>batch.lines.forEach(line=>{if(changes.has(line.color))line.color=changes.get(line.color);}));save();for(const batch of state.batches)for(const model of new Set(batch.lines.map(line=>line.model)))await V3Photos.markDirty(batch.id,model);modal=null;render();toast('全部颜色名称已保存');}
  if(name==='save-color-order'){if(!modal?.order?.length)return toast('没有可保存的颜色');state.colors=[...modal.order];save();modal=null;render();toast('颜色顺序已保存');}
  if(name==='toggle-stores'){syncDraft();const visibleSelected=draft.stores.filter(n=>STORES.includes(n));draft.stores=visibleSelected.length===STORES.length?draft.stores.filter(n=>!STORES.includes(n)):[...new Set([...draft.stores,...STORES])];render();}
  if(name==='allocate'){
    const err=validDraft();if(err)return toast(err);
    draft.sale=normalizeSale(draft.sale);
    const quantity=parseQuantity(draft.qty,draft.unit);
    if(draft.unit==='pack'&&quantity===.5)draft.qty='半';
    const b=getBatch(),editing=draft.editIds.length>0,editContext=draft.editContext,colors=draft.colors.length?draft.colors:[''],oldModel=draft.originalModel,photoBlob=draft.photoBlob,model=draft.model;
    b.lines.forEach(line=>{if(line.model===model)line.note=draft.note;});
    if(editing){const ids=new Set(draft.editIds);b.lines=b.lines.filter(v=>!ids.has(v.id));}
    for(const color of colors)for(const store of draft.stores)b.lines.push({id:uid(),model,cost:draft.cost===''?null:Number(draft.cost),sale:draft.sale===''?null:Number(draft.sale),unit:draft.unit,packSize:draft.unit==='pack'?Number(draft.packSize):1,qty:quantity,color,store,note:draft.note,createdAt:Date.now()});
    save();
    const count=colors.length*draft.stores.length;
    const photoUpdate=editing?saveAndRenderModelPhoto(b,model,photoBlob,oldModel):null;
    draft.editIds=[];draft.editContext='';draft.originalModel=model;draft.stores=[];
    screen=editing&&editContext==='model'?'details':'entry';
    render();
    toast(editing?(editContext==='preview'?'已保存该门店修改':'已保存型号修改'):`已增加 ${count} 条分配，颜色和数量已保留`);
    if(photoUpdate){
      try{await photoUpdate;toast(editContext==='preview'?'该门店与商品图片已更新':'型号资料与商品图片已更新');}
      catch(error){await V3Photos.markDirty(b.id,model);toast('资料已保存，商品图片将在下次打开时更新');}
    }
  }
  if(name==='clear-search'){detailSearchTerm='';render();setTimeout(()=>document.querySelector('#detailSearch')?.focus(),0);}
  if(name==='cancel-edit'){const returnToDetails=draft.editContext==='model';releaseDraftPhoto();draft=freshDraft();screen=returnToDetails?'details':'entry';render();}
  if(name==='finish-model'){const modelLines=persistDraftNote();if(!draft.model)return toast('当前还没有输入型号');if(!modelLines.length)return toast('请先分配当前型号');const existing=await V3Photos.get(getBatch().id,draft.model);if(!draft.rawPhotoFile&&!draft.photoBlob&&!existing?.sourceBlob)return toast('请先拍摄商品照片');if(modelLines.some(l=>pricePending(l.cost)||pricePending(l.sale))&&!confirm('进价或卖价尚未填写，图片和明细中会显示“待定”。是否确定提交并输入下一个款式？'))return;if(draft.rawPhotoFile){openPhotoCrop(draft.rawPhotoFile,true);return;}await completeCurrentModel();}
  if(name==='photos'){await loadPhotoGallery();}
  if(name==='select-all-photos'){const ready=modal.items.filter(item=>item.record?.renderedBlob).map(item=>item.model);modal.selected=modal.selected.size===ready.length?new Set():new Set(ready);render();}
  if(name==='refresh-photos'){revokeGalleryUrls();await loadPhotoGallery(true);toast('商品图片已重新生成');}
  if(name==='share-photos')await shareSelectedPhotos();
  if(name==='save-photos')saveSelectedPhotos();
  if(name==='summary'){modal={type:'summary',sortKey:'store',sortDir:'asc'};render();}
  if(name==='excel')exportExcel(getBatch());
  if(name==='pdf'){const output=buildPdf(getBatch());if(output){modal={type:'pdf-preview',output};render();}}
  if(name==='export-pdf-file'){const output=modal?.output;modal=null;render();if(output)deliverPdf(output);}
}

function exportRows(b){return [...b.lines].sort((a,z)=>a.model.localeCompare(z.model,undefined,{numeric:true})||a.color.localeCompare(z.color)||a.store-z.store);}
function safeName(s){return s.replace(/[\\/:*?"<>|]/g,'_');}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);}
function photoNamePart(value){return String(value??'').trim().replace(/[\\/:*?"<>|]/g,'-')||'未命名';}
function photoPrice(value){return pricePending(value)?'待定':Number(value).toFixed(2);}
function photoFilename(model,cost,sale){return `${photoNamePart(model)};${photoPrice(cost)};${photoPrice(sale)}.jpg`;}
function shareUnit(line){if(line.unit==='pack')return Number(line.qty)===.5?'半包':`${compactNumber(line.qty)}包`;return `${compactNumber(line.qty)}件`;}
function imageAllocationRows(lines){
  const colorGroups=new Map();
  for(const line of lines){
    const groupKey=[line.color||'',line.unit,line.qty,line.packSize].join('\u001f');
    if(!colorGroups.has(groupKey))colorGroups.set(groupKey,{color:line.color||'',unit:line.unit,qty:line.qty,packSize:line.packSize,quantity:shareUnit(line),stores:[]});
    colorGroups.get(groupKey).stores.push(line.store);
  }
  const merged=new Map();
  for(const group of colorGroups.values()){
    const stores=[...new Set(group.stores)].sort((a,b)=>a-b);
    const mergeKey=[group.color?'color':'no-color',group.unit,group.qty,group.packSize,stores.join(',')].join('\u001f');
    if(!merged.has(mergeKey))merged.set(mergeKey,{colors:[],quantity:group.quantity,stores});
    if(group.color)merged.get(mergeKey).colors.push(group.color);
  }
  return [...merged.values()].map(group=>({...group,color:group.colors.join('  ')}));
}
function canvasBlob(canvas,type='image/jpeg',quality=.92){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片生成失败')),type,quality));}
function fitCanvasText(context,text,maxWidth,startSize,minSize=24,weight='600'){
  let size=startSize;
  while(size>minSize){context.font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;if(context.measureText(text).width<=maxWidth)break;size-=2;}
  return size;
}
function wrapCanvasText(context,text,maxWidth){
  const output=[];let current='';
  for(const char of Array.from(String(text||''))){
    const next=current+char;
    if(!current||context.measureText(next).width<=maxWidth)current=next;
    else{output.push(current);current=char;}
  }
  if(current)output.push(current);
  return output.length?output:[''];
}
function wrapStoreTokens(context,stores,maxWidth){
  const output=[];let current='';
  stores.map(String).forEach((store,index)=>{
    const token=index<stores.length-1?`${store},`:store;
    const next=current?`${current}${token}`:token;
    if(!current||context.measureText(next).width<=maxWidth)current=next;
    else{output.push(current);current=token;}
  });
  if(current)output.push(current);
  return output.length?output:[''];
}
async function createProductImage(batch,model,sourceBlob){
  const lines=batch.lines.filter(line=>line.model===model);
  if(!lines.length)throw new Error('找不到型号采购数据');
  const first=lines[0],allocations=imageAllocationRows(lines),photo=await V3Photos.loadImage(sourceBlob);
  const W=1080,photoH=1440,headerH=112,rowPad=18,lineH=52;
  const measureCanvas=document.createElement('canvas'),measure=measureCanvas.getContext('2d');
  measure.font='40px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  const prepared=allocations.map(group=>{
    const storeLines=wrapStoreTokens(measure,group.stores,650);
    return {...group,storeLines,height:rowPad*2+storeLines.length*lineH};
  });
  measure.font='38px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  const noteLines=first.note?wrapCanvasText(measure,`备注：${first.note}`,W-64):[];
  const noteH=noteLines.length?32+noteLines.length*50:0;
  const H=photoH+headerH+prepared.reduce((sum,row)=>sum+row.height,0)+noteH;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,W,H);
  const sourceW=photo.naturalWidth||photo.width,sourceH=photo.naturalHeight||photo.height,coverScale=Math.max(W/sourceW,photoH/sourceH);
  const cropW=W/coverScale,cropH=photoH/coverScale,cropX=(sourceW-cropW)/2,cropY=(sourceH-cropH)/2;
  c.drawImage(photo,cropX,cropY,cropW,cropH,0,0,W,photoH);
  const border='#e4e4e4';c.strokeStyle=border;c.lineWidth=2;
  const separator=y=>{c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke();};
  separator(photoH);
  const headerY=photoH,costSale=`${pricePending(first.cost)?'待定':`€${photoPrice(first.cost)}`}/${pricePending(first.sale)?'待定':`€${photoPrice(first.sale)}`}`;
  c.textBaseline='middle';c.fillStyle='#171717';
  const modelSize=fitCanvasText(c,model,300,50,30,'700');c.font=`700 ${modelSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.textAlign='left';c.fillText(model,28,headerY+headerH/2);
  const priceSize=fitCanvasText(c,costSale,380,48,28,'700');c.font=`700 ${priceSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.textAlign='center';c.fillText(costSale,560,headerY+headerH/2);
  c.fillStyle='#aaa';
  const supplierSize=fitCanvasText(c,batch.supplier,240,30,20,'500');c.font=`500 ${supplierSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.textAlign='right';c.fillText(batch.supplier,W-28,headerY+headerH/2);
  let y=photoH+headerH;separator(y);
  c.font='40px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  for(const row of prepared){
    const top=y;c.fillStyle='#222';c.textBaseline='middle';
    row.storeLines.forEach((storeLine,index)=>{
      const lineY=top+rowPad+lineH/2+index*lineH;
      c.textAlign='left';
      const colorSize=fitCanvasText(c,row.color,125,40,22,'600');
      c.font=`600 ${colorSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.fillText(index===0?row.color:'',28,lineY);
      c.font='40px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';c.fillText(storeLine,170,lineY);
      if(index===0){c.textAlign='right';c.font='700 42px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';c.fillText(`× ${row.quantity}`,W-28,lineY);}
    });
    y+=row.height;separator(y);
  }
  if(noteLines.length){
    c.fillStyle='#222';c.font='38px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';c.textAlign='left';c.textBaseline='middle';
    noteLines.forEach((line,index)=>c.fillText(line,28,y+18+25+index*50));
  }
  return {blob:await canvasBlob(canvas),filename:photoFilename(model,first.cost,first.sale)};
}
async function saveAndRenderModelPhoto(batch,model,sourceBlob,oldModel=''){
  if(oldModel&&oldModel!==model)await V3Photos.move(batch.id,oldModel,model);
  if(sourceBlob)await V3Photos.saveSource(batch.id,model,sourceBlob);
  const record=await V3Photos.get(batch.id,model);
  if(!record?.sourceBlob)throw new Error('请先拍摄商品照片');
  const output=await createProductImage(batch,model,record.sourceBlob);
  await V3Photos.saveRendered(batch.id,model,output.blob,output.filename,PHOTO_RENDER_VERSION);
  return output;
}
async function regenerateModelPhoto(batch,model){
  const record=await V3Photos.get(batch.id,model);
  if(!record?.sourceBlob)return null;
  return saveAndRenderModelPhoto(batch,model,null);
}
function revokeGalleryUrls(){
  if(modal?.type==='photo-gallery')modal.items?.forEach(item=>{if(item.url)URL.revokeObjectURL(item.url);});
}
async function loadPhotoGallery(force=false){
  const batch=getBatch(),models=modelDetailGroups(batch,'input').map(item=>item.model),items=[];
  for(const model of models){
    let record=await V3Photos.get(batch.id,model);
    if(record?.sourceBlob&&(force||record.dirty||!record.renderedBlob||record.renderVersion!==PHOTO_RENDER_VERSION)){try{await regenerateModelPhoto(batch,model);record=await V3Photos.get(batch.id,model);}catch(error){}}
    items.push({model,record,url:record?.renderedBlob?URL.createObjectURL(record.renderedBlob):''});
  }
  modal={type:'photo-gallery',items,selected:new Set()};
  render();
}
async function shareSelectedPhotos(){
  const selected=modal.items.filter(item=>modal.selected.has(item.model)&&item.record?.renderedBlob);
  if(!selected.length)return toast('请先选择要分享的图片');
  const files=selected.map(item=>new File([item.record.renderedBlob],item.record.filename,{type:'image/jpeg'}));
  try{
    if(navigator.share&&navigator.canShare?.({files})){await navigator.share({files,title:`${getBatch().supplier} 采购图片`});toast('已打开系统分享面板');return;}
  }catch(error){if(error?.name==='AbortError')return;}
  files.forEach((file,index)=>setTimeout(()=>download(file,file.name),index*250));
  toast('当前设备不支持多图分享，已改为保存图片');
}
function saveSelectedPhotos(){
  const selected=modal.items.filter(item=>modal.selected.has(item.model)&&item.record?.renderedBlob);
  if(!selected.length)return toast('请先选择要保存的图片');
  selected.forEach((item,index)=>setTimeout(()=>download(item.record.renderedBlob,item.record.filename),index*250));
  toast(`正在保存 ${selected.length} 张图片`);
}
function exportExcel(b){
  const rows=exportRows(b),stats=batchStats(b);const trs=rows.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(b.supplier)}</td><td>${b.date}</td><td>${esc(l.model)}</td><td>${money(l.cost)}</td><td>${money(l.sale)}</td><td>${esc(l.color)}</td><td>${l.unit==='pack'?'包':'件'}</td><td>${exportQuantity(l)}</td><td>${l.packSize}</td><td>${compactNumber(totalPieces(l))}</td><td>${l.store}</td><td>${pricePending(l.cost)?'待定':money(l.cost*totalPieces(l))}</td></tr>`).join('');
  const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px}th{background:#dfeee8}</style></head><body><table><tr><th colspan="13">采购单 - ${esc(b.supplier)} - ${b.date}</th></tr><tr><th>序号</th><th>供应商</th><th>日期</th><th>型号</th><th>进价</th><th>卖价</th><th>颜色</th><th>单位</th><th>数量</th><th>每包件数</th><th>总件数</th><th>门店</th><th>采购小计</th></tr>${trs}<tr><th colspan="10">合计</th><th>${stats.pieces}</th><th></th><th>${stats.hasPendingCost?'待定':money(stats.amount)}</th></tr></table></body></html>`;
  download(new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'}),safeName(`采购单_${b.supplier}_${b.date}.xls`));toast('Excel 已导出');
}

function buildPdf(b){
  if(!b.lines.length)return toast('没有可导出的明细');
  const W=1240,H=1754,margin=24,tableW=W-margin*2,headerH=43,pageBottom=H-48;
  const widths=[220,150,380,125,120,tableW-995],heads=['商品型号','颜色','门店','数量','进价','备注'];
  const models=modelDetailGroups(b,'input').map(m=>({...m,items:m.items.map(g=>({...g,displayColors:g.colors.filter(Boolean)}))}));
  const pages=[];let canvas,c,y;
  const fontFamily='Songti SC, STSong, SimSun, PingFang SC, serif';
  const line=(x1,y1,x2,y2,dashed=false)=>{c.save();c.strokeStyle='#111';c.lineWidth=2;c.setLineDash(dashed?[6,5]:[]);c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();c.restore();};
  const centered=(text,x,w,top,height,font='30px',color='#111')=>{c.save();c.fillStyle=color;c.font=`${font} ${fontFamily}`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(text),x+w/2,top+height/2);c.restore();};
  const wrap=(text,maxWidth,font='29px')=>{c.save();c.font=`${font} ${fontFamily}`;const lines=[];let current='';for(const ch of Array.from(String(text??''))){if(ch==='\n'){lines.push(current);current='';continue;}const next=current+ch;if(!current||c.measureText(next).width<=maxWidth)current=next;else{lines.push(current.trimEnd());current=ch.trimStart();}}if(current||!lines.length)lines.push(current);c.restore();return lines;};
  const wrapStores=(stores,maxWidth,font='29px')=>{c.save();c.font=`${font} ${fontFamily}`;const values=stores.map(String),lines=[];let current='';values.forEach((store,i)=>{const next=current?`${current}, ${store}`:store;const reserve=i<values.length-1?',':'';if(!current||c.measureText(next+reserve).width<=maxWidth)current=next;else{lines.push(`${current},`);current=store;}});if(current||!lines.length)lines.push(current);c.restore();return lines;};
  const multiline=(lines,x,w,top,height,font='29px')=>{const lh=37,total=(lines.length-1)*lh;c.save();c.fillStyle='#111';c.font=`${font} ${fontFamily}`;c.textAlign='center';c.textBaseline='middle';lines.forEach((v,i)=>c.fillText(v,x+w/2,top+height/2-total/2+i*lh));c.restore();};
  const itemHeight=item=>Math.max(63,24+Math.max(1,item.displayColors.length,wrapStores(item.stores,widths[2]-28).length)*37);
  const newPage=()=>{if(canvas)pages.push(canvas.toDataURL('image/jpeg',.94));canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,W,H);c.fillStyle='#111';c.textAlign='center';c.textBaseline='alphabetic';c.font=`bold 38px ${fontFamily}`;c.fillText('小潘家采购分货单',W/2,58);c.textAlign='left';c.font=`29px ${fontFamily}`;c.fillText(`供应商名称：${b.supplier}`,margin+7,101);const [year,month,day]=String(b.date||'').split('-').map(Number);c.textAlign='right';c.fillText(`${year||''}年　${month||''}　月　${day||''}　日`,W-margin-7,101);y=112;c.fillStyle='#c7c7c7';c.fillRect(margin,y,tableW,headerH);let x=margin;heads.forEach((h,i)=>{centered(h,x,widths[i],y,headerH,'bold 25px');x+=widths[i];});line(margin,y,W-margin,y);line(margin,y+headerH,W-margin,y+headerH);x=margin;for(const w of widths){line(x,y,x,y+headerH);x+=w;}line(W-margin,y,W-margin,y+headerH);y+=headerH;};
  newPage();
  for(const model of models){const heights=model.items.map(itemHeight),modelLines=wrap(model.model,widths[0]-16,'30px'),modelH=24+modelLines.length*37,noteLines=wrap(model.note||'',widths[5]-24,'24px'),noteH=model.note?24+noteLines.length*31:63;let groupH=heights.reduce((s,n)=>s+n,0),requiredH=Math.max(modelH,noteH);if(requiredH>groupH){heights[heights.length-1]+=requiredH-groupH;groupH=requiredH;}const pageCapacity=pageBottom-(112+headerH);if(groupH<=pageCapacity&&y+groupH>pageBottom)newPage();let i=0;while(i<model.items.length){if(y+heights[i]>pageBottom)newPage();const startY=y,startIndex=i,xModel=margin,xColor=xModel+widths[0],xStores=xColor+widths[1],xQty=xStores+widths[2],xCost=xQty+widths[3],xNote=xCost+widths[4];while(i<model.items.length&&y+heights[i]<=pageBottom){const item=model.items[i],h=heights[i],colors=item.displayColors.length?item.displayColors:[''];multiline(colors,xColor,widths[1],y,h);multiline(wrapStores(item.stores,widths[2]-28),xStores,widths[2],y,h);centered(pdfQuantity(item),xQty,widths[3],y,h,'27px');y+=h;i++;if(i<model.items.length&&y+heights[i]<=pageBottom)line(xColor,y,xCost,y,true);}const endY=y;multiline(modelLines,xModel,widths[0],startY,endY-startY,'30px');centered(euro(model.cost),xCost,widths[4],startY,endY-startY,'27px');if(model.note)multiline(noteLines,xNote,widths[5],startY,endY-startY,'24px');line(margin,startY,W-margin,startY);line(margin,endY,W-margin,endY);for(const x of [xModel,xColor,xStores,xQty,xCost,xNote,W-margin])line(x,startY,x,endY);if(i===startIndex)break;if(i<model.items.length)newPage();}}
  pages.push(canvas.toDataURL('image/jpeg',.94));
  const pdf=jpegPagesToPdf(pages,W,H),name=safeName(`采购单_${b.supplier}_${b.date}.pdf`),file=new File([pdf],name,{type:'application/pdf'});
  return {pdf,name,file,pages,supplier:b.supplier};
}
async function deliverPdf(output){
  try{if(navigator.share&&navigator.canShare?.({files:[output.file]})){await navigator.share({files:[output.file],title:`采购分货单 - ${output.supplier}`});toast('PDF 文件已打开分享');return;}}catch(error){if(error?.name==='AbortError')return;}
  download(output.pdf,output.name);toast('PDF 已导出');
}
function jpegPagesToPdf(dataUrls,w,h){
  const enc=new TextEncoder();const objects=[];const add=s=>(objects.push(s),objects.length);const pageIds=[],imageIds=[];const catalog=add(''),pagesId=add('');
  for(const url of dataUrls){const bin=atob(url.split(',')[1]);const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));const imgId=add({head:`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,bytes,tail:'\nendstream'});imageIds.push(imgId);const content=`q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ`;const contentId=add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);const pageId=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);pageIds.push(pageId);}
  objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`;objects[pagesId-1]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const chunks=[enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')],offsets=[0];let pos=chunks[0].length;objects.forEach((o,i)=>{offsets.push(pos);const pre=enc.encode(`${i+1} 0 obj\n`),post=enc.encode('\nendobj\n');chunks.push(pre);pos+=pre.length;if(typeof o==='string'){const z=enc.encode(o);chunks.push(z);pos+=z.length;}else{const a=enc.encode(o.head),z=enc.encode(o.tail);chunks.push(a,o.bytes,z);pos+=a.length+o.bytes.length+z.length;}chunks.push(post);pos+=post.length;});const xref=pos;let table=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offsets.length;i++)table+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';table+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;chunks.push(enc.encode(table));return new Blob(chunks,{type:'application/pdf'});
}

if('serviceWorker' in navigator){
  let refreshing=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(refreshing)return;
    refreshing=true;
    location.reload();
  });
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=8',{updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{}));
}
render();
