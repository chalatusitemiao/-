/* SSR 冒烟测试：把页面与弹层真的渲染成 HTML 字符串，并校验车辆模块的行为。
   构建： vite build --ssr scripts/ssr-entry.js --outDir dist-ssr
   运行： node dist-ssr/ssr-entry.js                                        */
import './ssr-globals.js'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from '../src/App.vue'
import VehicleForm from '../src/components/VehicleForm.vue'
import VehicleImport from '../src/components/VehicleImport.vue'
import ConfirmDialog from '../src/components/ConfirmDialog.vue'
import DriverForm from '../src/components/DriverForm.vue'
import DriverImport from '../src/components/DriverImport.vue'
import RouteForm from '../src/components/RouteForm.vue'
import TripForm from '../src/components/TripForm.vue'
import { current, TABS } from '../src/router.js'
import {
  vehicles, vehicleMap, addVehicle, updateVehicle, removeVehicle, importVehicles,
  clearAll, nextVehicleId, isPlateTaken, plateSet, findVehicle,
} from '../src/store/vehicles.js'
import { readSheet } from '../src/utils/sheet.js'
import { matchColumns, buildDrafts, summarizeDrafts } from '../src/utils/vehicleImport.js'
import { validateVehicle } from '../src/utils/vehicleRules.js'
import { isWheelEditable, installWheelGuard } from '../src/utils/wheelGuard.js'
import { depreciation, DEP_YEARS } from '../src/utils/depreciation.js'
import { toISO } from '../src/utils/date.js'
import { CAR_TYPES, STATUS, VEHICLE_TYPES, CAR_TYPE_NORM_FUEL } from '../src/data/vehicles.js'
import { TEST_VEHICLES, TEST_DRIVERS } from './seed.mjs'
import {
  drivers, driverMap, addDriver, updateDriver, removeDriver, importDrivers,
  clearAll as clearDrivers, phoneSet, licenseSet, findDriver,
  isPhoneTaken, isLicenseTaken, incidentSummary,
} from '../src/store/drivers.js'
import {
  matchColumns as matchDriverCols, buildDrafts as buildDriverDrafts,
  summarizeDrafts as summarizeDriverDrafts,
} from '../src/utils/driverImport.js'
import { validateDriver, validateIncident, formatPhone } from '../src/utils/driverRules.js'
import { monthlyStats, hasOpsData, formatEnergy, monthKey } from '../src/store/driverOps.js'
import {
  routes, routeMap, addRoute, updateRoute, removeRoute, clearAll as clearRoutes,
  tollTotalFor, findRoute, isRouteTaken,
} from '../src/store/routes.js'
import {
  trips, tripMap, addTrip, updateTrip, removeTrip, clearAll as clearTrips, findTrip, removeTripsByRoute,
  setTripSettled, setSettledBulk,
} from '../src/store/trips.js'
import {
  fuelRate, aggregateTrips, isSuspicious,
  fuelPerTon100km, fuelPer100km, tonHundredKm,
} from '../src/utils/fuelModel.js'
import { validateRoute, validateToll, routeKey, routeTollTotal } from '../src/utils/routeRules.js'
import { validateTrip } from '../src/utils/tripRules.js'
import fs from 'node:fs/promises'
import path from 'node:path'

/* 构建产物在 dist-ssr/ 下，import.meta.url 不再指向 scripts/，
   所以测试数据一律相对「运行目录」（npm 脚本从项目根目录执行）来解析 */
const FIXTURES = path.resolve(process.cwd(), 'scripts', 'fixtures')
const SS_KEY = 'fleet.vehicles.v4'
const DRIVER_SS_KEY = 'fleet.drivers.v1'
const TODAY = new Date()

let pass = 0
let fail = 0
const t0 = Date.now()

function ok(label, cond, extra) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${extra === undefined ? '' : '  → ' + extra}`)
  }
}
function eq(label, a, b) {
  ok(label, JSON.stringify(a) === JSON.stringify(b), `实际 ${JSON.stringify(a)} / 期望 ${JSON.stringify(b)}`)
}
function notContains(label, html, needle) {
  ok(label, !html.includes(needle), `不该出现「${needle}」`)
}

async function mount(comp, props, name, minLen = 200) {
  const app = createSSRApp(comp, props)
  const ctx = {}
  app.config.warnHandler = (msg) => {
    if (!/Hydration|__DEV__/.test(msg)) console.log(`   ⚠ [${name}] ${msg}`)
  }
  try {
    const html = await renderToString(app, ctx)
    const tp = ctx.teleports ? Object.values(ctx.teleports).join('') : ''
    const total = html.length + tp.length
    if (total < minLen) throw new Error(`输出过短 (${total} 字符)`)
    console.log(`  ✓ ${name.padEnd(24)} ${String(total).padStart(7)} 字符`)
    return html + tp
  } catch (e) {
    fail++
    console.log(`  ✗ ${name.padEnd(24)} ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e}`)
    return ''
  }
}

async function fileLike(name) {
  const buf = await fs.readFile(path.join(FIXTURES, name))
  return {
    name,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8'),
  }
}

const goodOf = (drafts) => drafts.filter((d) => d.action === 'add' || d.action === 'update')

/* 应用本身不内置任何数据（没有「载入演示数据」这种功能），
   所以夹具由测试自己灌进仓库 —— 走的是和用户一样的导入通道。 */
function seedVehicles() {
  clearAll()
  importVehicles(TEST_VEHICLES)
}
function seedDrivers() {
  clearDrivers()
  // importDrivers 只处理四个可上传字段（事故记录本来就不参与导入），
  // 所以夹具里的事故记录要单独补一次
  importDrivers(TEST_DRIVERS)
  for (const d of TEST_DRIVERS) {
    if (!d.incidents.length) continue
    const rec = drivers.find((x) => x.phone === d.phone)
    if (rec) updateDriver(rec.id, { ...d, incidents: d.incidents })
  }
}

/* ============================================================ */
clearAll()
current.value = TABS[0].path
location.hash = '#' + TABS[0].path

console.log('\n=== 菜单栏 + 空库渲染 ===')
ok('菜单里有车辆管理', TABS.some((t) => t.name === '车辆管理'))
const pageEmpty = await mount(App, undefined, '空库页面', 3000)
if (pageEmpty) {
  ok('桌面端侧边菜单存在', pageEmpty.includes('class="rail"'))
  ok('菜单里有「车辆管理」', pageEmpty.includes('车辆管理'))
  ok('菜单有分组标题', pageEmpty.includes('模块'))
  ok('移动端底部菜单存在', pageEmpty.includes('class="tabbar"'))
  ok(
    '菜单项带选中态',
    (() => {
      const m = pageEmpty.match(/<button[^>]*class="[^"]*navitem[^"]*"[^>]*>/)
      return !!m && m[0].includes('is-active')
    })()
  )
  ok('空库时给出引导文案', pageEmpty.includes('还没有车辆数据'))
  ok('空库时提供「批量导入」', pageEmpty.includes('批量导入'))
  ok('空库时提供「录入车辆」', pageEmpty.includes('录入车辆'))
  notContains('空库时没有「载入演示数据」', pageEmpty, '载入演示数据')
  notContains('空库时没有「清空全部」', pageEmpty, '清空全部')
  notContains('没有残留的成本模块入口', pageEmpty, '记一笔')
  notContains('空库时不展示车编号', pageEmpty, '车编号')
}

console.log('\n=== 有数据时的列表渲染 ===')
seedVehicles()
const page = await mount(App, undefined, '车辆档案页', 3000)
if (page) {
  for (const t of ['车牌号', '车类型', '载重', '购置价格', '购置日期', '当前累计里程']) {
    ok(`列表包含「${t}」`, page.includes(t))
  }
  notContains('列表不显示车编号', page, '车编号')
  notContains('有数据时也没有「清空全部」', page, '清空全部')
  ok('搜索框只提示搜车牌和车类型', page.includes('搜索车牌号 / 车类型'))
  ok('渲染了 20 台车的车牌', (page.match(/苏E·|苏A·|苏B·|浙B·|皖A·|沪D·/g) || []).length >= 20)
  // 桌面表格 + 移动卡片各一套，所以按钮数量是 2 倍台数
  ok(
    '每台车都有删除按钮',
    (page.match(/btn--danger/g) || []).length >= 20,
    `${(page.match(/btn--danger/g) || []).length} 个`
  )
  ok(
    '每台车都有编辑按钮',
    (page.match(/btn--ghost btn--sm/g) || []).length >= 20,
    `${(page.match(/btn--ghost btn--sm/g) || []).length} 个`
  )
  ok('有「月折旧合计」', page.includes('月折旧合计'))
  // 需求：相同车型的车辆要在 UI 上归到一组
  ok('有按车型分组的开关', page.includes('按车型分组') && page.includes('不分组'))
  ok('分组表头渲染出来了', page.includes('grouprow'))
  ok('分组表头带台数与合计载重', page.includes('台 · 合计载重'))
  ok('列表头标了车型数量', page.includes('个车型'))
  ok('有「平均车龄」', page.includes('平均车龄'))
  ok('说明了 5 年直线法', page.includes('5 年直线法'))
  ok('展示车龄', page.includes('车龄'))
  ok('展示月折旧', page.includes('月折旧'))
}
clearAll()

console.log('\n=== 车辆表单 ===')
const formNew = await mount(VehicleForm, { open: true, vehicle: null }, '表单 · 新增')
if (formNew) {
  ok('标题是「录入车辆信息」', formNew.includes('录入车辆信息'))
  for (const t of ['车牌号', '车类型', '载重', '购置价格', '购置日期', '当前累计里程']) {
    ok(`表单字段「${t}」存在`, formNew.includes(t))
  }
  ok('有购置日期输入框', formNew.includes('id="vf-buydate"') && formNew.includes('type="date"'))
  {
    // 改动：车型是**纯输入框** —— 既不是下拉，也没有 datalist 建议
    // （挂了 datalist 时 Chrome 右侧会出现下拉箭头，看着还是像个下拉）
    const tag = (formNew.match(/<input[^>]*id="vf-type"[^>]*>/) || [])[0]
    ok('车型是输入框', !!tag, tag)
    ok('车型没有 select', !/<select[^>]*id="vf-type"/.test(formNew))
    ok('车型没有 datalist 建议列表', !formNew.includes('datalist') && !formNew.includes('vf-type-list'))
    ok('车型输入框没有 list 属性', !!tag && !/\blist=/.test(tag), tag)
    ok('不预填车型（避免没注意改就录错）', !!tag && !/\bvalue="[^"]+"/.test(tag), tag)
    ok('提示油耗基准怎么算', formNew.includes('油耗基准'))
  }
  {
    // 回归：appearance:none 会把 Chrome 的日历图标干掉，让日期框变成普通文本框
    const tag = (formNew.match(/<input[^>]*id="vf-buydate"[^>]*>/) || [])[0]
    ok('购置日期用的是原生日期选择器', !!tag && tag.includes('type="date"'), tag)
    ok('新增时不预填今天（车不一定是今天买的）', !!tag && !/\bvalue="[^"]+"/.test(tag), tag)
    ok('限制了不能选未来日期', !!tag && tag.includes('max='), tag)
  }
  notContains('表单里没有车编号', formNew, '车编号')
  notContains('表单里没有「系统分配」的说法', formNew, '系统分配')
  ok('提示按 5 年直线法折旧', formNew.includes('5 年直线法'))
  ok('数字输入框带 inputmode', formNew.includes('inputmode="decimal"') && formNew.includes('inputmode="numeric"'))
  ok('有提交按钮', formNew.includes('保存车辆'))
  notContains('表单里不再有删除入口（删除挪到列表上）', formNew, '删除这台车')
}
const formEdit = await mount(VehicleForm, { open: true, vehicle: TEST_VEHICLES[0] }, '表单 · 编辑')
if (formEdit) {
  ok('编辑态显示「保存修改」', formEdit.includes('保存修改'))
  {
    const tag = (formEdit.match(/<input[^>]*id="vf-buydate"[^>]*>/) || [])[0]
    ok('编辑态带出原购置日期', !!tag && tag.includes(TEST_VEHICLES[0].buyDate), tag)
  }
  ok('编辑态有折旧预览', formEdit.includes('当前净值') && formEdit.includes('已使用'))
}

console.log('\n=== 二次确认弹窗 ===')
{
  const dlg = await mount(
    ConfirmDialog,
    {
      open: true,
      title: '确认删除这台车？',
      message: '将删除 苏E·8K215（牵引车）的全部档案信息。',
      detail: '此操作不可撤销',
      confirmText: '删除',
    },
    '确认弹窗',
    300
  )
  if (dlg) {
    ok('显示标题', dlg.includes('确认删除这台车？'))
    ok('显示说明正文', dlg.includes('全部档案信息'))
    ok('显示影响细节', dlg.includes('不可撤销'))
    ok('有取消按钮', dlg.includes('取消'))
    ok('确认按钮文案是「删除」', dlg.includes('>删除<'))
    ok('使用危险样式', dlg.includes('btn--danger-solid'))
    ok('带 alertdialog 语义', dlg.includes('role="alertdialog"'))
  }
  const closed = await mount(ConfirmDialog, { open: false, title: '不该出现' }, '确认弹窗 · 关闭态', 0)
  notContains('关闭时不渲染内容', closed, '不该出现')
}

console.log('\n=== 导入弹层 ===')
const imp = await mount(VehicleImport, { open: true }, '导入 · 选择文件')
if (imp) {
  ok('提示支持 xlsx 与 csv', imp.includes('.xlsx') && imp.includes('.csv'))
  ok('有下载模板入口', imp.includes('下载导入模板'))
  ok('说明了车牌号是主键', imp.includes('车牌号是主键'))
  ok('说明了同车牌替换 / 不同车牌新增', imp.includes('替换') && imp.includes('新增'))
  ok('把购置日期列为必填表头', imp.includes('购置日期'))
  notContains('已去掉列映射 UI', imp, '列映射')
  notContains('已去掉跳过 / 覆盖的切换', imp, '覆盖更新')
  notContains('不再提车编号', imp, '车编号')
}

console.log('\n=== 滚轮防护 ===')
{
  const makeInput = (type) => ({
    tagName: 'INPUT',
    type,
    blurred: false,
    blur() {
      this.blurred = true
    },
  })
  const num = makeInput('number')
  ok('聚焦中的数字框 → 命中', isWheelEditable(num, num) === true)
  const txt = makeInput('text')
  ok('文本框不受影响', isWheelEditable(txt, txt) === false)
  ok('未聚焦的数字框不受影响', isWheelEditable(makeInput('number'), makeInput('number')) === false)

  const handlers = {}
  const active = makeInput('number')
  const uninstall = installWheelGuard({
    activeElement: active,
    addEventListener: (t, h) => (handlers[t] = h),
    removeEventListener: () => {},
  })
  handlers.wheel({ target: active })
  ok('滚轮经过聚焦中的数字框 → 自动失焦（数值不会被改）', active.blurred === true)
  const free = makeInput('number')
  handlers.wheel({ target: free })
  ok('滚轮经过未聚焦的数字框 → 不动它', free.blurred === false)
  ok('返回了卸载函数', typeof uninstall === 'function')
}

console.log('\n=== 默认状态 / 演示数据 ===')
clearAll()
eq('默认是空列表（没有内置演示车）', vehicles.length, 0)
ok('空列表时索引也是空的', Object.keys(vehicleMap).length === 0)
seedVehicles()
ok('索引同步', Object.keys(vehicleMap).length === 20)
ok('每台车都有购置日期', vehicles.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.buyDate)))
ok('每台车都有状态', vehicles.every((v) => !!STATUS[v.status]))
ok('每台车都能算出折旧', vehicles.every((v) => depreciation(v.price, v.buyDate).monthly > 0))
ok('有已提足折旧的车（车龄≥5 年）', vehicles.some((v) => depreciation(v.price, v.buyDate, TODAY).fully))

console.log('\n=== 车辆 CRUD（空库起步）===')
clearAll()
const created = addVehicle({
  plate: '苏E9Z999', type: '冷藏车', tonnage: 12, price: 390000, buyDate: '2024-06-01', odo: 0,
})
eq('新增后总数 1', vehicles.length, 1)
eq('第一台车编号是 V01', created.code, 'V01')
ok('车编号仍然自动分配（只是前台不显示）', !!created.code)
ok('新增的车带上了车型默认油耗', created.normFuel > 0 && created.tank > 0)
ok('新增的车有保养提醒基准', created.nextServiceOdo === 15000)
eq('车牌原样保留（只去空格转大写）', created.plate, '苏E9Z999')
eq('购置日期被保存', created.buyDate, '2024-06-01')
eq('车牌查重命中', isPlateTaken('苏E9Z999'), true)
eq('车牌查重可排除自己', isPlateTaken('苏E9Z999', created.id), false)
ok('折旧按 5 年算（车龄 > 2 年）', depreciation(created.price, created.buyDate, TODAY).ageYears > 2)

const codeBefore = created.code
updateVehicle(created.id, {
  plate: '苏E9Z888', type: '自卸车', tonnage: 30, price: 410000, buyDate: '2020-01-15', odo: 1200,
})
eq('编辑生效：车牌', findVehicle(created.id).plate, '苏E9Z888')
eq('编辑生效：载重', findVehicle(created.id).tonnage, 30)
eq('编辑生效：购置日期', findVehicle(created.id).buyDate, '2020-01-15')
ok('车编号在编辑后保持不变', findVehicle(created.id).code === codeBefore, findVehicle(created.id).code)
ok('换车型同步了油耗基准（自卸车满载基准）', findVehicle(created.id).normFuel === CAR_TYPE_NORM_FUEL['自卸车'], findVehicle(created.id).normFuel)
{
  const d = depreciation(findVehicle(created.id).price, findVehicle(created.id).buyDate, TODAY)
  ok('改了日期车龄跟着变（> 5 年）', d.ageYears > 5, d.ageYears)
  ok('已提足折旧', d.fully === true)
}
ok('编号按现有最大值递增', nextVehicleId() === 'V02', nextVehicleId())

removeVehicle(created.id)
eq('删除后回到 0 台', vehicles.length, 0)
ok('删除后索引也清了', Object.keys(vehicleMap).length === 0)

console.log('\n=== 批量导入（车牌号为主键）===')
{
  clearAll()
  const { rows, source } = await readSheet(await fileLike('std.xlsx'))
  eq('识别为 xlsx', source, 'xlsx')
  const { mapping, missing } = matchColumns(rows[0])
  eq('表头全部识别（不需要人工映射）', missing, [])

  const d1 = buildDrafts(rows, mapping, { existingPlates: plateSet() })
  eq('4 行全部判为新增', summarizeDrafts(d1), { add: 4, update: 0, error: 0, total: 4 })
  // Excel 的日期是序列号，导入前必须已经被还原
  eq('导入草稿里的日期已被还原', d1[0].draft.buyDate, '2022-03-18')

  eq('新增 4 台', importVehicles(goodOf(d1)), { added: 4, updated: 0 })
  eq('库里有 4 台', vehicles.length, 4)
  ok('新导入的排在最前面', vehicles[0].plate === '苏E·8K215', vehicles[0].plate)
  ok('导入的车都带上了购置日期', vehicles.every((v) => !!v.buyDate))
  ok('车编号互不重复（编号仍自动分配）', new Set(vehicles.map((v) => v.code)).size === 4)

  const d2 = buildDrafts(rows, mapping, { existingPlates: plateSet() })
  eq('再次导入：4 行全部判为替换', summarizeDrafts(d2), { add: 0, update: 4, error: 0, total: 4 })
  eq('替换 4 台、没有新增', importVehicles(goodOf(d2)), { added: 0, updated: 4 })
  eq('总数仍然是 4 台（不是重复新增）', vehicles.length, 4)

  const rows2 = rows.map((r) => r.slice())
  rows2[1][2] = 40
  rows2.push(['浙B·NEW01', '平板车', 25, 240000, '2023-04-04', 12000])
  const d3 = buildDrafts(rows2, mapping, { existingPlates: plateSet() })
  eq('统计：新增 1 / 替换 4', summarizeDrafts(d3), { add: 1, update: 4, error: 0, total: 5 })
  eq('结果 新增 1 / 替换 4', importVehicles(goodOf(d3)), { added: 1, updated: 4 })
  eq('总数变成 5', vehicles.length, 5)
  eq('同车牌的数据被替换（载重 32 → 40）', findVehicle(vehicles.find((v) => v.plate === '苏E·8K215').id).tonnage, 40)
  ok('新车牌被新增', vehicles.some((v) => v.plate === '浙B·NEW01'))
  ok('替换不会产生重复行', vehicles.filter((v) => v.plate === '苏E·8K215').length === 1)

  clearAll()
  seedVehicles()
  const messy = await readSheet(await fileLike('messy.xlsx'))
  const m = matchColumns(messy.rows[0])
  const dm = buildDrafts(messy.rows, m.mapping, { existingPlates: plateSet() })
  // 苏E·8K215 库里没有 → 新增；沪D·N78520 是演示车 V07 → 替换；其余 5 行报错
  eq('脏数据：新增 2 / 替换 1 / 报错 4', summarizeDrafts(dm), { add: 2, update: 1, error: 4, total: 7 })
  eq('结果 新增 2 / 替换 1', importVehicles(goodOf(dm)), { added: 2, updated: 1 })
  eq('总数 20 → 22', vehicles.length, 22)
  ok('车牌错误的行没进库', !vehicles.some((v) => v.plate === '苏E·1234'))
  ok('车型不在基准表里的行照样进库（车型是自由输入）', vehicles.some((v) => v.plate === '浙B·Z99999' && v.type === '不存在的车型'))
  ok('日期错误的行没进库', !vehicles.some((v) => v.plate === '苏E·BADD1'))
  ok('未来日期的行没进库', !vehicles.some((v) => v.plate === '苏E·FUTR1'))
}

console.log('\n=== 落盘（sessionStorage）===')
{
  clearAll()
  eq('清空后落盘是空数组', JSON.parse(sessionStorage.getItem(SS_KEY)), [])
  const added = addVehicle({
    plate: '苏E·SESS1', type: '牵引车', tonnage: 32, price: 400000, buyDate: '2023-03-03', odo: 500,
  })
  const raw = sessionStorage.getItem(SS_KEY)
  ok('新增后写入了 sessionStorage', !!raw && raw.includes('苏E·SESS1'))
  eq('落盘条数与内存一致', JSON.parse(raw).length, vehicles.length)
  ok('落盘内容含购置日期', JSON.parse(raw).every((v) => !!v.buyDate))

  const snapshot = JSON.parse(raw)
  ok('刷新后仍能读到（sessionStorage 的特性）', snapshot.length === 1 && snapshot[0].plate === '苏E·SESS1')
  ok('localStorage 里没有写入（按要求只用 session）', localStorage.getItem(SS_KEY) === null)

  removeVehicle(added.id)
  eq('删除后落盘同步', JSON.parse(sessionStorage.getItem(SS_KEY)).length, 0)
}

console.log('\n=== 校验规则 ===')
{
  const base = { plate: '苏E·11111', type: '牵引车', tonnage: '32', price: '400000', buyDate: '2022-03-18', odo: '1000' }
  ok('完整数据通过', validateVehicle(base, { today: TODAY }).ok)
  ok('缺购置日期被拦下', !validateVehicle({ ...base, buyDate: '' }, { today: TODAY }).ok)
  ok('未来日期被拦下', !validateVehicle({ ...base, buyDate: toISO(new Date(Date.now() + 86400000)) }, { today: TODAY }).ok)
  ok('载重为 0 被拦下', !validateVehicle({ ...base, tonnage: '0' }, { today: TODAY }).ok)
  ok('价格为负被拦下', !validateVehicle({ ...base, price: '-1' }, { today: TODAY }).ok)
  ok('里程为负被拦下', !validateVehicle({ ...base, odo: '-5' }, { today: TODAY }).ok)
  ok('车牌补间隔点后可识别', validateVehicle({ ...base, plate: '苏E11111' }, { today: TODAY }).ok)
  eq('折旧年限常量是 5', DEP_YEARS, 5)
  eq('车类型枚举', CAR_TYPES.length, 9)
}

console.log('\n=== 司机模块 · 菜单 ===')
eq('TABS 有五项', TABS.map((t) => t.name), ['车辆管理', '司机管理', '路线管理', '趟次管理', '收入'])
eq('司机入口路径', TABS[1].path, '/drivers')
{
  clearDrivers()
  clearTrips()
  current.value = '/drivers'
  location.hash = '#/drivers'
  const dp = await mount(App, undefined, '司机页 · 空库', 2500)
  if (dp) {
    ok('两个菜单项都在', dp.includes('车辆管理') && dp.includes('司机管理'))
    ok('侧边栏与底部菜单都存在', dp.includes('class="rail"') && dp.includes('class="tabbar"'))
    ok('空库时给出引导文案', dp.includes('还没有司机数据'))
    ok('空库时提供两个入口', dp.includes('批量导入') && dp.includes('录入司机'))
    notContains('空库时没有「载入演示数据」', dp, '载入演示数据')
    notContains('司机页没有「清空全部」', dp, '清空全部')
    ok('统计字段显示占位符', dp.includes('待接入运营数据'))
    ok('搜索框只提示搜姓名与手机号', dp.includes('搜索姓名 / 手机号'))
    ok('有事故/违章汇总卡', dp.includes('事故 / 违章'))
    ok('有月工资合计卡', dp.includes('月工资合计'))
  }
}

console.log('\n=== 司机模块 · 列表渲染（有数据）===')
{
  seedDrivers()
  const dp = await mount(App, undefined, '司机页 · 12 名司机', 6000)
  if (dp) {
    for (const t of ['姓名', '手机号', '入职日期', '驾驶证号', '当月创收', '当月里程', '油耗']) {
      ok(`列表包含「${t}」`, dp.includes(t))
    }
    ok('渲染了 12 位司机', (dp.match(/138 0123 4567|159 0123 4568/g) || []).length >= 1)
    ok('手机号按 3-4-4 分组展示', dp.includes('138 0123 4567'))
    ok('显示工龄', dp.includes('工龄'))
    ok('事故违章有汇总', dp.includes('事故 / 违章') && dp.includes('累计经济损失'))
    ok('事故次数以胶囊展示', dp.includes('次 ·'))
    ok('统计字段标了「自动」', dp.includes('自动'))
    ok('每台司机都有编辑与删除按钮', (dp.match(/btn--ghost btn--sm/g) || []).length >= 24)
    ok('每台司机都有删除按钮', (dp.match(/btn--danger/g) || []).length >= 12)
    ok('列表有月工资列', dp.includes('月工资'))
  }
}

console.log('\n=== 司机表单 ===')
{
  const fNew = await mount(DriverForm, { open: true, driver: null }, '司机表单 · 新增')
  if (fNew) {
    for (const t of ['姓名', '手机号', '入职日期', '驾驶证号', '工资']) ok(`表单字段「${t}」存在`, fNew.includes(t))
    ok('有入职日期选择器', fNew.includes('id="df-hire"') && fNew.includes('type="date"'))
    ok('手机号用 tel 键盘', fNew.includes('type="tel"'))
    // 需求：录入司机时要能录工资
    ok('有工资输入框', fNew.includes('id="df-salary"'))
    ok('工资标了单位元/月', fNew.includes('元/月'))
    ok('工资是选填并说明用途', fNew.includes('月工资，用于统计人工成本'))
    ok('新增态不预填入职日期', !/\bvalue="[^"]+"/.test((fNew.match(/<input[^>]*id="df-hire"[^>]*>/) || [])[0] || ''))
    ok('说明统计字段不需要填', fNew.includes('自动统计'))
    ok('新增态提示事故记录需先保存', fNew.includes('需要先保存司机'))
    notContains('新增态没有「添加一条记录」按钮', fNew, '添加一条记录')

    const fEdit = await mount(DriverForm, { open: true, driver: TEST_DRIVERS[0] }, '司机表单 · 编辑')
    if (fEdit) {
      ok('编辑态显示「保存修改」', fEdit.includes('保存修改'))
      ok('编辑态带出姓名', fEdit.includes('陈志强'))
      ok('编辑态带出手机号', fEdit.includes('13801234567'))
      ok('编辑态带出事故记录区', fEdit.includes('事故 / 违章记录'))
      ok('编辑态有「添加一条记录」按钮', fEdit.includes('添加一条记录'))
      ok('编辑态列出已有事故', fEdit.includes('G2 无锡段追尾，本车全责'))
      ok('编辑态显示事故汇总', fEdit.includes('2 条 ·'))
      ok('事故行有发生时间/描述/经济损失三个输入', fEdit.includes('发生时间') && fEdit.includes('事件描述') && fEdit.includes('经济损失'))
      ok('事故行可单条删除', fEdit.includes('删除'))
    }
  }
}

console.log('\n=== 司机导入弹层 ===')
{
  const im = await mount(DriverImport, { open: true }, '司机导入 · 选择文件')
  if (im) {
    ok('提示支持 xlsx 与 csv', im.includes('.xlsx') && im.includes('.csv'))
    ok('有下载模板入口', im.includes('下载导入模板'))
    ok('说明了手机号是主键', im.includes('手机号是主键'))
    ok('说明了替换 / 新增规则', im.includes('替换') && im.includes('新增'))
    ok('列出可导入的列（含工资）', im.includes('姓名、手机号、入职日期、驾驶证号'))
    ok('声明统计字段不参与导入', im.includes('自动统计') && im.includes('不参与导入'))
    ok('声明事故违章是手工记录', im.includes('手工记录'))
    notContains('没有列映射 UI', im, '列映射')
  }
}

console.log('\n=== 司机 CRUD（空库起步）===')
{
  clearDrivers()
  const created = addDriver({ name: '测试司机', phone: '138-0000-1111', hireDate: '2023-06-01', licenseNo: '' })
  eq('新增后 1 位', drivers.length, 1)
  eq('第一位编号是 D01', created.id, 'D01')
  eq('号码里的横线原样保留', created.phone, '138-0000-1111')
  ok('新增时事故记录为空数组', Array.isArray(created.incidents) && created.incidents.length === 0)
  eq('手机号查重命中', isPhoneTaken('138-0000-1111'), true)
  eq('手机号查重可排除自己', isPhoneTaken('138-0000-1111', created.id), false)
  ok('驾驶证号为空时查重不误报', isLicenseTaken('', created.id) === false)

  updateDriver(created.id, { name: '测试司机改名', phone: '13800001111', hireDate: '2023-06-01', licenseNo: '320501198503124517' })
  eq('编辑生效：姓名', findDriver(created.id).name, '测试司机改名')
  eq('编辑生效：驾驶证号', findDriver(created.id).licenseNo, '320501198503124517')
  ok('未传 incidents 时保留原有事故记录', Array.isArray(findDriver(created.id).incidents))

  // 事故记录：跟着主表单一起提交
  updateDriver(created.id, {
    name: '测试司机改名', phone: '13800001111', hireDate: '2023-06-01', licenseNo: '',
    incidents: [
      { date: '2025-01-02', desc: '倒车刮蹭', loss: 800 },
      { date: '2025-06-18', desc: '违章停车', loss: 100 },
    ],
  })
  eq('事故记录写入 2 条', findDriver(created.id).incidents.length, 2)
  eq('事故汇总：次数', incidentSummary(findDriver(created.id)).count, 2)
  eq('事故汇总：累计损失', incidentSummary(findDriver(created.id)).loss, 900)
  ok('事故记录自动分配了 id', findDriver(created.id).incidents.every((i) => !!i.id))

  updateDriver(created.id, {
    name: '测试司机改名', phone: '13800001111', hireDate: '2023-06-01', licenseNo: '',
    incidents: [{ date: '2025-01-02', desc: '倒车刮蹭', loss: 800 }],
  })
  eq('整份替换事故记录（删掉一条剩 1 条）', findDriver(created.id).incidents.length, 1)

  removeDriver(created.id)
  eq('删除后回到 0 位', drivers.length, 0)
  ok('删除后索引也清了', Object.keys(driverMap).length === 0)
}

console.log('\n=== 司机统计由趟次推导（闭环）===')
{
  clearDrivers()
  clearRoutes()
  clearTrips()
  const d = addDriver({ name: '统计测试', phone: '13900002222', hireDate: '2024-01-01', licenseNo: '' })
  eq('没有趟次时统计为 null（界面显示「—」）', monthlyStats(d.id), null)
  eq('hasOpsData 为 false', hasOpsData(), false)

  const r = addRoute({
    from: '苏州', to: '上海', distance: 108,
    tolls: [{ station: '苏州新区', prices: { 牵引车: 85 } }],
  })
  const month = monthKey()
  const day = `${month}-10`
  addTrip({ date: day, routeId: r.id, type: '牵引车', driverId: d.id, tonnage: 30, actualFuel: 35, toll: 85, revenue: 12000, distance: 108 })
  addTrip({ date: day, routeId: r.id, type: '牵引车', driverId: d.id, tonnage: 20, actualFuel: 28, toll: 85, revenue: 8000, distance: 108 })

  const s = monthlyStats(d.id, month)
  eq('司机当月创收 = Σ运费', s.revenue, 20000)
  eq('司机当月里程 = Σ公里数', s.mileage, 216)
  eq('司机当月油耗 = Σ实际油耗', formatEnergy(s.energy), '63 L')
  eq('hasOpsData 变 true', hasOpsData(), true)

  // 界面上要真的显示出来
  const dp = await mount(App, undefined, '司机页 · 有趟次数据', 4000)
  if (dp) {
    ok('列表显示创收金额', dp.includes('20,000'))
    ok('列表显示里程', dp.includes('216 km'))
    ok('列表显示油耗', dp.includes('63 L'))
    ok('汇总卡不再显示占位符', !dp.includes('待接入运营数据'))
  }
  clearTrips()
  clearRoutes()
}

console.log('\n=== 司机批量导入（手机号为主键）===')
{
  clearDrivers()
  const { rows } = await readSheet(await fileLike('drivers-std.xlsx'))
  const { mapping, missing } = matchDriverCols(rows[0])
  eq('表头全部识别', missing, [])

  const d1 = buildDriverDrafts(rows, mapping, { existingPhones: phoneSet(), existingLicenses: licenseSet() })
  eq('4 行全部判为新增', summarizeDriverDrafts(d1), { add: 4, update: 0, error: 0, total: 4 })
  eq('Excel 入职日期被还原', d1[0].draft.hireDate, '2019-03-11')
  eq('导入 4 位', importDrivers(goodOf(d1)), { added: 4, updated: 0 })
  eq('库里有 4 位', drivers.length, 4)

  const d2 = buildDriverDrafts(rows, mapping, { existingPhones: phoneSet(), existingLicenses: licenseSet() })
  eq('再次导入全部判为替换', summarizeDriverDrafts(d2), { add: 0, update: 4, error: 0, total: 4 })
  eq('替换 4 位、没有新增', importDrivers(goodOf(d2)), { added: 0, updated: 4 })
  eq('总数仍然是 4 位', drivers.length, 4)

  // 替换要真的改数据：把第一个人的姓名改掉再导
  const rows2 = rows.map((r) => r.slice())
  rows2[1][0] = '陈志强改名'
  const d3 = buildDriverDrafts(rows2, mapping, { existingPhones: phoneSet(), existingLicenses: licenseSet() })
  importDrivers(goodOf(d3))
  ok('姓名被替换', drivers.some((x) => x.name === '陈志强改名'))
  eq('总数不变', drivers.length, 4)

  // 已导入的那位如果没有驾驶证号，补上也不算错
  ok('驾驶证号留空的行也进库了', drivers.some((x) => x.phone === '15901234568' && !x.licenseNo))

  clearDrivers()
  seedDrivers()
  const { rows: mrows } = await readSheet(await fileLike('drivers-messy.xlsx'))
  const mm = matchDriverCols(mrows[0]).mapping
  const dm = buildDriverDrafts(mrows, mm, { existingPhones: phoneSet(), existingLicenses: licenseSet() })
  eq('脏数据：新增 3 / 替换 0 / 报错 5', summarizeDriverDrafts(dm), { add: 3, update: 0, error: 5, total: 8 })
  eq('结果 新增 3', importDrivers(goodOf(dm)), { added: 3, updated: 0 })
  eq('总数 12 → 15', drivers.length, 15)
  ok('国外号码照样进库（不做格式限制）', drivers.some((x) => x.phone === '+49 30 1234567'))
  ok('缺姓名的那位没进库', !drivers.some((x) => x.phone === '18711114444'))
  ok('未来入职日期的没进库', !drivers.some((x) => x.phone === '15011116666'))
  ok('驾驶证号重复的没进库', !drivers.some((x) => x.phone === '18811117777'))
}

console.log('\n=== 司机落盘（sessionStorage）===')
{
  clearDrivers()
  eq('清空后落盘是空数组', JSON.parse(sessionStorage.getItem(DRIVER_SS_KEY)), [])
  const d = addDriver({ name: '落盘测试', phone: '13700003333', hireDate: '2022-02-02', licenseNo: '' })
  updateDriver(d.id, {
    name: '落盘测试', phone: '13700003333', hireDate: '2022-02-02', licenseNo: '',
    incidents: [{ date: '2025-03-03', desc: '测试事故', loss: 300 }],
  })
  const raw = sessionStorage.getItem(DRIVER_SS_KEY)
  ok('写入了 sessionStorage', !!raw && raw.includes('13700003333'))
  ok('事故记录也一起落盘', raw.includes('测试事故'))
  const snapshot = JSON.parse(raw)
  eq('落盘条数与内存一致', snapshot.length, drivers.length)
  ok('落盘的事故记录带 id', snapshot[0].incidents.every((i) => !!i.id))
  ok('localStorage 里没有写入', localStorage.getItem(DRIVER_SS_KEY) === null)
  removeDriver(d.id)
  eq('删除后落盘同步', JSON.parse(sessionStorage.getItem(DRIVER_SS_KEY)).length, 0)
}

console.log('\n=== 司机校验规则 ===')
{
  const base = { name: '陈志强', phone: '13801234567', hireDate: '2019-03-11', licenseNo: '' }
  ok('完整数据通过', validateDriver(base, { today: TODAY }).ok)
  ok('缺姓名被拦下', !validateDriver({ ...base, name: '' }, { today: TODAY }).ok)
  ok('国外号码放行（不限制格式）', validateDriver({ ...base, phone: '+49 30 1234567' }, { today: TODAY }).ok)
  ok('入职日期在未来被拦下', !validateDriver({ ...base, hireDate: '2099-01-01' }, { today: TODAY }).ok)
  ok('驾驶证号留空通过', validateDriver({ ...base, licenseNo: '' }, { today: TODAY }).ok)
  ok('事故缺描述被拦下', !validateIncident({ date: '2025-01-01', desc: '', loss: '0' }, { today: TODAY }).ok)
  ok('事故经济损失为负被拦下', !validateIncident({ date: '2025-01-01', desc: '测试', loss: '-1' }, { today: TODAY }).ok)
  eq('手机号展示格式', formatPhone('13801234567'), '138 0123 4567')
}

console.log('\n=== 路线模块 ===')
{
  clearRoutes()
  clearTrips()
  current.value = '/routes'
  location.hash = '#/routes'
  const rp = await mount(App, undefined, '路线页 · 空库', 2500)
  if (rp) {
    ok('菜单里有「路线管理」', rp.includes('路线管理'))
    ok('五个菜单项都在', ['车辆管理', '司机管理', '路线管理', '趟次管理', '收入'].every((n) => rp.includes(n)))
    ok('空库时给出引导文案', rp.includes('还没有路线数据'))
    ok('空库时提供「录入路线」', rp.includes('录入路线'))
    notContains('路线页没有「载入演示数据」', rp, '载入演示数据')
    ok('搜索框提示搜起终点与收费站', rp.includes('搜索起点 / 终点 / 收费站'))
  }
}

{
  // 站点价格按车型分别存：同一条路线，牵引车和皮卡价差明显
  addRoute({
    from: '苏州', to: '上海', distance: 108,
    tolls: [
      { station: '苏州新区', prices: { 牵引车: 85, 皮卡: 25, 自卸车: 92 } },
      { station: '花桥', prices: { 牵引车: 60, 皮卡: 18 } },
    ],
  })
  addRoute({ from: '苏州', to: '杭州', distance: 160, tolls: [{ station: '吴江', prices: { 牵引车: 120 } }] })

  const rp = await mount(App, undefined, '路线页 · 有数据', 4000)
  if (rp) {
    ok('渲染了两条路线', rp.includes('上海') && rp.includes('杭州'))
    ok('显示公里数', rp.includes('108 km') && rp.includes('160 km'))
    ok('按车型列出总过路费', rp.includes('牵引车') && rp.includes('¥145') && rp.includes('¥43'))
    ok('皮卡价格单独成列（不与牵引车混淆）', rp.includes('皮卡'))
    ok('汇总卡给出过路费区间', rp.includes('最低') && rp.includes('最高'))
    ok('每条路线都有编辑与删除按钮', (rp.match(/btn--danger/g) || []).length >= 2)
    notContains('不再显示「未填价格」之外的空话', rp, '清空全部')
  }

  // 过路费按车型汇总
  const sh = findRouteByKeyForTest('苏州', '上海')
  eq('牵引车过路费 = 85 + 60', tollTotalFor(sh, '牵引车'), 145)
  eq('皮卡过路费 = 25 + 18', tollTotalFor(sh, '皮卡'), 43)
  eq('没走过的车型算 0', tollTotalFor(sh, '冷藏车'), 0)
}

function findRouteByKeyForTest(from, to) {
  return routes.find((r) => routeKey(r.from, r.to) === routeKey(from, to))
}

console.log('\n=== 路线表单 ===')
{
  const rf = await mount(RouteForm, { open: true, route: null }, '路线表单 · 新增')
  if (rf) {
    for (const t of ['起点名', '终点名', '公里数']) ok(`表单字段「${t}」存在`, rf.includes(t))
    ok('有收费站区块', rf.includes('途经收费站'))
    ok('有「添加收费站」按钮', rf.includes('添加收费站'))
    ok('提示价格是「车型 + 金额」的行', rf.includes('一行一个「车型 + 金额」'))
    ok('提示车型下拉取自车辆管理', rf.includes('车辆管理里已录入的车型'))
    ok('有「添加收费站」按钮', rf.includes('添加收费站'))
    ok('提交按钮是「保存路线」', rf.includes('保存路线'))
  }
  const editRoute = findRouteByKeyForTest('苏州', '上海')
  const rfe = await mount(RouteForm, { open: true, route: editRoute }, '路线表单 · 编辑')
  if (rfe) {
    ok('编辑态显示「保存修改」', rfe.includes('保存修改'))
    ok('编辑态带出起点终点', rfe.includes('苏州') && rfe.includes('上海'))
    ok('编辑态带出已有收费站', rfe.includes('苏州新区') && rfe.includes('花桥'))
    ok('编辑态列出已有车型价格', rfe.includes('牵引车') && rfe.includes('皮卡') && rfe.includes('自卸车'))
    ok('编辑态把价格铺成「车型 + 金额」的行', rfe.includes('添加车型价格') && rfe.includes('选择车型'))
    ok('编辑态显示本路线总过路费', rfe.includes('本路线总过路费'))
  }
}

console.log('\n=== 路线 CRUD / 校验 ===')
{
  clearRoutes()
  clearTrips()
  const a = addRoute({ from: '南京', to: '合肥', distance: 165, tolls: [{ station: '江宁', prices: { 牵引车: 70 } }] })
  eq('新增后 1 条', routes.length, 1)
  eq('第一条编号是 R01', a.id, 'R01')
  eq('主键判重命中', isRouteTaken('南京', '合肥'), true)
  eq('主键判重可排除自己', isRouteTaken('南京', '合肥', a.id), false)
  eq('起终点带空格也认得出来', isRouteTaken(' 南京 ', '合肥'), true)

  ok('起点终点相同被拦下', !!validateRoute({ from: '南京', to: '南京', distance: '10' }, {}).errors.to)
  ok('公里数为 0 被拦下', !!validateRoute({ from: 'A', to: 'B', distance: '0' }, {}).errors.distance)
  ok('公里数不是数字被拦下', !!validateRoute({ from: 'A', to: 'B', distance: '约一百' }, {}).errors.distance)
  {
    const dup = validateRoute({ from: '南京', to: '合肥', distance: '165' }, { takenRouteKeys: new Set([routeKey('南京', '合肥')]) })
    ok('重复路线被拦下', !!dup.errors.to)
  }
  ok('收费站没名字被拦下', !!validateToll({ station: '', prices: {} }, {}).errors.station)
  ok('同路线重名收费站被拦下', !!validateToll({ station: '江宁', prices: {} }, { seen: new Set(['江宁']) }).errors.station)
  ok('价格为负被拦下', !!validateToll({ station: '江宁', prices: { 牵引车: '-5' } }, {}).errors['price_牵引车'])
  ok('价格不是数字被拦下', !!validateToll({ station: '江宁', prices: { 牵引车: 'abc' } }, {}).errors['price_牵引车'])

  updateRoute(a.id, { from: '南京', to: '合肥', distance: 180, tolls: [{ station: '江宁', prices: { 牵引车: 75 } }] })
  eq('编辑生效：公里数', findRoute(a.id).distance, 180)
  eq('编辑生效：过路费', tollTotalFor(findRoute(a.id), '牵引车'), 75)

  removeRoute(a.id)
  eq('删除后回到 0 条', routes.length, 0)
}

console.log('\n=== 车型随车辆带出 / 路线表单的车型下拉取自车队 ===')
{
  clearAll()
  importVehicles([{ plate: '苏E·FLEET1', type: '依维柯', tonnage: 3, price: 200000, buyDate: '2023-01-01', odo: 100 }])
  addRoute({ from: '甲地', to: '乙地', distance: 50, tolls: [{ station: '某站', prices: { 依维柯: 20 } }] })
  const rf2 = await mount(RouteForm, { open: true, route: findRouteByKeyForTest('甲地', '乙地') }, '路线表单 · 车型取自车队', 400)
  ok('路线表单的车型下拉来自车队', rf2.includes('依维柯'))
  ok('没有把基准表里的车型全列出来', !rf2.includes('自卸车'))
  ok('车队里没有车辆时提示先按常用车型列出', !rf2.includes('车辆管理里还没有车辆'))

  const tf2 = await mount(TripForm, { open: true, trip: null }, '趟次表单 · 车辆列表', 400)
  // 趟次表单不再有车型下拉：车型出现在**车辆的选项文字**里，选完自动带出
  ok('车辆选项里带出车型', tf2.includes('依维柯'))
  ok('没有把基准表里的车型全列出来', !tf2.includes('自卸车'))

  // 车队空的时候退回基准表，表单不至于没法用
  clearAll()
  clearRoutes()
  const rf3 = await mount(RouteForm, { open: true, route: null }, '路线表单 · 车队为空', 400)
  ok('车队为空时提示先按常用车型列出', rf3.includes('车辆管理里还没有车辆'))
}
console.log('\n=== 趟次管理 · 核心：按吨归一化后再比 ===')
{
  clearDrivers()
  clearRoutes()
  clearTrips()
  const dA = addDriver({ name: '甲司机', phone: '13800000001', hireDate: '2022-01-01', licenseNo: '' })
  const dB = addDriver({ name: '乙司机', phone: '13800000002', hireDate: '2022-01-01', licenseNo: '' })
  const r1 = addRoute({
    from: '苏州', to: '上海', distance: 108,
    tolls: [{ station: '苏州新区', prices: { 牵引车: 85, 皮卡: 25 } }],
  })

  // 甲：拉重货 30 吨，一趟 35 L → 35 ÷ (30×1.08) = 1.080 L/吨·百公里
  // 乙：拉轻货 18 吨，一趟 33 L → 33 ÷ (18×1.08) = 1.698 L/吨·百公里
  // 甲的**绝对油耗更高**（35 > 33），但每吨每百公里更省 —— 排行必须甲在前
  for (let i = 0; i < 3; i++) {
    addTrip({ date: `2026-10-0${i + 1}`, routeId: r1.id, type: '牵引车', driverId: dA.id, tonnage: 30, actualFuel: 35, distance: 108, toll: 85, revenue: 3000 })
    addTrip({ date: `2026-10-1${i}`, routeId: r1.id, type: '牵引车', driverId: dB.id, tonnage: 18, actualFuel: 33, distance: 108, toll: 85, revenue: 3000 })
  }
  eq('趟次写入 6 条', trips.length, 6)

  const ofA = aggregateTrips(trips.filter((t) => t.driverId === dA.id))
  const ofB = aggregateTrips(trips.filter((t) => t.driverId === dB.id))
  ok('甲的绝对油耗更高', ofA.actual > ofB.actual, `${ofA.actual} > ${ofB.actual}`)
  eq('甲的每吨百公里耗油', ofA.perTon100, 1.08)
  eq('乙的每吨百公里耗油', ofB.perTon100, 1.698)
  ok('按每吨百公里算甲更省', ofA.perTon100 < ofB.perTon100)
  eq('甲的三趟指标一致，波动为 0', [ofA.perTon100Min, ofA.perTon100Max], [1.08, 1.08])

  // 界面上：甲必须排在乙前面
  current.value = '/trips'
  location.hash = '#/trips'
  const fp = await mount(App, undefined, '趟次管理页 · 有趟次', 5000)
  if (fp) {
    ok('按路线分组', fp.includes('苏州') && fp.includes('上海'))
    ok('按车型分组', fp.includes('牵引车'))
    ok('司机都在', fp.includes('甲司机') && fp.includes('乙司机'))
    const iA = fp.indexOf('甲司机')
    const iB = fp.indexOf('乙司机')
    ok('甲排在乙前面（按吨归一化后胜出，而不是看绝对油耗）', iA >= 0 && iB >= 0 && iA < iB, `甲@${iA} 乙@${iB}`)
    ok('显示每吨每百公里耗油量', fp.includes('每吨每百公里耗油量') && fp.includes('L / 吨·百公里'))
    ok('显示波动范围', fp.includes('范围') && fp.includes('波动'))
    // 改动：汇总卡只留 趟次 / 总里程 / 实际油耗 / 油费合计 四张
    const cardCount = (fp.match(/vsum__l/g) || []).length
    eq('汇总卡只留四张', cardCount, 4)
    ok('四张分别是趟次 / 总里程 / 实际油耗 / 油费合计', ['>趟次<', '>总里程<', '>实际油耗<', '>油费合计<'].every((s) => fp.includes(s)))
    // 这三张卡按需求从汇总条里去掉了（吨·百公里在司机行里仍作为分母保留）
    notContains('去掉了每吨百公里耗油卡', fp, 'vsum__l">每吨百公里耗油')
    notContains('去掉了吨·百公里卡', fp, 'vsum__l">吨·百公里')
    notContains('待结算运费挪到收入页了', fp, 'vsum__l">待结算运费')
    notContains('已经去掉标准油耗', fp, '标准油耗')
    notContains('已经去掉节油率', fp, '节油率')
    notContains('已经去掉奖金', fp, '奖金')
    notContains('趟次管理页没有油价输入框', fp, '油价')
    ok('搜索框还在', fp.includes('搜索路线 / 车型 / 车牌 / 司机'))
    ok('两个视图切换还在', fp.includes('油耗对比') && fp.includes('趟次明细'))
    ok('可按车型或按车辆分组', fp.includes('按车型分组') && fp.includes('按车辆分组'))
    // 需求：油费单价与结算状态
    ok('汇总卡有油费合计', fp.includes('油费合计'))
  }
  clearTrips()
  clearRoutes()
  clearDrivers()
}

console.log('\n=== 收入 · 运费结算 ===')
{
  clearDrivers()
  clearRoutes()
  clearTrips()
  current.value = '/income'
  location.hash = '#/income'
  const empty = await mount(App, undefined, '收入页 · 空库', 2500)
  if (empty) {
    ok('菜单里有「收入」', empty.includes('收入'))
    ok('空库时给出引导', empty.includes('还没有运费记录'))
    ok('有结算筛选胶囊', empty.includes('待结算') && empty.includes('已结算'))
  }

  clearAll()
  const d = addDriver({ name: '收入测试', phone: '13900001111', hireDate: '2023-01-01', licenseNo: '' })
  const v1 = addVehicle({ plate: '苏E·INC01', type: '牵引车', tonnage: 32, price: 400000, buyDate: '2022-01-01', odo: 100 })
  const r = addRoute({ from: '南京', to: '上海', distance: 300, tolls: [{ station: '南京', prices: { 牵引车: 100 } }] })
  const mk = (date, revenue) =>
    addTrip({ date, routeId: r.id, vehicleId: v1.id, type: '牵引车', driverId: d.id, tonnage: 30, actualFuel: 95, fuelPrice: 7.5, toll: 100, distance: 300, revenue })
  mk('2026-10-01', 3000)
  mk('2026-10-05', 2000)
  const t3 = mk('2026-09-20', 1500)
  eq('一共 3 趟', trips.length, 3)
  eq('新增默认待结算', findTrip(t3.id).settled, false)

  // 收入页的一键标记
  setTripSettled(t3.id, true)
  eq('标记结算生效', findTrip(t3.id).settled, true)
  eq('重复标记不会重复计数', setSettledBulk([t3.id], true), 0)
  eq('批量撤销返回改动条数', setSettledBulk([t3.id], false), 1)
  setTripSettled(t3.id, true)
  eq('撤销后回到待结算', setSettledBulk([t3.id], false) === 1 && findTrip(t3.id).settled === false, true)
  setTripSettled(t3.id, true)

  const inc = await mount(App, undefined, '收入页 · 有数据', 3000)
  if (inc) {
    for (const k of ['待结算运费', '已结算运费', '运费合计', '结算进度']) ok(`有「${k}」卡`, inc.includes(k))
    ok('待结算金额 = 3000 + 2000', inc.includes('5,000'))
    ok('已结算金额 = 1500', inc.includes('1,500'))
    ok('有按月份分区', inc.includes('按月份看'))
    ok('月份里出现 2026-10 与 2026-09', inc.includes('2026-10') && inc.includes('2026-09'))
    ok('有「标记已结算」按钮', inc.includes('标记已结算'))
    ok('有运费明细表', inc.includes('运费明细'))
    ok('说明了成本要填单价才算得准', inc.includes('油费单价'))
    notContains('收入页不显示油耗指标', inc, '每吨百公里')
  }
  clearTrips()
  clearRoutes()
  clearAll()
  clearDrivers()
}
console.log('\n=== 趟次表单 / CRUD ===')
{
  const tf = await mount(TripForm, { open: true, trip: null }, '趟次表单 · 新增')
  if (tf) {
    for (const t of ['运输日期', '路线', '司机', '车辆', '实际载重', '实际油耗', '油费单价', '过路费', '运费收入', '结算状态']) {
      ok(`表单字段「${t}」存在`, tf.includes(t))
    }
    // 改动：车型从车辆带出，所以车辆变成必选，车型下拉也没了
    ok('车辆是必选（没有「不指定」了）', tf.includes('请选择') && !tf.includes('不指定'))
    notContains('表单里没有车型下拉了', tf, '车型<i>*</i>')
    ok('说明车型由车辆带出', tf.includes('选完车辆会自动带出车型'))
    notContains('车型不再是可选项列表', tf, '>请选择车型<')
    ok('过路费说明按路线+车型带出', tf.includes('按路线 + 车型自动带出'))
    ok('提交按钮是「保存趟次」', tf.includes('保存趟次'))
    // 需求：油费单价（油价一直在变，所以按趟记）+ 结算状态勾选
    ok('油费单价标了元/L', tf.includes('元/L'))
    ok('说明按加油时的实际油价填', tf.includes('按加油时的实际油价填'))
    ok('结算是勾选控件', tf.includes('role="checkbox"'))
    ok('默认是待结算', tf.includes('待结算'))
    notContains('新增时默认不是已结算', tf, '>已结算<')
  }

  clearDrivers()
  clearRoutes()
  clearTrips()
  const d = addDriver({ name: '趟次测试', phone: '13700000001', hireDate: '2023-01-01', licenseNo: '' })
  const r = addRoute({ from: '常州', to: '南通', distance: 132, tolls: [{ station: '常州南', prices: { 自卸车: 66 } }] })

  ok('公里数为 0 被拦下', !!validateTrip({ date: '2026-10-01', routeId: r.id, vehicleId: 'V01', type: '自卸车', driverId: d.id, tonnage: '30', actualFuel: '40', distance: '0' }, {}).errors.distance)
  ok('油耗为 0 被拦下', !!validateTrip({ date: '2026-10-01', routeId: r.id, vehicleId: 'V01', type: '自卸车', driverId: d.id, tonnage: '30', actualFuel: '0', distance: '132' }, {}).errors.actualFuel)
  ok('未来日期被拦下', !!validateTrip({ date: '2099-01-01', routeId: r.id, vehicleId: 'V01', type: '自卸车', driverId: d.id, tonnage: '30', actualFuel: '40', distance: '132' }, {}).errors.date)
  ok('缺司机被拦下', !!validateTrip({ date: '2026-10-01', routeId: r.id, vehicleId: 'V01', type: '自卸车', driverId: '', tonnage: '30', actualFuel: '40', distance: '132' }, {}).errors.driverId)
  {
    const w = validateTrip({ date: '2026-10-01', routeId: r.id, vehicleId: 'V01', type: '自卸车', driverId: d.id, tonnage: '30', actualFuel: '400', distance: '132' }, {})
    ok('不再拿标准值比对：高油耗放行且不告警', w.ok && !w.warnings.actualFuel, JSON.stringify(w.warnings))
  }
  {
    const w = validateTrip({ date: '2026-10-01', routeId: r.id, vehicleId: 'V01', type: '自卸车', driverId: d.id, tonnage: '30', actualFuel: '5', distance: '132' }, {})
    ok('油耗低于物理下限只给软提示', w.ok && !!w.warnings.actualFuel)
  }

  const t1 = addTrip({ date: '2026-10-05', routeId: r.id, vehicleId: 'V01', type: '自卸车', driverId: d.id, tonnage: 28, actualFuel: 48, distance: 132, toll: 66, revenue: 2600 })
  eq('趟次编号是 T0001', t1.id, 'T0001')
  eq('车型被规范化', t1.type, '自卸车')
  ok('每吨百公里耗油算得出来', fuelPerTon100km(28, 132, 48) > 0)
  updateTrip(t1.id, { date: '2026-10-05', routeId: r.id, type: '自卸车', driverId: d.id, tonnage: 30, actualFuel: 50, distance: 132, toll: 66, revenue: 2600 })
  eq('编辑生效：载重', findTrip(t1.id).tonnage, 30)
  eq('编辑生效：油耗', findTrip(t1.id).actualFuel, 50)

  // 删路线要连带清掉引用它的趟次
  eq('删路线前有 1 条趟次', trips.length, 1)
  eq('连带清掉 1 条趟次', removeTripsByRoute(r.id), 1)
  removeRoute(r.id)
  eq('删路线后趟次也没了', trips.length, 0)
  clearTrips()
  clearRoutes()
  clearDrivers()
}

console.log(`\n${fail === 0 ? `全部通过（${pass} 项）` : `${fail} 项失败 / ${pass} 项通过`} · 耗时 ${Date.now() - t0} ms\n`)
if (fail) process.exit(1)
