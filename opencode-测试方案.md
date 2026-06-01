# opencode CLI 测试方案

## 入口与范围

- 测试入口：`/tmp/workspace/dingzc2450/opencode/packages/opencode/package.json`
  - `test`: `bun test --timeout 30000`
  - `test:ci`: `bun test ... --reporter=junit`
- CLI 相关用例主要在：`/tmp/workspace/dingzc2450/opencode/packages/opencode/test/cli`

## CLI 测试方法与保障点

| 测试方法 | 代表文件 | 主要保证什么 | 解释 |
| --- | --- | --- | --- |
| 纯函数/解析单测（bun:test） | `test/cli/import.test.ts` | 参数解析和数据转换逻辑稳定 | 直接测 `parseShareUrl / transformShareData` 等纯逻辑，能最快发现 URL 解析、数据映射等基础回归。 |
| 错误格式化单测（bun:test） | `test/cli/error.test.ts` | 用户可见错误信息可读且兼容旧/新错误结构 | 同时覆盖 legacy 与 tagged error，避免 CLI 报错文案退化或信息丢失。 |
| 快照测试（命令帮助文本） | `test/cli/help/help-snapshots.test.ts` | CLI 命令面（命令名/参数/顺序）不被无意改坏 | 批量对 `--help` 输出做 snapshot，对“参数被删、改名、顺序变化”这类破坏性变更非常敏感。 |
| 只读命令 Smoke（`cliIt.live`） | `test/cli/smokes/read-only.test.ts` | 共享依赖层不崩溃（配置、DB、provider 解析等） | 用最低成本验证 `mcp list / providers list / models / session list / stats` 等基础命令在隔离环境可正常退出。 |
| run 子进程集成（`cliIt.concurrent`） | `test/cli/run/run-process.test.ts` | `opencode run` 端到端链路可用 | 真实拉起 CLI 子进程，覆盖 `argv -> 启动 -> 调 LLM -> 事件输出 -> exit code`，可抓住“卡死/退出码错误/JSON 事件格式异常”。 |
| serve 子进程集成（`cliIt.live`） | `test/cli/serve/serve-process.test.ts` | `opencode serve` 启动与生命周期正确 | 校验服务可绑定端口并返回 health，同时验证 scope 结束后进程会被正确回收，防止测试或生产泄漏子进程。 |
| ACP 协议生命周期测试（`cliIt.live`） | `test/cli/acp/lifecycle.test.ts` | `opencode acp` 协议能力与会话生命周期正确 | 覆盖 initialize/new/load/list/resume/close 等关键请求，确保 ACP 能力声明和会话行为符合协议预期。 |
| TUI 生命周期/状态测试（bun:test + renderer） | `test/cli/tui/app-lifecycle.test.ts` | CLI TUI 启停、清理、信号处理可靠 | 验证 ready/done/exit、SIGHUP、renderer destroy、plugin/audio/keymap 清理仅执行一次，降低交互式 CLI 资源泄漏和状态错乱风险。 |
| 运行时引导与交互输入单测 | `test/cli/run/runtime.boot.test.ts`、`test/cli/run/runtime.stdin.test.ts` | 运行时默认值与跨平台 stdin 行为正确 | 覆盖 keybind/model/diff-style fallback 与 `/dev/tty` / `CONIN$` 逻辑，防止不同平台下交互退化。 |

## 如何理解这套方案

- 这是一个“**单测 + 快照 + Smoke + 子进程集成 + 协议测试 + TUI 测试**”的分层组合。
- 单测负责快反馈，快照负责 CLI 面稳定，Smoke 负责基础可用性，子进程集成负责真实链路，ACP/TUI 测试负责高风险交互面。
- 组合起来可以同时覆盖：**功能正确性、兼容性、回归风险、跨平台交互稳定性**。
