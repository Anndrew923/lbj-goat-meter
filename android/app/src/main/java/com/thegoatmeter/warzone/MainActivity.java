package com.thegoatmeter.warzone;

import com.getcapacitor.BridgeActivity;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

/**
 * Capacitor 會自動註冊 node_modules 內含的插件（含 @capacitor-community/admob），無需手動註冊。
 * 首發過審：與 build.gradle 的 namespace / applicationId 一致（com.thegoatmeter.warzone）。
 */
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // 標記已依 @capgo/capacitor-social-login 文件修改 MainActivity，以支援 Google 登入 scopes
    }
}
