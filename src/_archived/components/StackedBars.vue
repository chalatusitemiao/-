<script setup>
/** 堆叠柱状图：月度各成本科目构成 */
import { computed, ref, watch } from 'vue'
import { useElementWidth } from '../composables/useElementWidth.js'
import { useTween } from '../composables/useTween.js'

const props = defineProps({
  labels: { type: Array, default: () => [] },
  series: { type: Array, default: () => [] }, // [{ key, name, color, values: number[] }]
  height: { type: Number, default: 208 },
  yFormat: { type: Function, default: (v) => String(Math.round(v)) },
  tipFormat: { type: Function, default: (v) => Math.round(v).toLocaleString('zh-CN') },
  showTotalTip: { type: Boolean, default: true },
})

const { el, width } = useElementWidth(320)
const { p, run } = useTween(900)
watch(() => props.series, run)

function niceCeil(v) {
  if (!(v > 0)) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / e
  const m = n <= 1 ? 1 : n <= 1.2 ? 1.2 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10
  return m * e
}

const topRound = (x, y, w, h, r) => {
  r = Math.max(0, Math.min(r, w / 2, h))
  return `M${x} ${y + h} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h} Z`
}

const g = computed(() => {
  const w = Math.max(220, width.value)
  const h = props.height
  const pl = 48
  const pr = 10
  const pt = 14
  const pb = 24
  const iw = w - pl - pr
  const ih = h - pt - pb
  const n = props.labels.length
  const totals = props.labels.map((_, i) => props.series.reduce((a, s) => a + (s.values[i] || 0), 0))
  const yMax = niceCeil(Math.max(...totals, 0))
  const step = n ? iw / n : iw
  const bw = Math.min(38, Math.max(10, step * 0.54))
  const Y = (v) => pt + ih - (v / yMax) * ih

  const cols = props.labels.map((label, i) => {
    const cx = pl + step * i + step / 2
    let acc = 0
    const segs = props.series.map((s) => {
      const raw = s.values[i] || 0
      const y0 = Y((acc + raw) * p)
      const y1 = Y(acc * p)
      acc += raw
      return { key: s.key, color: s.color, x: cx - bw / 2, y: y0, h: Math.max(0, y1 - y0), w: bw }
    })
    const topIdx = [...segs].reverse().findIndex((s) => s.h > 0)
    const realTop = topIdx < 0 ? -1 : segs.length - 1 - topIdx
    return { i, label, cx, segs, realTop, total: totals[i] }
  })

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ v: yMax * t, y: Y(yMax * t) }))
  const stepL = Math.max(1, Math.ceil(n / 6))
  const xl = []
  for (let i = 0; i < n; i += stepL) xl.push({ i, x: cols[i].cx, t: props.labels[i] })
  return { w, h, pl, pr, pt, pb, iw, ih, n, yMax, step, bw, cols, ticks, xl, Y }
})

const active = ref(-1)
let timer = 0
function locate(e) {
  const n = g.value.n
  if (!n) return
  const r = e.currentTarget.getBoundingClientRect()
  const t = (e.clientX - r.left - g.value.pl) / (g.value.step || 1)
  active.value = Math.max(0, Math.min(n - 1, Math.floor(t)))
}
const onDown = (e) => {
  clearTimeout(timer)
  e.currentTarget.setPointerCapture?.(e.pointerId)
  locate(e)
}
const onMove = (e) => {
  clearTimeout(timer)
  locate(e)
}
const onUp = (e) => {
  if (e.pointerType === 'mouse') return
  timer = setTimeout(() => (active.value = -1), 1100)
}
const onLeave = () => {
  clearTimeout(timer)
  active.value = -1
}

const tip = computed(() => {
  const i = active.value
  if (i < 0 || !g.value.n) return null
  const c = g.value.cols[i]
  return {
    i,
    left: Math.max(70, Math.min(g.value.w - 70, c.cx)),
    label: c.label,
    total: c.total,
    rows: props.series
      .map((s) => ({ name: s.name, color: s.color, v: s.values[i] || 0 }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v),
  }
})
</script>

<template>
  <div class="chart" ref="el">
    <svg :width="g.w" :height="g.h" :viewBox="`0 0 ${g.w} ${g.h}`" role="img">
      <g>
        <template v-for="(t, i) in g.ticks" :key="'t' + i">
          <line
            :class="i === 0 ? 'caxis' : 'cgrid'"
            :x1="g.pl"
            :x2="g.w - g.pr"
            :y1="t.y"
            :y2="t.y"
            :stroke-dasharray="i === 0 ? '' : '3 5'"
          />
          <text class="ctext" :x="g.pl - 8" :y="t.y + 3.5" text-anchor="end">
            {{ yFormat(t.v) }}
          </text>
        </template>
      </g>

      <g v-for="c in g.cols" :key="c.i" :opacity="active < 0 || active === c.i ? 1 : 0.42" style="transition: opacity .2s">
        <template v-for="(s, si) in c.segs" :key="s.key">
          <path v-if="si === c.realTop && s.h > 0" :d="topRound(s.x, s.y, s.w, s.h, 3)" :fill="s.color" />
          <rect v-else-if="s.h > 0" :x="s.x" :y="s.y" :width="s.w" :height="s.h" :fill="s.color" />
        </template>
      </g>

      <g>
        <text
          v-for="(l, i) in g.xl"
          :key="'x' + i"
          class="ctext"
          :x="l.x"
          :y="g.h - 7"
          text-anchor="middle"
        >
          {{ l.t }}
        </text>
      </g>

      <rect
        :x="0"
        :y="0"
        :width="g.w"
        :height="g.h"
        fill="transparent"
        style="cursor: pointer"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @pointerleave="onLeave"
      />
    </svg>

    <div v-if="tip" class="chart__tip" :style="{ left: tip.left + 'px', top: '4px', transform: 'translate(-50%,0)' }">
      <div class="chart__tip-h">{{ tip.label }}</div>
      <div v-if="showTotalTip" class="chart__tip-r">
        <i class="chart__tip-k" style="background: var(--primary)" />
        <span class="chart__tip-n">总成本</span>
        <span class="chart__tip-v">{{ tipFormat(tip.total) }}</span>
      </div>
      <div v-for="r in tip.rows" :key="r.name" class="chart__tip-r">
        <i class="chart__tip-k" :style="{ background: r.color }" />
        <span class="chart__tip-n">{{ r.name }}</span>
        <span class="chart__tip-v">{{ tipFormat(r.v) }}</span>
      </div>
    </div>
  </div>
</template>
