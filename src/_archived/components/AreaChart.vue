<script setup>
/**
 * 多序列折线 / 面积图（自绘 SVG，无图表库）
 * · 宽度由 ResizeObserver 实测，坐标按真实像素算，描边和文字不会被拉伸
 * · 支持鼠标悬停与手指横向滑动取值（touch-action: pan-y，纵向滚动不受影响）
 * · 顶部读数面板 + 竖向准星，避免移动端 tooltip 溢出屏幕
 */
import { computed, ref, watch } from 'vue'
import { useElementWidth } from '../composables/useElementWidth.js'
import { useTween, nextId } from '../composables/useTween.js'

const props = defineProps({
  labels: { type: Array, default: () => [] },
  series: { type: Array, default: () => [] }, // [{ key, name, color, values: number[] }]
  height: { type: Number, default: 190 },
  yFormat: { type: Function, default: (v) => String(Math.round(v)) },
  tipFormat: { type: Function, default: (v) => Math.round(v).toLocaleString('zh-CN') },
  showAxis: { type: Boolean, default: true },
  padL: { type: Number, default: 50 },
})

const { el, width } = useElementWidth(320)
const { p, run } = useTween(950)
watch(() => props.series, run)

function niceCeil(v) {
  if (!(v > 0)) return 1
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / e
  const m = n <= 1 ? 1 : n <= 1.2 ? 1.2 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10
  return m * e
}

const g = computed(() => {
  const w = Math.max(220, width.value)
  const h = props.height
  const pl = props.padL
  const pr = 12
  const pt = 14
  const pb = props.showAxis ? 24 : 8
  const iw = w - pl - pr
  const ih = h - pt - pb
  const n = props.labels.length
  const all = props.series.flatMap((s) => s.values)
  const yMax = niceCeil(all.length ? Math.max(...all) : 1)
  const X = (i) => (n <= 1 ? pl + iw / 2 : pl + (i / (n - 1)) * iw)
  const Y = (v) => pt + ih - (v / yMax) * ih
  const series = props.series.map((s) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(v).toFixed(2)}`).join(' ')
    const base = (pt + ih).toFixed(2)
    return {
      ...s,
      gid: nextId('ac'),
      d,
      area: n ? `${d} L${X(n - 1).toFixed(2)} ${base} L${X(0).toFixed(2)} ${base} Z` : '',
    }
  })
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ v: yMax * t, y: Y(yMax * t) }))
  const step = Math.max(1, Math.ceil(n / 5))
  const xl = []
  for (let i = 0; i < n; i += step) xl.push({ i, x: X(i), t: props.labels[i] })
  const lastI = n - 1
  if (n && xl[xl.length - 1].i < lastI && lastI - xl[xl.length - 1].i >= step * 0.7) {
    xl.push({ i: lastI, x: X(lastI), t: props.labels[lastI] })
  }
  return { w, h, pl, pr, pt, pb, iw, ih, n, yMax, series, ticks, xl, X, Y }
})

/* ---------- 交互 ---------- */
const active = ref(-1)
let timer = 0
function locate(e) {
  const n = g.value.n
  if (n < 1) return
  const r = e.currentTarget.getBoundingClientRect()
  const px = e.clientX - r.left
  const t = (px - g.value.pl) / (g.value.iw || 1)
  active.value = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))
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
  const x = g.value.X(i)
  return {
    i,
    x,
    left: Math.max(64, Math.min(g.value.w - 64, x)),
    label: props.labels[i],
    rows: props.series.map((s) => ({ name: s.name, color: s.color, v: s.values[i] })),
  }
})
</script>

<template>
  <div class="chart" ref="el">
    <svg :width="g.w" :height="g.h" :viewBox="`0 0 ${g.w} ${g.h}`" role="img">
      <defs>
        <linearGradient v-for="s in g.series" :key="s.gid" :id="s.gid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="s.color" stop-opacity="0.26" />
          <stop offset="100%" :stop-color="s.color" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- 横向网格 + Y 轴刻度 -->
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

      <!-- 面积 -->
      <path v-for="s in g.series" :key="'a' + s.key" :d="s.area" :fill="`url(#${s.gid})`" :opacity="p" />

      <!-- 折线 -->
      <path
        v-for="s in g.series"
        :key="'l' + s.key"
        :d="s.d"
        fill="none"
        :stroke="s.color"
        :stroke-width="s.sw || 2"
        stroke-linecap="round"
        stroke-linejoin="round"
        pathLength="1"
        :stroke-dasharray="1"
        :stroke-dashoffset="1 - p"
      />

      <!-- X 轴标签 -->
      <g v-if="showAxis">
        <text
          v-for="(l, i) in g.xl"
          :key="'x' + i"
          class="ctext"
          :x="l.x"
          :y="g.h - 7"
          :text-anchor="i === 0 ? 'start' : i === g.xl.length - 1 ? 'end' : 'middle'"
        >
          {{ l.t }}
        </text>
      </g>

      <!-- 准星 -->
      <g v-if="tip">
        <line
          :x1="tip.x"
          :x2="tip.x"
          :y1="g.pt"
          :y2="g.pt + g.ih"
          stroke="#4f46e5"
          stroke-opacity="0.45"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
        <circle
          v-for="s in g.series"
          :key="'d' + s.key"
          :cx="tip.x"
          :cy="g.Y(s.values[tip.i])"
          r="3.8"
          :fill="s.color"
          stroke="#ffffff"
          stroke-width="1.8"
        />
      </g>

      <!-- 触摸 / 鼠标热区 -->
      <rect
        :x="0"
        :y="0"
        :width="g.w"
        :height="g.h"
        fill="transparent"
        style="cursor: crosshair"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @pointerleave="onLeave"
      />
    </svg>

    <div v-if="tip" class="chart__tip" :style="{ left: tip.left + 'px', top: '4px', transform: 'translate(-50%,0)' }">
      <div class="chart__tip-h">{{ tip.label }}</div>
      <div v-for="r in tip.rows" :key="r.name" class="chart__tip-r">
        <i class="chart__tip-k" :style="{ background: r.color }" />
        <span class="chart__tip-n">{{ r.name }}</span>
        <span class="chart__tip-v">{{ tipFormat(r.v) }}</span>
      </div>
    </div>
  </div>
</template>
