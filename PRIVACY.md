# 隐私政策 · AI HTML 汇报修改台

最后更新：2026-09-22

## 一句话

**本扩展不收集、不上传、不分享任何用户数据。所有处理都在你的浏览器本地完成。**

## 扩展会接触哪些内容，用来做什么

| 接触的内容 | 用途 | 是否离开本机 |
|---|---|---|
| 当前网页的 HTML 内容 | 载入内置修改台，供你可视化修改；导出时写回成文件 | **否**，全程在浏览器内存与本地存储中处理 |
| 你在修改台里的编辑结果 | 保存在浏览器本地存储（localStorage），用于刷新后恢复 | **否** |
| 你主动插入的图片 / 音视频文件 | 转成 base64 内嵌进你导出的 HTML | **否** |

## 权限说明

| 权限 | 为什么需要 |
|---|---|
| `activeTab` | 只有在你点击工具栏图标时，才能读取当前这一个标签页的内容并载入修改台。扩展不会在后台读取任何页面。 |
| `scripting` | 在你点击图标后，往当前标签页注入一个整屏遮罩（修改台界面）。不注入任何远程脚本。 |

不申请任何其他权限；不申请 `<all_urls>` 主机权限；不使用 `tabs`、`history`、`cookies`、`webRequest` 等权限。

## 数据与网络

- **无远程代码**：扩展只运行包内的本地文件，不加载、不执行任何远程脚本（符合 Manifest V3 要求）。
- **无遥测**：不发送使用统计、崩溃报告或任何标识信息。
- **无第三方服务**：不与任何服务器通信。你在修改台里如果主动把某个元素改成外链图片/嵌入网页，那是你自己编辑的结果，扩展本身不发起该请求。
- **本地存储**：仅使用浏览器 localStorage 保存项目草稿与界面偏好（如左侧快捷栏配置），可随时在浏览器设置中清除。

## 卸载

从浏览器扩展管理页移除本扩展即可。卸载后，扩展产生的本地存储数据会一并被浏览器清理。

## 联系

如有隐私相关问题，请在本仓库提 Issue：
https://github.com/wang1739736-max/ai-html-report-editor/issues

## English summary

This extension collects nothing. It only reads the HTML of the current tab **after you click its toolbar icon**, loads that content into a built-in visual editor that runs entirely on your machine, and saves your draft to local browser storage. There is no remote code, no telemetry, no network request, and no data sharing.
