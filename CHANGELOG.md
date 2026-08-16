# Changelog

## 1.0.0 (2026-08-16)

首次正式发布。从 `~/.dsh/profiles/web/plugins/cwc/` 整理为 npm 包结构。

### 功能
- 自动归档:监听 `session/event`,`compaction/summary` 落盘即写 `~/.dsh/context-archives/<sid>/archive-NNN.md`
- 模型工具:`cwc_archive_list`(含绝对路径)、`cwc_archive_show`、`cwc_archive_sessions`(跨会话聚合)
- 保留策略:归档超 30 份自动清理最旧一半
- 归档文件带 `<!-- meta: inputTokens -->` 供失真率校准
- UI 动态插件:体检/归档/打开归档夹三按钮 + 指标行(真实失真率)

### 修复历史(开发过程)
- pkg-1→3: Client 定时器改用 `timer` 服务;Host 路径改为纯 fs 探测;移除 process/require 依赖
- pkg-4: 正式显示名「上下文体检·归档面板」;归档按钮改为主动压缩(后因沙箱无 AbortController 回退)
- pkg-5: 移除有 bug 的主动压缩;归档按钮只补写已有摘要;反馈文案明确化
- pkg-6: 新增「打开归档夹」(explorer 直达);失真率真实校准
- 固化插件: `inject: ['fs','tools']` 修复静默失败;路径统一 path.join;ESM 相对路径加载修复(`./plugins/cwc/index.js`)
