import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type WindowsCheck = {
  name: string
  run: () => Promise<void> | void
}

const results: { name: string; ok: boolean; error?: string }[] = []

function fail(message: string): never {
  throw new Error(message)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

async function run(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`✅ ${name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, error: message })
    console.log(`❌ ${name}`)
    console.log(`   ${message}`)
  }
}

function findShell() {
  return Bun.which("pwsh") || Bun.which("powershell") || Bun.which("cmd")
}

async function resolveCommandOnPath(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const pathVar = env.PATH ?? env.Path
  if (!pathVar) return null
  const pathExt = (env.PATHEXT ?? env.PathExt ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)

  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue

    for (const ext of pathExt) {
      const candidate = path.join(dir, `${command}${ext}`)
      try {
        await fs.access(candidate)
        return candidate
      } catch {}
    }
  }
  return null
}

async function checkCmdEnv() {
  const proc = Bun.spawn(["cmd", "/c", "set", "OPENCODE_TEST_SHELL"], {
    env: { ...process.env, OPENCODE_TEST_SHELL: "ok" },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  assert(code === 0, `cmd set exited with ${code}, stderr=${stderr || "<empty>"}`)
  assert(stdout.toUpperCase().includes("OPENCODE_TEST_SHELL=OK"), "env variable not found in cmd output")
}

async function checkCmdWithSpacePath() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-win-test-"))
  const dir = path.join(base, "with space")
  const script = path.join(dir, "echo cmd.cmd")

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(script, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

  const proc = Bun.spawn([script, "--stdio"], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  assert(code === 0, `cmd script with spaces exited with ${code}, stderr=${stderr || "<empty>"}`)
}

async function checkPathExtResolution() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-win-path-"))
  const bin = path.join(base, "bin")
  await fs.mkdir(bin, { recursive: true })

  const cmdFile = path.join(bin, "pathext.CMD")
  await fs.writeFile(cmdFile, "@echo off\r\necho ok\r\n")

  const found = await resolveCommandOnPath("pathext", {
    PATH: bin,
    PATHEXT: ".CMD",
  })

  assert(!!found, "resolveCommandOnPath could not resolve command by PATHEXT")
  assert(found!.toLowerCase() === cmdFile.toLowerCase(), `resolved path mismatch: ${found} !== ${cmdFile}`)
}

async function checkJunctionSymlink() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-win-link-"))
  const src = path.join(base, "src")
  const dst = path.join(base, "dst")

  await fs.mkdir(src, { recursive: true })
  await fs.mkdir(dst, { recursive: true })
  await fs.writeFile(path.join(dst, "ok.txt"), "ok")

  await fs.symlink(dst, path.join(src, "escape"), "junction")

  const stat = await fs.lstat(path.join(src, "escape"))
  assert(stat.isSymbolicLink(), "junction is not treated as symbolic link")
  const content = await fs.readFile(path.join(src, "escape", "ok.txt"), "utf8")
  assert(content === "ok", "failed to read file through junction symlink")
}

const checks: WindowsCheck[] = [
  {
    name: "运行平台必须是 Windows",
    run: () => {
      assert(process.platform === "win32", `current platform is ${process.platform}, expected win32`)
    },
  },
  {
    name: "系统可用 shell 检查（pwsh/powershell/cmd）",
    run: () => {
      const shell = findShell()
      assert(shell, "no shell found: need pwsh, powershell, or cmd")
    },
  },
  {
    name: "Windows shell 环境变量注入检查",
    run: checkCmdEnv,
  },
  {
    name: "路径含空格的 .cmd 脚本执行检查",
    run: checkCmdWithSpacePath,
  },
  {
    name: "PATHEXT 命令解析检查",
    run: checkPathExtResolution,
  },
  {
    name: "junction 符号链接检查",
    run: checkJunctionSymlink,
  },
]

for (const item of checks) {
  await run(item.name, item.run)
}

const failed = results.filter((x) => !x.ok)
console.log("")
console.log(`完成：${results.length - failed.length}/${results.length} 通过`)

if (failed.length) {
  console.log("失败项：")
  for (const item of failed) {
    console.log(`- ${item.name}: ${item.error}`)
  }
  process.exit(1)
}

console.log("全部通过 ✅")
