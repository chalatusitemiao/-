<script setup>
/** 迷你趋势线：用在 KPI 磁贴和列表行里 */
import { computed } from 'vue'
import { useTween, nextId } from '../composables/useTween.js'

const props = defineProps({
  values: { type: Array, default: () => [] },
  color: { type: String, default: '#4f46e5' },
  width: { type: Number, default: 64 },
  height: { type: Number, default: 22 },
  sw: { type: Number, default: 1.6 },
  area: { type: Boolean, default: true },
})

const gid = nextId('sp')

const geo = computed(() => {
  const v = props.values.filter((x) => typeof x === 'number' && !Number.isNaN(x))
  if (v.length < 2) return null
  let min = Math.min(...v)
  let max = Math.max(...v)
  if (max === min) {
    max += 1
    min -= 1
  }
  const pad = props.sw + 1
  const w = props.width
  const h = props.height
  const pts = v.map((x, i) => [
    pad + (i / (v.length - 1)) * (w - pad * 2),
    h - pad - ((x - min) / (max - min)) * (h - pad * 2),
  ])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return {
    line,
    area: `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`,
    last: pts[pts.length - 1],
  }
})
const { p } = useTween(700)
</script>

<template>
  <svg v-if="geo" :width="width" :height="height" class="kpi__spark">
    <defs>
      <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.32" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="area" :d="geo.area" :fill="`url(#${gid})`" :opacity="p" />
    <path
      :d="geo.line"
      fill="none"
      :stroke="color"
      :stroke-width="sw"
      stroke-linecap="round"
      stroke-linejoin="round"
      pathLength="1"
      :stroke-dasharray="1"
      :stroke-dashoffset="1 - p"
    />
    <circle :cx="geo.last[0]" :cy="geo.last[1]" :r="sw + 0.6" :fill="color" :opacity="p" />
  </svg>
</template>
