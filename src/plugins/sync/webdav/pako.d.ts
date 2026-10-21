// 最小化的 pako 模块声明（项目已在 dependencies 中声明 pako，但未引入 @types/pako）。
// 这里仅声明同步所用的 inflate/deflate 等 API，避免修改 package.json 引入额外的 devDependency，
// 从而降低与原项目（fork 上游）合并时的冲突风险。
declare module 'pako' {
  interface PakoOptions {
    /** 'string' 表示按 UTF-8 解码为字符串（与 Node Buffer.toString() 行为一致） */
    to?: 'string' | 'array' | 'uint8array' | 'string'
    [key: string]: unknown
  }
  export function inflate(data: Uint8Array, options: { to: 'string' } & PakoOptions): string
  export function inflate(data: Uint8Array, options?: PakoOptions): Uint8Array
  export function ungzip(data: Uint8Array, options: { to: 'string' } & PakoOptions): string
  export function ungzip(data: Uint8Array, options?: PakoOptions): Uint8Array
  export function deflate(data: Uint8Array | string, options?: PakoOptions): Uint8Array
  export function gzip(data: Uint8Array | string, options?: PakoOptions): Uint8Array
}
