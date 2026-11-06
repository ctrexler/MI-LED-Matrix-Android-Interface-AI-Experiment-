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
import java.util.concurrent.atomic.AtomicReferenceArray;

public class MainActivity extends Activity {
 private static final UUID SERVICE=UUID.fromString("0000ffd0-0000-1000-8000-00805f9b34fb"), CHAR=UUID.fromString("0000ffd1-0000-1000-8000-00805f9b34fb");
 private static byte[] bytes(int... a){byte[] b=new byte[a.length];for(int i=0;i<a.length;i++)b[i]=(byte)a[i];return b;}
 private static final byte[] CLEAR=bytes(188,0,21,21,85),PLAY=bytes(188,0,18,18,85),BEGIN=bytes(188,0,17,241,3,85),END=bytes(188,0,17,242,4,85),FRAME=bytes(188,15,241,8,8,85),COMMIT=bytes(188,15,242,8,9,85);
 private WebView web;private ValueCallback<Uri[]> picker;
 private BluetoothAdapter adapter;private BluetoothLeScanner scanner;
 private final Handler ui=new Handler(Looper.getMainLooper());
 // Coordinator never performs GATT writes itself. Each device owns one serial lane.
 private final ExecutorService coordinator=Executors.newSingleThreadExecutor();
 private final ExecutorService[] lanes={Executors.newSingleThreadExecutor(),Executors.newSingleThreadExecutor(),Executors.newSingleThreadExecutor(),Executors.newSingleThreadExecutor()};
 private final AtomicBoolean[] previewRunning={new AtomicBoolean(),new AtomicBoolean(),new AtomicBoolean(),new AtomicBoolean()};
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
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(picker!=null)picker.onReceiveValue(null);picker=callback;Intent intent=new Intent(Intent.ACTION_GET_CONTENT);intent.setType("image/*");intent.addCategory(Intent.CATEGORY_OPENABLE);try{startActivityForResult(intent,81);}catch(Exception e){picker.onReceiveValue(null);picker=null;log(e.toString());}return true;}});
  web.loadUrl("file:///android_asset/index.html");
 }
 private void js(String code){ui.post(()->{if(!destroyed)web.evaluateJavascript(code,null);});}
 private void log(String text){js("log("+JSONObject.quote(text)+")");}
 private void status(int index,String text){Link link=links.get(index);boolean ready=link!=null&&link.ready;js("setStatus("+index+","+JSONObject.quote(text)+","+ready+")");}
 private boolean bluetooth(){
  boolean permitted=Build.VERSION.SDK_INT>=31?checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED:checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  if(!permitted){requestPermissions(Build.VERSION.SDK_INT>=31?new String[]{Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT}:new String[]{Manifest.permission.ACCESS_FINE_LOCATION},40);log("Grant permissions, then scan/connect again.");return false;}
  if(adapter==null||!adapter.isEnabled()){log("Enable Bluetooth in phone settings.");return false;}return true;
 }
 private void stopScan(){try{if(scanner!=null)scanner.stopScan(scanCallback);}catch(Exception ignored){}}
 private final Runnable stopScanTask=()->{stopScan();js("scanFinished()");};
 private final ScanCallback scanCallback=new ScanCallback(){
  @Override public void onScanResult(int type,ScanResult result){try{BluetoothDevice device=result.getDevice();if(!found.add(device.getAddress()))return;String name=device.getName();js("deviceFound("+JSONObject.quote(device.getAddress())+","+JSONObject.quote(name==null?"Unnamed BLE device":name)+")");}catch(Exception e){log(e.toString());}}
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
    status(index,link.ready?"Ready (MTU "+link.mtu+")":"Not ready: check service / MTU "+link.mtu);log("D"+(index+1)+" services "+code+", properties "+properties+", MTU "+link.mtu);
   }
   @Override public void onCharacteristicWrite(BluetoothGatt gatt,BluetoothGattCharacteristic characteristic,int code){if(links.get(index)!=link)return;link.writeStatus=code;CountDownLatch pending=link.pending;if(pending!=null)pending.countDown();}
  },BluetoothDevice.TRANSPORT_LE);}catch(Exception e){status(index,"Connection failed");log(e.toString());}
 }
 private void checkCancel() throws Exception {if(cancelled||destroyed||Thread.currentThread().isInterrupted())throw new Exception("Cancelled; storage changes cannot be undone.");}
 // Only call from the corresponding device lane. At most one outstanding GATT write per device.
 private void write(int index,byte[] data,long delay) throws Exception {
  checkCancel();Link link=links.get(index);if(link==null||!link.ready)throw new Exception("D"+(index+1)+" not ready");if(data.length>link.mtu-3)throw new Exception("MTU too small");
  BluetoothGattCharacteristic characteristic=link.characteristic;int type=(characteristic.getProperties()&BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)!=0?BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE:BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
  CountDownLatch wait=new CountDownLatch(1);link.pending=wait;link.writeStatus=-1;
  try{boolean started;if(Build.VERSION.SDK_INT>=33)started=link.gatt.writeCharacteristic(characteristic,data,type)==BluetoothStatusCodes.SUCCESS;else{characteristic.setWriteType(type);characteristic.setValue(data);started=link.gatt.writeCharacteristic(characteristic);}if(!started)throw new Exception("Write rejected");if(!wait.await(12,TimeUnit.SECONDS))throw new Exception("Write timeout");checkCancel();if(link.writeStatus!=BluetoothGatt.GATT_SUCCESS)throw new Exception("Write status "+link.writeStatus);if(delay>0)Thread.sleep(delay);}
  catch(Exception error){
   // Do not queue another write on a connection with a timed-out/failed outstanding write.
   if(!cancelled&&!destroyed&&links.compareAndSet(index,link,null)){link.ready=false;try{link.gatt.disconnect();link.gatt.close();}catch(Exception ignored){}status(index,"Write failed; reconnect");}
   throw error;
  }finally{link.pending=null;}
 }
 private static byte[] storePacket(int block,byte[] rgb){byte[] packet=new byte[101];packet[0]=(byte)188;packet[1]=15;packet[2]=(byte)(block+1);System.arraycopy(rgb,block*96,packet,3,96);int sum=0;for(int i=1;i<99;i++)sum=(sum+(packet[i]&255))&255;packet[99]=(byte)sum;packet[100]=85;return packet;}
 private static byte[] livePacket(int block,byte[] rgb){byte[] packet=new byte[100];packet[0]=(byte)188;packet[1]=15;packet[2]=(byte)(block+1);System.arraycopy(rgb,block*96,packet,3,96);packet[99]=85;return packet;}
 private void clearPreviews(){synchronized(previewLock){Arrays.fill(pendingPreview,null);}}
 private boolean hasPreview(int index){synchronized(previewLock){return pendingPreview[index]!=null;}}
 private void schedulePreview(final int index){
  if(destroyed||busy.get()||!liveAllowed||!previewRunning[index].compareAndSet(false,true))return;
  try{lanes[index].execute(()->{
   try{while(!destroyed&&!busy.get()&&liveAllowed){byte[] rgb;synchronized(previewLock){rgb=pendingPreview[index];pendingPreview[index]=null;}if(rgb==null)break;Link link=links.get(index);if(link==null||!link.ready)continue;
    try{write(index,FRAME,2);for(int block=0;block<8;block++)write(index,livePacket(block,rgb),5);}
    catch(Exception e){log("Live preview D"+(index+1)+": "+e.getMessage());js("liveError("+index+")");}
   }}finally{previewRunning[index].set(false);if(!destroyed&&!busy.get()&&liveAllowed&&hasPreview(index))schedulePreview(index);}
  });}catch(RejectedExecutionException ignored){previewRunning[index].set(false);}
 }
 private void scheduleAllPreviews(){for(int index=0;index<4;index++)schedulePreview(index);}
 private Future<Void> submitLane(int index,LaneTask task){return lanes[index].submit(()->{task.run();return null;});}
 private void await(Future<?> future) throws Exception {try{future.get();}catch(ExecutionException e){Throwable cause=e.getCause();if(cause instanceof Exception)throw (Exception)cause;throw new Exception(cause);}catch(InterruptedException e){Thread.currentThread().interrupt();throw e;}}
 // Used only by the coordinator. Finish old preview frames on ALL lanes before a storage/play operation.
 private void waitForIdleLanes() throws Exception {List<Future<Void>> barriers=new ArrayList<>();for(int index=0;index<4;index++)barriers.add(submitLane(index,()->{}));for(Future<Void> barrier:barriers)await(barrier);checkCancel();}
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
  @JavascriptInterface public void setLive(boolean enabled){liveAllowed=enabled;if(!enabled)clearPreviews();else if(!busy.get()){cancelled=false;scheduleAllPreviews();}}
  @JavascriptInterface public void preview(String text){
   if(!liveAllowed||busy.get()||destroyed)return;
   try{JSONArray array=new JSONArray(text);if(array.length()!=4)return;byte[][] incoming=new byte[4][];for(int index=0;index<4;index++)if(!array.isNull(index)){incoming[index]=Base64.decode(array.getString(index),Base64.DEFAULT);if(incoming[index].length!=768)throw new IOException("Invalid preview tile");}
    synchronized(previewLock){if(!liveAllowed||busy.get()||destroyed)return;for(int index=0;index<4;index++)if(incoming[index]!=null)pendingPreview[index]=incoming[index];}scheduleAllPreviews();
   }catch(Exception e){log("Preview rejected: "+e.getMessage());}
  }
  @JavascriptInterface public void upload(String text,boolean replace){operate(()->{
   try{JSONArray array=new JSONObject(text).getJSONArray("frames");int count=array.length();if(count<1||count>200)throw new Exception("Use 1–200 steps");byte[][][] rgb=new byte[4][count][];
    for(int display=0;display<4;display++){Link link=links.get(display);if(link==null||!link.ready)throw new Exception("All four must be ready; check D"+(display+1));for(int frame=0;frame<count;frame++){rgb[display][frame]=Base64.decode(array.getJSONArray(frame).getString(display),Base64.DEFAULT);if(rgb[display][frame].length!=768)throw new Exception("Invalid tile");}}
    waitForIdleLanes();
    // Preserve the previously working sequential STORAGE upload timing and clear order.
    int total=4*count*12+(replace?4:0),done=0;
    if(replace)for(int display=0;display<4;display++){final int index=display;log("Clearing D"+(index+1));await(submitLane(index,()->write(index,CLEAR,1000)));done++;}
    for(int display=0;display<4;display++)for(int frame=0;frame<count;frame++){
     final int index=display;final byte[] pixels=rgb[display][frame];js("transferLabel("+JSONObject.quote("Display "+(display+1)+"/4 · Image "+(frame+1)+"/"+count)+")");
     await(submitLane(index,()->write(index,BEGIN,200)));done++;await(submitLane(index,()->write(index,FRAME,200)));done++;
     for(int block=0;block<8;block++){final byte[] packet=storePacket(block,pixels);await(submitLane(index,()->write(index,packet,80)));done++;js("progress("+done+","+total+")");}
     await(submitLane(index,()->write(index,COMMIT,200)));done++;await(submitLane(index,()->write(index,END,1000)));done++;js("progress("+done+","+total+")");
    }
    js("notify('Upload commands completed. Playback has not started automatically.')");
   }catch(Exception e){js("notify("+JSONObject.quote("Upload stopped: "+e.getMessage())+")");}
  });}
  @JavascriptInterface public void playAll(){liveAllowed=false;clearPreviews();operate(()->{
   try{for(int index=0;index<4;index++){Link link=links.get(index);if(link==null||!link.ready)throw new Exception("Connect all four displays first");}
    waitForIdleLanes();
    // Queue all four starts before releasing the gate. No 200-ms inter-device sleeps.
    CountDownLatch startGate=new CountDownLatch(1);List<Future<Void>> starts=new ArrayList<>();
    try{for(int display=0;display<4;display++){final int index=display;starts.add(submitLane(index,()->{startGate.await();write(index,PLAY,0);}));}}
    finally{startGate.countDown();}
    int failures=0;for(int index=0;index<starts.size();index++){try{await(starts.get(index));}catch(Exception e){failures++;log("Stored slideshow start D"+(index+1)+": "+e.getMessage());}}
    js("notify("+JSONObject.quote(failures==0?"Stored slideshow start commands dispatched together.":failures+" slideshow start command(s) failed. See Logs.")+")");
   }catch(Exception e){js("notify("+JSONObject.quote(e.getMessage())+")");}
  });}
  @JavascriptInterface public void exportLibrary(String text){ui.post(()->{if(pendingExport!=null)return;pendingExport=text;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/json");intent.putExtra(Intent.EXTRA_TITLE,"four-display-library.json");try{startActivityForResult(intent,82);}catch(Exception e){pendingExport=null;log(e.toString());}});}
  @JavascriptInterface public void importLibrary(){ui.post(()->{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");try{startActivityForResult(intent,83);}catch(Exception e){log(e.toString());}});}
 }
 @Override protected void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);
  if(request==81&&picker!=null){picker.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);picker=null;return;}
  if(request==82){String text=pendingExport;pendingExport=null;if(result!=RESULT_OK||data==null||text==null)return;try(OutputStream output=getContentResolver().openOutputStream(data.getData(),"wt")){if(output==null)throw new IOException("No output stream");output.write(text.getBytes(StandardCharsets.UTF_8));log("Backup exported");}catch(Exception e){log("Export failed: "+e);}return;}
  if(request==83&&result==RESULT_OK&&data!=null){try(InputStream input=getContentResolver().openInputStream(data.getData());ByteArrayOutputStream output=new ByteArrayOutputStream()){if(input==null)throw new IOException("No input stream");byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){output.write(buffer,0,count);if(output.size()>40_000_000)throw new IOException("Backup exceeds 40 MB");}js("receiveBackup("+JSONObject.quote(new String(output.toByteArray(),StandardCharsets.UTF_8))+")");}catch(Exception e){log("Import failed: "+e);}}
 }
 @Override public void onBackPressed(){web.evaluateJavascript("handleBack()",value->{if(!"true".equals(value))super.onBackPressed();});}
 @Override protected void onPause(){super.onPause();js("pausePlayback();flushDraft()");}
 @Override protected void onDestroy(){destroyed=true;cancelled=true;liveAllowed=false;clearPreviews();stopScan();for(int index=0;index<4;index++)close(index);coordinator.shutdownNow();for(ExecutorService lane:lanes)lane.shutdownNow();ui.removeCallbacksAndMessages(null);if(picker!=null)picker.onReceiveValue(null);web.destroy();super.onDestroy();}
}
