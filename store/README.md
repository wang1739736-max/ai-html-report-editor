# 商店上架素材（store/）

由脚本生成，尺寸严格按 Edge / Chrome 商店要求。改了 LOGO、界面或文案后重新跑一次即可。

```bash
node html-editor-extension/tools/make-store-assets.js   # 图标 / 促销图 / 截图
node html-editor-extension/tools/pack-store.js          # 商店包 + 自检
```

## 文件与用途

| 文件 | 尺寸 | 商店栏位 | 必需 |
|---|---|---|---|
| `logo-300.png` | 300×300 | Extension logo（1:1，最低 128×128） | ✅ 必需 |
| `promo-440x280.png` | 440×280 | Small promotional tile | 可选（推荐） |
| `promo-1400x560.png` | 1400×560 | Large promotional tile | 可选 |
| `screenshot-1-editor.png` | 1280×800 | Screenshots（最多 6 张） | 可选（推荐） |
| `screenshot-2-insert.png` | 1280×800 | 同上 —— 插入形状 / 内容块面板 | 可选 |
| `screenshot-3-select.png` | 1280×800 | 同上 —— 选中元素 + 右侧属性面板 | 可选 |
| `ai-html-report-editor-v1.0.0.zip` | — | 扩展包（**manifest.json 在 ZIP 根目录**） | ✅ 必需 |

> 商店只接受 640×480 或 **1280×800** 两种截图尺寸；促销图必须严格 440×280 / 1400×560；logo 必须 1:1。

## 上架步骤

见 [`../docs/EDGE-上架指南.md`](../docs/EDGE-上架指南.md)：包含开发者账号注册、每个字段的**可复制文案**（单一用途、权限说明、数据使用、详细描述、搜索词、审核备注）。

## 隐私政策

隐私政策文件在仓库根目录：[`../PRIVACY.md`](../PRIVACY.md)
提交时填写的 URL：

```
https://github.com/wang1739736-max/ai-html-report-editor/blob/main/PRIVACY.md
```
