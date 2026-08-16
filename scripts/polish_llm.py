# -*- coding: utf-8 -*-
"""提示词优化: 直连 DeepSeek API, 结果写文件(绕开 subprocess stdout 通道问题)
用法: python polish_llm.py <api_key> <text> <out_file>
输出: 优化后的提示词写入 out_file(UTF-8); 错误信息写入 out_file 以 ERROR: 开头
"""
import json
import sys
import urllib.request
import urllib.error

def main():
    key = sys.argv[1]
    text = sys.argv[2]
    out_file = sys.argv[3]
    system = (
        "你是提示词优化专家(参考 Anthropic 官方 prompt 指南与社区最佳实践)。\n"
        "把用户零散、口语化的需求整理成高质量提示词。核心原则：\n"
        "1. 保留意图,不编造:不添加用户没说的内容;关键缺失信息用【待补充:xxx】占位\n"
        "2. 先诊断再改写:判断任务类型(ask=问答/一次性生成, build=编码/创作, agent=长时自主, review=找问题, design=视觉设计, pipeline=批处理)\n"
        "3. 分层输出:\n"
        "   - 简单任务(ask):1-2 段话,含目标/期望输出/约束,不堆砌模板\n"
        "   - 复杂任务(build/review/design):加【目标】【背景】【输入数据】【期望输出】【约束条件】【验收标准】\n"
        "   - 长时任务(agent):加【自主边界】【汇报方式】\n"
        "4. 消除噪音:删掉\"尽量/好好/认真\"等模糊词;用具体可验证的表达\n"
        "5. 隐式假设显式化:用户没说但默认成立的,标注为【假设】\n"
        "6. 保持中文;只输出优化后的提示词本身,不要任何前言解释"
    )
    try:
        body = json.dumps({
            "model": "deepseek-v4-flash",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
            # deepseek-v4-flash 是推理模型: 4000 预算会被思考吃光导致文本截断/为空
            # 实测: 32768 -> finish_reason=stop 内容完整; 16000 也完整
            "max_tokens": 32768,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.deepseek.com/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + key,
            },
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        content = (content or "").strip()
        if not content:
            content = "ERROR: 模型返回空内容"
    except urllib.error.HTTPError as e:
        content = "ERROR: HTTP " + str(e.code) + " " + e.read().decode("utf-8", errors="replace")[:200]
    except Exception as e:
        content = "ERROR: " + str(e)
    # 写文件(UTF-8, 无 BOM)
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
