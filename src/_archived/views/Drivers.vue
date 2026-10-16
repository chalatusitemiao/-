<script setup>
/**
 * 司机管理：人不只是「工资」，而是油耗、安全与车效的变量。
 * 所以这里把人力成本、单公里人力成本、油耗偏差、安全分放在一起看。
 */
import { computed, ref } from 'vue'
import { PERIODS, resolveRange, byDriver, summarize, rangeLabel } from '../store/fleet.js'
import { DRIVERS } from '../data/mock.js'
import { vehicleMap as VEHICLE_MAP } from '../store/vehicles.js'
import { compactMoney, num, pct, yuan } from '../utils/format.js'
import { openEntry } from '../store/ui.js'
import { query } from '../router.js'
import SegControl from '../components/SegControl.vue'
import SectionHead from '../components/SectionHead.vue'
import BarList from '../components/BarList.vue'
import SheetModal from '../components/SheetModal.vue'
import Icon from '../components/Icon.vue'

const period = ref(query('period', 'mtd'))
const q = ref('')
/** 支持深链：#/drivers?d=D03 直接打开某位司机的详情 */
const picked = ref(null)

const PERIOD_OPTS = PERIODS.filter((p) => ['d30', 'mtd', 'qtd', 'y12'].includes(p.key))
const range = computed(() => resolveRange(period.value))
const S = computed(() => summarize(range.value.s, range.value.e))
const list = computed(() => byDriver(range.value.s, range.value.e))

// 深链直达：地址栏带 ?d=D03 时打开就展开该司机详情
const _pd = query('d')
if (_pd) picked.value = list.value.find((d) => d.id === _pd) || null

const active = computed(() => list.value.filter((d) => d.km > 0))

const filtered = computed(() => {
  const kw = q.value.trim()
  return active.value
    .filter((d) => (kw ? d.name.includes(kw) || d.plate.includes(kw) : true))
    .sort((a, b) => b.rev - a.rev)
})

const summary = computed(() => {
  const n = active.value.length || 1
  const cost = active.value.reduce((a, d) => a + d.cost, 0)
  const km = active.value.reduce((a, d) => a + d.km, 0)
  const rev = active.value.reduce((a, d) => a + d.rev, 0)
  return {
    n: active.value.length,
    avgKm: km / n,
    avgRev: rev / n,
    cost,
    costShare: S.value.rev ? cost / S.value.rev : 0,
    revPerPerson: rev / n,
    costPerKm: km ? cost / km : 0,
    idle: DRIVERS.length - active.value.length,
  }
})

/* 人效排行：按人均创收 */
const ranking = computed(() =>
  active.value
    .slice()
    .sort((a, b) => b.rev - a.rev)
    .slice(0, 6)
    .map((d) => ({
      key: d.id,
      label: `${d.name} · ${d.plate}`,
      value: d.rev,
      color: d.per100 > (VEHICLE_MAP[d.vehicleId]?.normFuel || 0) * 1.08 ? 'var(--amber)' : 'var(--c-driver)',
      sub: `${num(d.km)} km · ${d.days} 天出车 · 人力 ${d.costPerKm.toFixed(3)} 元/km`,
    }))
)

/* 油耗偏差榜（管理抓手：同车型油耗差异） */
const fuelGap = computed(() =>
  active.value
    .filter((d) => d.fuelGap > 0.03)
    .sort((a, b) => b.fuelGap - a.fuelGap)
    .slice(0, 5)
    .map((d) => ({
      key: d.id,
      label: `${d.name} · ${d.plate}`,
      value: d.fuelGap,
      color: d.fuelGap > 0.12 ? 'var(--red)' : 'var(--amber)',
      sub: `实际 ${d.per100.toFixed(1)} L · 基准 ${(d.per100 / (1 + d.fuelGap)).toFixed(1)} L`,
    }))
)

const tone = (s) => (s >= 90 ? 'var(--green)' : s >= 80 ? 'var(--amber)' : 'var(--red)')

/** 司机详情 */
const detail = computed(() => {
  if (!picked.value) return null
  const d = picked.value
  const rows = S.value.rows.filter((r) => r.dr === d.id)
  const r = range.value
  const days = Math.round((r.e - r.s) / 86400000) + 1
  const bucket = days <= 45 ? 1 : Math.ceil(days / 30)
  const nb = Math.ceil(days / bucket)
  const kmArr = new Array(nb).fill(0)
  rows.forEach((row) => {
    const b = Math.min(nb - 1, Math.floor((row.ts - r.s.getTime()) / 86400000 / bucket))
    kmArr[b] += row.km
  })
  return { d, kmArr, trips: rows.length }
})
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">司机管理</h1>
        <div class="page-head__desc">{{ rangeLabel(range) }} · 在册 {{ DRIVERS.length }} 人，本期出车 {{ summary.n }} 人</div>
      </div>
      <SegControl v-model="period" :options="PERIOD_OPTS" />
    </div>

    <!-- 概览 -->
    <div class="grid grid--kpi">
      <div class="card"><div class="card__bd">
        <div class="tiny muted">本期人力成本</div>
        <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ compactMoney(summary.cost) }}</div>
        <div class="tiny mono muted mt6">占收入 {{ pct(summary.costShare, 1) }}</div>
      </div></div>
      <div class="card"><div class="card__bd">
        <div class="tiny muted">人均创收</div>
        <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ compactMoney(summary.revPerPerson) }}</div>
        <div class="tiny mono muted mt6">人均 {{ num(summary.avgKm) }} km</div>
      </div></div>
      <div class="card"><div class="card__bd">
        <div class="tiny muted">单公里人力成本</div>
        <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ summary.costPerKm.toFixed(3) }}</div>
        <div class="tiny mono muted mt6">元 / 公里</div>
      </div></div>
      <div class="card"><div class="card__bd">
        <div class="tiny muted">本期未出车</div>
        <div class="dsp" style="font-size: 22px; font-weight: 700; margin-top: 4px">{{ summary.idle }} <small class="tiny muted2">人</small></div>
        <div class="tiny mono muted mt6">底薪仍在计提</div>
      </div></div>
    </div>

    <!-- 排行 -->
    <div class="grid grid--2">
      <div class="card">
        <div class="card__hd">
          <div class="card__title"><Icon name="trend" :size="15" />人效排行 TOP 6</div>
          <div class="card__sub spacer">按创收</div>
        </div>
        <BarList :items="ranking" :format="(v) => compactMoney(v)" :show-pct="false" />
      </div>
      <div class="card">
        <div class="card__hd">
          <div class="card__title"><Icon name="fuel" :size="15" />油耗偏差关注</div>
          <div class="card__sub spacer">实际 vs 车型基准</div>
        </div>
        <BarList v-if="fuelGap.length" :items="fuelGap" :format="(v) => '+' + (v * 100).toFixed(1) + '%'" :show-pct="false" />
        <div v-else class="empty"><div class="empty__t">本期没有明显偏高的司机</div></div>
        <div class="card__ft tiny muted2">
          油耗是最容易管理的成本项：同一台车换个司机，百公里油耗差 8% 以上很常见，
          按 30 L/100km、10 万公里/年、7.5 元/L 计，相当于每年 1.8 万元。
        </div>
      </div>
    </div>

    <!-- 搜索 -->
    <div class="card">
      <div class="card__bd" style="padding: 12px">
        <div style="position: relative">
          <Icon name="search" :size="15" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-4)" />
          <input v-model="q" class="input" style="padding-left: 34px" placeholder="搜索司机姓名 / 车牌" />
        </div>
      </div>
    </div>

    <!-- 司机列表 -->
    <div class="card">
      <div class="card__hd">
        <div class="card__title"><Icon name="driver" :size="15" />司机明细</div>
        <div class="card__sub spacer">{{ filtered.length }} 人</div>
      </div>
      <button v-for="d in filtered" :key="d.id" class="lrow" @click="picked = d">
        <span class="ava">{{ d.name.slice(0, 1) }}</span>
        <div class="lrow__main">
          <div class="lrow__ttl">
            {{ d.name }}
            <span class="tiny mono muted" style="margin-left: 6px">{{ d.license }}</span>
            <span
              class="pill"
              :class="d.safety >= 90 ? 'pill--run' : d.safety >= 80 ? 'pill--fix' : 'pill--warn'"
              style="margin-left: 6px"
            >
              安全 {{ d.safety }}
            </span>
          </div>
          <div class="lrow__sub">
            {{ d.plate }} · {{ num(d.km) }} km · {{ d.days }} 天 · 油耗 {{ d.per100.toFixed(1) }} L
          </div>
        </div>
        <div class="lrow__end">
          <div class="lrow__amt">{{ compactMoney(d.rev) }}</div>
          <div class="lrow__meta">人力 {{ compactMoney(d.cost) }} · {{ d.costPerKm.toFixed(3) }} 元/km</div>
        </div>
      </button>
      <div v-if="!filtered.length" class="empty">
        <div class="empty__t">没有匹配的司机</div>
      </div>
    </div>

    <!-- 司机详情 -->
    <SheetModal :open="!!detail" :title="detail ? detail.d.name + ' · 司机档案' : ''" @close="picked = null">
      <template v-if="detail">
        <div class="row">
          <span class="ava" style="width: 46px; height: 46px; font-size: 19px">{{ detail.d.name.slice(0, 1) }}</span>
          <div>
            <div style="font-size: 16px; font-weight: 650">{{ detail.d.name }}</div>
            <div class="tiny muted mono mt6">
              准驾 {{ detail.d.license }} · 驾龄 {{ detail.d.years }} 年 · 入职 {{ detail.d.hireYm }}
            </div>
          </div>
          <div class="spacer center">
            <div class="dsp" style="font-size: 23px; font-weight: 700" :style="{ color: tone(detail.d.safety) }">
              {{ detail.d.safety }}
            </div>
            <div class="tiny muted">安全评分</div>
          </div>
        </div>

        <div class="grid grid--2 mt14" style="gap: 10px">
          <div class="card"><div class="card__bd" style="padding: 11px">
            <div class="tiny muted">本期里程</div>
            <div class="dsp" style="font-size: 19px; font-weight: 700; margin-top: 3px">{{ num(detail.d.km) }}</div>
            <div class="tiny mono muted">{{ detail.d.days }} 天 · 车日 {{ num(detail.d.avgKm) }} km</div>
          </div></div>
          <div class="card"><div class="card__bd" style="padding: 11px">
            <div class="tiny muted">本期创收</div>
            <div class="dsp" style="font-size: 19px; font-weight: 700; margin-top: 3px">{{ compactMoney(detail.d.rev) }}</div>
            <div class="tiny mono muted">{{ num(detail.d.trips) }} 车次</div>
          </div></div>
          <div class="card"><div class="card__bd" style="padding: 11px">
            <div class="tiny muted">里程提成 + 补贴</div>
            <div class="dsp" style="font-size: 19px; font-weight: 700; margin-top: 3px">{{ compactMoney(detail.d.commission) }}</div>
            <div class="tiny mono muted">提成 {{ detail.d.commission }} 元/km</div>
          </div></div>
          <div class="card"><div class="card__bd" style="padding: 11px">
            <div class="tiny muted">底薪 + 社保 + 奖金</div>
            <div class="dsp" style="font-size: 19px; font-weight: 700; margin-top: 3px">{{ compactMoney(detail.d.salary) }}</div>
            <div class="tiny mono muted">月度刚性</div>
          </div></div>
        </div>

        <div class="hr" />
        <div class="sechead__ttl" style="font-size: 13px; margin-bottom: 8px">出车里程分布</div>
        <div class="kmbars">
          <i
            v-for="(k, i) in detail.kmArr"
            :key="i"
            class="kmbars__b"
            :style="{ height: Math.max(3, (k / Math.max(...detail.kmArr, 1)) * 100) + '%' }"
            :title="num(k) + ' km'"
          />
        </div>
        <div class="tiny muted mono mt6">
          峰值 {{ num(Math.max(...detail.kmArr)) }} km · 共 {{ detail.kmArr.length }} 个时间桶
        </div>

        <div class="hr" />
        <table class="tbl" style="min-width: 0">
          <tbody>
            <tr><td style="text-align: left" class="muted">关联车辆</td><td>{{ detail.d.plate }}</td></tr>
            <tr><td style="text-align: left" class="muted">联系电话</td><td class="num">{{ detail.d.phone }}</td></tr>
            <tr><td style="text-align: left" class="muted">驾驶证号</td><td class="num">{{ detail.d.licenseNo }}</td></tr>
            <tr><td style="text-align: left" class="muted">基本工资</td><td class="num">{{ yuan(detail.d.baseSalary) }}</td></tr>
            <tr><td style="text-align: left" class="muted">社保公积金（单位）</td><td class="num">{{ yuan(detail.d.social) }}</td></tr>
            <tr>
              <td style="text-align: left" class="muted">油耗偏差</td>
              <td :style="detail.d.fuelGap > 0.08 ? 'color: var(--amber)' : ''">
                {{ detail.d.fuelGap > 0 ? '+' : '' }}{{ (detail.d.fuelGap * 100).toFixed(1) }}%
              </td>
            </tr>
            <tr><td style="text-align: left" class="muted">单公里人力成本</td><td class="num">{{ detail.d.costPerKm.toFixed(3) }} 元</td></tr>
          </tbody>
        </table>

        <div v-if="detail.d.safety < 82" class="note note--warn mt14">
          <Icon name="shield" :size="15" style="flex: 0 0 auto; margin-top: 1px" />
          <div>安全评分偏低，建议安排安全培训与跟车复训 —— 事故一次的间接损失通常远超人力成本的节省。</div>
        </div>
      </template>

      <template #footer>
        <button class="btn btn--ghost" @click="picked = null">关闭</button>
        <button class="btn btn--primary" style="flex: 1" @click="openEntry('driver'); picked = null">
          <Icon name="plus" :size="14" :sw="2.3" />记录司机成本
        </button>
      </template>
    </SheetModal>
  </div>
</template>

<style scoped>
.kmbars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 62px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line);
}
.kmbars__b {
  flex: 1 1 0;
  min-width: 2px;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(180deg, #6366f1, rgba(99, 102, 241, 0.3));
  animation: sweep 0.5s var(--ease-out) both;
  transform-origin: bottom;
}
</style>
