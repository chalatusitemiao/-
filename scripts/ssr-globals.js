/* SSR 冒烟测试用的浏览器 API 桩。
   必须在任何业务模块之前被 import —— ESM 按声明顺序求值，
   而 router.js 在模块顶层就会访问 window / location / history。 */
const noop = () => {}

globalThis.window = globalThis.window || {
  addEventListener: noop,
  removeEventListener: noop,
  scrollTo: noop,
  location: { hash: '#/' },
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
}
globalThis.location = globalThis.location || { hash: '#/' }
globalThis.history = globalThis.history || { replaceState: noop, pushState: noop }
globalThis.confirm = globalThis.confirm || (() => true)
globalThis.document = globalThis.document || {
  body: { style: {}, appendChild: noop, removeChild: noop },
  createElement: () => ({ style: {}, click: noop, setAttribute: noop }),
  addEventListener: noop,
  removeEventListener: noop,
}
globalThis.matchMedia =
  globalThis.matchMedia ||
  (() => ({ matches: false, addEventListener: noop, removeEventListener: noop }))
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 0))
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id))
globalThis.ResizeObserver =
  globalThis.ResizeObserver ||
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => 'blob:stub')
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || noop
globalThis.Blob = globalThis.Blob || class {}

/* 内存版 storage：让「车辆档案落盘」这条路径在测试里也真的跑到。
   Node 26 自带一个 localStorage 全局，但未指定 --localstorage-file 时一访问就报错，
   所以这里必须把它整个换掉，而不是「不存在时才补一个」。
   业务代码用的是 sessionStorage（刷新不丢、关标签页清空），两个都装上。 */
function installMemoryStorage(name) {
  const store = new Map()
  const stub = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => void store.set(String(k), String(v)),
    removeItem: (k) => void store.delete(String(k)),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  for (const how of [
    () => Object.defineProperty(globalThis, name, { value: stub, configurable: true, writable: true }),
    () => {
      globalThis[name] = stub
    },
  ]) {
    try {
      how()
      globalThis[name].setItem('__probe__', '1')
      if (globalThis[name].getItem('__probe__') === '1') {
        globalThis[name].removeItem('__probe__')
        return true
      }
    } catch {
      /* 换一种方式再试 */
    }
  }
  return false
}
export const memorySessionStorageReady = installMemoryStorage('sessionStorage')
export const memoryLocalStorageReady = installMemoryStorage('localStorage')

export default true
