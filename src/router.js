/* ============================================================
   极简 hash 路由
   ------------------------------------------------------------
   菜单是可扩展的：往 TABS 里追加一项就多一个模块，
   侧边栏（桌面）和底部标签栏（移动）都会自动出现。
   ============================================================ */
import { ref, readonly } from 'vue'

export const TABS = [
  { path: '/', name: '车辆管理', short: '车辆', icon: 'truck', desc: '车辆档案' },
  { path: '/drivers', name: '司机管理', short: '司机', icon: 'driver', desc: '司机档案' },
  { path: '/routes', name: '路线管理', short: '路线', icon: 'route', desc: '路线与收费站' },
  { path: '/trips', name: '趟次管理', short: '趟次', icon: 'box', desc: '趟次与油耗' },
  { path: '/income', name: '收入', short: '收入', icon: 'wallet', desc: '运费结算' },
]

const read = () => {
  const h = (location.hash || '').replace(/^#/, '')
  const p = h.split('?')[0] || '/'
  return TABS.some((t) => t.path === p) ? p : TABS[0].path
}

export const current = ref(read())

function sync() {
  current.value = read()
  window.scrollTo({ top: 0, behavior: 'auto' })
}
window.addEventListener('hashchange', sync)
if (!location.hash) history.replaceState(null, '', '#' + TABS[0].path)

export function navigate(path) {
  if (current.value === path) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  location.hash = path
}

/** 读取 hash 上的查询参数，例如 #/?plate=苏E·8K215 */
export function query(key, fallback = null) {
  const qs = (location.hash || '').split('?')[1] || ''
  if (!qs) return fallback
  const v = new URLSearchParams(qs).get(key)
  return v === null || v === '' ? fallback : v
}

export const route = readonly(current)
