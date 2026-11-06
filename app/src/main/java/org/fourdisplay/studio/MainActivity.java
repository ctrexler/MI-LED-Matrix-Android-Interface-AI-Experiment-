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
 private static final UUID SERVICE=UUID.fromString("0000ffd0-0000-1000-8000-00805f9b34fb"), CHAR=UUID.fromString("0000ffd1-0000-1000-8000-00805f9b34fb");
 private static byte[] bytes(int... a){byte[] b=new byte[a.length];for(int i=0;i<a.length;i++)b[i]=(byte)a[i];return b;}
 private static final byte[] CLEAR=bytes(188,0,21,21,85),PLAY=bytes(188,0,18,18,85),BEGIN=bytes(188,0,17,241,3,85),END=bytes(188,0,17,242,4,85),FRAME=bytes(188,15,241,8,8,85),COMMIT=bytes(188,15,242,8,9,85);
 private WebView web; private ValueCallback<Uri[]> picker;
 private BluetoothAdapter adapter; private BluetoothLeScanner scanner;
 private final Handler ui=new Handler(Looper.getMainLooper());
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean busy=new AtomicBoolean();
 private volatile boolean cancelled,destroyed;
 private final Set<String> found=new HashSet<>();
 private final Link[] links=new Link[4]; private String pendingExport;
 private static class Link {BluetoothGatt gatt;volatile BluetoothGattCharacteristic characteristic;volatile int mtu=23,writeStatus=-1;volatile boolean ready,discovering;volatile CountDownLatch pending;}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);BluetoothManager m=(BluetoothManager)getSystemService(BLUETOOTH_SERVICE);adapter=m==null?null:m.getAdapter();
  web=new WebView(this);setContentView(web);
  web.setOnApplyWindowInsetsListener((v,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets b=insets.getInsets(android.view.WindowInsets.Type.systemBars());v.setPadding(b.left,b.top,b.right,b.bottom);}else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
  WebSettings w=web.getSettings();w.setJavaScriptEnabled(true);w.setAllowFileAccess(true);w.setAllowContentAccess(true);w.setAllowFileAccessFromFileURLs(false);w.setAllowUniversalAccessFromFileURLs(false);
  web.addJavascriptInterface(new Bridge(),"Native");web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}});
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams params){if(picker!=null)picker.onReceiveValue(null);picker=cb;Intent i=new Intent(Intent.ACTION_GET_CONTENT);i.setType("image/*");i.addCategory(Intent.CATEGORY_OPENABLE);try{startActivityForResult(i,81);}catch(Exception e){picker.onReceiveValue(null);picker=null;log(e.toString());}return true;}});
  web.loadUrl("file:///android_asset/index.html");
 }
 private void js(String code){ui.post(()->{if(!destroyed)web.evaluateJavascript(code,null);});}
 private void log(String text){js("log("+JSONObject.quote(text)+")");}
 private void status(int i,String text){js("setStatus("+i+","+JSONObject.quote(text)+")");}
 private boolean bluetooth(){
  boolean permission=Build.VERSION.SDK_INT>=31?checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED:checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  if(!permission){requestPermissions(Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION},40);log("Grant permissions, then tap again.");return false;}
  if(adapter==null||!adapter.isEnabled()){log("Enable Bluetooth in phone settings and retry.");return false;}return true;
 }
 private void stopScan(){try{if(scanner!=null)scanner.stopScan(scanCallback);}catch(Exception ignored){}}
 private final Runnable stopScanTask=()->stopScan();
 private final ScanCallback scanCallback=new ScanCallback(){
  @Override public void onScanResult(int t,ScanResult r){try{BluetoothDevice d=r.getDevice();if(!found.add(d.getAddress()))return;String n=d.getName();js("deviceFound("+JSONObject.quote(d.getAddress())+","+JSONObject.quote(n==null?"Unnamed BLE device":n)+")");}catch(Exception e){log(e.toString());}}
  @Override public void onScanFailed(int error){log("Scan failed: "+error);}
 };
 private void close(int index){Link l=links[index];links[index]=null;if(l!=null){l.ready=false;if(l.pending!=null)l.pending.countDown();try{l.gatt.disconnect();l.gatt.close();}catch(Exception ignored){}}status(index,"Disconnected");}
 private void discover(Link l){if(l.discovering)return;l.discovering=true;try{if(!l.gatt.discoverServices())log("Service discovery could not start; reconnect.");}catch(Exception e){log(e.toString());}}
 private void connect(int index,String address){
  if(index<0||index>3||busy.get()||!bluetooth())return;stopScan();close(index);
  try{Link l=new Link();links[index]=l;status(index,"Connecting...");l.gatt=adapter.getRemoteDevice(address).connectGatt(this,false,new BluetoothGattCallback(){
   @Override public void onConnectionStateChange(BluetoothGatt g,int code,int state){if(links[index]!=l)return;
    if(code==BluetoothGatt.GATT_SUCCESS&&state==BluetoothProfile.STATE_CONNECTED){status(index,"Negotiating MTU...");if(!g.requestMtu(185))discover(l);ui.postDelayed(()->{if(links[index]==l&&!l.discovering)discover(l);},5000);}
    else if(state==BluetoothProfile.STATE_DISCONNECTED||code!=BluetoothGatt.GATT_SUCCESS){l.ready=false;if(l.pending!=null)l.pending.countDown();status(index,"Disconnected ("+code+")");log("D"+(index+1)+" disconnected: "+code);g.close();}}
   @Override public void onMtuChanged(BluetoothGatt g,int mtu,int code){if(links[index]!=l)return;if(code==BluetoothGatt.GATT_SUCCESS)l.mtu=mtu;discover(l);}
   @Override public void onServicesDiscovered(BluetoothGatt g,int code){if(links[index]!=l)return;BluetoothGattService s=g.getService(SERVICE);l.characteristic=s==null?null:s.getCharacteristic(CHAR);int p=l.characteristic==null?0:l.characteristic.getProperties();l.ready=code==BluetoothGatt.GATT_SUCCESS&&l.characteristic!=null&&(p&(BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE))!=0;status(index,l.ready?(l.mtu>=104?"Ready":"MTU too small for upload")+" (MTU "+l.mtu+")":"Unsupported service/characteristic");log("D"+(index+1)+" discovery "+code+", MTU "+l.mtu+", properties "+p);}
   @Override public void onCharacteristicWrite(BluetoothGatt g,BluetoothGattCharacteristic c,int code){if(links[index]!=l)return;l.writeStatus=code;if(l.pending!=null)l.pending.countDown();}
  },BluetoothDevice.TRANSPORT_LE);}catch(Exception e){status(index,"Connection failed");log(e.toString());}
 }
 private void checkCancel() throws Exception {if(cancelled||destroyed||Thread.currentThread().isInterrupted())throw new Exception("Cancelled; storage changes cannot be undone.");}
 private void write(int index,byte[] data,long delay) throws Exception {
  checkCancel();Link l=links[index];if(l==null||!l.ready)throw new Exception("Display "+(index+1)+" is not ready.");if(data.length>l.mtu-3)throw new Exception("MTU too small on D"+(index+1));BluetoothGattCharacteristic c=l.characteristic;int type=(c.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0?BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE:BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
  CountDownLatch wait=new CountDownLatch(1);l.pending=wait;l.writeStatus=-1;try{boolean started;if(Build.VERSION.SDK_INT>=33)started=l.gatt.writeCharacteristic(c,data,type)==BluetoothStatusCodes.SUCCESS;else{c.setWriteType(type);c.setValue(data);started=l.gatt.writeCharacteristic(c);}if(!started)throw new Exception("D"+(index+1)+" rejected write");if(!wait.await(12,TimeUnit.SECONDS))throw new Exception("D"+(index+1)+" write timeout");checkCancel();if(l.writeStatus!=BluetoothGatt.GATT_SUCCESS)throw new Exception("D"+(index+1)+" write status "+l.writeStatus);Thread.sleep(delay);}finally{l.pending=null;}
 }
 private static byte[] packet(int block,byte[] rgb){byte[] p=new byte[101];p[0]=(byte)188;p[1]=15;p[2]=(byte)(block+1);System.arraycopy(rgb,block*96,p,3,96);int sum=0;for(int i=1;i<99;i++)sum=(sum+(p[i]&255))&255;p[99]=(byte)sum;p[100]=85;return p;}
 private void operate(Runnable task){if(!busy.compareAndSet(false,true)){log("Operation already running");return;}cancelled=false;js("setBusy(true)");ui.post(()->getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));worker.execute(()->{try{task.run();}finally{busy.set(false);js("setBusy(false)");ui.post(()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));}});}
 public class Bridge {
  @JavascriptInterface public String load(){try{return new String(Files.readAllBytes(new File(getFilesDir(),"library.json").toPath()),StandardCharsets.UTF_8);}catch(Exception e){return "{}";}}
  @JavascriptInterface public synchronized String save(String text){try{if(text.length()>40_000_000)throw new IOException("Library exceeds 40 MB. Use smaller source images or fewer sequences.");new JSONObject(text);File tmp=new File(getFilesDir(),"library.tmp");try(FileOutputStream out=new FileOutputStream(tmp)){out.write(text.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}Files.move(tmp.toPath(),new File(getFilesDir(),"library.json").toPath(),StandardCopyOption.REPLACE_EXISTING);return "";}catch(Exception e){return e.toString();}}
  @JavascriptInterface public void scan(int i){ui.post(()->{if(busy.get()||!bluetooth())return;stopScan();ui.removeCallbacks(stopScanTask);found.clear();js("clearDevices()");scanner=adapter.getBluetoothLeScanner();try{scanner.startScan(scanCallback);ui.postDelayed(stopScanTask,10000);log("Scanning for 10 seconds...");}catch(Exception e){log(e.toString());}});}
  @JavascriptInterface public void connectDisplay(int i,String address){ui.post(()->connect(i,address));}
  @JavascriptInterface public void disconnect(){ui.post(()->{cancelled=true;stopScan();for(int i=0;i<4;i++)close(i);});}
  @JavascriptInterface public void cancel(){cancelled=true;log("Cancellation requested; storage changes cannot be undone.");}
  @JavascriptInterface public void upload(String text,boolean replace){operate(()->{try{JSONArray frames=new JSONObject(text).getJSONArray("frames");int n=frames.length();if(n<1||n>200)throw new Exception("Use 1–200 steps.");byte[][][] rgb=new byte[4][n][];
   for(int d=0;d<4;d++){Link l=links[d];if(l==null||!l.ready||l.mtu<104)throw new Exception("All four displays must be ready; check D"+(d+1));for(int k=0;k<n;k++){rgb[d][k]=Base64.decode(frames.getJSONArray(k).getString(d),Base64.DEFAULT);if(rgb[d][k].length!=768)throw new Exception("Invalid tile data");}}
   int total=4*n*12+(replace?4:0),done=0;if(replace)for(int d=0;d<4;d++){log("Clearing D"+(d+1));write(d,CLEAR,1000);done++;}
   for(int d=0;d<4;d++)for(int k=0;k<n;k++){status(d,"Uploading "+(k+1)+"/"+n);log("D"+(d+1)+" image "+(k+1)+"/"+n);write(d,BEGIN,200);done++;write(d,FRAME,200);done++;for(int b=0;b<8;b++){write(d,packet(b,rgb[d][k]),80);done++;js("progress("+done+","+total+")");}write(d,COMMIT,200);done++;write(d,END,1000);done++;js("progress("+done+","+total+")");}
   for(int i=0;i<4;i++)status(i,"Upload commands completed");js("notify('Upload completed. Use Start stored slideshow to begin hardware playback.')");
  }catch(Exception e){log("UPLOAD STOPPED: "+e.getMessage());js("notify("+JSONObject.quote("Upload stopped: "+e.getMessage())+")");}});}
  @JavascriptInterface public void playAll(){operate(()->{try{for(int i=0;i<4;i++)if(links[i]==null||!links[i].ready)throw new Exception("Connect all four displays first");for(int i=0;i<4;i++)write(i,PLAY,200);js("notify('Start commands sent to all four displays.')");}catch(Exception e){js("notify("+JSONObject.quote("Playback failed: "+e.getMessage())+")");}});}
  @JavascriptInterface public void exportLibrary(String text){ui.post(()->{if(pendingExport!=null)return;pendingExport=text;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/json");i.putExtra(Intent.EXTRA_TITLE,"four-display-library.json");try{startActivityForResult(i,82);}catch(Exception e){pendingExport=null;log(e.toString());}});}
  @JavascriptInterface public void importLibrary(){ui.post(()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");try{startActivityForResult(i,83);}catch(Exception e){log(e.toString());}});}
 }
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==81&&picker!=null){picker.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);picker=null;return;}
  if(request==82){String text=pendingExport;pendingExport=null;if(result!=RESULT_OK||data==null||text==null)return;try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"wt")){if(out==null)throw new IOException("No output stream");out.write(text.getBytes(StandardCharsets.UTF_8));log("Backup exported");}catch(Exception e){log("Export failed: "+e);}return;}
  if(request==83&&result==RESULT_OK&&data!=null){try(InputStream in=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)throw new IOException("No input stream");byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>40_000_000)throw new IOException("Backup exceeds 40 MB");}js("receiveBackup("+JSONObject.quote(new String(out.toByteArray(),StandardCharsets.UTF_8))+")");}catch(Exception e){log("Import failed: "+e);}}
 }
 @Override public void onBackPressed(){web.evaluateJavascript("handleBack()",value->{if(!"true".equals(value))super.onBackPressed();});}
 @Override protected void onPause(){super.onPause();js("pausePreview();flushDraft()");}
 @Override protected void onDestroy(){destroyed=true;cancelled=true;stopScan();for(int i=0;i<4;i++)close(i);worker.shutdownNow();ui.removeCallbacksAndMessages(null);if(picker!=null)picker.onReceiveValue(null);web.destroy();super.onDestroy();}
}
