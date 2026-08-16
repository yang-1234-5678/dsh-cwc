# Changelog

## 1.1.0 (2026-08-16)

### 新增
- **原文快照**:归档时同时备份压缩前的原始对话(`snapshot-*.md`),轻量提炼(只留用户/AI 消息文本,去思考与工具过程),单条消息 15K 字符截断 + 单份 150K 上限防撑爆
- **python 桥写盘**:`scripts/archive_write.py` 独立进程写归档,绕开 DSH fs 服务 workspace-write 沙箱(动态插件场景)
- **cwc_polish 提示词优化**:独立 python 进程直连 DeepSeek API(max_tokens 32768 防推理模型截断,180s 超时),每次调用唯一输出文件防串读
- **自动归档监听**:动态插件直接监听 `compaction/summary` 事件即时归档(10s 防抖 + seq 去重)

### 变更
- **保留策略**:30 份 → 100 份上限,清理后保留最近 50 份(摘要+快照成对清理)
- **读取限制**:`cwc_archive_list` 一次最多返回 10 份,防止全量读取撑爆上下文
- **失真率口径**:占用 = inputTokens + cacheReadTokens(此前只算新 token,漏掉缓存命中,显示 0K/100% 假象);失真率 = 最近一次压缩前后总输入对比
- **事件读取**:改用 `sessionQuery.readSession`(完整 data)替代 `listEvents`(精简记录无 data.summary,导致摘要提取为 null)
- **原生 fs 适配**:固化插件写盘改用 `require('fs/promises')`,绕开 DSH fs 服务沙箱对 `~/.dsh` 的写入拒绝
- **python 路径**:改为环境变量 `DSH_PYTHON`,不硬编码用户目录(隐私)

### 修复
- 归档按钮重复写盘(无去重) → 按 seq 去重,重复摘要不再写入
- 手动归档写出的空壳(null) → readSession 完整事件后修复

## 1.0.0 (2026-08-16)

首次正式发布。从 `~/.dsh/profiles/web/plugins/cwc/` 整理为 npm 包结构。

### 功能
- 自动归档:监听 `session/event`,`compaction/summary` 落盘即写 `~/.dsh/context-archives/<sid>/archive-NNN.md`
- 模型工具:`cwc_archive_list`(含绝对路径)、`cwc_archive_show`、`cwc_archive_sessions`(跨会话聚合)
- 保留策略:归档超 30 份自动清理最旧一半
- 归档文件带 `<!-- meta: inputTokens -->` 供失真率校准
- UI 动态插件:体检/归档/打开归档夹三按钮 + 指标行(真实失真率)
