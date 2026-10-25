---
description: "面向侧栏的官方 DeepSeek Harness 品牌填充，仅在官方构建中生效；供选择或替换品牌呈现的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

## 概述

官方构建在侧边栏显示 Rabb Code，在会话首页显示圆角黑白兔子。用户提供的单张像素图片逆时针旋转 90°，覆盖 80px 顶部区域，并通过 T3 Code 原有遮罩与叠加渐变淡出；署名见 `ARTWORK-LICENSE.txt`。本地化设置齿轮取代底部账户菜单，支持快捷键与折叠轨道提示。其他构建保留外壳默认显示。所选背景保存在用户设置中，不影响模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本插件挂载到浏览器插件名单，然后以 `official` profile 构建客户端，注册 Rabb Code 品牌素材。

### 选择 profile

`DSH_CLIENT_BUILD_PROFILE` 决定渲染哪个品牌。`official` 构建填充侧栏标志、名称、顶部装饰背景和会话首屏标志。其他取值保留声明包的回退。会话标题在两种语言中均为 Rabb Code。两种 profile 都会加载本插件；只有品牌素材注册受 profile 门控。

### 选择背景

打开设置 → 外观设置，选择像素、蓝色 Blueprint 或 Night。Host 接受保存后，顶部与发送按钮背景一起变化。`ui-brand-official.artwork` 默认是 `pixel`，其他有效值为 `blueprint` 和 `night`。保存被拒绝或失败时保留原选择，并显示重试提示。

### 替换品牌

采用其他品牌的部署使用另一个占据侧栏与首屏 slot 的包替换本包。品牌通过 slot 组合，不提供运行时配置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

侧栏填充通过嵌套的 `ctx.slots.inject()` 一起安装。首屏标志跟随自己的声明生命周期。各注册均支持在声明者之前或之后激活，并随声明消失而撤回。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；Host 半部校验并持久化背景选择。可撤销的主题 token 层把已接受的选择应用到顶部与输入栏。浏览器标题是构建环境的事（`DSH_CLIENT_TITLE`），不在 slot 系统之内。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时阅读以下页面。它们从本包占据的 slot 进入渲染这些 slot 的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md)——在首屏声明 `conversation.hero.brand.mark`。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——浏览器插件行如何加载并注册 slot。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了品牌呈现的供给方式。它们是当前包约束，不是品牌设计对比或任务积压。

- **只有一组填充**——替代呈现属于占据相同 slot 的另一个 Cordis 包。
- **浏览器标题独立**——`DSH_CLIENT_TITLE` 在构建时选择标题文本，而非通过 UI slot。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
