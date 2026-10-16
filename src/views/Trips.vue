<script setup>
/**
 * 趟次管理：趟次明细 + 按「每吨每百公里耗油量」对比
 * ------------------------------------------------------------
 * 指标：实际油耗 ÷ (载重 × 公里数 ÷ 100)，单位 L / 吨·百公里。
 * 它把载重归一化掉了，所以同一条路线、同一类型车辆的司机可以直接横向比 ——
 * 拉 30 吨和拉 5 吨的百公里油耗没有可比性，但每吨百公里有。
 *
 * 分组三层（可切换中间那一层）：
 *   路线 → 车型（或车辆）→ 司机
 * 每位司机给出趟数、平均每吨百公里、以及**单趟波动范围**，
 * 用来回答「同一条路上这位司机大概烧多少」。
 */
import { computed, ref } from 'vue'
import TripForm from '../components/TripForm.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Icon from '../components/Icon.vue'
import Chips from '../components/Chips.vue'
import { trips, addTrip, updateTrip, removeTrip } from '../store/trips.js'
import { findRoute } from '../store/routes.js'
import { findDriver } from '../store/drivers.js'
import { findVehicle } from '../store/vehicles.js'
import { aggregateTrips, fuelPerTon100km, fuelPer100km, isSuspicious } from '../utils/fuelModel.js'
import { tripCost } from '../utils/tripRules.js'
import { num, yuan } from '../utils/format.js'

const view = ref('rank') // rank | detail
/** 中间那层按什么分组：车型（比不同司机）或车辆（比同一台车） */
const groupBy = ref('type')
/** 结算筛选：all | unsettled | settled */
const settleFilter = ref('all')
const q = ref('')
const formOpen = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)
const toast = ref('')
let toastTimer = 0

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

/** 参与对比的趟次：有油耗、有里程、且**载重不为 0**（空载算不出每吨耗油） */
const usable = computed(() =>
  trips.filter((t) => Number(t.actualFuel) > 0 && Number(t.distance) > 0 && Number(t.tonnage) > 0)
)

/* ---------------- 钱：油费 / 成本 / 结算 ---------------- */
/**
 * 全部趟次的钱。刻意按**全部**趟次算（不像油耗指标那样过滤空载/缺数据）——
 * 运费和过路费跟拉了多少货没关系，不该被排除掉。
 */
const money = computed(() => {
  let fuelCost = 0
  let toll = 0
  let revenue = 0
  let unsettled = 0
  let settled = 0
  let unsettledCount = 0
  let settledCount = 0
  let noPrice = 0
  for (const t of trips) {
    const c = tripCost(t)
    fuelCost += c.fuelCost
    toll += c.toll
    revenue += c.revenue
    if (!c.hasPrice) noPrice++
    if (t.settled) {
      settled += c.revenue
      settledCount++
    } else {
      unsettled += c.revenue
      if (c.revenue > 0) unsettledCount++
    }
  }
  const cost = Math.round((fuelCost + toll) * 100) / 100
  return {
    fuelCost: Math.round(fuelCost * 100) / 100,
    toll: Math.round(toll * 100) / 100,
    cost,
    revenue: Math.round(revenue * 100) / 100,
    profit: Math.round((revenue - cost) * 100) / 100,
    unsettled: Math.round(unsettled * 100) / 100,
    settled: Math.round(settled * 100) / 100,
    unsettledCount,
    settledCount,
    noPrice,
  }
})

/** 汇总 */
const overall = computed(() => ({ ...aggregateTrips(trips), count: trips.length }))

const summaryCards = computed(() => {
  const o = overall.value
  const m = money.value
  return [
    {
      l: '趟次',
      v: String(o.count),
      u: '趟',
      s: o.skipped ? `${o.count - o.skipped} 趟参与油耗对比 · ${o.skipped} 趟空载/缺数据` : '全部参与油耗对比',
    },
    { l: '总里程', v: num(o.distance), u: 'km', s: o.avgTonnage ? `平均载重 ${o.avgTonnage} 吨` : '—' },
    { l: '实际油耗', v: num(o.actual, 0), u: 'L', s: o.per100km ? `折合 ${o.per100km} L/100km（未按载重归一）` : '—' },
    {
      l: '油费合计',
      v: m.fuelCost ? '¥' + num(m.fuelCost, 0) : '—',
      u: '',
      s: m.fuelCost ? `+ 过路费 ¥${num(m.toll, 0)} = 成本 ¥${num(m.cost, 0)}` : '还没填油费单价',
    },
  ]
})

/* ---------------- 三层分组：路线 → 车型/车辆 → 司机 ---------------- */
const groups = computed(() => {
  const byRoute = new Map()
  for (const t of usable.value) {
    const route = findRoute(t.routeId)
    if (!route) continue
    if (!byRoute.has(t.routeId)) byRoute.set(t.routeId, { route, list: [] })
    byRoute.get(t.routeId).list.push(t)
  }

  const byType = groupBy.value === 'type'

  return [...byRoute.values()]
    .map((r) => {
      // 第二层
      const subs = new Map()
      for (const t of r.list) {
        const k = byType ? t.type : t.vehicleId || '__none__'
        if (!subs.has(k)) subs.set(k, { key: k, list: [] })
        subs.get(k).list.push(t)
      }

      const subGroups = [...subs.values()]
        .map((s) => {
          const sample = s.list[0]
          // 第三层：司机
          const byDriver = new Map()
          for (const t of s.list) {
            const k = t.driverId || '__none__'
            if (!byDriver.has(k)) byDriver.set(k, [])
            byDriver.get(k).push(t)
          }
          const drivers = [...byDriver.entries()]
            .map(([driverId, list]) => ({
              driverId,
              driver: findDriver(driverId),
              ...aggregateTrips(list),
            }))
            // 每吨百公里越低越省，排前面
            .sort((a, b) => (a.perTon100 ?? Infinity) - (b.perTon100 ?? Infinity))

          const vehicles = [...new Set(s.list.map((t) => t.vehicleId).filter(Boolean))]
            .map((id) => findVehicle(id))
            .filter(Boolean)

          return {
            key: s.key,
            label: byType ? sample.type : findVehicle(sample.vehicleId)?.plate || '未指定车辆',
            type: sample.type,
            vehicles,
            drivers,
            ...aggregateTrips(s.list),
          }
        })
        .sort((a, b) => (a.perTon100 ?? Infinity) - (b.perTon100 ?? Infinity))

      return { route: r.route, subs: subGroups, ...aggregateTrips(r.list) }
    })
    .sort((a, b) => b.trips - a.trips)
})

const filteredGroups = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return groups.value
  return groups.value
    .map((g) => {
      const routeHit = `${g.route.from}${g.route.to}`.toLowerCase().includes(kw)
      if (routeHit) return g
      const subs = g.subs.filter(
        (s) =>
          s.label.toLowerCase().includes(kw) ||
          s.drivers.some((d) => (d.driver?.name || '').toLowerCase().includes(kw))
      )
      return subs.length ? { ...g, subs } : null
    })
    .filter(Boolean)
})

/* ---------------- 趟次明细 ---------------- */
const detailRows = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return trips
    .map((t) => {
      const route = findRoute(t.routeId)
      return {
        t,
        route,
        driver: findDriver(t.driverId),
        vehicle: findVehicle(t.vehicleId),
        perTon100: fuelPerTon100km(t.tonnage, t.distance, t.actualFuel),
        per100km: fuelPer100km(t.distance, t.actualFuel),
        cost: tripCost(t),
        suspicious: isSuspicious(t),
      }
    })
    .filter((x) => {
      if (!x.route) return false
      if (settleFilter.value === 'unsettled' && x.t.settled) return false
      if (settleFilter.value === 'settled' && !x.t.settled) return false
      if (!kw) return true
      return (
        `${x.route.from}${x.route.to}`.toLowerCase().includes(kw) ||
        x.t.type.toLowerCase().includes(kw) ||
        (x.vehicle?.plate || '').toLowerCase().includes(kw) ||
        (x.driver?.name || '').toLowerCase().includes(kw)
      )
    })
    .sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : 0))
})

/* ---------------- 增改删 ---------------- */
function openNew() {
  editing.value = null
  formOpen.value = true
}
function openEdit(t) {
  editing.value = t
  formOpen.value = true
}
function onSaved(payload) {
  if (editing.value) {
    updateTrip(editing.value.id, payload)
    showToast('已保存趟次的修改')
  } else {
    addTrip(payload)
    showToast('已录入 1 条趟次')
  }
  formOpen.value = false
}

function askDelete(t) {
  pendingDelete.value = t
}
function confirmDelete() {
  const t = pendingDelete.value
  if (!t) return
  removeTrip(t.id)
  pendingDelete.value = null
  showToast('已删除该趟次')
}
const deleteMessage = computed(() => {
  const t = pendingDelete.value
  if (!t) return ''
  const r = findRoute(t.routeId)
  return `将删除 ${t.date} ${r ? r.from + ' → ' + r.to : ''} 的这趟记录。`
})
const deleteDetail = computed(() => {
  const t = pendingDelete.value
  return t ? `载重 ${t.tonnage} 吨 · 实际油耗 ${t.actualFuel} L · 此操作不可撤销` : ''
})

const routeText = (r) => (r ? `${r.from} → ${r.to}` : '（路线已删除）')
/** 指标展示：算不出来显示「—」 */
const metric = (v) => (v === null || v === undefined ? '—' : v)
const range = (r) =>
  r.perTon100Min === null ? '—' : r.perTon100Min === r.perTon100Max ? String(r.perTon100Min) : `${r.perTon100Min} ~ ${r.perTon100Max}`
</script>

<template>
  <div class="stack">
    <!-- 标题 -->
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">趟次管理</h1>
        <div class="page-head__desc">
          共 {{ overall.count }} 条趟次 · 油耗对比用的指标：每吨每百公里耗油量（L / 吨·百公里）· 载重已归一化
        </div>
      </div>
      <div class="head-actions">
        <button class="btn btn--primary" @click="openNew">
          <Icon name="plus" :size="15" :sw="2.4" />录入趟次
        </button>
      </div>
    </div>

    <!-- 汇总条 -->
    <div class="grid grid--kpi">
      <div v-for="(c, i) in summaryCards" :key="c.l" class="vsum reveal" :style="{ '--d': i * 45 + 'ms' }">
        <div class="vsum__l">{{ c.l }}</div>
        <div class="vsum__v" :class="[c.tone ? 'is-' + c.tone : '', { 'is-placeholder': c.v === '—' }]">
          {{ c.v }}<small v-if="c.u">{{ c.u }}</small>
        </div>
        <div class="vsum__s">{{ c.s }}</div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="card">
      <div class="card__bd" style="padding: 14px 16px">
        <div class="vsearch">
          <Icon name="search" :size="15" />
          <input v-model="q" class="input" placeholder="搜索路线 / 车型 / 车牌 / 司机" />
          <button v-if="q" class="vsearch__x" aria-label="清空" @click="q = ''">
            <Icon name="close" :size="13" :sw="2.2" />
          </button>
        </div>
        <div class="mt10 chips-row">
          <Chips v-model="view" :options="[{ key: 'rank', name: '油耗对比' }, { key: 'detail', name: '趟次明细' }]" />
          <Chips
            v-if="view === 'rank'"
            v-model="groupBy"
            :options="[{ key: 'type', name: '按车型分组' }, { key: 'vehicle', name: '按车辆分组' }]"
          />
          <Chips
            v-else
            v-model="settleFilter"
            :options="[
              { key: 'all', name: '全部' },
              { key: 'unsettled', name: '待结算', count: money.unsettledCount },
              { key: 'settled', name: '已结算', count: money.settledCount },
            ]"
          />
        </div>
      </div>
    </div>

    <!-- ============ 油耗对比 ============ -->
    <template v-if="view === 'rank'">
      <div v-if="filteredGroups.length" class="groups">
        <div v-for="g in filteredGroups" :key="g.route.id" class="card group">
          <!-- 第一层：路线 -->
          <div class="card__hd routehd">
            <div class="card__title">
              <Icon name="route" :size="15" />{{ g.route.from }} → {{ g.route.to }}
            </div>
            <div class="card__sub spacer">
              {{ num(g.route.distance) }} km · {{ g.trips }} 趟 · {{ g.subs.length }} 个{{ groupBy === 'type' ? '车型' : '车辆' }} ·
              平均 <b>{{ metric(g.perTon100) }}</b> L/吨·百公里
            </div>
          </div>

          <!-- 第二层：车型 / 车辆 -->
          <div v-for="s in g.subs" :key="s.key" class="sub">
            <div class="sub__hd">
              <span class="vtype">{{ s.label }}</span>
              <span v-if="groupBy === 'vehicle'" class="sub__type">车型 {{ s.type }}</span>
              <span class="sub__meta">
                {{ s.drivers.length }} 位司机 · {{ s.trips }} 趟 · 平均 <b>{{ metric(s.perTon100) }}</b>
                <template v-if="s.perTon100Min !== null"> · 波动 {{ range(s) }}</template>
              </span>
            </div>

            <!-- 第三层：司机 -->
            <div v-for="(r, i) in s.drivers" :key="r.driverId" class="rank" :class="{ 'is-top': i === 0 && s.drivers.length > 1 }">
              <div class="rank__pos">
                <span class="rank__no">{{ i + 1 }}</span>
              </div>
              <div class="rank__who">
                <div class="rank__name">{{ r.driver?.name || '（司机已删除）' }}</div>
                <div class="rank__meta">
                  {{ r.trips }} 趟 · {{ num(r.distance) }} km · 平均 {{ r.avgTonnage }} 吨
                  <template v-if="r.skipped"> · 跳过 {{ r.skipped }} 趟</template>
                </div>
                <div v-if="groupBy === 'type' && s.vehicles.length" class="rank__cars">
                  <span v-for="v in s.vehicles" :key="v.id" class="rank__car">{{ v.plate }}</span>
                </div>
              </div>
              <div class="rank__nums">
                <div class="rank__pair"><span>实际油耗</span><b>{{ num(r.actual, 1) }} L</b></div>
                <div class="rank__pair"><span>吨·百公里</span><b>{{ num(r.tonHundred, 1) }}</b></div>
                <div class="rank__pair"><span>折合百公里</span><b>{{ r.per100km }} L</b></div>
              </div>
              <div class="rank__right">
                <div class="rank__main">{{ metric(r.perTon100) }}</div>
                <div class="rank__unit">L / 吨·百公里</div>
                <div class="rank__range">范围 {{ range(r) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="card">
        <div class="empty">
          <div class="empty__ico"><Icon name="fuel" :size="24" /></div>
          <div class="empty__t">{{ q ? '没有匹配的记录' : '还没有可对比的趟次' }}</div>
          <div class="empty__d">
            {{
              q
                ? '换个路线、车型、车牌或司机试试'
                : '录入几趟运输记录（要有载重与实际加油量）后，这里会按「路线 → 车型 → 司机」分组，算出每吨每百公里耗油量'
            }}
          </div>
          <div class="empty__acts">
            <button v-if="q" class="btn btn--ghost btn--sm" @click="q = ''">清空搜索</button>
            <button v-else class="btn btn--primary btn--sm" @click="openNew">
              <Icon name="plus" :size="13" :sw="2.3" />录入趟次
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ============ 趟次明细 ============ -->
    <template v-else>
      <div class="card card--clip">
        <div class="card__hd">
          <div class="card__title"><Icon name="fuel" :size="15" />趟次明细</div>
          <div class="card__sub spacer">{{ detailRows.length }} / {{ trips.length }} 趟</div>
        </div>

        <template v-if="detailRows.length">
          <div class="tbl-wrap vonly-desktop">
            <table class="tbl" style="min-width: 1220px">
              <thead>
                <tr>
                  <th>日期</th>
                  <th style="text-align: left">路线</th>
                  <th style="text-align: left">车辆 / 车型</th>
                  <th style="text-align: left">司机</th>
                  <th>载重 / 公里</th>
                  <th>实际油耗</th>
                  <th class="is-auto">每吨百公里</th>
                  <th>油费</th>
                  <th>过路费 / 成本</th>
                  <th>运费 / 毛利</th>
                  <th>结算</th>
                  <th style="width: 150px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in detailRows" :key="x.t.id">
                  <td class="num">{{ x.t.date }}</td>
                  <td style="text-align: left">{{ routeText(x.route) }}</td>
                  <td style="text-align: left">
                    <div class="num strong">{{ x.vehicle?.plate || '—' }}</div>
                    <div class="tbl__sub">{{ x.t.type || '—' }}</div>
                  </td>
                  <td style="text-align: left">{{ x.driver?.name || '—' }}</td>
                  <td class="num">
                    {{ x.t.tonnage }} t
                    <div class="tbl__sub">{{ num(x.t.distance) }} km</div>
                  </td>
                  <td class="num strong">
                    {{ num(x.t.actualFuel, 1) }} L
                    <div class="tbl__sub">{{ x.per100km }} L/100km</div>
                  </td>
                  <td class="num strong metric">{{ metric(x.perTon100) }}</td>
                  <td class="num">
                    <template v-if="x.cost.hasPrice">
                      ¥{{ num(x.cost.fuelCost, 0) }}
                      <div class="tbl__sub">单价 ¥{{ x.t.fuelPrice }}/L</div>
                    </template>
                    <template v-else>
                      —
                      <div class="tbl__sub">未填单价</div>
                    </template>
                  </td>
                  <td class="num">
                    ¥{{ num(x.cost.toll, 0) }}
                    <div class="tbl__sub">成本 ¥{{ num(x.cost.cost, 0) }}</div>
                  </td>
                  <td class="num">
                    ¥{{ num(x.cost.revenue, 0) }}
                    <div v-if="x.cost.revenue" class="tbl__sub" :class="x.cost.profit >= 0 ? 'is-good' : 'is-bad'">
                      毛利 ¥{{ num(x.cost.profit, 0) }}
                    </div>
                  </td>
                  <td>
                    <span class="pill" :class="x.t.settled ? 'pill--run' : 'pill--warn'">
                      <i class="pill__dot" />{{ x.t.settled ? '已结算' : '待结算' }}
                    </span>
                  </td>
                  <td>
                    <div class="rowacts">
                      <button class="btn btn--ghost btn--sm" @click="openEdit(x.t)"><Icon name="wrench" :size="12" />编辑</button>
                      <button class="btn btn--danger btn--sm" @click="askDelete(x.t)"><Icon name="close" :size="12" :sw="2.2" />删除</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="vonly-mobile">
            <div v-for="x in detailRows" :key="x.t.id" class="vcard">
              <div class="vcard__hd">
                <span class="rname">{{ routeText(x.route) }}</span>
                <span class="vtype">{{ x.t.type }}</span>
                <span class="pill" :class="x.t.settled ? 'pill--run' : 'pill--warn'">
                  <i class="pill__dot" />{{ x.t.settled ? '已结算' : '待结算' }}
                </span>
              </div>
              <dl class="vcard__kv">
                <div><dt>日期</dt><dd>{{ x.t.date }}</dd></div>
                <div><dt>司机 / 车辆</dt><dd>{{ x.driver?.name || '—' }} · {{ x.vehicle?.plate || '—' }}</dd></div>
                <div><dt>载重 / 公里</dt><dd>{{ x.t.tonnage }} t · {{ num(x.t.distance) }} km</dd></div>
                <div><dt>实际油耗</dt><dd>{{ num(x.t.actualFuel, 1) }} L（{{ x.per100km }} L/100km）</dd></div>
                <div><dt>每吨百公里</dt><dd class="metric">{{ metric(x.perTon100) }} L</dd></div>
                <div>
                  <dt>油费</dt>
                  <dd>
                    <template v-if="x.cost.hasPrice">¥{{ num(x.cost.fuelCost, 2) }}<span class="vsub">¥{{ x.t.fuelPrice }}/L</span></template>
                    <template v-else>—<span class="vsub">未填单价</span></template>
                  </dd>
                </div>
                <div><dt>过路费 / 成本</dt><dd>¥{{ num(x.cost.toll, 0) }} / ¥{{ num(x.cost.cost, 0) }}</dd></div>
                <div>
                  <dt>运费 / 毛利</dt>
                  <dd :class="x.cost.revenue && x.cost.profit < 0 ? 'is-bad' : ''">
                    ¥{{ num(x.cost.revenue, 0) }}<span v-if="x.cost.revenue" class="vsub">毛利 ¥{{ num(x.cost.profit, 0) }}</span>
                  </dd>
                </div>
              </dl>
              <div v-if="x.perTon100 === null" class="vrate">空载趟次，算不出每吨耗油</div>
              <div v-else-if="x.suspicious" class="vrate vrate--warn">油耗低于物理下限，建议核对</div>
              <div class="vcard__acts">
                <button class="btn btn--ghost btn--sm flex1" @click="openEdit(x.t)"><Icon name="wrench" :size="13" />编辑</button>
                <button class="btn btn--danger btn--sm flex1" @click="askDelete(x.t)"><Icon name="close" :size="13" :sw="2.2" />删除</button>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="empty">
          <div class="empty__ico"><Icon name="fuel" :size="24" /></div>
          <div class="empty__t">{{ q ? '没有匹配的趟次' : '还没有趟次记录' }}</div>
          <div class="empty__d">{{ q ? '换个路线、车型、车牌或司机试试' : '录入运输记录：路线、车辆、司机、载重与实际加油量' }}</div>
          <div class="empty__acts">
            <button v-if="q" class="btn btn--ghost btn--sm" @click="q = ''">清空搜索</button>
            <button v-else class="btn btn--primary btn--sm" @click="openNew"><Icon name="plus" :size="13" :sw="2.3" />录入趟次</button>
          </div>
        </div>
      </div>
    </template>

    <div class="note">
      <Icon name="info" :size="15" />
      <div>
        <b>每吨每百公里耗油量 = 实际油耗 ÷ (载重 × 公里数 ÷ 100)</b>，单位 L / 吨·百公里。
        载重在这个指标里被归一化掉了，所以<b>同一条路线、同一类型车辆的司机可以直接横向比</b> ——
        百公里油耗不区分拉了 30 吨还是 5 吨，比不出东西来。
        <br />
        分组是<b>路线 → {{ groupBy === 'type' ? '车型' : '车辆' }} → 司机</b>：每位司机给出趟数、平均指标，
        以及<b>单趟波动范围</b>（同一条路上大概烧多少）。汇总用加权口径
        Σ油耗 ÷ Σ(载重×公里数÷100)，不是各趟算术平均 —— 否则跑一趟短途会和长途等权。
        <br />
        <b>空载趟次（载重 0）不计入对比</b>：除数为 0 算不出每吨耗油，硬算会得到 0 或无穷大，把平均值带歪。
      </div>
    </div>

    <TripForm :open="formOpen" :trip="editing" @close="formOpen = false" @saved="onSaved" />
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
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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
  font-size: clamp(19px, 5.4vw, 25px);
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.vsum__v.is-brand {
  color: var(--primary);
}
.vsum__v.is-warn {
  color: var(--amber);
}
.vsum__v.is-placeholder {
  color: var(--ink-4);
}
.vsum__v small {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-3);
  margin-left: 4px;
  letter-spacing: 0;
}
.vsum__s {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ink-3);
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
.chips-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

/* —— 分组 —— */
.groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.group {
  min-width: 0;
}
.routehd b {
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.sub {
  border-top: 1px solid var(--line);
}
.sub__hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: var(--surface-2);
  min-width: 0;
}
.sub__meta {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.sub__meta b {
  color: var(--ink);
}
.sub__type {
  font-size: 11px;
  color: var(--ink-4);
}
.vtype {
  padding: 2px 8px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  font-weight: 600;
  background: var(--primary-soft);
  color: var(--primary);
  white-space: nowrap;
}

.rank {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border-top: 1px solid var(--line);
  min-width: 0;
}
.rank.is-top {
  background: color-mix(in oklab, var(--green) 7%, transparent);
}
.rank__pos {
  display: grid;
  place-items: center;
}
.rank__no {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-4);
}
.rank.is-top .rank__no {
  color: var(--green);
}
.rank__who {
  min-width: 0;
}
.rank__name {
  font-size: 13.5px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank__meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
}
.rank__cars {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.rank__car {
  padding: 1px 6px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-2);
  font-size: 10.5px;
  color: var(--ink-3);
}
.rank__nums {
  display: flex;
  gap: 14px;
}
.rank__pair {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}
.rank__pair b {
  font-size: 12.5px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.rank__right {
  text-align: right;
  min-width: 104px;
}
.rank__main {
  font-size: 17px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.rank__unit {
  font-size: 10px;
  color: var(--ink-4);
}
.rank__range {
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 719px) {
  .rank {
    grid-template-columns: 22px minmax(0, 1fr) auto;
    row-gap: 6px;
  }
  .rank__nums {
    grid-column: 2 / -1;
    justify-content: flex-start;
    gap: 16px;
  }
  .rank__pair {
    align-items: flex-start;
  }
  .rank__right {
    grid-row: 1;
    grid-column: 3;
  }
  .sub__meta {
    margin-left: 0;
    width: 100%;
  }
}

/* —— 明细 —— */
.metric {
  color: var(--primary);
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
.vcard__kv dd.metric {
  color: var(--primary);
}
.vcard__kv dd.is-bad {
  color: var(--red);
}
.vsub {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-3);
}
.vrate {
  margin-top: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
}
.vrate--warn {
  color: var(--amber);
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
