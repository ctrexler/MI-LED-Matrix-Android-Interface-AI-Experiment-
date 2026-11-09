#!/usr/bin/env python3
"""Generate complete updated sources from the supplied v0.4 project. No network access."""
from pathlib import Path
import hashlib,json,sys,zipfile
ROOT=Path(__file__).resolve().parents[1]
MARKER='// LED_MATRIX_V05_APPLIED'
def replace_once(text,old,new,label):
 if text.count(old)!=1: raise RuntimeError('Baseline mismatch: '+label+'; no source files written')
 return text.replace(old,new,1)
def main():
 def read(p):return (ROOT/p).read_text(encoding='utf-8')
 java='app/src/main/java/org/fourdisplay/studio/MainActivity.java'
 script='app/src/main/assets/app.js';html='app/src/main/assets/index.html'
 manifest='app/src/main/AndroidManifest.xml';gradle='app/build.gradle'
 changes={};j=read(java);already=MARKER in j
 if not already:
  if '@JavascriptInterface public void upload(String text,boolean replace)' not in j:raise RuntimeError('Unsupported native baseline')
  start=j.index('  @JavascriptInterface public void upload(String text,boolean replace)')
  end=j.index('  @JavascriptInterface public void playAll()',start)
  j=j[:start]+MARKER+'\n'+read('tools/native-upload-v05.txt')+read('tools/native-play-v05.txt')+j[end:]
  changes[java]=j
  a=read(script)
  # Install extension definitions before init loads saved sources, so advanced patterns migrate safely.
  if not a.rstrip().endswith('init();'):raise RuntimeError('Baseline mismatch: app.js initialization')
  changes[script]=a.rstrip()[:-len('init();')]+'// Initialization moved to update-v05.js.\n'
  h=read(html)
  h=replace_once(h,'<title>Four Display Studio</title>','<title>LED Matrix Controller</title>','HTML title')
  h=replace_once(h,'<link rel="stylesheet" href="style.css">','<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="update-v05.css">','style link')
  h=replace_once(h,'<script src="app.js"></script>','<script src="app.js"></script><script src="update-v05.js"></script>','script link')
  changes[html]=h
  m=read(manifest)
  m=replace_once(m,'android:label="Four Display Studio"','android:label="LED Matrix Controller" android:icon="@mipmap/ic_launcher"','application label')
  changes[manifest]=m
  g=read(gradle)
  g=replace_once(g,"versionCode 4; versionName '0.4-live-patterns'","versionCode 5; versionName '0.5.0'",'app version')
  changes[gradle]=g
  diag='app/src/main/java/org/fourdisplay/studio/DiagnosticActivity.java'
  changes[diag]=read(diag).replace('Four Display Studio','LED Matrix Controller')
  settings='settings.gradle'
  changes[settings]=replace_once(read(settings),"rootProject.name = 'FourDisplayStudio'","rootProject.name = 'LEDMatrixController'",'project name')
  readme=ROOT/'README.md'
  if readme.exists():changes['README.md']=read('README.md')+'\n\n## LED Matrix Controller 0.5.0 update\nSee UPDATE_README.md for build/update instructions and VERSION_HISTORY_v05.md for changes. The app-maintained Stored Images records are not device read-back.\n'
  filemap=ROOT/'FILE_MAP.txt'
  if filemap.exists():changes['FILE_MAP.txt']=read('FILE_MAP.txt')+'\n\nVersion 0.5 additions (preserve folders):\napp/src/main/java/org/fourdisplay/studio/DiagnosticActivity.java\napp/src/main/assets/update-v05.js\napp/src/main/assets/update-v05.css\napp/src/main/res/ (launcher icon resources)\ntools/apply_v05.py\ntools/native-upload-v05.txt\ntools/native-play-v05.txt\nUPDATE_README.md\nVERSION_HISTORY_v05.md\nUPDATE_VALIDATION.json\n'

  # Validate all anchors before writing; keep exact original sources locally for review/recovery.
  backup=ROOT/'.ledmatrix-original-v05'
  for path,text in changes.items():
   original=backup/path;original.parent.mkdir(parents=True,exist_ok=True)
   if not original.exists():original.write_bytes((ROOT/path).read_bytes())
  for path,text in changes.items():(ROOT/path).write_text(text,encoding='utf-8')
  ignore=ROOT/'.gitignore';old=ignore.read_text() if ignore.exists() else ''
  if '.ledmatrix-original-v05/' not in old:ignore.write_text(old+'\n.ledmatrix-original-v05/\ngenerated-v05/\n')
 else:
  if 'update-v05.js' not in read(html) or 'versionCode 5' not in read(gradle):raise RuntimeError('Partially applied update detected; inspect sources before continuing')
 files=[java,script,html,manifest,gradle,'settings.gradle','app/src/main/java/org/fourdisplay/studio/DiagnosticActivity.java','app/src/main/assets/style.css','app/src/main/assets/update-v05.js','app/src/main/assets/update-v05.css']
 report={'version':'0.5.0','source_generation':'complete','android_build':'not run by this script','hardware_test':'not run','append_transport':'Original clear/BEGIN/FRAME/block/COMMIT/END timing and storage packet encoder retained; destination filtering and tracking callbacks added.','sha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in files}}
 out=ROOT/'generated-v05';out.mkdir(exist_ok=True)
 (out/'SOURCE_GENERATION.json').write_text(json.dumps(report,indent=2))
 with zipfile.ZipFile(out/'LED-Matrix-Controller-v0.5.0-full-source.zip','w',zipfile.ZIP_DEFLATED) as z:
  for path in sorted(ROOT.rglob('*')):
   rel=path.relative_to(ROOT)
   if not path.is_file() or any(part in {'.git','.gradle','build','.ledmatrix-original-v05','generated-v05'} for part in rel.parts):continue
   if path.suffix in {'.jks','.keystore','.apk'} or path.name=='local.properties':continue
   z.write(path,rel.as_posix())
  z.writestr('SOURCE_GENERATION.json',json.dumps(report,indent=2))
 print('v0.5 sources generated; original source backups kept in .ledmatrix-original-v05.')
if __name__=='__main__':
 try:main()
 except Exception as e:print('UPDATE STOPPED:',e,file=sys.stderr);sys.exit(1)
