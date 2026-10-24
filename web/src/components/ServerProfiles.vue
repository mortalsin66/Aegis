<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../lib/i18n'
interface Profile { name: string; url: string }
const profiles = ref<Profile[]>([])
try {
  const saved = JSON.parse(localStorage.getItem('aegis_servers') || '[]')
  if (Array.isArray(saved)) profiles.value = saved.filter(p => typeof p.name === 'string' && validUrl(p.url)).slice(0, 30)
} catch {}
const name = ref(''), url = ref(''), error = ref('')
function validUrl(value: string) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password } catch { return false }
}
function save() { localStorage.setItem('aegis_servers', JSON.stringify(profiles.value)) }
function add() {
  if (!name.value.trim() || !validUrl(url.value)) { error.value = 'Enter a name and valid HTTP(S) panel URL'; return }
  profiles.value.push({ name: name.value.trim().slice(0, 80), url: new URL(url.value).origin }); save(); name.value = ''; url.value = ''; error.value = ''
}
function remove(index: number) { profiles.value.splice(index, 1); save() }
</script>
<template>
  <div class="space-y-3"><h3 class="font-semibold text-white">{{ t('servers.title') }}</h3><p class="text-xs text-slate-500">{{ t('servers.hint') }}</p>
    <div v-for="(server, index) in profiles" :key="server.url" class="flex gap-2 items-center"><a :href="server.url" target="_blank" rel="noopener noreferrer" class="text-accent-400 flex-1">{{ server.name }} · {{ server.url }} ↗</a><button @click="remove(index)" class="text-bad">×</button></div>
    <input v-model="name" :placeholder="t('servers.name')" class="w-full bg-ink-850 border border-ink-700 rounded px-3 py-2 text-sm" maxlength="80" />
    <input v-model="url" :placeholder="t('servers.url')" class="w-full bg-ink-850 border border-ink-700 rounded px-3 py-2 text-sm" />
    <p v-if="error" class="text-bad text-xs">{{ error }}</p><button @click="add" :disabled="profiles.length >= 30" class="px-3 py-2 rounded bg-ink-800 text-sm">{{ t('servers.add') }}</button>
  </div>
</template>
