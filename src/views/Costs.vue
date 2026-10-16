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
 * 折旧和人工是「按月」的概念，其余是按日的流水，所以统一按月份看。
 */
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import Chips from '../components/Chips.vue'
import DonutChart from '../components/DonutChart.vue'
import BarList from '../components/BarList.vue'
import CostForm from '../components/CostForm.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { vehicles } from '../store/vehicles.js'
import { drivers } from '../store/drivers.js'
import { trips } from '../store/trips.js'
import { costs, addCost, updateCost, removeCost } from '../store/costs.js'
import { findVehicle } from '../store/vehicles.js'
import { costSummary, costBreakdown, availableMonths } from '../utils/costModel.js'
import { COST_COLORS, purposeName } from '../data/costs.js'
import { num, yuan } from '../utils/format.js'
import { monthOf } from '../utils/costModel.js'

/* ---------------- 月份 ---------------- */
const months = computed(() => availableMonths({ trips, costs }))
const month = ref(months.value[0])

/** 月份选项显示成「2026 年 10 月」，近 6 个月用短标签 */
const monthOptions = computed(() => {
  const list = months.value.slice(0, 12)
  return list.map((m, i) => {
    const [y, mm] = m.split('-')
    return { key: m, name: i === 0 ? `本月 ${mm} 月` : `${y.slice(2)} 年 ${Number(mm)} 月` }
  })
})

/* ---------------- 汇总 ---------------- */
const data = computed(() => ({ vehicles, drivers, trips, costs }))
const summary = computed(() => costSummary(data.value, month.value))
const breakdown = computed(() => costBreakdown(summary.value))

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
        ? `${vehicles.length} 台在册 · 占 ${pct(s.depreciation, s.total)}`
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

const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(0) + '%' : '—')

/* ---------------- 按车辆 ---------------- */
const vehicleBars = computed(() =>
  summary.value.vehicleRows
    .filter((v) => v.total > 0)
    .map((v) => {
      const segs = [
        { key: 'dep', label: '折旧', value: v.depreciation, color: COST_COLORS.depreciation },
        { key: 'fuel', label: '油耗', value: v.fuel, color: COST_COLORS.fuel },
        { key: 'toll', label: '过路费', value: v.toll, color: COST_COLORS.toll },
        { key: 'part', label: '配件', value: v.part, color: COST_COLORS.part },
        { key: 'doc', label: '证件', value: v.doc, color: COST_COLORS.doc },
      ].filter((s) => s.value > 0)
      return {
        key: v.id,
        label: v.plate,
        sub: v.type,
        value: v.total,
        segments: segs,
        raw: v,
      }
    })
)

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
    if (m && m !== month.value && months.value.includes(m)) month.value = m
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
          折旧 + 人工 + 油耗 + 过路费 + 手工录入 · 按月份看
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
      <!-- 月份 -->
      <div class="chips-row">
        <Chips v-model="month" :options="monthOptions" />
      </div>

      <!-- 汇总 -->
      <div class="grid grid--kpi">
        <div
          v-for="(c, i) in cards"
          :key="c.l"
          class="vsum reveal"
          :style="{ '--d': i * 45 + 'ms' }"
        >
          <div class="vsum__l">{{ c.l }}</div>
          <div class="vsum__v" :class="[c.tone ? 'is-' + c.tone : '', { 'is-placeholder': c.v === '—' }]">
            {{ c.v }}
          </div>
          <div class="vsum__s">{{ c.s }}</div>
        </div>
      </div>

      <!-- 图表：构成 + 按车辆 -->
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
            <div v-else class="empty empty--sm">
              <div class="empty__d">这个月还没有产生任何成本</div>
            </div>
          </div>
          <div v-if="breakdown.length" class="card__ft">
            <span class="legend-note">占比按金额算 · 折旧与人工是按月计提，不随趟次波动</span>
          </div>
        </div>

        <div class="card">
          <div class="card__hd">
            <div class="card__title"><Icon name="truck" :size="15" />按车辆</div>
            <div class="card__sub spacer">{{ vehicleBars.length }} 台有成本</div>
          </div>
          <div class="card__bd">
            <BarList
              :items="vehicleBars"
              :limit="8"
              :format="(v) => '¥' + num(v, 0)"
            />
          </div>
          <div v-if="vehicleBars.length" class="card__ft">
            <div class="seglegend">
              <span v-for="s in [
                { l: '折旧', c: COST_COLORS.depreciation },
                { l: '油耗', c: COST_COLORS.fuel },
                { l: '过路费', c: COST_COLORS.toll },
                { l: '配件', c: COST_COLORS.part },
                { l: '证件', c: COST_COLORS.doc },
              ]" :key="s.l" class="seglegend__i">
                <i :style="{ background: s.c }" />{{ s.l }}
              </span>
            </div>
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
                  <td style="text-align: left">
                    <span class="ptag" :class="'ptag--' + r.c.purpose">{{ purposeName(r.c.purpose) }}</span>
                  </td>
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

      <div class="note">
        <Icon name="info" :size="15" />
        <div>
          <b>折旧</b>按 5 年直线法、残值 10% 计提：当月还没买的车不计，提满 5 年的车也不再计。<br />
          <b>油耗成本</b>用的是每趟录入的油费单价，没填单价的趟次算不出油费，会让油耗成本偏低。<br />
          <b>过路费</b>单独列一项，没有并进油耗里。
        </div>
      </div>
    </template>

    <CostForm
      :open="formOpen"
      :cost="editing"
      @close="formOpen = false; editing = null"
      @saved="onSaved"
    />

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

/* 图表两栏 */
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

/* 用途标签 */
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

/* 移动端卡片 */
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
  font-size: 13px;
  font-weight: 650;
}
.rdate {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-3);
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
