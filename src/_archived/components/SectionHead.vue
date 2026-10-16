<script setup>
/** 区块标题：左侧琥珀色竖条 + 标题 + 说明 + 右侧插槽 */
defineProps({
  title: { type: String, required: true },
  desc: { type: String, default: '' },
})
</script>

<template>
  <div class="sechead">
    <div class="sechead__ttl">{{ title }}</div>
    <div v-if="desc" class="sechead__desc">{{ desc }}</div>
    <div v-if="$slots.aside" class="sechead__aside"><slot name="aside" /></div>
  </div>
</template>
