<script setup>
/** 分段控件：周期 / 维度 / 分类切换。移动端可横向滚动。 */
defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array, required: true }, // [{key, name}]
  ghost: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="seg" :class="{ 'seg--ghost': ghost }" role="tablist">
    <button
      v-for="o in options"
      :key="o.key"
      class="seg__btn"
      :class="{ 'is-active': o.key === modelValue }"
      role="tab"
      :aria-selected="o.key === modelValue"
      @click="emit('update:modelValue', o.key)"
    >
      {{ o.name }}
    </button>
  </div>
</template>
