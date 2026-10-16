<script setup>
/**
 * 收入 · 运费结算
 * ------------------------------------------------------------
 * 只关心钱：哪些运费还没收到、压在哪个月、谁跑的。
 * 结算状态在「趟次管理」里录入，这里可以**一键标记已结算 / 撤销**，
 * 不用为了改一个勾选去打开整张趟次表单。
 */
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import Chips from '../components/Chips.vue'
import MonthPicker from '../components/MonthPicker.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { trips, setTripSettled, removeTrip } from '../store/trips.js'
import { findRoute } from '../store/routes.js'
import { findDriver } from '../store/drivers.js'
import { findVehicle } from '../store/vehicles.js'
import { tripCost } from '../utils/tripRules.js'
import { monthOf } from '../utils/costModel.js'
import { query, setQuery } from '../router.js'
import { num, yuan } from '../utils/format.js'

/** 默认只看待结算 —— 这个页面的意义就是盯没收到的钱 */
const filter = ref('unsettled') // unsettled | settled | all
/**
 * 月份：默认「全部」，也写进 hash 可以深链接（比如书签「这个月还差多少没收」）。
 * 收账时最关心的是「一共还差多少没收」，所以默认给全量；
 * 想按月对账时再挑具体月份。
 */
const month = ref(query('month') || 'all')
function setMonth(v) {
  month.value = v
  setQuery('month', v)
}
const q = ref('')
const pendingDelete = ref(null)
const toast = ref('')
let toastTimer = 0

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2400)
}

/* ---------------- 按月份限定范围 ---------------- */
const scoped = computed(() =>
  month.value === 'all' ? trips : trips.filter((t) => monthOf(t.date) === month.value)
)

/* ---------------- 每趟的钱 ---------------- */
const rows = computed(() =>
  scoped.value.map((t) => ({
    t,
    route: findRoute(t.routeId),
    driver: findDriver(t.driverId),
    vehicle: findVehicle(t.vehicleId),
    cost: tripCost(t),
  }))
)

/* ---------------- 汇总 ---------------- */
const summary = computed(() => {
  let unsettled = 0
  let settled = 0
  let cost = 0
  let unsettledCount = 0
  let settledCount = 0
  for (const r of rows.value) {
    const money = r.cost.revenue
    if (r.t.settled) {
      settled += money
      settledCount++
    } else {
      unsettled += money
      if (money > 0) unsettledCount++
    }
    cost += r.cost.cost
  }
  const total = unsettled + settled
  return {
    unsettled: Math.round(unsettled * 100) / 100,
    settled: Math.round(settled * 100) / 100,
    total: Math.round(total * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    profit: Math.round((total - cost) * 100) / 100,
    unsettledCount,
    settledCount,
    avg: unsettledCount ? Math.round((unsettled / unsettledCount) * 100) / 100 : 0,
  }
})

const cards = computed(() => {
  const s = summary.value
  return [
    {
      l: '待结算运费',
      v: s.unsettled ? '¥' + num(s.unsettled, 0) : s.unsettledCount ? '¥0' : '—',
      s: s.unsettledCount ? `${s.unsettledCount} 趟未收 · 平均 ¥${num(s.avg, 0)}/趟` : '没有未收的运费',
      tone: s.unsettledCount ? 'warn' : '',
    },
    {
      l: '已结算运费',
      v: s.settled ? '¥' + num(s.settled, 0) : '—',
      s: s.settledCount ? `${s.settledCount} 趟已收` : '还没有已结算的',
      tone: s.settled ? 'good' : '',
    },
    {
      l: '运费合计',
      v: s.total ? '¥' + num(s.total, 0) : '—',
      s: s.cost ? `成本 ¥${num(s.cost, 0)} · 毛利 ¥${num(s.profit, 0)}` : '成本要填油费单价与过路费',
    },
    {
      l: '结算进度',
      v: s.total ? ((s.settled / s.total) * 100).toFixed(0) : '—',
      u: s.total ? '%' : '',
      s: s.total ? `已收 ¥${num(s.settled, 0)} / 应收 ¥${num(s.total, 0)}` : '还没有趟次',
    },
  ]
})

/** 月份下拉用：所有出现过趟次的月份（不受当前选择影响，否则选完就回不去了） */
const months = computed(() => {
  const set = new Set()
  for (const t of trips) if (t.date) set.add(monthOf(t.date))
  return [...set].sort().reverse()
})

/* ---------------- 按月份看 ---------------- */
/** 始终基于**全部**趟次 —— 这是用来跳月份的导航，不该被当前选择过滤掉 */
const byMonth = computed(() => {
  const map = new Map()
  for (const t of trips) {
    const m = String(t.date).slice(0, 7) || '未知'
    if (!map.has(m)) map.set(m, { month: m, unsettled: 0, settled: 0, count: 0, unsettledCount: 0 })
    const g = map.get(m)
    const money = tripCost(t).revenue
    if (t.settled) g.settled += money
    else {
      g.unsettled += money
      if (money > 0) g.unsettledCount++
    }
    g.count++
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      unsettled: Math.round(g.unsettled * 100) / 100,
      settled: Math.round(g.settled * 100) / 100,
      total: Math.round((g.unsettled + g.settled) * 100) / 100,
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
})

/* ---------------- 明细 ---------------- */
const detail = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return rows.value
    .filter((r) => {
      if (!r.route) return false
      if (filter.value === 'unsettled' && r.t.settled) return false
      if (filter.value === 'settled' && !r.t.settled) return false
      if (!kw) return true
      return (
        `${r.route.from}${r.route.to}`.toLowerCase().includes(kw) ||
        (r.driver?.name || '').toLowerCase().includes(kw) ||
        (r.vehicle?.plate || '').toLowerCase().includes(kw)
      )
    })
    .sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0))
})

const detailTotal = computed(() => Math.round(detail.value.reduce((a, r) => a + r.cost.revenue, 0) * 100) / 100)

/* ---------------- 操作 ---------------- */
function toggleSettled(r) {
  const next = !r.t.settled
  setTripSettled(r.t.id, next)
  showToast(next ? `已标记 ${r.t.date} 这趟为已结算` : `已把 ${r.t.date} 这趟改回待结算`)
}

function askDelete(r) {
  pendingDelete.value = r
}
function confirmDelete() {
  const r = pendingDelete.value
  if (!r) return
  removeTrip(r.t.id)
  pendingDelete.value = null
  showToast('已删除该趟次')
}
const deleteMessage = computed(() => {
  const r = pendingDelete.value
  if (!r) return ''
  return `将删除 ${r.t.date} ${r.route ? r.route.from + ' → ' + r.route.to : ''} 的这趟记录。`
})
const deleteDetail = computed(() => {
  const r = pendingDelete.value
  return r ? `运费 ¥${num(r.cost.revenue)} · 此操作不可撤销` : ''
})

const routeText = (r) => (r ? `${r.from} → ${r.to}` : '（路线已删除）')
</script>

<template>
  <div class="stack">
    <!-- 标题 -->
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">收入 · 运费结算</h1>
        <div class="page-head__desc">
          待结算 {{ summary.unsettledCount }} 趟 · 已结算 {{ summary.settledCount }} 趟 ·
          运费在「趟次管理」里录入，这里只看钱
        </div>
      </div>
    </div>

    <!-- 汇总条 -->
    <div class="grid grid--kpi">
      <div v-for="(c, i) in cards" :key="c.l" class="vsum reveal" :style="{ '--d': i * 45 + 'ms' }">
        <div class="vsum__l">{{ c.l }}</div>
        <div class="vsum__v" :class="[c.tone ? 'is-' + c.tone : '', { 'is-placeholder': c.v === '—' }]">
          {{ c.v }}<small v-if="c.u">{{ c.u }}</small>
        </div>
        <div class="vsum__s">{{ c.s }}</div>
      </div>
    </div>

    <!-- 按月份：点一行就跳到那个月（看「全部」时才有意义，所以选中具体月份后收起） -->
    <div v-if="byMonth.length > 1 && month === 'all'" class="card">
      <div class="card__hd">
        <div class="card__title"><Icon name="calendar" :size="15" />按月份看</div>
        <div class="card__sub spacer">{{ byMonth.length }} 个月 · 点一行跳到那个月</div>
      </div>
      <div class="card__bd" style="padding: 0">
        <button
          v-for="m in byMonth"
          :key="m.month"
          type="button"
          class="mrow mrow--btn"
          @click="setMonth(m.month)"
        >
          <span class="mrow__m">{{ m.month }}</span>
          <span class="mrow__n">{{ m.count }} 趟</span>
          <span class="mrow__u">
            待结算 <b :class="{ 'is-warn': m.unsettledCount }">¥{{ num(m.unsettled, 0) }}</b>
            <template v-if="m.unsettledCount">（{{ m.unsettledCount }} 趟）</template>
          </span>
          <span class="mrow__s">已结 ¥{{ num(m.settled, 0) }}</span>
          <span class="mrow__t">合计 ¥{{ num(m.total, 0) }}</span>
          <Icon name="chevR" :size="13" :sw="2.2" />
        </button>
      </div>
    </div>

    <!-- 月份 + 工具条 -->
    <div class="card">
      <div class="card__bd" style="padding: 14px 16px">
        <div class="inbar">
          <MonthPicker :model-value="month" allow-all :months-with-data="months" noun="运费" @update:model-value="setMonth" />
        </div>
        <div class="vsearch mt10">
          <Icon name="search" :size="15" />
          <input v-model="q" class="input" placeholder="搜索路线 / 司机 / 车牌" />
          <button v-if="q" class="vsearch__x" aria-label="清空" @click="q = ''">
            <Icon name="close" :size="13" :sw="2.2" />
          </button>
        </div>
        <div class="mt10">
          <Chips
            v-model="filter"
            :options="[
              { key: 'unsettled', name: '待结算', count: summary.unsettledCount },
              { key: 'settled', name: '已结算', count: summary.settledCount },
              { key: 'all', name: '全部' },
            ]"
          />
        </div>
      </div>
    </div>

    <!-- 明细 -->
    <div class="card card--clip">
      <div class="card__hd">
        <div class="card__title"><Icon name="wallet" :size="15" />运费明细</div>
        <div class="card__sub spacer">
          {{ detail.length }} 趟 · 合计 ¥{{ num(detailTotal, 0) }}
        </div>
      </div>

      <template v-if="detail.length">
        <div class="tbl-wrap vonly-desktop">
          <table class="tbl" style="min-width: 900px">
            <thead>
              <tr>
                <th>日期</th>
                <th style="text-align: left">路线</th>
                <th style="text-align: left">车辆 / 司机</th>
                <th>运费</th>
                <th>成本 / 毛利</th>
                <th>状态</th>
                <th style="width: 200px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in detail" :key="r.t.id">
                <td class="num">{{ r.t.date }}</td>
                <td style="text-align: left">{{ routeText(r.route) }}</td>
                <td style="text-align: left">
                  <div class="num strong">{{ r.vehicle?.plate || '—' }}</div>
                  <div class="tbl__sub">{{ r.driver?.name || '—' }}</div>
                </td>
                <td class="num strong">¥{{ num(r.cost.revenue, 0) }}</td>
                <td class="num">
                  ¥{{ num(r.cost.cost, 0) }}
                  <div class="tbl__sub" :class="r.cost.profit >= 0 ? 'is-good' : 'is-bad'">
                    毛利 ¥{{ num(r.cost.profit, 0) }}
                  </div>
                </td>
                <td>
                  <span class="pill" :class="r.t.settled ? 'pill--run' : 'pill--warn'">
                    <i class="pill__dot" />{{ r.t.settled ? '已结算' : '待结算' }}
                  </span>
                </td>
                <td>
                  <div class="rowacts">
                    <button class="btn btn--sm" :class="r.t.settled ? 'btn--ghost' : 'btn--primary'" @click="toggleSettled(r)">
                      <Icon :name="r.t.settled ? 'close' : 'check'" :size="12" :sw="2.3" />
                      {{ r.t.settled ? '撤销' : '标记已结算' }}
                    </button>
                    <button class="btn btn--danger btn--sm" @click="askDelete(r)">
                      <Icon name="close" :size="12" :sw="2.2" />删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="vonly-mobile">
          <div v-for="r in detail" :key="r.t.id" class="vcard">
            <div class="vcard__hd">
              <span class="rname">{{ routeText(r.route) }}</span>
              <span class="pill" :class="r.t.settled ? 'pill--run' : 'pill--warn'">
                <i class="pill__dot" />{{ r.t.settled ? '已结算' : '待结算' }}
              </span>
            </div>
            <dl class="vcard__kv">
              <div><dt>日期</dt><dd>{{ r.t.date }}</dd></div>
              <div><dt>车辆 / 司机</dt><dd>{{ r.vehicle?.plate || '—' }} · {{ r.driver?.name || '—' }}</dd></div>
              <div><dt>运费</dt><dd class="strong">¥{{ num(r.cost.revenue, 0) }}</dd></div>
              <div><dt>成本 / 毛利</dt><dd>¥{{ num(r.cost.cost, 0) }} / ¥{{ num(r.cost.profit, 0) }}</dd></div>
            </dl>
            <div class="vcard__acts">
              <button class="btn btn--sm flex1" :class="r.t.settled ? 'btn--ghost' : 'btn--primary'" @click="toggleSettled(r)">
                <Icon :name="r.t.settled ? 'close' : 'check'" :size="13" :sw="2.3" />
                {{ r.t.settled ? '撤销结算' : '标记已结算' }}
              </button>
              <button class="btn btn--danger btn--sm" @click="askDelete(r)">
                <Icon name="close" :size="13" :sw="2.2" />删除
              </button>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="empty">
        <div class="empty__ico"><Icon name="wallet" :size="24" /></div>
        <div class="empty__t">
          {{
            q
              ? '没有匹配的趟次'
              : !trips.length
                ? '还没有运费记录'
                : filter === 'unsettled'
                  ? '没有待结算的运费'
                  : '没有已结算的趟次'
          }}
        </div>
        <div class="empty__d">
          {{
            q
              ? '换个路线、司机或车牌试试'
              : !trips.length
                ? '到「趟次管理」录入趟次（要填运费收入），这里就能看到结算情况'
                : filter === 'unsettled'
                  ? '账都收齐了'
                  : '还没标记过已结算的趟次'
          }}
        </div>
        <div v-if="q || (trips.length && filter !== 'unsettled')" class="empty__acts">
          <button class="btn btn--ghost btn--sm" @click="q = ''; filter = 'unsettled'">看待结算</button>
        </div>
      </div>
    </div>

    <div class="note">
      <Icon name="info" :size="15" />
      <div>
        结算状态在「<b>趟次管理</b>」录入趟次时勾选，这里可以<b>一键标记已结算 / 撤销</b>，
        不用为了改一个勾选去打开整张表单。
        <br />
        成本 = 油费 + 过路费；<b>油费要填了油费单价才算得出来</b>，没填单价的趟次成本会偏低，
        毛利看起来会偏好，看的时候留意一下。
      </div>
    </div>

    <ConfirmDialog
      :open="!!pendingDelete"
      title="确认删除这条趟次？"
      :message="deleteMessage"
      :detail="deleteDetail"
      confirm-text="删除"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />

    <Transition name="toast">
      <div v-if="toast" class="toast"><Icon name="check" :size="14" :sw="2.4" />{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
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
.vsum__v.is-warn {
  color: var(--amber);
}
.vsum__v.is-good {
  color: var(--green);
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

/* —— 按月份 —— */
.mrow {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
  min-width: 0;
  flex-wrap: wrap;
}
.mrow:last-child {
  border-bottom: 0;
}
.mrow--btn {
  width: 100%;
  text-align: left;
  background: none;
  border-left: 0;
  border-right: 0;
  border-top: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: background var(--dur-1) var(--ease);
}
.mrow--btn:hover {
  background: var(--surface-hover);
}
.mrow--btn > svg {
  color: var(--ink-4);
  flex: 0 0 auto;
}
.inbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.mrow__m {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 62px;
}
.mrow__n {
  color: var(--ink-3);
  font-size: 11.5px;
}
.mrow__u {
  color: var(--ink-3);
}
.mrow__u b {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.mrow__u b.is-warn {
  color: var(--amber);
}
.mrow__s,
.mrow__t {
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.mrow__t {
  margin-left: auto;
  font-weight: 650;
  color: var(--ink);
}

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

.is-good {
  color: var(--green);
}
.is-bad {
  color: var(--red);
}
.rowacts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
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
.rname {
  font-size: 13.5px;
  font-weight: 650;
}
.vcard__kv {
  margin: 12px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}
.vcard__kv dt {
  font-size: 11.5px;
  color: var(--ink-3);
}
.vcard__kv dd {
  margin: 3px 0 0;
  font-size: 13.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.vcard__acts {
  margin-top: 13px;
  display: flex;
  gap: 8px;
}
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
