<script setup>
/**
 * 车辆档案：列表 + 录入 / 编辑 + 批量导入 + 单台删除
 * ------------------------------------------------------------
 * 桌面端渲染表格、移动端渲染卡片列表 —— 两套 DOM 各自排版，
 * 而不是把表格硬压成卡片，这样手机上不会横向滚动、也不会挤成一团。
 * 数据源是 store/vehicles.js（唯一来源，写入 sessionStorage）。
 *
 * 前台不展示车编号（它由系统分配、对用户没有意义）；
 * 搜索只按车牌号和车类型。
 */
import { computed, ref } from 'vue'
import VehicleForm from '../components/VehicleForm.vue'
import VehicleImport from '../components/VehicleImport.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Icon from '../components/Icon.vue'
import Chips from '../components/Chips.vue'
import { CAR_TYPES, STATUS, TODAY } from '../data/vehicles.js'
import {
  vehicles, addVehicle, updateVehicle, removeVehicle,
} from '../store/vehicles.js'
import { FIELDS } from '../utils/vehicleRules.js'
import { depreciation } from '../utils/depreciation.js'
import { num, scaleMoney } from '../utils/format.js'

/* ---------------- 状态 ---------------- */
const q = ref('')
const typeFilter = ref('all')
const sortKey = ref('created')
const sortDir = ref('desc')
const formOpen = ref(false)
const importOpen = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)
const toast = ref('')
let toastTimer = 0

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

/* ---------------- 汇总 ---------------- */
const summary = computed(() => {
  const n = vehicles.length || 1
  const tonnage = vehicles.reduce((a, v) => a + (Number(v.tonnage) || 0), 0)
  const price = vehicles.reduce((a, v) => a + (Number(v.price) || 0), 0)
  const odo = vehicles.reduce((a, v) => a + (Number(v.odo) || 0), 0)
  const deps = vehicles.map((v) => depreciation(v.price, v.buyDate))
  const monthly = deps.reduce((a, d) => a + d.monthly, 0)
  const ages = deps.filter((d) => d.monthsUsed > 0).map((d) => d.ageYears)
  return {
    count: vehicles.length,
    tonnage,
    price,
    odo,
    monthly,
    running: vehicles.filter((v) => v.status === 'run').length,
    avgPrice: price / n,
    avgAge: ages.length ? ages.reduce((a, x) => a + x, 0) / ages.length : 0,
    fullyDepreciated: deps.filter((d) => d.fully).length,
  }
})

const typeChips = computed(() => {
  const base = [{ key: 'all', name: '全部', count: vehicles.length }]
  return base.concat(
    CAR_TYPES.map((t) => ({ key: t, name: t, count: vehicles.filter((v) => v.type === t).length }))
      .filter((c) => c.count > 0)
  )
})

/* ---------------- 列表 ---------------- */
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else {
    sortKey.value = k
    sortDir.value = 'desc'
  }
}

const rows = computed(() => {  // 只按车牌号和车类型搜索
  const kw = q.value.trim().toLowerCase()
  const list = vehicles.filter((v) => {
    if (typeFilter.value !== 'all' && v.type !== typeFilter.value) return false
    if (!kw) return true
    return v.plate.toLowerCase().includes(kw) || v.type.toLowerCase().includes(kw)
  })
  const k = sortKey.value
  const dir = sortDir.value === 'desc' ? -1 : 1
  return list.slice().sort((a, b) => {
    if (k === 'created') return 0
    const x = a[k]
    const y = b[k]
    if (typeof x === 'string') return String(x).localeCompare(String(y), 'zh') * dir
    return ((Number(x) || 0) - (Number(y) || 0)) * dir
  })
})

/** 每台车的折旧指标，列表里直接用 */
const depOf = (v) => depreciation(v.price, v.buyDate)

/* ---------------- 按车型分组 ---------------- */
/** 相同车型归到一组：同类型车放一起才好横向看，也不至于在长列表里翻来翻去 */
const groupMode = ref('type') // type | none

const displayGroups = computed(() => {
  if (groupMode.value !== 'type') return [{ type: '', list: rows.value, tonnage: 0, monthly: 0 }]
  const map = new Map()
  for (const v of rows.value) {
    if (!map.has(v.type)) map.set(v.type, [])
    map.get(v.type).push(v)
  }
  // 先按基准表顺序，自定义车型按名称排在后面
  const known = CAR_TYPES.filter((t) => map.has(t))
  const rest = [...map.keys()].filter((t) => !CAR_TYPES.includes(t)).sort((a, b) => a.localeCompare(b, 'zh'))
  return [...known, ...rest].map((t) => {
    const list = map.get(t)
    return {
      type: t,
      list,
      tonnage: list.reduce((a, v) => a + (Number(v.tonnage) || 0), 0),
      monthly: list.reduce((a, v) => a + depreciation(v.price, v.buyDate).monthly, 0),
    }
  })
})

/* ---------------- 增改删 ---------------- */
function openNew() {
  editing.value = null
  formOpen.value = true
}
function openEdit(v) {
  editing.value = v
  formOpen.value = true
}
function onSaved(payload) {
  if (editing.value) {
    updateVehicle(editing.value.id, payload)
    showToast(`已保存 ${payload.plate} 的修改`)
  } else {
    addVehicle(payload)
    showToast(`已录入车辆 ${payload.plate}`)
  }
  formOpen.value = false
}

/** 删除：先弹二次确认，确认后才真的删 */
function askDelete(v) {
  pendingDelete.value = v
}
function confirmDelete() {
  const v = pendingDelete.value
  if (!v) return
  removeVehicle(v.id)
  pendingDelete.value = null
  showToast(`已删除 ${v.plate}`)
}
const deleteMessage = computed(() => {
  const v = pendingDelete.value
  if (!v) return ''
  return `将删除 ${v.plate}（${v.type}）的全部档案信息。`
})
const deleteDetail = computed(() => {
  const v = pendingDelete.value
  if (!v) return ''
  return `购置价格 ¥${num(v.price)} · 累计里程 ${num(v.odo)} km · 此操作不可撤销`
})
function onImported(res) {
  importOpen.value = false
  const extra = res.errors ? `，忽略 ${res.errors} 行错误` : ''
  showToast(`导入完成：新增 ${res.add} 台，替换 ${res.update} 台${extra}`)
}

/* ---------------- 显示 ---------------- */
const priceText = computed(() => {
  const s = scaleMoney(summary.value.price)
  return `${num(s.value, s.d)} ${s.unit}`
})
const monthlyText = computed(() => {
  const s = scaleMoney(summary.value.monthly)
  return `${num(s.value, s.d)} ${s.unit}`
})
const avgPriceText = computed(() => {
  const s = scaleMoney(summary.value.avgPrice)
  return `${num(s.value, s.d)} ${s.unit}`
})
const COL = Object.fromEntries(FIELDS.map((f) => [f.key, f]))
</script>

<template>
  <div class="stack">
    <!-- 标题 -->
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">车辆档案</h1>
        <div class="page-head__desc">
          共 {{ summary.count }} 台在册 · 在途 {{ summary.running }} 台 ·
          {{ TODAY.getFullYear() }} 年 {{ TODAY.getMonth() + 1 }} 月 {{ TODAY.getDate() }} 日
        </div>
      </div>
      <div class="head-actions">
        <button class="btn btn--ghost" @click="importOpen = true">
          <Icon name="download" :size="15" />批量导入
        </button>
        <button class="btn btn--primary" @click="openNew">
          <Icon name="plus" :size="15" :sw="2.4" />录入车辆
        </button>
      </div>
    </div>

    <!-- 汇总条 -->
    <div class="grid grid--kpi">
      <div class="vsum reveal" style="--d: 0ms">
        <div class="vsum__l">车辆总数</div>
        <div class="vsum__v">{{ summary.count }}<small>台</small></div>
        <div class="vsum__s">合计载重 {{ num(summary.tonnage, 1) }} 吨</div>
      </div>
      <div class="vsum reveal" style="--d: 50ms">
        <div class="vsum__l">合计购置金额</div>
        <div class="vsum__v">{{ priceText }}</div>
        <div class="vsum__s">平均 {{ avgPriceText }} / 台</div>
      </div>
      <div class="vsum reveal" style="--d: 100ms">
        <div class="vsum__l">月折旧合计</div>
        <div class="vsum__v">{{ monthlyText }}</div>
        <div class="vsum__s">
          年折旧 {{ num(Math.round(summary.monthly * 12 / 10000), 1) }} 万元 · 5 年直线法
        </div>
      </div>
      <div class="vsum reveal" style="--d: 150ms">
        <div class="vsum__l">平均车龄</div>
        <div class="vsum__v">{{ summary.avgAge.toFixed(1) }}<small>年</small></div>
        <div class="vsum__s">
          <template v-if="summary.fullyDepreciated">已提足折旧 {{ summary.fullyDepreciated }} 台</template>
          <template v-else>累计总里程 {{ num(Math.round(summary.odo / 10000)) }} 万 km</template>
        </div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="card">
      <div class="card__bd" style="padding: 14px 16px">
        <div class="vsearch">
          <Icon name="search" :size="15" />
          <input v-model="q" class="input" placeholder="搜索车牌号 / 车类型" />
          <button v-if="q" class="vsearch__x" aria-label="清空" @click="q = ''">
            <Icon name="close" :size="13" :sw="2.2" />
          </button>
        </div>
        <div class="mt10">
          <Chips v-model="typeFilter" :options="typeChips" />
        </div>
        <div class="mt10">
          <Chips
            v-model="groupMode"
            :options="[{ key: 'type', name: '按车型分组' }, { key: 'none', name: '不分组' }]"
          />
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="card card--clip">
      <div class="card__hd">
        <div class="card__title"><Icon name="truck" :size="15" />车辆列表</div>
        <div class="card__sub spacer">
          {{ rows.length }} / {{ summary.count }} 台
          <template v-if="groupMode === 'type' && displayGroups.length"> · {{ displayGroups.length }} 个车型</template>
        </div>
      </div>

      <template v-if="rows.length">
        <!-- 桌面：表格 -->
        <div class="tbl-wrap vonly-desktop">
          <table class="tbl" style="min-width: 860px">
            <thead>
              <tr>
                <th>{{ COL.plate.label }}</th>
                <th style="text-align: left">{{ COL.type.label }}</th>
                <th class="is-sortable" @click="toggleSort('tonnage')">
                  {{ COL.tonnage.label }} ({{ COL.tonnage.unit }})
                  <span v-if="sortKey === 'tonnage'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="is-sortable" @click="toggleSort('price')">
                  {{ COL.price.label }}
                  <span v-if="sortKey === 'price'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="is-sortable" @click="toggleSort('buyDate')">
                  {{ COL.buyDate.label }}
                  <span v-if="sortKey === 'buyDate'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="is-sortable" @click="toggleSort('odo')">
                  {{ COL.odo.label }}
                  <span v-if="sortKey === 'odo'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th style="width: 150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="grp in displayGroups" :key="grp.type || '__all__'">
                <tr v-if="groupMode === 'type'" class="grouprow">
                  <td colspan="7">
                    <span class="grouprow__t">{{ grp.type }}</span>
                    <span class="grouprow__m">
                      {{ grp.list.length }} 台 · 合计载重 {{ num(grp.tonnage, 1) }} 吨 · 月折旧
                      ¥{{ num(Math.round(grp.monthly)) }}
                    </span>
                  </td>
                </tr>
                <tr v-for="v in grp.list" :key="v.id">
                  <td>
                    <div class="row" style="gap: 8px">
                      <span class="plate">{{ v.plate }}</span>
                      <span class="pill" :class="STATUS[v.status]?.pill || 'pill--idle'">
                        <i class="pill__dot" />{{ STATUS[v.status]?.name || '—' }}
                      </span>
                    </div>
                  </td>
                  <td style="text-align: left"><span class="vtype">{{ v.type }}</span></td>
                  <td class="num strong">{{ num(v.tonnage, 1) }}</td>
                  <td class="num strong">¥{{ num(v.price) }}</td>
                  <td>
                    <div class="num strong">{{ v.buyDate || '—' }}</div>
                    <div class="tbl__sub">
                      车龄 {{ depOf(v).ageYears }} 年<template v-if="depOf(v).fully"> · 已提足</template>
                    </div>
                  </td>
                  <td class="num strong">{{ num(v.odo) }}</td>
                  <td>
                    <div class="rowacts">
                      <button class="btn btn--ghost btn--sm" @click="openEdit(v)">
                        <Icon name="wrench" :size="12" />编辑
                      </button>
                      <button class="btn btn--danger btn--sm" @click="askDelete(v)">
                        <Icon name="close" :size="12" :sw="2.2" />删除
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 移动：卡片列表 -->
        <div class="vonly-mobile">
          <template v-for="grp in displayGroups" :key="grp.type || '__all__'">
            <div v-if="groupMode === 'type'" class="mgroup">
              <span class="mgroup__t">{{ grp.type }}</span>
              <span class="mgroup__m">{{ grp.list.length }} 台 · 合计 {{ num(grp.tonnage, 1) }} 吨</span>
            </div>
            <div v-for="v in grp.list" :key="v.id" class="vcard">
            <div class="vcard__hd">
              <span class="plate">{{ v.plate }}</span>
              <span class="vtype">{{ v.type }}</span>
              <span class="pill" :class="STATUS[v.status]?.pill || 'pill--idle'">
                <i class="pill__dot" />{{ STATUS[v.status]?.name || '—' }}
              </span>
            </div>
            <dl class="vcard__kv">
              <div><dt>{{ COL.tonnage.label }}</dt><dd>{{ num(v.tonnage, 1) }} 吨</dd></div>
              <div><dt>{{ COL.price.label }}</dt><dd>¥{{ num(v.price) }}</dd></div>
              <div><dt>{{ COL.buyDate.label }}</dt><dd>{{ v.buyDate || '—' }}</dd></div>
              <div><dt>车龄</dt><dd>{{ depOf(v).ageYears }} 年</dd></div>
              <div><dt>{{ COL.odo.label }}</dt><dd>{{ num(v.odo) }} km</dd></div>
              <div><dt>月折旧</dt><dd>¥{{ num(depOf(v).monthly) }}</dd></div>
            </dl>
            <div class="vcard__acts">
              <button class="btn btn--ghost btn--sm flex1" @click="openEdit(v)">
                <Icon name="wrench" :size="13" />编辑
              </button>
              <button class="btn btn--danger btn--sm flex1" @click="askDelete(v)">
                <Icon name="close" :size="13" :sw="2.2" />删除
              </button>
            </div>
            </div>
          </template>
        </div>
      </template>

      <div v-else class="empty">
        <div class="empty__ico"><Icon name="truck" :size="24" /></div>
        <div class="empty__t">{{ q || typeFilter !== 'all' ? '没有匹配的车辆' : '还没有车辆数据' }}</div>
        <div class="empty__d">
          {{ q || typeFilter !== 'all' ? '换个车牌号或车类型试试，或清空筛选条件' : '上传 Excel 批量导入，或逐台录入' }}
        </div>
        <div class="empty__acts">
          <template v-if="q || typeFilter !== 'all'">
            <button class="btn btn--ghost btn--sm" @click="q = ''; typeFilter = 'all'">清空筛选</button>
          </template>
          <template v-else>
            <button class="btn btn--primary btn--sm" @click="importOpen = true">
              <Icon name="download" :size="13" />批量导入
            </button>
            <button class="btn btn--ghost btn--sm" @click="openNew">
              <Icon name="plus" :size="13" :sw="2.3" />录入车辆
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="note">
      <Icon name="info" :size="15" />
      <div>
        车辆数据存在浏览器的 <b>sessionStorage</b>：<b>刷新不会丢</b>，关闭标签页后自动清空。
        导入 / 录入都以<b>车牌号为主键</b> —— 相同的车牌会替换原来那台车，不同的车牌会新增一台。
        折旧按 <b>5 年直线法、残值 10%</b> 计提，提满后净值停在残值上。
      </div>
    </div>

    <!-- 录入 / 编辑 / 导入 / 删除确认 -->
    <VehicleForm
      :open="formOpen"
      :vehicle="editing"
      @close="formOpen = false"
      @saved="onSaved"
    />
    <VehicleImport :open="importOpen" @close="importOpen = false" @imported="onImported" />
    <ConfirmDialog
      :open="!!pendingDelete"
      title="确认删除这台车？"
      :message="deleteMessage"
      :detail="deleteDetail"
      confirm-text="删除"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />

    <!-- 轻提示 -->
    <Transition name="toast">
      <div v-if="toast" class="toast">
        <Icon name="check" :size="14" :sw="2.4" />{{ toast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* —— 汇总卡 —— */
.vsum {
  min-width: 0;
  padding: 14px 15px;
  border-radius: var(--r-lg);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--sh-1);
}
.vsum__l {
  font-size: 12px;
  color: var(--ink-2);
}
.vsum__v {
  margin-top: 7px;
  font-size: clamp(19px, 5.4vw, 25px);
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.vsum__v small {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-3);
  margin-left: 3px;
  letter-spacing: 0;
}
.vsum__s {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ink-3);
}

/* —— 搜索 —— */
.vsearch {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}
.vsearch > svg {
  position: absolute;
  left: 12px;
  color: var(--ink-4);
  pointer-events: none;
}
.vsearch .input {
  padding-left: 35px;
  padding-right: 34px;
}
.vsearch__x {
  position: absolute;
  right: 8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-3);
  background: var(--surface-3);
}
.vsearch__x:hover {
  color: var(--ink);
}

/* —— 列表零件 —— */
.vtype {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  font-weight: 550;
  background: var(--surface-3);
  color: var(--ink-2);
  white-space: nowrap;
}
.rowacts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

/* —— 桌面 / 移动两套列表 —— */
.vonly-desktop {
  display: none;
}
.vonly-mobile {
  display: block;
}
@media (min-width: 760px) {
  .vonly-desktop {
    display: block;
  }
  .vonly-mobile {
    display: none;
  }
}
.vcard {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.vcard:last-child {
  border-bottom: 0;
}
.vcard__hd {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex-wrap: wrap;
}
.vcard__kv {
  margin: 12px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}
.vcard__kv > div {
  min-width: 0;
}
.vcard__kv dt {
  font-size: 11.5px;
  color: var(--ink-3);
}
.vcard__kv dd {
  margin: 3px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.vcard__acts {
  margin-top: 13px;
  display: flex;
  gap: 8px;
}

/* —— 分组表头 —— */
.grouprow > td {
  padding: 9px 12px;
  background: var(--surface-2);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.grouprow__t {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}
.grouprow__m {
  margin-left: 10px;
  font-size: 11.5px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.mgroup {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 16px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.mgroup__t {
  font-size: 12.5px;
  font-weight: 700;
}
.mgroup__m {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
/* —— 轻提示 —— */
.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--tabbar-h) + var(--sab) + 18px);
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: var(--r-pill);
  background: #14171c;
  color: #fff;
  font-size: 13px;
  font-weight: 550;
  box-shadow: var(--sh-4);
  max-width: calc(100vw - 32px);
}
@media (min-width: 900px) {
  .toast {
    bottom: 28px;
  }
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
