<script setup>
/**
 * 成本
 * ------------------------------------------------------------
 * 五个来源：
 *   车辆折旧 —— 按当月是否在册、是否提满 5 年计提（不是简单地把月折旧乘以车数）
 *   员工成本 —— 司机的月工资
 *   油耗成本 —— 趟次的 实际油耗 × 油费单价
 *   过路费   —— 趟次的过路费
 *   手工成本 —— 配件 / 证件 / 其他，手动录入
 *
 * 两个视图：
 *   总览   —— 汇总卡 + 成本构成饼图 + 手工成本明细
 *   按车辆 —— 一张完整的逐车成本表（车多的时候靠排序 + 搜索 + 筛选来找）
 * 车辆一多，塞在总览里的一条小榜根本看不过来，所以把它独立成一个视图。
 */
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import Chips from '../components/Chips.vue'
import DonutChart from '../components/DonutChart.vue'
import BarList from '../components/BarList.vue'
import MonthPicker from '../components/MonthPicker.vue'
import CostForm from '../components/CostForm.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { vehicles, findVehicle } from '../store/vehicles.js'
import { drivers } from '../store/drivers.js'
import { trips } from '../store/trips.js'
import { costs, addCost, updateCost, removeCost } from '../store/costs.js'
import { costSummary, costBreakdown, availableMonths, monthOf } from '../utils/costModel.js'
import { COST_COLORS, purposeName } from '../data/costs.js'
import { query, setQuery } from '../router.js'
import { num } from '../utils/format.js'

/* ---------------- 月份（也写进 hash，可深链接） ---------------- */
const months = computed(() => availableMonths({ trips, costs }))
const month = ref(query('month') || months.value[0])
function setMonth(v) {
  month.value = v
  setQuery('month', v)
}

/* ---------------- 视图（写进 hash，可深链接） ---------------- */
const view = ref(query('view') === 'vehicle' ? 'vehicle' : 'overview') // overview | vehicle
function setView(v) {
  view.value = v
  setQuery('view', v === 'vehicle' ? 'vehicle' : null)
}
const q = ref('')
const onlyWithCost = ref(true)
/** 按车辆视图的排序 */
const sortKey = ref('total')
const sortDir = ref('desc')

/* ---------------- 汇总 ---------------- */
const data = computed(() => ({ vehicles, drivers, trips, costs }))
const summary = computed(() => costSummary(data.value, month.value))
const breakdown = computed(() => costBreakdown(summary.value))

const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(0) + '%' : '—')

const cards = computed(() => {
  const s = summary.value
  return [
    {
      l: '本月总成本',
      v: s.total ? '¥' + num(s.total, 0) : '—',
      s: s.total ? `${s.tripCount} 趟 · 平均每趟 ¥${num(s.total / Math.max(1, s.tripCount), 0)}` : '这个月还没有成本',
      tone: 'brand',
    },
    {
      l: '车辆折旧',
      v: s.depreciation ? '¥' + num(s.depreciation, 0) : '—',
      s: s.depreciation
        ? `${s.vehicleRows.filter((v) => v.depreciation > 0).length} 台在计提 · 占 ${pct(s.depreciation, s.total)}`
        : '这个月没有在计提折旧的车',
    },
    {
      l: '员工成本',
      v: s.staff ? '¥' + num(s.staff, 0) : '—',
      s: s.staff ? `${drivers.length} 位司机 · 占 ${pct(s.staff, s.total)}` : '司机都还没填工资',
    },
    {
      l: '油耗成本',
      v: s.fuel ? '¥' + num(s.fuel, 0) : '—',
      s: s.fuel ? `另有过路费 ¥${num(s.toll, 0)} · 占 ${pct(s.fuel, s.total)}` : '趟次还没填油费单价',
    },
    {
      l: '手工成本',
      v: s.manual ? '¥' + num(s.manual, 0) : '—',
      s: s.manual
        ? `配件 ¥${num(s.byPurpose.part, 0)} · 证件 ¥${num(s.byPurpose.doc, 0)} · 其他 ¥${num(s.byPurpose.other, 0)}`
        : `${s.manualCount} 笔记录`,
    },
  ]
})

/* ---------------- 总览里的前几名（点「看全部」切到按车辆） ---------------- */
const topBars = computed(() =>
  summary.value.vehicleRows
    .filter((v) => v.total > 0)
    .map((v) => ({
      key: v.id,
      label: v.plate,
      sub: v.type,
      value: v.total,
      segments: [
        { key: 'dep', label: '折旧', value: v.depreciation, color: COST_COLORS.depreciation },
        { key: 'fuel', label: '油耗', value: v.fuel, color: COST_COLORS.fuel },
        { key: 'toll', label: '过路费', value: v.toll, color: COST_COLORS.toll },
        { key: 'part', label: '配件', value: v.part, color: COST_COLORS.part },
        { key: 'doc', label: '证件', value: v.doc, color: COST_COLORS.doc },
      ].filter((s) => s.value > 0),
    }))
)
const costVehicleCount = computed(() => topBars.value.length)

/* ---------------- 按车辆：完整表 ---------------- */
const vehicleColumns = [
  { key: 'depreciation', label: '折旧' },
  { key: 'fuel', label: '油耗' },
  { key: 'toll', label: '过路费' },
  { key: 'part', label: '配件' },
  { key: 'doc', label: '证件' },
  { key: 'total', label: '合计' },
]

const vehicleRows = computed(() => {
  const kw = q.value.trim().toLowerCase()
  let rows = summary.value.vehicleRows
  if (onlyWithCost.value) rows = rows.filter((v) => v.total > 0)
  if (kw) {
    rows = rows.filter(
      (v) => String(v.plate).toLowerCase().includes(kw) || String(v.type).toLowerCase().includes(kw)
    )
  }
  const k = sortKey.value
  const dir = sortDir.value === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (k === 'plate') return String(a.plate).localeCompare(String(b.plate), 'zh') * dir
    return ((Number(a[k]) || 0) - (Number(b[k]) || 0)) * dir
  })
})

function sortBy(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else {
    sortKey.value = k
    sortDir.value = k === 'plate' ? 'asc' : 'desc'
  }
}
/** 表头/卡片上那根细条：一眼看出这台车的钱花在哪 */
const segsOf = (v) =>
  [
    { key: 'dep', value: v.depreciation, color: COST_COLORS.depreciation },
    { key: 'fuel', value: v.fuel, color: COST_COLORS.fuel },
    { key: 'toll', value: v.toll, color: COST_COLORS.toll },
    { key: 'part', value: v.part, color: COST_COLORS.part },
    { key: 'doc', value: v.doc, color: COST_COLORS.doc },
  ].filter((s) => s.value > 0)
const rowMax = computed(() => Math.max(1, ...vehicleRows.value.map((v) => v.total)))
const share = (v) => (summary.value.total ? ((v.total / summary.value.total) * 100).toFixed(1) + '%' : '—')

const vehicleTotals = computed(() => {
  const rows = vehicleRows.value
  const sum = (k) => rows.reduce((a, v) => a + (Number(v[k]) || 0), 0)
  return {
    count: rows.length,
    depreciation: sum('depreciation'),
    fuel: sum('fuel'),
    toll: sum('toll'),
    part: sum('part'),
    doc: sum('doc'),
    total: sum('total'),
  }
})

/* ---------------- 手工成本明细 ---------------- */
const manualRows = computed(() =>
  costs
    .filter((c) => monthOf(c.date) === month.value)
    .map((c) => ({ c, vehicle: c.vehicleId ? findVehicle(c.vehicleId) : null }))
    .sort((a, b) => (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : 0))
)

/* ---------------- 弹窗 ---------------- */
const formOpen = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)

function openNew() {
  editing.value = null
  formOpen.value = true
}
function openEdit(c) {
  editing.value = c
  formOpen.value = true
}
function onSaved({ payload, id }) {
  if (id) updateCost(id, payload)
  else {
    addCost(payload)
    // 新记的这笔如果不在当前月份，自动跳过去，否则用户会以为没保存成功
    const m = monthOf(payload.date)
    if (m && m !== month.value) month.value = m
  }
  formOpen.value = false
  editing.value = null
}
function confirmDelete() {
  if (pendingDelete.value) removeCost(pendingDelete.value.c.id)
  pendingDelete.value = null
}

const deleteMessage = computed(() => {
  const r = pendingDelete.value
  if (!r) return ''
  return `将删除 ${r.c.date} 的「${purposeName(r.c.purpose)}」记录，金额 ¥${num(r.c.amount)}。`
})
const deleteDetail = computed(() => {
  const r = pendingDelete.value
  return r?.vehicle ? `原本挂在 ${r.vehicle.plate} 上，删除后该车成本会相应减少` : '此操作不可撤销'
})

const hasAnyData = computed(() => vehicles.length || drivers.length || trips.length || costs.length)
</script>

<template>
  <div class="stack">
    <!-- 标题 -->
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">成本</h1>
        <div class="page-head__desc">
          折旧 + 人工 + 油耗 + 过路费 + 手工录入
        </div>
      </div>
      <button class="btn btn--primary" @click="openNew">
        <Icon name="plus" :size="15" :sw="2.3" />添加成本
      </button>
    </div>

    <div v-if="!hasAnyData" class="card">
      <div class="empty">
        <div class="empty__ico"><Icon name="cost" :size="24" /></div>
        <div class="empty__t">还没有任何成本数据</div>
        <div class="empty__d">
          成本来自四处：车辆的购置价格（算折旧）、司机的工资、趟次的油耗，以及手工录入的配件 / 证件费用。<br />
          先去录入车辆和司机，或者直接手工记一笔。
        </div>
        <div class="empty__acts">
          <button class="btn btn--primary btn--sm" @click="openNew"><Icon name="plus" :size="13" :sw="2.3" />添加成本</button>
        </div>
      </div>
    </div>

    <template v-else>
      <!-- 月份 + 视图 -->
      <div class="bar">
        <MonthPicker :model-value="month" :months-with-data="months" noun="成本" @update:model-value="setMonth" />
        <div class="bar__sp" />
        <Chips
          :model-value="view"
          @update:model-value="setView"
          :options="[
            { key: 'overview', name: '总览' },
            { key: 'vehicle', name: '按车辆', count: costVehicleCount },
          ]"
        />
      </div>

      <!-- ============ 总览 ============ -->
      <template v-if="view === 'overview'">
        <div class="grid grid--kpi">
          <div v-for="(c, i) in cards" :key="c.l" class="vsum reveal" :style="{ '--d': i * 45 + 'ms' }">
            <div class="vsum__l">{{ c.l }}</div>
            <div class="vsum__v" :class="[c.tone ? 'is-' + c.tone : '', { 'is-placeholder': c.v === '—' }]">{{ c.v }}</div>
            <div class="vsum__s">{{ c.s }}</div>
          </div>
        </div>

        <div class="charts">
          <div class="card">
            <div class="card__hd">
              <div class="card__title"><Icon name="cost" :size="15" />成本构成</div>
              <div class="card__sub spacer">{{ breakdown.length }} 个来源</div>
            </div>
            <div class="card__bd">
              <DonutChart
                v-if="breakdown.length"
                :items="breakdown"
                :center-label="month + ' 合计'"
                :center-value="'¥' + num(summary.total, 0)"
                :format="(v) => '¥' + num(v, 0)"
              />
              <div v-else class="empty empty--sm"><div class="empty__d">这个月还没有产生任何成本</div></div>
            </div>
            <div v-if="breakdown.length" class="card__ft">
              <span class="legend-note">占比按金额算 · 折旧与人工按月计提，不随趟次波动</span>
            </div>
          </div>

          <div class="card">
            <div class="card__hd">
              <div class="card__title"><Icon name="truck" :size="15" />成本最高的车</div>
              <div class="card__sub spacer">共 {{ costVehicleCount }} 台有成本</div>
            </div>
            <div class="card__bd">
              <BarList :items="topBars" :limit="6" :format="(v) => '¥' + num(v, 0)" />
            </div>
            <div class="card__ft card__ft--between">
              <div class="seglegend">
                <span
                  v-for="s in [
                    { l: '折旧', c: COST_COLORS.depreciation },
                    { l: '油耗', c: COST_COLORS.fuel },
                    { l: '过路费', c: COST_COLORS.toll },
                    { l: '配件', c: COST_COLORS.part },
                    { l: '证件', c: COST_COLORS.doc },
                  ]"
                  :key="s.l"
                  class="seglegend__i"
                ><i :style="{ background: s.c }" />{{ s.l }}</span>
              </div>
              <button class="btn btn--ghost btn--sm" @click="setView('vehicle')">
                看全部 {{ costVehicleCount }} 台<Icon name="chevR" :size="13" :sw="2.2" />
              </button>
            </div>
          </div>
        </div>

        <!-- 手工成本 -->
        <div class="card card--clip">
          <div class="card__hd">
            <div class="card__title"><Icon name="wrench" :size="15" />手工录入的成本</div>
            <div class="card__sub spacer">{{ manualRows.length }} 笔 · ¥{{ num(summary.manual, 0) }}</div>
            <button class="btn btn--ghost btn--sm" @click="openNew"><Icon name="plus" :size="13" :sw="2.3" />添加</button>
          </div>

          <template v-if="manualRows.length">
            <div class="tbl-wrap vonly-desktop">
              <table class="tbl" style="min-width: 760px">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th style="text-align: left">用途</th>
                    <th style="text-align: left">车辆</th>
                    <th style="text-align: left">备注</th>
                    <th>金额</th>
                    <th style="width: 150px">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in manualRows" :key="r.c.id">
                    <td class="num">{{ r.c.date }}</td>
                    <td style="text-align: left"><span class="ptag" :class="'ptag--' + r.c.purpose">{{ purposeName(r.c.purpose) }}</span></td>
                    <td style="text-align: left">
                      <span v-if="r.vehicle" class="num">{{ r.vehicle.plate }}</span>
                      <span v-else class="dim">不挂车</span>
                    </td>
                    <td style="text-align: left" class="note-cell">{{ r.c.note || '—' }}</td>
                    <td class="num strong">¥{{ num(r.c.amount) }}</td>
                    <td>
                      <div class="rowacts">
                        <button class="btn btn--ghost btn--sm" @click="openEdit(r.c)"><Icon name="wrench" :size="12" />编辑</button>
                        <button class="btn btn--danger btn--sm" @click="pendingDelete = r"><Icon name="close" :size="12" :sw="2.2" />删除</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="vonly-mobile">
              <div v-for="r in manualRows" :key="r.c.id" class="vcard">
                <div class="vcard__hd">
                  <span class="ptag" :class="'ptag--' + r.c.purpose">{{ purposeName(r.c.purpose) }}</span>
                  <span class="rname">{{ r.vehicle ? r.vehicle.plate : '不挂车' }}</span>
                  <span class="rdate">{{ r.c.date }}</span>
                </div>
                <div class="vcard__amt">¥{{ num(r.c.amount) }}</div>
                <div v-if="r.c.note" class="vcard__note">{{ r.c.note }}</div>
                <div class="vcard__acts">
                  <button class="btn btn--ghost btn--sm flex1" @click="openEdit(r.c)"><Icon name="wrench" :size="13" />编辑</button>
                  <button class="btn btn--danger btn--sm flex1" @click="pendingDelete = r"><Icon name="close" :size="13" :sw="2.2" />删除</button>
                </div>
              </div>
            </div>
          </template>

          <div v-else class="empty empty--sm">
            <div class="empty__t">这个月还没有手工录入的成本</div>
            <div class="empty__d">配件、证件这类支出记在这里，会算进对应车辆的成本</div>
            <div class="empty__acts">
              <button class="btn btn--primary btn--sm" @click="openNew"><Icon name="plus" :size="13" :sw="2.3" />添加成本</button>
            </div>
          </div>
        </div>
      </template>

      <!-- ============ 按车辆 ============ -->
      <template v-else>
        <div class="card">
          <div class="card__bd" style="padding: 14px 16px">
            <div class="vsearch">
              <Icon name="search" :size="15" />
              <input v-model="q" class="input" placeholder="搜索车牌 / 车型" />
              <button v-if="q" class="vsearch__x" aria-label="清空" @click="q = ''"><Icon name="close" :size="13" :sw="2.2" /></button>
            </div>
            <div class="mt10">
              <Chips
                v-model="onlyWithCost"
                :options="[
                  { key: true, name: '只看有成本的', count: costVehicleCount },
                  { key: false, name: '全部车辆', count: vehicles.length },
                ]"
              />
            </div>
          </div>
        </div>

        <div class="card card--clip">
          <div class="card__hd">
            <div class="card__title"><Icon name="truck" :size="15" />逐车成本</div>
            <div class="card__sub spacer">
              {{ vehicleTotals.count }} 台 · 合计 ¥{{ num(vehicleTotals.total, 0) }} ·
              平均 ¥{{ num(vehicleTotals.total / Math.max(1, vehicleTotals.count), 0) }}
            </div>
          </div>

          <template v-if="vehicleRows.length">
            <div class="tbl-wrap vonly-desktop">
              <table class="tbl tbl--sortable" style="min-width: 1040px">
                <thead>
                  <tr>
                    <th style="text-align: left">
                      <button class="thbtn" @click="sortBy('plate')">
                        车牌 / 车型<Icon :name="sortKey === 'plate' ? (sortDir === 'desc' ? 'arrDown' : 'arrUp') : 'chevD'" :size="12" />
                      </button>
                    </th>
                    <th v-for="col in vehicleColumns" :key="col.key" class="num">
                      <button class="thbtn thbtn--r" @click="sortBy(col.key)">
                        {{ col.label }}<Icon :name="sortKey === col.key ? (sortDir === 'desc' ? 'arrDown' : 'arrUp') : 'chevD'" :size="12" />
                      </button>
                    </th>
                    <th class="num">占比</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="v in vehicleRows" :key="v.id">
                    <td style="text-align: left">
                      <div class="num strong">{{ v.plate }}</div>
                      <div class="tbl__sub">{{ v.type }}</div>
                    </td>
                    <td class="num" :class="{ dim: !v.depreciation }">{{ v.depreciation ? '¥' + num(v.depreciation, 0) : '—' }}</td>
                    <td class="num" :class="{ dim: !v.fuel }">{{ v.fuel ? '¥' + num(v.fuel, 0) : '—' }}</td>
                    <td class="num" :class="{ dim: !v.toll }">{{ v.toll ? '¥' + num(v.toll, 0) : '—' }}</td>
                    <td class="num" :class="{ dim: !v.part }">{{ v.part ? '¥' + num(v.part, 0) : '—' }}</td>
                    <td class="num" :class="{ dim: !v.doc }">{{ v.doc ? '¥' + num(v.doc, 0) : '—' }}</td>
                    <td class="num strong">
                      ¥{{ num(v.total, 0) }}
                      <!-- 一根细条：这台车的钱主要花在哪 -->
                      <div class="ministack">
                        <span
                          v-for="s in segsOf(v)"
                          :key="s.key"
                          :style="{ width: (s.value / rowMax) * 100 + '%', background: s.color }"
                        />
                      </div>
                    </td>
                    <td class="num dim">{{ share(v) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td style="text-align: left">合计 {{ vehicleTotals.count }} 台</td>
                    <td class="num">¥{{ num(vehicleTotals.depreciation, 0) }}</td>
                    <td class="num">¥{{ num(vehicleTotals.fuel, 0) }}</td>
                    <td class="num">¥{{ num(vehicleTotals.toll, 0) }}</td>
                    <td class="num">¥{{ num(vehicleTotals.part, 0) }}</td>
                    <td class="num">¥{{ num(vehicleTotals.doc, 0) }}</td>
                    <td class="num strong">¥{{ num(vehicleTotals.total, 0) }}</td>
                    <td class="num dim">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div class="vonly-mobile">
              <div v-for="v in vehicleRows" :key="v.id" class="vcard">
                <div class="vcard__hd">
                  <span class="rname">{{ v.plate }}</span>
                  <span class="vtype">{{ v.type }}</span>
                  <span class="vcard__tot">¥{{ num(v.total, 0) }}</span>
                </div>
                <div class="ministack ministack--wide">
                  <span
                    v-for="s in segsOf(v)"
                    :key="s.key"
                    :style="{ width: (s.value / rowMax) * 100 + '%', background: s.color }"
                  />
                </div>
                <dl class="vcard__kv">
                  <div><dt>折旧</dt><dd>{{ v.depreciation ? '¥' + num(v.depreciation, 0) : '—' }}</dd></div>
                  <div><dt>油耗</dt><dd>{{ v.fuel ? '¥' + num(v.fuel, 0) : '—' }}</dd></div>
                  <div><dt>过路费</dt><dd>{{ v.toll ? '¥' + num(v.toll, 0) : '—' }}</dd></div>
                  <div><dt>配件</dt><dd>{{ v.part ? '¥' + num(v.part, 0) : '—' }}</dd></div>
                  <div><dt>证件</dt><dd>{{ v.doc ? '¥' + num(v.doc, 0) : '—' }}</dd></div>
                  <div><dt>占全队</dt><dd>{{ share(v) }}</dd></div>
                </dl>
              </div>
            </div>
          </template>

          <div v-else class="empty empty--sm">
            <div class="empty__ico"><Icon name="truck" :size="22" /></div>
            <div class="empty__t">{{ q ? '没有匹配的车辆' : '这个月没有车辆产生成本' }}</div>
            <div class="empty__d">
              {{ q ? '换个车牌或车型试试' : '折旧与人工是按月计提的，录入车辆和司机后这里就会有数据' }}
            </div>
            <div class="empty__acts">
              <button v-if="q" class="btn btn--ghost btn--sm" @click="q = ''">清空搜索</button>
              <button v-else-if="onlyWithCost && vehicles.length" class="btn btn--ghost btn--sm" @click="onlyWithCost = false">
                看全部 {{ vehicles.length }} 台
              </button>
            </div>
          </div>
        </div>
      </template>

      <div class="note">
        <Icon name="info" :size="15" />
        <div>
          <b>折旧</b>按 5 年直线法、残值 10% 计提：当月还没买的车不计，提满 5 年的车也不再计。<br />
          <b>油耗成本</b>用的是每趟录入的油费单价，没填单价的趟次算不出油费，会让油耗成本偏低。<br />
          <b>过路费</b>单独列一项，没有并进油耗里。
        </div>
      </div>
    </template>

    <CostForm :open="formOpen" :cost="editing" @close="formOpen = false; editing = null" @saved="onSaved" />

    <ConfirmDialog
      :open="!!pendingDelete"
      title="确认删除这笔成本？"
      :message="deleteMessage"
      :detail="deleteDetail"
      confirm-text="删除"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
/* 月份 + 视图切换 */
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.bar__sp {
  flex: 1 1 auto;
}

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
  font-size: clamp(19px, 5.2vw, 24px);
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.vsum__v.is-brand {
  color: var(--primary);
}
.vsum__v.is-placeholder {
  color: var(--ink-4);
}
.vsum__s {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.45;
}

.charts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}
@media (min-width: 980px) {
  .charts {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.card__ft {
  padding: 9px 16px 13px;
  border-top: 1px solid var(--line);
}
.card__ft--between {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.legend-note {
  font-size: 11.5px;
  color: var(--ink-3);
}
.seglegend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 13px;
  font-size: 11.5px;
  color: var(--ink-3);
  min-width: 0;
}
.seglegend__i {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.seglegend__i i {
  width: 8px;
  height: 8px;
  border-radius: 2.5px;
}

/* 可排序表头 */
.thbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.thbtn--r {
  justify-content: flex-end;
}
.thbtn svg {
  opacity: 0.45;
}
.tbl--sortable tfoot td {
  font-weight: 650;
  background: var(--surface-2);
  border-top: 1px solid var(--line-2);
}

/* 行内迷你堆叠条 */
.ministack {
  display: flex;
  height: 4px;
  margin-top: 5px;
  border-radius: var(--r-pill);
  overflow: hidden;
  background: var(--surface-3);
}
.ministack--wide {
  height: 7px;
  margin-top: 11px;
}
.ministack span {
  height: 100%;
}

.ptag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.ptag--part {
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
}
.ptag--doc {
  background: rgba(20, 184, 166, 0.13);
  color: #0f766e;
}
.ptag--other {
  background: var(--surface-3);
  color: var(--ink-2);
}
.dim {
  color: var(--ink-4);
}
.note-cell {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rowacts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
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
.vcard__tot {
  margin-left: auto;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rdate {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.vcard__kv {
  margin: 11px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px 14px;
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
.vcard__amt {
  margin-top: 9px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.vcard__note {
  margin-top: 5px;
  font-size: 12px;
  color: var(--ink-3);
}
.vcard__acts {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.empty--sm {
  padding: 26px 16px;
}
</style>
