<script setup>
/**
 * 司机管理：列表 + 录入 / 编辑 + 批量导入 + 单台删除
 * ------------------------------------------------------------
 * 三个「自动统计」字段（当月创收 / 里程 / 油耗电耗）目前显示「—」，
 * 因为它们要由运营流水汇总，而运单/调度模块还没做 ——
 * 汇总逻辑已经写好（store/driverOps.js），只是数据源是空的。
 * 一旦有了数据，这里一行都不用改。
 *
 * 桌面表格、移动卡片两套 DOM，和车辆模块保持一致。
 */
import { computed, ref } from 'vue'
import DriverForm from '../components/DriverForm.vue'
import DriverImport from '../components/DriverImport.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Icon from '../components/Icon.vue'
import {
  drivers, addDriver, updateDriver, removeDriver, incidentSummary,
} from '../store/drivers.js'
import { monthlyStats, formatEnergy, hasOpsData, monthKey } from '../store/driverOps.js'
import { formatPhone } from '../utils/driverRules.js'
import { monthsBetween, parseDate } from '../utils/date.js'
import { num, scaleMoney, yuan } from '../utils/format.js'

/* ---------------- 状态 ---------------- */
const q = ref('')
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

/** 工龄（年） */
function tenure(d) {
  const s = parseDate(d.hireDate)
  if (!s) return null
  return Math.round((monthsBetween(s, new Date()) / 12) * 10) / 10
}

/* ---------------- 当月运营统计（数据源为空时返回 null） ---------------- */
const statsMap = computed(() => {
  const m = new Map()
  for (const d of drivers) m.set(d.id, monthlyStats(d.id))
  return m
})
const st = (d) => statsMap.value.get(d.id) || null

/* ---------------- 汇总 ---------------- */
const summary = computed(() => {
  let revenue = 0
  let mileage = 0
  let hasStats = false
  let incCount = 0
  let incLoss = 0
  for (const d of drivers) {
    const s = monthlyStats(d.id)
    if (s) {
      hasStats = true
      revenue += s.revenue
      mileage += s.mileage
    }
    const is = incidentSummary(d)
    incCount += is.count
    incLoss += is.loss
  }
  return {
    count: drivers.length,
    revenue,
    mileage,
    hasStats,
    incCount,
    incLoss,
    withLicense: drivers.filter((d) => d.licenseNo).length,
    salaryTotal: drivers.reduce((a, d) => a + (Number(d.salary) || 0), 0),
    salaryCount: drivers.filter((d) => Number(d.salary) > 0).length,
  }
})

/* ---------------- 列表 ---------------- */
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else {
    sortKey.value = k
    sortDir.value = 'desc'
  }
}

const rows = computed(() => {
  // 只按姓名和手机号搜索
  const kw = q.value.trim().toLowerCase()
  const list = drivers.filter((d) => {
    if (!kw) return true
    return d.name.toLowerCase().includes(kw) || d.phone.includes(kw)
  })
  const k = sortKey.value
  const dir = sortDir.value === 'desc' ? -1 : 1
  return list.slice().sort((a, b) => {
    if (k === 'created') return 0
    if (k === 'incident') return (incidentSummary(a).count - incidentSummary(b).count) * dir
    const x = a[k]
    const y = b[k]
    if (typeof x === 'string') return String(x).localeCompare(String(y), 'zh') * dir
    return ((Number(x) || 0) - (Number(y) || 0)) * dir
  })
})

/* ---------------- 增改删 ---------------- */
function openNew() {
  editing.value = null
  formOpen.value = true
}
function openEdit(d) {
  editing.value = d
  formOpen.value = true
}
function onSaved(payload) {
  if (editing.value) {
    updateDriver(editing.value.id, payload)
    showToast(`已保存 ${payload.name} 的修改`)
  } else {
    addDriver(payload)
    showToast(`已录入司机 ${payload.name}`)
  }
  formOpen.value = false
}

function askDelete(d) {
  pendingDelete.value = d
}
function confirmDelete() {
  const d = pendingDelete.value
  if (!d) return
  removeDriver(d.id)
  pendingDelete.value = null
  showToast(`已删除 ${d.name}`)
}
const deleteMessage = computed(() => {
  const d = pendingDelete.value
  return d ? `将删除 ${d.name}（${formatPhone(d.phone)}）的全部档案信息。` : ''
})
const deleteDetail = computed(() => {
  const d = pendingDelete.value
  if (!d) return ''
  const is = incidentSummary(d)
  const inc = is.count ? ` · 含 ${is.count} 条事故违章记录` : ''
  return `入职 ${d.hireDate || '—'}${inc} · 此操作不可撤销`
})

function onImported(res) {
  importOpen.value = false
  const extra = res.errors ? `，忽略 ${res.errors} 行错误` : ''
  showToast(`导入完成：新增 ${res.add} 位，替换 ${res.update} 位${extra}`)
}

/* ---------------- 显示 ---------------- */
const money = (v) => {
  const s = scaleMoney(v)
  return `${num(s.value, s.d)} ${s.unit}`
}
const monthLabel = computed(() => {
  const m = monthKey()
  return `${Number(m.slice(5))} 月`
})
</script>

<template>
  <div class="stack">
    <!-- 标题 -->
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">司机管理</h1>
        <div class="page-head__desc">
          共 {{ summary.count }} 位在册 · 已登记驾驶证 {{ summary.withLicense }} 位 ·
          运营统计口径：{{ monthLabel }}
        </div>
      </div>
      <div class="head-actions">
        <button class="btn btn--ghost" @click="importOpen = true">
          <Icon name="download" :size="15" />批量导入
        </button>
        <button class="btn btn--primary" @click="openNew">
          <Icon name="plus" :size="15" :sw="2.4" />录入司机
        </button>
      </div>
    </div>

    <!-- 汇总条 -->
    <div class="grid grid--kpi">
      <div class="vsum reveal" style="--d: 0ms">
        <div class="vsum__l">司机总数</div>
        <div class="vsum__v">{{ summary.count }}<small>位</small></div>
        <div class="vsum__s">驾驶证未登记 {{ summary.count - summary.withLicense }} 位</div>
      </div>
      <div class="vsum reveal" style="--d: 50ms">
        <div class="vsum__l">{{ monthLabel }}创收合计</div>
        <div class="vsum__v" :class="{ 'is-placeholder': !summary.hasStats }">
          {{ summary.hasStats ? money(summary.revenue) : '—' }}
        </div>
        <div class="vsum__s">{{ summary.hasStats ? '按月自动汇总' : '待接入运营数据' }}</div>
      </div>
      <div class="vsum reveal" style="--d: 100ms">
        <div class="vsum__l">{{ monthLabel }}里程合计</div>
        <div class="vsum__v" :class="{ 'is-placeholder': !summary.hasStats }">
          {{ summary.hasStats ? num(summary.mileage) + ' km' : '—' }}
        </div>
        <div class="vsum__s">{{ summary.hasStats ? '按月自动汇总' : '待接入运营数据' }}</div>
      </div>
      <div class="vsum reveal" style="--d: 150ms">
        <div class="vsum__l">事故 / 违章</div>
        <div class="vsum__v">{{ summary.incCount }}<small>次</small></div>
        <div class="vsum__s">累计经济损失 {{ yuan(summary.incLoss) }}</div>
      </div>
      <div class="vsum reveal" style="--d: 200ms">
        <div class="vsum__l">月工资合计</div>
        <div class="vsum__v" :class="{ 'is-placeholder': !summary.salaryCount }">
          {{ summary.salaryCount ? money(summary.salaryTotal) : '—' }}
        </div>
        <div class="vsum__s">
          {{ summary.salaryCount ? `${summary.salaryCount} 位已填 · 人均 ${money(summary.salaryTotal / summary.salaryCount)}` : '还没录入工资' }}
        </div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="card">
      <div class="card__bd" style="padding: 14px 16px">
        <div class="vsearch">
          <Icon name="search" :size="15" />
          <input v-model="q" class="input" placeholder="搜索姓名 / 手机号" />
          <button v-if="q" class="vsearch__x" aria-label="清空" @click="q = ''">
            <Icon name="close" :size="13" :sw="2.2" />
          </button>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="card card--clip">
      <div class="card__hd">
        <div class="card__title"><Icon name="driver" :size="15" />司机列表</div>
        <div class="card__sub spacer">{{ rows.length }} / {{ summary.count }} 位</div>
      </div>

      <template v-if="rows.length">
        <!-- 桌面：表格 -->
        <div class="tbl-wrap vonly-desktop">
          <table class="tbl" style="min-width: 1020px">
            <thead>
              <tr>
                <th>姓名</th>
                <th style="text-align: left">手机号</th>
                <th class="is-sortable" @click="toggleSort('hireDate')">
                  入职日期<span v-if="sortKey === 'hireDate'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th>驾驶证号</th>
                <th class="is-sortable" @click="toggleSort('salary')">
                  月工资<span v-if="sortKey === 'salary'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="is-auto">
                  当月创收<span class="auto-tag">自动</span>
                </th>
                <th class="is-auto">
                  当月里程<span class="auto-tag">自动</span>
                </th>
                <th class="is-auto">
                  当月油耗/电耗<span class="auto-tag">自动</span>
                </th>
                <th class="is-sortable" @click="toggleSort('incident')">
                  事故违章<span v-if="sortKey === 'incident'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th style="width: 150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in rows" :key="d.id">
                <td>
                  <div class="row" style="gap: 8px">
                    <span class="dname">{{ d.name }}</span>
                  </div>
                </td>
                <td style="text-align: left" class="num">{{ formatPhone(d.phone) }}</td>
                <td>
                  <div class="num strong">{{ d.hireDate || '—' }}</div>
                  <div class="tbl__sub">工龄 {{ tenure(d) ?? '—' }} 年</div>
                </td>
                <td class="num">{{ d.licenseNo || '—' }}</td>
                <td class="num strong">{{ d.salary ? '¥' + num(d.salary) : '—' }}</td>
                <td class="num">{{ st(d) ? yuan(st(d).revenue) : '—' }}</td>
                <td class="num">{{ st(d) ? num(st(d).mileage) + ' km' : '—' }}</td>
                <td class="num">{{ st(d) ? formatEnergy(st(d).energy) : '—' }}</td>
                <td>
                  <span v-if="incidentSummary(d).count" class="pill pill--warn">
                    {{ incidentSummary(d).count }} 次 · {{ yuan(incidentSummary(d).loss) }}
                  </span>
                  <span v-else class="muted">无</span>
                </td>
                <td>
                  <div class="rowacts">
                    <button class="btn btn--ghost btn--sm" @click="openEdit(d)">
                      <Icon name="wrench" :size="12" />编辑
                    </button>
                    <button class="btn btn--danger btn--sm" @click="askDelete(d)">
                      <Icon name="close" :size="12" :sw="2.2" />删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 移动：卡片列表 -->
        <div class="vonly-mobile">
          <div v-for="d in rows" :key="d.id" class="vcard">
            <div class="vcard__hd">
              <span class="dname">{{ d.name }}</span>
              <span v-if="incidentSummary(d).count" class="pill pill--warn">
                {{ incidentSummary(d).count }} 次违章/事故
              </span>
            </div>
            <dl class="vcard__kv">
              <div><dt>手机号</dt><dd>{{ formatPhone(d.phone) }}</dd></div>
              <div><dt>入职日期</dt><dd>{{ d.hireDate || '—' }}</dd></div>
              <div><dt>工龄</dt><dd>{{ tenure(d) ?? '—' }} 年</dd></div>
              <div><dt>驾驶证号</dt><dd>{{ d.licenseNo || '—' }}</dd></div>
              <div><dt>月工资</dt><dd>{{ d.salary ? '¥' + num(d.salary) : '—' }}</dd></div>
              <div><dt>当月创收</dt><dd>{{ st(d) ? yuan(st(d).revenue) : '—' }}</dd></div>
              <div><dt>当月里程</dt><dd>{{ st(d) ? num(st(d).mileage) + ' km' : '—' }}</dd></div>
              <div><dt>当月油耗/电耗</dt><dd>{{ st(d) ? formatEnergy(st(d).energy) : '—' }}</dd></div>
              <div><dt>经济损失</dt><dd>{{ yuan(incidentSummary(d).loss) }}</dd></div>
            </dl>
            <div class="vcard__acts">
              <button class="btn btn--ghost btn--sm flex1" @click="openEdit(d)">
                <Icon name="wrench" :size="13" />编辑
              </button>
              <button class="btn btn--danger btn--sm flex1" @click="askDelete(d)">
                <Icon name="close" :size="13" :sw="2.2" />删除
              </button>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="empty">
        <div class="empty__ico"><Icon name="driver" :size="24" /></div>
        <div class="empty__t">{{ q ? '没有匹配的司机' : '还没有司机数据' }}</div>
        <div class="empty__d">
          {{ q ? '换个姓名或手机号试试' : '上传 Excel 批量导入，或逐位录入' }}
        </div>
        <div class="empty__acts">
          <template v-if="q">
            <button class="btn btn--ghost btn--sm" @click="q = ''">清空搜索</button>
          </template>
          <template v-else>
            <button class="btn btn--primary btn--sm" @click="importOpen = true">
              <Icon name="download" :size="13" />批量导入
            </button>
            <button class="btn btn--ghost btn--sm" @click="openNew">
              <Icon name="plus" :size="13" :sw="2.3" />录入司机
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="note">
      <Icon name="info" :size="15" />
      <div>
        司机数据存在 <b>sessionStorage</b>：刷新不丢，关闭标签页后自动清空。
        导入 / 录入都以<b>手机号为主键</b> —— 相同手机号替换、不同手机号新增。
        <br />
        <b>当月创收 / 里程 / 油耗电耗</b>是自动统计字段，需要运营流水（运单 / 调度）才能算出来，
        目前显示「—」；汇总逻辑已经写好，接入后自动填充。
        <b>事故 / 违章</b>是手工记录，在司机编辑弹窗里逐条添加，不参与导入。
      </div>
    </div>

    <!-- 录入 / 编辑 / 导入 / 删除确认 -->
    <DriverForm :open="formOpen" :driver="editing" @close="formOpen = false" @saved="onSaved" />
    <DriverImport :open="importOpen" @close="importOpen = false" @imported="onImported" />
    <ConfirmDialog
      :open="!!pendingDelete"
      title="确认删除这位司机？"
      :message="deleteMessage"
      :detail="deleteDetail"
      confirm-text="删除"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />

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
.vsum__v.is-placeholder {
  color: var(--ink-4);
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
.dname {
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ink);
  white-space: nowrap;
}
.auto-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 600;
  font-style: normal;
  color: var(--ink-3);
  background: var(--surface-3);
  vertical-align: 1px;
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
  gap: 8px;
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
