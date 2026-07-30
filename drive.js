(function(){
  const SETTINGS_KEY='acquisto-v3-drive-settings';
  const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
  const FOLDER_MIME='application/vnd.google-apps.folder';
  let accessToken='';
  let tokenClient=null;
  let tokenClientId='';

  function loadSettings(){
    try{
      const value=JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if(value&&typeof value==='object')return {
        clientId:String(value.clientId||'').trim(),
        rootFolderId:String(value.rootFolderId||'').trim(),
        inboxFolderId:String(value.inboxFolderId||'').trim()
      };
    }catch(error){}
    return {clientId:'',rootFolderId:'',inboxFolderId:''};
  }
  function saveSettings(next){
    const current=loadSettings(),value={...current,...next};
    localStorage.setItem(SETTINGS_KEY,JSON.stringify(value));
    return value;
  }
  function clearFolderSettings(){return saveSettings({rootFolderId:'',inboxFolderId:''});}
  function isConfigured(){return Boolean(loadSettings().clientId);}
  function isConnected(){return Boolean(accessToken);}
  function loadScript(){
    if(window.google?.accounts?.oauth2)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-google-identity]');
      if(existing){
        existing.addEventListener('load',()=>resolve(),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Google登录服务加载失败')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;
      script.defer=true;
      script.dataset.googleIdentity='true';
      script.onload=()=>resolve();
      script.onerror=()=>reject(new Error('Google登录服务加载失败，请检查网络'));
      document.head.appendChild(script);
    });
  }
  async function connect(){
    const settings=loadSettings();
    if(!settings.clientId)throw new Error('请先设置Google OAuth客户端ID');
    await loadScript();
    if(!tokenClient||tokenClientId!==settings.clientId){
      tokenClientId=settings.clientId;
      tokenClient=google.accounts.oauth2.initTokenClient({
        client_id:settings.clientId,
        scope:DRIVE_SCOPE,
        callback:()=>{}
      });
    }
    return new Promise((resolve,reject)=>{
      tokenClient.callback=response=>{
        if(response?.error){reject(new Error(response.error_description||response.error));return;}
        accessToken=response.access_token||'';
        if(!accessToken){reject(new Error('Google登录未返回访问权限'));return;}
        resolve(response);
      };
      tokenClient.error_callback=error=>reject(new Error(error?.message||'Google登录已取消'));
      tokenClient.requestAccessToken({prompt:accessToken?'':'consent'});
    });
  }
  async function authorizedFetch(url,options={},retry=true){
    if(!accessToken)await connect();
    const headers=new Headers(options.headers||{});
    headers.set('Authorization',`Bearer ${accessToken}`);
    const response=await fetch(url,{...options,headers});
    if(response.status===401&&retry){
      accessToken='';
      await connect();
      return authorizedFetch(url,options,false);
    }
    return response;
  }
  function driveQuery(value){return String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
  async function findFolder(name,parentId=''){
    const clauses=[
      `name='${driveQuery(name)}'`,
      `mimeType='${FOLDER_MIME}'`,
      'trashed=false'
    ];
    if(parentId)clauses.push(`'${driveQuery(parentId)}' in parents`);
    const params=new URLSearchParams({
      q:clauses.join(' and '),
      spaces:'drive',
      fields:'files(id,name,parents)',
      pageSize:'10'
    });
    const response=await authorizedFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    if(!response.ok)throw new Error(`查找Google Drive文件夹失败（${response.status}）`);
    const data=await response.json();
    return data.files?.[0]||null;
  }
  async function createFolder(name,parentId=''){
    const metadata={name,mimeType:FOLDER_MIME};
    if(parentId)metadata.parents=[parentId];
    const response=await authorizedFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,parents',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(metadata)
    });
    if(!response.ok)throw new Error(`创建Google Drive文件夹失败（${response.status}）`);
    return response.json();
  }
  async function verifyFolder(id){
    if(!id)return false;
    const response=await authorizedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed`);
    if(response.status===404)return false;
    if(!response.ok)throw new Error(`检查Google Drive文件夹失败（${response.status}）`);
    const file=await response.json();
    return file.mimeType===FOLDER_MIME&&!file.trashed;
  }
  async function ensureFolders(){
    let settings=loadSettings(),rootId=settings.rootFolderId,inboxId=settings.inboxFolderId;
    if(rootId&&!(await verifyFolder(rootId)))rootId='';
    if(inboxId&&!(await verifyFolder(inboxId)))inboxId='';
    if(!rootId){
      const existing=await findFolder('采易单');
      const root=existing||await createFolder('采易单');
      rootId=root.id;
    }
    if(!inboxId){
      const existing=await findFolder('待录入',rootId);
      const inbox=existing||await createFolder('待录入',rootId);
      inboxId=inbox.id;
    }
    settings=saveSettings({rootFolderId:rootId,inboxFolderId:inboxId});
    return settings;
  }
  async function startResumableUpload(blob,name,folderId,fileId=''){
    const metadata={name,mimeType:'application/zip'};
    if(!fileId)metadata.parents=[folderId];
    const endpoint=fileId
      ?`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id,name,webViewLink,modifiedTime`
      :'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,modifiedTime';
    const response=await authorizedFetch(endpoint,{
      method:fileId?'PATCH':'POST',
      headers:{
        'Content-Type':'application/json; charset=UTF-8',
        'X-Upload-Content-Type':'application/zip',
        'X-Upload-Content-Length':String(blob.size)
      },
      body:JSON.stringify(metadata)
    });
    if(response.status===404&&fileId)return startResumableUpload(blob,name,folderId,'');
    if(!response.ok)throw new Error(`准备Google Drive上传失败（${response.status}）`);
    const location=response.headers.get('Location');
    if(!location)throw new Error('Google Drive未返回上传地址');
    return location;
  }
  async function uploadPackage(blob,name,fileId='',onProgress=()=>{}){
    const settings=await ensureFolders();
    const location=await startResumableUpload(blob,name,settings.inboxFolderId,fileId);
    const result=await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('PUT',location);
      xhr.setRequestHeader('Content-Type','application/zip');
      xhr.upload.onprogress=event=>{
        if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));
      };
      xhr.onload=()=>{
        if(xhr.status>=200&&xhr.status<300){
          try{resolve(JSON.parse(xhr.responseText));}
          catch(error){reject(new Error('Google Drive上传结果无法读取'));}
        }else reject(new Error(`Google Drive上传失败（${xhr.status}）`));
      };
      xhr.onerror=()=>reject(new Error('Google Drive上传失败，请检查网络'));
      xhr.onabort=()=>reject(new Error('Google Drive上传已取消'));
      xhr.send(blob);
    });
    onProgress(100);
    return {...result,folderId:settings.inboxFolderId};
  }

  const crcTable=(()=>{
    const table=new Uint32Array(256);
    for(let n=0;n<256;n++){
      let c=n;
      for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
      table[n]=c>>>0;
    }
    return table;
  })();
  function crc32(bytes){
    let crc=0xffffffff;
    for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }
  function u16(value){return new Uint8Array([value&255,(value>>>8)&255]);}
  function u32(value){return new Uint8Array([value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255]);}
  function concat(parts){
    const length=parts.reduce((sum,part)=>sum+part.length,0),output=new Uint8Array(length);
    let offset=0;
    for(const part of parts){output.set(part,offset);offset+=part.length;}
    return output;
  }
  function dosDateTime(dateValue){
    const date=dateValue instanceof Date?dateValue:new Date(dateValue||Date.now());
    const year=Math.max(1980,date.getFullYear());
    return {
      time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),
      date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()
    };
  }
  async function zip(entries){
    const encoder=new TextEncoder(),locals=[],centrals=[];
    let offset=0;
    for(const entry of entries){
      const name=encoder.encode(String(entry.name).replace(/^\/+/,''));
      const bytes=entry.data instanceof Uint8Array?entry.data:new Uint8Array(await entry.data.arrayBuffer());
      const crc=crc32(bytes),stamp=dosDateTime(entry.date);
      const local=concat([
        u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(stamp.time),u16(stamp.date),
        u32(crc),u32(bytes.length),u32(bytes.length),u16(name.length),u16(0),name,bytes
      ]);
      locals.push(local);
      centrals.push(concat([
        u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(stamp.time),u16(stamp.date),
        u32(crc),u32(bytes.length),u32(bytes.length),u16(name.length),u16(0),u16(0),
        u16(0),u16(0),u32(0),u32(offset),name
      ]));
      offset+=local.length;
    }
    const central=concat(centrals);
    const end=concat([
      u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),
      u32(central.length),u32(offset),u16(0)
    ]);
    return new Blob([...locals,central,end],{type:'application/zip'});
  }
  function formatBytes(bytes){
    const value=Number(bytes)||0;
    if(value<1024)return `${value} B`;
    if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;
    return `${(value/1024/1024).toFixed(value<10*1024*1024?1:0)} MB`;
  }

  window.V3Drive={
    loadSettings,saveSettings,clearFolderSettings,isConfigured,isConnected,connect,
    ensureFolders,uploadPackage,zip,formatBytes
  };
})();
