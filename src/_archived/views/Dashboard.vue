<script setup>
/**
 * 运营总览：车队成本的第一屏。
 * 移动端一列到底，桌面端自动变两栏。
 */
import { computed, ref } from 'vue'
import {
  PERIODS, resolveRange, summarizeWithPrev, costStructure, dailySeries, monthlySeries,
  monthsIn, byVehicle, fleetStatus, alerts, rangeLabel,
} from '../store/fleet.js'
import { TODAY } from '../data/mock.js'
import { compactMoney, scaleMoney, num, pct, yuan, deltaInfo, ptDelta, md } from '../utils/format.js'
import { openEntry } from '../store/ui.js'
import { query } from '../router.js'
import { CHART, TONE } from '../utils/palette.js'
import KpiTile from '../components/KpiTile.vue'
import AreaChart from '../components/AreaChart.vue'
import DonutChart from '../components/DonutChart.vue'
import BarList from '../components/BarList.vue'
import SectionHead from '../components/SectionHead.vue'
import SegControl from '../components/SegControl.vue'
import Icon from '../components/Icon.vue'

const period = ref(query('period', 'mtd'))
const range = computed(() => resolveRange(period.value))
const S = computed(() => summarizeWithPrev(range.value))
const struct = computed(() => costStructure(S.value.cur))
const status = computed(() => fleetStatus())
const alertsList = computed(() => alerts(range.value.s, range.value.e))

/** 区间跨度大时改用「按月」粒度画趋势，否则 365 个点全是噪点 */
const trend = computed(() => {
  const r = range.value
  const days = Math.round((r.e - r.s) / 86400000) + 1
  if (days <= 100) {
    const ds = dailySeries(r.s, r.e)
    return {
      grain: 'day',
      labels: ds.map((d) => md(d.date)),
      rev: ds.map((d) => d.rev),
      cost: ds.map((d) => d.cost),
      km: ds.map((d) => d.km),
      tipFmt: (v) => yuan(v),
    }
  }
  const ms = monthlySeries(monthsIn(r.s, r.e))
  return {
    grain: 'month',
    labels: ms.map((m) => m.full.replace(/^\d{4}年/, '')),
    rev: ms.map((m) => m.rev),
    cost: ms.map((m) => m.cost),
    km: ms.map((m) => m.km),
    tipFmt: (v) => yuan(v),
  }
})

const chartSeries = computed(() => [
  { key: 'rev', name: '营业收入', color: CHART.rev, values: trend.value.rev },
  { key: 'cost', name: '总成本', color: CHART.cost, values: trend.value.cost },
])

const kpis = computed(() => {
  const { cur, d } = S.value
  const ps = scaleMoney
  const rv = ps(cur.rev)
  const ct = ps(cur.cost)
  const pf = ps(cur.profit)
  return {
    rv, ct, pf,
    dRev: deltaInfo(d.rev, { goodWhen: 'up' }),
    dCost: deltaInfo(d.cost, { goodWhen: 'down' }),
    dProfit: deltaInfo(d.profit, { goodWhen: 'up' }),
    dMargin: ptDelta(d.marginPts),
  }
})

/** 效率指标条 */
const mini = computed(() => {
  const { cur, prev } = S.value
  return [
    { label: '行驶里程', v: num(cur.km), u: 'km', sub: `环比 ${deltaInfo(S.value.d.km, { goodWhen: 'up' }).txt}` },
    { label: '单公里成本', v: cur.costPerKm.toFixed(2), u: '元/km', sub: `收入 ${cur.revPerKm.toFixed(2)} 元/km` },
    { label: '百公里油耗', v: cur.per100.toFixed(1), u: 'L', sub: `上期 ${prev.per100.toFixed(1)} L` },
    { label: '车日均里程', v: num(cur.avgKm), u: 'km', sub: `出车 ${num(cur.activeDays)} 车日` },
    { label: '单车月均成本', v: compactMoney((cur.cost / cur.vehicles) * (30 / Math.max(1, Math.round((cur.e - cur.s) / 86400000) + 1))), u: '', sub: `${cur.vehicles} 台在册` },
  ]
})

/** 单车成本排行（取成本最高的 5 台） */
const topVehicles = computed(() =>
  byVehicle(range.value.s, range.value.e)
    .filter((v) => v.km > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)
    .map((v) => ({
      key: v.id,
      label: `${v.plate} · ${v.driverName}`,
      value: v.cost,
      color: v.margin < 0.02 ? 'var(--red)' : v.margin < 0.1 ? 'var(--amber)' : 'var(--c-toll)',
      sub: `毛利 ${pct(v.margin)} · ${num(v.km)} km`,
      badge: v.margin < 0.02 ? { cls: 'pill--warn', text: '亏损' } : null,
    }))
)

const alertTone = TONE
const catIcon = { fuel: 'fuel', toll: 'toll', driver: 'driver', fixed: 'wallet', maint: 'wrench' }

const costMixNote = computed(() => {
  const c = S.value.cur
  const top = struct.value[0]
  return `${top.name}占 ${pct(top.pct, 1)}，是本期最大的成本项`
})
</script>

<template>
  <div class="stack">
    <!-- 标题 + 周期 -->
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">运营总览</h1>
        <div class="page-head__desc">{{ rangeLabel(range) }} · 口径：变动成本按出车日、固定成本按日历天计提</div>
      </div>
      <SegControl v-model="period" :options="PERIODS" />
    </div>

    <!-- 主 KPI -->
    <div class="grid grid--kpi">
      <KpiTile
        class="reveal"
        style="--d: 0ms"
        label="营业收入"
        :value="kpis.rv.value"
        :unit="kpis.rv.unit"
        :decimals="kpis.rv.d"
        :accent="CHART.rev"
        tint="rgba(79,70,229,.12)"
        icon="trend"
        :delta="kpis.dRev"
        :spark="trend.rev"
      />
      <KpiTile
        class="reveal"
        style="--d: 60ms"
        label="总成本"
        :value="kpis.ct.value"
        :unit="kpis.ct.unit"
        :decimals="kpis.ct.d"
        :accent="CHART.cost"
        tint="rgba(245,158,11,.13)"
        icon="cost"
        :delta="kpis.dCost"
        :spark="trend.cost"
      />
      <KpiTile
        class="reveal"
        style="--d: 120ms"
        label="毛利"
        :value="kpis.pf.value"
        :unit="kpis.pf.unit"
        :decimals="kpis.pf.d"
        :accent="CHART.profit"
        tint="rgba(6,182,212,.12)"
        icon="wallet"
        :delta="kpis.dProfit"
      />
      <KpiTile
        class="reveal"
        style="--d: 180ms"
        label="毛利率"
        :value="S.cur.margin * 100"
        unit="%"
        :decimals="1"
        :accent="CHART.margin"
        tint="rgba(139,92,246,.12)"
        icon="gauge"
        :delta="kpis.dMargin"
      />
    </div>

    <!-- 效率指标条 -->
    <div class="card card--clip reveal" style="--d: 220ms">
      <div class="mini-strip">
        <div v-for="m in mini" :key="m.label" class="mini-strip__i">
          <div class="tiny muted">{{ m.label }}</div>
          <div class="mt6">
            <span class="dsp" style="font-size: 19px; font-weight: 700">{{ m.v }}</span>
            <span v-if="m.u" class="tiny muted2 mono" style="margin-left: 3px">{{ m.u }}</span>
          </div>
          <div class="tiny muted mono mt6">{{ m.sub }}</div>
        </div>
      </div>
    </div>

    <!-- 趋势 + 成本结构 -->
    <div class="grid grid--2-1">
      <div class="card reveal" style="--d: 260ms">
        <div class="card__tag">{{ trend.grain === 'day' ? 'DAILY' : 'MONTHLY' }}</div>
        <div class="card__hd">
          <div class="card__title"><Icon name="trend" :size="15" />收入与成本趋势</div>
          <div class="spacer legend">
            <span class="legend__i"><i class="legend__k" :style="{ background: CHART.rev }" />收入</span>
            <span class="legend__i"><i class="legend__k" :style="{ background: CHART.cost }" />成本</span>
          </div>
        </div>
        <div class="card__bd" style="padding-top: 8px">
          <AreaChart
            :labels="trend.labels"
            :series="chartSeries"
            :height="216"
            :y-format="(v) => (v >= 10000 ? (v / 10000).toFixed(0) + '万' : Math.round(v))"
            :tip-format="trend.tipFmt"
          />
          <div class="hr hr--dash" />
          <div class="row row--wrap tiny muted2">
            <span>趋势单位：元。成本含按天摊入的固定成本与司机底薪。</span>
            <span class="spacer mono">{{ trend.grain === 'day' ? '按日' : '按月' }}</span>
          </div>
        </div>
      </div>

      <div class="card reveal" style="--d: 320ms">
        <div class="card__hd">
          <div class="card__title"><Icon name="layers" :size="15" />成本结构</div>
          <div class="card__sub spacer">{{ compactMoney(S.cur.cost) }}</div>
        </div>
        <div class="card__bd">
          <div style="display: flex; justify-content: center">
            <DonutChart
              :items="struct"
              :size="168"
              :thickness="18"
              center-label="总成本"
              :center-value="compactMoney(S.cur.cost)"
            />
          </div>
          <div class="mt14">
            <div v-for="c in struct" :key="c.key" class="crow" style="padding: 9px 0">
              <div class="crow__top">
                <i class="legend__k" :style="{ background: c.color, width: '9px', height: '9px' }" />
                <span class="crow__nm">{{ c.name }}</span>
                <span class="crow__pct">{{ pct(c.pct, 1) }}</span>
                <span class="crow__amt" style="margin-left: 10px">{{ compactMoney(c.value) }}</span>
              </div>
              <div class="bar" style="height: 4px">
                <i class="bar__fill" :style="{ width: pct(c.pct / (struct[0].pct || 1), 2), background: c.color }" />
              </div>
            </div>
          </div>
          <div class="hr hr--dash" />
          <div class="tiny muted2">{{ costMixNote }}</div>
        </div>
      </div>
    </div>

    <!-- 单车成本 + 预警 -->
    <div class="grid grid--2">
      <div class="card reveal" style="--d: 360ms">
        <div class="card__hd">
          <div class="card__title"><Icon name="truck" :size="15" />单车成本 TOP 5</div>
          <div class="card__sub spacer">{{ rangeLabel(range).slice(0, 10) }} 起</div>
        </div>
        <BarList :items="topVehicles" :format="(v) => compactMoney(v)" />
        <div class="card__ft tiny muted2">
          毛利为负或接近 0 的车会用红色高亮 —— 通常意味着线路不匹配、配载不足或车况老化。
        </div>
      </div>

      <div class="card reveal" style="--d: 400ms">
        <div class="card__hd">
          <div class="card__title"><Icon name="alert" :size="15" />经营预警</div>
          <div class="card__sub spacer">{{ alertsList.length }} 条</div>
        </div>
        <div v-if="alertsList.length">
          <div v-for="(a, i) in alertsList" :key="i" class="lrow">
            <div
              class="ibox"
              :style="{
                '--ibox-fg': alertTone[a.level],
                '--ibox-bg': alertTone[a.level] + '1f',
              }"
            >
              <Icon :name="catIcon[a.cat] || 'alert'" :size="16" />
            </div>
            <div class="lrow__main">
              <div class="lrow__ttl">{{ a.title }}</div>
              <div class="lrow__sub" style="white-space: normal">{{ a.desc }}</div>
            </div>
          </div>
        </div>
        <div v-else class="empty">
          <div class="empty__t">本期没有需要关注的异常</div>
        </div>
      </div>
    </div>

    <!-- 车队实况 -->
    <div class="card reveal" style="--d: 440ms">
      <div class="card__hd">
        <div class="card__title"><Icon name="truck" :size="15" />车队实况</div>
        <div class="card__sub spacer">{{ TODAY.getFullYear() }}/{{ TODAY.getMonth() + 1 }}/{{ TODAY.getDate() }}</div>
      </div>
      <div class="card__bd">
        <div class="sbar">
          <i
            v-for="s in status"
            :key="s.key"
            class="sbar__seg"
            :style="{ flexGrow: s.count, background: s.color }"
          />
        </div>
        <div class="grid grid--kpi mt14" style="gap: 10px">
          <div v-for="s in status" :key="s.key" class="stat-mini" style="flex-direction: column; align-items: flex-start; gap: 2px">
            <span class="pill" :class="s.pill"><i class="pill__dot" />{{ s.name }}</span>
            <span class="mt6">
              <span class="stat-mini__v">{{ s.count }}</span>
              <span class="stat-mini__l"> 台 · {{ pct(s.pct, 0) }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 口径说明 -->
    <div class="note">
      <Icon name="info" :size="16" style="flex: 0 0 auto; margin-top: 1px" />
      <div>
        <b>演示数据说明：</b>全部数据由本地算法按真实运营逻辑生成（固定种子，刷新不变），不含任何后端。
        成本按两个口径分别计提 —— 油耗 / 过路费 / 司机提成 / 维保挂在<b>出车日</b>，
        保险 / 折旧 / 车贷与司机底薪按<b>日历天</b>计提，所以停驶的车同样在消耗固定成本。
        点右下角「记一笔」录入的成本会立刻进入所有报表。
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini-strip {
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
}
.mini-strip::-webkit-scrollbar {
  display: none;
}
.mini-strip__i {
  flex: 1 0 auto;
  min-width: 128px;
  padding: 13px 16px;
  border-right: 1px solid var(--line);
}
.mini-strip__i:last-child {
  border-right: 0;
}
</style>
