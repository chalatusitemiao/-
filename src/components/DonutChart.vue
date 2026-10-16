<script setup>
/**
 * 环形图（自绘 SVG，零依赖）
 * ------------------------------------------------------------
 * 成本构成用的主力图表。用 stroke-dasharray 画环：
 * 每个扇区就是一段虚线，长度按占比算，偏移量按累计占比算。
 * 没有引 echarts —— 一个环不值 300KB 的依赖。
 */
import { computed, ref } from 'vue'

const props = defineProps({
  /** [{ key, label, value, color }] */
  items: { type: Array, default: () => [] },
  size: { type: Number, default: 176 },
  thickness: { type: Number, default: 20 },
  centerLabel: { type: String, default: '' },
  centerValue: { type: String, default: '' },
  /** 数值格式化（图例与提示用） */
  format: { type: Function, default: (v) => String(v) },
})
const emit = defineEmits(['select'])

const active = ref(-1)

const geo = computed(() => {
  const size = props.size
  const th = props.thickness
  const r = (size - th) / 2 - 1
  const C = 2 * Math.PI * r
  const total = props.items.reduce((a, x) => a + (Number(x.value) || 0), 0)
  // 扇区之间留一点缝，多于一个扇区时才留
  const gap = props.items.length > 1 ? 2.5 : 0
  let cum = 0
  const arcs = props.items.map((it, i) => {
    const value = Number(it.value) || 0
    const pct = total > 0 ? value / total : 0
    const offset = cum
    cum += pct
    const len = Math.max(0, pct * C - gap)
    return {
      ...it,
      i,
      value,
      pct,
      r,
      dash: `${len} ${C - len}`,
      dashOffset: -offset * C - gap / 2,
      dim: active.value >= 0 && active.value !== i,
    }
  })
  return { size, r, C, arcs, total }
})

const hover = (i) => {
  active.value = i
  if (i >= 0) emit('select', props.items[i])
}
</script>

<template>
  <div class="donut">
    <div class="donut__chart" :style="{ width: geo.size + 'px', height: geo.size + 'px' }">
      <svg :width="geo.size" :height="geo.size" :viewBox="`0 0 ${geo.size} ${geo.size}`" role="img">
        <g :transform="`rotate(-90 ${geo.size / 2} ${geo.size / 2})`">
          <!-- 轨道 -->
          <circle
            :cx="geo.size / 2"
            :cy="geo.size / 2"
            :r="geo.r"
            fill="none"
            class="donut__track"
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
            :stroke-width="thickness"
            :stroke-dasharray="a.dash"
            :stroke-dashoffset="a.dashOffset"
            stroke-linecap="butt"
            class="donut__arc"
            :class="{ 'is-dim': a.dim }"
            @mouseenter="hover(a.i)"
            @mouseleave="hover(-1)"
          >
            <title>{{ a.label }} {{ format(a.value) }}（{{ (a.pct * 100).toFixed(1) }}%）</title>
          </circle>
        </g>
      </svg>
      <div class="donut__center">
        <div class="donut__cl">{{ centerLabel }}</div>
        <div class="donut__cv">{{ centerValue }}</div>
      </div>
    </div>

    <!-- 图例：金额 + 占比都写出来，不用去图上量 -->
    <ul class="donut__legend">
      <li
        v-for="a in geo.arcs"
        :key="a.key"
        class="lg"
        :class="{ 'is-dim': a.dim }"
        @mouseenter="hover(a.i)"
        @mouseleave="hover(-1)"
      >
        <span class="lg__dot" :style="{ background: a.color }" />
        <span class="lg__l">{{ a.label }}</span>
        <span class="lg__v">{{ format(a.value) }}</span>
        <span class="lg__p">{{ (a.pct * 100).toFixed(1) }}%</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  min-width: 0;
}
.donut__chart {
  position: relative;
  flex: 0 0 auto;
}
.donut__track {
  stroke: var(--surface-3);
}
.donut__arc {
  transition: opacity var(--dur-2) var(--ease);
  cursor: default;
}
.donut__arc.is-dim {
  opacity: 0.28;
}
.donut__center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
  pointer-events: none;
  padding: 0 26px;
}
.donut__cl {
  font-size: 11px;
  color: var(--ink-3);
}
.donut__cv {
  margin-top: 3px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.donut__legend {
  flex: 1 1 220px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lg {
  display: grid;
  grid-template-columns: 9px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: var(--r-sm);
  font-size: 12.5px;
  min-width: 0;
  transition: background var(--dur-1) var(--ease), opacity var(--dur-2) var(--ease);
}
.lg:hover {
  background: var(--surface-2);
}
.lg.is-dim {
  opacity: 0.4;
}
.lg__dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.lg__l {
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.lg__v {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.lg__p {
  min-width: 46px;
  text-align: right;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 559px) {
  .donut {
    justify-content: center;
  }
  .donut__legend {
    flex: 1 1 100%;
  }
}
</style>
