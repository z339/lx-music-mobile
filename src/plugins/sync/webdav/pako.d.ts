// 最小化的 pako 模块声明（项目已在 dependencies 中声明 pako，但未引入 @types/pako）。
// 这里仅声明同步所用的 inflate/deflate 等 API，避免修改 package.json 引入额外的 devDependency，
// 从而降低与原项目（fork 上游）合并时的冲突风险。
declare module 'pako' {
  export function inflate(data: Uint8Array, options?: Record<string, unknown>): Uint8Array
  export function deflate(data: Uint8Array | string, options?: Record<string, unknown>): Uint8Array
  export function ungzip(data: Uint8Array, options?: Record<string, unknown>): Uint8Array
  export function gzip(data: Uint8Array | string, options?: Record<string, unknown>): Uint8Array
}
