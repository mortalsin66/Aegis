<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiGet } from '../lib/api'
import { t } from '../lib/i18n'
interface Action { ts: number; user: string; method: string; path: string; status: number }
const commands = ref<Action[]>([])
const error = ref('')
async function load() {
  try { commands.value = (await apiGet<{ commands: Action[] }>('/api/audit')).commands; error.value = '' }
  catch (e) { error.value = (e as Error).message }
}
onMounted(load)
</script>
<template>
  <div class="space-y-4">
    <div class="flex justify-between"><h2 class="text-xl font-bold text-white">{{ t('audit.title') }}</h2><button @click="load" class="px-3 py-2 rounded bg-ink-800">{{ t('common.refresh') }}</button></div>
    <p v-if="error" class="text-bad">{{ error }}</p>
    <div class="card overflow-auto"><table class="w-full text-sm text-left"><thead class="text-slate-500"><tr><th class="p-3">Time</th><th class="p-3">{{ t('common.user') }}</th><th class="p-3">{{ t('common.actions') }}</th><th class="p-3">HTTP</th></tr></thead><tbody><tr v-for="(item, index) in commands" :key="index" class="border-t border-ink-800"><td class="p-3 whitespace-nowrap">{{ new Date(item.ts).toLocaleString() }}</td><td class="p-3">{{ item.user }}</td><td class="p-3 font-mono">{{ item.method }} {{ item.path }}</td><td class="p-3" :class="item.status >= 400 ? 'text-bad' : 'text-ok'">{{ item.status }}</td></tr></tbody></table><p v-if="!commands.length" class="p-4 text-slate-500">{{ t('common.none') }}</p></div>
  </div>
</template>
