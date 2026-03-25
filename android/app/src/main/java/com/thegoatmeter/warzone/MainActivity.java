package com.thegoatmeter.warzone;

import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;

import android.view.PixelCopy;
import java.io.ByteArrayOutputStream;

import com.getcapacitor.JSObject;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

/**
 * Capacitor 會自動註冊 node_modules 內含的插件（含 @capacitor-community/admob），無需手動註冊。
 * 首發過審：與 build.gradle 的 namespace / applicationId 一致（com.thegoatmeter.warzone）。
 */
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    @CapacitorPlugin(name = "ViewCapture")
    public static class ViewCapturePlugin extends Plugin {
        @PluginMethod
        public void captureElement(PluginCall call) {
            JSObject rect = call.getObject("rect");
            if (rect == null) {
                call.reject("Missing rect object");
                return;
            }

            // Bruce 註記：這裡接收的是前端透過 getBoundingClientRect() 計算後乘以 DPR 的物理像素。
            Integer xObj = rect.getInteger("x");
            Integer yObj = rect.getInteger("y");
            Integer widthObj = rect.getInteger("width");
            Integer heightObj = rect.getInteger("height");

            if (xObj == null || yObj == null || widthObj == null || heightObj == null) {
                call.reject("Invalid rect object: missing x/y/width/height");
                return;
            }

            int x = xObj;
            int y = yObj;
            int w = widthObj;
            int h = heightObj;

            if (w <= 0 || h <= 0) {
                call.reject("Invalid rect dimensions (non-positive w/h)");
                return;
            }

            // 取得視窗物理邊界（用於位移補償，避免 bitmap/out-of-bounds）
            android.view.Window window = getActivity().getWindow();
            android.view.View decorView = window.getDecorView();
            int screenWidth = Math.max(0, decorView.getWidth());
            int screenHeight = Math.max(0, decorView.getHeight());

            if (screenWidth <= 0 || screenHeight <= 0) {
                call.reject("INVALID_WINDOW_BOUNDS", "Unable to read Window bounds for clamping");
                return;
            }

            // 以寬高最小值作為唯一邊長，強制輸出 1:1 正方形
            int side = Math.min(w, h);
            if (side <= 0) {
                call.reject("Invalid rect side (<=0)");
                return;
            }

            try {
                // side 不能超過螢幕物理範圍；必要時縮小 side 但仍保持等邊
                if (side > screenWidth) side = screenWidth;
                if (side > screenHeight) side = screenHeight;

                if (side <= 0) {
                    call.reject("Rect side out of bounds");
                    return;
                }

                // [關鍵修正]: 位移補償（Shifting）而非裁切（Clipping）
                // 若右/下出界，將起始點往左/往上推，確保 width/height 永遠維持 side。
                if (x + side > screenWidth) x = screenWidth - side;
                if (x < 0) x = 0;

                if (y + side > screenHeight) y = screenHeight - side;
                if (y < 0) y = 0;

                Bitmap bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888);

                final int finalX = x;
                final int finalY = y;
                final int finalSide = side;
                final android.graphics.Rect captureRect = new android.graphics.Rect(
                    finalX,
                    finalY,
                    finalX + finalSide,
                    finalY + finalSide
                );

                final Bitmap finalBitmap = bitmap;

                PixelCopy.request(
                        window,
                        captureRect,
                        finalBitmap,
                        copyResult -> {
                            if (copyResult == PixelCopy.SUCCESS) {
                                ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream();
                                finalBitmap.compress(Bitmap.CompressFormat.PNG, 100, byteArrayOutputStream);
                                byte[] byteArray = byteArrayOutputStream.toByteArray();
                                String encoded = Base64.encodeToString(byteArray, Base64.NO_WRAP);

                                JSObject ret = new JSObject();
                                ret.put("base64", encoded);
                                call.resolve(ret);
                            } else {
                                String errorType = "UNKNOWN";
                                if (copyResult == PixelCopy.ERROR_SOURCE_NO_DATA) errorType = "OUT_OF_BOUNDS";
                                if (copyResult == PixelCopy.ERROR_SOURCE_INVALID) errorType = "OUT_OF_BOUNDS";
                                if (copyResult == PixelCopy.ERROR_DESTINATION_INVALID) errorType = "OUT_OF_BOUNDS";
                                if (copyResult == PixelCopy.ERROR_TIMEOUT) errorType = "TIMEOUT";

                                call.reject(
                                        "PIXELCOPY_FAILED_" + errorType,
                                        "PixelCopy failed: " + errorType + ", copyResult=" + copyResult
                                );
                            }

                            finalBitmap.recycle();
                        },
                        new Handler(Looper.getMainLooper())
                );
            } catch (OutOfMemoryError oom) {
                call.reject("OOM_ERROR", "Bitmap creation failed due to memory limit");
                return;
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 為確保 Capacitor bridge 啟動時已能註冊 plugin，
        // 這裡把 registerPlugin 放在 super.onCreate 之前。
        registerPlugin(ViewCapturePlugin.class);
        super.onCreate(savedInstanceState);

        // 為實機除錯版啟用 WebView 調試。
        // 對於正式版（manifest debuggable=false）此設定不會允許外部調試。
        WebView.setWebContentsDebuggingEnabled(true);
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // 標記已依 @capgo/capacitor-social-login 文件修改 MainActivity，以支援 Google 登入 scopes
    }
}
