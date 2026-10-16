<script setup>
/**
 * 成本管理：把「油耗 / 过路费 / 司机成本 / 固定成本 / 维保」五个科目
 * 各自的看数方式与明细摊开。每个科目都有专属的拆解角度，
 * 而不是同一张表换个标题。
 */
import { computed, ref, watch } from 'vue'
import {
  PERIODS, resolveRange, summarizeWithPrev, byVehicle, byDriver,
  monthsIn, monthLabel, rangeLabel, state,
} from '../store/fleet.js'
import {
  CATS, DRIVER_MAP, ROUTE_MAP, CAT_MAP,
  fuelEntries, tollEntries, maintEntries, fixedEntries, driverSalaryEntries, driverCommissionEntries,
} from '../data/mock.js'
import { vehicles as VEHICLES, vehicleMap as VEHICLE_MAP } from '../store/vehicles.js'
import { compactMoney, num, pct, yuan, deltaInfo, md } from '../utils/format.js'
import { openEntry } from '../store/ui.js'
import { query } from '../router.js'
import SegControl from '../components/SegControl.vue'
import SectionHead from '../components/SectionHead.vue'
import BarList from '../components/BarList.vue'
import DonutChart from '../components/DonutChart.vue'
import Icon from '../components/Icon.vue'

/* 成本页的周期选项精简一些，避免和报表页重复太多 */
const COST_PERIODS = PERIODS.filter((p) => ['d30', 'mtd', 'lm', 'qtd', 'y12'].includes(p.key))
/** 支持深链：#/costs?cat=toll&period=qtd */
const period = ref(query('period', 'mtd'))
const cat = ref(CATS.some((c) => c.key === query('cat')) ? query('cat') : 'fuel')
const shown = ref(18)

const range = computed(() => resolveRange(period.value))
const S = computed(() => summarizeWithPrev(range.value))
const CAT_OPTS = CATS.map((c) => ({ key: c.key, name: c.name }))
const cur = computed(() => CAT_MAP[cat.value])

watch([period, cat], () => (shown.value = 18))

const months = computed(() => monthsIn(range.value.s, range.value.e))

/* ---------------- 各科目专属统计 ---------------- */
const vehiclesInRange = computed(() => byVehicle(range.value.s, range.value.e).filter((v) => v.km > 0))

/* 油耗 */
const fuel = computed(() => {
  const list = fuelEntries(S.value.cur.rows)
  const totalL = list.reduce((a, x) => a + x.liters, 0)
  const totalAmt = list.reduce((a, x) => a + x.amount, 0)
  const km = list.reduce((a, x) => a + x.km, 0)
  const abnormal = vehiclesInRange.value
    .filter((v) => v.per100 > v.normFuel * 1.08)
    .sort((a, b) => b.per100 / b.normFuel - a.per100 / a.normFuel)
    .slice(0, 4)
    .map((v) => ({
      key: v.id,
      label: `${v.plate} · ${v.driverName}`,
      value: v.per100,
      norm: v.normFuel,
      vkm: v.km,
      color: v.per100 > v.normFuel * 1.15 ? 'var(--red)' : 'var(--amber)',
      sub: `基准 ${v.normFuel} L · 高出 ${pct(v.per100 / v.normFuel - 1)} · 该车 ${num(v.km)} km`,
    }))
  // 因油耗高于基准而多花的钱（按当期柴油均价折算）
  const waste = abnormal.reduce((a, x) => a + ((x.value - x.norm) * x.vkm * (totalL ? totalAmt / totalL : 7.5)) / 100, 0)
  return {
    list,
    totalL,
    totalAmt,
    avgPrice: totalL ? totalAmt / totalL : 0,
    per100: km ? (totalL / km) * 100 : 0,
    perKm: S.value.cur.km ? totalAmt / S.value.cur.km : 0,
    abnormal,
    waste,
    fills: list.reduce((a, x) => a + x.fills, 0),
  }
})

/* 过路费 */
const toll = computed(() => {
  const list = tollEntries(S.value.cur.rows)
  const total = list.reduce((a, x) => a + x.amount, 0)
  const etcAmt = list.filter((x) => x.etc).reduce((a, x) => a + x.amount, 0)
  const noInvoice = list.filter((x) => !x.invoiced).reduce((a, x) => a + x.amount, 0)
  const byGate = new Map()
  list.forEach((x) => byGate.set(x.gate, (byGate.get(x.gate) || 0) + x.amount))
  const topGates = [...byGate.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g, v]) => ({ key: g, label: g, value: v, color: 'var(--c-toll)', sub: `${list.filter((x) => x.gate === g).length} 笔通行` }))
  return {
    list,
    total,
    etcRate: total ? etcAmt / total : 0,
    noInvoice,
    perKm: S.value.cur.km ? total / S.value.cur.km : 0,
    revenueShare: S.value.cur.rev ? total / S.value.cur.rev : 0,
    topGates,
    count: list.length,
  }
})

/* 司机成本 */
const driver = computed(() => {
  const comm = driverCommissionEntries(S.value.cur.rows)
  const salaries = driverSalaryEntries(months.value)
  const commTotal = comm.reduce((a, x) => a + x.amount, 0)
  const baseTotal = salaries.filter((x) => x.kind === 'base').reduce((a, x) => a + x.amount, 0)
  const socialTotal = salaries.filter((x) => x.kind === 'social').reduce((a, x) => a + x.amount, 0)
  const bonusTotal = salaries.filter((x) => x.kind === 'bonus').reduce((a, x) => a + x.amount, 0)
  const total = commTotal + baseTotal + socialTotal + bonusTotal
  const ranking = byDriver(range.value.s, range.value.e)
    .filter((d) => d.km > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 6)
    .map((d) => ({
      key: d.id,
      label: `${d.name} · ${d.plate}`,
      value: d.cost,
      color: d.costPerKm > 0.9 ? 'var(--red)' : 'var(--c-driver)',
      sub: `${num(d.km)} km · 单公里 ${d.costPerKm.toFixed(3)} 元`,
    }))
  return {
    comm, salaries, commTotal, baseTotal, socialTotal, bonusTotal, total, ranking,
    revenueShare: S.value.cur.rev ? total / S.value.cur.rev : 0,
  }
})

/* 固定成本 */
const fixed = computed(() => {
  const list = fixedEntries(months.value)
  const keys = [
    { k: 'insurance', n: '车辆保险' },
    { k: 'depreciation', n: '车辆折旧' },
    { k: 'loan', n: '车贷月供' },
    { k: 'parking', n: '停车 / 场地' },
    { k: 'manage', n: '管理费 / 年检' },
  ]
  const byKind = keys.map(({ k, n }) => ({
    key: k,
    label: n,
    value: list.reduce((a, x) => a + (x.kind === k ? x.amount : 0), 0),
    color: 'var(--c-fixed)',
    sub: `${VEHICLES.length} 台 × ${months.value.length} 个月`,
  }))
  const total = byKind.reduce((a, x) => a + x.value, 0)
  return {
    list: list.slice().sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || b.amount - a.amount),
    byKind: byKind.sort((a, b) => b.value - a.value),
    total,
    activeMonths: months.value.length,
    perVehicleMonth: VEHICLES.length && months.value.length ? total / VEHICLES.length / months.value.length : 0,
    costShare: S.value.cur.cost ? total / S.value.cur.cost : 0,
  }
})

/* 维保 */
const maint = computed(() => {
  const list = maintEntries(S.value.cur.rows)
  const service = list.filter((x) => x.kind === 'service')
  const consumable = list.filter((x) => x.kind === 'consumable')
  const total = list.reduce((a, x) => a + x.amount, 0)
  const byItem = new Map()
  service.forEach((x) => byItem.set(x.item, (byItem.get(x.item) || 0) + x.amount))
  const topItems = [...byItem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n, v]) => ({ key: n, label: n, value: v, color: 'var(--c-maint)', sub: `${service.filter((x) => x.item === n).length} 张工单` }))
  return {
    list: list.slice().sort((a, b) => b.ts - a.ts),
    service,
    total,
    serviceTotal: service.reduce((a, x) => a + x.amount, 0),
    consumableTotal: consumable.reduce((a, x) => a + x.amount, 0),
    perKm: S.value.cur.km ? total / S.value.cur.km : 0,
    topItems,
    orders: service.length,
  }
})

/* ---------------- 统一明细流 ---------------- */
const flow = computed(() => {
  const vname = (id) => VEHICLE_MAP[id]?.plate || '—'
  switch (cat.value) {
    case 'fuel':
      return fuel.value.list.map((x) => ({
        id: x.id, ts: x.ts, date: x.date, color: 'var(--c-fuel)', icon: 'fuel',
        title: `${vname(x.vehicleId)} · ${x.station}`,
        sub: `${num(x.liters, 1)} L × ¥${x.price} · 覆盖 ${num(x.km)} km${x.fills > 1 ? ` · 合并 ${x.fills} 次` : ''}`,
        extra: `百公里 ${x.per100} L`,
        amount: x.amount,
      }))
    case 'toll':
      return toll.value.list.map((x) => ({
        id: x.id, ts: x.ts, date: x.date, color: 'var(--c-toll)', icon: 'toll',
        title: `${vname(x.vehicleId)} · ${x.gate}`,
        sub: `${ROUTE_MAP[x.route]?.seg || '—'} · ${x.etc ? 'ETC' : '现金/卡'}`,
        extra: x.invoiced ? '已开票' : '待开票',
        warn: !x.invoiced,
        amount: x.amount,
      }))
    case 'driver': {
      const comm = driver.value.comm.map((x) => ({
        id: x.id, ts: x.ts, date: x.date, color: 'var(--c-driver)', icon: 'driver',
        title: `${DRIVER_MAP[x.driverId]?.name || '—'} · 里程提成`,
        sub: `${vname(x.vehicleId)} · ${ROUTE_MAP[x.route]?.from || ''}→${ROUTE_MAP[x.route]?.to || ''} · ${num(x.km)} km`,
        extra: '含出车补贴',
        amount: x.amount,
      }))
      const sal = driver.value.salaries.map((x, i) => ({
        id: x.id + i, ts: new Date(x.date + 'T00:00:00').getTime(), date: x.date,
        color: 'var(--c-driver)', icon: 'wallet',
        title: `${DRIVER_MAP[x.driverId]?.name || '—'} · ${x.item}`,
        sub: `${monthLabel(x.ym)} 计提 · 准驾 ${DRIVER_MAP[x.driverId]?.license || '—'}`,
        extra: '月度固定',
        amount: x.amount,
      }))
      return [...comm, ...sal].sort((a, b) => b.ts - a.ts)
    }
    case 'fixed':
      return fixed.value.list.map((x) => ({
        id: x.id, ts: new Date(x.date + 'T00:00:00').getTime(), date: x.date,
        color: 'var(--c-fixed)', icon: 'wallet',
        title: `${vname(x.vehicleId)} · ${x.item}`,
        sub: `${monthLabel(x.ym)} 计提 · 车龄 ${VEHICLE_MAP[x.vehicleId]?.age} 年`,
        extra: '固定成本',
        amount: x.amount,
      }))
    case 'maint':
      return maint.value.list.map((x) => ({
        id: x.id, ts: x.ts, date: x.date, color: 'var(--c-maint)', icon: x.kind === 'service' ? 'wrench' : 'box',
        title: `${vname(x.vehicleId)} · ${x.item}`,
        sub: x.kind === 'service' ? '进厂工单' : `按里程摊销 · 里程 ${num(VEHICLE_MAP[x.vehicleId]?.odo)} km`,
        extra: x.kind === 'service' ? '工单' : '耗材',
        amount: x.amount,
      }))
    default:
      return []
  }
})

const visibleFlow = computed(() => flow.value.slice(0, shown.value))

/* 当前科目的本期/上期合计 */
const catTotals = computed(() => {
  const c = cur.value.key
  const now = S.value.cur[c] || 0
  const before = S.value.prev[c] || 0
  return { now, before, chg: before ? (now - before) / before : 0, share: S.value.cur.cost ? now / S.value.cur.cost : 0 }
})

const manual = computed(() => state.entries.slice().sort((a, b) => b.ts - a.ts).slice(0, 8))
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">成本管理</h1>
        <div class="page-head__desc">{{ rangeLabel(range) }} · 五科目口径</div>
      </div>
      <SegControl v-model="period" :options="COST_PERIODS" />
    </div>

    <!-- 科目切换 -->
    <div class="card">
      <div class="card__bd" style="padding: 12px">
        <SegControl v-model="cat" :options="CAT_OPTS" />
        <div class="row mt14" style="align-items: flex-end; gap: 14px; flex-wrap: wrap">
          <div>
            <div class="tiny muted">{{ cat.name }} · 本期合计</div>
            <div class="dsp" style="font-size: 28px; font-weight: 700; margin-top: 4px">
              {{ yuan(catTotals.now) }}
            </div>
          </div>
          <div class="spacer" style="text-align: right">
            <span class="delta" :class="deltaInfo(catTotals.chg, { goodWhen: 'down' }).cls">
              <Icon v-if="catTotals.chg > 0" name="arrUp" :size="10" :sw="2.4" />
              <Icon v-else-if="catTotals.chg < 0" name="arrDown" :size="10" :sw="2.4" />
              {{ deltaInfo(catTotals.chg, { goodWhen: 'down' }).txt }}
            </span>
            <div class="tiny muted mono mt6">上期 {{ compactMoney(catTotals.before) }}</div>
          </div>
        </div>
        <div class="bar mt14" style="height: 5px">
          <i class="bar__fill" :style="{ width: pct(catTotals.share, 2), background: cur.color }" />
        </div>
        <div class="tiny muted mono mt6">占本期总成本 {{ pct(catTotals.share, 1) }} · 总成本 {{ compactMoney(S.cur.cost) }}</div>
      </div>
    </div>

    <!-- ============ 油耗 ============ -->
    <template v-if="cat === 'fuel'">
      <div class="grid grid--kpi">
        <div class="card"><div class="card__bd">
          <div class="tiny muted">加油总量</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ num(fuel.totalL, 0) }} <small class="tiny muted2">L</small></div>
          <div class="tiny muted mono mt6">{{ num(fuel.fills) }} 次加油</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">平均柴油单价</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ fuel.avgPrice.toFixed(2) }} <small class="tiny muted2">元/L</small></div>
          <div class="tiny muted mono mt6">随季节波动</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">车队百公里油耗</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ fuel.per100.toFixed(1) }} <small class="tiny muted2">L</small></div>
          <div class="tiny muted mono mt6">含冷机与空驶</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">单公里油费</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ fuel.perKm.toFixed(3) }} <small class="tiny muted2">元/km</small></div>
          <div class="tiny muted mono mt6">占收入 {{ pct(S.cur.rev ? fuel.totalAmt / S.cur.rev : 0, 1) }}</div>
        </div></div>
      </div>

      <div v-if="fuel.abnormal.length" class="card">
        <div class="card__hd">
          <div class="card__title"><Icon name="alert" :size="15" />油耗偏高车辆</div>
          <div class="card__sub spacer">实际 vs 车型基准</div>
        </div>
        <BarList :items="fuel.abnormal" :format="(v) => v.toFixed(1) + ' L'" :show-pct="false" />
        <div class="card__ft tiny muted2">
          这 4 台车因油耗高于车型基准，本期合计多花约 <b>{{ compactMoney(fuel.waste) }}</b>
          （按本期柴油均价折算）。差距通常来自驾驶习惯、胎压与超载，而不是车龄 ——
          同一车型换司机后油耗往往能差 8% 以上。
        </div>
      </div>
    </template>

    <!-- ============ 过路费 ============ -->
    <template v-else-if="cat === 'toll'">
      <div class="grid grid--kpi">
        <div class="card"><div class="card__bd">
          <div class="tiny muted">通行费合计</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ compactMoney(toll.total) }}</div>
          <div class="tiny muted mono mt6">{{ num(toll.count) }} 笔</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">占收入比</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ pct(toll.revenueShare, 1) }}</div>
          <div class="tiny muted mono mt6">行业常见 25%~32%</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">ETC 支付占比</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ pct(toll.etcRate, 1) }}</div>
          <div class="tiny muted mono mt6">ETC 通常有 95 折</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">待开票金额</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px; color: var(--amber)">{{ compactMoney(toll.noInvoice) }}</div>
          <div class="tiny muted mono mt6">单公里 {{ toll.perKm.toFixed(3) }} 元</div>
        </div></div>
      </div>

      <div class="card">
        <div class="card__hd">
          <div class="card__title"><Icon name="route" :size="15" />收费站支出 TOP 5</div>
          <div class="card__sub spacer">按出口站归集</div>
        </div>
        <BarList :items="toll.topGates" :format="(v) => compactMoney(v)" />
      </div>
    </template>

    <!-- ============ 司机成本 ============ -->
    <template v-else-if="cat === 'driver'">
      <div class="grid grid--2-1">
        <div class="grid grid--2">
          <div class="card"><div class="card__bd">
            <div class="tiny muted">司机成本合计</div>
            <div class="dsp" style="font-size: 24px; font-weight: 700; margin-top: 4px">{{ compactMoney(driver.total) }}</div>
            <div class="tiny muted mono mt6">占收入 {{ pct(driver.revenueShare, 1) }}</div>
          </div></div>
          <div class="card"><div class="card__bd">
            <div class="tiny muted">提成 + 出车补贴</div>
            <div class="dsp" style="font-size: 24px; font-weight: 700; margin-top: 4px">{{ compactMoney(driver.commTotal) }}</div>
            <div class="tiny muted mono mt6">{{ num(driver.comm.length) }} 条出车记录</div>
          </div></div>
          <div class="card"><div class="card__bd">
            <div class="tiny muted">底薪 + 社保 + 全勤</div>
            <div class="dsp" style="font-size: 24px; font-weight: 700; margin-top: 4px">{{ compactMoney(driver.baseTotal + driver.socialTotal + driver.bonusTotal) }}</div>
            <div class="tiny muted mono mt6">{{ months.length }} 个月 × {{ 24 }} 人</div>
          </div></div>
          <div class="card"><div class="card__bd">
            <div class="tiny muted">固定 / 变动 比例</div>
            <div class="dsp" style="font-size: 24px; font-weight: 700; margin-top: 4px">
              {{ pct(driver.total ? (driver.baseTotal + driver.socialTotal + driver.bonusTotal) / driver.total : 0, 0) }}
              <small class="tiny muted2">/ {{ pct(driver.total ? driver.commTotal / driver.total : 0, 0) }}</small>
            </div>
            <div class="tiny muted mono mt6">底薪不随出车减少</div>
          </div></div>
        </div>
        <div class="card">
          <div class="card__hd"><div class="card__title">人力成本结构</div></div>
          <div class="card__bd" style="display: flex; justify-content: center">
            <DonutChart
              :size="158"
              :thickness="17"
              center-label="人力合计"
              :center-value="compactMoney(driver.total)"
              :items="[
                { key: 'base', label: '基本工资', value: driver.baseTotal, color: '#6366f1' },
                { key: 'social', label: '社保公积金', value: driver.socialTotal, color: '#8b5cf6' },
                { key: 'bonus', label: '全勤/安全奖', value: driver.bonusTotal, color: '#06b6d4' },
                { key: 'comm', label: '提成+补贴', value: driver.commTotal, color: '#f59e0b' },
              ]"
            />
          </div>
          <div class="card__ft tiny muted2">
            底薪与社保是刚性支出：出车率下降时，单公里人力成本会被动上升。
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__hd">
          <div class="card__title"><Icon name="driver" :size="15" />司机成本排行</div>
          <div class="card__sub spacer">含底薪 + 社保 + 提成</div>
        </div>
        <BarList :items="driver.ranking" :format="(v) => compactMoney(v)" :show-pct="false" />
      </div>
    </template>

    <!-- ============ 固定成本 ============ -->
    <template v-else-if="cat === 'fixed'">
      <div class="grid grid--kpi">
        <div class="card"><div class="card__bd">
          <div class="tiny muted">固定成本合计</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ compactMoney(fixed.total) }}</div>
          <div class="tiny muted mono mt6">{{ fixed.activeMonths }} 个月计提</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">占本期总成本</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ pct(fixed.costShare, 1) }}</div>
          <div class="tiny muted mono mt6">停驶也在发生</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">单车月均</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ yuan(fixed.perVehicleMonth) }}</div>
          <div class="tiny muted mono mt6">{{ VEHICLES.length }} 台在册</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">单车日均</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ yuan(fixed.perVehicleMonth / 30) }}</div>
          <div class="tiny muted mono mt6">出车与否都要付</div>
        </div></div>
      </div>

      <div class="card">
        <div class="card__hd">
          <div class="card__title"><Icon name="wallet" :size="15" />固定成本构成</div>
          <div class="card__sub spacer">按月计提</div>
        </div>
        <BarList :items="fixed.byKind" :format="(v) => compactMoney(v)" />
      </div>
    </template>

    <!-- ============ 维保 ============ -->
    <template v-else>
      <div class="grid grid--kpi">
        <div class="card"><div class="card__bd">
          <div class="tiny muted">维保合计</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ compactMoney(maint.total) }}</div>
          <div class="tiny muted mono mt6">单公里 {{ maint.perKm.toFixed(3) }} 元</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">进厂工单</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ num(maint.orders) }}</div>
          <div class="tiny muted mono mt6">{{ compactMoney(maint.serviceTotal) }}</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">耗材摊销</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ compactMoney(maint.consumableTotal) }}</div>
          <div class="tiny muted mono mt6">轮胎 / 尿素 / 机油</div>
        </div></div>
        <div class="card"><div class="card__bd">
          <div class="tiny muted">占本期总成本</div>
          <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ pct(S.cur.cost ? maint.total / S.cur.cost : 0, 1) }}</div>
          <div class="tiny muted mono mt6">大修会显著拉高</div>
        </div></div>
      </div>

      <div class="card">
        <div class="card__hd">
          <div class="card__title"><Icon name="wrench" :size="15" />工单项目 TOP 5</div>
          <div class="card__sub spacer">按期归集</div>
        </div>
        <BarList v-if="maint.topItems.length" :items="maint.topItems" :format="(v) => compactMoney(v)" />
        <div v-else class="empty"><div class="empty__t">本期内没有进厂工单</div></div>
      </div>
    </template>

    <!-- 明细流水 -->
    <div>
      <SectionHead :title="`${cat.name}明细`" :desc="`共 ${flow.length} 条 · 按时间倒序`">
        <template #aside>
          <button class="btn btn--primary btn--sm" @click="openEntry(cat)">
            <Icon name="plus" :size="13" :sw="2.3" />录入{{ cat.name }}
          </button>
        </template>
      </SectionHead>

      <div class="card">
        <div v-if="visibleFlow.length">
          <div v-for="x in visibleFlow" :key="x.id" class="lrow">
            <div class="ibox" :style="{ '--ibox-fg': x.color, '--ibox-bg': x.color + '1f' }">
              <Icon :name="x.icon" :size="16" />
            </div>
            <div class="lrow__main">
              <div class="lrow__ttl">{{ x.title }}</div>
              <div class="lrow__sub">{{ x.sub }}</div>
            </div>
            <div class="lrow__end">
              <div class="lrow__amt">{{ yuan(x.amount) }}</div>
              <div class="lrow__meta" :style="x.warn ? 'color: var(--amber)' : ''">
                {{ md(x.date) }} · {{ x.extra }}
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty">
          <div class="empty__t">本期该科目没有流水</div>
          <div class="empty__d">换个周期，或点「录入」加一笔试试</div>
        </div>

        <div v-if="flow.length > shown" class="card__ft center">
          <button class="btn btn--ghost btn--sm" @click="shown += 24">
            显示更多（还有 {{ flow.length - shown }} 条）
          </button>
        </div>
      </div>
    </div>

    <!-- 手工录入 -->
    <div v-if="manual.length" class="card">
      <div class="card__hd">
        <div class="card__title"><Icon name="plus" :size="15" />手工录入记录</div>
        <div class="card__sub spacer">仅存于本页内存</div>
      </div>
      <div v-for="x in manual" :key="x.seq" class="lrow">
        <div class="ibox" :style="{ '--ibox-fg': CAT_MAP[x.fuel ? 'fuel' : x.toll ? 'toll' : x.driver ? 'driver' : x.maint ? 'maint' : 'fixed'].color }">
          <Icon :name="CAT_MAP[x.fuel ? 'fuel' : x.toll ? 'toll' : x.driver ? 'driver' : x.maint ? 'maint' : 'fixed'].icon" :size="16" />
        </div>
        <div class="lrow__main">
          <div class="lrow__ttl">
            {{ VEHICLE_MAP[x.v]?.plate || DRIVER_MAP[x.dr]?.name || '—' }} ·
            {{ CAT_MAP[x.fuel ? 'fuel' : x.toll ? 'toll' : x.driver ? 'driver' : x.maint ? 'maint' : 'fixed'].name }}
          </div>
          <div class="lrow__sub">{{ x.note || '手工录入' }}</div>
        </div>
        <div class="lrow__end">
          <div class="lrow__amt">{{ yuan(x.var || x.fixedManual) }}</div>
          <div class="lrow__meta">{{ md(x.d) }}</div>
        </div>
      </div>
    </div>

    <div class="note">
      <Icon name="info" :size="16" style="flex: 0 0 auto; margin-top: 1px" />
      <div>
        加油明细按「车 + 4 天」聚合（600L 油箱约 1800 km 加一次），过路费按实际通行笔数展开，
        固定成本与司机底薪按<b>日历天</b>计提 —— 所以本期停驶的车同样出现在固定成本明细里。
        所有明细相加与报表合计完全一致。
      </div>
    </div>
  </div>
</template>
