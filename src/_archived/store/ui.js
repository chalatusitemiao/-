/* 一点点全局 UI 状态：谁都能唤起「记一笔」 */
import { ref } from 'vue'

export const entryOpen = ref(false)
export const entryCat = ref('fuel')

export function openEntry(cat = 'fuel') {
  entryCat.value = cat
  entryOpen.value = true
}
export function closeEntry() {
  entryOpen.value = false
}
