# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# -----------------------------------------------------------------------------
# Crashlytics / Play 去模糊化（stack trace 還原）
# -----------------------------------------------------------------------------
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keep public class * extends java.lang.Exception

# -----------------------------------------------------------------------------
# WebView / Capacitor：若使用 JS bridge，保留對應 interface 的 class members
# -----------------------------------------------------------------------------
# -keepclassmembers class fqcn.of.javascript.interface.for.webview { public *; }

# -----------------------------------------------------------------------------
# 避免 R8 過度優化導致反射或 JNI 呼叫失效
# -----------------------------------------------------------------------------
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses
