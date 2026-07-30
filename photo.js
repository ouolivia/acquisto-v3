(function(){
  const DB_NAME='acquisto-v3-images';
  const DB_VERSION=1;
  const STORE='photos';

  function key(batchId,model){return `${batchId}\u001f${model}`;}
  function open(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE)){
          const store=db.createObjectStore(STORE,{keyPath:'key'});
          store.createIndex('batchId','batchId',{unique:false});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function transaction(mode,work){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      const store=tx.objectStore(STORE);
      let result;
      try{result=work(store);}catch(error){db.close();reject(error);return;}
      tx.oncomplete=()=>{db.close();resolve(result);};
      tx.onerror=()=>{db.close();reject(tx.error);};
      tx.onabort=()=>{db.close();reject(tx.error||new Error('图片存储已取消'));};
    });
  }
  async function get(batchId,model){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const request=tx.objectStore(STORE).get(key(batchId,model));
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error);
      tx.oncomplete=()=>db.close();
    });
  }
  async function put(record){
    return transaction('readwrite',store=>store.put({...record,key:key(record.batchId,record.model),updatedAt:Date.now()}));
  }
  async function saveSource(batchId,model,sourceBlob){
    const current=await get(batchId,model);
    return put({...(current||{}),batchId,model,sourceBlob,renderedBlob:null,filename:'',dirty:true,sentAt:null});
  }
  async function saveRendered(batchId,model,renderedBlob,filename,renderVersion=1){
    const current=await get(batchId,model);
    if(!current?.sourceBlob)throw new Error('缺少商品照片');
    return put({...current,batchId,model,renderedBlob,filename,renderVersion,dirty:false,renderedAt:Date.now()});
  }
  async function markDirty(batchId,model){
    const current=await get(batchId,model);
    if(current)return put({...current,dirty:true,sentAt:null});
  }
  async function markSent(batchId,model,sentAt=Date.now()){
    const current=await get(batchId,model);
    if(current?.renderedBlob)return put({...current,sentAt});
  }
  async function remove(batchId,model){
    return transaction('readwrite',store=>store.delete(key(batchId,model)));
  }
  async function removeBatch(batchId){
    const records=await listBatch(batchId);
    await Promise.all(records.map(record=>remove(batchId,record.model)));
  }
  async function move(batchId,fromModel,toModel){
    if(!fromModel||fromModel===toModel)return get(batchId,toModel);
    const current=await get(batchId,fromModel);
    if(!current)return null;
    await put({...current,batchId,model:toModel,dirty:true});
    await remove(batchId,fromModel);
    return get(batchId,toModel);
  }
  async function listBatch(batchId){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readonly');
      const index=tx.objectStore(STORE).index('batchId');
      const request=index.getAll(IDBKeyRange.only(batchId));
      request.onsuccess=()=>resolve(request.result||[]);
      request.onerror=()=>reject(request.error);
      tx.oncomplete=()=>db.close();
    });
  }
  function loadImage(blob){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob);
      const image=new Image();
      image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('无法读取照片'));};
      image.src=url;
    });
  }
  async function crop(file,options){
    const image=await loadImage(file);
    const frameW=Math.max(1,Number(options.frameW)||3);
    const frameH=Math.max(1,Number(options.frameH)||4);
    const zoom=Math.max(1,Number(options.zoom)||1);
    const offsetX=Number(options.x)||0;
    const offsetY=Number(options.y)||0;
    const baseScale=Math.max(frameW/image.naturalWidth,frameH/image.naturalHeight);
    const scale=baseScale*zoom;
    const cropW=Math.min(image.naturalWidth,frameW/scale);
    const cropH=Math.min(image.naturalHeight,frameH/scale);
    let sx=(image.naturalWidth-cropW)/2-offsetX/scale;
    let sy=(image.naturalHeight-cropH)/2-offsetY/scale;
    sx=Math.max(0,Math.min(image.naturalWidth-cropW,sx));
    sy=Math.max(0,Math.min(image.naturalHeight-cropH,sy));
    const canvas=document.createElement('canvas');
    canvas.width=1080;
    canvas.height=1440;
    const context=canvas.getContext('2d');
    context.fillStyle='#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,sx,sy,cropW,cropH,0,0,canvas.width,canvas.height);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('照片裁剪失败')),'image/jpeg',.9));
  }
  async function storageInfo(){
    if(!navigator.storage?.estimate)return null;
    const estimate=await navigator.storage.estimate();
    return {usage:estimate.usage||0,quota:estimate.quota||0};
  }
  async function requestPersistence(){
    if(!navigator.storage?.persist)return false;
    try{return await navigator.storage.persist();}catch(error){return false;}
  }

  window.V3Photos={get,saveSource,saveRendered,markDirty,markSent,remove,removeBatch,move,listBatch,crop,loadImage,storageInfo,requestPersistence};
})();
