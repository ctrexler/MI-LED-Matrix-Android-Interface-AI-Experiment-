"use strict";
const $=id=>document.getElementById(id);
let db={version:1,sequences:[],assignments:['','','','']};
try{const saved=JSON.parse(Native.load());if(saved.version===1&&Array.isArray(saved.sequences))db=saved;}catch(e){}
let current=fresh(),step=0,timer=null,busy=false,importing=false,scanSlot=0;
function fresh(){return {id:'',name:'New sequence',cols:2,steps:[{seconds:2,tiles:['','','','']}]};}
function clone(x){return JSON.parse(JSON.stringify(x));}
function log(s){$('log').textContent=(new Date().toLocaleTimeString()+' '+s+'\n'+$('log').textContent).slice(0,60000);}
function notify(s){$('notice').textContent=s;log(s);}
function persist(){let error=Native.save(JSON.stringify(db));if(error){alert('Save failed: '+error);return false;}return true;}
function show(id){['editor','library','devices','logs'].forEach(x=>$(x).hidden=x!==id);}
function progress(done,total){$('progress').max=total;$('progress').value=done;}
function setBusy(value){busy=value;document.querySelectorAll('section button,section input,section select').forEach(e=>e.disabled=value);$('cancel').disabled=!value;}
function capture(){current.name=$('name').value.trim()||'Untitled';let n=Number($('duration').value);current.steps[step].seconds=Number.isFinite(n)?Math.max(.1,Math.min(3600,n)):2;}
function render(){
 $('name').value=current.name;$('layout').value=current.cols;$('duration').value=current.steps[step].seconds;
 $('stepLabel').textContent='Step '+(step+1)+' of '+current.steps.length;
 $('wall').style.gridTemplateColumns='repeat('+current.cols+',minmax(0,1fr))';$('wall').replaceChildren();
 current.steps[step].tiles.forEach((src,i)=>{let tile=document.createElement('div');tile.className='tile';let title=document.createElement('div');title.textContent='Display '+(i+1);tile.append(title);let img=document.createElement('img');if(src)img.src=src;else img.alt='Black / empty';tile.append(img);let label=document.createElement('label');label.textContent='Import image';let input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=e=>importImage(e,i);label.append(input);tile.append(label);let b=document.createElement('button');b.textContent='Clear';b.onclick=()=>{stopPreview();current.steps[step].tiles[i]='';render();};tile.append(b);$('wall').append(tile);});
 if(busy)setBusy(true);
}
function changeLayout(){stopPreview();current.cols=Number($('layout').value);render();}
function navigate(d){stopPreview();capture();step=(step+d+current.steps.length)%current.steps.length;render();}
function addStep(copy){if(current.steps.length>=200)return alert('Maximum 200 steps per sequence.');stopPreview();capture();let item=copy?clone(current.steps[step]):{seconds:2,tiles:['','','','']};current.steps.splice(++step,0,item);render();}
function deleteStep(){if(current.steps.length===1)return alert('Keep at least one step.');if(!confirm('Delete this step?'))return;stopPreview();current.steps.splice(step,1);step=Math.min(step,current.steps.length-1);render();}
function moveStep(d){stopPreview();capture();let dest=step+d;if(dest<0||dest>=current.steps.length)return;[current.steps[step],current.steps[dest]]=[current.steps[dest],current.steps[step]];step=dest;render();}
function clearStep(){if(confirm('Clear all four images in this step?')){stopPreview();current.steps[step].tiles=['','','',''];render();}}
function fitted(img,w,h,fit){let c=document.createElement('canvas');c.width=w;c.height=h;let ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,w,h);ctx.imageSmoothingEnabled=false;
 if(fit==='stretch')ctx.drawImage(img,0,0,w,h);else{let scale=(fit==='cover'?Math.max:Math.min)(w/img.width,h/img.height);let iw=Math.max(1,Math.round(img.width*scale)),ih=Math.max(1,Math.round(img.height*scale));ctx.drawImage(img,Math.floor((w-iw)/2),Math.floor((h-ih)/2),iw,ih);}return c;}
function loadImage(src){return new Promise((ok,no)=>{let img=new Image();img.onload=()=>ok(img);img.onerror=()=>no(Error('Cannot decode image'));img.src=src;});}
async function importImage(event,target){
 let file=event.target.files[0];if(!file)return;if(busy||importing)return alert('Wait for the current operation.');if(file.size>20*1024*1024)return alert('Use an image under 20 MB.');
 stopPreview();capture();importing=true;let destination=current.steps[step],owner=current,cols=current.cols,fit=$('fit').value;
 try{let data=await new Promise((ok,no)=>{let r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file);});let image=await loadImage(data);
 if(owner!==current)throw Error('Sequence changed during import. Retry.');
 if(target>=0)destination.tiles[target]=fitted(image,16,16,fit).toDataURL('image/png');
 else{let wall=fitted(image,16*cols,16*(4/cols),fit);for(let i=0;i<4;i++){let c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d').drawImage(wall,(i%cols)*16,Math.floor(i/cols)*16,16,16,0,0,16,16);destination.tiles[i]=c.toDataURL('image/png');}}
 render();notify('Image imported. Save sequence to keep it.');
 }catch(e){alert('Import failed: '+e.message);}finally{importing=false;event.target.value='';}
}
function saveSequence(){if(importing)return alert('Wait for image import.');capture();let old=clone(db.sequences);if(!current.id)current.id=uid();let i=db.sequences.findIndex(s=>s.id===current.id);if(i<0)db.sequences.push(clone(current));else db.sequences[i]=clone(current);if(persist())notify('Saved locally, including image copies.');else db.sequences=old;}
function uid(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function newSequence(){if(importing||busy)return;if(!confirm('Start a new sequence? Unsaved changes will be lost.'))return;stopPreview();current=fresh();step=0;render();show('editor');}
function renderLibrary(){let list=$('saved');list.replaceChildren();if(!db.sequences.length){list.textContent='No saved sequences yet.';return;}db.sequences.forEach(s=>{let card=document.createElement('div');card.className='card';let title=document.createElement('h3');title.textContent=s.name;card.append(title);s.steps[0].tiles.forEach(src=>{if(src){let img=document.createElement('img');img.className='thumb';img.src=src;card.append(img);}});let p=document.createElement('p');p.textContent=s.steps.length+' steps';card.append(p);
 [['Open',()=>{if(importing||!confirm('Open saved sequence? Unsaved changes will be lost.'))return;stopPreview();current=clone(s);step=0;render();show('editor');}],['Duplicate',()=>{let copy=clone(s);copy.id=uid();copy.name+=' (copy)';let old=clone(db.sequences);db.sequences.push(copy);if(!persist())db.sequences=old;renderLibrary();}],['Rename',()=>{let name=prompt('Sequence name',s.name);if(name&&name.trim()){let old=s.name;s.name=name.trim().slice(0,100);if(!persist())s.name=old;renderLibrary();}}],['Delete',()=>{if(confirm('Delete '+s.name+'?')){let old=db.sequences;db.sequences=db.sequences.filter(x=>x.id!==s.id);if(!persist())db.sequences=old;renderLibrary();}}]].forEach(([text,fn])=>{let b=document.createElement('button');b.textContent=text;b.disabled=busy;b.onclick=fn;card.append(b);});list.append(card);});}
function startPreview(){stopPreview();capture();notify('Phone preview running; no Bluetooth commands sent.');function tick(){render();timer=setTimeout(()=>{if(step===current.steps.length-1&&!$('loop').checked){stopPreview();return;}step=(step+1)%current.steps.length;tick();},current.steps[step].seconds*1000);}tick();}
function stopPreview(){if(timer!==null)clearTimeout(timer);timer=null;}
function renderAssignments(){let out=$('assignments');out.replaceChildren();for(let i=0;i<4;i++){let card=document.createElement('div');card.className='card';let label=document.createElement('p');label.textContent='Display '+(i+1)+': '+(db.assignments[i]||'Not assigned');card.append(label);let state=document.createElement('p');state.id='status'+i;state.textContent='Not connected / status refreshed on connect';card.append(state);let b=document.createElement('button');b.textContent='Scan / assign';b.onclick=()=>{scanSlot=i;Native.scan(i);};card.append(b);let forget=document.createElement('button');forget.textContent='Forget';forget.onclick=()=>{Native.disconnect();db.assignments[i]='';persist();renderAssignments();};card.append(forget);out.append(card);}}
function clearDevices(){$('discovered').replaceChildren();}
function deviceFound(address,name){let b=document.createElement('button');b.textContent=name+' '+address;b.onclick=()=>{if(busy)return;if(db.assignments.some((a,i)=>i!==scanSlot&&a===address))return alert('Already assigned to another display slot.');db.assignments[scanSlot]=address;persist();renderAssignments();Native.connectDisplay(scanSlot,address);clearDevices();};$('discovered').append(b);}
function setStatus(i,text){let el=$('status'+i);if(el)el.textContent=text;}
function reconnect(){if(busy)return;db.assignments.forEach((a,i)=>{if(a)Native.connectDisplay(i,a);});log('Reconnect requested. Wait until all four say Ready.');}
async function upload(replace){
 if(busy||importing)return;stopPreview();capture();
 if(!confirm(replace?'Erase all stored images on ALL FOUR displays, then upload this sequence? This cannot be undone.':'Append this sequence to ALL FOUR displays? Existing image lists may differ; device storage capacity is not known.'))return;
 setBusy(true);notify('Preparing all four images for every step before changing device storage...');
 try{let snapshot=clone(current),frames=[];
 for(let item of snapshot.steps){let row=[];for(let src of item.tiles){let c=document.createElement('canvas');c.width=c.height=16;let ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,16,16);if(src){let image=await loadImage(src);ctx.drawImage(image,0,0,16,16);}let rgba=ctx.getImageData(0,0,16,16).data;let bytes='';for(let i=0;i<256;i++)bytes+=String.fromCharCode(rgba[4*i],rgba[4*i+1],rgba[4*i+2]);row.push(btoa(bytes));}frames.push(row);}
 progress(0,1);Native.upload(JSON.stringify({frames}),replace);
 }catch(e){setBusy(false);notify('Preparation failed: '+e.message);}
}
function exportLibrary(){if(importing||busy)return;Native.exportLibrary(JSON.stringify({version:1,sequences:db.sequences}));log('Export includes saved sequences only. Save current edits first. Bluetooth addresses are excluded.');}
function validateBackup(v){
 if(!v||v.version!==1||!Array.isArray(v.sequences)||v.sequences.length>500)throw Error('Unsupported backup');
 return v.sequences.map(s=>{if(typeof s.name!=='string'||![1,2,4].includes(s.cols)||!Array.isArray(s.steps)||s.steps.length<1||s.steps.length>200)throw Error('Invalid sequence');return {id:uid(),name:s.name.slice(0,100),cols:s.cols,steps:s.steps.map(k=>{if(!Array.isArray(k.tiles)||k.tiles.length!==4||!Number.isFinite(k.seconds)||k.seconds<.1||k.seconds>3600)throw Error('Invalid step');return {seconds:k.seconds,tiles:k.tiles.map(t=>{if(typeof t!=='string'||(t!==''&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(t))||t.length>100000)throw Error('Invalid image');return t;})};})};});
}
function receiveBackup(text){if(busy||importing)return alert('Finish the current operation before importing.');try{let sequences=validateBackup(JSON.parse(text));if(!confirm('Add '+sequences.length+' sequence(s) to your library? Existing sequences will remain.'))return;let old=clone(db.sequences);db.sequences.push(...sequences);if(!persist())db.sequences=old;renderLibrary();show('library');}catch(e){alert('Backup import failed: '+e.message);}}
render();renderAssignments();setBusy(false);log('Controller ready. Connect and test with a short sequence first.');
