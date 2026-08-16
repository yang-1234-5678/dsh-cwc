# -*- coding: utf-8 -*-
"""归档写盘脚本(绕开 DSH fs 服务沙箱): 由插件 subprocess 启动, 直接写磁盘
用法: python archive_write.py <sessionId> <count> <base64_json>
base64_json = base64(JSON: {"files": [{"name": "...", "content": "..."}, ...]})
支持 archive-*.md(摘要) 与 snapshot-*.md(原文快照), 写完后更新索引并执行保留策略。
"""
import base64
import json
import os
import sys

DSH_HOME = os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")
ARCH_ROOT = os.path.join(DSH_HOME, "context-archives")

# 保留策略(与技能加载规则同理: 归档也有上限)
MAX_ARCHIVES = 100   # 归档超过 100 份触发清理
KEEP_ARCHIVES = 50   # 清理后保留最近 50 份(摘要+对应快照一起保留)


def apply_retention(arch_dir):
    """归档超过上限时, 删除最旧的一半(摘要+对应快照成对清理)。"""
    try:
        files = sorted(x for x in os.listdir(arch_dir)
                       if (x.startswith("archive-") or x.startswith("snapshot-")) and x.endswith(".md"))
    except OSError:
        return 0
    archives = [x for x in files if x.startswith("archive-")]
    if len(archives) <= MAX_ARCHIVES:
        return 0
    remove_count = len(archives) - KEEP_ARCHIVES

    def sort_key(name):
        m = name.rsplit("-", 1)
        return (m[0][-8:] if len(m) > 1 else name, int(m[1][:3]) if len(m) > 1 else 0)
    archives.sort(key=sort_key)
    old = archives[:remove_count]
    removed = 0
    for name in old:
        try:
            os.remove(os.path.join(arch_dir, name))
            removed += 1
        except OSError:
            pass
        snap = name.replace("archive-", "snapshot-", 1)
        if snap in files:
            try:
                os.remove(os.path.join(arch_dir, snap))
                removed += 1
            except OSError:
                pass
    return removed


def main():
    if len(sys.argv) < 4:
        print("ERROR: args missing")
        return
    session_id = sys.argv[1]
    payload = json.loads(base64.b64decode(sys.argv[3]).decode("utf-8"))
    files = payload.get("files", [])
    arch_dir = os.path.join(ARCH_ROOT, session_id)
    os.makedirs(arch_dir, exist_ok=True)

    for f in files:
        name = f["name"]
        content = f["content"]
        if not name.endswith(".md"):
            continue
        with open(os.path.join(arch_dir, name), "w", encoding="utf-8") as fh:
            fh.write(content)

    # 会话 index.md(摘要 + 原文快照分列)
    arch_files = sorted(x for x in os.listdir(arch_dir) if x.startswith("archive-") and x.endswith(".md"))
    snap_files = sorted(x for x in os.listdir(arch_dir) if x.startswith("snapshot-") and x.endswith(".md"))
    idx_body = "# 会话归档索引: %s\n\n已归档压缩摘要: %d 份\n\n" % (session_id, len(arch_files))
    for i, name in enumerate(arch_files, 1):
        idx_body += "- 归档 #%d: %s\n" % (i, name)
    if snap_files:
        idx_body += "\n原文快照(压缩前的原始对话, 细节可读): %d 份\n\n" % len(snap_files)
        for i, name in enumerate(snap_files, 1):
            idx_body += "- 快照 #%d: %s\n" % (i, name)
    with open(os.path.join(arch_dir, "index.md"), "w", encoding="utf-8") as fh:
        fh.write(idx_body)

    # 全局 index.md
    rows = []
    for d in os.listdir(ARCH_ROOT):
        dd = os.path.join(ARCH_ROOT, d)
        if not os.path.isdir(dd):
            continue
        files2 = [x for x in os.listdir(dd) if x.startswith("archive-") and x.endswith(".md")]
        snaps2 = [x for x in os.listdir(dd) if x.startswith("snapshot-") and x.endswith(".md")]
        if not files2 and not snaps2:
            continue
        last = sorted(files2 + snaps2)[-1] if (files2 or snaps2) else ""
        rows.append((d, len(files2), len(snaps2), last))
    rows.sort(key=lambda r: r[3], reverse=True)
    body = "# 上下文归档总览\n\n> 按会话分类, 每份归档 = 一次上下文压缩的摘要(+原文快照)。\n\n"
    if not rows:
        body += "(暂无归档 — 上下文压缩发生时自动生成)\n"
    for sid, cnt, snp, last in rows:
        extra = (" +%d 快照" % snp) if snp else ""
        body += "- `%s` — %d 份摘要%s, 最新 %s\n" % (sid, cnt, extra, last)
    with open(os.path.join(ARCH_ROOT, "index.md"), "w", encoding="utf-8") as fh:
        fh.write(body)

    # 保留策略: 超过上限清理最旧的一半
    removed = apply_retention(arch_dir)
    if removed:
        print("retention removed=%d" % removed)


if __name__ == "__main__":
    main()
