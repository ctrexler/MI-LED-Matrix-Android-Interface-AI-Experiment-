"use strict";
const APP_VERSION='0.5.7';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x)),uid=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
let db={version:3,sequences:[],assignments:['','','',''],layout:2,defaults:{fit:'contain',smooth:false},calibration:{gamma:2.2,cutoff:0,brightness:100},previewSeconds:1.5,draft:null,stored:{}};
let current,selected=0,dirty=true,page='editor',busy=false,working=false,live=false,editorSession=null,pickerCallback=null,scanSlot=0,scanSession=false,saveTimer=null;
let states=['Not connected','Not connected','Not connected','Not connected'],ready=[false,false,false,false];
let playback=null,playTimer=null,frameEpoch=0,liveTimer=null,pendingTiles=[undefined,undefined,undefined,undefined],lastTiles=[undefined,undefined,undefined,undefined],liveVersions=[0,0,0,0];
let storedSlot=0,storageDraft=null,fastUpload=true;
const imageCache=new Map();
const extraPatterns=['heart','star','circle','square','diamond','triangle','arrow','diamonds','dots','zigzag'];

const blankFrame=()=>({id:uid(),mode:'panels',source:null,panels:[null,null,null,null],tiles:['','','',''],bgMode:'none',bgSource:null,bgPanels:[null,null,null,null]});
const blankSequence=()=>({id:uid(),name:'New sequence',cols:db.layout,steps:[],gifGroups:{}});
const imageSpec=(src,fit=db.defaults.fit)=>({type:'image',src,fit,smooth:db.defaults.smooth,alignX:0.5,alignY:0.5});
const patternSpec=()=>({type:'pattern',pattern:'gradient',a:'#ff3377',b:'#3377ff',colors:['#ff3377','#3377ff'],background:'#000000',direction:'diagonal',size:4,thickness:1,rotation:0,tiled:false,outline:false,spacing:0,cycle:false});
const imageData=t=>typeof t==='string'&&t.length<=24_000_000&&/^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=]+$/.test(t);
const isColor=c=>c==='transparent'||(typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c));
function palette(s){return Array.isArray(s.colors)&&s.colors.length?s.colors:[s.a||'#ff3377',s.b||'#3377ff'];}

function normalizeSource(s){
 if(s==null)return null;
 if(typeof s!=='object')throw Error('Invalid image source');
 if(s.type==='pattern'){
  const validPatterns=['solid','gradient','checker','stripes','border','diamonds','zigzag','dots','heart','star','circle','square','diamond','triangle','arrow'];
  if(!validPatterns.includes(s.pattern))throw Error('Invalid pattern');
  let colors=Array.isArray(s.colors)?s.colors.slice(0,8):[s.a||'#ff3377',s.b||'#3377ff'];
  if(colors.length<1||colors.some(c=>!isColor(c)))throw Error('Invalid palette');
  let a=isColor(s.a)?s.a:colors[0];
  let b=isColor(s.b)?s.b:(colors[1]||colors[0]);
  let background=isColor(s.background)?s.background:'#000000';
  let direction=['horizontal','vertical','diagonal','antidiagonal'].includes(s.direction)?s.direction:'diagonal';
  let rotation=[0,90,180,270].includes(Number(s.rotation))?Number(s.rotation):0;
  let tiled=!!s.tiled;
  let outline=!!s.outline;
  let cycle=!!s.cycle;
  let spacing=Math.max(0,Math.min(32,Math.round(Number(s.spacing)||0)));
  let size=Math.max(1,Math.min(64,Math.round(Number(s.size)||4)));
  let thickness=Math.max(1,Math.min(8,Number(s.thickness)||1));
  return {type:'pattern',pattern:s.pattern,a,b,colors,background,direction,rotation,tiled,outline,cycle,spacing,size,thickness};
 }
 if(!imageData(s.src)||!['contain','cover','stretch','actual'].includes(s.fit)||typeof s.smooth!=='boolean')throw Error('Invalid image');
 let alignX=Number.isFinite(s.alignX)?Math.max(0,Math.min(1,s.alignX)):0.5;
 let alignY=Number.isFinite(s.alignY)?Math.max(0,Math.min(1,s.alignY)):0.5;
 let img={type:'image',src:s.src,fit:s.fit,smooth:s.smooth,alignX,alignY};
 if(typeof s.gifGroupId==='string')img.gifGroupId=s.gifGroupId;
 if(typeof s.gifFrameId==='string')img.gifFrameId=s.gifFrameId;
 return img;
}

function normalizeSequence(s){
 if(!s||typeof s.name!=='string'||!Array.isArray(s.steps)||s.steps.length>200)throw Error('Invalid sequence');
 let cols=[1,2,4].includes(s.cols)?s.cols:2;
 let gifGroups={};
 if(s.gifGroups&&typeof s.gifGroups==='object'&&!Array.isArray(s.gifGroups)){
  for(let [gid,g] of Object.entries(s.gifGroups)){
   if(!g||typeof g!=='object'||!Array.isArray(g.frames)||g.frames.length>25)continue;
   let target=(g.target==='span'||g.target==='repeat')?g.target:([0,1,2,3].includes(Number(g.target))?Number(g.target):'span');
   let fit=['contain','cover','stretch','actual'].includes(g.fit)?g.fit:'contain';
   let alignX=Number.isFinite(g.alignX)?Math.max(0,Math.min(1,g.alignX)):0.5;
   let alignY=Number.isFinite(g.alignY)?Math.max(0,Math.min(1,g.alignY)):0.5;
   let layer=g.layer==='bg'?'bg':'fg';
   let frames=g.frames.filter(fr=>fr&&typeof fr==='object'&&imageData(fr.src)).map(fr=>({id:typeof fr.id==='string'?fr.id:uid(),src:fr.src,deleted:!!fr.deleted}));
   if(frames.length)gifGroups[gid]={id:gid,target,layer,fit,smooth:!!g.smooth,alignX,alignY,frames};
  }
 }
 return {id:typeof s.id==='string'?s.id:uid(),name:s.name.slice(0,100),cols,gifGroups,steps:s.steps.map(f=>{
  if(!f||!Array.isArray(f.tiles)||f.tiles.length!==4||f.tiles.some(t=>t!==''&&!imageData(t)))throw Error('Invalid rendered tiles');
  if(!f.mode&&!f.kind)return {id:uid(),mode:'panels',source:null,panels:f.tiles.map(t=>t?{type:'image',src:t,fit:'contain',smooth:false}:null),tiles:f.tiles.slice(),bgMode:'none',bgSource:null,bgPanels:[null,null,null,null]};
  let mode=f.mode||(f.kind==='wall'?'span':'panels');
  if(!['span','repeat','panels'].includes(mode)||!Array.isArray(f.panels)||f.panels.length!==4)throw Error('Invalid step mode');
  let source=normalizeSource(f.source||f.wall),panels=f.panels.map(normalizeSource);
  if(mode!=='panels'&&!source)throw Error('Missing source');
  let bgMode=['none','span','repeat','panels'].includes(f.bgMode)?f.bgMode:'none';
  let bgSource=bgMode==='span'||bgMode==='repeat'?normalizeSource(f.bgSource):null;
  let bgPanels=Array.isArray(f.bgPanels)&&f.bgPanels.length===4?f.bgPanels.map(normalizeSource):[null,null,null,null];
  if((bgMode==='span'||bgMode==='repeat')&&!bgSource)bgMode='none';
  return {id:typeof f.id==='string'?f.id:uid(),mode,source,panels,tiles:f.tiles.slice(),bgMode,bgSource,bgPanels};
 })};
}

function log(s){$('log').textContent=(new Date().toLocaleTimeString()+' '+s+'\n'+$('log').textContent).slice(0,65000);}
function notify(s){$('notice').textContent=s;log(s);}
function store(){let error=Native.save(JSON.stringify(db));if(error){$('saveState').textContent='Save failed — export';log(error);return false;}return true;}
function updateSaveState(){$('saveState').textContent=dirty?'Draft saved · Save to library':'Saved to library';}
function flushDraft(){clearTimeout(saveTimer);if(!current)return;db.draft={sequence:clone(current),selected,dirty};if(store())updateSaveState();}
function draftSoon(){clearTimeout(saveTimer);$('saveState').textContent='Saving draft…';saveTimer=setTimeout(flushDraft,650);}
function changed(){dirty=true;draftSoon();}

function el(tag,text,cls){let n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(text,fn,cls){let b=el('button',text,cls);b.type='button';b.onclick=fn;return b;}
function hint(t){return el('p',t,'hint');}
function buttons(parent,items){let row=el('div',undefined,'sheetButtons');for(let [text,fn,cls] of items)row.append(button(text,fn,cls));parent.append(row);return row;}
function field(text,node){let l=el('label',text,'field');l.append(node);return l;}
function select(options,value){let n=document.createElement('select');for(let [v,t] of options){let o=el('option',t);o.value=v;n.append(o);}n.value=String(value);return n;}

function showPage(p){
 if(page==='stored'&&p!=='stored'&&storageDraft){if(!confirm('Discard unapplied stored-image edits?'))return;storageDraft=null;}
 if(page==='editor')flushDraft();
 if(playback&&playback.kind==='editor'&&p!=='editor')pausePlayback();
 page=p;
 document.querySelectorAll('.page').forEach(n=>n.hidden=n.id!==p);
 $('pageTitle').textContent={editor:'Editor',library:'Library',devices:'Displays',logs:'Logs',stored:'Stored Images',about:'About'}[p]||'LED Matrix Controller';
 $('saveBtn').hidden=p!=='editor';
 closeDrawer();
 if(p==='library')renderLibrary();
 if(p==='stored'){pausePlayback();renderStored();}
}

function openDrawer(){if(!$('sheet').hidden)return;$('drawer').hidden=$('drawerShade').hidden=false;$('menuBtn').setAttribute('aria-expanded','true');document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('drawer').querySelector('button').focus();}
function closeDrawer(){$('drawer').hidden=$('drawerShade').hidden=true;$('menuBtn').setAttribute('aria-expanded','false');}
function openSheet(title){pausePlayback();if(scanSession){Native.stopScanNow();scanSession=false;}closeDrawer();editorSession=null;$('sheetTitle').textContent=title;$('sheetBody').replaceChildren();$('sheet').hidden=$('sheetShade').hidden=false;$('sheet').focus();}
function closeSheet(restore=true){if(working)return;if(scanSession){Native.stopScanNow();scanSession=false;}let wasEdit=!!editorSession;editorSession=null;frameEpoch++;$('sheet').hidden=$('sheetShade').hidden=true;if(wasEdit&&restore&&live)previewCurrent(true);}
function handleBack(){if(!$('sheet').hidden){closeSheet();return true;}if(!$('drawer').hidden){closeDrawer();return true;}if(page!=='editor'){showPage('editor');return true;}flushDraft();return false;}

function makeWall(frame,cols=2,interactive=true){
 let wall=el('div',undefined,'wall');wall.style.gridTemplateColumns='repeat('+cols+',minmax(0,1fr))';
 for(let i=0;i<4;i++){
  let t=el(interactive?'button':'div',undefined,'tile'+(!frame||!frame.tiles[i]?' empty':''));
  t.dataset.panel=i;
  if(interactive){t.type='button';t.setAttribute('aria-label','Display '+(i+1));}
  if(frame&&frame.tiles[i]){let img=document.createElement('img');img.src=frame.tiles[i];img.alt='';img.draggable=false;t.append(img);}
  wall.append(t);
 }
 return wall;
}

function toggleEditorView(){
 db.editorView=(db.editorView==='separate')?'all':'separate';
 store();
 updateViewToggleBtn();
 renderGrid();
}

function updateViewToggleBtn(){
 let btn=$('viewToggleBtn');
 if(!btn)return;
 let isSeparate=db.editorView==='separate';
 btn.textContent=isSeparate?'☰ One per line':'🔲 All together';
 btn.title=isSeparate?'Viewing each display on its own line. Click to view all displays together.':'Viewing all displays together in each card. Click to view each display on its own line.';
}

function renderGrid(){
 let g=$('storyboard'),scroll=g.scrollTop;g.replaceChildren();
 updateViewToggleBtn();
 if(db.editorView==='separate'){
  g.className='storyboard viewLanes';
  let lanesContainer=el('div',undefined,'lanesContainer');
  let trackElements=[];
  for(let d=0;d<4;d++){
   let lane=el('div',undefined,'displayLane');
   let header=el('div',undefined,'laneHeader');
   let title=el('strong','Display '+(d+1));
   let status=el('span',ready[d]?'● Ready':(db.assignments[d]?'Assigned':'Off'),'laneStatus'+(ready[d]?' ready':''));
   header.append(title,status);
   let track=el('div',undefined,'laneTrack');
   trackElements.push(track);
   current.steps.forEach((f,i)=>{
    let card=el('div',undefined,'laneCard stepCard'+(i===selected?' selected':'')+(playback&&playback.kind==='editor'&&i===selected?' playing':''));
    card.dataset.id=f.id;card.tabIndex=0;card.setAttribute('aria-label','Step '+(i+1)+' Display '+(d+1));
    let top=el('div',undefined,'laneCardTop');
    top.append(el('small','#'+(i+1)));
    let tileBox=el('div',undefined,'laneTile'+(!f.tiles[d]?' empty':''));
    if(f.tiles[d]){
     let img=document.createElement('img');img.src=f.tiles[d];img.alt='';img.draggable=false;tileBox.append(img);
    }
    card.append(top,tileBox);
    card.onpointerdown=e=>dragStart(e,card);
    card.onclick=e=>{
     if(suppressClick||busy||working)return;
     if(selected===i){openSource(f.id,d);}
     else{pausePlayback();selected=i;renderGrid();renderPreview();draftSoon();previewCurrent();}
    };
    card.onkeydown=e=>{if(e.key==='Enter'&&e.target===card){selected=i;openSource(f.id,d);}};
    track.append(card);
   });
   let add=button('+',addStep,'laneAddCard');
   add.title='Add step';add.disabled=busy||working;
   track.append(add);
   lane.append(header,track);
   lanesContainer.append(lane);
  }
  let syncing=false;
  trackElements.forEach(track=>{
   track.onscroll=()=>{
    if(syncing)return;
    syncing=true;
    let pos=track.scrollLeft;
    trackElements.forEach(t=>{if(t!==track)t.scrollLeft=pos;});
    syncing=false;
   };
  });
  g.append(lanesContainer);
 }else{
  g.className='storyboard';
  current.steps.forEach((f,i)=>{
   let card=el('div',undefined,'stepCard'+(i===selected?' selected':'')+(playback&&playback.kind==='editor'&&i===selected?' playing':''));
   card.dataset.id=f.id;card.tabIndex=0;card.setAttribute('aria-label','Step '+(i+1)+'. Enter for options. Hold to reorder.');
   let top=el('div',undefined,'cardTop');top.append(el('span',String(i+1)),el('span',f.mode==='panels'?'Panels':f.mode==='repeat'?'Repeat':'Spanning'));
   card.append(top,makeWall(f,db.layout));
   card.onpointerdown=e=>dragStart(e,card);
   card.onclick=e=>{
    if(suppressClick||busy||working)return;pausePlayback();selected=i;renderGrid();renderPreview();draftSoon();previewCurrent();
    let panel=e.target.closest('[data-panel]');if(panel)openSource(f.id,Number(panel.dataset.panel));else stepOptions(f.id);
   };
   card.onkeydown=e=>{if(e.key==='Enter'&&e.target===card){selected=i;stepOptions(f.id);}};
   g.append(card);
  });
  let add=button('',addStep,'addCard');add.id='addCard';add.append(el('span','+'),el('small','Add step'));add.disabled=busy||working;g.append(add);g.scrollTop=scroll;
 }
 $('count').textContent=current.steps.length+'/200';
}

function renderPreview(){
 let f=current.steps[selected],w=makeWall(f,db.layout);
 $('largePreview').replaceChildren(...Array.from(w.children));
 $('largePreview').style.gridTemplateColumns=w.style.gridTemplateColumns;
 $('position').textContent=f?'Step '+(selected+1)+' / '+current.steps.length:'No steps';
 $('speed').textContent=db.previewSeconds.toFixed(1)+' s';
 $('playBtn').textContent=playback&&playback.kind==='editor'?'Pause':'Play';
 $('liveToggle').checked=live;
 $('liveState').textContent=busy?'Live suspended for transfer':live?'Live on · '+ready.filter(Boolean).length+'/4 ready':'Displays off · phone only';
}

function renderEditor(){$('sequenceName').value=current.name;renderGrid();renderPreview();}
function canvas(w,h,transparent=false){let c=document.createElement('canvas');c.width=w;c.height=h;if(!transparent){let x=c.getContext('2d');x.fillStyle='black';x.fillRect(0,0,w,h);}return c;}
function blackTile(){return canvas(16,16).toDataURL('image/png');}

function loadImage(src){
 if(imageCache.has(src))return imageCache.get(src);
 let p=new Promise((ok,no)=>{let i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(Error('Cannot decode image'));i.src=src;});
 imageCache.set(src,p);
 if(imageCache.size>12)imageCache.delete(imageCache.keys().next().value);
 return p;
}

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

function rotatedPalette(s,stepOffset=0){
 let p=palette(s);
 if(s.cycle&&stepOffset>0&&p.length>1){let r=((stepOffset%p.length)+p.length)%p.length;p=p.slice(r).concat(p.slice(0,r));}
 return p;
}

function drawPattern(s,w,h,stepOffset=0,transparent=false){
 let c=canvas(w,h,transparent),x=c.getContext('2d'),p=rotatedPalette(s,stepOffset),size=Math.max(1,Math.round(s.size||4));
 let shapes=['heart','star','circle','square','diamond','triangle','arrow'];
 if(shapes.includes(s.pattern)||s.pattern==='dots'){
  if(s.background!=='transparent'){x.fillStyle=s.background||'#000000';x.fillRect(0,0,w,h);}
  let tiled=s.tiled||s.pattern==='dots',step=size+(s.spacing||0),points=[];
  if(tiled){for(let y=size/2;y<h;y+=Math.max(1,step))for(let z=size/2;z<w;z+=Math.max(1,step))points.push([z,y]);}
  else points=[[w/2,h/2]];
  points.forEach(([z,y],i)=>{
   let col=p[i%p.length];
   x.save();x.translate(z,y);x.rotate((s.rotation||0)*Math.PI/180);
   shapePath(x,s.pattern==='dots'?'circle':s.pattern,Math.max(.5,size/2-.5));
   x.lineWidth=s.thickness||1;
   if(col==='transparent'){
    x.globalCompositeOperation='destination-out';x.fillStyle=x.strokeStyle='rgba(0,0,0,1)';
    if(s.outline)x.stroke();else x.fill();
   }else{
    x.fillStyle=x.strokeStyle=col;
    if(s.outline)x.stroke();else x.fill();
   }
   x.restore();
  });
  return c;
 }
 if(s.pattern==='gradient'){
  let coords=s.direction==='horizontal'?[0,0,w,0]:s.direction==='vertical'?[0,0,0,h]:s.direction==='antidiagonal'?[w,0,0,h]:[0,0,w,h];
  let g=x.createLinearGradient(...coords);
  if(p.length===1){if(p[0]==='transparent')return c;x.fillStyle=p[0];}
  else{p.forEach((color,i)=>g.addColorStop(i/(p.length-1),color==='transparent'?'rgba(0,0,0,0)':color));x.fillStyle=g;}
  x.fillRect(0,0,w,h);
  return c;
 }
 if(s.pattern==='solid'){if(p[0]!=='transparent'){x.fillStyle=p[0];x.fillRect(0,0,w,h);}return c;}
 if(s.pattern==='border'){
  let t=Math.max(1,Math.round(s.thickness||1));
  if(p[0]!=='transparent'){x.fillStyle=p[0];x.fillRect(t,t,Math.max(0,w-2*t),Math.max(0,h-2*t));}
  let edge=p[1]||p[0];
  if(edge!=='transparent'){x.fillStyle=edge;x.fillRect(0,0,w,t);x.fillRect(0,h-t,w,t);x.fillRect(0,t,t,Math.max(0,h-2*t));x.fillRect(w-t,t,t,Math.max(0,h-2*t));}
  return c;
 }
 if(s.pattern==='checker'){
  for(let y=0;y<h;y+=size)for(let z=0;z<w;z+=size){
   let col=((Math.floor(y/size)+Math.floor(z/size))%2)?(p[1]||p[0]):p[0];
   if(col!=='transparent'){x.fillStyle=col;x.fillRect(z,y,size,size);}
  }
  return c;
 }
 for(let y=0;y<h;y++)for(let z=0;z<w;z++){
  let n;
  if(s.pattern==='diamonds')n=Math.floor((Math.abs(z-(w-1)/2)+Math.abs(y-(h-1)/2))/size);
  else if(s.pattern==='zigzag'){
   let p4=size*4,p2=size*2;
   if(s.direction==='vertical')n=Math.floor((z+Math.abs((y%p4)-p2))/size);
   else if(s.direction==='diagonal'){let u=z+y,v=z-y+h;n=Math.floor((u+Math.abs((v%p4)-p2))/size);}
   else if(s.direction==='antidiagonal'){let u=z-y+h,v=z+y;n=Math.floor((u+Math.abs((v%p4)-p2))/size);}
   else n=Math.floor((y+Math.abs((z%p4)-p2))/size);
  }else{let axis=s.direction==='vertical'?z:s.direction==='horizontal'?y:s.direction==='antidiagonal'?z-y+h:z+y;n=Math.floor(axis/size);}
  let col=p[((n%p.length)+p.length)%p.length];
  if(col!=='transparent'){x.fillStyle=col;x.fillRect(z,y,1,1);}
 }
 return c;
}

async function renderSource(s,w,h,stepOffset=0,transparent=false){
 if(!s)return canvas(w,h,transparent);
 if(s.type==='pattern')return drawPattern(s,w,h,stepOffset,transparent);
 let c=canvas(w,h,transparent),x=c.getContext('2d'),i=await loadImage(s.src);
 x.imageSmoothingEnabled=s.smooth;x.imageSmoothingQuality='high';
 if(s.fit==='stretch')x.drawImage(i,0,0,w,h);
 else{
  let scale=s.fit==='actual'?1:(s.fit==='cover'?Math.max:Math.min)(w/i.width,h/i.height);
  let iw=Math.max(1,Math.round(i.width*scale)),ih=Math.max(1,Math.round(i.height*scale));
  let ax=Number.isFinite(s.alignX)?s.alignX:0.5,ay=Number.isFinite(s.alignY)?s.alignY:0.5;
  x.drawImage(i,Math.round((w-iw)*ax),Math.round((h-ih)*ay),iw,ih);
 }
 return c;
}

function sourceCycles(s){return !!(s&&s.type==='pattern'&&s.cycle);}
function stepCycles(f){
 if(!f)return false;
 if((f.mode==='span'||f.mode==='repeat')&&sourceCycles(f.source))return true;
 if(f.mode==='panels'&&Array.isArray(f.panels)&&f.panels.some(sourceCycles))return true;
 if((f.bgMode==='span'||f.bgMode==='repeat')&&sourceCycles(f.bgSource))return true;
 if(f.bgMode==='panels'&&Array.isArray(f.bgPanels)&&f.bgPanels.some(sourceCycles))return true;
 return false;
}
async function refreshCyclingSteps(){
 for(let i=0;i<current.steps.length;i++)if(stepCycles(current.steps[i]))await regenerate(current.steps[i],db.layout,i);
}

async function regenerate(f,cols=db.layout,stepIndex=null){
 let idx=stepIndex!==null?stepIndex:(current?Math.max(0,current.steps.indexOf(f)):0);
 let bgMode=f.bgMode||'none',bg=[null,null,null,null];
 if(bgMode==='span'&&f.bgSource){
  let bc=await renderSource(f.bgSource,cols*16,64/cols,idx,false);
  for(let i=0;i<4;i++){bg[i]=canvas(16,16,false);bg[i].getContext('2d').drawImage(bc,(i%cols)*16,Math.floor(i/cols)*16,16,16,0,0,16,16);}
 }else if(bgMode==='repeat'&&f.bgSource){
  let bc=await renderSource(f.bgSource,16,16,idx,false);
  for(let i=0;i<4;i++){bg[i]=canvas(16,16,false);bg[i].getContext('2d').drawImage(bc,0,0);}
 }else if(bgMode==='panels'&&Array.isArray(f.bgPanels)){
  for(let i=0;i<4;i++)bg[i]=f.bgPanels[i]?await renderSource(f.bgPanels[i],16,16,idx,false):canvas(16,16,false);
 }else{
  for(let i=0;i<4;i++)bg[i]=canvas(16,16,false);
 }

 if(f.mode==='span'){
  let c=await renderSource(f.source,cols*16,64/cols,idx,true);
  for(let i=0;i<4;i++){
   bg[i].getContext('2d').drawImage(c,(i%cols)*16,Math.floor(i/cols)*16,16,16,0,0,16,16);
   f.tiles[i]=bg[i].toDataURL('image/png');
  }
 }else if(f.mode==='repeat'){
  let fg=await renderSource(f.source,16,16,idx,true);
  for(let i=0;i<4;i++){
   bg[i].getContext('2d').drawImage(fg,0,0);
   f.tiles[i]=bg[i].toDataURL('image/png');
  }
 }else{
  for(let i=0;i<4;i++){
   let hasBg=bgMode==='span'||bgMode==='repeat'||(bgMode==='panels'&&f.bgPanels&&f.bgPanels[i]);
   if(f.panels[i]){
    let fg=await renderSource(f.panels[i],16,16,idx,true);
    bg[i].getContext('2d').drawImage(fg,0,0);
    f.tiles[i]=bg[i].toDataURL('image/png');
   }else if(hasBg){
    f.tiles[i]=bg[i].toDataURL('image/png');
   }else{
    f.tiles[i]='';
   }
  }
 }
}

function calibrationLut(){
 let cal=db.calibration||{gamma:2.2,cutoff:0,brightness:100};
 let gamma=Math.max(1,Math.min(3,Number(cal.gamma)||2.2));
 let cutoff=Math.max(0,Math.min(128,Math.round(Number(cal.cutoff)||0)));
 let bright=Math.max(.1,Math.min(1,(Number(cal.brightness)||100)/100));
 let lut=new Uint8Array(256),span=255-cutoff;
 for(let v=0;v<256;v++){
  if(v<=cutoff)lut[v]=0;
  else{
   let norm=(v-cutoff)/span;
   lut[v]=Math.max(0,Math.min(255,Math.round(Math.pow(norm,gamma)*bright*255)));
  }
 }
 return lut;
}

async function rgbTile(t){
 let c=canvas(16,16);if(t)c.getContext('2d').drawImage(await loadImage(t),0,0,16,16);
 let a=c.getContext('2d').getImageData(0,0,16,16).data,lut=calibrationLut(),b='';
 for(let i=0;i<256;i++)b+=String.fromCharCode(lut[a[i*4]],lut[a[i*4+1]],lut[a[i*4+2]]);
 return btoa(b);
}

function clearPending(){clearTimeout(liveTimer);pendingTiles=[undefined,undefined,undefined,undefined];liveVersions=liveVersions.map(n=>n+1);lastTiles=[undefined,undefined,undefined,undefined];}
function setLive(enabled){live=enabled;clearPending();Native.setLive(enabled);renderPreview();if(enabled){if(!ready.some(Boolean))notify('Live Preview enabled. Connect displays to see it on hardware.');previewCurrent(true);}else if(playback&&playback.kind==='library')pausePlayback();}
function queueTiles(tiles,mask=[0,1,2,3],force=false,immediate=false){if(!live||busy)return;for(let i of mask){if(!ready[i])continue;if(force)lastTiles[i]=undefined;pendingTiles[i]=tiles[i]||'';liveVersions[i]++;}clearTimeout(liveTimer);if(immediate)flushLive();else liveTimer=setTimeout(flushLive,180);}
async function flushLive(){
 if(!live||busy)return;
 let batch=pendingTiles.slice(),versions=liveVersions.slice(),encoded=[null,null,null,null];
 pendingTiles=[undefined,undefined,undefined,undefined];
 try{
  await Promise.all([0,1,2,3].map(async i=>{
   if(batch[i]!==undefined&&ready[i]&&batch[i]!==lastTiles[i]){
    let rgb=await rgbTile(batch[i]);
    if(versions[i]===liveVersions[i]&&live&&!busy){encoded[i]=rgb;lastTiles[i]=batch[i];}
   }
  }));
  if(live&&!busy&&encoded.some(x=>x!==null))Native.preview(JSON.stringify(encoded));
 }catch(e){log('Live preview preparation: '+e.message);}
}

function previewCurrent(force=false){let f=playback?playback.sequence.steps[playback.index]:current.steps[selected];queueTiles(f?f.tiles:['','','',''],[0,1,2,3],force,force);}
function liveError(i){lastTiles[i]=undefined;log('Temporary image transfer failed on display '+(i+1)+'.');}
function pausePlayback(){let wasPlaying=!!playback;clearTimeout(playTimer);playTimer=null;playback=null;if(current){renderPreview();if(wasPlaying)renderGrid();}updateLibraryPlayback();}

function startPlayback(kind,sequence){
 if(busy||working)return;
 if(kind==='editor'&&playback&&playback.kind==='editor'){pausePlayback();return;}
 if(!sequence.steps.length)return notify('This sequence is empty.');
 pausePlayback();closeSheet(false);
 if(!live){live=true;clearPending();Native.setLive(true);}
 else clearPending();
 playback={kind,sequence:kind==='library'?clone(sequence):sequence,index:kind==='editor'?selected:0};
 function tick(){
  if(!playback)return;
  if(playback.kind==='editor'){selected=playback.index;renderGrid();renderPreview();}
  queueTiles(playback.sequence.steps[playback.index].tiles,[0,1,2,3],true,true);updateLibraryPlayback();
  playTimer=setTimeout(()=>{if(!playback)return;playback.index=(playback.index+1)%playback.sequence.steps.length;tick();},db.previewSeconds*1000);
 }
 tick();renderPreview();
}

function updateLibraryPlayback(){
 let active=playback&&playback.kind==='library';
 $('libraryPlayback').hidden=!active;
 if(active)$('libraryPlaybackText').textContent=playback.sequence.name+' · '+(playback.index+1)+'/'+playback.sequence.steps.length;
 document.querySelectorAll('.libraryCard').forEach(n=>n.classList.toggle('active',!!active&&n.dataset.id===playback.sequence.id));
}

function changeSpeed(delta){db.previewSeconds=Math.max(.1,Math.min(30,Math.round((db.previewSeconds+delta)*10)/10));let p=playback?{kind:playback.kind,sequence:playback.sequence}:null;pausePlayback();renderPreview();draftSoon();if(p)startPlayback(p.kind,p.sequence);}

function decodeGif(buffer,maxFrames=25){
 let b=new Uint8Array(buffer),p=0;
 const u16=o=>b[o]|(b[o+1]<<8);
 const hdr=String.fromCharCode(b[0],b[1],b[2],b[3],b[4],b[5]);
 if(hdr!=='GIF87a'&&hdr!=='GIF89a')throw Error('Not a valid GIF');
 let width=u16(6),height=u16(8),packed=b[10];p=13;
 if(width<1||height<1)throw Error('Invalid GIF dimensions');
 let gct=null;
 if(packed&0x80){let sz=1<<((packed&7)+1);gct=b.subarray(p,p+sz*3);p+=sz*3;}
 const readBlocks=()=>{let chunks=[],total=0;while(p<b.length){let len=b[p++];if(!len)break;chunks.push(b.subarray(p,p+len));total+=len;p+=len;}let out=new Uint8Array(total),off=0;for(let c of chunks){out.set(c,off);off+=c.length;}return out;};
 const lzw=(minSize,data,count)=>{
  let clear=1<<minSize,eoi=clear+1,size=minSize+1,nextCode=eoi+1,mask=(1<<size)-1;
  let prefix=new Int16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4096);
  let out=new Uint8Array(count),outPos=0,bitBuf=0,bitCnt=0,bytePos=0,oldCode=-1,firstChar=0;
  const reset=()=>{size=minSize+1;nextCode=eoi+1;mask=(1<<size)-1;oldCode=-1;};
  const readCode=()=>{
   while(bitCnt<size){if(bytePos>=data.length)return -1;bitBuf|=data[bytePos++]<<bitCnt;bitCnt+=8;}
   let code=bitBuf&mask;bitBuf>>=size;bitCnt-=size;return code;
  };
  while(outPos<count){
   let code=readCode();
   if(code<0||code===eoi)break;
   if(code===clear){reset();continue;}
   if(oldCode===-1){if(code<clear){out[outPos++]=code;firstChar=code;oldCode=code;}continue;}
   let cur=code,sp=0;
   if(cur>=nextCode){stack[sp++]=firstChar;cur=oldCode;}
   while(cur>=clear&&sp<4095){stack[sp++]=suffix[cur];cur=prefix[cur];}
   firstChar=cur&0xff;stack[sp++]=firstChar;
   while(sp>0&&outPos<count)out[outPos++]=stack[--sp];
   if(nextCode<4096){
    prefix[nextCode]=oldCode;suffix[nextCode]=firstChar;nextCode++;
    if(nextCode>mask&&size<12){size++;mask=(1<<size)-1;}
   }
   oldCode=code;
  }
  return out;
 };
 const deinterlace=(px,w,h)=>{
  let out=new Uint8Array(px.length),row=0;
  for(let [start,step] of [[0,8],[4,8],[2,4],[1,2]])for(let y=start;y<h;y+=step){out.set(px.subarray(row*w,(row+1)*w),y*w);row++;}
  return out;
 };
 let comp=document.createElement('canvas');comp.width=width;comp.height=height;
 let ctx=comp.getContext('2d'),fc=document.createElement('canvas'),fctx=fc.getContext('2d');
 let outScale=Math.min(1,256/Math.max(width,height)),oc=document.createElement('canvas');
 oc.width=Math.max(1,Math.round(width*outScale));oc.height=Math.max(1,Math.round(height*outScale));
 let octx=oc.getContext('2d'),frames=[],truncated=false,gce={disposal:0,trans:false,transIdx:0};
 while(p<b.length){
  let sep=b[p++];
  if(sep===0x3B)break;
  if(sep===0x21){
   let label=b[p++];
   if(label===0xF9){
    let blk=readBlocks();
    if(blk.length>=4){gce.disposal=(blk[0]>>2)&7;gce.trans=!!(blk[0]&1);gce.transIdx=blk[3];}
   }else readBlocks();
  }else if(sep===0x2C){
   if(frames.length>=maxFrames){truncated=true;break;}
   let left=u16(p),top=u16(p+2),w=u16(p+4),h=u16(p+6),ip=b[p+8];p+=9;
   let ct=gct;if(ip&0x80){let sz=1<<((ip&7)+1);ct=b.subarray(p,p+sz*3);p+=sz*3;}
   let minCode=b[p++],raw=readBlocks();
   if(!ct||w<1||h<1){gce={disposal:0,trans:false,transIdx:0};continue;}
   let idx=lzw(minCode,raw,w*h);if(ip&0x40)idx=deinterlace(idx,w,h);
   let prev=gce.disposal===3?ctx.getImageData(0,0,width,height):null;
   fc.width=w;fc.height=h;
   let imgData=fctx.createImageData(w,h),d=imgData.data;
   for(let i=0;i<w*h;i++){
    let ci=idx[i];
    if(gce.trans&&ci===gce.transIdx)continue;
    let o=i*4,co=ci*3;
    d[o]=ct[co];d[o+1]=ct[co+1];d[o+2]=ct[co+2];d[o+3]=255;
   }
   fctx.putImageData(imgData,0,0);ctx.drawImage(fc,left,top);
   octx.clearRect(0,0,oc.width,oc.height);octx.drawImage(comp,0,0,oc.width,oc.height);
   frames.push(oc.toDataURL('image/png'));
   if(gce.disposal===2)ctx.clearRect(left,top,w,h);
   else if(gce.disposal===3&&prev)ctx.putImageData(prev,0,0);
   gce={disposal:0,trans:false,transIdx:0};
  }else break;
 }
 return {frames,truncated,small:width<16||height<16};
}

function imageAlignControls(parent,obj,onChange){
 const fmt=(v,low,high)=>v===0?low:v===1?high:v===0.5?'Center':Math.round(v*100)+'%';
 for(let [key,title,low,high] of [['alignX','Horizontal position','Left','Right'],['alignY','Vertical position','Top','Bottom']]){
  let cur=Number.isFinite(obj[key])?obj[key]:0.5;
  let lbl=el('label',undefined,'calRow'),top=el('span',title),val=el('b',fmt(cur,low,high));
  top.append(val);
  let r=document.createElement('input');r.type='range';r.min=0;r.max=100;r.step=5;r.value=Math.round(cur*100);
  r.oninput=()=>{let v=Number(r.value)/100;obj[key]=v;val.textContent=fmt(v,low,high);onChange();};
  lbl.append(top,r);parent.append(lbl);
 }
}
const FIT_OPTS=[['contain','Fit with black borders'],['actual','Original size (1:1)'],['cover','Fill and crop'],['stretch','Stretch']];

function pickImage(callback){if(busy||working)return;pickerCallback=callback;$('imagePicker').value='';$('imagePicker').click();}
async function onPicked(e){
 let file=e.target.files[0];if(!file)return;
 let callback=pickerCallback;pickerCallback=null;if(!callback)return;
 if(file.size>12*1024*1024)return notify('Choose an image under 12 MB.');
 let isGif=file.type==='image/gif'||/\.gif$/i.test(file.name||'');
 if(!isGif&&!/^image\/(png|jpeg|webp|bmp|avif)$/.test(file.type))return notify('Choose PNG, JPEG, WebP, GIF, BMP or AVIF.');
 working=true;
 try{
  if(isGif){
   let buf=await file.arrayBuffer(),res=decodeGif(buf,25);
   if(res.frames.length>1){
    working=false;
    callback({type:'gif',frames:res.frames.map(src=>({id:uid(),src,deleted:false})),truncated:res.truncated,fit:res.small?'actual':db.defaults.fit});
    return;
   }
   if(res.frames.length===1){working=false;callback(imageSpec(res.frames[0],res.small?'actual':db.defaults.fit));return;}
  }
  let data=await new Promise((ok,no)=>{let r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file);}),img=await loadImage(data),scale=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  let src=c.toDataURL('image/png');if(src.length>12_000_000)throw Error('Source copy too large');
  let small=img.width<16||img.height<16;
  working=false;callback(imageSpec(src,small?'actual':db.defaults.fit));
 }catch(error){notify('Import failed: '+error.message);}finally{working=false;e.target.value='';}
}

function chooseType(callback){openSheet('Add image or pattern');let b=$('sheetBody');b.append(hint('Choose a gallery image or create a color pattern.'));buttons(b,[['Choose image',()=>pickImage(callback),'primary'],['Create pattern',()=>callback(patternSpec())]]);}
function addStep(){if(busy||working)return;if(current.steps.length>=200)return notify('Maximum 200 steps.');chooseType(s=>{openSheet('Choose placement');let b=$('sheetBody');let layerSel=select([['fg','Foreground (main layer)'],['bg','Background layer']],'fg');b.append(field('Layer',layerSel));b.append(hint('Add one image across the wall, repeat it on every display, or place it on one display.'));const choose=target=>{let isBg=layerSel.value==='bg';if(s.type==='gif'){openGifEditor({groupId:null,target,layer:isBg?'bg':'fg',insertIndex:current.steps.length,isNew:true,frames:s.frames,fit:s.fit||db.defaults.fit,smooth:db.defaults.smooth,alignX:0.5,alignY:0.5,truncated:s.truncated});return;}let f=blankFrame();if(isBg){if(typeof target==='string'){f.bgMode=target;f.bgSource=clone(s);}else{f.bgMode='panels';f.bgPanels[target]=clone(s);}if(s.type==='pattern')advancedPattern(f,target,true,s,{applyAll:false,isNewStep:true});else openBackgroundEditor(f,false,true);return;}if(typeof target==='string'){f.mode=target;f.source=clone(s);}else f.panels[target]=clone(s);editSource(f,target,true);};buttons(b,[['Span all four',()=>choose('span'),'primary'],['Repeat on all four',()=>choose('repeat')]]);let positions=el('div',undefined,'placement');for(let i=0;i<4;i++)positions.append(button('Display '+(i+1),()=>choose(i)));b.append(positions);});}
function openSource(id,index){if(busy||working)return;let f=current.steps.find(x=>x.id===id);if(!f)return;let src=f.mode!=='panels'?f.source:f.panels[index];if(src&&src.gifGroupId&&current.gifGroups&&current.gifGroups[src.gifGroupId]){let g=current.gifGroups[src.gifGroupId];openGifEditor({groupId:g.id,target:g.target,layer:g.layer||'fg',insertIndex:current.steps.indexOf(f),isNew:false,frames:clone(g.frames),fit:g.fit,smooth:g.smooth,alignX:g.alignX??0.5,alignY:g.alignY??0.5,truncated:false});return;}if(f.mode!=='panels')editSource(clone(f),f.mode,false);else if(f.panels[index])editSource(clone(f),index,false);else chooseType(s=>{if(s.type==='gif'){openGifEditor({groupId:null,target:index,layer:'fg',insertIndex:current.steps.indexOf(f),isNew:false,frames:s.frames,fit:s.fit||db.defaults.fit,smooth:db.defaults.smooth,alignX:0.5,alignY:0.5,truncated:s.truncated});return;}let copy=clone(f);copy.panels[index]=s;editSource(copy,index,false);});}

function openGifEditor(opts){
 let groupId=opts.groupId,target=opts.target,layer=opts.layer==='bg'?'bg':'fg',insertIndex=opts.insertIndex,frames=clone(opts.frames),fit=opts.fit||db.defaults.fit,smooth=!!opts.smooth;
 let alignState={alignX:Number.isFinite(opts.alignX)?opts.alignX:0.5,alignY:Number.isFinite(opts.alignY)?opts.alignY:0.5};
 openSheet(groupId?'Edit GIF animation':(layer==='bg'?'Preview background GIF':'Preview GIF frames'));
 let session={gif:true,playing:true,animIdx:0,timer:null,rev:0};editorSession=session;
 const b=$('sheetBody');
 if(opts.truncated)b.append(hint('GIF has more than 25 frames; showing the first 25 frames.'));
 b.append(hint((target==='span'?'Spanning all 4 displays':target==='repeat'?'Repeating on all 4 displays':'Display '+(target+1))+' · Tap a frame to preview, ◀/▶ to reorder, ✕ to delete or ↺ to restore.'));
 let previewBox=el('div',undefined,'gifPreviewBox');
 let previewWrap=el('div',undefined,(target==='span'||target==='repeat')?'gifPreviewWall':'gifPreviewSingle');
 let previewControls=el('div',undefined,'gifPreviewControls');
 let statusLine=el('b','Frame 1');
 let speedRow=el('div',undefined,'controls');
 let playBtn=button('Pause',()=>{session.playing=!session.playing;playBtn.textContent=session.playing?'Pause':'Play';if(session.playing)scheduleTick();else clearTimeout(session.timer);});
 let speedLabel=el('span',db.previewSeconds.toFixed(1)+' s');
 let slower=button('+',()=>{changeGifSpeed(0.1);}),faster=button('−',()=>{changeGifSpeed(-0.1);});
 function changeGifSpeed(delta){
  db.previewSeconds=Math.max(.1,Math.min(30,Math.round((db.previewSeconds+delta)*10)/10));
  speedLabel.textContent=db.previewSeconds.toFixed(1)+' s';
  draftSoon();renderPreview();
  if(session.playing){clearTimeout(session.timer);scheduleTick();}
 }
 speedRow.append(playBtn,faster,speedLabel,slower);
 previewControls.append(statusLine,speedRow);
 previewBox.append(previewWrap,previewControls);
 b.append(previewBox);

 let fitSel=select(FIT_OPTS,fit);
 fitSel.onchange=()=>{fit=fitSel.value;renderAll();};
 let smoothChk=document.createElement('input');smoothChk.type='checkbox';smoothChk.checked=smooth;
 smoothChk.onchange=()=>{smooth=smoothChk.checked;renderAll();};
 let checkLbl=el('label',undefined,'check');checkLbl.append(smoothChk,document.createTextNode('Smooth resizing'));
 b.append(field('Image fitting',fitSel));
 imageAlignControls(b,alignState,renderAll);
 b.append(checkLbl);

 let grid=el('div',undefined,'gifFramesGrid');
 b.append(grid);

 let renderedFrames=[];
 async function buildPreviewStep(src){
  let f=blankFrame(),spec={type:'image',src,fit,smooth,alignX:alignState.alignX,alignY:alignState.alignY};
  if(layer==='bg'){
   if(target==='span'||target==='repeat'){f.bgMode=target;f.bgSource=spec;}
   else{f.bgMode='panels';f.bgPanels[target]=spec;}
  }else{
   if(target==='span'||target==='repeat'){f.mode=target;f.source=spec;}
   else{f.mode='panels';f.panels[target]=spec;}
  }
  await regenerate(f);
  return f;
 }
 function activeIndices(){return frames.map((fr,i)=>fr.deleted?-1:i).filter(i=>i>=0);}
 function drawAnimFrame(){
  let act=activeIndices();
  if(!act.length){
   previewWrap.replaceChildren(hint('No active frames'));
   statusLine.textContent='0 active frames';
   return;
  }
  if(session.animIdx>=act.length)session.animIdx=0;
  let fi=act[session.animIdx],rf=renderedFrames[fi];
  if(!rf)return;
  if(target==='span'||target==='repeat'){
   let w=makeWall(rf,db.layout,false);
   previewWrap.replaceChildren(w);
  }else{
   let w=el('div',undefined,'wall');w.style.gridTemplateColumns='1fr';
   let t=el('div',undefined,'tile');
   if(rf.tiles[target]){let img=document.createElement('img');img.src=rf.tiles[target];img.alt='';t.append(img);}
   w.append(t);previewWrap.replaceChildren(w);
  }
  statusLine.textContent='Frame '+(session.animIdx+1)+' / '+act.length+' (#'+(fi+1)+')';
  grid.querySelectorAll('.gifFrameCard').forEach((n,i)=>n.classList.toggle('active',i===fi));
  if(live)queueTiles(rf.tiles,(target==='span'||target==='repeat')?[0,1,2,3]:[target],false,true);
 }
 function scheduleTick(){
  clearTimeout(session.timer);
  if(editorSession!==session||!session.playing)return;
  session.timer=setTimeout(()=>{
   if(editorSession!==session||!session.playing)return;
   let act=activeIndices();
   if(act.length){session.animIdx=(session.animIdx+1)%act.length;drawAnimFrame();}
   scheduleTick();
  },db.previewSeconds*1000);
 }
 async function renderAll(){
  let rev=++session.rev;
  renderedFrames=await Promise.all(frames.map(fr=>buildPreviewStep(fr.src)));
  if(editorSession!==session||rev!==session.rev)return;
  grid.replaceChildren();
  frames.forEach((fr,i)=>{
   let card=el('div',undefined,'gifFrameCard'+(fr.deleted?' deleted':''));
   let top=el('div',undefined,'gifFrameTop');
   top.append(el('span','#'+(i+1)),el('span',fr.deleted?'Deleted':''));
   let preview;
   if(target==='span'||target==='repeat'){preview=makeWall(renderedFrames[i],db.layout,false);}
   else{
    preview=el('div',undefined,'wall');preview.style.gridTemplateColumns='1fr';
    let t=el('div',undefined,'tile');
    if(renderedFrames[i].tiles[target]){let img=document.createElement('img');img.src=renderedFrames[i].tiles[target];img.alt='';t.append(img);}
    preview.append(t);
   }
   let actRow=el('div',undefined,'gifFrameActions');
   let mvL=button('◀',e=>{e.stopPropagation();if(i===0)return;[frames[i-1],frames[i]]=[frames[i],frames[i-1]];renderAll();});mvL.disabled=i===0;mvL.title='Move earlier';
   let mvR=button('▶',e=>{e.stopPropagation();if(i===frames.length-1)return;[frames[i+1],frames[i]]=[frames[i],frames[i+1]];renderAll();});mvR.disabled=i===frames.length-1;mvR.title='Move later';
   let del=button(fr.deleted?'↺':'✕',e=>{e.stopPropagation();fr.deleted=!fr.deleted;renderAll();});del.title=fr.deleted?'Restore frame':'Delete frame';
   actRow.append(mvL,mvR,del);
   card.append(top,preview,actRow);
   card.onclick=()=>{
    if(fr.deleted)return;
    let act=activeIndices(),pos=act.indexOf(i);
    if(pos>=0){session.animIdx=pos;drawAnimFrame();}
   };
   grid.append(card);
  });
  drawAnimFrame();
 }

 buttons(b,[['Cancel',()=>{clearTimeout(session.timer);closeSheet(true);}],['Apply',async()=>{
  if(working||busy)return;
  let act=frames.filter(fr=>!fr.deleted);
  if(!groupId&&!act.length)return notify('Keep at least one frame to apply.');
  clearTimeout(session.timer);working=true;
  try{
   await applyGifGroup({groupId,target,layer,insertIndex,frames,fit,smooth,alignX:alignState.alignX,alignY:alignState.alignY});
   if(fit!=='actual')db.defaults={fit,smooth};
   working=false;closeSheet(false);changed();renderEditor();previewCurrent(true);
  }catch(e){notify(e.message);}finally{working=false;}
 },'primary']]);
 if(groupId){
  b.append(el('div',undefined,'separator'));
  buttons(b,[...(layer==='fg'?[['Background layer',()=>{
   let firstStep=current.steps.find(f=>target==='span'||target==='repeat'?(f.mode===target&&f.source&&f.source.gifGroupId===groupId):(f.mode==='panels'&&f.panels[target]&&f.panels[target].gifGroupId===groupId));
   if(firstStep)openBackgroundEditor(clone(firstStep),true);
  }]]:[]),['Remove GIF from sequence',async()=>{
   if(working||busy||!confirm('Remove all frames of this GIF from the sequence?'))return;
   clearTimeout(session.timer);working=true;
   try{
    frames.forEach(fr=>fr.deleted=true);
    await applyGifGroup({groupId,target,layer,insertIndex,frames,fit,smooth,alignX:alignState.alignX,alignY:alignState.alignY});
    working=false;closeSheet(false);changed();renderEditor();previewCurrent(true);
   }catch(e){notify(e.message);}finally{working=false;}
  },'danger']]);
 }
 renderAll().then(()=>{if(editorSession===session&&session.playing)scheduleTick();});
}

async function applyGifGroup({groupId,target,layer='fg',insertIndex,frames,fit,smooth,alignX=0.5,alignY=0.5}){
 if(!current.gifGroups)current.gifGroups={};
 let gid=groupId||uid();
 let active=frames.filter(fr=>!fr.deleted);
 let existing=[];
 if(groupId){
  current.steps.forEach((f,idx)=>{
   let match;
   if(layer==='bg'){
    match=(target==='span'||target==='repeat')?(f.bgMode===target&&f.bgSource&&f.bgSource.gifGroupId===gid):(f.bgMode==='panels'&&f.bgPanels&&f.bgPanels[target]&&f.bgPanels[target].gifGroupId===gid);
   }else{
    match=(target==='span'||target==='repeat')?(f.mode===target&&f.source&&f.source.gifGroupId===gid):(f.mode==='panels'&&f.panels[target]&&f.panels[target].gifGroupId===gid);
   }
   if(match)existing.push(idx);
  });
 }
 let startIdx=existing.length?existing[0]:Math.max(0,Math.min(insertIndex,current.steps.length));
 let slots=[];
 if(existing.length){
  for(let k=0;k<active.length;k++){
   if(k<existing.length)slots.push(existing[k]);
   else slots.push(existing[existing.length-1]+1+(k-existing.length));
  }
 }else{
  for(let k=0;k<active.length;k++)slots.push(startIdx+k);
 }
 if(slots.length&&slots[slots.length-1]>=200)throw Error('Exceeds maximum 200 steps in sequence.');
 while(slots.length&&current.steps.length<=slots[slots.length-1])current.steps.push(blankFrame());

 for(let k=0;k<active.length;k++){
  let step=current.steps[slots[k]];
  let srcObj={type:'image',src:active[k].src,fit,smooth,alignX,alignY,gifGroupId:gid,gifFrameId:active[k].id};
  if(layer==='bg'){
   if(target==='span'||target==='repeat'){
    step.bgMode=target;step.bgSource=srcObj;step.bgPanels=[null,null,null,null];
   }else{
    if(step.bgMode!=='panels'){step.bgMode='panels';step.bgSource=null;step.bgPanels=[null,null,null,null];}
    step.bgPanels[target]=srcObj;
   }
  }else{
   if(target==='span'||target==='repeat'){
    step.mode=target;step.source=srcObj;step.panels=[null,null,null,null];
   }else{
    if(step.mode!=='panels'){
     let oldTiles=step.tiles.slice();
     step.mode='panels';step.source=null;
     step.panels=[0,1,2,3].map(p=>p===target?null:(oldTiles[p]?{type:'image',src:oldTiles[p],fit:'contain',smooth:false}:null));
    }
    step.panels[target]=srcObj;
   }
  }
  await regenerate(step,db.layout,slots[k]);
 }

 if(existing.length>active.length){
  let toClean=existing.slice(active.length).sort((a,b)=>b-a);
  for(let idx of toClean){
   let step=current.steps[idx];
   if(layer==='bg'){
    if(target==='span'||target==='repeat'){step.bgMode='none';step.bgSource=null;step.bgPanels=[null,null,null,null];}
    else{step.bgPanels[target]=null;if(step.bgPanels.every(p=>p===null))step.bgMode='none';}
    if(step.bgMode==='none'&&step.mode==='panels'&&step.panels.every(p=>p===null))current.steps.splice(idx,1);
    else await regenerate(step,db.layout,idx);
   }else{
    if(target==='span'||target==='repeat'){
     current.steps.splice(idx,1);
    }else{
     step.panels[target]=null;step.tiles[target]='';
     if(step.panels.every(p=>p===null)&&(!step.bgMode||step.bgMode==='none'))current.steps.splice(idx,1);
     else await regenerate(step,db.layout,idx);
    }
   }
  }
 }
 await refreshCyclingSteps();

 if(active.length){
  current.gifGroups[gid]={id:gid,target,layer,fit,smooth,alignX,alignY,frames:clone(frames)};
  selected=Math.min(startIdx,Math.max(0,current.steps.length-1));
 }else{
  delete current.gifGroups[gid];
  selected=Math.min(selected,Math.max(0,current.steps.length-1));
 }
}

function editSource(frame,target,isNew){
 let src=typeof target==='string'?frame.source:frame.panels[target];
 if(src&&src.type==='pattern'){advancedPattern(frame,target,isNew,src);return;}
 if(src&&src.gifGroupId&&current.gifGroups&&current.gifGroups[src.gifGroupId]){
  let g=current.gifGroups[src.gifGroupId],idx=current.steps.findIndex(x=>x.id===frame.id);
  openGifEditor({groupId:g.id,target:g.target,insertIndex:idx>=0?idx:0,isNew:false,frames:clone(g.frames),fit:g.fit,smooth:g.smooth,alignX:g.alignX??0.5,alignY:g.alignY??0.5,truncated:false});
  return;
 }
 openSheet(isNew?'New step':'Edit image / pattern');let session={frame,target,isNew,revision:0};editorSession=session;const b=$('sheetBody');
 let tools=el('div',undefined,'advancedPattern');tools.append(button('Use shapes / advanced patterns',()=>advancedPattern(frame,target,isNew,patternSpec())));if(!isNew)tools.append(' ',button('Background layer',()=>openBackgroundEditor(clone(frame))));b.append(tools);
 let s=clone(src);const settings=el('div');b.append(settings);
 let placement=select([['span','Span across all four'],['repeat','Repeat on all four'],['0','Display 1'],['1','Display 2'],['2','Display 3'],['3','Display 4']],target);
 let placementField=field('Placement',placement);let view=el('div',undefined,'wall miniPreview');
 b.append(placementField,hint('Span makes one continuous wall. Repeat duplicates it on every panel. Moving a wall source to one panel clears the other panels.'),view);
 function candidate(){let f=clone(frame),dest=['span','repeat'].includes(placement.value)?placement.value:Number(placement.value);if(typeof dest==='string'){f.mode=dest;f.source=clone(s);f.panels=[null,null,null,null];}else{if(typeof target==='string')f.panels=[null,null,null,null];else if(dest!==target)f.panels[target]=null;f.mode='panels';f.source=null;f.panels[dest]=clone(s);}return f;}
 async function refresh(){let revision=++session.revision;try{let f=candidate(),stepIdx=isNew?current.steps.length:Math.max(0,current.steps.findIndex(x=>x.id===f.id));await regenerate(f,db.layout,stepIdx);if(editorSession!==session||revision!==session.revision)return;session.rendered=f;let w=makeWall(f,db.layout,false);view.style.gridTemplateColumns=w.style.gridTemplateColumns;view.replaceChildren(...Array.from(w.children));let mask=(!isNew&&frame.mode==='panels'&&f.mode==='panels'&&String(target)===placement.value)?[Number(target)]:[0,1,2,3];queueTiles(f.tiles,mask);}catch(e){notify(e.message);}}
 function onChosenImage(next){
  if(next.type==='gif'){
   let dest=['span','repeat'].includes(placement.value)?placement.value:Number(placement.value);
   let idx=current.steps.findIndex(x=>x.id===frame.id);
   openGifEditor({groupId:null,target:dest,insertIndex:idx>=0?idx:current.steps.length,isNew,frames:next.frames,fit:next.fit||db.defaults.fit,smooth:db.defaults.smooth,alignX:0.5,alignY:0.5,truncated:next.truncated});
   return;
  }
  s=next;resetPlacement();rebuildSettings();refresh();
 }
 function rebuildSettings(){settings.replaceChildren();if(s.type==='image'){
  let img=el('img',undefined,'sourcePreview');img.src=s.src;img.alt='Source image';settings.append(img);buttons(settings,[['Change image',()=>pickImage(onChosenImage)],['Use pattern',()=>{s=patternSpec();resetPlacement();rebuildSettings();refresh();}]]);
  let fit=select(FIT_OPTS,s.fit);fit.onchange=()=>{s.fit=fit.value;refresh();};let smooth=document.createElement('input');smooth.type='checkbox';smooth.checked=s.smooth;smooth.onchange=()=>{s.smooth=smooth.checked;refresh();};let check=el('label',undefined,'check');check.append(smooth,document.createTextNode('Smooth resizing'));settings.append(field('Image fitting',fit));imageAlignControls(settings,s,refresh);settings.append(check);
 }else{
  let type=select([['solid','Solid color'],['gradient','Gradient'],['checker','Checkerboard'],['stripes','Stripes'],['border','Border']],s.pattern);type.onchange=()=>{s.pattern=type.value;rebuildSettings();refresh();};settings.append(field('Pattern',type));
  let colors=el('div',undefined,'colorRow');for(let key of ['a','b']){if(key==='b'&&s.pattern==='solid')continue;let isTrans=s[key]==='transparent';let input=document.createElement('input');input.type='color';input.value=isTrans?'#000000':s[key];if(isTrans)input.classList.add('isTransparent');input.oninput=()=>{s[key]=input.value;if(Array.isArray(s.colors))s.colors[key==='a'?0:1]=input.value;refresh();};let tBtn=button('∅',()=>{s[key]=s[key]==='transparent'?'#ffffff':'transparent';if(Array.isArray(s.colors))s.colors[key==='a'?0:1]=s[key];rebuildSettings();refresh();},'colorTransBtn'+(isTrans?' active':''));tBtn.title='Toggle transparent';let label=el('label',key==='a'?'Color 1':'Color 2');label.append(input,tBtn);colors.append(label);}settings.append(colors);buttons(settings,[['Swap colors',()=>{[s.a,s.b]=[s.b,s.a];if(Array.isArray(s.colors)&&s.colors.length>=2)[s.colors[0],s.colors[1]]=[s.colors[1],s.colors[0]];rebuildSettings();refresh();}],['Use image',()=>pickImage(onChosenImage)]]);
  if(['gradient','stripes'].includes(s.pattern)){
   const dirs=[['horizontal','Horizontal'],['vertical','Vertical'],['diagonal','Top-left to bottom-right'],['antidiagonal','Top-right to bottom-left']];
   let lbl=el('label',undefined,'calRow'),top=el('span','Direction'),val=el('b',(dirs.find(d=>d[0]===s.direction)||dirs[0])[1]);
   top.append(val);
   let r=document.createElement('input');r.type='range';r.min=0;r.max=dirs.length-1;r.step=1;r.value=Math.max(0,dirs.findIndex(d=>d[0]===s.direction));
   r.oninput=()=>{let d=dirs[Number(r.value)]||dirs[0];s.direction=d[0];val.textContent=d[1];refresh();};
   lbl.append(top,r);settings.append(lbl);
  }
  if(['checker','stripes','border'].includes(s.pattern)){
   let key=s.pattern==='border'?'thickness':'size',max=key==='thickness'?8:16;
   let lbl=el('label',undefined,'calRow'),top=el('span',s.pattern==='checker'?'Square size':s.pattern==='stripes'?'Stripe width':'Border thickness'),val=el('b',s[key]+' px');
   top.append(val);
   let n=document.createElement('input');n.id='patternSize';n.type='range';n.min=1;n.max=max;n.step=1;n.value=s[key];
   n.oninput=()=>{s[key]=Number(n.value);val.textContent=s[key]+' px';refresh();};
   lbl.append(top,n);settings.append(lbl);
  }
  let cyc=document.createElement('input');cyc.type='checkbox';cyc.checked=!!s.cycle;cyc.onchange=()=>{s.cycle=cyc.checked;refresh();};let cycLbl=el('label',undefined,'check');cycLbl.append(cyc,document.createTextNode('Rotate colors across steps'));settings.append(cycLbl);
 }}
 function resetPlacement(){let old=placement.value;let n=select([['span','Span across all four'],['repeat','Repeat on all four'],['0','Display 1'],['1','Display 2'],['2','Display 3'],['3','Display 4']],old);let chosen=n.value;placement.replaceChildren(...Array.from(n.children));placement.value=chosen;}
 placement.onchange=refresh;rebuildSettings();buttons(b,[['Cancel',()=>closeSheet(true)],['Done',async()=>{if(working||busy)return;let f=candidate();if(typeof target!=='string'&&f.mode!=='panels'&&frame.panels.some((p,i)=>i!==target&&p)&&!confirm('Replace the other panel images with this source?'))return;working=true;try{let idx=isNew?current.steps.length:current.steps.findIndex(x=>x.id===f.id);if(!isNew&&idx<0)throw Error('Step missing');await regenerate(f,db.layout,idx);if(isNew){current.steps.push(f);selected=current.steps.length-1;}else{current.steps[idx]=f;selected=idx;}if(s.type==='image')db.defaults={fit:s.fit,smooth:s.smooth};working=false;closeSheet(false);changed();renderEditor();previewCurrent(true);}catch(e){notify(e.message);}finally{working=false;}},'primary']]);
 if(!isNew){b.append(el('div',undefined,'separator'));buttons(b,[['Remove image',()=>{if(!confirm('Remove this image or pattern?'))return;let i=current.steps.findIndex(f=>f.id===frame.id);if(i<0)return;if(typeof target==='string')current.steps[i]={...blankFrame(),id:frame.id};else{current.steps[i].panels[target]=null;current.steps[i].tiles[target]='';}closeSheet(false);changed();renderEditor();previewCurrent(true);},'danger'],['Delete entire step',()=>deleteStep(frame.id),'danger']]);buttons(b,[['Move earlier',()=>{closeSheet();moveStep(frame.id,-1);}],['Move later',()=>{closeSheet();moveStep(frame.id,1);}]]);}
 refresh();
}

function advancedPattern(frame,target,isNew,source,bgOpts=null){
 openSheet(bgOpts?'Background pattern':'Shapes and multicolor patterns');let b=$('sheetBody'),s=normalizeSource(source),view=el('div',undefined,'wall miniPreview');
 if(!bgOpts&&!isNew){let tools=el('div',undefined,'advancedPattern');tools.append(button('Background layer',()=>openBackgroundEditor(clone(frame))));b.append(tools);}
 const opts=[['solid','Solid'],['gradient','Gradient'],['checker','Checkerboard'],['stripes','Stripes'],['border','Border'],['diamonds','Diamond bands'],['zigzag','Zigzag stripes'],['dots','Dots'],['heart','Hearts'],['star','Stars'],['circle','Circles'],['square','Squares'],['diamond','Diamonds'],['triangle','Triangles'],['arrow','Arrows']];
 let type=select(opts,s.pattern),placement=select([['span','Span wall'],['repeat','Repeat on each display'],['0','Display 1'],['1','Display 2'],['2','Display 3'],['3','Display 4']],target);
 b.append(field('Pattern / shape',type),field('Placement',placement));let controls=el('div');b.append(controls,view);
 let advancedSession={advanced:true};editorSession=advancedSession;let revision=0;
 function candidate(){
  let f=clone(frame),dest=placement.value;
  if(bgOpts){
   if(dest==='span'||dest==='repeat'){f.bgMode=dest;f.bgSource=clone(s);f.bgPanels=[null,null,null,null];}
   else{if(f.bgMode!=='panels')f.bgPanels=[null,null,null,null];f.bgMode='panels';f.bgSource=null;f.bgPanels[Number(dest)]=clone(s);}
   return f;
  }
  if(dest==='span'||dest==='repeat'){f.mode=dest;f.source=clone(s);f.panels=[null,null,null,null];}
  else{if(typeof target==='string')f.panels=[null,null,null,null];else if(Number(dest)!==target)f.panels[target]=null;f.mode='panels';f.source=null;f.panels[Number(dest)]=clone(s);}
  return f;
 }
 async function refresh(){let rev=++revision;try{let f=candidate(),stepIdx=isNew?current.steps.length:Math.max(0,current.steps.findIndex(x=>x.id===f.id));await regenerate(f,db.layout,stepIdx);if(rev!==revision||editorSession!==advancedSession)return;let w=makeWall(f,db.layout,false);view.style.gridTemplateColumns=w.style.gridTemplateColumns;view.replaceChildren(...Array.from(w.children));queueTiles(f.tiles);}catch(e){notify(e.message);}}
 function number(label,key,min,max){
  let lbl=el('label',undefined,'calRow'),top=el('span',label),val=el('b',s[key]+' px');
  top.append(val);
  let n=document.createElement('input');n.type='range';n.min=min;n.max=max;n.step=1;n.value=s[key];
  n.oninput=()=>{s[key]=Math.max(min,Math.min(max,Math.round(Number(n.value)||min)));val.textContent=s[key]+' px';refresh();};
  lbl.append(top,n);controls.append(lbl);
 }
 function choiceSlider(label,options,key){
  let lbl=el('label',undefined,'calRow'),top=el('span',label),idx=Math.max(0,options.findIndex(o=>String(o[0])===String(s[key])));
  let val=el('b',options[idx][1]);top.append(val);
  let r=document.createElement('input');r.type='range';r.min=0;r.max=options.length-1;r.step=1;r.value=idx;
  r.oninput=()=>{let chosen=options[Number(r.value)]||options[0];s[key]=chosen[0];val.textContent=chosen[1];refresh();};
  lbl.append(top,r);controls.append(lbl);
 }
 function check(label,key,onExtra){let n=document.createElement('input');n.type='checkbox';n.checked=!!s[key];n.onchange=()=>{s[key]=n.checked;if(key==='outline'||onExtra)rebuild();refresh();};controls.append(field(label,n));}
 function swapColors(from,to){if(from<0||from>=s.colors.length||to<0||to>=s.colors.length||from===to)return;let [m]=s.colors.splice(from,1);s.colors.splice(to,0,m);s.a=s.colors[0];s.b=s.colors[1]||s.a;rebuild();refresh();}
 let colorDrag=null;
 function startColorDrag(e,index,item){if(e.button!==0&&e.pointerType==='mouse')return;colorDrag={index,item,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,active:false,targetIndex:index};try{item.setPointerCapture(e.pointerId);}catch(_){}}
 function moveColorDrag(e){if(!colorDrag||e.pointerId!==colorDrag.pointerId)return;if(!colorDrag.active){if(Math.hypot(e.clientX-colorDrag.startX,e.clientY-colorDrag.startY)<5)return;colorDrag.active=true;colorDrag.item.classList.add('dragging');}let hit=document.elementFromPoint(e.clientX,e.clientY),target=hit?hit.closest('.colorItem'):null;document.querySelectorAll('.colorItem').forEach(n=>n.classList.remove('dropTarget'));if(target&&target.dataset.index!==undefined){colorDrag.targetIndex=Number(target.dataset.index);if(colorDrag.targetIndex!==colorDrag.index)target.classList.add('dropTarget');}else colorDrag.targetIndex=colorDrag.index;}
 function endColorDrag(e){if(!colorDrag||e.pointerId!==colorDrag.pointerId)return;let {index,targetIndex,active,item}=colorDrag;colorDrag=null;item.classList.remove('dragging');document.querySelectorAll('.colorItem').forEach(n=>n.classList.remove('dropTarget'));try{item.releasePointerCapture(e.pointerId);}catch(_){}if(active&&targetIndex!==index&&targetIndex>=0&&targetIndex<s.colors.length)swapColors(index,targetIndex);}
 async function generateFullCycle(){
  if(busy||working)return;
  let count=s.colors.length;
  if(count<2)return notify('Add at least 2 colors to generate a cycle.');
  s.cycle=true;working=true;
  try{
   let f=candidate();
   let startIdx;
   if(isNew){
    if(current.steps.length+count>200)throw Error('Exceeds maximum 200 steps');
    startIdx=current.steps.length;
    for(let k=0;k<count;k++){let step=clone(f);step.id=uid();await regenerate(step,db.layout,startIdx+k);current.steps.push(step);}
   }else{
    startIdx=current.steps.findIndex(x=>x.id===f.id);
    if(startIdx<0)throw Error('Step missing');
    if(startIdx+count>200)throw Error('Exceeds maximum 200 steps');
    current.steps[startIdx]=f;
    for(let k=1;k<count;k++){
     let targetIdx=startIdx+k;
     if(targetIdx>=current.steps.length)current.steps.push(clone(f));
     else{
      let dst=current.steps[targetIdx];
      if(bgOpts){dst.bgMode=f.bgMode;dst.bgSource=clone(f.bgSource);dst.bgPanels=clone(f.bgPanels);}
      else if(f.mode==='span'||f.mode==='repeat'){dst.mode=f.mode;dst.source=clone(f.source);dst.panels=[null,null,null,null];}
      else{if(dst.mode!=='panels'){dst.mode='panels';dst.source=null;}dst.panels[Number(placement.value)]=clone(s);}
     }
    }
    for(let k=0;k<count;k++)await regenerate(current.steps[startIdx+k],db.layout,startIdx+k);
   }
   selected=startIdx;revision++;working=false;closeSheet(false);changed();renderEditor();previewCurrent(true);
   notify('Generated '+count+'-step color cycle.');
  }catch(e){notify(e.message);}finally{working=false;}
 }
 function rebuild(){controls.replaceChildren();let shaped=['heart','star','circle','square','diamond','triangle','arrow','dots'].includes(s.pattern),colors=el('div',undefined,'colorRow');
  s.colors.forEach((color,i)=>{
   let isTrans=color==='transparent';
   let item=el('div',undefined,'colorItem');item.dataset.index=i;item.draggable=true;
   let header=el('div',undefined,'colorItemHeader'),handle=el('span','⠿','colorDragHandle'),label=el('span','#'+(i+1),'colorIndex'),nav=el('div',undefined,'colorNav');
   handle.title='Drag to reorder';
   let leftBtn=document.createElement('button');leftBtn.type='button';leftBtn.className='colorMoveBtn';leftBtn.textContent='◀';leftBtn.title='Move earlier';leftBtn.disabled=i===0;
   leftBtn.onclick=e=>{e.stopPropagation();swapColors(i,i-1);};
   let rightBtn=document.createElement('button');rightBtn.type='button';rightBtn.className='colorMoveBtn';rightBtn.textContent='▶';rightBtn.title='Move later';rightBtn.disabled=i===s.colors.length-1;
   rightBtn.onclick=e=>{e.stopPropagation();swapColors(i,i+1);};
   nav.append(leftBtn,rightBtn);header.append(handle,label,nav);
   let input=document.createElement('input');input.type='color';input.value=isTrans?'#000000':color;if(isTrans)input.classList.add('isTransparent');
   input.oninput=()=>{s.colors[i]=input.value;s.a=s.colors[0];s.b=s.colors[1]||s.a;refresh();};
   let transBtn=button('∅',e=>{e.stopPropagation();s.colors[i]=s.colors[i]==='transparent'?'#ffffff':'transparent';s.a=s.colors[0];s.b=s.colors[1]||s.a;rebuild();refresh();},'colorTransBtn'+(isTrans?' active':''));
   transBtn.title=isTrans?'Transparent (tap to set color)':'Make transparent';
   handle.onpointerdown=e=>startColorDrag(e,i,item);
   item.onpointermove=moveColorDrag;item.onpointerup=endColorDrag;item.onpointercancel=endColorDrag;
   item.ondragstart=e=>{e.dataTransfer.setData('text/plain',String(i));e.dataTransfer.effectAllowed='move';item.classList.add('dragging');};
   item.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.colorItem').forEach(n=>n.classList.remove('dropTarget'));item.classList.add('dropTarget');};
   item.ondragleave=()=>item.classList.remove('dropTarget');
   item.ondrop=e=>{e.preventDefault();item.classList.remove('dropTarget');let from=Number(e.dataTransfer.getData('text/plain'));if(Number.isFinite(from))swapColors(from,i);};
   item.ondragend=()=>{item.classList.remove('dragging');document.querySelectorAll('.colorItem').forEach(n=>n.classList.remove('dropTarget'));};
   item.append(header,input,transBtn);colors.append(item);
  });
  controls.append(colors);
  buttons(controls,[['Add color',()=>{if(s.colors.length<8){s.colors.push('#ffffff');rebuild();refresh();}}],['Remove last',()=>{if(s.colors.length>1){s.colors.pop();rebuild();refresh();}}]]);
  if(s.colors.length>1)controls.append(hint('Drag ⠿ or use ◀ / ▶ to reorder. Tap ∅ for transparent.'));
  if(s.pattern==='solid')controls.append(hint('Solid uses the first palette color.'));if(s.pattern==='border')controls.append(hint('Border uses the first color inside and second color on the edge.'));
  if(shaped){
   let bgTrans=s.background==='transparent';
   let bgRow=el('div',undefined,'bgColorRow');
   let bg=document.createElement('input');bg.type='color';bg.value=bgTrans?'#000000':s.background;if(bgTrans)bg.classList.add('isTransparent');bg.oninput=()=>{s.background=bg.value;refresh();};
   let bgTBtn=button(bgTrans?'Transparent (∅)':'Make transparent (∅)',()=>{s.background=s.background==='transparent'?'#000000':'transparent';rebuild();refresh();},'colorTransBtn'+(bgTrans?' active':''));
   bgRow.append(bg,bgTBtn);controls.append(field('Shape background',bgRow));
   choiceSlider('Direction / rotation',[[0,'Up / 0°'],[90,'Right / 90°'],[180,'Down / 180°'],[270,'Left / 270°']],'rotation');
   check('Repeat shapes in a grid','tiled');check('Outline instead of filled','outline');number('Spacing','spacing',0,32);
  }
  if(['gradient','stripes','zigzag'].includes(s.pattern))choiceSlider('Direction',[['horizontal','Horizontal'],['vertical','Vertical'],['diagonal','Diagonal'],['antidiagonal','Opposite diagonal']],'direction');
  if(!['solid','gradient'].includes(s.pattern))number(shaped?'Shape size':'Pattern width','size',1,64);
  if(s.outline||s.pattern==='border')number('Outline / border thickness','thickness',1,8);
  check('Rotate colors across steps','cycle',true);
  if(s.cycle&&s.colors.length>1)buttons(controls,[['Generate full cycle ('+s.colors.length+' steps)',generateFullCycle]]);
 }
 type.onchange=()=>{s.pattern=type.value;if(!s.size)s.size=4;rebuild();refresh();};placement.onchange=refresh;rebuild();
 buttons(b,[['Cancel',()=>{revision++;closeSheet(true);if(live)previewCurrent(true);}],['Done',async()=>{if(busy||working)return;working=true;try{let f=candidate();if(!bgOpts&&!isNew&&f.mode!=='panels'&&frame.mode==='panels'&&frame.panels.some((p,i)=>i!==target&&p)&&!confirm('Replace other panel images with this wall source?'))return;if(bgOpts){if(bgOpts.isNewStep){if(current.steps.length>=200)throw Error('Maximum 200 steps');await regenerate(f,db.layout,current.steps.length);current.steps.push(f);selected=current.steps.length-1;}else{let i=current.steps.findIndex(x=>x.id===f.id);if(i<0)throw Error('Step missing');await regenerate(f,db.layout,i);current.steps[i]=f;selected=i;}if(bgOpts.applyAll){for(let k=0;k<current.steps.length;k++){current.steps[k].bgMode=f.bgMode;current.steps[k].bgSource=clone(f.bgSource);current.steps[k].bgPanels=clone(f.bgPanels);await regenerate(current.steps[k],db.layout,k);}}}else if(isNew){if(current.steps.length>=200)throw Error('Maximum 200 steps');await regenerate(f,db.layout,current.steps.length);current.steps.push(f);selected=current.steps.length-1;}else{let i=current.steps.findIndex(x=>x.id===f.id);if(i<0)throw Error('Step missing');await regenerate(f,db.layout,i);current.steps[i]=f;selected=i;}revision++;working=false;closeSheet(false);changed();renderEditor();previewCurrent(true);}catch(e){notify(e.message);}finally{working=false;}},'primary']]);
 if(!isNew&&!bgOpts){b.append(el('div',undefined,'separator'));buttons(b,[['Remove pattern',()=>{if(!confirm('Remove this pattern?'))return;let i=current.steps.findIndex(f=>f.id===frame.id);if(i<0)return;if(typeof target==='string'){let prevBg={bgMode:current.steps[i].bgMode,bgSource:current.steps[i].bgSource,bgPanels:current.steps[i].bgPanels};current.steps[i]={...blankFrame(),id:frame.id,...prevBg};}else{current.steps[i].panels[target]=null;current.steps[i].tiles[target]='';}closeSheet(false);changed();renderEditor();previewCurrent(true);},'danger'],['Delete entire step',()=>deleteStep(frame.id),'danger']]);buttons(b,[['Move earlier',()=>{closeSheet();moveStep(frame.id,-1);}],['Move later',()=>{closeSheet();moveStep(frame.id,1);}]]);}
 refresh();
}

function openBackgroundEditor(frame,applyAllDefault=false,isNewStep=false){
 openSheet('Background layer');
 let b=$('sheetBody'),f=clone(frame);
 if(!f.bgMode)f.bgMode='none';
 if(!Array.isArray(f.bgPanels))f.bgPanels=[null,null,null,null];
 let session={bg:true,rev:0};editorSession=session;
 let bgType=select([['none','None (Black)'],['image','Image'],['pattern','Custom pattern / shapes']],f.bgMode==='none'?'none':((f.bgMode==='panels'?f.bgPanels.find(Boolean):f.bgSource)?.type||'image'));
 let placement=select([['span','Span across all four'],['repeat','Repeat on all four'],['0','Display 1'],['1','Display 2'],['2','Display 3'],['3','Display 4']],f.bgMode==='none'?'span':f.bgMode==='panels'?Math.max(0,f.bgPanels.findIndex(Boolean)):f.bgMode);
 let controls=el('div'),view=el('div',undefined,'wall miniPreview');
 b.append(field('Background type',bgType),field('Background placement',placement),controls,view);
 let activeBgSrc=(f.bgMode==='panels'?f.bgPanels.find(Boolean):f.bgSource)||null;
 function syncFrame(){
  let out=clone(f),t=bgType.value,dest=['span','repeat'].includes(placement.value)?placement.value:Number(placement.value);
  if(t==='none'||!activeBgSrc){out.bgMode='none';out.bgSource=null;out.bgPanels=[null,null,null,null];}
  else if(typeof dest==='string'){out.bgMode=dest;out.bgSource=clone(activeBgSrc);out.bgPanels=[null,null,null,null];}
  else{out.bgMode='panels';out.bgSource=null;out.bgPanels=[0,1,2,3].map(i=>i===dest?clone(activeBgSrc):null);}
  return out;
 }
 async function refresh(){
  let rev=++session.rev;
  try{
   let cand=syncFrame(),idx=Math.max(0,current.steps.findIndex(x=>x.id===cand.id));
   await regenerate(cand,db.layout,idx);
   if(editorSession!==session||rev!==session.rev)return;
   let w=makeWall(cand,db.layout,false);view.style.gridTemplateColumns=w.style.gridTemplateColumns;view.replaceChildren(...Array.from(w.children));
   queueTiles(cand.tiles,[0,1,2,3],false,true);
  }catch(e){notify(e.message);}
 }
 function rebuild(){
  controls.replaceChildren();
  placement.parentElement.hidden=bgType.value==='none';
  if(bgType.value==='none')return;
  if(bgType.value==='image'){
   let pickBgGif=next=>{
    let dest=['span','repeat'].includes(placement.value)?placement.value:Number(placement.value);
    let idx=isNewStep?current.steps.length:Math.max(0,current.steps.findIndex(x=>x.id===f.id));
    openGifEditor({groupId:null,target:dest,layer:'bg',insertIndex:idx,isNew:isNewStep,frames:next.frames,fit:next.fit||db.defaults.fit,smooth:db.defaults.smooth,alignX:0.5,alignY:0.5,truncated:next.truncated});
   };
   if(activeBgSrc&&activeBgSrc.gifGroupId&&current.gifGroups&&current.gifGroups[activeBgSrc.gifGroupId]){
    let g=current.gifGroups[activeBgSrc.gifGroupId];
    buttons(controls,[['Edit background GIF',()=>openGifEditor({groupId:g.id,target:g.target,layer:'bg',insertIndex:Math.max(0,current.steps.findIndex(x=>x.id===f.id)),isNew:false,frames:clone(g.frames),fit:g.fit,smooth:g.smooth,alignX:g.alignX??0.5,alignY:g.alignY??0.5,truncated:false}),'primary']]);
   }
   if(!activeBgSrc||activeBgSrc.type!=='image'){
    buttons(controls,[['Choose background image',()=>pickImage(next=>{if(next.type==='gif'){pickBgGif(next);return;}activeBgSrc=next;rebuild();refresh();}),'primary']]);
   }else{
    let img=el('img',undefined,'sourcePreview');img.src=activeBgSrc.src;img.alt='Background';controls.append(img);
    buttons(controls,[['Change image',()=>pickImage(next=>{if(next.type==='gif'){pickBgGif(next);return;}activeBgSrc=next;rebuild();refresh();})]]);
    let fit=select(FIT_OPTS,activeBgSrc.fit);fit.onchange=()=>{activeBgSrc.fit=fit.value;refresh();};
    let smooth=document.createElement('input');smooth.type='checkbox';smooth.checked=activeBgSrc.smooth;smooth.onchange=()=>{activeBgSrc.smooth=smooth.checked;refresh();};
    let chk=el('label',undefined,'check');chk.append(smooth,document.createTextNode('Smooth resizing'));
    controls.append(field('Image fitting',fit));
    imageAlignControls(controls,activeBgSrc,refresh);
    controls.append(chk);
   }
  }else{
   if(!activeBgSrc||activeBgSrc.type!=='pattern')activeBgSrc=patternSpec();
   buttons(controls,[['Edit pattern & colors',()=>{
    let cand=syncFrame();
    advancedPattern(cand,placement.value==='span'||placement.value==='repeat'?placement.value:Number(placement.value),false,activeBgSrc,{applyAll:applyAllDefault});
   },'primary']]);
  }
 }
 bgType.onchange=()=>{if(bgType.value==='pattern'&&(!activeBgSrc||activeBgSrc.type!=='pattern'))activeBgSrc=patternSpec();rebuild();refresh();};
 placement.onchange=refresh;
 rebuild();
 async function commitBg(allSteps){
  if(working||busy)return;
  working=true;
  try{
   let cand=syncFrame();
   if(allSteps){
    for(let k=0;k<current.steps.length;k++){
     current.steps[k].bgMode=cand.bgMode;current.steps[k].bgSource=clone(cand.bgSource);current.steps[k].bgPanels=clone(cand.bgPanels);
     await regenerate(current.steps[k],db.layout,k);
    }
   }else if(isNewStep){
    if(current.steps.length>=200)throw Error('Maximum 200 steps');
    await regenerate(cand,db.layout,current.steps.length);
    current.steps.push(cand);selected=current.steps.length-1;
   }else{
    let i=current.steps.findIndex(x=>x.id===cand.id);
    if(i<0)throw Error('Step missing');
    await regenerate(cand,db.layout,i);
    current.steps[i]=cand;selected=i;
   }
   working=false;closeSheet(false);changed();renderEditor();previewCurrent(true);
  }catch(e){notify(e.message);}finally{working=false;}
 }
 buttons(b,[['Cancel',()=>closeSheet(true)],['Apply to this step',()=>commitBg(false),applyAllDefault?'':'primary'],['Apply to all steps',()=>commitBg(true),applyAllDefault?'primary':'']]);
 refresh();
}

async function deleteStep(id){if(busy||working||!confirm('Delete this entire step?'))return;current.steps=current.steps.filter(f=>f.id!==id);selected=Math.min(selected,Math.max(0,current.steps.length-1));await refreshCyclingSteps();closeSheet(false);changed();renderEditor();previewCurrent(true);}
async function moveStep(id,delta){let i=current.steps.findIndex(f=>f.id===id),dest=i+delta;if(i<0||dest<0||dest>=current.steps.length)return;let f=current.steps.splice(i,1)[0];current.steps.splice(dest,0,f);selected=dest;await refreshCyclingSteps();changed();renderEditor();previewCurrent();}
function stepOptions(id){
 if(busy||working)return;let f=current.steps.find(x=>x.id===id);if(!f)return;openSheet('Step '+(current.steps.indexOf(f)+1));let b=$('sheetBody');
 if(f.mode!=='panels')buttons(b,[['Edit source',()=>openSource(id,0),'primary']]);
 else{let positions=el('div',undefined,'placement');for(let i=0;i<4;i++)positions.append(button('Display '+(i+1),()=>openSource(id,i)));b.append(positions);}
 buttons(b,[['Background layer',()=>openBackgroundEditor(clone(f))]]);
 buttons(b,[['Move earlier',()=>{closeSheet(false);moveStep(id,-1);}],['Move later',()=>{closeSheet(false);moveStep(id,1);}]]);
 buttons(b,[['Duplicate',async()=>{if(current.steps.length>=200)return;let copy=clone(f);copy.id=uid();let i=current.steps.findIndex(x=>x.id===id);current.steps.splice(i+1,0,copy);selected=i+1;await refreshCyclingSteps();closeSheet(false);changed();renderEditor();previewCurrent(true);}],['Delete step',()=>deleteStep(id),'danger']]);
}

function saveSequence(){
 if(busy||working)return;current.name=$('sequenceName').value.trim()||'Untitled';current.cols=db.layout;
 let old=clone(db.sequences),wasDirty=dirty,i=db.sequences.findIndex(s=>s.id===current.id);
 if(i<0)db.sequences.push(clone(current));else db.sequences[i]=clone(current);
 dirty=false;db.draft={sequence:clone(current),selected,dirty};clearTimeout(saveTimer);
 if(!store()){db.sequences=old;dirty=wasDirty;return;}updateSaveState();notify('Saved to Library.');
}

function newSequence(){if(busy||working)return;if(current.steps.length&&dirty&&!confirm('Start a new sequence? Save the current draft to Library first to keep it.'))return;pausePlayback();current=blankSequence();selected=0;dirty=true;imageCache.clear();renderEditor();showPage('editor');draftSoon();previewCurrent(true);}

async function changeLayout(){
 if(busy||working)return;let cols=Number($('layout').value);if(cols===db.layout)return;
 if(!confirm('Change arrangement for all sequences and re-split spanning sources?')){$('layout').value=db.layout;return;}
 pausePlayback();working=true;let old={layout:db.layout,sequences:clone(db.sequences),current:clone(current)};
 try{
  let saved=clone(db.sequences),draft=clone(current);
  for(let seq of [...saved,draft]){seq.cols=cols;for(let f of seq.steps)if(f.mode==='span')await regenerate(f,cols);}
  db.layout=cols;db.sequences=saved;current=draft;changed();flushDraft();renderEditor();renderAssignments();previewCurrent(true);notify('Display arrangement updated.');
 }catch(e){db.layout=old.layout;db.sequences=old.sequences;current=old.current;$('layout').value=db.layout;renderAssignments();notify('Layout change failed: '+e.message);}
 finally{working=false;}
}

function renderLibrary(){
 let list=$('libraryList'),scroll=list.scrollTop;list.replaceChildren();
 if(!db.sequences.length)list.append(hint('No saved sequences. Use Save in the editor.'));
 db.sequences.forEach(s=>{
  let card=el('article',undefined,'libraryCard');card.dataset.id=s.id;
  let title=el('div',undefined,'row');title.append(el('h3',s.name),el('small',s.steps.length+' steps','muted'));card.append(title);
  let strip=el('div',undefined,'filmstrip');s.steps.forEach((f,i)=>{let frame=el('div',undefined,'filmFrame');frame.append(el('small',String(i+1)),makeWall(f,2,false));strip.append(frame);});card.append(strip);
  let row=el('div',undefined,'row');
  row.append(button('Open',()=>{if(busy||working)return;if(dirty&&current.steps.length&&!confirm('Replace the active draft with this saved sequence?'))return;pausePlayback();current=clone(s);selected=0;dirty=false;imageCache.clear();renderEditor();showPage('editor');draftSoon();previewCurrent(true);}),button('Preview on displays',()=>startPlayback('library',s),'primary'),button('More',()=>libraryOptions(s)));
  row.querySelectorAll('button').forEach(b=>b.disabled=busy);card.append(row);list.append(card);
 });
 list.scrollTop=scroll;updateLibraryPlayback();
}

function libraryOptions(s){
 if(busy||working)return;openSheet(s.name);let b=$('sheetBody');
 buttons(b,[['Duplicate',()=>{let copy=clone(s);copy.id=uid();copy.name+=' (copy)';db.sequences.push(copy);if(!store())db.sequences.pop();closeSheet(false);renderLibrary();}],['Rename',()=>{b.replaceChildren();let input=document.createElement('input');input.value=s.name;input.maxLength=100;b.append(field('Name',input));buttons(b,[['Cancel',()=>closeSheet()],['Save',()=>{let old=s.name;s.name=input.value.trim()||'Untitled';if(!store()){s.name=old;return;}if(current.id===s.id){current.name=s.name;renderEditor();draftSoon();}closeSheet(false);renderLibrary();},'primary']]);}]]);
 buttons(b,[['Delete sequence',()=>{if(!confirm('Delete this saved sequence? The active draft will remain.'))return;let old=db.sequences;db.sequences=db.sequences.filter(x=>x.id!==s.id);if(!store()){db.sequences=old;return;}if(current.id===s.id){dirty=true;draftSoon();}closeSheet(false);renderLibrary();},'danger']]);
}

function address(i){return db.assignments[i]||'';}
function record(i){return (db.stored||{})[address(i)]||{status:'unknown',images:[],updated:null};}
function statusText(r){return ({tracked:'Tracked (not read back)',partial:'Partially tracked',uncertain:'Uncertain — upload interrupted',unknown:'Contents unknown'})[r.status]||'Contents unknown';}
function ensureStorage(){if(!db.stored||typeof db.stored!=='object'||Array.isArray(db.stored))db.stored={};}

function validStorage(value){
 let out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;
 for(let [key,r] of Object.entries(value)){
  if(!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(key)||!r||!Array.isArray(r.images)||r.images.length>10000)continue;
  let images=r.images.map(t=>{if(!t||!(t.tile===''||imageData(t.tile)))throw Error('Invalid tracked image');return {id:typeof t.id==='string'?t.id:uid(),tile:t.tile,name:typeof t.name==='string'?t.name.slice(0,150):'Image'};});
  out[key]={status:['tracked','partial','uncertain','unknown'].includes(r.status)?r.status:'unknown',images,updated:typeof r.updated==='string'?r.updated:null};
 }
 return out;
}

function exportLibrary(){
 if(busy||working)return;flushDraft();
 Native.exportLibrary(JSON.stringify({version:3,appVersion:APP_VERSION,layout:db.layout,previewSeconds:db.previewSeconds,defaults:db.defaults,calibration:db.calibration,sequences:db.sequences,draft:db.draft,stored:db.stored}));
 notify('Backup includes library, draft, and storage records keyed by display Bluetooth address. Assignments are not changed on import.');
}

async function receiveBackup(text){
 if(busy||working)return notify('Wait for the current operation.');
 try{
  let v=JSON.parse(text);
  if(![1,2,3].includes(v.version)||!Array.isArray(v.sequences)||v.sequences.length>500)throw Error('Unsupported backup');
  let incoming=v.sequences.map(normalizeSequence);
  if(v.draft&&v.draft.sequence){
   let d=normalizeSequence(v.draft.sequence);
   if(d.steps.length&&!incoming.some(s=>JSON.stringify(s)===JSON.stringify(d))){d.name+=' (draft backup)';incoming.push(d);}
  }
  if(!confirm('Import '+incoming.length+' sequences? Existing sequences and active draft stay unchanged.'))return;
  working=true;
  for(let s of incoming){s.id=uid();s.cols=db.layout;for(let f of s.steps){f.id=uid();if(f.mode!=='panels')await regenerate(f);}}
  let old=db.sequences;db.sequences=db.sequences.concat(incoming);
  if(!store()){db.sequences=old;return;}
  working=false;
  renderLibrary();showPage('library');
  notify('Backup imported. Old backups keep their rendered tiles, not lost source detail.');
  if(v.stored){
   try{
    let incStored=validStorage(v.stored);
    if(Object.keys(incStored).length&&confirm('Also import stored-image records? Imported records will be marked uncertain until you rebuild or check the physical displays. Existing records for matching addresses will be replaced.')){
     ensureStorage();
     for(let r of Object.values(incStored))r.status='uncertain';
     db.stored={...db.stored,...incStored};store();
    }
   }catch(e){notify('Sequences imported; storage records rejected: '+e.message);}
  }
 }catch(e){notify('Import failed: '+e.message);}
 finally{working=false;}
}

function renderAssignments(){
 let out=$('assignments');out.replaceChildren();
 out.className='assignmentsGrid';
 out.style.display='grid';
 out.style.gridTemplateColumns='repeat('+db.layout+',minmax(0,1fr))';
 out.style.gap='10px';
 for(let i=0;i<4;i++){
  let c=el('article',undefined,'deviceCard');
  c.append(el('h3','Display '+(i+1)),el('p',db.assignments[i]||'Not assigned','muted'));
  let state=el('p',states[i],'deviceStatus');state.id='status'+i;c.append(state);
  let row=el('div',undefined,'row');
  row.append(button('Scan / assign',()=>scanFor(i)),button('Forget',()=>{if(!confirm('Forget this assignment and close all connections?'))return;setLive(false);Native.disconnect();db.assignments[i]='';store();renderAssignments();}));
  c.append(row);out.append(c);
 }
}

function scanFor(i){
 if(busy||working)return;scanSlot=i;openSheet('Choose device for Display '+(i+1));scanSession=true;let b=$('sheetBody');
 b.append(hint('Showing nearby MI Matrix Display devices.'));
 let state=el('p','Scanning…');state.id='scanState';let devices=el('div');devices.id='scanDevices';b.append(state,devices);
 buttons(b,[['Rescan',()=>{clearDevices();Native.scan();}],['Cancel',()=>closeSheet(false)]]);
 Native.scan();
}

function clearDevices(){let n=$('scanDevices');if(n)n.replaceChildren();let s=$('scanState');if(s)s.textContent='Scanning for 10 seconds…';}
function scanFinished(){let s=$('scanState'),d=$('scanDevices');if(s)s.textContent=d&&d.children.length?'Select a device, or rescan.':'No MI Matrix Displays found. Check power/Bluetooth and rescan.';}
function deviceFound(address,name){
 if(!scanSession)return;
 let lower=(name+' '+address).toLowerCase();
 if(!lower.includes('mi matrix display'))return;
 let out=$('scanDevices');if(!out)return;
 out.append(button(name+' · '+address,()=>{if(db.assignments.some((a,i)=>i!==scanSlot&&a===address))return notify('Already assigned to another slot.');let slot=scanSlot;db.assignments[slot]=address;store();closeSheet(false);renderAssignments();Native.connectDisplay(slot,address);},'scanDevice'));
}

function setStatus(i,text,isReady=false){
 let was=ready[i];states[i]=text;ready[i]=isReady;let n=$('status'+i);if(n)n.textContent=text;
 $('connectionBtn').textContent=ready.filter(Boolean).length+'/4';renderPreview();
 if(!was&&isReady&&live){lastTiles[i]=undefined;let f=playback?playback.sequence.steps[playback.index]:current.steps[selected];queueTiles(f?f.tiles:['','','',''],[i],true);}
 if(page==='stored')renderStored();
}

function reconnect(){if(busy)return;db.assignments.forEach((a,i)=>{if(a)Native.connectDisplay(i,a);});notify('Connecting saved displays. Check readiness in Displays.');}

function setBusy(value){
 busy=value;if(value){pausePlayback();clearPending();}
 document.querySelectorAll('main button,main input,main select,#saveBtn').forEach(n=>n.disabled=value);
 $('cancelTransfer').disabled=!value;$('transfer').hidden=!value;
 if(!value){renderGrid();renderPreview();if(live){clearPending();Native.setLive(true);previewCurrent(true);}}
 if(!$('sheet').hidden)closeSheet(false);
}

function progress(n,total){$('transferProgress').max=total;$('transferProgress').value=n;}
function transferLabel(text){$('transferText').textContent=text;}

function destGrid(chosen,onChange,allowDisconnected=false){
 let g=el('div',undefined,'destinationGrid');g.style.gridTemplateColumns='repeat('+db.layout+',minmax(0,1fr))';
 for(let i=0;i<4;i++){
  let n=button('',()=>{if(chosen.has(i))chosen.delete(i);else chosen.add(i);draw();onChange&&onChange();},'destination');
  function draw(){n.classList.toggle('chosen',chosen.has(i));n.setAttribute('aria-pressed',String(chosen.has(i)));n.replaceChildren(el('strong','Display '+(i+1)),el('small',ready[i]?'Connected':states[i]),el('small',record(i).status==='unknown'?'Unknown':record(i).images.length+' tracked'));n.disabled=!allowDisconnected&&!ready[i];}
  draw();g.append(n);
 }
 return g;
}

function chooseTargets(title,callback,extra){
 openSheet(title);let chosen=new Set(ready.flatMap((r,i)=>r?[i]:[])),b=$('sheetBody'),holder=el('div');
 function draw(){holder.replaceChildren(destGrid(chosen,draw));}
 b.append(hint('Select destinations. Only selected displays need to be connected. Spanning images keep their existing display sections.'),holder);draw();
 buttons(b,[['All connected',()=>{chosen=new Set(ready.flatMap((r,i)=>r?[i]:[]));draw();}],['Clear selection',()=>{chosen.clear();draw();}]]);
 if(extra)extra(b,()=>Array.from(chosen).sort());
 else buttons(b,[['Start selected slideshows',()=>{let ids=Array.from(chosen).sort();if(!ids.length)return notify('Select a connected display.');pausePlayback();setLive(false);closeSheet(false);Native.playSelected(JSON.stringify(ids));},'primary']]);
}

function sendPanel(){
 if(busy||working)return;if(!current.steps.length)return notify('Add a step first.');
 chooseTargets('Send stored slideshow',null,(b,getIds)=>{
  b.append(hint('Replace clears selected displays. Append keeps the existing device command sequence unchanged.'));
  let fastChk=document.createElement('input');fastChk.type='checkbox';fastChk.checked=fastUpload;fastChk.onchange=()=>{fastUpload=fastChk.checked;};
  let fastLbl=el('label',undefined,'check');fastLbl.append(fastChk,document.createTextNode('Fast parallel upload (test mode)'));
  b.append(fastLbl);
  buttons(b,[['Replace selected',()=>sendSelected(true,getIds()),'danger'],['Append to selected',()=>sendSelected(false,getIds())]]);
 });
}

async function sendSelected(replace,ids,custom=null){
 if(busy||working)return;if(!ids.length||ids.some(i=>!ready[i]))return notify('Select at least one ready display.');
 if(!confirm((replace?'Erase and replace images on ':'Append images to ')+ids.map(i=>'Display '+(i+1)).join(', ')+(replace?'? This cannot be undone.':'?')))return;
 const frames=custom?null:clone(current.steps);closeSheet(false);flushDraft();pausePlayback();setBusy(true);let oldStored;
 try{
  let rows=[],per={};
  if(custom){for(let i of ids)per[i]=custom.map(t=>t||'');}
  else for(let i of ids)per[i]=frames.map(f=>f.tiles[i]||'');
  let count=per[ids[0]].length;if(count<1||count>200)throw Error('Use 1–200 images');
  for(let f=0;f<count;f++){let row=[null,null,null,null];for(let i of ids)row[i]=await rgbTile(per[i][f]);rows.push(row);}
  ensureStorage();oldStored=clone(db.stored);let pending={};
  for(let i of ids){
   let key=address(i);if(!key)throw Error('Assign Display '+(i+1)+' before uploading.');
   let previous=record(i),images=per[i].map((tile,k)=>({id:uid(),tile,name:'Image '+(k+1)}));
   let complete=replace||previous.status==='tracked';
   let list=replace?images:((previous.status==='tracked'||previous.status==='partial')?[...previous.images,...images]:images);
   pending[i]={key,desired:{status:complete?'tracked':'partial',images:list,updated:new Date().toISOString()}};
   db.stored[key]={...clone(previous),status:'uncertain',pending:pending[i].desired};
  }
  db.pendingStorage=pending;
  if(!store()){db.stored=oldStored;delete db.pendingStorage;throw Error('Could not save tracking journal; upload not started.');}
  progress(0,1);Native.upload(JSON.stringify({frames:rows,targets:ids,fast:!!fastUpload}),replace);
 }catch(e){if(oldStored){db.stored=oldStored;delete db.pendingStorage;store();}setBusy(false);notify('Upload preparation failed: '+e.message);}
}

function storageDisplayComplete(i){ensureStorage();let entry=db.pendingStorage&&db.pendingStorage[i];if(entry){db.stored[entry.key]=entry.desired;delete db.pendingStorage[i];store();}if(page==='stored')renderStored();}
function storageUploadFinished(){delete db.pendingStorage;store();if(page==='stored')renderStored();}

function renderStored(){
 let out=$('storedContent');if(!out)return;out.replaceChildren();
 let chooser=el('div',undefined,'destinationGrid');chooser.style.gridTemplateColumns='repeat('+db.layout+',minmax(0,1fr))';
 for(let i=0;i<4;i++){
  let r=record(i),n=button('',()=>{if(storageDraft&&!confirm('Discard unapplied edits?'))return;storedSlot=i;storageDraft=null;renderStored();},'destination'+(i===storedSlot?' chosen':''));
  n.append(el('strong','Display '+(i+1)),el('small',ready[i]?'Connected':'Disconnected'),el('small',r.status==='unknown'?'Unknown':r.images.length+' tracked'));
  chooser.append(n);
 }
 out.append(chooser);
 let key=address(storedSlot),r=record(storedSlot);
 out.append(el('h2','Display '+(storedSlot+1)),hint(statusText(r)+(r.updated?' · '+new Date(r.updated).toLocaleString():'')),hint('App-maintained records, not device read-back. Changes from another controller are not detected. Unknown prior images cannot be recovered here.'));
 if(!key){out.append(hint('Assign a physical display in Displays first.'));return;}
 if(r.status==='uncertain')out.append(hint('The last transfer may have changed device contents. The list below is the previous record, not a verified current list. Rebuild from a complete collection to establish tracking.'));
 let images=storageDraft||r.images,bar=el('div',undefined,'row');out.append(bar);
 if(storageDraft){
  bar.append(button('Discard edits',()=>{storageDraft=null;renderStored();}),button('Apply to Display '+(storedSlot+1),()=>{if(!storageDraft.length)return notify('An empty draft cannot be uploaded. Keep at least one image.');if(!ready[storedSlot])return notify('Connect this display first.');let tiles=storageDraft.map(t=>t.tile),i=storedSlot;sendSelected(true,[i],tiles);storageDraft=null;renderStored();},'danger'),button('Add from library',addStoredFromLibrary));
  out.append(hint('Local draft only. Applying erases and rewrites this display’s complete stored list.'));
 }else{
  let edit=button('Edit collection',()=>{if(r.status!=='tracked'&&!confirm('This collection is not complete or certain. Applying an edited list will erase any other images on this display. Continue?'))return;storageDraft=clone(r.images);renderStored();});
  bar.append(edit,button('Add from library',()=>{if(r.status!=='tracked'&&!confirm('Build a replacement list? Any untracked images will be erased when you apply it.'))return;storageDraft=clone(r.images);addStoredFromLibrary();}),button('Start slideshow',()=>{if(!ready[storedSlot])return notify('Connect this display first.');setLive(false);Native.playSelected(JSON.stringify([storedSlot]));}));
 }
 let grid=el('div',undefined,'storedGrid');
 images.forEach((item,index)=>{
  let card=el('article',undefined,'storedCard'),preview=button('',()=>{openSheet('Image '+(index+1)+' · Display '+(storedSlot+1));let img=el('img',undefined,'storedLarge');img.src=item.tile||blackTile();img.alt='Stored image';$('sheetBody').append(img,hint(item.name||''));if(!storageDraft)buttons($('sheetBody'),[['Copy to another display',()=>copyStoredImage(item)]]);});
  let img=el('img');img.src=item.tile||blackTile();img.alt='Image '+(index+1);preview.append(img);card.append(preview,el('small',String(index+1)));
  if(storageDraft){
   let row=el('div',undefined,'row'),up=button('Earlier',()=>{[storageDraft[index-1],storageDraft[index]]=[storageDraft[index],storageDraft[index-1]];renderStored();}),down=button('Later',()=>{[storageDraft[index+1],storageDraft[index]]=[storageDraft[index],storageDraft[index+1]];renderStored();});
   up.disabled=index===0;down.disabled=index===images.length-1;row.append(up,down,button('Remove',()=>{storageDraft.splice(index,1);renderStored();},'danger'));card.append(row);
  }
  grid.append(card);
 });
 out.append(grid);
 if(!images.length)out.append(hint('No images tracked for this display. Existing device contents may still be present.'));
}

function addStoredFromLibrary(){
 if(busy||working)return;openSheet('Add from a saved sequence');let b=$('sheetBody');b.append(hint('Adds this display’s rendered tile from each sequence step to the local replacement draft.'));
 if(!db.sequences.length)b.append(hint('Save a sequence to Library first.'));
 for(let seq of db.sequences)b.append(button(seq.name+' · '+seq.steps.length+' images',()=>{if((storageDraft||[]).length+seq.steps.length>200)return notify('Maximum 200 images per rewritten collection.');storageDraft=storageDraft||[];storageDraft.push(...seq.steps.map((f,k)=>({id:uid(),tile:f.tiles[storedSlot]||'',name:seq.name+' / '+(k+1)})));closeSheet(false);renderStored();}));
}

function copyStoredImage(item){
 openSheet('Copy image to a display draft');let b=$('sheetBody');
 for(let i=0;i<4;i++)if(i!==storedSlot){
  b.append(button('Display '+(i+1),()=>{let r=record(i);if(!address(i))return notify('Assign this display first.');if(r.images.length>=200)return notify('Destination already has 200 tracked images.');if(r.status!=='tracked'&&!confirm('Destination contents are not fully known. Applying its draft will replace all its device images. Continue?'))return;storedSlot=i;storageDraft=clone(r.images);storageDraft.push({...clone(item),id:uid()});closeSheet(false);showPage('stored');}));
 }
}

let drag=null,suppressClick=false,suppressTimer=null;
function dragStart(e,card){
 if(drag||busy||working||e.button!==0)return;
 let rect=card.getBoundingClientRect();
 drag={id:card.dataset.id,card,rect,x:e.clientX,y:e.clientY,lastY:e.clientY,pointer:e.pointerId,active:false,scrolling:false,target:null};
 drag.hold=setTimeout(()=>{
  if(!drag)return;let wasPlaying=!!playback;if(wasPlaying)pausePlayback();
  drag.active=true;drag.ghost=card.cloneNode(true);drag.ghost.classList.add('dragging');drag.ghost.setAttribute('aria-hidden','true');
  drag.ghost.style.width=rect.width+'px';drag.ghost.style.left=rect.left+'px';drag.ghost.style.top=rect.top+'px';
  document.body.append(drag.ghost);card.style.opacity='.3';suppressClick=true;if(navigator.vibrate)navigator.vibrate(25);
 },450);
}
function dragMove(e){
 if(!drag||e.pointerId!==drag.pointer)return;
 let dist=Math.hypot(e.clientX-drag.x,e.clientY-drag.y),grid=$('storyboard');
 if(!drag.active){if(dist>9||drag.scrolling){clearTimeout(drag.hold);drag.scrolling=true;suppressClick=true;e.preventDefault();grid.scrollTop+=drag.lastY-e.clientY;drag.lastY=e.clientY;}return;}
 e.preventDefault();drag.ghost.style.left=(drag.rect.left+e.clientX-drag.x)+'px';drag.ghost.style.top=(drag.rect.top+e.clientY-drag.y)+'px';
 document.querySelectorAll('.dropTarget').forEach(n=>n.classList.remove('dropTarget'));
 let hit=document.elementFromPoint(e.clientX,e.clientY),card=hit&&hit.closest('.stepCard'),add=hit&&hit.closest('#addCard');
 drag.target=card?card.dataset.id:add?'end':null;if(card&&card.dataset.id!==drag.id)card.classList.add('dropTarget');if(add)add.classList.add('dropTarget');
 let r=grid.getBoundingClientRect();if(e.clientY>r.bottom-40)grid.scrollTop+=10;else if(e.clientY<r.top+40)grid.scrollTop-=10;
}
async function dragEnd(e){
 if(!drag||e.pointerId!==drag.pointer)return;
 let d=drag;drag=null;clearTimeout(d.hold);
 if(d.active){e.preventDefault();d.card.style.opacity='';d.ghost.remove();document.querySelectorAll('.dropTarget').forEach(n=>n.classList.remove('dropTarget'));if(e.type!=='pointercancel'&&d.target&&d.target!==d.id){let from=current.steps.findIndex(f=>f.id===d.id),to=d.target==='end'?current.steps.length-1:current.steps.findIndex(f=>f.id===d.target);if(from>=0&&to>=0&&from!==to){let f=current.steps.splice(from,1)[0];current.steps.splice(to,0,f);selected=to;await refreshCyclingSteps();changed();renderEditor();previewCurrent();}}}
 if(d.active||d.scrolling){clearTimeout(suppressTimer);suppressTimer=setTimeout(()=>suppressClick=false,400);}
}

function bind(id,fn){let el=$(id);if(el)el.addEventListener('click',fn);}

async function init(){
 ensureStorage();
 try{
  let v=JSON.parse(Native.load());
  if([1,2,3].includes(v.version)&&Array.isArray(v.sequences)){
   db.sequences=v.sequences.map(normalizeSequence);
   if(Array.isArray(v.assignments)&&v.assignments.length===4)db.assignments=v.assignments.map(a=>typeof a==='string'?a:'');
   if([1,2,4].includes(v.layout))db.layout=v.layout;
   if(v.editorView&&['all','separate'].includes(v.editorView))db.editorView=v.editorView;
   if(v.defaults&&['contain','cover','stretch'].includes(v.defaults.fit))db.defaults={fit:v.defaults.fit,smooth:!!v.defaults.smooth};
   if(v.calibration&&typeof v.calibration==='object'){
    db.calibration={
     gamma:Math.max(1,Math.min(3,Number(v.calibration.gamma)||2.2)),
     cutoff:Math.max(0,Math.min(128,Math.round(Number(v.calibration.cutoff)||0))),
     brightness:Math.max(10,Math.min(100,Math.round(Number(v.calibration.brightness)||100)))
    };
   }
   if(Number.isFinite(v.previewSeconds))db.previewSeconds=Math.max(.1,Math.min(30,v.previewSeconds));
   if(v.draft&&v.draft.sequence){
    current=normalizeSequence(v.draft.sequence);
    selected=Math.min(Math.max(0,Number(v.draft.selected)||0),Math.max(0,current.steps.length-1));
    dirty=!!v.draft.dirty;
    if(v.version===2&&Number.isFinite(v.draft.previewSeconds))db.previewSeconds=Math.max(.1,Math.min(30,v.draft.previewSeconds));
   }
  }
  db.stored=validStorage(v.stored);
  if(v.pendingStorage){
   for(let item of Object.values(v.pendingStorage))if(item&&db.stored[item.key])db.stored[item.key].status='uncertain';
  }
 }catch(e){log('Could not load saved data: '+e.message);}
 if(!current)current=blankSequence();
 if(!db.editorView)db.editorView='all';
 bind('menuBtn',openDrawer);
 bind('drawerShade',closeDrawer);
 document.querySelectorAll('[data-page]').forEach(n=>n.onclick=()=>showPage(n.dataset.page));
 bind('closeSheetBtn',()=>closeSheet(true));
 bind('sheetShade',()=>closeSheet(true));
 bind('saveBtn',saveSequence);
 bind('newBtn',newSequence);
 bind('viewToggleBtn',toggleEditorView);
 bind('libraryNewBtn',newSequence);
 bind('playBtn',()=>startPlayback('editor',current));
 bind('fasterBtn',()=>changeSpeed(-.1));
 bind('slowerBtn',()=>changeSpeed(.1));
 bind('connectionBtn',()=>showPage('devices'));
 bind('sendBtn',sendPanel);
 bind('storedPlayBtn',()=>{if(!busy&&!working)chooseTargets('Start stored slideshow');});
 bind('cancelTransfer',()=>Native.cancel());
 bind('exportBtn',exportLibrary);
 bind('importBtn',()=>Native.importLibrary());
 bind('stopLibraryBtn',()=>{pausePlayback();setLive(false);});
 bind('reconnectBtn',reconnect);
 bind('disconnectBtn',()=>{pausePlayback();setLive(false);Native.disconnect();});
 bind('clearLogBtn',()=>{$('log').textContent='';});
 bind('checkUpdateBtn',()=>{if(Native.checkUpdate){notify('Checking for updates…');Native.checkUpdate(false);}else notify('Updates require the Android app.');});
 $('sequenceName').oninput=()=>{current.name=$('sequenceName').value.slice(0,100);changed();};
 $('liveToggle').onchange=()=>setLive($('liveToggle').checked);
 $('layout').value=db.layout;
 $('layout').onchange=changeLayout;
 function syncCalUI(){
  let cal=db.calibration||{gamma:2.2,cutoff:0,brightness:100};
  if($('gammaSlider')){$('gammaSlider').value=cal.gamma;$('gammaVal').textContent=Number(cal.gamma).toFixed(1);}
  if($('cutoffSlider')){$('cutoffSlider').value=cal.cutoff;$('cutoffVal').textContent=String(cal.cutoff);}
  if($('brightSlider')){$('brightSlider').value=cal.brightness;$('brightVal').textContent=cal.brightness+'%';}
 }
 function updateCal(saveNow){
  db.calibration={gamma:Number($('gammaSlider').value),cutoff:Number($('cutoffSlider').value),brightness:Number($('brightSlider').value)};
  syncCalUI();
  if(saveNow)store();else draftSoon();
  if(live)previewCurrent(true);
 }
 syncCalUI();
 if($('gammaSlider'))['gammaSlider','cutoffSlider','brightSlider'].forEach(id=>{$(id).oninput=()=>updateCal(false);$(id).onchange=()=>updateCal(true);});
 bind('calResetBtn',()=>{db.calibration={gamma:2.2,cutoff:0,brightness:100};syncCalUI();store();if(live)previewCurrent(true);notify('Calibration reset to defaults.');});
 $('imagePicker').onchange=onPicked;
 $('largePreview').onclick=e=>{let panel=e.target.closest('[data-panel]');if(panel&&current.steps[selected]&&!busy&&!working){pausePlayback();openSource(current.steps[selected].id,Number(panel.dataset.panel));}};
 document.addEventListener('pointermove',dragMove,{passive:false});
 document.addEventListener('pointerup',dragEnd,{passive:false});
 document.addEventListener('pointercancel',dragEnd,{passive:false});
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape')handleBack();
  if(e.key==='Tab'&&!$('sheet').hidden){
   let focusable=Array.from($('sheet').querySelectorAll('button,input,select,[tabindex]')).filter(n=>!n.disabled&&n.offsetParent!==null);
   if(focusable.length){
    let first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  }
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden){pausePlayback();flushDraft();}});
 renderEditor();renderAssignments();updateSaveState();
 log('LED Matrix Controller '+APP_VERSION+' ready. Live Preview starts off; enable it to send temporary images.');
 setTimeout(()=>{if(Native.checkUpdate)Native.checkUpdate(true);},1500);
}

function onUpdateAvailable(code,name,url){
 if(confirm('Update available ('+name+', build '+code+'). Download and install now?'))Native.installUpdate(url);
}

init();
