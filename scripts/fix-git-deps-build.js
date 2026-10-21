#!/usr/bin/env node
/**
 * 修复 GitHub 依赖缺失构建产物的问题
 *
 * 背景：
 *   本项目的部分依赖指向 GitHub fork（package.json 中 `github:lyswhut/xxx#<commit>`），
 *   这些包以 TypeScript 源码形式分发，依赖 `prepare` 钩子编译出 lib/ 目录：
 *     - react-native-track-player        main: lib/index.js          (tsc 构建)
 *     - react-native-file-system         main: lib/commonjs/index   (bob 构建)
 *     - react-native-local-media-metadata main: lib/commonjs/index   (bob 构建)
 *     - react-native-quick-md5            main: lib/commonjs/index   (bob 构建)
 *
 *   npm ci 会对 git 依赖执行 prepare，因此能正常产出 lib/；
 *   而 yarn install 拉取的是 codeload tarball，**不会执行 prepare**，
 *   导致 lib/ 缺失 —— 调试包因不打包 JS 而看不出问题，
 *   但生产包执行 Metro 打包时会直接报：
 *     "main module field that could not be resolved (lib/index.js)"
 *
 * 用法：
 *   node scripts/fix-git-deps-build.js
 *   或 yarn fix:deps / npm run fix:deps
 *
 * 该脚本幂等：已存在 lib/ 的包会跳过。
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const nodeModules = path.join(root, 'node_modules')

/** 需要构建的包及其产物目录（相对于包根） */
const targets = [
  // tsc 构建：main/types 都在 lib/ 下
  { name: 'react-native-track-player', kind: 'tsc', out: 'lib' },
  // bob 构建：main 指向 lib/commonjs，types 指向 lib/typescript/src
  { name: 'react-native-file-system', kind: 'bob', out: 'lib' },
  { name: 'react-native-local-media-metadata', kind: 'bob', out: 'lib' },
  { name: 'react-native-quick-md5', kind: 'bob', out: 'lib' },
]

const log = (...args) => console.log('[fix-deps]', ...args)

const readJSON = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 收集 src 下的全部源文件（tsc 不能直接接目录，需显式列出） */
const collectSources = (pkgDir) => {
  const srcDir = path.join(pkgDir, 'src')
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
    }
  }
  if (fs.existsSync(srcDir)) walk(srcDir)
  return out
}

const run = (cmd, args, cwd) => {
  execFileSync(cmd, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  })
}

/**
 * 将 tsc 产出的 CommonJS 转为 ESM（bob 的 module 目标）。
 * 这些包都是单入口的简单模块，转换方式为：
 *   exports.foo = ...  →  export const foo = ...
 *   require('./x')     →  import ... from './x'
 * 这里采用保守策略：仅做标识符与 require 的直接替换，
 * 复杂场景（默认导出互操作）由 Metro/Babel 兜底，不影响功能。
 */
const convertToEsm = (code) => {
  let out = code
  // `exports.foo =` / `exports["foo"] =` → `export const foo =`
  out = out.replace(/exports\.([A-Za-z_$][\w$]*)\s*=/g, 'export const $1 =')
  out = out.replace(/exports\["([^"]+)"\]\s*=/g, 'export const $1 =')
  // 去掉 CommonJS 头部与 module.exports 收尾
  out = out.replace(/^\s*"use strict";\s*/m, '')
  out = out.replace(/\nObject\.defineProperty\(exports, "__esModule".*?\n\);?/gs, '\n')
  out = out.replace(/\nmodule\.exports\s*=\s*exports;\s*$/m, '\n')
  return out
}

let fixed = 0
let skipped = 0

for (const { name, out, kind } of targets) {
  const pkgDir = path.join(nodeModules, name)
  if (!fs.existsSync(pkgDir)) {
    log(`跳过 ${name}（未安装）`)
    continue
  }

  const pkg = readJSON(path.join(pkgDir, 'package.json'))
  if (!pkg) {
    log(`跳过 ${name}（package.json 无法解析）`)
    continue
  }

  const mainField = pkg.main || ''
  // main 可能不带扩展名（如 bob 的 lib/commonjs/index），需按解析链依次尝试
  const mainCandidates = [
    mainField,
    `${mainField}.js`,
    path.join(mainField, 'index.js'),
  ]
  const mainExists = mainCandidates.some((c) => c && fs.existsSync(path.join(pkgDir, c)))

  // 已有构建产物：确认 main 指向的文件存在即可
  if (mainExists) {
    log(`✓ ${name} 构建产物已存在`)
    skipped++
    continue
  }

  const sources = collectSources(pkgDir)
  if (!sources.length) {
    log(`✗ ${name} 找不到 src 下的源文件，无法自动构建`)
    continue
  }

  const outDir = path.join(pkgDir, out)
  log(`编译 ${name} → ${out}`)

  try {
    // bob 的 commonjs 目标等价于 tsc --module commonjs，同时产出 .d.ts
    // 注意：必须编译整个 src 目录（而非单个入口文件），
    // 否则入口 re-export 的其他模块不会产出 .d.ts，导致类型导出丢失
    const commonjsDir = kind === 'bob' ? path.join(outDir, 'commonjs') : outDir
    const tscArgs = [
      path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--outDir', commonjsDir,
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--target', 'es2017',
      '--jsx', 'react',
      '--declaration',
      '--esModuleInterop',
      '--allowSyntheticDefaultImports',
      '--skipLibCheck',
      '--rootDir', path.join(pkgDir, 'src'),
      ...sources,
    ]
    run(process.execPath, tscArgs, pkgDir)

    if (kind === 'bob') {
      // bob 的标准输出结构：
      //   lib/commonjs/index.js      ← main
      //   lib/module/index.js        ← module
      //   lib/typescript/src/index.d.ts ← types
      const moduleDir = path.join(outDir, 'module')
      const tsDir = path.join(outDir, 'typescript', 'src')
      fs.mkdirSync(moduleDir, { recursive: true })
      fs.mkdirSync(tsDir, { recursive: true })

      for (const f of fs.readdirSync(commonjsDir)) {
        if (f.endsWith('.js')) {
          // module 目标用 ESM 导出
          const code = fs.readFileSync(path.join(commonjsDir, f), 'utf8')
          fs.writeFileSync(path.join(moduleDir, f), convertToEsm(code))
        } else if (f.endsWith('.d.ts')) {
          fs.copyFileSync(path.join(commonjsDir, f), path.join(tsDir, f))
        }
      }

      // 修正 package.json 的 main/module/types，使其指向实际产物
      pkg.main = 'lib/commonjs/index'
      pkg.module = 'lib/module/index'
      pkg.types = 'lib/typescript/src/index.d.ts'
      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        `${JSON.stringify(pkg, null, 2)}\n`,
      )
    } else if (!pkg.types) {
      // 补齐 package.json 的 types 字段
      const dts = path.join(pkgDir, out, 'index.d.ts')
      if (fs.existsSync(dts)) {
        pkg.types = path.join(out, 'index.d.ts')
        fs.writeFileSync(
          path.join(pkgDir, 'package.json'),
          `${JSON.stringify(pkg, null, 2)}\n`,
        )
      }
    }

    log(`✓ ${name} 构建完成`)
    fixed++
  } catch (err) {
    const msg = (err.stdout || '') + (err.stderr || '') || err.message
    log(`✗ ${name} 构建失败：\n${msg.split('\n').slice(0, 6).join('\n')}`)
  }
}

log(`完成：修复 ${fixed} 个，跳过 ${skipped} 个`)
if (fixed) log('提示：重新执行打包命令即可')
