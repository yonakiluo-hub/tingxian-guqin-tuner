# 听弦 · 古琴调音器 Android 包装

Android 8.0 及以上，需要近期版本的 Android System WebView（部分手机由 Chrome 提供）。应用 ID 为 `cn.qixian.tuner`。界面、调弦数据和音高检测来自旁边的 `guqin-tuner` 项目，打包后不依赖服务器。

## 构建

需要 Python 3.10+、JDK 17、Android SDK Platform 35 和 Build-Tools 35.0.0。本项目不需要 Gradle。

在 Windows 的源码根目录运行：

```powershell
python android/setup_toolchain.py
python android/build.py
```

`setup_toolchain.py` 将固定版本的官方工具包下载到仓库根目录的 `work/downloads/`，校验摘要后解压到 `work/toolchain/`，不修改系统 PATH 或注册表。下载脚本面向 Windows x64。已有环境可通过 `JAVA_HOME` 和 `ANDROID_SDK_ROOT` 指定；其中 SDK 应包含 `build-tools/35.0.0` 和 `platforms/android-35`。默认路径相对于脚本位置解析，支持中文或含空格的项目路径。

`build.py` 默认读取 `guqin-tuner/dist/`，使用 `work/toolchain/`，将 `Tingxian-Guqin-Tuner-Android.apk` 与签名/manifest 验证报告写入仓库根目录的 `outputs/`。可用 `--web-dir`、`--out-dir` 覆盖，显式相对参数以当前工作目录为基准。中间文件在 `android/build/`。

首次构建会在本机生成体验签名，保存在 `android/signing/`；仓库不包含已有签名私钥。脚本中的固定密码 `local-evaluation-only` 只是本地开发样例，不是生产密钥或凭据。请勿将 `android/signing/`、任何 `.p12` / `.jks` / `.keystore` 文件提交到 Git。保留自己的签名才能覆盖安装同签名版本；新克隆生成的签名不能覆盖其他人的已安装版本。公开发布应用时应自行创建并保管正式签名。

`work/`、`outputs/`、`android/build/` 和 `android/signing/` 均为本机生成目录，应保持在 Git 忽略列表中。这里的可复现构建指按固定工具版本可重新生成可安装 APK；签名密钥和归档时间不同，文件的 SHA-256 不保证逐字节相同。

## 权限与行为

- 只有点击网页“开始调音”触发麦克风请求时，才请求 Android 录音权限。
- WebView 只允许内置 HTTPS 源请求麦克风，并且只授予音频采集，不授予摄像头。
- 内置资源经 `https://appassets.androidplatform.net/` 安全源加载，所有其他请求返回 403。
- 用户主动点击指南中的 HTTPS 外部资料链接时，交给系统浏览器打开；不允许其他网页在应用内载入，不允许自动弹窗或其他链接协议。
- APK 未声明联网权限，不上传、保存或回放采集到的音频。
- 退到后台时停止页面采音并销毁采音上下文；重新进入后需要再次点击开始，偏好保存在本机。
- 应保持系统 Android System WebView / Chrome 更新，以获得较完整的 Web Audio 支持。

## 验证范围

构建脚本自动检查 Java 编译、资源打包、APK 签名和 manifest；仍须在安卓真机检查首次授权、拒绝后恢复、七根弦识别、后台停止、不同扬声器及麦克风表现。当前没有连接真机，不能将构建通过视为真机测试通过。

官方参考：

- https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
- https://developer.android.com/reference/android/webkit/PermissionRequest
- https://learn.microsoft.com/java/openjdk/download
