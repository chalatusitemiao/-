<script setup>
/** KPI 磁贴：大数字（工业窄体）+ 环比 + 迷你趋势 + 底部仪表刻度 */
import { computed } from 'vue'
import { useCountUp } from '../composables/useCountUp.js'
import { num } from '../utils/format.js'
import Spark from './Spark.vue'
import Icon from './Icon.vue'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  decimals: { type: Number, default: 0 },
  accent: { type: String, default: '#4f46e5' },
  tint: { type: String, default: 'rgba(79,70,229,.12)' },
  delta: { type: Object, default: null }, // { cls, txt, arrow }
  spark: { type: Array, default: null },
  hero: { type: Boolean, default: false },
  icon: { type: String, default: '' },
  foot: { type: String, default: '' },
})

const shown = useCountUp(computed(() => props.value), { decimals: props.decimals })

// 底部刻度尺：40 根长短交替的刻线，纯装饰，制造“仪表”质感
const ticks = Array.from({ length: 44 }, (_, i) => ({
  x: i * 6 + 2,
  h: i % 5 === 0 ? 8 : i % 2 === 0 ? 5 : 3,
}))
</script>

<template>
  <div
    class="kpi"
    :class="{ 'kpi--hero': hero }"
    :style="{ '--kpi-accent': accent, '--kpi-tint': tint }"
  >
    <div class="kpi__label">
      <i class="kpi__dot" />
      <span>{{ label }}</span>
      <Icon v-if="icon" :name="icon" :size="12" style="margin-left: auto; opacity: 0.4" />
    </div>
    <div class="kpi__val" :class="{ dsp: true }">
      {{ num(shown, decimals) }}<small v-if="unit">{{ unit }}</small>
    </div>
    <div class="kpi__foot">
      <span v-if="delta" class="delta" :class="delta.cls">
        <Icon v-if="delta.arrow === 'up'" name="arrUp" :size="10" :sw="2.4" />
        <Icon v-else-if="delta.arrow === 'down'" name="arrDown" :size="10" :sw="2.4" />
        {{ delta.txt }}
      </span>
      <span v-else-if="foot" class="tiny muted mono">{{ foot }}</span>
      <Spark
        v-if="spark && spark.length > 1"
        :values="spark"
        :color="accent"
        :width="60"
        :height="20"
        class="spacer"
      />
    </div>
    <svg class="kpi__ticks" viewBox="0 0 264 10" preserveAspectRatio="none">
      <line
        v-for="(t, i) in ticks"
        :key="i"
        :x1="t.x"
        :x2="t.x"
        :y1="10 - t.h"
        :y2="10"
        :stroke="accent"
        stroke-width="1"
        opacity="0.32"
      />
    </svg>
  </div>
</template>
