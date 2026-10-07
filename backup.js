(function(){
  const PART_BYTES=48*1024*1024;
  const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const encoder=new TextEncoder();
  function header(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
  // Store ZIP entries as Blob references; only a 256 KB CRC buffer is read at once.
  async function zip(entries){
    const chunks=[],central=[];let offset=0,count=0;
    for await(const entry of entries){
      const blob=entry.data instanceof Blob?entry.data:new Blob([entry.data]);
      const name=encoder.encode(entry.name);
      if(count>=65535||offset+blob.size+name.length+30>=0xffffffff)throw new Error('备份文件过大，请分卷备份');
      let crc=0xffffffff;
      for(let at=0;at<blob.size;at+=262144){
        const bytes=new Uint8Array(await blob.slice(at,at+262144).arrayBuffer());
        for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);
      }
      crc=(crc^0xffffffff)>>>0;
      const local=header(30),lv=local.view;
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);
      lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,blob.size,true);lv.setUint32(22,blob.size,true);lv.setUint16(26,name.length,true);
      chunks.push(local.bytes,name,blob);
      const item=header(46),cv=item.view;
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);
      cv.setUint32(16,crc,true);cv.setUint32(20,blob.size,true);cv.setUint32(24,blob.size,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);
      central.push(item.bytes,name);offset+=30+name.length+blob.size;count++;
    }
    const directory=new Blob(central),end=header(22),ev=end.view;
    ev.setUint32(0,0x06054b50,true);ev.setUint16(8,count,true);ev.setUint16(10,count,true);ev.setUint32(12,directory.size,true);ev.setUint32(16,offset,true);
    return new Blob([...chunks,directory,end.bytes],{type:'application/zip'});
  }
  function plan(inventory,limit=PART_BYTES){
    const parts=[[]];let size=0;
    inventory.forEach((item,index)=>{
      const bytes=item.sourceSize+item.renderedSize;
      if(parts[parts.length-1].length&&(size+bytes>limit||parts[parts.length-1].length>=10000)){parts.push([]);size=0;}
      parts[parts.length-1].push({...item,index});size+=bytes;
    });
    return parts;
  }
  async function createPart(session,partIndex,photos,onProgress=()=>{}){
    const items=session.parts[partIndex];if(!items)throw new Error('备份分卷不存在');
    async function* entries(){
      yield {name:'采购数据.json',data:JSON.stringify({format:'caiyidan-full-backup',version:1,backupId:session.id,createdAt:session.createdAt,part:partIndex+1,parts:session.parts.length,state:session.state,draft:session.draft,recoveryState:session.recoveryState||null},null,2)};
      const manifest=[];let completed=0;
      for(const item of items){
        const m=item.metadata,record=await photos.get(m.batchId,m.model);
        if(!record||record.updatedAt!==m.updatedAt)throw new Error('照片在备份期间发生变化，请重新准备备份');
        const {sourceBlob,renderedBlob,...metadata}=record;
        if((sourceBlob?.size||0)!==item.sourceSize||(renderedBlob?.size||0)!==item.renderedSize)throw new Error('照片读取不完整，请重新准备备份');
        const info={metadata,source:null,rendered:null};
        for(const [field,blob] of [['source',sourceBlob],['rendered',renderedBlob]]){
          if(!blob)continue;
          const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':blob.type==='image/jpeg'?'jpg':'bin';
          const path=`photos/${String(item.index+1).padStart(6,'0')}-${field}.${ext}`;
          info[field]={path,type:blob.type,size:blob.size};yield {name:path,data:blob};
        }
        manifest.push(info);onProgress(++completed,items.length);
      }
      yield {name:'照片目录.json',data:JSON.stringify({backupId:session.id,part:partIndex+1,parts:session.parts.length,photos:manifest},null,2)};
      yield {name:'备份说明.txt',data:`采易单完整数据备份\n备份编号：${session.id}\n本文件是第 ${partIndex+1}/${session.parts.length} 卷，请保存全部分卷。\n采购数据.json：全部采购批次、门店分配、颜色、推广标记与草稿。\n照片目录.json：本卷原图、生成图片及其型号、批次和元数据映射。\nphotos 文件夹：原始照片及生成的采购图片，未重新压缩。\n这些文件可用于数据恢复；Excel/PDF 不能替代完整备份。\n备份不会自动同步到其他设备，请将全部 ZIP 存入“文件”或电脑。\n`};
    }
    return zip(entries());
  }
  async function checksum(blob){
    let crc=0xffffffff;
    for(let at=0;at<blob.size;at+=262144){
      const bytes=new Uint8Array(await blob.slice(at,at+262144).arrayBuffer());
      for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);
    }
    return (crc^0xffffffff)>>>0;
  }
  function requireValue(ok,message){if(!ok)throw new Error(message);}
  async function readZip(file){
    requireValue(file.size>=22,'不是完整的备份 ZIP 文件');
    const end=new DataView(await file.slice(file.size-22).arrayBuffer());
    requireValue(end.getUint32(0,true)===0x06054b50&&end.getUint16(20,true)===0,'请选择采易单直接导出的 ZIP，不要重新压缩');
    const count=end.getUint16(10,true),size=end.getUint32(12,true),offset=end.getUint32(16,true);
    requireValue(end.getUint16(4,true)===0&&end.getUint16(6,true)===0&&end.getUint16(8,true)===count&&offset+size===file.size-22&&size<=16*1024*1024,'备份 ZIP 目录不完整');
    const directory=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer()),dv=new DataView(directory.buffer),decoder=new TextDecoder('utf-8',{fatal:true}),entries=new Map();
    let pos=0,nextOffset=0;
    for(let i=0;i<count;i++){
      requireValue(pos+46<=size&&dv.getUint32(pos,true)===0x02014b50,'备份 ZIP 目录损坏');
      const flags=dv.getUint16(pos+8,true),method=dv.getUint16(pos+10,true),crc=dv.getUint32(pos+16,true),length=dv.getUint32(pos+24,true),nameLen=dv.getUint16(pos+28,true),extra=dv.getUint16(pos+30,true),comment=dv.getUint16(pos+32,true),start=dv.getUint32(pos+42,true);
      requireValue(flags===0x800&&method===0&&dv.getUint32(pos+20,true)===length&&pos+46+nameLen+extra+comment<=size,'备份格式不支持，请使用原始导出文件');
      const name=decoder.decode(directory.slice(pos+46,pos+46+nameLen));
      requireValue(name&&!entries.has(name)&&!name.split('/').includes('..')&&!name.startsWith('/')&&!name.includes('\\'),'备份文件名重复或无效');
      requireValue(start===nextOffset&&start+30<=offset,'备份 ZIP 文件位置无效');
      const local=new DataView(await file.slice(start,start+30).arrayBuffer()),localNameLen=local.getUint16(26,true),localExtra=local.getUint16(28,true),dataStart=start+30+localNameLen+localExtra;
      requireValue(local.getUint32(0,true)===0x04034b50&&local.getUint16(6,true)===flags&&local.getUint16(8,true)===method&&local.getUint32(14,true)===crc&&local.getUint32(18,true)===length&&local.getUint32(22,true)===length&&dataStart+length<=offset,'备份文件头损坏');
      requireValue(decoder.decode(await file.slice(start+30,start+30+localNameLen).arrayBuffer())===name,'备份文件名称不一致');
      const blob=file.slice(dataStart,dataStart+length);
      requireValue(await checksum(blob)===crc,`文件校验失败：${name}，请重新传输备份`);
      entries.set(name,{blob,crc,size:length});nextOffset=dataStart+length;pos+=46+nameLen+extra+comment;
    }
    requireValue(pos===size&&nextOffset===offset,'备份 ZIP 目录长度不一致');
    return entries;
  }
  function safeText(value,max=1000){return typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}
  function validateState(state){
    requireValue(state&&Array.isArray(state.batches)&&Array.isArray(state.colors)&&state.colors.every(c=>safeText(c)),'采购数据格式不正确');
    const ids=new Set();
    for(const b of state.batches){
      requireValue(safeText(b.id)&&b.id&&!ids.has(b.id)&&safeText(b.supplier)&&safeText(b.date)&&Array.isArray(b.lines),'采购批次数据不完整或编号重复');ids.add(b.id);
      requireValue(Number.isFinite(b.createdAt)&&(!b.promotedModels||(Array.isArray(b.promotedModels)&&b.promotedModels.every(m=>safeText(m)))),'采购批次日期或推广标记不正确');
      for(const l of b.lines){
        requireValue(l&&safeText(l.model)&&l.model&&safeText(l.color??'')&&['piece','pack','hand'].includes(l.unit)&&Number.isFinite(Number(l.qty))&&Number(l.qty)>=0&&Number.isFinite(Number(l.packSize))&&Number(l.packSize)>0&&Number.isFinite(Number(l.store)),'采购明细不完整');
        for(const price of [l.cost,l.sale])requireValue(price==null||price===''||(Number.isFinite(Number(price))&&Number(price)>=0),'采购价格格式不正确');
        requireValue(l.note==null||typeof l.note==='string','采购备注格式不正确');
      }
    }
  }
  async function jsonEntry(entries,name){
    const entry=entries.get(name);requireValue(entry&&entry.size<=64*1024*1024,`缺少或过大的 ${name}`);
    try{return JSON.parse(await entry.blob.text());}catch(error){throw new Error(`${name} 无法读取`);}
  }
  async function inspect(files,progress=()=>{}){
    requireValue(files.length>0,'请选择备份 ZIP 的全部分卷');
    let first=null,snapshot='',photos=[],parts=new Set(),keys=new Set();
    for(let index=0;index<files.length;index++){
      progress(index+1,files.length);
      const entries=await readZip(files[index]),data=await jsonEntry(entries,'采购数据.json'),manifest=await jsonEntry(entries,'照片目录.json');
      requireValue(data.format==='caiyidan-full-backup'&&data.version===1&&safeText(data.backupId)&&data.backupId,'不支持的备份格式或版本');
      requireValue(Number.isInteger(data.parts)&&data.parts>0&&data.parts<=10000&&Number.isInteger(data.part)&&data.part>0&&data.part<=data.parts,'备份分卷编号无效');
      validateState(data.state);
      const content=JSON.stringify({state:data.state,draft:data.draft,recoveryState:data.recoveryState||null});
      if(!first){first=data;snapshot=content;}
      requireValue(data.backupId===first.backupId&&data.parts===first.parts&&content===snapshot,'不能混用不同时间或不同设备的备份分卷');
      requireValue(!parts.has(data.part),'重复选择了同一个分卷');parts.add(data.part);
      requireValue(manifest.backupId===data.backupId&&manifest.part===data.part&&manifest.parts===data.parts&&Array.isArray(manifest.photos),'照片目录与采购备份不一致');
      const used=new Set(['采购数据.json','照片目录.json','备份说明.txt']);
      for(const row of manifest.photos){
        const m=row.metadata;
        requireValue(m&&safeText(m.batchId)&&m.batchId&&safeText(m.model)&&m.model,'照片对应的批次或型号无效');
        const key=JSON.stringify([m.batchId,m.model]);requireValue(!keys.has(key),'照片目录中有重复型号');keys.add(key);
        const photo={metadata:m,source:null,rendered:null};
        for(const field of ['source','rendered'])if(row[field]){
          const info=row[field],entry=entries.get(info.path);
          requireValue(entry&&info.path.startsWith('photos/')&&!used.has(info.path)&&entry.size===info.size&&typeof info.type==='string','照片文件缺失或大小不符');
          used.add(info.path);photo[field]={blob:entry.blob.slice(0,entry.size,info.type),crc:entry.crc,size:entry.size};
        }
        photos.push(photo);
      }
      requireValue([...entries.keys()].every(name=>used.has(name)),'备份包含未登记的文件');
    }
    const missing=Array.from({length:first.parts},(_,i)=>i+1).filter(n=>!parts.has(n));
    requireValue(!missing.length,`缺少第 ${missing.join('、')} 卷，请一次选择全部分卷`);
    return {data:first,photos};
  }
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    return JSON.stringify(value)??'null';
  }
  function batchContent(batch){const {id,transfer,backupImport,...rest}=batch;return rest;}
  async function fingerprint(batch,photos){
    const summary=photos.map(p=>({model:p.metadata.model,source:p.source?{crc:p.source.crc,size:p.source.size}:null,rendered:p.rendered?{crc:p.rendered.crc,size:p.rendered.size}:null})).sort((a,b)=>a.model.localeCompare(b.model));
    const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(canonical({batch:batchContent(batch),photos:summary})));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function mergePlan(imported,current,photosApi,makeId){
    if((current.importedBackupIds||[]).includes(imported.data.backupId))return {additions:[],skipped:imported.data.state.batches.length,alreadyImported:true,photoCount:0};
    const additions=[],known=new Set(current.batches.map(b=>b.backupImport?.fingerprint).filter(Boolean)),idMap=new Map();let skipped=0,conflicts=0;
    for(const batch of imported.data.state.batches){
      const photos=imported.photos.filter(p=>p.metadata.batchId===batch.id),hash=await fingerprint(batch,photos);
      let same=known.has(hash),existing=current.batches.find(b=>b.id===batch.id);
      if(!same&&existing&&canonical(batchContent(existing))===canonical(batchContent(batch))){
        const local=[];
        for(const photo of photos){
          const record=await photosApi.get(existing.id,photo.metadata.model);if(!record)break;
          local.push({metadata:record,source:record.sourceBlob?{crc:await checksum(record.sourceBlob),size:record.sourceBlob.size}:null,rendered:record.renderedBlob?{crc:await checksum(record.renderedBlob),size:record.renderedBlob.size}:null});
        }
        same=local.length===photos.length&&await fingerprint(existing,local)===hash;
      }
      if(same){skipped++;continue;}
      if(existing||current.batches.some(b=>b.supplier===batch.supplier&&b.date===batch.date))conflicts++;
      const id=makeId(),{transfer,backupImport,...copy}=batch;
      idMap.set(batch.id,id);known.add(hash);
      additions.push({batch:{...copy,id,backupImport:{backupId:imported.data.backupId,originalId:batch.id,fingerprint:hash}},photos});
    }
    return {additions,skipped,conflicts,idMap,photoCount:additions.reduce((n,a)=>n+a.photos.length,0),orphanPhotos:imported.photos.filter(p=>!imported.data.state.batches.some(b=>b.id===p.metadata.batchId)).length};
  }
  window.V3Backup={plan,createPart,zip,inspect,mergePlan,checksum};
})();
