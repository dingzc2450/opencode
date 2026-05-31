# 基于 Bun + Ink 的 CLI 测试补充方案（参考 opencode）

## 1. 目标

你当前已经有单元测试，下一步目标是：

- 补齐更多单测覆盖角度（边界、异常、回归、权限）
- 增加 E2E，确保真实用户场景可用
- 针对 Ink（React 渲染到 CLI）补齐渲染与交互测试
- 在 CI 中稳定运行，减少 flaky

---

## 2. 参考项目结论（opencode 的可复用做法）

opencode 的测试策略可以抽象成 5 层：

1. **纯逻辑单测**：`bun:test` 验证函数与业务逻辑  
2. **终端 UI 组件测试**：快照 + 渲染输出断言  
3. **CLI 子进程测试**：真实启动命令，断言 exit code/stdout/stderr  
4. **交互式终端 E2E**：模拟按键流程，验证全链路交互  
5. **Smoke 冒烟测试**：快速验证核心命令“不崩溃、可执行”

---

## 3. 你的项目推荐测试分层

建议目录结构：

```text
test/
  preload.ts
  fixture/
    tmpdir.ts
  lib/
    cli.ts
    pty.ts
    wait.ts
  unit/
  components/
  e2e/
  smoke/
```

---

## 4. 优先级最高：环境隔离（preload）

在 `test/preload.ts` 中做统一隔离（在测试前执行）：

- 将 `HOME` / `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` 指向临时目录
- Windows 下同步处理 `APPDATA` / `LOCALAPPDATA` / `USERPROFILE`，路径拼接使用跨平台工具（如 `path.join` / `path.resolve`）
- 清空所有 provider 凭证类环境变量（如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`AWS_*`、`AZURE_*`、`GOOGLE_*`）
- 关闭测试期间不需要的行为：自动更新、遥测上报、在线模型拉取、插件自动发现
- 所有测试结束后清理临时目录（建议带重试，兼容 Windows 文件句柄占用）

价值：避免污染开发机环境，保证可重复、离线、稳定。

---

## 5. 单元测试补强角度（你现有基础上继续扩展）

你已有 schema 序列化用例，建议补充：

1. **错误路径**：非法输入、缺失字段、类型不符，断言错误类型和错误消息  
2. **边界值**：空数组、超长字符串、极端数值、空对象  
3. **权限开关**：如 `goalToolsEnabled` 关闭时，验证工具不可执行/不可导出  
4. **缓存隔离**：不同 schema 不串缓存，同 schema 命中缓存  
5. **回归测试**：每个线上 bug 对应一个 `*-regression.test.ts`

---

## 6. Ink 组件测试（关键补齐项）

建议引入：`ink-testing-library`（devDependency）

测试方式：

- `render(<Component />)` 后断言 `lastFrame()`
- 对关键界面使用快照（布局、换行、截断、状态行）
- 对交互组件模拟 stdin 输入并断言重渲染结果
- ANSI 输出可按需用 `strip-ansi` 做归一化断言

适合覆盖：

- 列表选择器、状态条、错误提示、空状态、加载态、分页/折叠区块

---

## 7. CLI 子进程 E2E（黑盒）

你已有 `execa`，可直接封装 `test/lib/cli.ts`：

- `runCli(args, opts)`：真实启动 CLI 入口
- 注入隔离 env、临时 cwd
- 返回并断言：`exitCode`、`stdout`、`stderr`、耗时
- 失败时打印尾部日志，便于 CI 排错
- 为 E2E 设置更高超时（如 30s~60s）

建议首批场景：

1. `--help`、`--version`
2. 核心命令最短路径（成功）
3. 非法参数（失败码 + 错误文案）
4. 配置缺失/损坏时的错误恢复文案

---

## 8. 交互式 TUI E2E（真实用户流程）

建议引入：`node-pty`（devDependency）

能力：

- 在伪终端中启动 CLI
- 发送按键（方向键、回车、Ctrl+C）
- 等待特定文本出现后断言界面状态

关键规范：

- 不用固定 `sleep` 等待，改用 `waitForText`/轮询条件（防 flaky）
- 对每个场景定义“就绪信号”文本

首批流程建议：

1. 启动 -> 首屏加载成功  
2. 输入命令/选择项 -> 结果输出正确  
3. 异常路径 -> 错误提示可见、退出码正确  
4. 中断场景（Ctrl+C）-> 能安全退出

---

## 9. Smoke 冒烟层（高性价比）

为每个核心命令加最薄用例：

- 能启动
- 能退出
- 返回码符合预期
- 至少输出关键字段

作用：快速发现“命令不可用/入口崩溃/依赖初始化失败”。

---

## 10. 外部依赖 Mock 策略

你的依赖中包含大量云和 LLM SDK，测试必须去网络化：

- 用本地 mock server 或 `undici` Mock 能力拦截 HTTP 请求
- 为流式响应（SSE/分片）提供可控测试数据
- E2E 中通过 env 把 base URL 指向本地 mock 服务

作用：保证测试稳定、快速、可并行，避免真实服务波动。

---

## 11. package.json / CI 建议

建议脚本：

```json
{
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test test/unit test/components",
    "test:e2e": "bun test test/e2e test/smoke",
    "test:ci": "bun test --reporter=junit --reporter-outfile=./junit.xml"
  }
}
```

CI 建议：

- 分 job：`unit` 与 `e2e`
- 矩阵：`ubuntu-latest` + `windows-latest`
- 上传 JUnit 报告与失败日志 artifact

---

## 12. 最小落地顺序（建议按此执行）

1. 先做 `preload` 环境隔离  
2. 再做 `tmpdir` 夹具  
3. 再做 `execa` 子进程 E2E 封装  
4. 接着补 Ink 组件渲染测试  
5. 最后加 `node-pty` 交互 E2E 与 CI 矩阵

这样能最快从“已有单测”升级到“用户场景可验证”的完整测试体系。

---

## 13. 你当前依赖下建议新增的 devDependencies

- `ink-testing-library`：Ink 组件测试
- `node-pty`：交互式终端 E2E

其余你基本已具备（`bun:test`、`execa`、`strip-ansi`、`undici`、`typescript`）。
