package org.fourdisplay.studio;
import android.Manifest;
import android.app.Activity;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.bluetooth.*;
import android.bluetooth.le.*;
import android.webkit.*;
import android.net.Uri;
import android.util.Base64;
import android.view.*;
import android.widget.FrameLayout;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
 private static final UUID SERVICE=UUID.fromString("0000ffd0-0000-1000-8000-00805f9b34fb"), CHAR=UUID.fromString("0000ffd1-0000-1000-8000-00805f9b34fb");
 private static byte[] bytes(int... a){byte[] b=new byte[a.length];for(int i=0;i<a.length;i++)b[i]=(byte)a[i];return b;}
 private static final byte[] CLEAR=bytes(188,0,21,21,85),PLAY=bytes(188,0,18,18,85),BEGIN=bytes(188,0,17,241,3,85),END=bytes(188,0,17,242,4,85),FRAME=bytes(188,15,241,8,8,85),COMMIT=bytes(188,15,242,8,9,85);
 private WebView web; private ValueCallback<Uri[]> picker;
 private BluetoothAdapter adapter; private BluetoothLeScanner scanner;
 private final Handler ui=new Handler(Looper.getMainLooper());
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean busy=new AtomicBoolean(),previewScheduled=new AtomicBoolean();
 private volatile boolean cancelled,destroyed,liveAllowed;
 private final Object previewLock=new Object(); private final byte[][] pendingPreview=new byte[4][];
 private final Set<String> found=new HashSet<>();private final Link[] links=new Link[4];private String pendingExport;
 private static class Link {BluetoothGatt gatt;volatile BluetoothGattCharacteristic characteristic;volatile int mtu=23,writeStatus=-1;volatile boolean ready,discovering;volatile CountDownLatch pending;}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);BluetoothManager m=(BluetoothManager)getSystemService(BLUETOOTH_SERVICE);adapter=m==null?null:m.getAdapter();
  if(Build.VERSION.SDK_INT>=30){getWindow().setDecorFitsSystemWindows(false);android.view.WindowInsetsController controller=getWindow().getInsetsController();if(controller!=null)controller.setSystemBarsAppearance(0,android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);}
  FrameLayout host=new FrameLayout(this);host.setBackgroundColor(android.graphics.Color.rgb(14,20,29));web=new WebView(this);host.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(host);
  host.setOnApplyWindowInsetsListener((v,insets)->{
   int left,top,right,bottom;
   if(Build.VERSION.SDK_INT>=30){android.graphics.Insets b=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());left=b.left;top=b.top;right=b.right;bottom=b.bottom;}
   else{left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();}
   FrameLayout.LayoutParams p=(FrameLayout.LayoutParams)web.getLayoutParams();if(p.leftMargin!=left||p.topMargin!=top||p.rightMargin!=right||p.bottomMargin!=bottom){p.setMargins(left,top,right,bottom);web.setLayoutParams(p);}
   return Build.VERSION.SDK_INT>=30?WindowInsets.CONSUMED:insets.consumeSystemWindowInsets();
  });host.requestApplyInsets();
  WebSettings w=web.getSettings();w.setJavaScriptEnabled(true);w.setAllowFileAccess(true);w.setAllowContentAccess(true);w.setAllowFileAccessFromFileURLs(false);w.setAllowUniversalAccessFromFileURLs(false);
  web.addJavascriptInterface(new Bridge(),"Native");web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}});
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams params){if(picker!=null)picker.onReceiveValue(null);picker=cb;Intent i=new Intent(Intent.ACTION_GET_CONTENT);i.setType("image/*");i.addCategory(Intent.CATEGORY_OPENABLE);try{startActivityForResult(i,81);}catch(Exception e){picker.onReceiveValue(null);picker=null;log(e.toString());}return true;}});web.loadUrl("file:///android_asset/index.html");
 }
 private void js(String code){ui.post(()->{if(!destroyed)web.evaluateJavascript(code,null);});}
 private void log(String text){js("log("+JSONObject.quote(text)+")");}
 private void status(int i,String text){Link l=links[i];boolean ready=l!=null&&l.ready;js("setStatus("+i+","+JSONObject.quote(text)+","+ready+")");}
 private boolean bluetooth(){boolean ok=Build.VERSION.SDK_INT>=31?checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED:checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  if(!ok){requestPermissions(Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION},40);log("Grant permissions, then scan/connect again.");return false;}if(adapter==null||!adapter.isEnabled()){log("Enable Bluetooth in phone settings.");return false;}return true;
 }
 private void stopScan(){try{if(scanner!=null)scanner.stopScan(scanCallback);}catch(Exception ignored){}}
 private final Runnable stopScanTask=()->{stopScan();js("scanFinished()");};
 private final ScanCallback scanCallback=new ScanCallback(){
  @Override public void onScanResult(int t,ScanResult r){try{BluetoothDevice d=r.getDevice();if(!found.add(d.getAddress()))return;String n=d.getName();js("deviceFound("+JSONObject.quote(d.getAddress())+","+JSONObject.quote(n==null?"Unnamed BLE device":n)+")");}catch(Exception e){log(e.toString());}}
  @Override public void onScanFailed(int e){log("Scan failed: "+e);js("scanFinished()");}
 };
 private void close(int i){Link l=links[i];links[i]=null;if(l!=null){l.ready=false;if(l.pending!=null)l.pending.countDown();try{l.gatt.disconnect();l.gatt.close();}catch(Exception ignored){}}status(i,"Disconnected");}
 private void discover(Link l){if(l.discovering)return;l.discovering=true;try{if(!l.gatt.discoverServices())log("Service discovery failed to start; reconnect.");}catch(Exception e){log(e.toString());}}
 private void connect(int i,String address){if(i<0||i>3||busy.get()||!bluetooth())return;stopScan();close(i);try{Link l=new Link();links[i]=l;status(i,"Connecting...");l.gatt=adapter.getRemoteDevice(address).connectGatt(this,false,new BluetoothGattCallback(){
  @Override public void onConnectionStateChange(BluetoothGatt g,int code,int state){if(links[i]!=l)return;if(code==BluetoothGatt.GATT_SUCCESS&&state==BluetoothProfile.STATE_CONNECTED){status(i,"Negotiating MTU...");if(!g.requestMtu(185))discover(l);ui.postDelayed(()->{if(links[i]==l&&!l.discovering)discover(l);},5000);}else if(state==BluetoothProfile.STATE_DISCONNECTED||code!=BluetoothGatt.GATT_SUCCESS){l.ready=false;if(l.pending!=null)l.pending.countDown();status(i,"Disconnected ("+code+")");log("D"+(i+1)+" disconnected: "+code);g.close();}}
  @Override public void onMtuChanged(BluetoothGatt g,int mtu,int code){if(links[i]!=l)return;if(code==BluetoothGatt.GATT_SUCCESS)l.mtu=mtu;discover(l);}
  @Override public void onServicesDiscovered(BluetoothGatt g,int code){if(links[i]!=l)return;BluetoothGattService s=g.getService(SERVICE);l.characteristic=s==null?null:s.getCharacteristic(CHAR);int p=l.characteristic==null?0:l.characteristic.getProperties();l.ready=code==BluetoothGatt.GATT_SUCCESS&&l.characteristic!=null&&(p&(BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE))!=0&&l.mtu>=104;status(i,l.ready?"Ready (MTU "+l.mtu+")":"Not ready: check service / MTU "+l.mtu);log("D"+(i+1)+" services "+code+", properties "+p+", MTU "+l.mtu);}
  @Override public void onCharacteristicWrite(BluetoothGatt g,BluetoothGattCharacteristic c,int code){if(links[i]!=l)return;l.writeStatus=code;if(l.pending!=null)l.pending.countDown();}
 },BluetoothDevice.TRANSPORT_LE);}catch(Exception e){status(i,"Connection failed");log(e.toString());}}
 private void checkCancel() throws Exception{if(cancelled||destroyed||Thread.currentThread().isInterrupted())throw new Exception("Cancelled; storage changes cannot be undone.");}
 private void write(int i,byte[] data,long delay) throws Exception{checkCancel();Link l=links[i];if(l==null||!l.ready)throw new Exception("D"+(i+1)+" not ready");if(data.length>l.mtu-3)throw new Exception("MTU too small");BluetoothGattCharacteristic c=l.characteristic;int type=(c.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0?BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE:BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;CountDownLatch wait=new CountDownLatch(1);l.pending=wait;l.writeStatus=-1;
  try{boolean start;if(Build.VERSION.SDK_INT>=33)start=l.gatt.writeCharacteristic(c,data,type)==BluetoothStatusCodes.SUCCESS;else{c.setWriteType(type);c.setValue(data);start=l.gatt.writeCharacteristic(c);}if(!start)throw new Exception("Write rejected");if(!wait.await(12,TimeUnit.SECONDS))throw new Exception("Write timeout");checkCancel();if(l.writeStatus!=BluetoothGatt.GATT_SUCCESS)throw new Exception("Write status "+l.writeStatus);Thread.sleep(delay);}finally{l.pending=null;}}
 private static byte[] storePacket(int b,byte[] rgb){byte[] p=new byte[101];p[0]=(byte)188;p[1]=15;p[2]=(byte)(b+1);System.arraycopy(rgb,b*96,p,3,96);int sum=0;for(int j=1;j<99;j++)sum=(sum+(p[j]&255))&255;p[99]=(byte)sum;p[100]=85;return p;}
 private static byte[] livePacket(int b,byte[] rgb){byte[] p=new byte[100];p[0]=(byte)188;p[1]=15;p[2]=(byte)(b+1);System.arraycopy(rgb,b*96,p,3,96);p[99]=85;return p;}
 private void clearPreviews(){synchronized(previewLock){Arrays.fill(pendingPreview,null);}}
 private boolean hasPreview(){synchronized(previewLock){for(byte[] b:pendingPreview)if(b!=null)return true;}return false;}
 private void schedulePreviews(){if(destroyed||busy.get()||!liveAllowed||!previewScheduled.compareAndSet(false,true))return;worker.execute(()->{
  try{while(!destroyed&&!busy.get()&&liveAllowed){byte[][] batch=new byte[4][];synchronized(previewLock){for(int i=0;i<4;i++){batch[i]=pendingPreview[i];pendingPreview[i]=null;}}boolean any=false;for(byte[] b:batch)if(b!=null)any=true;if(!any)break;
   for(int i=0;i<4;i++){if(busy.get()||!liveAllowed)break;synchronized(previewLock){if(pendingPreview[i]!=null){batch[i]=pendingPreview[i];pendingPreview[i]=null;}}if(batch[i]==null)continue;Link l=links[i];if(l==null||!l.ready)continue;try{write(i,FRAME,2);for(int b=0;b<8;b++)write(i,livePacket(b,batch[i]),5);}catch(Exception e){log("Live preview D"+(i+1)+": "+e.getMessage());js("liveError("+i+")");}}
  }}finally{previewScheduled.set(false);if(!destroyed&&!busy.get()&&liveAllowed&&hasPreview())schedulePreviews();}
 });}
 private void operate(Runnable task){if(!busy.compareAndSet(false,true)){log("Operation already running");return;}cancelled=false;clearPreviews();js("setBusy(true)");ui.post(()->getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));worker.execute(()->{try{task.run();}finally{busy.set(false);js("setBusy(false)");ui.post(()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));}});}
 public class Bridge {
  @JavascriptInterface public String load(){try{return new String(Files.readAllBytes(new File(getFilesDir(),"library.json").toPath()),StandardCharsets.UTF_8);}catch(Exception e){return "{}";}}
  @JavascriptInterface public synchronized String save(String text){try{if(text.length()>40_000_000)throw new IOException("Library exceeds 40 MB");new JSONObject(text);File tmp=new File(getFilesDir(),"library.tmp");try(FileOutputStream o=new FileOutputStream(tmp)){o.write(text.getBytes(StandardCharsets.UTF_8));o.getFD().sync();}Files.move(tmp.toPath(),new File(getFilesDir(),"library.json").toPath(),StandardCopyOption.REPLACE_EXISTING);return "";}catch(Exception e){return e.toString();}}
  @JavascriptInterface public void scan(){ui.post(()->{if(busy.get()||!bluetooth()){js("scanFinished()");return;}stopScan();ui.removeCallbacks(stopScanTask);found.clear();js("clearDevices()");scanner=adapter.getBluetoothLeScanner();try{scanner.startScan(scanCallback);ui.postDelayed(stopScanTask,10000);}catch(Exception e){log(e.toString());js("scanFinished()");}});}
  @JavascriptInterface public void stopScanNow(){ui.post(()->{stopScan();ui.removeCallbacks(stopScanTask);});}
  @JavascriptInterface public void connectDisplay(int i,String address){ui.post(()->{cancelled=false;connect(i,address);});}
  @JavascriptInterface public void disconnect(){liveAllowed=false;clearPreviews();ui.post(()->{cancelled=true;stopScan();for(int i=0;i<4;i++)close(i);});}
  @JavascriptInterface public void cancel(){cancelled=true;log("Cancel requested; previous storage changes cannot be undone.");}
  @JavascriptInterface public void setLive(boolean enabled){liveAllowed=enabled;if(!enabled)clearPreviews();else{cancelled=false;schedulePreviews();}}
  @JavascriptInterface public void preview(String text){if(!liveAllowed||busy.get()||destroyed)return;try{JSONArray a=new JSONArray(text);if(a.length()!=4)return;synchronized(previewLock){for(int i=0;i<4;i++)if(!a.isNull(i)){byte[] rgb=Base64.decode(a.getString(i),Base64.DEFAULT);if(rgb.length!=768)throw new IOException("Invalid preview tile");pendingPreview[i]=rgb;}}schedulePreviews();}catch(Exception e){log("Preview rejected: "+e.getMessage());}}
  @JavascriptInterface public void upload(String text,boolean replace){operate(()->{try{JSONArray a=new JSONObject(text).getJSONArray("frames");int n=a.length();if(n<1||n>200)throw new Exception("Use 1–200 steps");byte[][][] rgb=new byte[4][n][];for(int d=0;d<4;d++){if(links[d]==null||!links[d].ready)throw new Exception("All four must be ready; check D"+(d+1));for(int k=0;k<n;k++){rgb[d][k]=Base64.decode(a.getJSONArray(k).getString(d),Base64.DEFAULT);if(rgb[d][k].length!=768)throw new Exception("Invalid tile");}}
   int total=4*n*12+(replace?4:0),done=0;if(replace)for(int d=0;d<4;d++){log("Clearing D"+(d+1));write(d,CLEAR,1000);done++;}for(int d=0;d<4;d++)for(int k=0;k<n;k++){js("transferLabel("+JSONObject.quote("Display "+(d+1)+"/4 · Image "+(k+1)+"/"+n)+")");write(d,BEGIN,200);done++;write(d,FRAME,200);done++;for(int b=0;b<8;b++){write(d,storePacket(b,rgb[d][k]),80);done++;js("progress("+done+","+total+")");}write(d,COMMIT,200);done++;write(d,END,1000);done++;js("progress("+done+","+total+")");}js("notify('Upload commands completed. Playback has not started automatically.')");
  }catch(Exception e){js("notify("+JSONObject.quote("Upload stopped: "+e.getMessage())+")");}});}
  @JavascriptInterface public void playAll(){liveAllowed=false;clearPreviews();operate(()->{try{for(int i=0;i<4;i++)if(links[i]==null||!links[i].ready)throw new Exception("Connect all four displays first");for(int i=0;i<4;i++)write(i,PLAY,200);js("notify('Stored slideshow start commands sent.')");}catch(Exception e){js("notify("+JSONObject.quote(e.getMessage())+")");}});}
  @JavascriptInterface public void exportLibrary(String text){ui.post(()->{if(pendingExport!=null)return;pendingExport=text;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/json");i.putExtra(Intent.EXTRA_TITLE,"four-display-library.json");try{startActivityForResult(i,82);}catch(Exception e){pendingExport=null;log(e.toString());}});}
  @JavascriptInterface public void importLibrary(){ui.post(()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");try{startActivityForResult(i,83);}catch(Exception e){log(e.toString());}});}
 }
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==81&&picker!=null){picker.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);picker=null;return;}if(request==82){String text=pendingExport;pendingExport=null;if(result!=RESULT_OK||data==null||text==null)return;try(OutputStream o=getContentResolver().openOutputStream(data.getData(),"wt")){if(o==null)throw new IOException("No output stream");o.write(text.getBytes(StandardCharsets.UTF_8));log("Backup exported");}catch(Exception e){log("Export failed: "+e);}return;}if(request==83&&result==RESULT_OK&&data!=null){try(InputStream in=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream o=new ByteArrayOutputStream()){if(in==null)throw new IOException("No input stream");byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){o.write(b,0,n);if(o.size()>40_000_000)throw new IOException("Backup exceeds 40 MB");}js("receiveBackup("+JSONObject.quote(new String(o.toByteArray(),StandardCharsets.UTF_8))+")");}catch(Exception e){log("Import failed: "+e);}}}
 @Override public void onBackPressed(){web.evaluateJavascript("handleBack()",value->{if(!"true".equals(value))super.onBackPressed();});}
 @Override protected void onPause(){super.onPause();js("pausePlayback();flushDraft()");}
 @Override protected void onDestroy(){destroyed=true;cancelled=true;liveAllowed=false;clearPreviews();stopScan();for(int i=0;i<4;i++)close(i);worker.shutdownNow();ui.removeCallbacksAndMessages(null);if(picker!=null)picker.onReceiveValue(null);web.destroy();super.onDestroy();}
}
