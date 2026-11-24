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
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReferenceArray;

public class MainActivity extends Activity {
 private static final UUID SERVICE=UUID.fromString("0000ffd0-0000-1000-8000-00805f9b34fb"), CHAR=UUID.fromString("0000ffd1-0000-1000-8000-00805f9b34fb");
 private static byte[] bytes(int... a){byte[] b=new byte[a.length];for(int i=0;i<a.length;i++)b[i]=(byte)a[i];return b;}
 private static final byte[] CLEAR=bytes(188,0,21,21,85),PLAY=bytes(188,0,18,18,85),BEGIN=bytes(188,0,17,241,3,85),END=bytes(188,0,17,242,4,85),FRAME=bytes(188,15,241,8,8,85),COMMIT=bytes(188,15,242,8,9,85);
 private WebView web;private ValueCallback<Uri[]> picker;
 private BluetoothAdapter adapter;private BluetoothLeScanner scanner;
 private final Handler ui=new Handler(Looper.getMainLooper());
 // Coordinator never performs GATT writes itself. Each device owns one serial lane for storage uploads.
 private final ExecutorService coordinator=Executors.newSingleThreadExecutor();
 private final ExecutorService[] lanes={Executors.newSingleThreadExecutor(),Executors.newSingleThreadExecutor(),Executors.newSingleThreadExecutor(),Executors.newSingleThreadExecutor()};
 private final ExecutorService previewWorker=Executors.newSingleThreadExecutor();
 private final AtomicBoolean previewRunning=new AtomicBoolean();
 private final AtomicBoolean busy=new AtomicBoolean();
 private volatile boolean cancelled,destroyed,liveAllowed;
 private final Object previewLock=new Object();private final byte[][] pendingPreview=new byte[4][];
 private final Set<String> found=new HashSet<>();private final AtomicReferenceArray<Link> links=new AtomicReferenceArray<>(4);private String pendingExport;
 private static class Link {BluetoothGatt gatt;volatile BluetoothGattCharacteristic characteristic;volatile int mtu=23,writeStatus=-1;volatile boolean ready,discovering;volatile CountDownLatch pending;}
 @FunctionalInterface private interface LaneTask {void run() throws Exception;}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);BluetoothManager manager=(BluetoothManager)getSystemService(BLUETOOTH_SERVICE);adapter=manager==null?null:manager.getAdapter();
  if(Build.VERSION.SDK_INT>=30){
   getWindow().setDecorFitsSystemWindows(false);
   // Keep the verified startup fix: ensure a decor view exists before asking for its controller.
   WindowInsetsController controller=getWindow().getDecorView().getWindowInsetsController();
   if(controller!=null)controller.setSystemBarsAppearance(0,WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
  }
  FrameLayout host=new FrameLayout(this);host.setBackgroundColor(android.graphics.Color.rgb(14,20,29));web=new WebView(this);host.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(host);
  host.setOnApplyWindowInsetsListener((v,insets)->{
   int left,top,right,bottom;
   if(Build.VERSION.SDK_INT>=30){android.graphics.Insets b=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());left=b.left;top=b.top;right=b.right;bottom=b.bottom;}
   else{left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();}
   FrameLayout.LayoutParams p=(FrameLayout.LayoutParams)web.getLayoutParams();if(p.leftMargin!=left||p.topMargin!=top||p.rightMargin!=right||p.bottomMargin!=bottom){p.setMargins(left,top,right,bottom);web.setLayoutParams(p);}
   return Build.VERSION.SDK_INT>=30?WindowInsets.CONSUMED:insets.consumeSystemWindowInsets();
  });host.requestApplyInsets();
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setAllowFileAccess(true);settings.setAllowContentAccess(true);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
  web.addJavascriptInterface(new Bridge(),"Native");web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}});
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(picker!=null)picker.onReceiveValue(null);picker=callback;Intent intent=new Intent(Intent.ACTION_GET_CONTENT);intent.setType("image/*");intent.addCategory(Intent.CATEGORY_OPENABLE);try{startActivityForResult(intent,81);}catch(Exception e){picker.onReceiveValue(null);picker=null;log(e.toString());}return true;}
   @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){
    new android.app.AlertDialog.Builder(MainActivity.this).setTitle("LED Matrix Controller").setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setOnCancelListener(d->result.confirm()).show();return true;
   }
   @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){
    new android.app.AlertDialog.Builder(MainActivity.this).setTitle("LED Matrix Controller").setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
   }
  });
  web.loadUrl("file:///android_asset/index.html");
 }
 private void js(String code){ui.post(()->{if(!destroyed)web.evaluateJavascript(code,null);});}
 private void log(String text){js("log("+JSONObject.quote(text)+")");}
 private void status(int index,String text){Link link=links.get(index);boolean ready=link!=null&&link.ready;js("setStatus("+index+","+JSONObject.quote(text)+","+ready+")");}
 private boolean isReady(int index){Link link=links.get(index);return link!=null&&link.ready;}
 private boolean bluetooth(){
  boolean permitted=Build.VERSION.SDK_INT>=31?checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED:checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  if(!permitted){requestPermissions(Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION},40);log("Grant permissions, then scan/connect again.");return false;}
  if(adapter==null||!adapter.isEnabled()){log("Enable Bluetooth in phone settings.");return false;}return true;
 }
 private void stopScan(){try{if(scanner!=null)scanner.stopScan(scanCallback);}catch(Exception ignored){}}
 private final Runnable stopScanTask=()->{stopScan();js("scanFinished()");};
 private final ScanCallback scanCallback=new ScanCallback(){
  @Override public void onScanResult(int type,ScanResult result){
   try{
    BluetoothDevice device=result.getDevice();
    if(device==null)return;
    String name=device.getName();
    android.bluetooth.le.ScanRecord record=result.getScanRecord();
    String recordName=record!=null?record.getDeviceName():null;
    String displayName=name!=null&&!name.isEmpty()?name:(recordName!=null&&!recordName.isEmpty()?recordName:"");
    String search=(displayName+" "+device.getAddress()).toLowerCase(java.util.Locale.ROOT);
    if(!search.contains("mi matrix display"))return;
    if(!found.add(device.getAddress()))return;
    js("deviceFound("+JSONObject.quote(device.getAddress())+","+JSONObject.quote(displayName.isEmpty()?"MI Matrix Display":displayName)+")");
   }catch(Exception e){log(e.toString());}
  }
  @Override public void onScanFailed(int error){log("Scan failed: "+error);js("scanFinished()");}
 };
 private void close(int index){Link link=links.getAndSet(index,null);if(link!=null){link.ready=false;if(link.pending!=null)link.pending.countDown();try{link.gatt.disconnect();link.gatt.close();}catch(Exception ignored){}}status(index,"Disconnected");}
 private void discover(Link link){if(link.discovering)return;link.discovering=true;try{if(!link.gatt.discoverServices())log("Service discovery failed to start; reconnect.");}catch(Exception e){log(e.toString());}}
 private void connect(int index,String address){
  if(index<0||index>3||busy.get()||!bluetooth())return;stopScan();close(index);
  try{Link link=new Link();links.set(index,link);status(index,"Connecting...");link.gatt=adapter.getRemoteDevice(address).connectGatt(this,false,new BluetoothGattCallback(){
   @Override public void onConnectionStateChange(BluetoothGatt gatt,int code,int state){
    if(links.get(index)!=link)return;
    if(code==BluetoothGatt.GATT_SUCCESS&&state==BluetoothProfile.STATE_CONNECTED){status(index,"Negotiating MTU...");if(!gatt.requestMtu(185))discover(link);ui.postDelayed(()->{if(links.get(index)==link&&!link.discovering)discover(link);},5000);}
    else if(state==BluetoothProfile.STATE_DISCONNECTED||code!=BluetoothGatt.GATT_SUCCESS){link.ready=false;if(link.pending!=null)link.pending.countDown();status(index,"Disconnected ("+code+")");log("D"+(index+1)+" disconnected: "+code);gatt.close();}
   }
   @Override public void onMtuChanged(BluetoothGatt gatt,int mtu,int code){if(links.get(index)!=link)return;if(code==BluetoothGatt.GATT_SUCCESS)link.mtu=mtu;discover(link);}
   @Override public void onServicesDiscovered(BluetoothGatt gatt,int code){
    if(links.get(index)!=link)return;BluetoothGattService service=gatt.getService(SERVICE);link.characteristic=service==null?null:service.getCharacteristic(CHAR);int properties=link.characteristic==null?0:link.characteristic.getProperties();link.ready=code==BluetoothGatt.GATT_SUCCESS&&link.characteristic!=null&&(properties&(BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE))!=0&&link.mtu>=104;
    if(link.ready){try{gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);}catch(Exception ignored){}}
    status(index,link.ready?"Ready (MTU "+link.mtu+")":"Not ready: check service / MTU "+link.mtu);log("D"+(index+1)+" services "+code+", properties "+properties+", MTU "+link.mtu);
   }
   @Override public void onCharacteristicWrite(BluetoothGatt gatt,BluetoothGattCharacteristic characteristic,int code){if(links.get(index)!=link)return;link.writeStatus=code;CountDownLatch pending=link.pending;if(pending!=null)pending.countDown();}
  },BluetoothDevice.TRANSPORT_LE);}catch(Exception e){status(index,"Connection failed");log(e.toString());}
 }
 private void checkCancel() throws Exception {if(cancelled||destroyed||Thread.currentThread().isInterrupted())throw new Exception("Cancelled; storage changes cannot be undone.");}
 // Serial GATT write with completion verification (ack=true prefers WRITE_TYPE_DEFAULT to wait for air-ACK when supported).
 private void write(int index,byte[] data,long delay) throws Exception {write(index,data,delay,false);}
 private void write(int index,byte[] data,long delay,boolean ack) throws Exception {
  checkCancel();Link link=links.get(index);if(link==null||!link.ready)throw new Exception("D"+(index+1)+" not ready");if(data.length>link.mtu-3)throw new Exception("MTU too small");
  BluetoothGattCharacteristic characteristic=link.characteristic;
  int props=characteristic.getProperties();
  int type=(ack&&(props&BluetoothGattCharacteristic.PROPERTY_WRITE)!=0)?BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT:((props&BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0?BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE:BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
  CountDownLatch wait=new CountDownLatch(1);link.pending=wait;link.writeStatus=-1;
  try{boolean started;if(Build.VERSION.SDK_INT>=33)started=link.gatt.writeCharacteristic(characteristic,data,type)==BluetoothStatusCodes.SUCCESS;else{characteristic.setWriteType(type);characteristic.setValue(data);started=link.gatt.writeCharacteristic(characteristic);}if(!started)throw new Exception("Write rejected");if(!wait.await(12,TimeUnit.SECONDS))throw new Exception("Write timeout");checkCancel();if(link.writeStatus!=BluetoothGatt.GATT_SUCCESS)throw new Exception("Write status "+link.writeStatus);if(delay>0)Thread.sleep(delay);}
  catch(Exception error){
   // Do not queue another write on a connection with a timed-out/failed outstanding write.
   if(!cancelled&&!destroyed&&links.compareAndSet(index,link,null)){link.ready=false;try{link.gatt.disconnect();link.gatt.close();}catch(Exception ignored){}status(index,"Write failed; reconnect");}
   throw error;
  }finally{link.pending=null;}
 }
 private void dispatchPlay(List<Integer> targets){
  for(int index:targets){
   Link link=links.get(index);
   if(link!=null&&link.gatt!=null)try{link.gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);}catch(Exception ignored){}
  }
  try{Thread.sleep(25);}catch(InterruptedException ignored){}
  final CountDownLatch gate=new CountDownLatch(1);
  List<Future<Void>> tasks=new ArrayList<>();
  for(int index:targets){
   final int idx=index;
   tasks.add(submitLane(idx,()->{
    try{gate.await();}catch(InterruptedException ignored){return;}
    fastWrite(idx,PLAY);
   }));
  }
  gate.countDown();
  for(Future<Void> t:tasks)try{await(t);}catch(Exception ignored){}
 }
 // Direct non-blocking write for single-packet synchronized commands (e.g. PLAY).
 private void fastWrite(int index,byte[] data){
  Link link=links.get(index);if(link==null||!link.ready)return;
  BluetoothGattCharacteristic characteristic=link.characteristic;
  int type=(characteristic.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0?BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE:BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
  try{
   if(Build.VERSION.SDK_INT>=33)link.gatt.writeCharacteristic(characteristic,data,type);
   else{characteristic.setWriteType(type);characteristic.setValue(data);link.gatt.writeCharacteristic(characteristic);}
  }catch(Exception e){log("Direct write D"+(index+1)+": "+e.getMessage());}
 }
 private static byte[] storePacket(int block,byte[] rgb){byte[] packet=new byte[101];packet[0]=(byte)188;packet[1]=15;packet[2]=(byte)(block+1);System.arraycopy(rgb,block*96,packet,3,96);int sum=0;for(int i=1;i<99;i++)sum=(sum+(packet[i]&255))&255;packet[99]=(byte)sum;packet[100]=85;return packet;}
 private static byte[] livePacket(int block,byte[] rgb){byte[] packet=new byte[100];packet[0]=(byte)188;packet[1]=15;packet[2]=(byte)(block+1);System.arraycopy(rgb,block*96,packet,3,96);packet[99]=85;return packet;}
 private void clearPreviews(){synchronized(previewLock){Arrays.fill(pendingPreview,null);}}
 private boolean hasAnyPreview(){synchronized(previewLock){for(int i=0;i<4;i++)if(pendingPreview[i]!=null)return true;return false;}}

 // Parallel interleaved live preview across per-display lanes so all displays refresh fast and in lockstep.
 private void schedulePreview(){
  if(destroyed||busy.get()||!liveAllowed||!previewRunning.compareAndSet(false,true))return;
  try{previewWorker.execute(()->{
   try{while(!destroyed&&!busy.get()&&liveAllowed){
    byte[][] frames=new byte[4][];boolean hasData=false;
    synchronized(previewLock){for(int i=0;i<4;i++){frames[i]=pendingPreview[i];pendingPreview[i]=null;if(frames[i]!=null)hasData=true;}}
    if(!hasData)break;
    long t0=SystemClock.elapsedRealtime();long[] tHdr={-1,-1,-1,-1},tB6={-1,-1,-1,-1},tB7={-1,-1,-1,-1};
    // Step 1: Send FRAME header in parallel across displays that have new tile data
    List<Future<Void>> hdrs=new ArrayList<>();
    for(int i=0;i<4;i++){
     final int idx=i;final byte[] tile=frames[i];
     if(tile!=null&&isReady(idx))hdrs.add(submitLane(idx,()->{
      if(!liveAllowed||busy.get()||destroyed)return;
      try{write(idx,FRAME,0);tHdr[idx]=SystemClock.elapsedRealtime()-t0;}catch(Exception e){log("Live D"+(idx+1)+": "+e.getMessage());js("liveError("+idx+")");}
     }));
    }
    for(Future<Void> f:hdrs)try{await(f);}catch(Exception ignored){}
    // Step 2: Send blocks 0 to 6 in parallel per block across displays
    boolean anyAckSupported=false;int activeCount=0;
    for(int i=0;i<4;i++)if(frames[i]!=null&&isReady(i))activeCount++;
    long blockPace=activeCount>1?15:0;
    for(int block=0;block<7;block++){
     if(!liveAllowed||busy.get()||destroyed)break;
     final int b=block;final boolean useAck=(block==6);
     List<Future<Void>> step=new ArrayList<>();
     for(int i=0;i<4;i++){
      final int idx=i;final byte[] tile=frames[i];
      if(tile!=null&&isReady(idx)){
       Link lk=links.get(idx);
       if(lk!=null&&lk.characteristic!=null&&(lk.characteristic.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE)!=0)anyAckSupported=true;
       step.add(submitLane(idx,()->{
        if(!liveAllowed||busy.get()||destroyed)return;
        try{write(idx,livePacket(b,tile),blockPace,useAck);if(b==6)tB6[idx]=SystemClock.elapsedRealtime()-t0;}catch(Exception e){log("Live D"+(idx+1)+": "+e.getMessage());js("liveError("+idx+")");}
       }));
      }
     }
     for(Future<Void> f:step)try{await(f);}catch(Exception ignored){}
    }
    if(!liveAllowed||busy.get()||destroyed)break;
    if(activeCount>1){
     for(int i=0;i<4;i++){if(frames[i]!=null&&isReady(i)){Link lk=links.get(i);if(lk!=null&&lk.gatt!=null)try{lk.gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);}catch(Exception ignored){}}}
    }
    // Displays are WRITE_NO_RESPONSE only (properties=4): allow HCI TX buffers to fully drain before firing block 7
    if(!anyAckSupported&&activeCount>1)try{Thread.sleep(100);}catch(InterruptedException ignored){}
    // Step 3: Fire final trigger block 7 simultaneously across all ready displays using a start gate
    final CountDownLatch gate=new CountDownLatch(1);
    List<Future<Void>> fin=new ArrayList<>();
    for(int i=0;i<4;i++){
     final int idx=i;final byte[] tile=frames[i];
     if(tile!=null&&isReady(idx))fin.add(submitLane(idx,()->{
      try{gate.await();}catch(InterruptedException ignored){return;}
      if(!liveAllowed||busy.get()||destroyed)return;
      fastWrite(idx,livePacket(7,tile));tB7[idx]=SystemClock.elapsedRealtime()-t0;
     }));
    }
    gate.countDown();
    for(Future<Void> f:fin)try{await(f);}catch(Exception ignored){}
    if(activeCount>1){
     StringBuilder sb=new StringBuilder("Live ms (hdr/b6/b7):");
     for(int i=0;i<4;i++)if(frames[i]!=null&&isReady(i))sb.append(" D").append(i+1).append("=").append(tHdr[i]).append("/").append(tB6[i]).append("/").append(tB7[i]);
     log(sb.toString());
    }
   }}finally{previewRunning.set(false);if(!destroyed&&!busy.get()&&liveAllowed&&hasAnyPreview())schedulePreview();}
  });}catch(RejectedExecutionException ignored){previewRunning.set(false);}
 }

 private Future<Void> submitLane(int index,LaneTask task){return lanes[index].submit(()->{task.run();return null;});}
 private void await(Future<?> future) throws Exception {try{future.get();}catch(ExecutionException e){Throwable cause=e.getCause();if(cause instanceof Exception)throw (Exception)cause;throw new Exception(cause);}catch(InterruptedException e){Thread.currentThread().interrupt();throw e;}}
 // Finish old preview frames and lane tasks on ALL devices before a storage or play operation.
 private void waitForIdleLanes() throws Exception {
  List<Future<Void>> barriers=new ArrayList<>();
  barriers.add(previewWorker.submit(()->null));
  for(int index=0;index<4;index++)barriers.add(submitLane(index,()->{}));
  for(Future<Void> barrier:barriers)await(barrier);
  checkCancel();
 }
 private void operate(Runnable task){
  if(!busy.compareAndSet(false,true)){log("Operation already running");return;}cancelled=false;clearPreviews();js("setBusy(true)");ui.post(()->getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
  coordinator.execute(()->{try{task.run();}finally{busy.set(false);js("setBusy(false)");ui.post(()->getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));}});
 }
 public class Bridge {
  @JavascriptInterface public String load(){try{return new String(Files.readAllBytes(new File(getFilesDir(),"library.json").toPath()),StandardCharsets.UTF_8);}catch(Exception e){return "{}";}}
  @JavascriptInterface public synchronized String save(String text){try{if(text.length()>40_000_000)throw new IOException("Library exceeds 40 MB");new JSONObject(text);File temporary=new File(getFilesDir(),"library.tmp");try(FileOutputStream output=new FileOutputStream(temporary)){output.write(text.getBytes(StandardCharsets.UTF_8));output.getFD().sync();}Files.move(temporary.toPath(),new File(getFilesDir(),"library.json").toPath(),StandardCopyOption.REPLACE_EXISTING);return "";}catch(Exception e){return e.toString();}}
  @JavascriptInterface public void scan(){ui.post(()->{if(busy.get()||!bluetooth()){js("scanFinished()");return;}stopScan();ui.removeCallbacks(stopScanTask);found.clear();js("clearDevices()");scanner=adapter.getBluetoothLeScanner();try{scanner.startScan(scanCallback);ui.postDelayed(stopScanTask,10000);}catch(Exception e){log(e.toString());js("scanFinished()");}});}
  @JavascriptInterface public void stopScanNow(){ui.post(()->{stopScan();ui.removeCallbacks(stopScanTask);});}
  @JavascriptInterface public void connectDisplay(int index,String address){ui.post(()->{if(!busy.get())cancelled=false;connect(index,address);});}
  @JavascriptInterface public void disconnect(){liveAllowed=false;clearPreviews();ui.post(()->{cancelled=true;stopScan();for(int index=0;index<4;index++)close(index);});}
  @JavascriptInterface public void cancel(){cancelled=true;log("Cancel requested; previous storage changes cannot be undone.");}
  @JavascriptInterface public void setLive(boolean enabled){liveAllowed=enabled;if(!enabled)clearPreviews();else if(!busy.get()){cancelled=false;schedulePreview();}}
  @JavascriptInterface public void preview(String text){
   if(!liveAllowed||busy.get()||destroyed)return;
   try{JSONArray array=new JSONArray(text);if(array.length()!=4)return;byte[][] incoming=new byte[4][];for(int index=0;index<4;index++)if(!array.isNull(index)){incoming[index]=Base64.decode(array.getString(index),Base64.DEFAULT);if(incoming[index].length!=768)throw new IOException("Invalid preview tile");}
    synchronized(previewLock){if(!liveAllowed||busy.get()||destroyed)return;for(int index=0;index<4;index++)if(incoming[index]!=null)pendingPreview[index]=incoming[index];}schedulePreview();
   }catch(Exception e){log("Preview rejected: "+e.getMessage());}
  }
  @JavascriptInterface public void upload(String text,boolean replace){operate(()->{
   try{JSONObject payload=new JSONObject(text);JSONArray array=payload.getJSONArray("frames");int count=array.length();if(count<1||count>200)throw new Exception("Use 1–200 steps");
    JSONArray requested=payload.optJSONArray("targets");List<Integer> targets=new ArrayList<>();
    if(requested==null){for(int i=0;i<4;i++)targets.add(i);}else{if(requested.length()<1||requested.length()>4)throw new Exception("Choose 1–4 displays");for(int i=0;i<requested.length();i++){int index=requested.getInt(i);if(index<0||index>3||targets.contains(index))throw new Exception("Invalid or duplicate destination");targets.add(index);}}
    byte[][][] rgb=new byte[4][count][];
    for(int display:targets){Link link=links.get(display);if(link==null||!link.ready)throw new Exception("D"+(display+1)+" must be ready");for(int frame=0;frame<count;frame++){rgb[display][frame]=Base64.decode(array.getJSONArray(frame).getString(display),Base64.DEFAULT);if(rgb[display][frame].length!=768)throw new Exception("Invalid tile");}}
    boolean fast=payload.optBoolean("fast",false);
    waitForIdleLanes();
    int total=targets.size()*count*12+(replace?targets.size():0);
    if(fast){
     final AtomicInteger done=new AtomicInteger(0);
     js("transferLabel("+JSONObject.quote("Fast parallel upload · "+count+" images")+")");
     List<Future<Void>> tasks=new ArrayList<>();
     for(int display:targets){
      final int index=display;
      tasks.add(submitLane(index,()->{
       if(replace){write(index,CLEAR,150);js("progress("+done.incrementAndGet()+","+total+")");}
       for(int frame=0;frame<count;frame++){
        final byte[] pixels=rgb[index][frame];
        write(index,BEGIN,10);done.incrementAndGet();
        write(index,FRAME,10);done.incrementAndGet();
        for(int block=0;block<8;block++){write(index,storePacket(block,pixels),5);js("progress("+done.incrementAndGet()+","+total+")");}
        write(index,COMMIT,10);done.incrementAndGet();
        write(index,END,100);js("progress("+done.incrementAndGet()+","+total+")");
       }
       js("storageDisplayComplete("+index+")");
      }));
     }
     for(Future<Void> t:tasks)await(t);
    }else{
     // Sequential clear and upload per display (conservative fallback)
     int done=0;
     if(replace)for(int display:targets){final int index=display;log("Clearing D"+(index+1));await(submitLane(index,()->write(index,CLEAR,1000)));done++;js("progress("+done+","+total+")");}
     for(int display:targets){for(int frame=0;frame<count;frame++){
      final int index=display;final byte[] pixels=rgb[display][frame];js("transferLabel("+JSONObject.quote("Display "+(display+1)+" · Image "+(frame+1)+"/"+count)+")");
      await(submitLane(index,()->write(index,BEGIN,200)));done++;await(submitLane(index,()->write(index,FRAME,200)));done++;
      for(int block=0;block<8;block++){final byte[] packet=storePacket(block,pixels);await(submitLane(index,()->write(index,packet,80)));done++;js("progress("+done+","+total+")");}
      await(submitLane(index,()->write(index,COMMIT,200)));done++;await(submitLane(index,()->write(index,END,1000)));done++;js("progress("+done+","+total+")");
     }js("storageDisplayComplete("+display+")");}
    }
    js("notify('Upload commands completed. Playback has not started automatically.')");
   }catch(Exception e){js("notify("+JSONObject.quote("Upload stopped: "+e.getMessage())+")");}
   finally{js("storageUploadFinished()");}
  });}
  @JavascriptInterface public void playSelected(String text){liveAllowed=false;clearPreviews();operate(()->{
   try{JSONArray requested=new JSONArray(text);if(requested.length()<1||requested.length()>4)throw new Exception("Choose 1–4 displays");List<Integer> targets=new ArrayList<>();
    for(int i=0;i<requested.length();i++){int index=requested.getInt(i);if(index<0||index>3||targets.contains(index))throw new Exception("Invalid or duplicate destination");Link link=links.get(index);if(link==null||!link.ready)throw new Exception("Connect D"+(index+1)+" first");targets.add(index);}
    waitForIdleLanes();
    dispatchPlay(targets);
    js("notify('Selected slideshow start commands dispatched.')");
   }catch(Exception e){js("notify("+JSONObject.quote(e.getMessage())+")");}
  });}
  @JavascriptInterface public void playAll(){liveAllowed=false;clearPreviews();operate(()->{
   try{List<Integer> targets=new ArrayList<>();
    for(int index=0;index<4;index++){Link link=links.get(index);if(link==null||!link.ready)throw new Exception("Connect all four displays first");targets.add(index);}
    waitForIdleLanes();
    dispatchPlay(targets);
    js("notify('Stored slideshow start commands dispatched.')");
   }catch(Exception e){js("notify("+JSONObject.quote(e.getMessage())+")");}
  });}
  @JavascriptInterface public void exportLibrary(String text){ui.post(()->{if(pendingExport!=null)return;pendingExport=text;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/json");intent.putExtra(Intent.EXTRA_TITLE,"four-display-library.json");try{startActivityForResult(intent,82);}catch(Exception e){pendingExport=null;log(e.toString());}});}
  @JavascriptInterface public void importLibrary(){ui.post(()->{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");try{startActivityForResult(intent,83);}catch(Exception e){log(e.toString());}});}
  @JavascriptInterface public void checkUpdate(boolean silent){
   new Thread(()->{
    try{
     java.net.URL url=new java.net.URL("https://api.github.com/repos/ctrexler/MI-LED-Matrix-Android-Interface-AI-Experiment-/releases/tags/latest");
     javax.net.ssl.HttpsURLConnection conn=(javax.net.ssl.HttpsURLConnection)url.openConnection();
     conn.setConnectTimeout(10000);conn.setReadTimeout(10000);
     conn.setRequestProperty("Accept","application/vnd.github+json");
     conn.setRequestProperty("User-Agent","LED-Matrix-Controller");
     int status=conn.getResponseCode();
     if(status!=200){if(!silent)js("notify('Update check failed (HTTP "+status+").')");return;}
     ByteArrayOutputStream out=new ByteArrayOutputStream();
     try(InputStream in=conn.getInputStream()){byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);}
     JSONObject rel=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
     String body=rel.optString("body","");
     java.util.regex.Matcher mc=java.util.regex.Pattern.compile("versionCode:(\\d+)").matcher(body);
     if(!mc.find()){if(!silent)js("notify('No release version info found.')");return;}
     long remoteCode=Long.parseLong(mc.group(1));
     java.util.regex.Matcher mn=java.util.regex.Pattern.compile("versionName:([^\\s\\r\\n]+)").matcher(body);
     String remoteName=mn.find()?mn.group(1):"latest";
     String apkUrl=null;
     JSONArray assets=rel.optJSONArray("assets");
     if(assets!=null)for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);if(a.optString("name","").endsWith(".apk")){apkUrl=a.optString("browser_download_url","");break;}}
     if(apkUrl==null||apkUrl.isEmpty()){if(!silent)js("notify('No APK found in latest release.')");return;}
     android.content.pm.PackageInfo pi=getPackageManager().getPackageInfo(getPackageName(),0);
     long currentCode=Build.VERSION.SDK_INT>=28?pi.getLongVersionCode():pi.versionCode;
     if(remoteCode>currentCode)js("onUpdateAvailable("+remoteCode+","+JSONObject.quote(remoteName)+","+JSONObject.quote(apkUrl)+")");
     else if(!silent)js("notify('App is up to date (build "+currentCode+").')");
    }catch(Exception e){if(!silent)js("notify("+JSONObject.quote("Update check failed: "+e.getMessage())+")");else log("Update check: "+e.getMessage());}
   },"update-check").start();
  }
  @JavascriptInterface public void installUpdate(String apkUrl){
   if(!getPackageManager().canRequestPackageInstalls()){
    ui.post(()->{
     js("notify('Allow Install unknown apps for LED Matrix Controller, then tap Update again.')");
     Intent s=new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName()));
     s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
     try{startActivity(s);}catch(Exception e){log(e.toString());}
    });
    return;
   }
   js("notify('Downloading update…')");
   new Thread(()->{
    try{
     String cur=apkUrl;
     java.net.HttpURLConnection conn=null;
     for(int hops=0;hops<5;hops++){
      conn=(java.net.HttpURLConnection)new java.net.URL(cur).openConnection();
      conn.setConnectTimeout(15000);conn.setReadTimeout(30000);
      conn.setInstanceFollowRedirects(false);
      conn.setRequestProperty("User-Agent","LED-Matrix-Controller");
      int code=conn.getResponseCode();
      if(code==301||code==302||code==303||code==307||code==308){cur=conn.getHeaderField("Location");conn.disconnect();continue;}
      break;
     }
     if(conn==null||conn.getResponseCode()!=200)throw new IOException("Download failed");
     File tmp=new File(getCacheDir(),"update.apk.part"),dest=new File(getCacheDir(),"update.apk");
     try(InputStream in=conn.getInputStream();FileOutputStream fos=new FileOutputStream(tmp)){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)fos.write(buf,0,n);}
     if(dest.exists())dest.delete();
     if(!tmp.renameTo(dest))throw new IOException("Could not save APK");
     Uri uri=Uri.parse("content://"+getPackageName()+".apkprovider/update.apk");
     ui.post(()->{
      Intent intent=new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri,"application/vnd.android.package-archive");
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
      try{startActivity(intent);}catch(Exception e){js("notify("+JSONObject.quote("Installer failed: "+e.getMessage())+")");}
     });
    }catch(Exception e){js("notify("+JSONObject.quote("Update download failed: "+e.getMessage())+")");}
   },"update-download").start();
  }
 }
 @Override protected void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);
  if(request==81&&picker!=null){picker.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);picker=null;return;}
  if(request==82){String text=pendingExport;pendingExport=null;if(result!=RESULT_OK||data==null||text==null)return;try(OutputStream output=getContentResolver().openOutputStream(data.getData(),"wt")){if(output==null)throw new IOException("No output stream");output.write(text.getBytes(StandardCharsets.UTF_8));log("Backup exported");}catch(Exception e){log("Export failed: "+e);}return;}
  if(request==83&&result==RESULT_OK&&data!=null){try(InputStream input=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream output=new ByteArrayOutputStream()){if(input==null)throw new IOException("No input stream");byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){output.write(buffer,0,count);if(output.size()>40_000_000)throw new IOException("Backup exceeds 40 MB");}js("receiveBackup("+JSONObject.quote(new String(output.toByteArray(),StandardCharsets.UTF_8))+")");}catch(Exception e){log("Import failed: "+e);}}
 }
 @Override public void onBackPressed(){web.evaluateJavascript("handleBack()",value->{if(!"true".equals(value))super.onBackPressed();});}
 @Override protected void onPause(){super.onPause();js("pausePlayback();flushDraft()");}
 @Override protected void onDestroy(){destroyed=true;cancelled=true;liveAllowed=false;clearPreviews();stopScan();for(int index=0;index<4;index++)close(index);coordinator.shutdownNow();previewWorker.shutdownNow();for(ExecutorService lane:lanes)lane.shutdownNow();ui.removeCallbacksAndMessages(null);if(picker!=null)picker.onReceiveValue(null);web.destroy();super.onDestroy();}
}
