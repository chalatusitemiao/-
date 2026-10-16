<script setup>
/**
 * 经营报表：同一套数据切三个维度（车辆 / 线路 / 司机）看，
 * 支持表头点击排序、一键导出 CSV（纯前端 Blob，不走服务端）。
 */
import { computed, ref } from 'vue'
import {
  REPORTS_PERIODS, resolveRange, summarizeWithPrev, byVehicle, byDriver, byRoute,
  monthlySeries, lastMonths, costStructure, exportCsv, rangeLabel, monthLabel,
} from '../store/fleet.js'
import { CATS } from '../data/mock.js'
import { compactMoney, num, pct, yuan, deltaInfo, ptDelta } from '../utils/format.js'
import SegControl from '../components/SegControl.vue'
import { query } from '../router.js'
import SectionHead from '../components/SectionHead.vue'
import StackedBars from '../components/StackedBars.vue'
import Icon from '../components/Icon.vue'
import KpiTile from '../components/KpiTile.vue'

const period = ref(query('period', 'qtd'))
const dim = ref(['vehicle', 'route', 'driver'].includes(query('dim')) ? query('dim') : 'vehicle')
const range = computed(() => resolveRange(period.value))
const S = computed(() => summarizeWithPrev(range.value))

/* ---------------- 维度定义 ---------------- */
const DIMS = {
  vehicle: {
    name: '按车辆',
    unit: '台',
    items: (s, e) => byVehicle(s, e).filter((x) => x.km > 0),
    columns: [
      { k: 'plate', l: '车牌 / 主驾', title: (r) => r.plate, sub: (r) => `${r.driverName} · ${r.type}`, csv: (r) => r.plate },
      { k: 'km', l: '里程', f: (r) => num(r.km), csv: (r) => r.km },
      { k: 'days', l: '出车', f: (r) => r.days + ' 天', csv: (r) => r.days },
      { k: 'rev', l: '收入', f: (r) => num(r.rev), csv: (r) => r.rev },
      { k: 'fuel', l: '油耗', f: (r) => num(r.fuel), csv: (r) => r.fuel },
      { k: 'toll', l: '过路费', f: (r) => num(r.toll), csv: (r) => r.toll },
      { k: 'driver', l: '司机成本', f: (r) => num(r.driver), csv: (r) => r.driver },
      { k: 'fixed', l: '固定成本', f: (r) => num(r.fixed), csv: (r) => r.fixed },
      { k: 'maint', l: '维保', f: (r) => num(r.maint), csv: (r) => r.maint },
      { k: 'cost', l: '总成本', f: (r) => num(r.cost), csv: (r) => r.cost, strong: true },
      { k: 'profit', l: '毛利', f: (r) => num(r.profit), csv: (r) => r.profit },
      { k: 'margin', l: '毛利率', f: (r) => pct(r.margin), csv: (r) => (r.margin * 100).toFixed(2) + '%' },
      { k: 'costPerKm', l: '元/km', f: (r) => r.costPerKm.toFixed(2), csv: (r) => r.costPerKm.toFixed(2) },
      { k: 'per100', l: 'L/100km', f: (r) => r.per100.toFixed(1), csv: (r) => r.per100.toFixed(1) },
    ],
  },
  route: {
    name: '按线路',
    unit: '条',
    items: (s, e) => byRoute(s, e),
    columns: [
      { k: 'name', l: '线路 / 货物', title: (r) => r.name, sub: (r) => `${r.cargo} · ${r.seg}`, csv: (r) => r.name },
      { k: 'distance', l: '单程', f: (r) => num(r.distance) + ' km', csv: (r) => r.distance },
      { k: 'trips', l: '车次', f: (r) => num(r.trips), csv: (r) => r.trips },
      { k: 'km', l: '总里程', f: (r) => num(r.km), csv: (r) => r.km },
      { k: 'rev', l: '收入', f: (r) => num(r.rev), csv: (r) => r.rev },
      { k: 'fuel', l: '油耗', f: (r) => num(r.fuel), csv: (r) => r.fuel },
      { k: 'toll', l: '过路费', f: (r) => num(r.toll), csv: (r) => r.toll },
      { k: 'overhead', l: '分摊固定', f: (r) => num(r.overhead), csv: (r) => Math.round(r.overhead) },
      { k: 'cost', l: '总成本', f: (r) => num(r.cost), csv: (r) => Math.round(r.cost), strong: true },
      { k: 'profit', l: '毛利', f: (r) => num(r.profit), csv: (r) => Math.round(r.profit) },
      { k: 'margin', l: '毛利率', f: (r) => pct(r.margin), csv: (r) => (r.margin * 100).toFixed(2) + '%' },
      { k: 'costPerKm', l: '元/km', f: (r) => r.costPerKm.toFixed(2), csv: (r) => r.costPerKm.toFixed(2) },
    ],
  },
  driver: {
    name: '按司机',
    unit: '人',
    items: (s, e) => byDriver(s, e).filter((x) => x.km > 0),
    columns: [
      { k: 'name', l: '司机 / 车辆', title: (r) => r.name, sub: (r) => `${r.plate} · 准驾 ${r.license}`, csv: (r) => r.name },
      { k: 'km', l: '里程', f: (r) => num(r.km), csv: (r) => r.km },
      { k: 'days', l: '出车', f: (r) => r.days + ' 天', csv: (r) => r.days },
      { k: 'avgKm', l: '车日均', f: (r) => num(r.avgKm) + ' km', csv: (r) => Math.round(r.avgKm) },
      { k: 'rev', l: '创收', f: (r) => num(r.rev), csv: (r) => r.rev },
      { k: 'commission', l: '提成补贴', f: (r) => num(r.commission), csv: (r) => r.commission },
      { k: 'salary', l: '底薪社保', f: (r) => num(r.salary), csv: (r) => Math.round(r.salary) },
      { k: 'cost', l: '人力合计', f: (r) => num(r.cost), csv: (r) => Math.round(r.cost), strong: true },
      { k: 'costPerKm', l: '元/km', f: (r) => r.costPerKm.toFixed(3), csv: (r) => r.costPerKm.toFixed(3) },
      { k: 'per100', l: 'L/100km', f: (r) => r.per100.toFixed(1), csv: (r) => r.per100.toFixed(1) },
      { k: 'fuelGap', l: '油耗偏差', f: (r) => (r.fuelGap > 0 ? '+' : '') + (r.fuelGap * 100).toFixed(1) + '%', csv: (r) => (r.fuelGap * 100).toFixed(1) + '%' },
      { k: 'safety', l: '安全分', f: (r) => r.safety, csv: (r) => r.safety },
    ],
  },
}

const d = computed(() => DIMS[dim.value])
const sortKey = ref('cost')
const sortDir = ref('desc')

function setSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else {
    sortKey.value = k
    sortDir.value = 'desc'
  }
}

const tableRows = computed(() => {
  const items = d.value.items(range.value.s, range.value.e).slice()
  const k = sortKey.value
  items.sort((a, b) => {
    const x = a[k]
    const y = b[k]
    const r = typeof x === 'string' ? String(x).localeCompare(String(y), 'zh') : (x || 0) - (y || 0)
    return sortDir.value === 'desc' ? -r : r
  })
  return items
})

const numericCols = computed(() => d.value.columns.filter((c) => c.csv))

/* ---------------- 月度趋势 ---------------- */
const months = computed(() => lastMonths(12))
const monthly = computed(() => monthlySeries(months.value))
const stackSeries = computed(() =>
  CATS.map((c) => ({ key: c.key, name: c.name, color: c.color, values: monthly.value.map((m) => m[c.key]) }))
)

/* ---------------- 科目对比 ---------------- */
const cmpRows = computed(() => {
  const cur = S.value.cur
  const prev = S.value.prev
  return costStructure(cur).map((c) => {
    const p = prev[c.key] || 0
    return { ...c, prev: p, chg: p ? (c.value - p) / p : 0 }
  })
})

/* ---------------- 导出 ---------------- */
function doExport() {
  const cols = d.value.columns
  const headers = ['排名', ...cols.map((c) => c.l)]
  const rows = tableRows.value.map((r, i) => [i + 1, ...cols.map((c) => c.csv(r))])
  exportCsv(`车队报表_${d.value.name}_${rangeLabel(range.value).replace(/[^\d-]/g, '')}.csv`, headers, rows)
}

const label = computed(() => `${rangeLabel(range.value)} · ${d.value.name} · 共 ${tableRows.value.length} ${d.value.unit}`)
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">经营报表</h1>
        <div class="page-head__desc">{{ label }}</div>
      </div>
      <div class="row row--wrap">
        <SegControl v-model="period" :options="REPORTS_PERIODS" />
        <button class="btn btn--ghost btn--sm" @click="doExport">
          <Icon name="download" :size="14" />导出 CSV
        </button>
      </div>
    </div>

    <!-- 报表摘要 -->
    <div class="grid grid--kpi">
      <KpiTile
        label="收入" :value="S.cur.rev / 10000" unit="万元" :decimals="1"
        accent="#4f46e5" tint="rgba(79,70,229,.12)"
        :delta="deltaInfo(S.d.rev, { goodWhen: 'up' })"
      />
      <KpiTile
        label="总成本" :value="S.cur.cost / 10000" unit="万元" :decimals="1"
        accent="#f59e0b" tint="rgba(245,158,11,.13)"
        :delta="deltaInfo(S.d.cost, { goodWhen: 'down' })"
      />
      <KpiTile
        label="毛利" :value="S.cur.profit / 10000" unit="万元" :decimals="1"
        accent="#06b6d4" tint="rgba(6,182,212,.12)"
        :delta="deltaInfo(S.d.profit, { goodWhen: 'up' })"
      />
      <KpiTile
        label="毛利率" :value="S.cur.margin * 100" unit="%" :decimals="2"
        accent="#8b5cf6" tint="rgba(139,92,246,.12)"
        :delta="ptDelta(S.d.marginPts)"
      />
    </div>

    <!-- 月度堆叠 -->
    <div class="card">
      <div class="card__tag">12M</div>
      <div class="card__hd">
        <div class="card__title"><Icon name="layers" :size="15" />近 12 个月成本构成</div>
        <div class="card__sub spacer">单位：元</div>
      </div>
      <div class="card__bd" style="padding-top: 10px">
        <StackedBars
          :labels="monthly.map((m) => m.label)"
          :series="stackSeries"
          :height="216"
          :y-format="(v) => (v >= 10000 ? (v / 10000).toFixed(0) + '万' : Math.round(v))"
          :tip-format="(v) => yuan(v)"
        />
        <div class="legend mt14">
          <span v-for="c in CATS" :key="c.key" class="legend__i">
            <i class="legend__k" :style="{ background: c.color }" />{{ c.name }}
          </span>
          <span class="legend__i muted">（{{ monthLabel(months[0]) }} 起，最后一个月为进行中）</span>
        </div>
      </div>
    </div>

    <!-- 科目对比 -->
    <div class="grid grid--2">
      <div class="card card--clip">
        <div class="card__hd">
          <div class="card__title"><Icon name="cost" :size="15" />成本科目对比</div>
          <div class="card__sub spacer">本期 vs 上期</div>
        </div>
        <div class="tbl-wrap">
          <table class="tbl" style="min-width: 420px">
            <thead>
              <tr>
                <th>科目</th>
                <th>本期</th>
                <th>上期</th>
                <th>环比</th>
                <th>占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in cmpRows" :key="c.key">
                <td>
                  <div class="row" style="gap: 7px">
                    <i class="legend__k" :style="{ background: c.color }" />{{ c.name }}
                  </div>
                </td>
                <td class="num strong">{{ num(c.value) }}</td>
                <td class="num muted2">{{ num(c.prev) }}</td>
                <td>
                  <span class="delta" :class="deltaInfo(c.chg, { goodWhen: 'down' }).cls">
                    {{ deltaInfo(c.chg, { goodWhen: 'down' }).txt }}
                  </span>
                </td>
                <td class="num">{{ pct(c.pct, 1) }}</td>
              </tr>
              <tr>
                <td><b>合计</b></td>
                <td class="num strong">{{ num(S.cur.cost) }}</td>
                <td class="num muted2">{{ num(S.prev.cost) }}</td>
                <td>
                  <span class="delta" :class="deltaInfo(S.d.cost, { goodWhen: 'down' }).cls">
                    {{ deltaInfo(S.d.cost, { goodWhen: 'down' }).txt }}
                  </span>
                </td>
                <td class="num">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card card--clip">
        <div class="card__hd">
          <div class="card__title"><Icon name="gauge" :size="15" />运营效率</div>
          <div class="card__sub spacer">本期 / 上期</div>
        </div>
        <div class="tbl-wrap">
          <table class="tbl" style="min-width: 380px">
            <thead>
              <tr><th>指标</th><th>本期</th><th>上期</th><th>环比</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>行驶里程 (km)</td>
                <td class="num strong">{{ num(S.cur.km) }}</td>
                <td class="num muted2">{{ num(S.prev.km) }}</td>
                <td><span class="delta" :class="deltaInfo(S.d.km, { goodWhen: 'up' }).cls">{{ deltaInfo(S.d.km, { goodWhen: 'up' }).txt }}</span></td>
              </tr>
              <tr>
                <td>单公里成本 (元/km)</td>
                <td class="num strong">{{ S.cur.costPerKm.toFixed(3) }}</td>
                <td class="num muted2">{{ S.prev.costPerKm.toFixed(3) }}</td>
                <td><span class="delta" :class="deltaInfo(S.d.costPerKm, { goodWhen: 'down' }).cls">{{ deltaInfo(S.d.costPerKm, { goodWhen: 'down' }).txt }}</span></td>
              </tr>
              <tr>
                <td>单公里收入 (元/km)</td>
                <td class="num strong">{{ S.cur.revPerKm.toFixed(3) }}</td>
                <td class="num muted2">{{ S.prev.revPerKm.toFixed(3) }}</td>
                <td><span class="delta" :class="deltaInfo(S.d.revPerKm, { goodWhen: 'up' }).cls">{{ deltaInfo(S.d.revPerKm, { goodWhen: 'up' }).txt }}</span></td>
              </tr>
              <tr>
                <td>百公里油耗 (L)</td>
                <td class="num strong">{{ S.cur.per100.toFixed(2) }}</td>
                <td class="num muted2">{{ S.prev.per100.toFixed(2) }}</td>
                <td><span class="delta" :class="deltaInfo(S.d.per100, { goodWhen: 'down' }).cls">{{ deltaInfo(S.d.per100, { goodWhen: 'down' }).txt }}</span></td>
              </tr>
              <tr>
                <td>车日均里程 (km)</td>
                <td class="num strong">{{ num(S.cur.avgKm) }}</td>
                <td class="num muted2">{{ num(S.prev.avgKm) }}</td>
                <td><span class="delta" :class="deltaInfo(S.d.km, { goodWhen: 'up' }).cls">{{ deltaInfo(S.d.km, { goodWhen: 'up' }).txt }}</span></td>
              </tr>
              <tr>
                <td>出车车日</td>
                <td class="num strong">{{ num(S.cur.activeDays) }}</td>
                <td class="num muted2">{{ num(S.prev.activeDays) }}</td>
                <td class="muted">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 明细 -->
    <div>
      <SectionHead title="成本明细" :desc="`${tableRows.length} ${d.unit} · 点表头可排序`">
        <template #aside>
          <SegControl v-model="dim" :options="Object.entries(DIMS).map(([k, v]) => ({ key: k, name: v.name }))" ghost />
        </template>
      </SectionHead>

      <div class="card card--clip">
        <div class="tbl-wrap tbl-wrap--cards">
          <table class="tbl">
            <thead>
              <tr>
                <th
                  v-for="(c, ci) in d.columns"
                  :key="c.k"
                  class="is-sortable"
                  :style="ci === 0 ? '' : ''"
                  @click="setSort(c.k)"
                >
                  {{ c.l }}
                  <span v-if="sortKey === c.k" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in tableRows" :key="r.id || i">
                <td>
                  <div class="tbl__name">
                    <span class="tbl__rank">{{ i + 1 }}</span>
                    <span style="min-width: 0">
                      <div style="font-weight: 600">{{ d.columns[0].title(r) }}</div>
                      <div class="tiny muted">{{ d.columns[0].sub(r) }}</div>
                    </span>
                  </div>
                </td>
                <td
                  v-for="c in d.columns.slice(1)"
                  :key="c.k"
                  class="num"
                  :class="{ strong: c.strong }"
                  :data-l="c.l"
                >
                  {{ c.f(r) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card__ft row">
          <span class="tiny muted2">
            合计 {{ num(S.cur.km) }} km · 成本 {{ compactMoney(S.cur.cost) }} · 收入 {{ compactMoney(S.cur.rev) }}
          </span>
          <button class="btn btn--ghost btn--sm spacer" @click="doExport">
            <Icon name="download" :size="13" />导出
          </button>
        </div>
      </div>
    </div>

    <div class="note">
      <Icon name="info" :size="16" style="flex: 0 0 auto; margin-top: 1px" />
      <div>
        线路维度的固定成本与司机底薪按<b>里程占比</b>分摊；车辆维度按车辆实际发生额直接归属；
        司机维度把「里程提成 + 出车补贴」与「底薪 + 社保 + 全勤」合并为人力合计。
        导出为 UTF-8 BOM 的 CSV，Excel 直接双击不乱码。
      </div>
    </div>
  </div>
</template>
