const STORE_KEY = 'procure-easy-data-v3';
const PHOTO_RENDER_VERSION = 4;
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
let suppressBatchOpenUntil = 0;
let lastPackageTap = 0;
let transferPreviewCache = null;
let transferPackageCache = null;

function today(){ const d=new Date(); const local=new Date(d.getTime()-d.getTimezoneOffset()*60000); return local.toISOString().slice(0,10); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function freshDraft(){ return {model:'',originalModel:'',cost:'',sale:'',unit:'piece',packSize:'',qty:'1',note:'',colors:[],stores:[],editIds:[],editContext:'',photoBlob:null,photoUrl:''}; }
function isPackageUnit(unit){ return unit==='pack'||unit==='hand'; }
function packageUnitLabel(unit){ return unit==='hand'?'手':'包'; }
function loadState(){ try{ const x=JSON.parse(localStorage.getItem(STORE_KEY)); if(x&&Array.isArray(x.batches)) return {...x,colors:Array.isArray(x.colors)?x.colors:DEFAULT_COLORS}; }catch(e){} return {batches:[],colors:[...DEFAULT_COLORS]}; }
function save(){ localStorage.setItem(STORE_KEY,JSON.stringify(state)); }
function esc(v){ return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function pricePending(v){ return v===null||v===''||typeof v==='undefined'; }
function money(v){ return pricePending(v)?'待定':Number(v).toFixed(2); }
function euro(v){ return pricePending(v)?'待定':Number(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function priceDisplay(v){ return pricePending(v)?'待定':`€${money(v)}`; }
function draftPrice(v){ return pricePending(v)?'':String(v); }
function sentTime(v){ if(!v)return ''; return new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
function transferStatus(batch){
  const transfer=batch?.transfer;
  if(!transfer)return {key:'idle',label:'未发送到电脑'};
  if(transfer.status==='sent')return {key:'sent',label:`已发送 · ${sentTime(transfer.sentAt)}`};
  if(transfer.status==='dirty')return {key:'dirty',label:'采购已修改，需重新发送'};
  if(transfer.status==='failed')return {key:'failed',label:'发送失败，可重试'};
  return {key:'idle',label:'未发送到电脑'};
}
function markTransferDirty(batch){
  if(batch?.transfer?.fileId)batch.transfer={...batch.transfer,status:'dirty',dirtyAt:Date.now()};
}
function grossMarginDisplay(cost,sale){
  if(String(cost??'').trim()===''||String(sale??'').trim()==='')return '待计算';
  const costValue=Number(cost),saleValue=Number(sale);
  if(!Number.isFinite(costValue)||!Number.isFinite(saleValue)||saleValue<=0)return '待计算';
  return `${((saleValue-costValue)/saleValue*100).toFixed(2)}%`;
}
function getBatch(){ return state.batches.find(b=>b.id===activeBatchId); }
function toast(msg){ const el=document.querySelector('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),1800); }
function parseQuantity(value,unit){ const s=String(value??'').trim(); if(isPackageUnit(unit)&&s==='半')return .5; return Number(s.replace(',','.')); }
function compactNumber(value){ const n=Number(value); return Number.isInteger(n)?String(n):String(Number(n.toFixed(2))); }
function totalPieces(line){ return isPackageUnit(line.unit)?Number(line.qty)*Number(line.packSize):Number(line.qty); }
function draftQuantity(line){ return isPackageUnit(line.unit)&&Number(line.qty)===.5?'半':String(line.qty); }
function quantityDisplay(line){ const pieces=compactNumber(totalPieces(line)); return isPackageUnit(line.unit)&&Number(line.qty)===.5?`半${packageUnitLabel(line.unit)}（${pieces}件）`:`${pieces}件`; }
function exportQuantity(line){ return isPackageUnit(line.unit)?(Number(line.qty)===.5?`半${packageUnitLabel(line.unit)}`:`${compactNumber(line.qty)}${packageUnitLabel(line.unit)}`):compactNumber(line.qty); }
function pdfQuantity(line){ return isPackageUnit(line.unit)?exportQuantity(line):`${compactNumber(line.qty)}件`; }
function isNumericColor(color){ return /^-?\d+(?:[.,]\d+)?$/.test(String(color||'').trim()); }
function batchStats(b){ const pieces=b.lines.reduce((s,l)=>s+totalPieces(l),0); const models=new Set(b.lines.map(l=>l.model)).size; const amount=b.lines.reduce((s,l)=>s+(pricePending(l.cost)?0:Number(l.cost)*totalPieces(l)),0); const hasPendingCost=b.lines.some(l=>pricePending(l.cost)); return {pieces,models,amount,hasPendingCost}; }
function storeSummary(b){
  const stores=new Map();
  for(const line of b.lines){
    if(!stores.has(line.store))stores.set(line.store,{store:line.store,models:new Set(),pieces:0,amount:0,hasPendingCost:false,marginCost:0,marginSales:0});
    const row=stores.get(line.store);row.models.add(line.model);row.pieces+=totalPieces(line);
    if(pricePending(line.cost))row.hasPendingCost=true;else row.amount+=Number(line.cost)*totalPieces(line);
    const cost=Number(line.cost),sale=Number(line.sale),pieces=totalPieces(line);
    if(!pricePending(line.cost)&&!pricePending(line.sale)&&Number.isFinite(cost)&&Number.isFinite(sale)&&sale>0){
      row.marginCost+=cost*pieces;row.marginSales+=sale*pieces;
    }
  }
  return [...stores.values()].sort((a,z)=>a.store-z.store).map(row=>({...row,models:row.models.size,hasMargin:row.marginSales>0,margin:row.marginSales>0?(row.marginSales-row.marginCost)/row.marginSales*100:null}));
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
function releaseDraftPhoto(){if(draft.photoUrl)URL.revokeObjectURL(draft.photoUrl);draft.photoUrl='';draft.photoBlob=null;}
function setDraftPhoto(blob){if(draft.photoUrl)URL.revokeObjectURL(draft.photoUrl);draft.photoBlob=blob;draft.photoUrl=blob?URL.createObjectURL(blob):'';}
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
      <div class="supplier-fields"><div><label class="label">供应商名称</label><input id="supplier" class="field" placeholder="例如：Milano Trading" autocomplete="off"></div>
      <div><label class="label">供应商缩写 <small class="optional">选填</small></label><input id="supplierAbbr" class="field" placeholder="例如：XY" autocomplete="off"></div></div>
      <div><label class="label">采购日期</label><input id="date" class="field" type="date" value="${today()}"></div>
      <button class="btn btn-primary btn-wide" data-action="start">开始录入采购</button>
    </div></section>
    <div class="section-head"><h2>历史采购</h2><span class="muted">${batches.length} 批</span></div>
    ${batches.length?batches.map(b=>{const s=batchStats(b),t=transferStatus(b);return `<div class="batch-swipe-wrap"><div class="batch-swipe-actions"><button type="button" data-delete-batch="${b.id}" aria-label="删除 ${esc(b.supplier)} ${esc(b.date)}">删除</button></div><button class="card batch btn-wide batch-swipe-content" data-open="${b.id}" style="text-align:left"><div class="batch-main"><b>${esc(b.supplier)} <em>${esc(b.date)}</em></b><span>总金额：${s.hasPendingCost?'待定':`€${euro(s.amount)}`}　款式：${s.models}　总件数：${s.pieces}</span><small class="batch-transfer-state ${t.key}">${esc(t.label)}</small></div><span class="arrow">›</span></button></div>`}).join(''):`<div class="card empty"><div class="empty-icon">🧾</div>还没有采购记录<br><small>新建后，数据会自动保存在本机</small></div>`}
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
      <div class="photo-capture-column"><button type="button" class="photo-capture-preview" data-action="take-photo" aria-label="${draft.photoUrl?'重新拍摄商品照片':'拍摄商品照片'}">${draft.photoUrl?`<img src="${draft.photoUrl}" alt="当前型号商品照片">`:cameraIcon()}</button><div class="gross-margin"><strong id="grossMargin">${grossMarginDisplay(draft.cost,draft.sale)}</strong></div></div>
      <div class="photo-entry-panel"><div class="photo-entry-heading"><h2>商品照片 *</h2><p>${draft.photoUrl?'照片已使用；点击可重拍。':'点击照片直接拍摄。'}</p></div><input id="photoInput" type="file" accept="image/*" capture="environment" hidden>
        <div class="inside-field"><span>型号 *</span><input id="model" value="${esc(draft.model)}" placeholder="例如：001" autocomplete="off"></div>
        <div class="grid2"><div class="inside-field cost-price-field"><span>进价</span><input id="cost" type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="next" value="${esc(draft.cost)}" placeholder="0.00"></div>
        <div class="inside-field sale-price-field"><span>卖价</span><button type="button" class="sale-price-step" data-sale-step="-1" aria-label="卖价减 1">−</button><input id="sale" type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="done" value="${esc(draft.sale)}" placeholder="0.00"><button type="button" class="sale-price-step" data-sale-step="1" aria-label="卖价加 1">＋</button></div></div>
        <div class="unit-switch"><button class="choice ${draft.unit==='piece'?'active':''}" data-unit="piece">件</button><button class="choice ${isPackageUnit(draft.unit)?'active':''}" data-unit="pack" title="选中后双击可切换包/手">${packageUnitLabel(draft.unit)}</button></div>
        ${isPackageUnit(draft.unit)?`<div class="inside-field pack-size-field"><span>每${packageUnitLabel(draft.unit)}件数 *</span><input id="packSize" type="number" min="1" step="1" inputmode="numeric" value="${esc(draft.packSize)}" placeholder="例如：12"></div>`:''}
      </div>
    </section>
    <section class="card color-card ${colorManageMode?'color-managing':''}"><div class="section-head color-section-head"><div class="color-category-switch"><button class="${colorCategory==='number'?'active':''}" data-color-category="number">数字</button><button class="${colorCategory==='text'?'active':''}" data-color-category="text">文字</button></div><div class="color-head-actions"><button class="color-manage-btn" data-action="edit-colors" aria-label="修改全部颜色" title="修改全部颜色">${icon('edit')}</button><div class="color-quick-add"><input id="quickColor" placeholder="新增颜色" autocomplete="off"><button type="button" data-action="quick-add-color" aria-label="添加颜色">＋</button></div><button class="color-done-btn" data-action="finish-color-manage">完成整理</button><button class="color-clear-btn" data-action="clear-colors" ${draft.colors.length?'':'disabled'}>取消选择</button></div></div><div class="chips color-sortable">${visibleColors.map(c=>`<div class="color-chip-shell" data-drag-color="${esc(c)}"><button type="button" class="chip ${draft.colors.includes(c)?'active':''}" data-color="${esc(c)}">${esc(c)}</button><button type="button" class="color-delete-btn" data-delete-color="${esc(c)}" aria-label="删除颜色 ${esc(c)}">×</button></div>`).join('')}</div><p class="color-longpress-hint">长按颜色可整理顺序或删除。</p><p class="color-manage-hint">拖动颜色可上下、左右排序；点击 × 删除预设颜色。</p></section>
    <section class="card"><div class="section-head"><h2>数量与门店</h2><button class="link-btn" data-action="toggle-stores">${draft.stores.filter(n=>STORES.includes(n)).length===STORES.length?'取消全选':'全选'}</button></div>
      <div class="qty-allocate-row"><div class="qty-input-wrap"><button type="button" class="qty-step" data-qty-step="-1" aria-label="减少数量">−</button><input id="qty" type="${isPackageUnit(draft.unit)?'text':'number'}" ${isPackageUnit(draft.unit)?'inputmode="decimal"':'min="1" step="1" inputmode="numeric"'} value="${esc(draft.qty)}" aria-label="数量"><span>${draft.unit==='piece'?'件':packageUnitLabel(draft.unit)}</span><button type="button" class="qty-step" data-qty-step="1" aria-label="增加数量">＋</button></div><button class="btn btn-primary" data-action="allocate">${draft.editIds.length?'保存修改':'分配到所选门店'}</button></div>
      <div class="store-grid">${STORES.map(n=>`<button class="store ${draft.stores.includes(n)?'active':''} ${allocatedStores.has(n)?'allocated':''}" data-store="${n}">${allocatedStores.has(n)?'<span class="allocated-mark">✓</span>':''}${n}</button>`).join('')}</div><p class="hint">已选 ${draft.stores.filter(n=>STORES.includes(n)).length} 家门店 · <span class="allocated-legend">✓ 已分配过</span></p>
    </section>
    <div class="note-submit-row"><section class="card model-note-card"><div class="section-head"><h2>型号备注 <small class="optional">选填</small></h2></div><textarea id="note" class="model-note-input" rows="2" placeholder="例如：包装要求、尺码或其他说明">${esc(draft.note)}</textarea></section>
    <section class="card compact-action-card">${draft.editIds.length?`<button class="btn btn-light btn-wide" data-action="cancel-edit">取消修改</button>`:`<button class="btn btn-secondary btn-wide" data-action="finish-model">确认提交</button>`}</section></div>
    ${previewStores.length?`<section class="allocation-preview"><div class="preview-head"><div><h2>已分配预览</h2><div class="preview-model"><b>${esc(draft.model)}</b><span>${priceDisplay(previewLines[0]?.cost)} <em>/</em> ${priceDisplay(previewLines[0]?.sale)}</span></div></div><strong>共 ${compactNumber(previewTotal)} 件</strong></div><div class="preview-list">${previewStores.map(g=>`<div class="preview-row ${draft.editContext==='preview'&&g.ids.some(id=>draft.editIds.includes(id))?'editing':''}"><span class="preview-store">${g.store}店</span><div class="preview-items">${g.lines.map(l=>`<div>${l.color?`<small>${esc(l.color)}</small>`:'<small>无颜色</small>'}<b>× ${quantityDisplay(l)}</b></div>`).join('')}</div><div class="preview-actions"><button data-edit-preview-store="${g.store}" aria-label="修改 ${g.store} 店分配" title="修改">${icon('edit')}</button><button class="delete" data-delete-preview-store="${g.store}" aria-label="删除 ${g.store} 店分配" title="删除">${icon('delete')}</button></div></div>`).join('')}</div></section>`:''}
  </div><nav class="bottom"><div class="bottom-inner"><button class="btn btn-light" data-action="back-home">采购列表</button><button class="btn btn-primary" data-action="details">查看明细（${b.lines.length}）</button></div></nav>`;
}

function detailsView(){
  const b=getBatch(); if(!b){screen='home';return homeView();}
  const modelGroups=modelDetailGroups(b,'input').reverse(),transfer=transferStatus(b);
  return `${header('采购明细',`${b.supplier} · ${b.date}`)}<div class="wrap">
    <section class="detail-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><input id="detailSearch" value="${esc(detailSearchTerm)}" placeholder="模糊搜索当前采购型号" autocomplete="off"><button data-action="clear-search" aria-label="清除搜索">×</button></section>
    <section class="card no-print transfer-launch-card"><button class="windows-transfer-button" data-action="windows"><span class="windows-transfer-icon">W</span><span><b>发送到 Windows</b></span><i>›</i></button><div class="windows-transfer-state ${transfer.key}"><span></span>${esc(transfer.label)}</div></section>
    <section class="card no-print"><div class="toolbar detail-toolbar"><button class="btn btn-secondary" data-action="photos">图片分享</button><button class="btn btn-secondary" data-action="summary">查看汇总</button><button class="btn btn-secondary" data-action="excel">导出 Excel</button><button class="btn btn-secondary" data-action="pdf">导出 PDF</button></div></section>
    <div id="modelList">${modelGroups.length?modelGroups.map(m=>`<div class="swipe-wrap" data-search-model="${esc(m.model.toLowerCase())}"><div class="swipe-actions no-print"><button data-edit-model="${esc(m.model)}">修改</button><button class="delete" data-delete-model="${esc(m.model)}">删除</button></div><section class="card purchase-model swipe-content"><div class="purchase-top"><b>${esc(m.model)}</b><span class="purchase-price"><i>进价/卖价</i><strong>${priceDisplay(m.cost)} <em>/</em> ${priceDisplay(m.sale)}</strong></span></div>${m.note?`<div class="model-note-detail"><span>备注</span><p>${esc(m.note)}</p></div>`:''}<div class="color-list">${m.items.map(g=>{const colors=g.colors.filter(Boolean);return `<div class="color-row"><div class="color-info ${colors.length?'':'no-color'}">${colors.length?`<small>${colors.map(esc).join('　')}</small>`:''}<p>门店 ${g.stores.join(', ')} <strong>× ${quantityDisplay(g)}</strong></p></div></div>`;}).join('')}</div></section></div>`).join(''):`<div class="card empty"><div class="empty-icon">📦</div>还没有分配商品</div>`}</div>
  </div><nav class="bottom"><div class="bottom-inner"><button class="btn btn-light" data-action="home-from-details">采购列表</button><button class="btn btn-primary" data-action="continue">继续录入</button></div></nav>`;
}

function modalView(){
  if(modal.type==='photo-gallery'){
    const selected=modal.selected||new Set(),filter=modal.filter||'pending';
    const ready=modal.items.filter(item=>item.record?.renderedBlob),pending=modal.items.filter(item=>!item.record?.sentAt),sent=modal.items.filter(item=>item.record?.sentAt);
    const visible=filter==='sent'?sent:pending,selectable=visible.filter(item=>item.record?.renderedBlob);
    const allSelected=selectable.length>0&&selectable.every(item=>selected.has(item.model));
    return `<div class="modal-backdrop centered-modal photo-gallery-backdrop"><section class="modal photo-gallery-modal" role="dialog" aria-modal="true" aria-label="商品图片分享">
      <div class="photo-gallery-head"><div><span>图片中心</span><h2>${esc(getBatch().supplier)}</h2><p>共 ${ready.length} 张可分享图片</p></div><button data-action="close-modal" aria-label="关闭图片分享">×</button></div>
      <div class="photo-gallery-tabs" role="tablist" aria-label="图片发送状态"><button type="button" role="tab" aria-selected="${filter==='pending'}" class="${filter==='pending'?'active':''}" data-photo-filter="pending"><span>待发送</span><b>${pending.length}</b></button><button type="button" role="tab" aria-selected="${filter==='sent'}" class="${filter==='sent'?'active':''}" data-photo-filter="sent"><span>已发送</span><b>${sent.length}</b></button></div>
      <div class="photo-gallery-toolbar"><p>${filter==='pending'?'选择图片后批量发送到工作群':'已发送图片可以再次分享'}</p><div><button type="button" data-action="select-all-photos">${allSelected?'取消全选':'全选'}</button><button type="button" data-action="refresh-photos">更新图片</button></div></div>
      <div class="photo-grid">${visible.length?visible.map(item=>`<button class="photo-item ${selected.has(item.model)?'selected':''} ${item.record?.sentAt?'sent':''}" data-photo-model="${esc(item.model)}" ${item.record?.renderedBlob?'':'disabled'}><span class="photo-thumb">${item.url?`<img src="${item.url}" alt="${esc(item.model)} 商品图片">`:'<span class="photo-missing">缺少照片</span>'}${selected.has(item.model)?'<i class="photo-select-mark">✓</i>':''}${item.record?.sentAt?'<i class="photo-sent-mark">已发送</i>':''}</span><b>${esc(item.model)}</b><small>${item.record?.sentAt?esc(sentTime(item.record.sentAt)):(item.record?.renderedBlob?'待发送':'未拍照')}</small></button>`).join(''):`<div class="photo-gallery-empty"><strong>${filter==='pending'?'全部发送完成':'还没有已发送图片'}</strong><span>${filter==='pending'?'新录入或修改后的图片会显示在这里':'发送成功后，图片会自动归档到这里'}</span></div>`}</div>
      <p class="photo-gallery-status">已选 ${selected.size} 张</p>
      <div class="photo-gallery-actions"><button class="btn btn-light" data-action="save-photos">保存图片</button><button class="btn btn-primary" data-action="share-photos">${filter==='sent'?'再次分享':'发送到工作群'}</button></div>
    </section></div>`;
  }
  if(modal.type==='transfer-preview'){
    const preview=modal.preview,settings=V3Drive.loadSettings(),configured=Boolean(settings.clientId),connected=V3Drive.isConnected();
    return `<div class="modal-backdrop centered-modal transfer-backdrop"><section class="modal transfer-modal" role="dialog" aria-modal="true" aria-label="发送到 Windows">
      <header class="transfer-modal-head"><div class="transfer-head-icon">W</div><div><span>采购传输包</span><h2>发送到 Windows</h2><p>${esc(preview.batch.supplier)} · ${esc(preview.batch.date)}</p></div><button data-action="close-modal" aria-label="关闭发送预览">×</button></header>
      ${modal.error?`<div class="transfer-error"><b>发送未完成</b><span>${esc(modal.error)}</span></div>`:''}
      <div class="transfer-summary-grid"><div><small>款式</small><b>${preview.models.length}</b></div><div><small>商品图片</small><b>${preview.readyCount}</b></div><div><small>采购数据</small><b>${preview.lineCount}</b></div><div><small>预计大小</small><b>${esc(V3Drive.formatBytes(preview.estimatedBytes))}</b></div></div>
      <div class="transfer-package-card"><div class="transfer-package-icon">ZIP</div><div><b>${esc(preview.packageName)}</b><span>Excel、采购JSON、校验清单和全部成品图片</span></div></div>
      ${preview.missingModels.length?`<div class="transfer-warning"><b>${preview.missingModels.length} 个型号缺少照片</b><p>${preview.missingModels.map(esc).join('、')}</p><span>仍可发送，Excel和其他图片不会受影响。</span></div>`:`<div class="transfer-ready"><span>✓</span><div><b>图片资料完整</b><small>本批全部型号都有成品图片</small></div></div>`}
      <div class="drive-connection-row"><div><span class="drive-dot ${connected?'online':configured?'configured':''}"></span><div><b>${connected?'Google Drive 已连接':configured?'Google Drive 等待登录':'尚未设置 Google Drive'}</b><small>${configured?'目标目录：采易单 / 待录入':'首次使用需要填写Google OAuth客户端ID'}</small></div></div><button data-action="${configured?'connect-drive':'drive-settings'}">${connected?'检查文件夹':configured?'连接':'设置'}</button></div>
      <p class="transfer-privacy">文件只会进入你的私有Google Drive，不会上传到GitHub。不同账号时，可把“采易单”文件夹共享给Windows账号。</p>
      <footer class="transfer-actions"><button class="btn btn-light" data-action="download-transfer">仅保存 ZIP</button><button class="btn btn-primary" data-action="send-windows">${getBatch().transfer?.fileId?'更新并发送':'确认发送'}</button></footer>
    </section></div>`;
  }
  if(modal.type==='drive-settings'){
    const settings=V3Drive.loadSettings();
    return `<div class="modal-backdrop centered-modal transfer-backdrop"><section class="modal drive-settings-modal" role="dialog" aria-modal="true" aria-label="Google Drive 设置">
      <header class="transfer-modal-head"><div class="transfer-head-icon google-drive-icon">G</div><div><span>一次设置，后续直接发送</span><h2>连接 Google Drive</h2><p>使用你自己的Google Cloud OAuth客户端</p></div><button data-action="back-transfer-preview" aria-label="返回发送预览">×</button></header>
      <label class="drive-client-field"><span>OAuth 客户端 ID</span><input id="googleClientId" value="${esc(settings.clientId)}" placeholder="000000000000-xxxx.apps.googleusercontent.com" autocomplete="off" autocapitalize="off"><small>客户端ID不是密码，可以保存在本机；App不会保存你的Google密码或长期令牌。</small></label>
      <div class="drive-setup-steps"><b>Google Cloud需要完成</b><ol><li>启用 Google Drive API</li><li>创建“Web应用”OAuth客户端</li><li>授权JavaScript来源填写当前采易单网址</li></ol></div>
      <a class="drive-console-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">打开 Google Cloud 凭据页面 ↗</a>
      <footer class="transfer-actions"><button class="btn btn-light" data-action="back-transfer-preview">取消</button><button class="btn btn-primary" data-action="save-drive-settings">保存并连接</button></footer>
    </section></div>`;
  }
  if(modal.type==='transfer-progress'){
    const progress=Math.max(0,Math.min(100,Number(modal.progress)||0));
    return `<div class="modal-backdrop centered-modal transfer-backdrop"><section class="modal transfer-progress-modal" role="dialog" aria-modal="true" aria-label="正在发送到 Windows">
      <div class="transfer-progress-orbit"><span>W</span></div><span class="transfer-progress-kicker">${esc(modal.stage||'准备传输包')}</span><h2>${esc(modal.title||'正在发送到 Windows')}</h2><p>${esc(modal.detail||'请保持页面开启')}</p>
      <div class="transfer-progress-track"><i style="width:${progress}%"></i></div><b class="transfer-progress-number">${modal.stage==='upload'?`${progress}%`:'处理中'}</b>
    </section></div>`;
  }
  if(modal.type==='transfer-success'){
    const result=modal.result;
    return `<div class="modal-backdrop centered-modal transfer-backdrop"><section class="modal transfer-success-modal" role="dialog" aria-modal="true" aria-label="已发送到 Windows">
      <div class="transfer-success-mark">✓</div><span>上传完成</span><h2>已发送到 Windows</h2><p>${esc(result.name)}</p>
      <div class="transfer-success-path"><small>Google Drive</small><b>采易单 / 待录入</b><span>${esc(V3Drive.formatBytes(result.size))} · ${esc(sentTime(result.sentAt))}</span></div>
      <div class="transfer-success-note">Windows登录同一Google账号后会自动同步；不同账号请共享“采易单”文件夹。</div>
      <footer class="transfer-actions"><button class="btn btn-light" data-action="close-transfer-success">完成</button>${result.webViewLink?`<a class="btn btn-primary" href="${esc(result.webViewLink)}" target="_blank" rel="noopener">在Drive查看</a>`:''}</footer>
    </section></div>`;
  }
  if(modal.type==='color') return `<div class="modal-backdrop centered-modal"><div class="modal color-add-modal"><div class="color-manager-head"><span class="color-manager-icon color-add-icon">＋</span><div><h2>增加颜色</h2><p class="modal-hint">支持数字编号、外文或中文颜色，增加后会自动选中。</p></div></div><div class="color-add-field"><label for="newColor">颜色名称或编号</label><input id="newColor" class="field" placeholder="例如：-5、rosso、红" autocomplete="off"></div><div class="modal-actions"><button class="btn btn-light" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-color">增加并选中</button></div></div></div>`;
  if(modal.type==='edit-colors') return `<div class="modal-backdrop centered-modal"><div class="modal color-manager"><div class="color-manager-head"><span class="color-manager-icon">${icon('edit')}</span><div><h2>修改全部颜色</h2><p class="modal-hint">直接修改名称，保存后所有采购记录中的对应颜色会同步更新。</p></div></div><div class="color-edit-list">${state.colors.map((c,i)=>`<div><label>${i+1}</label><input class="field" data-color-original="${esc(c)}" value="${esc(c)}" autocomplete="off"></div>`).join('')}</div><div class="modal-actions"><button class="btn btn-light" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-colors-edit">保存全部</button></div></div></div>`;
  if(modal.type==='sort-colors') return `<div class="modal-backdrop centered-modal color-sort-backdrop"><div class="modal color-sort-manager"><div class="color-manager-head"><span class="color-manager-icon">${icon('sort')}</span><div><h2>调整颜色顺序</h2><p class="modal-hint">${modal.selected?'再点一个目标位置，颜色会移动到那里。':'先点要移动的颜色，再点目标位置，可跨行上下、左右调整。'}</p></div></div><div class="color-sort-grid">${modal.order.map((c,i)=>`<button type="button" class="color-sort-item ${modal.selected===c?'selected':''}" data-sort-color="${esc(c)}"><span>${i+1}</span><b>${esc(c)}</b><i>${modal.selected===c?'已选中':'点击选择'}</i></button>`).join('')}</div><div class="modal-actions"><button class="btn btn-light" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-color-order">保存顺序</button></div></div></div>`;
  if(modal.type==='summary'){
    const b=getBatch(),stats=batchStats(b),sortKey=modal.sortKey||'store',sortDir=modal.sortDir||'asc',factor=sortDir==='asc'?1:-1;
    const rows=storeSummary(b).sort((a,z)=>{if(sortKey==='amount'&&a.hasPendingCost!==z.hasPendingCost)return a.hasPendingCost?1:-1;if(sortKey==='margin'&&a.hasMargin!==z.hasMargin)return a.hasMargin?-1:1;const av=a[sortKey],zv=z[sortKey];return (av-zv||a.store-z.store)*factor;});
    const marginCost=rows.reduce((sum,row)=>sum+row.marginCost,0),marginSales=rows.reduce((sum,row)=>sum+row.marginSales,0),totalMargin=marginSales>0?(marginSales-marginCost)/marginSales*100:null;
    const sortHead=(key,label)=>`<th aria-sort="${sortKey===key?(sortDir==='asc'?'ascending':'descending'):'none'}"><button type="button" data-summary-sort="${key}">${label}<i>${sortKey===key?(sortDir==='asc'?'↑':'↓'):'↕'}</i></button></th>`;
    const summaryTitle=`${b.supplier}采购汇总`;
    return `<div class="modal-backdrop centered-modal summary-backdrop"><section class="modal store-summary-modal" role="dialog" aria-modal="true" aria-label="${esc(summaryTitle)}"><div class="summary-modal-head"><div><h2>${esc(summaryTitle)}</h2><p>${esc(b.date)}</p></div><button data-action="close-modal" aria-label="关闭汇总">×</button></div><div class="summary-table-wrap"><table class="store-summary-table"><thead><tr>${sortHead('store','门店')}${sortHead('models','总款式')}${sortHead('pieces','总件数')}${sortHead('amount','总额')}${sortHead('margin','毛利率')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr><td><b>${row.store}</b>店</td><td>${row.models}</td><td>${compactNumber(row.pieces)}</td><td>${row.hasPendingCost?'待定':`€${euro(row.amount)}`}</td><td>${row.hasMargin?`${row.margin.toFixed(2)}%`:'—'}</td></tr>`).join(''):`<tr><td colspan="5" class="summary-empty">暂无采购数据</td></tr>`}</tbody>${rows.length?`<tfoot><tr><th>合计</th><th>${stats.models}</th><th>${compactNumber(stats.pieces)}</th><th>${stats.hasPendingCost?'待定':`€${euro(stats.amount)}`}</th><th>${totalMargin===null?'—':`${totalMargin.toFixed(2)}%`}</th></tr></tfoot>`:''}</table></div><button class="btn btn-primary summary-close-btn" data-action="close-modal">完成</button></section></div>`;
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
  if(changed){markTransferDirty(b);save();V3Photos.markDirty(b.id,draft.model);}return lines;
}
function normalizeSale(v){ const s=String(v).trim(); if(!s)return ''; return s.includes('.')?Number(s).toFixed(2):`${parseInt(s,10)}.99`; }
function suggestedSale(cost){ return globalThis.V3Pricing?.suggest(cost)||''; }
function stepSale(value,step,cost){
  const current=Number(value),fallback=Number(suggestedSale(cost));
  const base=Number.isFinite(current)?current:(Number.isFinite(fallback)?fallback:.99);
  return Math.max(.99,base+step).toFixed(2);
}
function validDraft(){ syncDraft(); if(!draft.model)return '请输入型号'; if(draft.cost!==''&&(!Number.isFinite(Number(draft.cost))||Number(draft.cost)<0))return '请输入正确的进价'; if(draft.sale!==''&&(!Number.isFinite(Number(draft.sale))||Number(draft.sale)<0))return '请输入正确的卖价'; if(isPackageUnit(draft.unit)&&Number(draft.packSize)<1)return `请输入每${packageUnitLabel(draft.unit)}件数`; const qty=parseQuantity(draft.qty,draft.unit); if(!Number.isFinite(qty)||qty<=0||(draft.unit==='piece'&&(!Number.isInteger(qty)||qty<1)))return '请输入正确的数量'; if(!draft.stores.length)return '请选择至少一家门店'; return ''; }
function applyDetailFilter(){const input=document.querySelector('#detailSearch');if(!input)return;detailSearchTerm=input.value;document.querySelectorAll('[data-search-model]').forEach(el=>el.hidden=!fuzzyMatch(el.dataset.searchModel,detailSearchTerm));}

function bind(){
  document.querySelectorAll('[data-unit]').forEach(x=>x.onclick=()=>{
    syncDraft();
    if(x.dataset.unit==='piece'){
      draft.unit='piece';lastPackageTap=0;
      const q=parseQuantity(draft.qty,draft.unit);draft.qty=String(!Number.isFinite(q)||q<1?1:Math.max(1,Math.round(q)));
      render();return;
    }
    if(!isPackageUnit(draft.unit)){
      draft.unit='pack';lastPackageTap=0;
      const q=parseQuantity(draft.qty,draft.unit);if(!Number.isFinite(q)||q<1)draft.qty='1';
      render();return;
    }
    const now=Date.now();
    if(now-lastPackageTap<=450){draft.unit=draft.unit==='hand'?'pack':'hand';lastPackageTap=0;render();toast(`单位已切换为${packageUnitLabel(draft.unit)}`);}
    else lastPackageTap=now;
  });
  document.querySelectorAll('[data-color-category]').forEach(x=>x.onclick=()=>{syncDraft();colorCategory=x.dataset.colorCategory;render();});
  document.querySelectorAll('[data-color]').forEach(x=>{
    x.onclick=()=>{if(Date.now()<suppressColorClickUntil)return;syncDraft();const c=x.dataset.color;draft.colors=draft.colors.includes(c)?draft.colors.filter(v=>v!==c):[...draft.colors,c];render();};
  });
  document.querySelectorAll('[data-delete-color]').forEach(x=>x.onclick=e=>{e.stopPropagation();syncDraft();const color=x.dataset.deleteColor;state.colors=state.colors.filter(c=>c!==color);draft.colors=draft.colors.filter(c=>c!==color);save();render();toast(`已删除预设颜色 ${color}`);});
  document.querySelectorAll('[data-drag-color]').forEach(x=>{
    let dragging=false,start=null,timer=null,pointerId=null;
    const enterManage=()=>{
      suppressColorClickUntil=Date.now()+800;syncDraft();colorManageMode=true;
      const card=x.closest('.color-card');card?.classList.add('color-managing');
      try{x.setPointerCapture?.(pointerId);}catch(error){}
      toast('颜色整理：继续拖动排序，点击 × 删除');
    };
    const finish=()=>{
      if(!start)return;
      const container=x.closest('.color-sortable'),visibleSet=new Set([...container.querySelectorAll('[data-drag-color]')].map(item=>item.dataset.dragColor)),displayed=[...container.querySelectorAll('[data-drag-color]')].map(item=>item.dataset.dragColor);
      state.colors=state.colors.map(color=>visibleSet.has(color)?displayed.shift():color);
      clearTimeout(timer);x.classList.remove('dragging');x.style.pointerEvents='';start=null;dragging=false;pointerId=null;save();
      if(colorManageMode)render();
    };
    x.onpointerdown=e=>{
      if(e.target.closest('[data-delete-color]')||(typeof e.button==='number'&&e.button!==0))return;
      start={x:e.clientX,y:e.clientY};pointerId=e.pointerId;
      if(colorManageMode){try{x.setPointerCapture?.(e.pointerId);}catch(error){}}
      else timer=setTimeout(enterManage,520);
    };
    x.onpointermove=e=>{
      if(!start)return;
      const moved=Math.hypot(e.clientX-start.x,e.clientY-start.y);
      if(!colorManageMode){if(moved>9){clearTimeout(timer);timer=null;}return;}
      if(!dragging&&moved<6)return;
      dragging=true;x.classList.add('dragging');x.style.pointerEvents='none';
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('[data-drag-color]');
      x.style.pointerEvents='';
      if(!target||target===x||target.parentElement!==x.parentElement)return;
      const rect=target.getBoundingClientRect(),before=e.clientY<rect.top+rect.height/2||(Math.abs(e.clientY-(rect.top+rect.height/2))<rect.height*.34&&e.clientX<rect.left+rect.width/2);
      target.parentElement.insertBefore(x,before?target:target.nextSibling);
    };
    x.onpointerup=e=>{clearTimeout(timer);try{x.releasePointerCapture?.(e.pointerId);}catch(error){}finish();};
    x.onpointercancel=finish;
  });
  document.querySelectorAll('[data-summary-sort]').forEach(x=>x.onclick=()=>{const key=x.dataset.summarySort;modal.sortDir=modal.sortKey===key&&modal.sortDir==='asc'?'desc':'asc';modal.sortKey=key;render();});
  document.querySelectorAll('[data-photo-filter]').forEach(x=>x.onclick=()=>{modal.filter=x.dataset.photoFilter;modal.selected=new Set();render();});
  document.querySelectorAll('[data-sort-color]').forEach(x=>{
    x.onclick=()=>{const target=x.dataset.sortColor;if(!modal.selected){modal.selected=target;render();return;}if(modal.selected===target){modal.selected=null;render();return;}const from=modal.order.indexOf(modal.selected),to=modal.order.indexOf(target);if(from>=0&&to>=0){const [moving]=modal.order.splice(from,1);modal.order.splice(to,0,moving);}modal.selected=null;render();};
  });
  document.querySelectorAll('[data-qty-step]').forEach(x=>x.onclick=()=>{syncDraft();const step=Number(x.dataset.qtyStep);let q=parseQuantity(draft.qty,draft.unit);if(!Number.isFinite(q)||q<=0)q=1;if(isPackageUnit(draft.unit)){if(step<0)q=q<=1?.5:Math.max(1,Math.round(q)-1);else q=q<1?1:Math.max(1,Math.round(q)+1);draft.qty=q===.5?'半':String(q);}else{draft.qty=String(Math.max(1,Math.round(q)+step));}render();});
  document.querySelectorAll('[data-sale-step]').forEach(x=>x.onclick=()=>{const sale=document.querySelector('#sale'),cost=document.querySelector('#cost');if(!sale)return;sale.value=stepSale(sale.value,Number(x.dataset.saleStep),cost?.value);draft.sale=sale.value;const output=document.querySelector('#grossMargin');if(output)output.textContent=grossMarginDisplay(cost?.value,sale.value);});
  document.querySelectorAll('[data-store]').forEach(x=>x.onclick=()=>{syncDraft();const n=Number(x.dataset.store);draft.stores=draft.stores.includes(n)?draft.stores.filter(v=>v!==n):[...draft.stores,n];render();});
  document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{if(Date.now()<suppressBatchOpenUntil)return;activeBatchId=x.dataset.open;detailSearchTerm='';screen='details';render();});
  document.querySelectorAll('[data-delete-batch]').forEach(x=>x.onclick=async()=>{
    const batch=state.batches.find(item=>item.id===x.dataset.deleteBatch);
    if(!batch)return;
    if(!confirm(`确定删除 ${batch.supplier} ${batch.date} 这批采购吗？`))return;
    if(!confirm('再次确认：删除后将清空该批全部采购数据和照片缓存，且无法恢复。确定继续吗？'))return;
    state.batches=state.batches.filter(item=>item.id!==batch.id);
    save();
    try{await V3Photos.removeBatch(batch.id);}catch(error){}
    render();
    toast('该批采购及照片缓存已删除');
  });
  document.querySelectorAll('.batch-swipe-content').forEach(x=>{
    let startX=null,dx=0;
    x.onpointerdown=e=>{startX=e.clientX;dx=0;x.style.transition='none';x.setPointerCapture?.(e.pointerId);};
    x.onpointermove=e=>{if(startX===null)return;dx=Math.max(-88,Math.min(0,e.clientX-startX));if(Math.abs(dx)>6)x.style.transform=`translateX(${dx}px)`;};
    x.onpointerup=e=>{if(startX===null)return;if(Math.abs(dx)>6)suppressBatchOpenUntil=Date.now()+500;x.style.transition='transform .2s ease';x.style.transform=dx<-36?'translateX(-88px)':'translateX(0)';startX=null;x.releasePointerCapture?.(e.pointerId);};
    x.onpointercancel=()=>{startX=null;x.style.transition='transform .2s ease';x.style.transform='translateX(0)';};
  });
  document.querySelectorAll('[data-edit-model]').forEach(x=>x.onclick=async()=>{
    const batch=getBatch(),lines=batch.lines.filter(l=>l.model===x.dataset.editModel),first=lines[0];
    if(!first)return;
    let photoRecord=null;
    try{photoRecord=await V3Photos.get(batch.id,first.model);}catch(error){}
    releaseDraftPhoto();
    draft={...freshDraft(),model:first.model,originalModel:first.model,cost:draftPrice(first.cost),sale:draftPrice(first.sale),unit:first.unit,packSize:isPackageUnit(first.unit)?String(first.packSize):'',qty:draftQuantity(first),note:first.note||'',colors:[...new Set(lines.map(l=>l.color).filter(Boolean))],stores:[...new Set(lines.map(l=>l.store).filter(n=>STORES.includes(n)))].sort((a,b)=>a-b),editIds:lines.map(l=>l.id),editContext:'model'};
    if(photoRecord?.sourceBlob)setDraftPhoto(photoRecord.sourceBlob);
    screen='entry';render();
    if(!photoRecord?.sourceBlob)toast('未找到原照片，可修改数据或重新拍照');
  });
  document.querySelectorAll('[data-edit-preview-store]').forEach(x=>x.onclick=()=>{const store=Number(x.dataset.editPreviewStore),lines=getBatch().lines.filter(l=>l.model===draft.model&&l.store===store),first=lines[0];if(!first)return;const photoBlob=draft.photoBlob,photoUrl=draft.photoUrl,originalModel=draft.originalModel||first.model;draft={...freshDraft(),model:first.model,originalModel,cost:draftPrice(first.cost),sale:draftPrice(first.sale),unit:first.unit,packSize:isPackageUnit(first.unit)?String(first.packSize):'',qty:draftQuantity(first),note:first.note||'',colors:[...new Set(lines.map(l=>l.color).filter(Boolean))],stores:[store],editIds:lines.map(l=>l.id),editContext:'preview',photoBlob,photoUrl};render();requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'smooth'}));toast(`正在修改 ${store} 店`);});
  document.querySelectorAll('[data-delete-preview-store]').forEach(x=>x.onclick=async()=>{const store=Number(x.dataset.deletePreviewStore),model=draft.model;if(confirm(`确定删除 ${store} 店在型号 ${model} 下的全部分配吗？`)){const b=getBatch();b.lines=b.lines.filter(l=>!(l.model===model&&l.store===store));markTransferDirty(b);save();await V3Photos.markDirty(b.id,model);await regenerateModelPhoto(b,model);render();toast(`已删除 ${store} 店分配`);}});
  document.querySelectorAll('[data-delete-model]').forEach(x=>x.onclick=async()=>{const model=x.dataset.deleteModel;if(confirm(`确定删除型号 ${model} 的全部采购信息和照片吗？`)){const b=getBatch();b.lines=b.lines.filter(l=>l.model!==model);markTransferDirty(b);save();await V3Photos.remove(b.id,model);render();toast(`型号 ${model} 已删除`);}});
  document.querySelectorAll('.swipe-content').forEach(x=>{let startX=null,dx=0;x.onpointerdown=e=>{if(e.target.closest('button'))return;startX=e.clientX;dx=0;x.style.transition='none';x.setPointerCapture?.(e.pointerId);};x.onpointermove=e=>{if(startX===null)return;dx=Math.max(-132,Math.min(0,e.clientX-startX));if(Math.abs(dx)>6)x.style.transform=`translateX(${dx}px)`;};x.onpointerup=e=>{if(startX===null)return;x.style.transition='transform .2s ease';x.style.transform=dx<-45?'translateX(-132px)':'translateX(0)';x.closest('.swipe-wrap')?.classList.toggle('open',dx<-45);startX=null;x.releasePointerCapture?.(e.pointerId);};});
  const search=document.querySelector('#detailSearch');if(search){search.oninput=applyDetailFilter;applyDetailFilter();}
  document.querySelectorAll('[data-photo-model]').forEach(x=>x.onclick=()=>{const model=x.dataset.photoModel;if(modal.selected.has(model))modal.selected.delete(model);else modal.selected.add(model);render();});
  document.querySelectorAll('[data-action]').forEach(x=>x.onclick=()=>action(x.dataset.action));
  const photoInput=document.querySelector('#photoInput');
  if(photoInput)photoInput.onchange=()=>{
    const file=photoInput.files?.[0];
    if(file){
      if(!file.type?.startsWith('image/'))toast('请选择照片文件');
      else{
        const editing=draft.editIds.length>0;
        setDraftPhoto(file);
        render();
        setTimeout(()=>document.querySelector('#model')?.focus(),0);
        toast(editing?'新照片已使用，保存修改后更新商品图片':'照片已使用，可以录入商品数据');
      }
    }
    photoInput.value='';
  };
  const quickColor=document.querySelector('#quickColor');
  if(quickColor)quickColor.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();action('quick-add-color');}};
  const cost=document.querySelector('#cost'),sale=document.querySelector('#sale');
  const updateGrossMargin=()=>{const output=document.querySelector('#grossMargin');if(output)output.textContent=grossMarginDisplay(cost?.value,sale?.value);};
  if(cost)cost.oninput=()=>{const suggestion=suggestedSale(cost.value);if(sale)sale.value=suggestion;draft.cost=cost.value.trim();draft.sale=suggestion;updateGrossMargin();};
  if(sale)sale.oninput=updateGrossMargin;
  if(cost)cost.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();syncDraft();sale?.focus();}};
  if(sale)sale.onblur=()=>{draft.sale=normalizeSale(sale.value);sale.value=draft.sale;updateGrossMargin();};
}

async function completeCurrentModel(){
  try{await saveAndRenderModelPhoto(getBatch(),draft.model,draft.photoBlob,draft.originalModel);}
  catch(error){toast(error.message||'图片保存失败');return false;}
  markTransferDirty(getBatch());save();
  releaseDraftPhoto();draft=freshDraft();render();setTimeout(()=>document.querySelector('#model')?.focus(),0);toast('图片已保存，可以输入下一个型号');return true;
}

async function action(name){
  if(name==='start'){const supplier=document.querySelector('#supplier').value.trim(),supplierAbbr=document.querySelector('#supplierAbbr').value.trim();const date=document.querySelector('#date').value;if(!supplier)return toast('请填写供应商名称');const b={id:uid(),supplier,supplierAbbr,date:date||today(),createdAt:Date.now(),lines:[]};state.batches.push(b);activeBatchId=b.id;colorManageMode=false;releaseDraftPhoto();draft=freshDraft();save();V3Photos.requestPersistence();screen='entry';render();}
  if(name==='back-home'||name==='home-from-details'){persistDraftNote();colorManageMode=false;releaseDraftPhoto();screen='home';activeBatchId=null;render();}
  if(name==='details'){const lines=persistDraftNote();if(draft.model&&lines.length){try{await saveAndRenderModelPhoto(getBatch(),draft.model,draft.photoBlob,draft.originalModel);}catch(error){}}colorManageMode=false;screen='details';render();}
  if(name==='continue'){screen='entry';render();}
  if(name==='take-photo'){document.querySelector('#photoInput')?.click();}
  if(name==='add-color'){syncDraft();modal={type:'color'};render();setTimeout(()=>document.querySelector('#newColor')?.focus(),0);}
  if(name==='clear-colors'){syncDraft();draft.colors=[];render();toast('已取消颜色选择');}
  if(name==='edit-colors'){syncDraft();modal={type:'edit-colors'};render();setTimeout(()=>document.querySelector('[data-color-original]')?.focus(),0);}
  if(name==='sort-colors'){syncDraft();modal={type:'sort-colors',order:[...state.colors],selected:null};render();}
  if(name==='close-modal'){revokeGalleryUrls();modal=null;render();}
  if(name==='save-color'){const c=document.querySelector('#newColor').value.trim();if(!c)return toast('请输入颜色');if(!state.colors.includes(c))state.colors.push(c);if(!draft.colors.includes(c))draft.colors.push(c);colorCategory=isNumericColor(c)?'number':'text';save();modal=null;render();toast('颜色已增加');}
  if(name==='quick-add-color'){syncDraft();const input=document.querySelector('#quickColor'),c=input?.value.trim();if(!c)return toast('请输入颜色');if(state.colors.includes(c))return toast('这个颜色已经存在');state.colors.push(c);draft.colors=[...new Set([...draft.colors,c])];colorCategory=isNumericColor(c)?'number':'text';save();render();toast(`已增加并选中 ${c}`);}
  if(name==='finish-color-manage'){syncDraft();colorManageMode=false;render();toast('颜色顺序已保存');}
  if(name==='save-colors-edit'){const inputs=[...document.querySelectorAll('[data-color-original]')],nextColors=inputs.map(input=>input.value.trim());if(inputs.length!==state.colors.length)return toast('颜色数据未加载完整，请重新打开');if(nextColors.some(c=>!c))return toast('颜色名称不能为空');if(new Set(nextColors).size!==nextColors.length)return toast('颜色名称不能重复');const changes=new Map(inputs.map(input=>[input.dataset.colorOriginal,input.value.trim()]));state.colors=nextColors;draft.colors=draft.colors.map(c=>changes.get(c)??c);state.batches.forEach(batch=>{batch.lines.forEach(line=>{if(changes.has(line.color))line.color=changes.get(line.color);});markTransferDirty(batch);});save();for(const batch of state.batches)for(const model of new Set(batch.lines.map(line=>line.model)))await V3Photos.markDirty(batch.id,model);modal=null;render();toast('全部颜色名称已保存');}
  if(name==='save-color-order'){if(!modal?.order?.length)return toast('没有可保存的颜色');state.colors=[...modal.order];save();modal=null;render();toast('颜色顺序已保存');}
  if(name==='toggle-stores'){syncDraft();const visibleSelected=draft.stores.filter(n=>STORES.includes(n));draft.stores=visibleSelected.length===STORES.length?draft.stores.filter(n=>!STORES.includes(n)):[...new Set([...draft.stores,...STORES])];render();}
  if(name==='allocate'){
    const err=validDraft();if(err)return toast(err);
    draft.sale=normalizeSale(draft.sale);
    const quantity=parseQuantity(draft.qty,draft.unit);
    if(isPackageUnit(draft.unit)&&quantity===.5)draft.qty='半';
    const b=getBatch(),editing=draft.editIds.length>0,editContext=draft.editContext,colors=draft.colors.length?draft.colors:[''],oldModel=draft.originalModel,photoBlob=draft.photoBlob,model=draft.model;
    b.lines.forEach(line=>{if(line.model===model)line.note=draft.note;});
    if(editing){const ids=new Set(draft.editIds);b.lines=b.lines.filter(v=>!ids.has(v.id));}
    for(const color of colors)for(const store of draft.stores)b.lines.push({id:uid(),model,cost:draft.cost===''?null:Number(draft.cost),sale:draft.sale===''?null:Number(draft.sale),unit:draft.unit,packSize:isPackageUnit(draft.unit)?Number(draft.packSize):1,qty:quantity,color,store,note:draft.note,createdAt:Date.now()});
    markTransferDirty(b);
    save();
    const count=colors.length*draft.stores.length;
    const photoUpdate=editing?saveAndRenderModelPhoto(b,model,photoBlob,oldModel):null;
    if(editing&&editContext==='model'){
      releaseDraftPhoto();
      draft=freshDraft();
      screen='details';
    }else{
      draft.editIds=[];draft.editContext='';draft.originalModel=model;draft.stores=[];
      screen='entry';
    }
    render();
    toast(editing?(editContext==='preview'?'已保存该门店修改':'已保存型号修改'):`已增加 ${count} 条分配，颜色和数量已保留`);
    if(photoUpdate){
      try{await photoUpdate;toast(editContext==='preview'?'该门店与商品图片已更新':'型号资料与商品图片已更新');}
      catch(error){await V3Photos.markDirty(b.id,model);toast('资料已保存，商品图片将在下次打开时更新');}
    }
  }
  if(name==='clear-search'){detailSearchTerm='';render();setTimeout(()=>document.querySelector('#detailSearch')?.focus(),0);}
  if(name==='cancel-edit'){const returnToDetails=draft.editContext==='model';releaseDraftPhoto();draft=freshDraft();screen=returnToDetails?'details':'entry';render();}
  if(name==='finish-model'){const modelLines=persistDraftNote();if(!draft.model)return toast('当前还没有输入型号');if(!modelLines.length)return toast('请先分配当前型号');const existing=await V3Photos.get(getBatch().id,draft.model);if(!draft.photoBlob&&!existing?.sourceBlob)return toast('请先拍摄商品照片');if(modelLines.some(l=>pricePending(l.cost)||pricePending(l.sale))&&!confirm('进价或卖价尚未填写，图片和明细中会显示“待定”。是否确定提交并输入下一个款式？'))return;await completeCurrentModel();}
  if(name==='windows'){await openTransferPreview();}
  if(name==='drive-settings'){modal={type:'drive-settings'};render();setTimeout(()=>document.querySelector('#googleClientId')?.focus(),0);}
  if(name==='back-transfer-preview'){if(transferPreviewCache){modal={type:'transfer-preview',preview:transferPreviewCache};render();}else await openTransferPreview();}
  if(name==='save-drive-settings'){
    const input=document.querySelector('#googleClientId'),clientId=input?.value.trim()||'';
    if(!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId))return toast('请输入正确的Google OAuth客户端ID');
    const previous=V3Drive.loadSettings().clientId;
    V3Drive.saveSettings({clientId});
    if(previous&&previous!==clientId)V3Drive.clearFolderSettings();
    try{
      modal={type:'transfer-progress',stage:'login',title:'正在连接 Google Drive',detail:'请在Google窗口确认账号',progress:0};render();
      await V3Drive.connect();await V3Drive.ensureFolders();
      modal={type:'transfer-preview',preview:transferPreviewCache||await createTransferPreview(getBatch())};render();toast('Google Drive 已连接');
    }catch(error){
      modal={type:'drive-settings'};render();toast(error.message||'Google Drive连接失败');
    }
  }
  if(name==='connect-drive'){
    try{
      modal={type:'transfer-progress',stage:'login',title:'正在连接 Google Drive',detail:'请在Google窗口确认账号',progress:0};render();
      await V3Drive.connect();await V3Drive.ensureFolders();
      modal={type:'transfer-preview',preview:transferPreviewCache||await createTransferPreview(getBatch())};render();toast('Google Drive 已连接');
    }catch(error){await openTransferPreview(error.message||'Google Drive连接失败');}
  }
  if(name==='download-transfer'){await downloadTransferPackage();}
  if(name==='send-windows'){await sendTransferPackage();}
  if(name==='close-transfer-success'){modal=null;transferPreviewCache=null;transferPackageCache=null;render();}
  if(name==='photos'){await loadPhotoGallery();}
  if(name==='select-all-photos'){const filter=modal.filter||'pending',ready=modal.items.filter(item=>item.record?.renderedBlob&&(filter==='sent'?item.record?.sentAt:!item.record?.sentAt)).map(item=>item.model);modal.selected=ready.length&&ready.every(model=>modal.selected.has(model))?new Set():new Set(ready);render();}
  if(name==='refresh-photos'){revokeGalleryUrls();await loadPhotoGallery(true);toast('商品图片已重新生成');}
  if(name==='share-photos')await shareSelectedPhotos();
  if(name==='save-photos')saveSelectedPhotos();
  if(name==='summary'){modal={type:'summary',sortKey:'store',sortDir:'asc'};render();}
  if(name==='excel')await exportExcel(getBatch());
  if(name==='pdf'){const output=buildPdf(getBatch());if(output){modal={type:'pdf-preview',output};render();}}
  if(name==='export-pdf-file'){const output=modal?.output;modal=null;render();if(output)deliverPdf(output);}
}

function exportRows(b){return [...b.lines].sort((a,z)=>a.model.localeCompare(z.model,undefined,{numeric:true})||a.color.localeCompare(z.color)||a.store-z.store);}
function safeName(s){return s.replace(/[\\/:*?"<>|]/g,'_');}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);}
function photoNamePart(value){return String(value??'').trim().replace(/[\\/:*?"<>|]/g,'-')||'未命名';}
function photoPrice(value){return pricePending(value)?'待定':Number(value).toFixed(2);}
function photoFilename(model,cost,sale){return `${photoNamePart(model)};${photoPrice(cost)};${photoPrice(sale)}.jpg`;}
function shareUnit(line){if(isPackageUnit(line.unit))return Number(line.qty)===.5?`半${packageUnitLabel(line.unit)}`:`${compactNumber(line.qty)}${packageUnitLabel(line.unit)}`;return `${compactNumber(line.qty)}件`;}
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
    const token=index<stores.length-1?`${store}, `:store;
    const next=current?`${current}${token}`:token;
    if(!current||context.measureText(next).width<=maxWidth)current=next;
    else{output.push(current.trimEnd());current=token;}
  });
  if(current)output.push(current.trimEnd());
  return output.length?output:[''];
}
async function createProductImage(batch,model,sourceBlob){
  const lines=batch.lines.filter(line=>line.model===model);
  if(!lines.length)throw new Error('找不到型号采购数据');
  const first=lines[0],allocations=imageAllocationRows(lines),photo=await V3Photos.loadImage(sourceBlob);
  const W=1080,photoH=1440,headerH=112,rowPad=18,lineH=58;
  const measureCanvas=document.createElement('canvas'),measure=measureCanvas.getContext('2d');
  measure.font='46px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
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
  const headerY=photoH,costSale=`${pricePending(first.cost)?'待定':euro(first.cost)} / ${pricePending(first.sale)?'待定':euro(first.sale)}`;
  c.textBaseline='middle';c.fillStyle='#171717';
  const modelSize=fitCanvasText(c,model,300,50,30,'700');c.font=`700 ${modelSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.textAlign='left';c.fillText(model,28,headerY+headerH/2);
  const priceSize=fitCanvasText(c,costSale,380,48,28,'700');c.font=`700 ${priceSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.textAlign='center';c.fillText(costSale,560,headerY+headerH/2);
  const supplierAbbr=String(batch.supplierAbbr||'').trim();
  if(supplierAbbr){
    c.fillStyle='#aaa';
    const supplierSize=fitCanvasText(c,supplierAbbr,240,30,20,'500');c.font=`500 ${supplierSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.textAlign='right';c.fillText(supplierAbbr,W-28,headerY+headerH/2);
  }
  let y=photoH+headerH;separator(y);
  c.font='46px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  for(const row of prepared){
    const top=y;c.fillStyle='#222';c.textBaseline='middle';
    row.storeLines.forEach((storeLine,index)=>{
      const lineY=top+rowPad+lineH/2+index*lineH;
      c.textAlign='left';
      const colorSize=fitCanvasText(c,row.color,125,40,22,'600');
      c.font=`600 ${colorSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;c.fillText(index===0?row.color:'',28,lineY);
      c.font='46px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';c.fillText(storeLine,170,lineY);
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
  modal={type:'photo-gallery',items,selected:new Set(),filter:'pending'};
  render();
}
async function shareSelectedPhotos(){
  const selected=modal.items.filter(item=>modal.selected.has(item.model)&&item.record?.renderedBlob);
  if(!selected.length)return toast('请先选择要分享的图片');
  const files=selected.map(item=>new File([item.record.renderedBlob],item.record.filename,{type:'image/jpeg'}));
  try{
    if(navigator.share&&navigator.canShare?.({files})){
      await navigator.share({files,title:`${getBatch().supplier} 采购图片`});
      const sentAt=Date.now(),batch=getBatch();
      await Promise.all(selected.map(item=>V3Photos.markSent(batch.id,item.model,sentAt)));
      selected.forEach(item=>item.record={...item.record,sentAt});
      modal.selected=new Set();modal.filter='sent';render();toast(`${selected.length} 张图片已归入已发送`);return;
    }
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
function xlsxXml(value){
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
}
function xlsxColumn(index){
  let value=index+1,result='';
  while(value){result=String.fromCharCode(65+(value-1)%26)+result;value=Math.floor((value-1)/26);}
  return result;
}
function xlsxCell(ref,value,style=0){
  if(value===null||value===''||typeof value==='undefined')return '';
  if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  const text=String(value),space=/^\s|\s$/.test(text)?' xml:space="preserve"':'';
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${space}>${xlsxXml(text)}</t></is></c>`;
}
function excelModelRows(batch){
  const groups=new Map();
  for(const line of [...batch.lines].sort((a,z)=>(a.createdAt||0)-(z.createdAt||0))){
    if(!groups.has(line.model))groups.set(line.model,{
      model:line.model,
      cost:pricePending(line.cost)?null:Number(line.cost),
      sale:pricePending(line.sale)?null:Number(line.sale),
      stores:new Map()
    });
    const row=groups.get(line.model),store=Number(line.store);
    row.stores.set(store,(row.stores.get(store)||0)+totalPieces(line));
  }
  return [...groups.values()];
}
async function buildExcelArtifact(batch){
  const headers=['供应商','采购日期','型号','进价','卖价','图片名称',...Array.from({length:20},(_,i)=>`N${i+1}`)];
  const rows=excelModelRows(batch);
  const headerCells=headers.map((value,index)=>xlsxCell(`${xlsxColumn(index)}1`,value,1)).join('');
  const bodyRows=rows.map((row,rowIndex)=>{
    const values=[
      batch.supplier,
      batch.date,
      row.model,
      row.cost,
      row.sale,
      photoFilename(row.model,row.cost,row.sale),
      ...Array.from({length:20},(_,index)=>row.stores.has(index+1)?Number(row.stores.get(index+1).toFixed(2)):null)
    ];
    const cells=values.map((value,columnIndex)=>{
      const style=columnIndex===1?2:(columnIndex===3||columnIndex===4?3:(columnIndex>=6?4:0));
      return xlsxCell(`${xlsxColumn(columnIndex)}${rowIndex+2}`,value,style);
    }).join('');
    return `<row r="${rowIndex+2}" ht="21" customHeight="1">${cells}</row>`;
  }).join('');
  const lastRow=Math.max(1,rows.length+1),lastColumn=xlsxColumn(headers.length-1);
  const columnWidths=[
    [1,1,16],[2,2,13],[3,3,18],[4,5,11],[6,6,34],[7,26,7]
  ].map(([min,max,width])=>`<col min="${min}" max="${max}" width="${width}" customWidth="1"/>`).join('');
  const worksheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columnWidths}</cols>
  <sheetData><row r="1" ht="27" customHeight="1">${headerCells}</row>${bodyRows}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>
  <fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F5748"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD6DDD9"/></left><right style="thin"><color rgb="FFD6DDD9"/></right><top style="thin"><color rgb="FFD6DDD9"/></top><bottom style="thin"><color rgb="FFD6DDD9"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const created=new Date(),entries=[
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`},
    {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`},
    {name:'docProps/app.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>采易单 V3</Application></Properties>`},
    {name:'docProps/core.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>采易单 V3</dc:creator><cp:lastModifiedBy>采易单 V3</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created.toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created.toISOString()}</dcterms:modified></cp:coreProperties>`},
    {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="采购数据" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:'xl/styles.xml',data:styles},
    {name:'xl/worksheets/sheet1.xml',data:worksheet}
  ].map(entry=>({...entry,data:new Blob([entry.data],{type:'application/xml'}),date:created}));
  const zip=await V3Drive.zip(entries);
  const blob=zip.slice(0,zip.size,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return {blob,name:safeName(`ACQUISTO ${batch.supplier}_${batch.date}.xlsx`)};
}
async function exportExcel(b){
  const output=await buildExcelArtifact(b);
  download(output.blob,output.name);toast('Excel 已导出');
}
function transferPackageName(batch){
  const id=String(batch.id||'batch').slice(-8);
  return safeName(`采购包_${batch.supplier}_${batch.date}_${id}.zip`);
}
function purchaseTransferData(batch){
  const stats=batchStats(batch);
  return {
    schemaVersion:1,
    batch:{
      id:batch.id,
      supplier:batch.supplier,
      date:batch.date,
      createdAt:batch.createdAt,
      exportedAt:new Date().toISOString()
    },
    summary:{
      models:stats.models,
      pieces:stats.pieces,
      amount:stats.hasPendingCost?null:Number(stats.amount.toFixed(2)),
      hasPendingCost:stats.hasPendingCost,
      lines:batch.lines.length
    },
    lines:[...batch.lines].sort((a,z)=>(a.createdAt||0)-(z.createdAt||0)||a.store-z.store).map(line=>({
      id:line.id,
      model:line.model,
      cost:pricePending(line.cost)?null:Number(line.cost),
      sale:pricePending(line.sale)?null:Number(line.sale),
      unit:line.unit,
      packSize:Number(line.packSize)||1,
      quantity:Number(line.qty),
      color:line.color||'',
      store:Number(line.store),
      note:line.note||'',
      totalPieces:totalPieces(line),
      createdAt:line.createdAt||null
    }))
  };
}
async function collectTransferPhotos(batch){
  const models=modelDetailGroups(batch,'input').map(item=>item.model),photos=[],missingModels=[];
  for(const model of models){
    let record=await V3Photos.get(batch.id,model);
    if(record?.sourceBlob&&(record.dirty||!record.renderedBlob||record.renderVersion!==PHOTO_RENDER_VERSION)){
      try{await regenerateModelPhoto(batch,model);record=await V3Photos.get(batch.id,model);}
      catch(error){}
    }
    if(record?.renderedBlob)photos.push({model,blob:record.renderedBlob,filename:record.filename||`${photoNamePart(model)}.jpg`});
    else missingModels.push(model);
  }
  return {models,photos,missingModels};
}
async function createTransferPreview(batch){
  const collection=await collectTransferPhotos(batch),excel=await buildExcelArtifact(batch);
  const jsonBytes=new Blob([JSON.stringify(purchaseTransferData(batch))]).size;
  const imageBytes=collection.photos.reduce((sum,item)=>sum+item.blob.size,0);
  return {
    batch:{id:batch.id,supplier:batch.supplier,date:batch.date},
    models:collection.models,
    readyCount:collection.photos.length,
    missingModels:collection.missingModels,
    lineCount:batch.lines.length,
    estimatedBytes:imageBytes+excel.blob.size+jsonBytes+4096,
    packageName:transferPackageName(batch)
  };
}
async function buildTransferPackage(batch,onStage=()=>{}){
  onStage('正在整理商品图片');
  const collection=await collectTransferPhotos(batch);
  onStage('正在生成Excel和采购清单');
  const excel=await buildExcelArtifact(batch),purchase=purchaseTransferData(batch),createdAt=new Date();
  const purchaseBlob=new Blob([JSON.stringify(purchase,null,2)],{type:'application/json'});
  const fileList=[
    {name:excel.name,type:'excel',size:excel.blob.size},
    {name:'purchase.json',type:'data',size:purchaseBlob.size},
    ...collection.photos.map(item=>({name:`images/${item.filename}`,type:'image',model:item.model,size:item.blob.size}))
  ];
  const manifest={
    schemaVersion:1,
    app:'采易单 V3',
    packageName:transferPackageName(batch),
    batchId:batch.id,
    supplier:batch.supplier,
    purchaseDate:batch.date,
    generatedAt:createdAt.toISOString(),
    models:collection.models.length,
    images:collection.photos.length,
    missingModels:collection.missingModels,
    files:fileList
  };
  const manifestBlob=new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'});
  const entries=[
    {name:excel.name,data:excel.blob,date:createdAt},
    {name:'purchase.json',data:purchaseBlob,date:createdAt},
    {name:'manifest.json',data:manifestBlob,date:createdAt},
    ...collection.photos.map(item=>({name:`images/${item.filename}`,data:item.blob,date:createdAt}))
  ];
  onStage('正在生成ZIP采购包');
  const blob=await V3Drive.zip(entries);
  return {blob,name:manifest.packageName,manifest};
}
async function openTransferPreview(error=''){
  const batch=getBatch();
  if(!batch?.lines.length)return toast('当前批次没有可发送的采购数据');
  modal={type:'transfer-progress',stage:'prepare',title:'正在检查采购资料',detail:'正在统计图片和Excel',progress:0};render();
  try{
    transferPreviewCache=await createTransferPreview(batch);
    modal={type:'transfer-preview',preview:transferPreviewCache,error};render();
  }catch(exception){
    modal=null;render();toast(exception.message||'采购资料检查失败');
  }
}
async function downloadTransferPackage(){
  const batch=getBatch();
  modal={type:'transfer-progress',stage:'build',title:'正在生成采购包',detail:'完成后会保存到当前设备',progress:0};render();
  try{
    transferPackageCache=await buildTransferPackage(batch,detail=>{if(modal?.type==='transfer-progress'){modal.detail=detail;render();}});
    download(transferPackageCache.blob,transferPackageCache.name);
    await openTransferPreview();
    toast('ZIP采购包已保存');
  }catch(error){
    await openTransferPreview(error.message||'ZIP采购包生成失败');
  }
}
async function sendTransferPackage(){
  const batch=getBatch();
  if(!V3Drive.isConfigured()){modal={type:'drive-settings'};render();return;}
  try{
    modal={type:'transfer-progress',stage:'login',title:'正在连接 Google Drive',detail:'请在Google窗口确认账号',progress:0};render();
    await V3Drive.connect();
    modal={type:'transfer-progress',stage:'build',title:'正在生成采购包',detail:'正在整理本批图片和Excel',progress:0};render();
    transferPackageCache=await buildTransferPackage(batch,detail=>{if(modal?.type==='transfer-progress'){modal.detail=detail;render();}});
    modal={type:'transfer-progress',stage:'upload',title:'正在发送到 Windows',detail:transferPackageCache.name,progress:0};render();
    let renderedProgress=-1;
    const upload=await V3Drive.uploadPackage(transferPackageCache.blob,transferPackageCache.name,batch.transfer?.fileId||'',progress=>{
      if(progress===renderedProgress)return;
      renderedProgress=progress;
      if(modal?.type==='transfer-progress'){modal.progress=progress;render();}
    });
    const sentAt=Date.now();
    batch.transfer={status:'sent',fileId:upload.id,fileName:upload.name||transferPackageCache.name,webViewLink:upload.webViewLink||'',folderId:upload.folderId,sentAt,size:transferPackageCache.blob.size};
    save();
    modal={type:'transfer-success',result:{name:batch.transfer.fileName,webViewLink:batch.transfer.webViewLink,size:batch.transfer.size,sentAt}};render();
  }catch(error){
    batch.transfer={...(batch.transfer||{}),status:'failed',failedAt:Date.now(),lastError:error.message||'发送失败'};
    save();
    await openTransferPreview(error.message||'发送到Windows失败');
  }
}

function buildPdf(b){
  if(!b.lines.length)return toast('没有可导出的明细');
  const W=1240,H=1754,margin=24,tableW=W-margin*2,headerH=43,pageBottom=H-48;
  const widths=[205,135,350,90,115,110,tableW-1005],heads=['商品型号','颜色','门店','门店数','数量','进价','备注'];
  const models=modelDetailGroups(b,'input').map(m=>({...m,items:m.items.map(g=>({...g,displayColors:g.colors.filter(Boolean)}))}));
  const pages=[];let canvas,c,y;
  const fontFamily='Songti SC, STSong, SimSun, PingFang SC, serif';
  const line=(x1,y1,x2,y2,dashed=false)=>{c.save();c.strokeStyle='#111';c.lineWidth=2;c.setLineDash(dashed?[6,5]:[]);c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();c.restore();};
  const centered=(text,x,w,top,height,font='30px',color='#111')=>{c.save();c.fillStyle=color;c.font=`${font} ${fontFamily}`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(text),x+w/2,top+height/2);c.restore();};
  const wrap=(text,maxWidth,font='29px')=>{c.save();c.font=`${font} ${fontFamily}`;const lines=[];let current='';for(const ch of Array.from(String(text??''))){if(ch==='\n'){lines.push(current);current='';continue;}const next=current+ch;if(!current||c.measureText(next).width<=maxWidth)current=next;else{lines.push(current.trimEnd());current=ch.trimStart();}}if(current||!lines.length)lines.push(current);c.restore();return lines;};
  const wrapStores=(stores,maxWidth,font='29px')=>{c.save();c.font=`${font} ${fontFamily}`;const values=stores.map(String),lines=[];let current='';values.forEach((store,i)=>{const next=current?`${current}, ${store}`:store;const reserve=i<values.length-1?',':'';if(!current||c.measureText(next+reserve).width<=maxWidth)current=next;else{lines.push(`${current},`);current=store;}});if(current||!lines.length)lines.push(current);c.restore();return lines;};
  const multiline=(lines,x,w,top,height,font='29px')=>{const lh=37,total=(lines.length-1)*lh;c.save();c.fillStyle='#111';c.font=`${font} ${fontFamily}`;c.textAlign='center';c.textBaseline='middle';lines.forEach((v,i)=>c.fillText(v,x+w/2,top+height/2-total/2+i*lh));c.restore();};
  const multilineLeft=(lines,x,w,top,height,font='29px')=>{const lh=37,total=(lines.length-1)*lh;c.save();c.fillStyle='#111';c.font=`${font} ${fontFamily}`;c.textAlign='left';c.textBaseline='middle';lines.forEach((v,i)=>c.fillText(v,x+14,top+height/2-total/2+i*lh));c.restore();};
  const itemHeight=item=>Math.max(63,24+Math.max(1,item.displayColors.length,wrapStores(item.stores,widths[2]-28).length)*37);
  const newPage=()=>{if(canvas)pages.push(canvas.toDataURL('image/jpeg',.94));canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,W,H);c.fillStyle='#111';c.textAlign='center';c.textBaseline='alphabetic';c.font=`bold 38px ${fontFamily}`;c.fillText('小潘家采购分货单',W/2,58);c.textAlign='left';c.font=`29px ${fontFamily}`;c.fillText(`供应商名称：${b.supplier}`,margin+7,101);const [year,month,day]=String(b.date||'').split('-').map(Number);c.textAlign='right';c.fillText(`${year||''}年　${month||''}　月　${day||''}　日`,W-margin-7,101);y=112;c.fillStyle='#c7c7c7';c.fillRect(margin,y,tableW,headerH);let x=margin;heads.forEach((h,i)=>{centered(h,x,widths[i],y,headerH,'bold 25px');x+=widths[i];});line(margin,y,W-margin,y);line(margin,y+headerH,W-margin,y+headerH);x=margin;for(const w of widths){line(x,y,x,y+headerH);x+=w;}line(W-margin,y,W-margin,y+headerH);y+=headerH;};
  newPage();
  for(const model of models){const heights=model.items.map(itemHeight),modelLines=wrap(model.model,widths[0]-16,'30px'),modelH=24+modelLines.length*37,noteLines=wrap(model.note||'',widths[6]-24,'24px'),noteH=model.note?24+noteLines.length*31:63;let groupH=heights.reduce((s,n)=>s+n,0),requiredH=Math.max(modelH,noteH);if(requiredH>groupH){heights[heights.length-1]+=requiredH-groupH;groupH=requiredH;}const pageCapacity=pageBottom-(112+headerH);if(groupH<=pageCapacity&&y+groupH>pageBottom)newPage();let i=0;while(i<model.items.length){if(y+heights[i]>pageBottom)newPage();const startY=y,startIndex=i,xModel=margin,xColor=xModel+widths[0],xStores=xColor+widths[1],xStoreCount=xStores+widths[2],xQty=xStoreCount+widths[3],xCost=xQty+widths[4],xNote=xCost+widths[5];while(i<model.items.length&&y+heights[i]<=pageBottom){const item=model.items[i],h=heights[i],colors=item.displayColors.length?item.displayColors:[''];multiline(colors,xColor,widths[1],y,h);multilineLeft(wrapStores(item.stores,widths[2]-28),xStores,widths[2],y,h);centered(`${item.stores.length}家`,xStoreCount,widths[3],y,h,'25px');centered(pdfQuantity(item),xQty,widths[4],y,h,'27px');y+=h;i++;if(i<model.items.length&&y+heights[i]<=pageBottom)line(xColor,y,xCost,y,true);}const endY=y;multiline(modelLines,xModel,widths[0],startY,endY-startY,'30px');centered(euro(model.cost),xCost,widths[5],startY,endY-startY,'27px');if(model.note)multiline(noteLines,xNote,widths[6],startY,endY-startY,'24px');line(margin,startY,W-margin,startY);line(margin,endY,W-margin,endY);for(const x of [xModel,xColor,xStores,xStoreCount,xQty,xCost,xNote,W-margin])line(x,startY,x,endY);if(i===startIndex)break;if(i<model.items.length)newPage();}}
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
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=26',{updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{}));
}
render();
