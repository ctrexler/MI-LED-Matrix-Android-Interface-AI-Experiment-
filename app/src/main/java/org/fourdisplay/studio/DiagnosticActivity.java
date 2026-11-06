package org.fourdisplay.studio;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Date;
import java.util.concurrent.atomic.AtomicBoolean;

/** Temporary native launcher. Does not load WebView until diagnostics are installed. */
public class DiagnosticActivity extends Activity {
 private File reportFile;
 private String report;
 private final AtomicBoolean handling=new AtomicBoolean();
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  reportFile=new File(getFilesDir(),"startup-crash-report.txt");
  installHandler();
  if(reportFile.exists()){
   try{report=new String(Files.readAllBytes(reportFile.toPath()),StandardCharsets.UTF_8);}
   catch(Exception e){report="Could not read saved report: "+e;}
   showReport();
  }else{
   startActivity(new Intent(this,MainActivity.class));
   finish();
  }
 }
 private void installHandler(){
  final Thread.UncaughtExceptionHandler previous=Thread.getDefaultUncaughtExceptionHandler();
  final File target=reportFile;
  Thread.setDefaultUncaughtExceptionHandler((thread,error)->{
   if(handling.compareAndSet(false,true)){
    try{
     // Preserve the first failure, not a later shutdown exception.
     if(!target.exists()){
      StringWriter buffer=new StringWriter();PrintWriter writer=new PrintWriter(buffer);
      writer.println("Four Display Studio — startup diagnostic");
      writer.println("Time: "+new Date());
      writer.println("Device: "+Build.MANUFACTURER+" "+Build.MODEL);
      writer.println("Android: "+Build.VERSION.RELEASE+" (API "+Build.VERSION.SDK_INT+")");
      writer.println("Thread: "+thread.getName());writer.println();
      error.printStackTrace(writer);writer.flush();
      try(FileOutputStream output=new FileOutputStream(target)){
       output.write(buffer.toString().getBytes(StandardCharsets.UTF_8));output.getFD().sync();
      }
     }
    }catch(Throwable ignored){}
   }
   // Preserve Android's normal crash handling rather than attempting to continue.
   if(previous!=null)previous.uncaughtException(thread,error);
   else{android.os.Process.killProcess(android.os.Process.myPid());System.exit(10);}
  });
 }
 private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
 private void showReport(){
  LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
  root.setBackgroundColor(Color.rgb(245,247,250));root.setPadding(dp(16),dp(16),dp(16),dp(16));
  root.setOnApplyWindowInsetsListener((view,insets)->{
   view.setPadding(dp(16)+insets.getSystemWindowInsetLeft(),dp(16)+insets.getSystemWindowInsetTop(),dp(16)+insets.getSystemWindowInsetRight(),dp(16)+insets.getSystemWindowInsetBottom());return insets;
  });
  TextView title=new TextView(this);title.setText("Startup error captured");title.setTextSize(22);title.setTextColor(Color.BLACK);root.addView(title);
  TextView intro=new TextView(this);intro.setText("Copy the report below and send it back in chat. This screen has not cleared or changed your image library.");intro.setTextColor(Color.DKGRAY);intro.setPadding(0,dp(10),0,dp(10));root.addView(intro);
  Button copy=new Button(this);copy.setText("Copy error report");copy.setOnClickListener(v->{ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(clipboard!=null){clipboard.setPrimaryClip(ClipData.newPlainText("Four Display Studio crash",report));Toast.makeText(this,"Report copied",Toast.LENGTH_SHORT).show();}});root.addView(copy);
  ScrollView scroll=new ScrollView(this);TextView text=new TextView(this);text.setText(report);text.setTextColor(Color.BLACK);text.setTextSize(12);text.setTypeface(Typeface.MONOSPACE);text.setTextIsSelectable(true);text.setPadding(0,dp(10),0,dp(10));scroll.addView(text);root.addView(scroll,new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,0,1));
  Button retry=new Button(this);retry.setText("Clear report and retry app");retry.setOnClickListener(v->{if(reportFile.delete()){startActivity(new Intent(this,MainActivity.class));finish();}else Toast.makeText(this,"Could not clear report",Toast.LENGTH_LONG).show();});root.addView(retry);
  setContentView(root);root.requestApplyInsets();
 }
}
