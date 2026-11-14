package vn.lit.eyemodule;

import android.os.Process;
import android.util.Log;
import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

public final class Entry implements IXposedHookLoadPackage {
    @Override public void handleLoadPackage(XC_LoadPackage.LoadPackageParam p) {
        if (!"com.litatom.app".equals(p.packageName) || !p.packageName.equals(p.processName)
                || Process.myUid() / 100000 != 10) return;
        AccountBridge.start();
        try {
            System.loadLibrary("eyeoverride");
            Log.i("VectorEye", "module loaded in user 10");
        } catch (Throwable e) { Log.e("VectorEye", "native library load failed", e); }
    }
}
