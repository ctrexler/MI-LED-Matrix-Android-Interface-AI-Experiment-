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
import android.view.WindowManager;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {
 private static final UUID SERVICE=UUID.fromString("0000ffd0-0000-1000-8000-00805f9b34fb");
 private static final UUID CHARACTERISTIC=UUID.fromString("0000ffd1-0000-1000-8000-00805f9b34fb");
 private static final byte[] CLEAR=hex(0xbc,0,0x15,0x15,0x55), PLAY=hex(0xbc,0,0x12,0x12,0x55),
  STORE_BEGIN=hex(0xbc,0,0x11,0xf1,3,0x55), STORE_END=hex(0xbc,0,0x11,0xf2,4,0x55),
  FRAME_BEGIN=hex(0xbc,0x0f,0xf1,8,8,0x55), FRAME_COMMIT=hex(0xbc,0x0f,0xf2,8,9,0x55);
 private static byte[] hex(int... a){byte[] b=new byte[a.length];for(int i=0;i<a.length;i++)b[i]=(byte)a[i];return b;}
 private WebView web;
 private ValueCallback<Uri[]> picker;
 private BluetoothAdapter adapter;
 private BluetoothLeScanner scanner;
 private final Handler ui=new Handler(Looper.getMainLooper());
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean busy=new AtomicBoolean(false);
 private volatile boolean cancelled=false,destroyed=false;
 private final Set<String> found=new HashSet<>();
 private final Link[] links=new Link[4];
 private String exportPending;
 private static class Link {
  BluetoothGatt gatt;
  volatile BluetoothGattCharacteristic characteristic;
  volatile int mtu=23;
  volatile boolean usable=false,discoveryStarted=false;
  volatile CountDownLatch pending;
  volatile int writeStatus=-1;
 }
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  BluetoothManager m=(BluetoothManager)getSystemService(BLUETOOTH_SERVICE);adapter=m==null?null:m.getAdapter();
  web=new WebView(this);setContentView(web);
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setAllowFileAccess(true);settings.setAllowContentAccess(true);
  settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);settings.setDomStorageEnabled(false);
  web.addJavascriptInterface(new Bridge(),"Native");
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}});
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams params){
    if(picker!=null)picker.onReceiveValue(null);picker=cb;
    Intent i=new Intent(Intent.ACTION_GET_CONTENT);i.setType("image/*");i.addCategory(Intent.CATEGORY_OPENABLE);
    try{startActivityForResult(i,81);}catch(Exception e){picker.onReceiveValue(null);picker=null;log(e.toString());}return true;
   }
  });
  web.loadUrl("file:///android_asset/index.html");
 }
 private void js(String text){ui.post(()->{if(!destroyed)web.evaluateJavascript(text,null);});}
 private void log(String text){js("log("+JSONObject.quote(text)+")");}
 private void status(int i,String text){js("setStatus("+i+","+JSONObject.quote(text)+")");}
 private boolean permissions(){if(Build.VERSION.SDK_INT>=31)return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED;return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
 private boolean bluetooth(){
  if(!permissions()){requestPermissions(Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION},40);log("Grant permissions, then tap the button again.");return false;}
  if(adapter==null||!adapter.isEnabled()){log("Enable Bluetooth in phone settings and retry.");return false;}return true;
 }
 private void stopScan(){try{if(scanner!=null)scanner.stopScan(scanCallback);}catch(Exception e){log(e.toString());}}
 private final Runnable endScan=()->stopScan();
 private final ScanCallback scanCallback=new ScanCallback(){
  @Override public void onScanResult(int type,ScanResult result){try{BluetoothDevice d=result.getDevice();if(!found.add(d.getAddress()))return;String name=d.getName();js("deviceFound("+JSONObject.quote(d.getAddress())+","+JSONObject.quote(name==null?"Unnamed BLE device":name)+")");}catch(Exception e){log(e.toString());}}
  @Override public void onScanFailed(int e){log("Scan failed: "+e);}
 };
 private void closeLink(int index){Link l=links[index];links[index]=null;if(l==null)return;l.usable=false;CountDownLatch p=l.pending;if(p!=null)p.countDown();try{l.gatt.disconnect();l.gatt.close();}catch(Exception ignored){}status(index,"Disconnected");}
 private void discover(Link l){if(l.discoveryStarted)return;l.discoveryStarted=true;try{if(!l.gatt.discoverServices())log("Service discovery could not start.");}catch(Exception e){log(e.toString());}}
 private void connect(final int index,String address){
  if(index<0||index>3||!bluetooth()||busy.get())return;stopScan();closeLink(index);
  try{
   final Link l=new Link();links[index]=l;status(index,"Connecting...");
   l.gatt=adapter.getRemoteDevice(address).connectGatt(this,false,new BluetoothGattCallback(){
    @Override public void onConnectionStateChange(BluetoothGatt g,int code,int state){
     if(links[index]!=l)return;
     if(code==BluetoothGatt.GATT_SUCCESS&&state==BluetoothProfile.STATE_CONNECTED){status(index,"Negotiating MTU...");if(!g.requestMtu(185))discover(l);ui.postDelayed(()->{if(links[index]==l&&!l.discoveryStarted)discover(l);},5000);}
     else if(state==BluetoothProfile.STATE_DISCONNECTED||code!=BluetoothGatt.GATT_SUCCESS){l.usable=false;if(l.pending!=null)l.pending.countDown();status(index,"Disconnected ("+code+")");log("D"+(index+1)+" disconnected: "+code);g.close();}
    }
    @Override public void onMtuChanged(BluetoothGatt g,int mtu,int code){if(links[index]!=l)return;if(code==BluetoothGatt.GATT_SUCCESS)l.mtu=mtu;discover(l);}
    @Override public void onServicesDiscovered(BluetoothGatt g,int code){
     if(links[index]!=l)return;
     BluetoothGattService s=g.getService(SERVICE);l.characteristic=s==null?null:s.getCharacteristic(CHARACTERISTIC);
     int props=l.characteristic==null?0:l.characteristic.getProperties();
     l.usable=code==BluetoothGatt.GATT_SUCCESS&&l.characteristic!=null&&((props&(BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE))!=0);
     status(index,l.usable?(l.mtu>=104?"Ready (MTU "+l.mtu+")":"Connected; MTU too small for upload ("+l.mtu+")"):"Unsupported service/characteristic");
     log("D"+(index+1)+" service result "+code+", MTU "+l.mtu+", properties "+props);
    }
    @Override public void onCharacteristicWrite(BluetoothGatt g,BluetoothGattCharacteristic c,int code){if(links[index]!=l)return;l.writeStatus=code;CountDownLatch p=l.pending;if(p!=null)p.countDown();}
   },BluetoothDevice.TRANSPORT_LE);
  }catch(Exception e){status(index,"Connection failed");log(e.toString());}
 }
 private void checkCancel() throws Exception {if(cancelled||destroyed||Thread.currentThread().isInterrupted())throw new Exception("Operation cancelled; uploaded/erased images cannot be rolled back.");}
 private void write(int i,byte[] bytes,long delay) throws Exception {
  checkCancel();Link l=links[i];if(l==null||!l.usable||l.characteristic==null)throw new Exception("Display "+(i+1)+" is not ready.");
  if(bytes.length>l.mtu-3)throw new Exception("Display "+(i+1)+" MTU "+l.mtu+" cannot carry "+bytes.length+" bytes. Reconnect; packets were not split or guessed.");
  BluetoothGattCharacteristic c=l.characteristic;
  int type=(c.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0?BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE:BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
  l.writeStatus=-1;CountDownLatch wait=new CountDownLatch(1);l.pending=wait;
  try{
   boolean started;
   if(Build.VERSION.SDK_INT>=33)started=l.gatt.writeCharacteristic(c,bytes,type)==BluetoothStatusCodes.SUCCESS;
   else{c.setWriteType(type);c.setValue(bytes);started=l.gatt.writeCharacteristic(c);}
   if(!started)throw new Exception("D"+(i+1)+" Android rejected write.");
   if(!wait.await(12,TimeUnit.SECONDS))throw new Exception("D"+(i+1)+" write timeout.");
   checkCancel();if(l.writeStatus!=BluetoothGatt.GATT_SUCCESS)throw new Exception("D"+(i+1)+" write failed: "+l.writeStatus);
   Thread.sleep(delay);
  }finally{l.pending=null;}
 }
 private static byte[] packet(int block,byte[] pixels){
  byte[] p=new byte[101];p[0]=(byte)0xbc;p[1]=15;p[2]=(byte)(block+1);System.arraycopy(pixels,block*96,p,3,96);int sum=0;for(int j=1;j<99;j++)sum=(sum+(p[j]&255))&255;p[99]=(byte)sum;p[100]=0x55;return p;
 }
 private void operation(Runnable task){
  if(!busy.compareAndSet(false,true)){log("An operation is already running.");return;}
  cancelled=false;js("setBusy(true)");ui.post(()->getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
  worker.execute(()->{try{task.run();}finally{busy.set(false);js("setBusy(false)");ui.post(()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));}});
 }
 public class Bridge {
  @JavascriptInterface public String load(){try{return new String(Files.readAllBytes(new File(getFilesDir(),"library.json").toPath()),StandardCharsets.UTF_8);}catch(Exception e){return "{}";}}
  @JavascriptInterface public synchronized String save(String text){
   try{if(text.length()>40_000_000)throw new Exception("Library exceeds 40 MB limit. Export and reduce it.");new JSONObject(text);File tmp=new File(getFilesDir(),"library.tmp");try(FileOutputStream out=new FileOutputStream(tmp)){out.write(text.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}Files.move(tmp.toPath(),new File(getFilesDir(),"library.json").toPath(),StandardCopyOption.REPLACE_EXISTING);return "";}catch(Exception e){return e.toString();}
  }
  @JavascriptInterface public void scan(int index){ui.post(()->{if(busy.get()||!bluetooth())return;stopScan();ui.removeCallbacks(endScan);found.clear();js("clearDevices()");scanner=adapter.getBluetoothLeScanner();try{scanner.startScan(scanCallback);log("Scanning for 10 seconds...");ui.postDelayed(endScan,10000);}catch(Exception e){log(e.toString());}});}
  @JavascriptInterface public void connectDisplay(int index,String address){ui.post(()->connect(index,address));}
  @JavascriptInterface public void disconnect(){ui.post(()->{cancelled=true;stopScan();for(int i=0;i<4;i++)closeLink(i);});}
  @JavascriptInterface public void cancel(){cancelled=true;log("Cancel requested. Storage changes cannot be undone.");}
  @JavascriptInterface public void upload(String text,boolean replace){
   operation(()->{try{
    JSONObject job=new JSONObject(text);JSONArray frames=job.getJSONArray("frames");int n=frames.length();if(n<1||n>200)throw new Exception("Use 1–200 steps per upload.");
    byte[][][] pixels=new byte[4][n][];
    for(int d=0;d<4;d++){
     Link l=links[d];if(l==null||!l.usable||l.mtu<104)throw new Exception("All four displays must be ready with MTU at least 104. Check display "+(d+1));
     for(int k=0;k<n;k++){pixels[d][k]=Base64.decode(frames.getJSONArray(k).getString(d),Base64.DEFAULT);if(pixels[d][k].length!=768)throw new Exception("Invalid RGB tile.");}
    }
    // Validate every frame and connection before any destructive command.
    if(replace)for(int d=0;d<4;d++){log("Clearing D"+(d+1));write(d,CLEAR,1000);}
    int total=4*n*12+(replace?4:0),done=replace?4:0;
    for(int d=0;d<4;d++)for(int k=0;k<n;k++){
     log("Uploading D"+(d+1)+", image "+(k+1)+"/"+n);status(d,"Uploading "+(k+1)+"/"+n);
     write(d,STORE_BEGIN,200);done++;write(d,FRAME_BEGIN,200);done++;
     for(int block=0;block<8;block++){write(d,packet(block,pixels[d][k]),80);done++;js("progress("+done+","+total+")");}
     write(d,FRAME_COMMIT,200);done++;write(d,STORE_END,1000);done++;js("progress("+done+","+total+")");
    }
    for(int d=0;d<4;d++)status(d,"Upload commands completed");
    log("Upload commands completed. Press Start all slideshows to test playback.");js("notify('Upload commands completed. Playback has not started automatically.')");
   }catch(Exception e){log("UPLOAD STOPPED: "+e.getMessage());js("notify("+JSONObject.quote("Upload stopped: "+e.getMessage())+")");}});
  }
  @JavascriptInterface public void playAll(){operation(()->{try{
   for(int i=0;i<4;i++)if(links[i]==null||!links[i].usable)throw new Exception("Connect all four displays first.");
   for(int i=0;i<4;i++)write(i,PLAY,200);
   log("Playback start commands sent to all four displays.");js("notify('Playback start commands sent to all four displays.')");
  }catch(Exception e){log("Playback failed: "+e.getMessage());}});}
  @JavascriptInterface public void exportLibrary(String data){ui.post(()->{if(exportPending!=null){log("Finish the current export first.");return;}exportPending=data;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/json");i.putExtra(Intent.EXTRA_TITLE,"four-display-library.json");try{startActivityForResult(i,82);}catch(Exception e){exportPending=null;log(e.toString());}});}
  @JavascriptInterface public void importLibrary(){ui.post(()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");try{startActivityForResult(i,83);}catch(Exception e){log(e.toString());}});}
 }
 @Override protected void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);
  if(request==81&&picker!=null){picker.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);picker=null;return;}
  if(request==82){String pending=exportPending;exportPending=null;if(result!=RESULT_OK||data==null||pending==null)return;
   try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"wt")){if(out==null)throw new IOException("No output stream");out.write(pending.getBytes(StandardCharsets.UTF_8));log("Library backup exported.");}catch(Exception e){log("Export failed: "+e);}return;
  }
  if(request==83&&result==RESULT_OK&&data!=null){
   try(InputStream in=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream out=new ByteArrayOutputStream()){
    if(in==null)throw new IOException("No input stream");byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>40_000_000)throw new IOException("Backup exceeds 40 MB");}
    js("receiveBackup("+JSONObject.quote(new String(out.toByteArray(),StandardCharsets.UTF_8))+")");
   }catch(Exception e){log("Import failed: "+e);}
  }
 }
 @Override protected void onPause(){super.onPause();js("stopPreview()");}
 @Override protected void onDestroy(){destroyed=true;cancelled=true;stopScan();for(int i=0;i<4;i++)closeLink(i);worker.shutdownNow();ui.removeCallbacksAndMessages(null);if(picker!=null)picker.onReceiveValue(null);web.destroy();super.onDestroy();}
}
