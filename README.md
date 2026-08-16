# dsh-cwc — 上下文体检·归档面板

> DeepSeek Harness (鲸鱼客户端) 的 Cordis 插件:管理上下文压缩的"临终关怀"——
> 每次自动压缩的摘要自动归档到磁盘,模型在对话中需要旧细节时自动检索,跨会话聚合,保留策略防膨胀。

## 解决的问题

DSH 自带自动压缩(上下文到窗口 80% 时把旧历史替换成摘要),但压缩后:

- 摘要只在上下文里,**下次压缩可能连摘要都丢** → 早期细节永久消失
- 模型不知道旧内容去哪了 → 只能脑补,幻觉高发
- 用户不知道压缩了几次、失真了多少 → "会话还能不能用"全凭感觉

本插件把"压缩"变成可管理、可检索、可回溯的资产。

## 功能总览

| # | 功能 | 说明 |
|---|---|---|
| 1 | **自动归档** | 监听 `session/event`,每次 `compaction/summary` 落盘即写入 `~/.dsh/context-archives/<会话id>/archive-NNN.md` |
| 2 | **模型检索工具** | `cwc_archive_list`(列出归档索引+绝对路径)、`cwc_archive_show`(读完整内容)、`cwc_archive_sessions`(跨会话聚合) |
| 3 | **保留策略** | 归档超 30 份自动清理最旧一半(防磁盘膨胀,可调) |
| 4 | **UI 面板**(可选动态插件) | 会话头部「体检/归档/打开归档夹」按钮 + 输入框下方指标行(压缩次数/失真率/归档份数) |
| 5 | **失真率校准** | 用压缩前后真实 token 对比计算,不靠估算 |

## 安装

### 方式一:本地包(推荐,免 npm 发布)

```bash
# 1. 把本包复制到 DSH profile 目录
cp -r dsh-cwc ~/.dsh/profiles/web/plugins/cwc

# 2. 在 cordis.patch.yml 追加:
# - insert:
#     - id: cwc
#       name: './plugins/cwc/index.js'

# 3. 重启鲸鱼客户端
```

### 方式二:npm 包(待发布后)

```bash
npm install -g dsh-cwc
# 在 cordis.patch.yml 追加: - id: cwc  name: 'dsh-cwc'
```

### 依赖(DSH 自带,无需额外安装)

- `fs` — 文件读写
- `tools` — 模型工具注册
- `sessionQuery` / `sessionPersistence` — 会话日志读取
- `subprocess` — 保留策略清理(可选)

## 配置

所有行为用常量配置在 `lib/index.js` 顶部,按需修改:

| 常量 | 默认 | 说明 |
|---|---|---|
| 归档根目录 | `$DSH_HOME/context-archives` | 与工作区无关,任何项目共用 |
| 保留上限 | `30` 份 | 超过后清理最旧一半 |
| 失真估算 | `0.65` /次 | 仅无真实数据时兜底 |

## 使用

### 自动(无需操作)

```
上下文到 80% → DSH 自动压缩 → 本插件自动归档 → 归档文件落盘
```

### 对话中检索(模型自动触发)

- 问旧细节("之前那个文件路径是什么") → 模型自动调 `cwc_archive_list` + `cwc_archive_show`
- "列出归档" → `cwc_archive_list`
- "看第 N 份归档" → `cwc_archive_show`
- "哪些会话有归档" → `cwc_archive_sessions`(跨会话)

### UI(动态插件,重启后需重跑一次)

- **体检**:压缩次数/失真率/归档份数
- **归档**:把已有压缩摘要补写归档(自动归档已覆盖,此按钮用于补漏)
- **打开归档夹**:`explorer.exe /select` 直达磁盘归档位置

## 数据位置

```
~/.dsh/context-archives/
├── <会话id>/
│   ├── archive-001.md      # 每次压缩的摘要
│   ├── archive-002.md
│   └── index.md            # 归档索引
└── <另一个会话id>/
    └── ...
```

归档与**会话生命周期解耦**:会话删除/归档后,归档文件仍在(知识沉淀保留)。
要彻底删除,在归档夹删目录即可(列表实时反映)。

## 兼容性

- **DSH 版本**:基于 `session/event`、`tools.register`、`fs` 等官方稳定接口;大版本升级如改事件名可能需微调。
- **工作区无关**:归档在 `~/.dsh/`,与项目目录(鲸鱼客户端/任意项目)无关。
- **客户端化**:DSH 做成桌面客户端不影响核心功能(归档+检索是固化的);动态 UI 重启需重跑(动态插件固有特性)。
- **WorkBuddy 共存**:WorkBuddy 侧是独立实现(查 `workbuddy.db`),两边互不影响。

## 已知限制

1. 动态 UI(按钮/指标行)重启 DSH 后消失,需重新运行动态插件(核心功能不受影响)。
2. 保留策略用 `cmd /c del` 清理,仅 Windows;Linux/macOS 需改为 `rm`。
3. 归档为纯 Markdown,无加密;含敏感信息的会话请自行评估。

## 开发

```bash
npm run check          # 语法检查
# 修改后: 复制到 ~/.dsh/profiles/web/plugins/cwc/ + 重启生效
```

## 许可

MIT
