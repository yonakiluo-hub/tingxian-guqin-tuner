# 听弦 · 网页与音高检测核心

面向手机浏览器的七弦古琴调音器，同时作为 Android 离线应用的内置界面。支持正调、慢三、紧五、慢二，提供手动／自动识弦、实时音分、参考音与 A4 校准。音频仅在设备上分析，不保存或上传录音。

完整的功能、定弦表、截图、安装方式、限制与资料出处见 [项目首页](../README.md)。Android 权限与构建细节见 [Android 说明](../android/README.md)。

## 本地运行

需要 Node.js 22+，无需安装 npm 依赖，也无需打包。从本目录运行：

```sh
npm start
```

在运行服务器的电脑上打开 [http://localhost:4173](http://localhost:4173)。服务器只监听本机，不能直接供局域网内的手机访问。

## 测试

在本目录运行：

```sh
npm test
```

[tests/pitch.test.mjs](tests/pitch.test.mjs) 验证定弦数据、频率检测、泛音、噪声、偏差及范围边界；[tests/app.test.mjs](tests/app.test.mjs) 验证麦克风生命周期、权限竞态、参考音避让、音准稳定判定与自动识弦。当前共 18 组测试，使用合成信号和模拟浏览器环境，不能代替真机麦克风验证。

## 部署到手机浏览器

将 [dist/](dist/) 内全部文件原样部署到 HTTPS 静态网站即可，无运行时第三方依赖。较新版本的 Safari 或 Chrome 可申请麦克风；iPhone 可通过 Safari 的分享菜单添加到主屏幕。

浏览器麦克风需要安全环境：线上使用 HTTPS，本地开发使用 localhost。普通局域网 HTTP 地址不能用于手机录音。浏览器首次完整加载且缓存成功后可离线使用；清理站点数据后需要重新加载。

## 代码结构

| 文件 | 用途 |
| --- | --- |
| [dist/app.js](dist/app.js) | 页面交互、麦克风启停、参考音与读数稳定处理 |
| [dist/pitch.js](dist/pitch.js) | 单音音高估计、音分计算与最近目标弦匹配 |
| [dist/tunings.js](dist/tunings.js) | 调式、弦序、目标音名与标准音换算 |
| [dist/index.html](dist/index.html)、[dist/style.css](dist/style.css) | 中文界面与手机布局 |
| [dist/sw.js](dist/sw.js)、[dist/manifest.webmanifest](dist/manifest.webmanifest) | 浏览器资源缓存与安装元数据 |
| [server.mjs](server.mjs) | 仅供本机开发使用的静态服务器 |

修改网页资源后，浏览器可以直接读取；Android APK 则需要重新构建才能包含改动。从**仓库根目录**执行：

```sh
python android/build.py --web-dir guqin-tuner/dist --out-dir outputs
```

所需工具链与首次构建步骤见 [项目首页的 Android 构建说明](../README.md#android-构建)。
