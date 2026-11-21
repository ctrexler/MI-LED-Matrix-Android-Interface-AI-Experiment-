package org.fourdisplay.studio;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

public class ApkProvider extends ContentProvider {
 @Override public boolean onCreate() { return true; }
 @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
 @Override public String getType(Uri u) { return "application/vnd.android.package-archive"; }
 @Override public Uri insert(Uri u, ContentValues v) { return null; }
 @Override public int delete(Uri u, String s, String[] a) { return 0; }
 @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
 @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
  File file = new File(getContext().getCacheDir(), "update.apk");
  if (!file.exists()) throw new FileNotFoundException("Missing update APK");
  return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
 }
}
