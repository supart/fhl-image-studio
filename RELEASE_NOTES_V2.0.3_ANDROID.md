# FHL Image Studio 方汤圆版 V2.0.3 Android 更新说明

发布日期：待GitHub审核后填写

本项目是基于 [RoseKhlifa/Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 的独立修改发行版，按GNU AGPLv3.0公开完整对应源码。本版本不内置任何API Key。

## 版本信息

- 包名：`top.fangtangyuan.fhlstudio.android`
- 版本名：`V2.0.3`
- 版本号：`1050003`
- minSdk 28、targetSdk 34
- 默认协议：FHL Images API
- 正式证书 SHA-256：`6b04a805e50cf66e37c740ad0336bbdf6445653f93802005967babf472e8da36`

## 主要更新

- 新增FHL1至FHL10十个固定槽位，可一次批量粘贴最多10个API。
- 批量粘贴使用独立弹窗、固定掩码预览和显式确认；预填不保存、不测试、不联网。
- API凭据迁移到Android Keystore加密存储，Profile和任务持久化中不保存明文Key。
- 生图默认Images API，顶部可统一切换Responses API；切换只影响新任务，历史和运行中任务保持冻结协议。
- 两种FHL生图协议共享每槽4、总池40的原生调度容量；同槽FIFO，全局选择最老可运行任务。
- 新增提交幂等、一次付费POST、FHL槽位来源冻结、取消占位和冷启动不重提保护。
- 后台任务继续生成并通过通知返回应用；历史显示`FHLn · Images API/Responses API`。
- 快速设置支持折叠和持久化，手机批量预览固定两列并只渲染可见行附近内容。
- 历史保留全部非终态任务及最近500个终态组，不再自动裁到120条。

## 验证记录

- 前端362项、Worker 5项、Android JVM 53项、TypeScript、Android Lint和32项移动UI矩阵通过。
- 开发版已在API 28、API 34手机、API 34平板和API 36.1大屏模拟器完成兼容验证。
- 用户于2026年8月13日确认真机测试正常；未提供设备型号和系统版本，因此不作推测记录。
- 正式上传审核包使用同一正式签名APK完成隔离模拟器全新安装、V2.0.2.1覆盖升级和启动零自动POST验证。

## 隐私与安全

- APK、源码、源码ZIP和发布附件不含API Key、用户图片、生成历史、任务日志、签名文件或本机配置。
- 用户只能在自己的设备内主动输入API；十槽凭据由Android Keystore保护。
- 正式Release缺少任一签名变量时构建直接失败，不允许Debug签名回退。

## 已知限制

- Responses生图通道继续保留，但开发验证期间官方上游曾持续返回HTTP 503。
- 共享测试账户曾出现429 requests-per-minute限流；应用不会通过换Key或自动重提规避限流。
- 本版未执行216次正式真实API门禁，因此不宣称当前共享账户可以稳定承载40个同时运行请求。

## 发布资产

```text
FHL-Image-Studio-Fangtangyuan-V2.0.3-Android-Release-20260813.apk
FHL-Image-Studio-Fangtangyuan-V2.0.3-Android-Release-20260813.zip
FHL-Image-Studio-Fangtangyuan-V2.0.3-Android-Release-20260813.sha256.txt
FHL-Image-Studio-Fangtangyuan-V2.0.3-Android-Source-20260813.zip
FHL-Image-Studio-Fangtangyuan-V2.0.3-Android-Source-20260813.sha256.txt
```

正式哈希在本地审核包冻结后写入对应SHA256文件。Tag计划为`v2.0.3-android`，所有资产和源码ZIP必须绑定同一公开提交。
