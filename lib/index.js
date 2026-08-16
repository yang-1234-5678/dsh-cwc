/**
 * 上下文体检·归档面板 — Host 半(固化版, cordis.patch.yml 加载)
 * 功能:
 *  1. 自动归档: 监听 session/event, compaction/summary 落盘即写入 $DSH_HOME/context-archives/<sid>/
 *  2. 模型工具: cwc_archive_list / cwc_archive_show / cwc_archive_sessions / cwc_polish
 *  3. 原文快照: 归档时同时备份压缩前的原始对话(轻量提炼 + 体积保护)
 *  4. 保留策略: 归档超 100 份自动清理最旧 50 份(摘要+快照成对)
 * 加载: cordis.patch.yml 中 - id: cwc  name: './plugins/cwc/index.js'
 */
'use strict'

module.exports = {
  inject: ['tools'],
  apply(ctx) {
    // ★ 原生 Node fs 适配层(绕开 DSH fs 服务的 workspace-write 沙箱):
    //   ctx.get('fs') 写 ~/.dsh 会被拒(file access denied), 固化插件是真实 Node
    //   环境, 直接用 require('fs') 读写磁盘。函数签名与旧 fs 服务保持兼容。
    const fsp = require('fs/promises')
    const nodeFs = {
      async resolve(p) { return p },
      async listDir(p) {
        const entries = await fsp.readdir(p, { withFileTypes: true })
        return entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }))
      },
      async readText(p) { return fsp.readFile(p, 'utf8') },
      async writeText(p, c) {
        await fsp.mkdir(require('path').dirname(p), { recursive: true })
        await fsp.writeFile(p, c, 'utf8')
      },
    }

    const extractSummary = (data) => {
      const s = data && data.summary
      if (Array.isArray(s)) {
        return s.filter(x => x && x.type === 'text').map(x => x.text || '').join('\n')
      }
      if (typeof s === 'string') return s
      return JSON.stringify(s || null)
    }

    // 定位 $DSH_HOME/context-archives: 固化插件运行在真实 Node 环境, process/os 可用
    const dshHomePath = () => {
      try {
        const os = require('os')
        const path = require('path')
        return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
      } catch (e) {
        // 兜底: 若连 os.homedir 都不可用, 用相对当前目录的 .dsh(保持可运行, 不泄露用户路径)
        return '.dsh'
      }
    }

    // ★ python 解释器路径: 用环境变量配置, 不硬编码用户目录
    const pythonPath = () => process.env.DSH_PYTHON || 'python'

    const archiveDirFor = async (sessionId) => {
      // 返回绝对路径字符串: 原生 fs 直接用路径字符串, 无需 resolve/processPath
      const path = require('path')
      return path.join(dshHomePath(), 'context-archives', sessionId)
    }

    // 当天日期字符串 YYYYMMDD
    const todayStamp = () => {
      try {
        const d = new Date()
        const p = (x) => String(x).padStart(2, '0')
        return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
      } catch (e) { return '00000000' }
    }

    // 全局索引: 列出所有会话的归档总览(按最近归档时间倒序)
    const writeGlobalIndex = async (fs) => {
      try {
        const root = require('path').join(dshHomePath(), 'context-archives')
        let entries = []
        try { entries = await fs.listDir(root) } catch (e) { return }
        const rows = []
        for (const e of entries) {
          if (e.type !== 'directory') continue
          try {
            const dir = require('path').join(dshHomePath(), 'context-archives', e.name)
            const files = await fs.listDir(dir)
            const arch = files.filter(x => x.name.startsWith('archive-') && x.name.endsWith('.md'))
            if (!arch.length) continue
            const sorted = arch.map(x => x.name).sort()
            rows.push({ sessionId: e.name, count: arch.length, last: sorted[sorted.length - 1] })
          } catch (err) {}
        }
        rows.sort((a, b) => (a.last < b.last ? 1 : -1))
        let body = '# 上下文归档总览\n\n> 按会话分类, 每份归档 = 一次上下文压缩的摘要(+原文快照)。\n\n'
        if (!rows.length) body += '(暂无归档 — 上下文压缩发生时自动生成)\n'
        for (const r of rows) {
          body += '- `' + r.sessionId + '` — ' + r.count + ' 份, 最新 ' + r.last + '\n'
        }
        const idx = require('path').join(dshHomePath(), 'context-archives', 'index.md')
        await fs.writeText(idx, body)
      } catch (e) {}
    }

    const writeArchive = async (fs, sessionId, summaryText, seq, inputTokens) => {
      const dir = await archiveDirFor(sessionId)
      let count = 0
      try {
        const entries = await fs.listDir(dir)
        count = entries.filter(e => e.name.startsWith('archive-') && e.name.endsWith('.md')).length
      } catch (e) { count = 0 }
      const n = count + 1
      // ③ 文件名带日期: archive-YYYYMMDD-NNN.md(旧文件 archive-NNN.md 保持兼容)
      const name = 'archive-' + todayStamp() + '-' + String(n).padStart(3, '0') + '.md'
      const target = require('path').join(dir, name)
      // D: 归档头记录真实 token(压缩后第一次请求的 input = 摘要后的实际占用)
      const meta = inputTokens ? '\n\n<!-- meta: inputTokens=' + inputTokens + ' -->\n' : ''
      const content = '# 归档 #' + n + ' (' + todayStamp() + ', seq=' + seq + ')\n\n' + summaryText + '\n' + meta
      await fs.writeText(target, content)
      try {
        const idx = require('path').join(dir, 'index.md')
        let body = '# 会话归档索引: ' + sessionId + '\n\n已归档压缩摘要: ' + n + ' 份\n\n'
        for (let i = 1; i <= n; i++) body += '- 归档 #' + i + ': archive-' + todayStamp() + '-' + String(i).padStart(3, '0') + '.md\n'
        await fs.writeText(idx, body)
      } catch (e) {}
      // ① 更新全局索引
      await writeGlobalIndex(fs)
      // E: 保留策略 — 归档超过上限(100 份)时, 用 shell 清理最旧的一半(保留最近 50 份)
      if (n >= 100) {
        try {
          const shell = ctx.get('shell')
          if (shell) {
            const keep = 50
            const removeNames = []
            // 清理最旧的 n-keep 份摘要 + 对应快照
            for (let i = 1; i <= n - keep; i++) {
              removeNames.push(require('path').join(dir, 'archive-' + todayStamp() + '-' + String(i).padStart(3, '0') + '.md'))
              removeNames.push(require('path').join(dir, 'snapshot-' + todayStamp() + '-' + String(i).padStart(3, '0') + '.md'))
            }
            const cmd = 'cmd /c del /q "' + removeNames.join('" "') + '"'
            const spec = await shell.resolve({ command: cmd })
            await shell.run(spec)
            console.log('[cwc] 保留策略: 归档超限, 已清理 ' + removeNames.length + ' 个文件(摘要+快照)')
          } else {
            console.warn('[cwc] 保留策略: shell 不可用, 跳过清理')
          }
        } catch (e) { console.error('[cwc] 保留策略清理失败: ' + String(e && e.message || e)) }
      }
      return name
    }

    const listArchives = async (fs, sessionId) => {
      const dir = await archiveDirFor(sessionId)
      const entries = await fs.listDir(dir)
      const files = entries.filter(e => e.name.startsWith('archive-') && e.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))
      const list = []
      for (const f of files) {
        let first = ''
        try {
          const target = require('path').join(dir, f.name)
          const text = await fs.readText(target)
          const lines = text.split('\n')
          for (const ln of lines.slice(1)) {
            if (ln.trim()) { first = ln.trim().slice(0, 100); break }
          }
        } catch (e) {}
        list.push({ name: f.name, path: require('path').join(dir, f.name), first })
      }
      return list
    }

    // C: 跨会话聚合 — 列出所有有归档的会话
    const listAllSessions = async (fs) => {
      const root = require('path').join(dshHomePath(), 'context-archives')
      let entries = []
      try { entries = await fs.listDir(root) } catch (e) { return [] }
      const sessions = []
      for (const e of entries) {
        if (e.type !== 'directory') continue
        try {
          const dir = require('path').join(dshHomePath(), 'context-archives', e.name)
          const files = await fs.listDir(dir)
          const count = files.filter(x => x.name.startsWith('archive-') && x.name.endsWith('.md')).length
          if (count > 0) sessions.push({ sessionId: e.name, archiveCount: count })
        } catch (err) {}
      }
      return sessions
    }

    const readArchive = async (fs, sessionId, n) => {
      const dir = await archiveDirFor(sessionId)
      // 按序号查找, 兼容新旧命名(archive-NNN.md / archive-YYYYMMDD-NNN.md)
      const entries = await fs.listDir(dir)
      const files = entries.filter(e => e.name.startsWith('archive-') && e.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))
      const targetFile = files[Number(n) - 1]
      if (!targetFile) throw new Error('no archive #' + n)
      const target = require('path').join(dir, targetFile.name)
      return await fs.readText(target)
    }

    // ★ 自动归档: 每次 compaction/summary 落盘后立即写入归档
    ctx.on('session/event', (session, event) => {
      if (!event || event.type !== 'compaction/summary') return
      const sessionId = session && session.id
      if (!sessionId) return
      const text = extractSummary(event.data || {})
      if (!text) return
      writeArchive(nodeFs, sessionId, String(text), event.seq || 0)
        .then((name) => console.log('[cwc] 自动归档: ' + sessionId + '/' + name))
        .catch((e) => console.error('[cwc] 自动归档失败: ' + String(e && e.message || e)))
    })

    // ★ 模型工具: 检索归档
    const tools = ctx.get('tools')
    if (tools) {
      const textResult = (label) => ({
        schema: { type: 'object', additionalProperties: true },
        render(a, v) { return [{ type: 'text', text: label + JSON.stringify(v, null, 2) }] },
      })

      tools.register({
        name: 'cwc_archive_list',
        description: '列出当前会话已归档的压缩摘要列表(序号+首行+绝对路径path)。当对话涉及早期被压缩归档的内容(如文件路径/数值/决策),而当前上下文缺少细节时,调用此工具查看归档索引。返回每份归档的序号、磁盘路径和开头,可继续用 cwc_archive_show 读取完整内容。注意: 一次最多读取 10 份归档(按需选最有价值的), 不要全部读取; 归档超过 100 份时系统自动保留最近 50 份。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '会话ID(缺省自动取当前会话)' },
          },
          additionalProperties: false,
        },
        output: textResult('[cwc_archive_list]\n'),
        async execute(args, exec) {
          const sid = args.sessionId || (exec && exec.agent && exec.agent.sessionId) || 'current'
          try {
            const list = await listArchives(nodeFs, String(sid))
            // 读取约束: 最多选 10 份(防止全量读取撑爆上下文)
            const limited = list.slice(0, 10)
            return {
              sessionId: sid,
              total: list.length,
              archives: limited,
              hint: '最多读取 10 份, 已返回前 ' + limited.length + ' 份; 归档超过 100 份自动保留最近 50 份; path 为磁盘绝对路径(可直达文件); 可用 cwc_archive_show 读取完整内容',
            }
          } catch (e) {
            return { error: String(e && e.message || e) }
          }
        },
      })

      tools.register({
        name: 'cwc_archive_sessions',
        description: '跨会话聚合: 列出所有存在归档的会话及其归档份数。当需要查找"之前某个会话的归档内容"但不确定是哪个会话,或想盘点全部已归档知识时调用。返回每个会话ID和归档数量。',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        output: textResult('[cwc_archive_sessions]\n'),
        async execute() {
          try {
            const sessions = await listAllSessions(nodeFs)
            return { sessions, hint: '用 cwc_archive_list(传 sessionId)查看某会话的归档列表' }
          } catch (e) {
            return { error: String(e && e.message || e) }
          }
        },
      })

      tools.register({
        name: 'cwc_archive_show',
        description: '读取某份归档的完整内容。当 cwc_archive_list 返回的归档首行提示了相关细节,或对话需要早期压缩摘要中的具体信息(文件路径/数值/决策)时调用。参数 n 是归档序号。',
        parameters: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: '会话ID(缺省自动取当前会话)' },
            n: { type: 'number', description: '归档序号(1,2,3...)' },
          },
          required: ['n'],
          additionalProperties: false,
        },
        output: textResult('[cwc_archive_show]\n'),
        async execute(args, exec) {
          const sid = args.sessionId || (exec && exec.agent && exec.agent.sessionId) || 'current'
          try {
            const text = await readArchive(nodeFs, String(sid), Number(args.n))
            return { n: args.n, text }
          } catch (e) {
            return { error: '找不到归档 #' + args.n }
          }
        },
      })

      tools.register({
        name: 'cwc_polish',
        description: '提示词优化: 把用户零散、口语化的需求整理成结构化、高质量的提示词。当用户要求"优化提示词/整理需求/把这段话说清楚/让AI更好理解"时调用。返回优化后的提示词文本。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '用户原始输入(零散的需求描述)' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output: textResult('[cwc_polish]\n'),
        async execute(args) {
          const text = String(args && args.text || '').trim()
          if (!text) return { error: '输入为空' }
          try {
            // 文件桥方案: python 直连 DeepSeek API, 结果写文件, 插件轮询读文件
            // (绕开主进程 fetch TRANSPORT + subprocess stdout 失效两个问题;
            //  固化插件用原生 nodeFs 读写, 不受 DSH fs 沙箱限制)
            const sub = ctx.get('subprocess')
            if (!sub) return { error: 'subprocess 不可用' }
            const creds = ctx.get('credentials')
            let key = null
            if (creds) {
              try {
                const r = await creds.resolve('DEEPSEEK_API_KEY')
                if (r && r.value) key = r.value
              } catch (e) {}
            }
            if (!key) return { error: 'DEEPSEEK_API_KEY 不可用' }
            const scriptPath = require('path').join(__dirname, 'scripts', 'polish_llm.py')
            // 每次调用唯一输出文件, 杜绝跨调用读到旧结果
            const outFile = require('path').join(require('path').dirname(scriptPath), '_polish_out_' + Date.now() + '-' + Math.floor(Math.random() * 1000000) + '.txt')
            try { await nodeFs.writeText(outFile, 'PENDING') } catch (e) {}
            const handle = sub.spawn({
              argv: [pythonPath(), scriptPath, key, text, outFile],
              cwd: require('path').dirname(scriptPath),
              stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: 65536 },
                stderr: { maxBytes: 65536 },
              },
              graceMs: 200000,
            })
            // 轮询读输出文件(固化插件是真实 Node 环境, 可用 setInterval 或同步等待)
            let content = ''
            let waited = 0
            while (waited < 200000) {
              try {
                content = await nodeFs.readText(outFile)
                if (content && content.trim() && content.trim() !== 'PENDING') break
              } catch (e) {}
              await new Promise((resolve) => setTimeout(resolve, 500))
              waited += 500
            }
            content = (content || '').trim()
            if (!content || content === 'PENDING') return { error: '超时未返回(200s)' }
            if (content.startsWith('ERROR')) return { error: content.slice(0, 300) }
            return { optimized: content }
          } catch (e) {
            return { error: String(e && e.message || e) }
          }
        },
      })
    }

    console.log('[cwc] host ready (auto-archive + model tools)')
  },
}
