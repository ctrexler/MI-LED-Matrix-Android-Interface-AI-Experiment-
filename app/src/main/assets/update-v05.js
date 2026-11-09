"use strict";
// Version 0.5 extension; core editor and native transport remain in their original files.
const UPDATE_VERSION='0.5.0';
const baseNormalizeSource=normalizeSource,baseDrawPattern=drawPattern,baseShowPage=showPage,baseSetStatus=setStatus,baseReceiveBackup=receiveBackup;
const extraPatterns=['heart','star','circle','square','diamond','triangle','arrow','diamonds','dots','zigzag'];
let storedSlot=0,storageDraft=null,storageOrigin=null;
function palette(s){return Array.isArray(s.colors)&&s.colors.length?s.colors:[s.a,s.b];}
normalizeSource=function(s){
 if(!s||s.type!=='pattern')return baseNormalizeSource(s);
 let special=extraPatterns.includes(s.pattern),n=baseNormalizeSource({...s,pattern:special?'stripes':s.pattern});
 if(special)n.pattern=s.pattern;
 n.colors=Array.isArray(s.colors)?s.colors.slice(0,8):[n.a,n.b];
 if(n.colors.length<1||n.colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('Invalid palette');
 n.background=/^#[0-9a-f]{6}$/i.test(s.background||'')?s.background:'#000000';
 n.rotation=[0,90,180,270].includes(Number(s.rotation))?Number(s.rotation):0;
 n.tiled=!!s.tiled;n.outline=!!s.outline;n.spacing=Math.max(0,Math.min(32,Math.round(Number(s.spacing)||0)));
 n.size=Math.max(1,Math.min(64,Math.round(Number(s.size)||2)));return n;
};
function shapePath(x,k,r){
 x.beginPath();
 if(k==='circle')x.arc(0,0,r,0,Math.PI*2);
 else if(k==='heart'){x.moveTo(0,r*.85);x.bezierCurveTo(-r*1.6,-r*.1,-r*.9,-r*1.4,0,-r*.5);x.bezierCurveTo(r*.9,-r*1.4,r*1.6,-r*.1,0,r*.85);}
 else if(k==='star'){for(let i=0;i<10;i++){let a=-Math.PI/2+i*Math.PI/5,rad=i%2?r*.45:r;let px=Math.cos(a)*rad,py=Math.sin(a)*rad;if(i)x.lineTo(px,py);else x.moveTo(px,py);}}
 else if(k==='triangle'){x.moveTo(0,-r);x.lineTo(r,r);x.lineTo(-r,r);}
 else if(k==='diamond'){x.moveTo(0,-r);x.lineTo(r,0);x.lineTo(0,r);x.lineTo(-r,0);}
 else if(k==='arrow'){x.moveTo(0,-r);x.lineTo(r,0);x.lineTo(r*.4,0);x.lineTo(r*.4,r);x.lineTo(-r*.4,r);x.lineTo(-r*.4,0);x.lineTo(-r,0);}
 else x.rect(-r,-r,r*2,r*2);
 x.closePath();
}
drawPattern=function(s,w,h){
 if(!s.colors&&!extraPatterns.includes(s.pattern))return baseDrawPattern(s,w,h);
 let c=canvas(w,h),x=c.getContext('2d'),p=palette(s),size=Math.max(1,Math.round(s.size)),shapes=['heart','star','circle','square','diamond','triangle','arrow'];
 if(shapes.includes(s.pattern)||s.pattern==='dots'){
  x.fillStyle=s.background||'#000000';x.fillRect(0,0,w,h);let tiled=s.tiled||s.pattern==='dots',step=size+(s.spacing||0),points=[];
  if(tiled){for(let y=size/2;y<h;y+=Math.max(1,step))for(let z=size/2;z<w;z+=Math.max(1,step))points.push([z,y]);}else points=[[w/2,h/2]];
  points.forEach(([z,y],i)=>{x.save();x.translate(z,y);x.rotate((s.rotation||0)*Math.PI/180);shapePath(x,s.pattern==='dots'?'circle':s.pattern,Math.max(.5,size/2-.5));x.fillStyle=x.strokeStyle=p[i%p.length];x.lineWidth=s.thickness||1;if(s.outline)x.stroke();else x.fill();x.restore();});return c;
 }
 if(s.pattern==='gradient'){let coords=s.direction==='horizontal'?[0,0,w,0]:s.direction==='vertical'?[0,0,0,h]:s.direction==='antidiagonal'?[w,0,0,h]:[0,0,w,h],g=x.createLinearGradient(...coords);if(p.length===1){x.fillStyle=p[0];}else{p.forEach((color,i)=>g.addColorStop(i/(p.length-1),color));x.fillStyle=g;}x.fillRect(0,0,w,h);return c;}
 if(s.pattern==='solid'){x.fillStyle=p[0];x.fillRect(0,0,w,h);return c;}
 if(s.pattern==='border')return baseDrawPattern({...s,a:p[0],b:p[1]||p[0]},w,h);
 for(let y=0;y<h;y++)for(let z=0;z<w;z++){
  let n;
  if(s.pattern==='checker')n=Math.floor(y/size)+Math.floor(z/size);
  else if(s.pattern==='diamonds')n=Math.floor((Math.abs(z-(w-1)/2)+Math.abs(y-(h-1)/2))/size);
  else if(s.pattern==='zigzag')n=Math.floor((y+Math.abs((z%(size*4))-size*2))/size);
  else {let axis=s.direction==='vertical'?z:s.direction==='horizontal'?y:s.direction==='antidiagonal'?z-y+h:z+y;n=Math.floor(axis/size);}
  x.fillStyle=p[((n%p.length)+p.length)%p.length];x.fillRect(z,y,1,1);
 }return c;
};
// Keep the existing source editor; expose advanced editable parameters beside its controls.
const oldEditSource=editSource;
editSource=function(frame,target,isNew){
 let src=typeof target==='string'?frame.source:frame.panels[target];
 if(src&&src.type==='pattern'){advancedPattern(frame,target,isNew,src);return;}
 oldEditSource(frame,target,isNew);
 if(editorSession){let tools=el('div',undefined,'advancedPattern');tools.append(button('Use shapes / advanced patterns',()=>advancedPattern(frame,target,isNew,patternSpec())));$('sheetBody').prepend(tools);}
};
function advancedPattern(frame,target,isNew,source){
 openSheet('Shapes and multicolor patterns');let b=$('sheetBody'),s=normalizeSource(source),view=el('div',undefined,'wall miniPreview');
 const opts=[['solid','Solid'],['gradient','Gradient'],['checker','Checkerboard'],['stripes','Stripes'],['border','Border'],['diamonds','Diamond bands'],['zigzag','Zigzag stripes'],['dots','Dots'],['heart','Hearts'],['star','Stars'],['circle','Circles'],['square','Squares'],['diamond','Diamonds'],['triangle','Triangles'],['arrow','Arrows']];
 let type=select(opts,s.pattern),placement=select([['span','Span wall'],['repeat','Repeat on each display'],['0','Display 1'],['1','Display 2'],['2','Display 3'],['3','Display 4']],target);
 b.append(field('Pattern / shape',type),field('Placement',placement));let controls=el('div');b.append(controls,view);
 let advancedSession={advanced:true};editorSession=advancedSession;let revision=0,rendered=null;
 function candidate(){let f=clone(frame),dest=placement.value;if(dest==='span'||dest==='repeat'){f.mode=dest;f.source=clone(s);f.panels=[null,null,null,null];}else{if(typeof target==='string')f.panels=[null,null,null,null];else if(Number(dest)!==target)f.panels[target]=null;f.mode='panels';f.source=null;f.panels[Number(dest)]=clone(s);}return f;}
 async function refresh(){let rev=++revision;try{let f=candidate();await regenerate(f);if(rev!==revision||editorSession!==advancedSession)return;rendered=f;let w=makeWall(f,db.layout,false);view.style.gridTemplateColumns=w.style.gridTemplateColumns;view.replaceChildren(...Array.from(w.children));queueTiles(f.tiles);}catch(e){notify(e.message);}}
 function number(label,key,min,max){let n=document.createElement('input');n.type='number';n.min=min;n.max=max;n.value=s[key];n.oninput=()=>{s[key]=Math.max(min,Math.min(max,Math.round(Number(n.value)||min)));refresh();};controls.append(field(label,n));}
 function check(label,key){let n=document.createElement('input');n.type='checkbox';n.checked=!!s[key];n.onchange=()=>{s[key]=n.checked;if(key==='outline')rebuild();refresh();};controls.append(field(label,n));}
 function rebuild(){controls.replaceChildren();let shaped=['heart','star','circle','square','diamond','triangle','arrow','dots'].includes(s.pattern),colors=el('div',undefined,'colorRow');
  s.colors.forEach((color,i)=>{let n=document.createElement('input');n.type='color';n.value=color;n.oninput=()=>{s.colors[i]=n.value;s.a=s.colors[0];s.b=s.colors[1]||s.a;refresh();};colors.append(field('Color '+(i+1),n));});controls.append(colors);
  buttons(controls,[['Add color',()=>{if(s.colors.length<8){s.colors.push('#ffffff');rebuild();refresh();}}],['Remove last',()=>{if(s.colors.length>1){s.colors.pop();rebuild();refresh();}}]]);
  if(s.pattern==='solid')controls.append(hint('Solid uses the first palette color.'));if(s.pattern==='border')controls.append(hint('Border uses the first color inside and second color on the edge.'));
  if(shaped){let bg=document.createElement('input');bg.type='color';bg.value=s.background;bg.oninput=()=>{s.background=bg.value;refresh();};controls.append(field('Background',bg));let rot=select([[0,'Up / 0°'],[90,'Right / 90°'],[180,'Down / 180°'],[270,'Left / 270°']],s.rotation);rot.onchange=()=>{s.rotation=Number(rot.value);refresh();};controls.append(field('Direction / rotation',rot));check('Repeat shapes in a grid','tiled');check('Outline instead of filled','outline');number('Spacing (pixels)','spacing',0,32);}
  if(['gradient','stripes'].includes(s.pattern)){let d=select([['horizontal','Horizontal'],['vertical','Vertical'],['diagonal','Diagonal'],['antidiagonal','Opposite diagonal']],s.direction);d.onchange=()=>{s.direction=d.value;refresh();};controls.append(field('Direction',d));}
  if(!['solid','gradient'].includes(s.pattern))number(shaped?'Shape size (pixels)':'Pattern width (pixels)','size',1,64);
  if(s.outline||s.pattern==='border')number('Outline / border thickness','thickness',1,8);
 }
 type.onchange=()=>{s.pattern=type.value;rebuild();refresh();};placement.onchange=refresh;rebuild();
 buttons(b,[['Cancel',()=>{revision++;closeSheet(true);if(live)previewCurrent(true);}],['Done',async()=>{if(busy||working)return;working=true;try{let f=candidate();await regenerate(f);if(!isNew&&f.mode!=='panels'&&frame.mode==='panels'&&frame.panels.some((p,i)=>i!==target&&p)&&!confirm('Replace other panel images with this wall source?'))return;if(isNew){if(current.steps.length>=200)throw Error('Maximum 200 steps');current.steps.push(f);selected=current.steps.length-1;}else{let i=current.steps.findIndex(x=>x.id===f.id);if(i<0)throw Error('Step missing');current.steps[i]=f;selected=i;}revision++;working=false;closeSheet(false);changed();renderEditor();previewCurrent(true);}catch(e){notify(e.message);}finally{working=false;}},'primary']]);refresh();
}
function address(i){return db.assignments[i]||'';}
function record(i){return (db.stored||{})[address(i)]||{status:'unknown',images:[],updated:null};}
function statusText(r){return ({tracked:'Tracked (not read back)',partial:'Partially tracked',uncertain:'Uncertain — upload interrupted',unknown:'Contents unknown'})[r.status]||'Contents unknown';}
function ensureStorage(){if(!db.stored||typeof db.stored!=='object'||Array.isArray(db.stored))db.stored={};}
function destGrid(chosen,onChange,allowDisconnected=false){let g=el('div',undefined,'destinationGrid');g.style.gridTemplateColumns='repeat('+db.layout+',minmax(0,1fr))';for(let i=0;i<4;i++){let n=button('',()=>{if(chosen.has(i))chosen.delete(i);else chosen.add(i);draw();onChange&&onChange();},'destination');function draw(){n.classList.toggle('chosen',chosen.has(i));n.setAttribute('aria-pressed',String(chosen.has(i)));n.replaceChildren(el('strong','Display '+(i+1)),el('small',ready[i]?'Connected':states[i]),el('small',record(i).status==='unknown'?'Unknown':record(i).images.length+' tracked'));n.disabled=!allowDisconnected&&!ready[i];}draw();g.append(n);}return g;}
function chooseTargets(title,callback,extra){openSheet(title);let chosen=new Set(ready.flatMap((r,i)=>r?[i]:[])),b=$('sheetBody'),holder=el('div');function draw(){holder.replaceChildren(destGrid(chosen,draw));}b.append(hint('Select destinations. Only selected displays need to be connected. Spanning images keep their existing display sections.'),holder);draw();buttons(b,[['All connected',()=>{chosen=new Set(ready.flatMap((r,i)=>r?[i]:[]));draw();}],['Clear selection',()=>{chosen.clear();draw();}]]);if(extra)extra(b,()=>Array.from(chosen).sort());else buttons(b,[['Start selected slideshows',()=>{let ids=Array.from(chosen).sort();if(!ids.length)return notify('Select a connected display.');pausePlayback();setLive(false);closeSheet(false);Native.playSelected(JSON.stringify(ids));},'primary']]);}
function newSendPanel(){if(busy||working)return;if(!current.steps.length)return notify('Add a step first.');chooseTargets('Send stored slideshow',null,(b,getIds)=>{b.append(hint('Replace clears selected displays. Append keeps the existing device command sequence unchanged.'));buttons(b,[['Replace selected',()=>sendSelected(true,getIds()),'danger'],['Append to selected',()=>sendSelected(false,getIds())]]);});}
async function sendSelected(replace,ids,custom=null){
 if(busy||working)return;if(!ids.length||ids.some(i=>!ready[i]))return notify('Select at least one ready display.');
 if(!confirm((replace?'Erase and replace images on ':'Append images to ')+ids.map(i=>'Display '+(i+1)).join(', ')+(replace?'? This cannot be undone.':'?')))return;
 const frames=custom?null:clone(current.steps);closeSheet(false);flushDraft();pausePlayback();setBusy(true);let oldStored;
 try{let rows=[],per={};if(custom){for(let i of ids)per[i]=custom.map(t=>t||'');}else for(let i of ids)per[i]=frames.map(f=>f.tiles[i]||'');
  let count=per[ids[0]].length;if(count<1||count>200)throw Error('Use 1–200 images');
  for(let f=0;f<count;f++){let row=[null,null,null,null];for(let i of ids)row[i]=await rgbTile(per[i][f]);rows.push(row);}
  ensureStorage();oldStored=clone(db.stored);let pending={};for(let i of ids){let key=address(i);if(!key)throw Error('Assign Display '+(i+1)+' before uploading.');let previous=record(i),images=per[i].map((tile,k)=>({id:uid(),tile,name:'Image '+(k+1)}));let complete=replace||previous.status==='tracked';let list=replace?images:((previous.status==='tracked'||previous.status==='partial')?[...previous.images,...images]:images);pending[i]={key,desired:{status:complete?'tracked':'partial',images:list,updated:new Date().toISOString()}};db.stored[key]={...clone(previous),status:'uncertain',pending:pending[i].desired};}
  db.pendingStorage=pending;if(!store()){db.stored=oldStored;delete db.pendingStorage;throw Error('Could not save tracking journal; upload not started.');}
  progress(0,1);Native.upload(JSON.stringify({frames:rows,targets:ids}),replace);
 }catch(e){if(oldStored){db.stored=oldStored;delete db.pendingStorage;store();}setBusy(false);notify('Upload preparation failed: '+e.message);}
}
function storageDisplayComplete(i){ensureStorage();let entry=db.pendingStorage&&db.pendingStorage[i];if(entry){db.stored[entry.key]=entry.desired;delete db.pendingStorage[i];store();}if(page==='stored')renderStored();}
function storageUploadFinished(){delete db.pendingStorage;store();if(page==='stored')renderStored();}
function renderStored(){
 let out=$('storedContent');if(!out)return;out.replaceChildren();let chooser=el('div',undefined,'destinationGrid');chooser.style.gridTemplateColumns='repeat('+db.layout+',minmax(0,1fr))';
 for(let i=0;i<4;i++){let r=record(i),n=button('',()=>{if(storageDraft&&!confirm('Discard unapplied edits?'))return;storedSlot=i;storageDraft=null;renderStored();},'destination'+(i===storedSlot?' chosen':''));n.append(el('strong','Display '+(i+1)),el('small',ready[i]?'Connected':'Disconnected'),el('small',r.status==='unknown'?'Unknown':r.images.length+' tracked'));chooser.append(n);}out.append(chooser);
 let key=address(storedSlot),r=record(storedSlot);out.append(el('h2','Display '+(storedSlot+1)),hint(statusText(r)+(r.updated?' · '+new Date(r.updated).toLocaleString():'')),hint('App-maintained records, not device read-back. Changes from another controller are not detected. Unknown prior images cannot be recovered here.'));
 if(!key){out.append(hint('Assign a physical display in Displays first.'));return;}
 if(r.status==='uncertain')out.append(hint('The last transfer may have changed device contents. The list below is the previous record, not a verified current list. Rebuild from a complete collection to establish tracking.'));
 let images=storageDraft||r.images,bar=el('div',undefined,'row');out.append(bar);
 if(storageDraft){bar.append(button('Discard edits',()=>{storageDraft=null;renderStored();}),button('Apply to Display '+(storedSlot+1),()=>{if(!storageDraft.length)return notify('An empty draft cannot be uploaded. Keep at least one image.');if(!ready[storedSlot])return notify('Connect this display first.');let tiles=storageDraft.map(t=>t.tile),i=storedSlot;sendSelected(true,[i],tiles);storageDraft=null;renderStored();},'danger'),button('Add from library',addStoredFromLibrary));out.append(hint('Local draft only. Applying erases and rewrites this display’s complete stored list.'));
 }else{let edit=button('Edit collection',()=>{if(r.status!=='tracked'&&!confirm('This collection is not complete or certain. Applying an edited list will erase any other images on this display. Continue?'))return;storageDraft=clone(r.images);renderStored();});bar.append(edit,button('Add from library',()=>{if(r.status!=='tracked'&&!confirm('Build a replacement list? Any untracked images will be erased when you apply it.'))return;storageDraft=clone(r.images);addStoredFromLibrary();}),button('Start slideshow',()=>{if(!ready[storedSlot])return notify('Connect this display first.');setLive(false);Native.playSelected(JSON.stringify([storedSlot]));}));}
 let grid=el('div',undefined,'storedGrid');images.forEach((item,index)=>{let card=el('article',undefined,'storedCard'),preview=button('',()=>{openSheet('Image '+(index+1)+' · Display '+(storedSlot+1));let img=el('img',undefined,'storedLarge');img.src=item.tile||blackTile();img.alt='Stored image';$('sheetBody').append(img,hint(item.name||''));if(!storageDraft)buttons($('sheetBody'),[['Copy to another display',()=>copyStoredImage(item)]]);});let img=el('img');img.src=item.tile||blackTile();img.alt='Image '+(index+1);preview.append(img);card.append(preview,el('small',String(index+1)));
 if(storageDraft){let row=el('div',undefined,'row'),up=button('Earlier',()=>{[storageDraft[index-1],storageDraft[index]]=[storageDraft[index],storageDraft[index-1]];renderStored();}),down=button('Later',()=>{[storageDraft[index+1],storageDraft[index]]=[storageDraft[index],storageDraft[index+1]];renderStored();});up.disabled=index===0;down.disabled=index===images.length-1;row.append(up,down,button('Remove',()=>{storageDraft.splice(index,1);renderStored();},'danger'));card.append(row);}grid.append(card);});out.append(grid);if(!images.length)out.append(hint('No images tracked for this display. Existing device contents may still be present.'));
}
function blackTile(){return canvas(16,16).toDataURL('image/png');}
function addStoredFromLibrary(){if(busy||working)return;openSheet('Add from a saved sequence');let b=$('sheetBody');b.append(hint('Adds this display’s rendered tile from each sequence step to the local replacement draft.'));if(!db.sequences.length)b.append(hint('Save a sequence to Library first.'));for(let seq of db.sequences)b.append(button(seq.name+' · '+seq.steps.length+' images',()=>{if((storageDraft||[]).length+seq.steps.length>200)return notify('Maximum 200 images per rewritten collection.');storageDraft=storageDraft||[];storageDraft.push(...seq.steps.map((f,k)=>({id:uid(),tile:f.tiles[storedSlot]||'',name:seq.name+' / '+(k+1)})));closeSheet(false);renderStored();}));}
function copyStoredImage(item){openSheet('Copy image to a display draft');let b=$('sheetBody');for(let i=0;i<4;i++)if(i!==storedSlot){b.append(button('Display '+(i+1),()=>{let r=record(i);if(!address(i))return notify('Assign this display first.');if(r.images.length>=200)return notify('Destination already has 200 tracked images.');if(r.status!=='tracked'&&!confirm('Destination contents are not fully known. Applying its draft will replace all its device images. Continue?'))return;storedSlot=i;storageDraft=clone(r.images);storageDraft.push({...clone(item),id:uid()});closeSheet(false);showPage('stored');}));}}
function validStorage(value){let out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(let [key,r] of Object.entries(value)){if(!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(key)||!r||!Array.isArray(r.images)||r.images.length>10000)continue;let images=r.images.map(t=>{if(!t||!(t.tile===''||imageData(t.tile)))throw Error('Invalid tracked image');return {id:typeof t.id==='string'?t.id:uid(),tile:t.tile,name:typeof t.name==='string'?t.name.slice(0,150):'Image'};});out[key]={status:['tracked','partial','uncertain','unknown'].includes(r.status)?r.status:'unknown',images,updated:typeof r.updated==='string'?r.updated:null};}return out;}
function exportUpdated(){if(busy||working)return;flushDraft();Native.exportLibrary(JSON.stringify({version:3,appVersion:UPDATE_VERSION,layout:db.layout,previewSeconds:db.previewSeconds,defaults:db.defaults,sequences:db.sequences,draft:db.draft,stored:db.stored}));notify('Backup includes library, draft, and storage records keyed by display Bluetooth address. Assignments are not changed on import.');}
receiveBackup=async function(text){let v;try{v=JSON.parse(text);}catch(e){return baseReceiveBackup(text);}let before=db.sequences.length;await baseReceiveBackup(text);if(db.sequences.length<=before||!v.stored)return;try{let incoming=validStorage(v.stored);if(Object.keys(incoming).length&&confirm('Also import stored-image records? Imported records will be marked uncertain until you rebuild or check the physical displays. Existing records for matching addresses will be replaced.')){ensureStorage();for(let r of Object.values(incoming))r.status='uncertain';db.stored={...db.stored,...incoming};store();}}catch(e){notify('Sequences imported; storage records rejected: '+e.message);}};
showPage=function(p){if(page==='stored'&&p!=='stored'&&storageDraft){if(!confirm('Discard unapplied stored-image edits?'))return;storageDraft=null;}baseShowPage(p);if(p==='stored'){pausePlayback();$('pageTitle').textContent='Stored Images';renderStored();}if(p==='about')$('pageTitle').textContent='About';};
setStatus=function(i,text,isReady=false){baseSetStatus(i,text,isReady);if(page==='stored')renderStored();};
function capture(id,action){$(id).addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();action();},true);}
function mountUpdate(){
 ensureStorage();try{let saved=JSON.parse(Native.load());db.stored=validStorage(saved.stored);if(saved.pendingStorage){for(let item of Object.values(saved.pendingStorage))if(item&&db.stored[item.key])db.stored[item.key].status='uncertain';}}catch(e){log('Storage tracking load: '+e.message);}
 let drawer=$('drawer');drawer.querySelector('h2').textContent='LED Matrix Controller';for(let [id,title] of [['stored','Stored Images'],['about','About']]){let n=button(title,()=>showPage(id));n.dataset.page=id;drawer.insertBefore(n,drawer.querySelector('p'));}
 let main=document.querySelector('main'),stored=el('section',undefined,'page');stored.id='stored';stored.hidden=true;stored.append(el('h1','Stored Images'));let content=el('div',undefined,'scrollArea');content.id='storedContent';stored.append(content);main.append(stored);
 let about=el('section',undefined,'page');about.id='about';about.hidden=true;let text=el('div',undefined,'scrollArea aboutContent');text.innerHTML='<h1>LED Matrix Controller</h1><p>Version 0.5.0 · Selected displays and collections</p><h2>About</h2><p>An experimental Android controller for up to four Merkury Innovations multicolor matrix LED displays. Create image sequences, patterns and shapes; preview temporarily or upload stored slideshows.</p><h2>Using the app</h2><p>Assign displays in Displays and choose their physical arrangement. Slots run left to right, then top to bottom. Use Editor to compose, and Save to keep named sequences in Library. Live Preview sends temporary images; it does not add them to stored collections.</p><p>Send to displays lets you choose connected destinations. Replace erases only those destinations. Append uses the existing storage commands and timing. Start stored slideshow lets you choose destinations independently.</p><h2>Stored Images</h2><p>These are app-maintained records, not verified device read-back. Older contents and changes made elsewhere are unknown. Partial means prior images were not known. Uncertain means a transfer may have stopped partway. Editing creates a local draft; Apply clears and rewrites that display. No individual-device delete or reorder protocol is assumed.</p><h2>Privacy and backups</h2><p>Library and storage records are saved on your phone. Backups now include Bluetooth addresses used to associate stored-image records with physical displays. Keep backups private. Export before uninstalling; an APK signed with a different key cannot update an existing installation directly.</p><h2>Version history</h2><h3>0.5.0 — November 7, 2026</h3><ul><li>New app name and supplied launcher icon.</li><li>Layout-matching upload and playback destination selection.</li><li>Per-display tracked collections, draft editing, copying and rebuilding.</li><li>Shapes, diamond bands, zigzags, dots and editable multicolor palettes.</li><li>About page and version history.</li><li>Existing Append command sequence, storage timing, startup diagnostics and gated playback starts retained.</li></ul><h3>0.4-live-patterns — supplied baseline</h3><p>Image and pattern editor, spanning/repeated/independent sources, layout changes, library and drafts, backups, Live Preview, per-device serial Bluetooth lanes and coordinated stored-playback starts. Diagnostic launcher included. Release date not established.</p><h2>Limitations</h2><p>Live Preview speed and cross-display synchronization depend on hardware and connection timing. Stored collections are not automatically readable from the devices. This update has not been hardware-tested by its author.</p>';
 about.append(text);main.append(about);document.title='LED Matrix Controller';
 let shortcut=button('View stored images',()=>showPage('stored'),'storedShortcut');document.querySelector('#editor footer').append(shortcut);
 capture('sendBtn',newSendPanel);capture('storedPlayBtn',()=>{if(!busy&&!working)chooseTargets('Start stored slideshow');});capture('exportBtn',exportUpdated);
 log('LED Matrix Controller 0.5.0 loaded. Existing Append packet sequence retained.');
}
init();
mountUpdate();
