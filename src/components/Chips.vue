<script setup>
/** 筛选胶囊组 */
defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array, required: true }, // [{key, name, count?}]
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="chips">
    <button
      v-for="o in options"
      :key="o.key"
      class="chip"
      :class="{ 'is-active': o.key === modelValue }"
      @click="emit('update:modelValue', o.key)"
    >
      {{ o.name }}<span v-if="o.count !== undefined" class="mono"> {{ o.count }}</span>
    </button>
  </div>
</template>
