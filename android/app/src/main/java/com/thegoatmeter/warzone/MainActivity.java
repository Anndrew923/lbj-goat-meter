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

            // [重點註記]: 確保傳入座標與寬高皆為正數，避免 PixelCopy 立即崩潰
            int x = Math.max(0, xObj);
            int y = Math.max(0, yObj);
            int width = widthObj;
            int height = heightObj;

            if (width <= 0 || height <= 0) {
                call.reject("Invalid rect dimensions");
                return;
            }

            // 防呆：避免 Bitmap.createBitmap 因負值或越界直接拋例外
            android.view.Window window = getActivity().getWindow();
            android.view.View decorView = window.getDecorView();
            int screenWidth = Math.max(0, decorView.getWidth());
            int screenHeight = Math.max(0, decorView.getHeight());

            if (screenWidth <= 0 || screenHeight <= 0) {
                call.reject("INVALID_WINDOW_BOUNDS", "Unable to read Window bounds for clamping");
                return;
            }

            int clampedX = x;
            int clampedY = y;
            int clampedW = width;
            int clampedH = height;

            if (clampedX + clampedW > screenWidth) clampedW = screenWidth - clampedX;
            if (clampedY + clampedH > screenHeight) clampedH = screenHeight - clampedY;

            if (clampedW <= 0 || clampedH <= 0) {
                call.reject("Rect is out of bounds");
                return;
            }

            Bitmap bitmap = null;
            try {
                bitmap = Bitmap.createBitmap(clampedW, clampedH, Bitmap.Config.ARGB_8888);
            } catch (OutOfMemoryError oom) {
                call.reject("OOM_ERROR", "Bitmap creation failed due to memory limit");
                return;
            }

            if (bitmap == null) {
                call.reject("BITMAP_NULL", "Bitmap creation returned null");
                return;
            }

            // Java: callback lambda 只能引用 effectively final 變數
            final Bitmap finalBitmap = bitmap;

            // 使用 PixelCopy 繞過 WebView 的安全限制，確保能抓到 HWC (Hardware Composer) 渲染的內容
            PixelCopy.request(
                    window,
                    new Rect(clampedX, clampedY, clampedX + clampedW, clampedY + clampedH),
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
                            // PixelCopy 官方可用錯誤碼不包含 ERROR_SOURCE_OUT_OF_BOUNDS，
                            // 因此把「來源無資料 / 來源無效 / 目的地無效」視為 bounds/裁切不穩定的同一類訊號。
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
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Register native plugin for pixel-level View capture (PixelCopy).
        registerPlugin(ViewCapturePlugin.class);

        // 為實機除錯版啟用 WebView 調試。
        // 對於正式版（manifest debuggable=false）此設定不會允許外部調試。
        WebView.setWebContentsDebuggingEnabled(true);
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // 標記已依 @capgo/capacitor-social-login 文件修改 MainActivity，以支援 Google 登入 scopes
    }
}
