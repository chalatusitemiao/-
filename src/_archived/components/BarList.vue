<script setup>
/** 横向条形排行（单车成本 / 线路毛利 / 司机人效都复用它） */
import { computed, watch } from 'vue'
import { useTween } from '../composables/useTween.js'

const props = defineProps({
  items: { type: Array, default: () => [] }, // [{ key, label, value, sub, color, badge }]
  format: { type: Function, default: (v) => Math.round(v).toLocaleString('zh-CN') },
  showRank: { type: Boolean, default: true },
  showPct: { type: Boolean, default: true },
  clickable: { type: Boolean, default: false },
})
const emit = defineEmits(['pick'])
const { p, run } = useTween(820)
watch(() => props.items, run)

const rows = computed(() => {
  const max = Math.max(...props.items.map((x) => Math.abs(x.value)), 1)
  const total = props.items.reduce((a, x) => a + Math.abs(x.value), 0) || 1
  return props.items.map((x) => ({
    ...x,
    w: (Math.abs(x.value) / max) * 100,
    share: Math.abs(x.value) / total,
  }))
})
</script>

<template>
  <div>
    <component
      :is="clickable ? 'button' : 'div'"
      v-for="(r, i) in rows"
      :key="r.key"
      class="crow"
      :style="clickable ? 'display:block;width:100%;text-align:left' : ''"
      @click="clickable && emit('pick', r)"
    >
      <div class="crow__top">
        <span v-if="showRank" class="tbl__rank">{{ i + 1 }}</span>
        <span class="crow__nm">{{ r.label }}</span>
        <span v-if="r.badge" class="pill" :class="r.badge.cls" style="margin-left: 6px">{{ r.badge.text }}</span>
        <span class="crow__amt">{{ format(r.value) }}</span>
      </div>
      <div class="bar">
        <i
          class="bar__fill"
          :style="{ width: r.w * p + '%', background: r.color || 'var(--primary)' }"
        />
      </div>
      <div v-if="r.sub || showPct" class="crow__bot">
        <span v-if="r.sub">{{ r.sub }}</span>
        <span v-if="showPct" style="margin-left: auto">占比 {{ (r.share * 100).toFixed(1) }}%</span>
      </div>
    </component>
  </div>
</template>
