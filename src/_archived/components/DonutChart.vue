<script setup>
/** 环形图（自绘 SVG）：成本结构的主力图表 */
import { computed, ref, watch } from 'vue'
import { useTween } from '../composables/useTween.js'

const props = defineProps({
  items: { type: Array, default: () => [] }, // [{ key, label, value, color }]
  size: { type: Number, default: 178 },
  thickness: { type: Number, default: 19 },
  centerLabel: { type: String, default: '' },
  centerValue: { type: String, default: '' },
  interactive: { type: Boolean, default: true },
})
const emit = defineEmits(['select'])
const { p, run } = useTween(950)
watch(() => props.items, run)

const sel = ref(-1)

const geo = computed(() => {
  const size = props.size
  const th = props.thickness
  const r = (size - th) / 2 - 2
  const C = 2 * Math.PI * r
  const total = props.items.reduce((a, x) => a + x.value, 0) || 1
  let cum = 0
  const gap = props.items.filter((x) => x.value > 0).length > 1 ? 2.2 : 0
  const arcs = props.items.map((it, i) => {
    const pct = it.value / total
    const off = cum
    cum += pct
    const len = Math.max(0, pct * C * p - gap)
    return {
      ...it,
      i,
      pct,
      r,
      C,
      len,
      // 从 12 点方向顺时针
      dash: `${len} ${C - len}`,
      dashOffset: -off * C * p - gap / 2,
      dim: sel.value >= 0 && sel.value !== i,
    }
  })
  return { size, r, C, arcs, total }
})
</script>

<template>
  <div class="donut-wrap" :style="{ width: geo.size + 'px', height: geo.size + 'px' }">
    <svg :width="geo.size" :height="geo.size" :viewBox="`0 0 ${geo.size} ${geo.size}`">
      <g :transform="`rotate(-90 ${geo.size / 2} ${geo.size / 2})`">
        <circle
          :cx="geo.size / 2"
          :cy="geo.size / 2"
          :r="geo.r"
          fill="none"
          stroke="#eef0f3"
          :stroke-width="thickness"
        />
        <circle
          v-for="a in geo.arcs"
          :key="a.key"
          :cx="geo.size / 2"
          :cy="geo.size / 2"
          :r="a.r"
          fill="none"
          :stroke="a.color"
          :stroke-width="sel === a.i ? thickness + 5 : thickness"
          :stroke-dasharray="a.dash"
          :stroke-dashoffset="a.dashOffset"
          :opacity="a.dim ? 0.28 : 1"
          stroke-linecap="butt"
          :style="{
            transition: 'stroke-width .22s, opacity .22s',
            cursor: interactive ? 'pointer' : 'default',
          }"
          @pointerenter="interactive && (sel = a.i)"
          @pointerleave="interactive && (sel = -1)"
          @click="interactive && emit('select', a)"
        />
      </g>
    </svg>
    <div class="donut-c">
      <slot name="center">
        <div class="donut-c__l">{{ centerLabel }}</div>
        <div class="donut-c__v">{{ centerValue }}</div>
      </slot>
    </div>
  </div>
</template>
