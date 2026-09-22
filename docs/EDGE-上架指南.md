# Edge 商店上架指南 · AI HTML 汇报修改台

> 依据：Microsoft Learn《[发布 Microsoft Edge 扩展](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/publish/publish-extension)》
> 认证周期：**提交后最长 7 个工作日**

---

## 0. 你需要准备的东西（都已备好）

| 需要的 | 在哪 |
|---|---|
| 扩展包 ZIP | `store/ai-html-report-editor-v1.0.0.zip` （**manifest.json 在 ZIP 根目录**，76 KB / 10 个文件） |
| 扩展图标 300×300 | `store/logo-300.png` |
| 小促销图 440×280（可选） | `store/promo-440x280.png` |
| 大促销图 1400×560（可选） | `store/promo-1400x560.png` |
| 截图 1280×800（可选，最多 6 张） | `store/screenshot-1-editor.png` / `-2-insert.png` / `-3-select.png` |
| 隐私政策 URL | `https://github.com/wang1739736-max/ai-html-report-editor/blob/main/PRIVACY.md` |
| 网站 / 支持 | 仓库地址 / `https://github.com/wang1739736-max/ai-html-report-editor/issues` |

素材可随时用脚本重生成：

```bash
node html-editor-extension/tools/make-store-assets.js   # 图标 / 促销图 / 截图
node html-editor-extension/tools/pack-store.js          # 商店包 + 自检
```

---

## 1. 注册开发者账号（免费，约 5 分钟）

> 依据：Microsoft Learn《[注册为 Microsoft Edge 扩展开发者](https://learn.microsoft.com/zh-cn/microsoft-edge/extensions/publish/create-dev-account)》
> **Edge 扩展计划不收取注册费**（Chrome 网上应用店需一次性 5 美元）

### 1.1 先搞定「登录账号」

Edge 计划**不支持工作/学校账号**注册，必须是 **Microsoft 账户（MSA）**：

| 方式 | 做法 | 说明 |
|---|---|---|
| **用 GitHub 账号登录**（推荐，本项目作者适用） | 在 Partner Center 登录页选 GitHub 登录 | 微软会自动创建一个 MSA 并与之关联，无需另外注册邮箱 |
| 注册新 MSA | [account.microsoft.com/account](https://account.microsoft.com/account) → 底部「创建 Microsoft 账户」 | 用 Outlook / Live / Hotmail 邮箱 |

### 1.2 进入 Edge 开发者注册入口

1. 打开 **[Partner Center（Edge 入口）](https://partner.microsoft.com/dashboard/microsoftedge/public/login)** 并登录
2. **Microsoft Edge Developer Account Registration** 表单可能直接弹出；若没有：
   进入 **Account settings (账户设置) → Programs → Microsoft Edge 卡片 → Get started**

### 1.3 填写表单（4 项）

| 字段 | 建议值 | ⚠️ 注意 |
|---|---|---|
| **Account country/region** | China / 中国 | **注册后只读，不可更改** |
| **Account type** | **Individual（个人）** | **注册后不可更改**；个人账号验证较快（核验发布者名称可用性）；公司账号需营业执照 / DUNS 等材料，周期数天到数周，可能接到微软验证电话；**公司 ↔ 个人不支持互转** |
| **Publisher display name**（≤50 字符） | `AI HTML 汇报修改台` | 会**公开显示**在商店页；必须可用且你有权使用。被占用就换备选：`汇报修改台`、`HTML 汇报修改台`、`AIHTML Studio` |
| **Contact info** | 常用邮箱 | 用于接收账号问题通知与验证邮件 |

> 选 Company 时还会多出 **Company approver**（公司审批人姓名/邮箱/电话），微软会联系其确认授权。

### 1.4 接受协议并提交

1. 点开 **App Developer Agreement** 阅读（[Microsoft Store App Developer Agreement](https://go.microsoft.com/fwlink/?linkid=528905)）
2. 勾选 **I accept the terms and conditions**
3. 点 **Finish**

### 1.5 等待验证

- 提交后会收到**确认邮件**；在 Partner Center 点 **Open Account Settings** 可查看验证状态
- 验证期间可继续准备扩展包（本项目的包已就绪）
- 公司账号若卡在 Pending / Action Required：在 `Account settings → Legal info` 补齐并重新上传清晰、与营业执照一致的证明材料

### 1.6 团队协作（可选）

公司账号验证通过后，可在 Edge 计划里添加其他用户共同管理扩展；个人账号通常自己用即可。

## 2. 创建扩展并上传包

1. Partner Center → **Home** → **Edge** 卡片 → **Create new extension**
2. 把 `store/ai-html-report-editor-v1.0.0.zip` 拖到上传区
3. 等待校验通过（若报错，按提示改 `manifest.json` 后重新执行 `pack-store.js` 再传）

## 3. Availability（上架范围）

| 字段 | 建议填写 |
|---|---|
| Visibility | **Public**（公开，可被搜索到） |
| Markets | 默认「所有市场」；想只上中文区可手动勾选 |

## 4. Properties（属性）

| 字段 | 建议填写 |
|---|---|
| **Category** | **Productivity（生产力）**；若想吸引开发者也可选 Developer tools |
| Website | `https://github.com/wang1739736-max/ai-html-report-editor` |
| Support contact | `https://github.com/wang1739736-max/ai-html-report-editor/issues` |
| Mature content | **不勾选**（无成人内容） |

## 5. Privacy（隐私页，审核重点）

### 5.1 Single Purpose（单一用途）

```
AI HTML 汇报修改台把用户当前正在浏览的网页载入一个可视化修改台，让用户像做 PPT 一样直接修改 AI 生成的 HTML 汇报中的文字、图片与排版，并导出干净的 HTML 文件。它只做这一件事：生成之后的最后一轮人工修稿。
```

### 5.2 Permission justification（权限说明）

**activeTab**

```
仅当用户点击扩展工具栏图标时，扩展才读取当前这一个标签页的 HTML 内容并载入内置修改台。扩展不在后台读取任何页面、不申请 <all_urls> 主机权限，也不使用 tabs / history / cookies / webRequest 等权限。
```

**scripting**

```
用户点击图标后，扩展向当前标签页注入一个整屏遮罩并载入修改台界面（其文件全部在扩展包内，无任何远程脚本）。用户点击「退出编辑」后遮罩会被移除，原页面内容不被修改。
```

### 5.3 Are you using remote code?

选择 **No, I am not using remote code**（扩展只运行包内本地文件，符合 Manifest V3）。

### 5.4 Data usage（数据使用）

- 所有「收集哪些用户数据」的复选框 **全部不勾选**
- 「I certify that the following disclosures are true」的声明 **全部勾选**（确认不出售数据、不将数据用于与核心功能无关的用途等）

### 5.5 Privacy policy URL（隐私政策）

```
https://github.com/wang1739736-max/ai-html-report-editor/blob/main/PRIVACY.md
```

> 仓库里的 `PRIVACY.md` 已写明：不收集、不上传、不分享任何用户数据，全部处理在本地完成。

## 6. Store listings（商店详情，每种语言都要填）

### 6.1 扩展名称 / 短描述

自动取自 `manifest.json`（名称 `AI HTML 汇报修改台`，短描述即 manifest 的 `description`）。想改要改 manifest 重新打包上传。

### 6.2 Description（详细描述，**至少 250 字符**，可直接复制）

```
AI HTML 汇报修改台，专治 AI 生成网页的「最后一公里」。

用 AI 生成周报、数据看板、方案汇报或落地页之后，总会差那么一点点：文案有错字、数字没更新、图片比例不对、间距不齐、配色不统一。为了这几个小瑕疵回头改提示词重跑，代价太高；直接读代码改，门槛又太高。

这个扩展把这件事变成点一下：打开要修改的网页，点工具栏图标，当前页面立刻载入可视化修改台。你可以像做 PPT 一样操作——单击选中、拖动移动、拉角缩放、双击就地改字；拖动与缩放都会自动吸附对齐到其他元素的边界，并显示参考线与数值；支持 Shift / Ctrl 多选、Ctrl+G 组合、图层结构树、对齐与等距分布、格式刷、撤销历史（可一次退回多步）。

除了改，还能加：插入文本、图片、8 种形状与 9 种内容块，插入音视频或嵌入网页；调整表格行列与合并拆分；用 flex / grid 做分栏与自动换行；一键统一全页配色与字体；按电脑 / 平板 / 手机预览并让元素分端隐藏。

改完点「导出 HTML」，得到一份干净的 HTML 文件：原有脚本、结构与动画原样保留，只把你改过的文字、图片与样式写回去。也可以 Ctrl+S 保存到本地项目，随时回来继续改。

隐私：扩展不联网、不收集任何数据、不使用远程代码，全部处理都在你的浏览器本地完成，详见仓库隐私政策。

适用场景：AI 生成的 HTML 汇报 / 周报 / 数据看板 / 方案页 / 落地页 / 简历 / 邀请函等页面的最后一轮人工修稿。
```

### 6.3 Search terms（搜索词，最多 7 个、每个 ≤30 字符）

```
ai html 修改
网页可视化编辑
html 编辑器
网页改字
汇报修改
落地页编辑
排版调整
```

### 6.4 图片素材对应关系

| 商店栏位 | 要求尺寸 | 上传文件 |
|---|---|---|
| Extension logo | 300×300（1:1，最低 128×128） | `store/logo-300.png` |
| Small promotional tile | 440×280 | `store/promo-440x280.png` |
| Large promotional tile | 1400×560 | `store/promo-1400x560.png` |
| Screenshots（最多 6 张） | 640×480 或 **1280×800** | `screenshot-1-editor.png`（主界面）<br>`screenshot-2-insert.png`（插入形状/内容块）<br>`screenshot-3-select.png`（选中元素 + 属性面板） |

> 上传一张后可用 **Duplicate** 一键复制到其他语言。

## 7. Notes for certification（给审核员的说明，可直接复制）

```
本扩展无需登录、无需账号、无付费、不联网。

测试步骤：
1. 打开任意普通网页（例如 https://example.com 或任意新闻页）。
2. 点击扩展工具栏图标 → 当前页面整屏载入「AI HTML 汇报修改台」。
3. 在画布里单击任意元素可选中（出现选框），拖动可移动并显示吸附参考线，拉角可缩放，双击可改文字。
4. 点击顶部「导出 HTML」会下载一份修改后的 HTML 文件。
5. 点击左上角「✕ 退出编辑」返回原网页，原页面未被改动。

预期行为说明：
- 在 chrome://newtab 等浏览器受保护页面点击图标时，无法注入遮罩，扩展会自动新开一个标签页进入修改台本体，这是设计行为，不是故障。
- 编辑本地 HTML 文件（file:///…）需要在扩展详情页开启「允许访问文件网址」。
- 扩展不使用远程代码；修改台界面与脚本全部打包在扩展内。

权限用途：
- activeTab：仅在用户点击图标时读取当前标签页内容。
- scripting：仅在用户点击图标后注入整屏修改台遮罩。
```

## 8. 提交与审核

1. **Store listings** 各语言状态显示 **Complete** 后，右上角 **Publish** 可点
2. 填入上面的 Notes for certification → 再次点 **Publish**
3. 进入认证，**最长 7 个工作日**；通过后商店页状态变为 **In the Store**

### 常见被拒原因（提前避开）

| 原因 | 规避方式 |
|---|---|
| 权限说明不充分 | 用上面的英文/中文模板逐条说明 activeTab、scripting 的用途 |
| 单一用途不清晰 | 强调「只做 AI 生成 HTML 的最后一轮可视化修稿」 |
| 隐私声明与实际行为不符 | 本扩展确实不收集数据，Data usage 全部不勾选并勾选全部声明 |
| 描述过短或与功能不符 | 用上面 250+ 字的描述，逐条对应真实功能 |
| 使用远程代码 | 本扩展无远程代码，选择 No |

## 9. 后续更新版本

1. 改 `manifest.json` 里的 `"version"`（如 `1.0.1`）
2. 重新打包并自检：`node html-editor-extension/tools/pack-store.js`
3. Partner Center → 该扩展 → **Packages** → 上传新包 → 重新走一遍 Store listings（会保留上次内容）→ Publish

---

## 附：Chrome 网上应用店（顺带）

同一份 `store/ai-html-report-editor-v1.0.0.zip` 可以直接传到 [Chrome 开发者后台](https://chrome.google.com/webstore/devconsole)（需一次性 5 美元注册费），字段基本一致；截图同样要求 1280×800。
