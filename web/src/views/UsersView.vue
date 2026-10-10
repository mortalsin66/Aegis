<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { apiGet, apiPost, apiDelete } from '../lib/api'
import { t } from '../lib/i18n'

interface User {
  name: string
  uid: string
  gid: string
  group: string
  home: string
  shell: string
  system: boolean
  sudo: boolean
  groups: string[]
}

const users = ref<User[]>([])
const note = ref('')
const error = ref('')
const note2 = ref('')
const showSystem = ref(false)

const addOpen = ref(false)
const nName = ref('')
const nPassword = ref('')
const nShell = ref('/bin/bash')
const nSudo = ref(false)

const passOpen = ref(false)
const passName = ref('')
const passValue = ref('')

const filtered = computed(() => (showSystem.value ? users.value : users.value.filter((u) => !u.system)))

const shellOptions = ['/bin/bash', '/bin/sh', '/bin/zsh', '/usr/sbin/nologin']

async function load() {
  error.value = ''
  try {
    const r = await apiGet<{ users: User[]; note?: string }>('/api/users')
    users.value = r.users || []
    note.value = r.note || ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function addUser() {
  if (!nName.value.trim()) {
    error.value = t('users.nameRequired')
    return
  }
  error.value = ''
  try {
    await apiPost('/api/users', {
      name: nName.value.trim(),
      password: nPassword.value,
      shell: nShell.value,
      sudo: nSudo.value,
    })
    addOpen.value = false
    nName.value = ''
    nPassword.value = ''
    nSudo.value = false
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteUser(name: string) {
  if (!window.confirm(t('users.deleteConfirm').replace('{name}', name))) return
  error.value = ''
  try {
    await apiDelete(`/api/users/${name}`)
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

function openPassword(name: string) {
  passName.value = name
  passValue.value = ''
  passOpen.value = true
}
async function changePassword() {
  if (!passValue.value) {
    error.value = t('users.passwordRequired')
    return
  }
  error.value = ''
  try {
    await apiPost(`/api/users/${passName.value}/password`, { password: passValue.value })
    passOpen.value = false
    note2.value = t('users.passwordUpdated')
    setTimeout(() => (note2.value = ''), 3000)
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function toggleSudo(u: User) {
  error.value = ''
  try {
    await apiPost(`/api/users/${u.name}/sudo`, { enable: !u.sudo })
    load()
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(load)
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center justify-between mb-3 shrink-0">
      <h2 class="text-xl font-bold text-white">{{ t('users.title') }}</h2>
      <div class="flex gap-2">
        <button
          @click="showSystem = !showSystem"
          class="px-3 py-1.5 rounded-lg text-sm"
          :class="showSystem ? 'bg-accent-500/20 text-accent-400' : 'bg-ink-850 border border-ink-700'"
        >
          👁 {{ t('users.showSystem') }}
        </button>
        <button @click="addOpen = true" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">＋ {{ t('users.addUser') }}</button>
      </div>
    </div>

    <div v-if="note" class="mb-3 px-4 py-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm shrink-0">{{ note }}</div>
    <div v-if="note2" class="mb-3 px-4 py-3 rounded-lg bg-ok/10 border border-ok/30 text-ok text-sm shrink-0">{{ note2 }}</div>
    <div v-if="error" class="mb-3 px-4 py-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm shrink-0">{{ error }}</div>

    <div class="card flex-1 min-h-0 flex flex-col overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
        <span class="text-sm text-slate-500">{{ t('users.shown') }} {{ filtered.length }} {{ t('users.of') }} {{ users.length }}</span>
      </div>
      <div class="flex-1 overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 z-10 bg-ink-900 text-left text-slate-500 text-xs uppercase border-b border-ink-700">
            <tr>
              <th class="px-4 py-3">{{ t('users.user') }}</th>
              <th class="px-4 py-3">UID</th>
              <th class="px-4 py-3">{{ t('users.groups') }}</th>
              <th class="px-4 py-3">Shell</th>
              <th class="px-4 py-3 text-right">{{ t('users.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-800">
            <tr v-for="u in filtered" :key="u.uid" class="hover:bg-ink-850">
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-white">{{ u.name }}</span>
                  <span v-if="u.sudo" class="text-[10px] px-1.5 py-0.5 rounded bg-accent-500/20 text-accent-400 font-semibold">sudo</span>
                </div>
              </td>
              <td class="px-4 py-2.5 font-mono text-slate-400">{{ u.uid }}</td>
              <td class="px-4 py-2.5 font-mono text-slate-400">
                <span class="text-slate-500">{{ u.groups.slice(0, 4).join(', ') }}</span>
                <span v-if="u.groups.length > 4" class="text-slate-600"> +{{ u.groups.length - 4 }}</span>
              </td>
              <td class="px-4 py-2.5 font-mono text-slate-500">{{ u.shell }}</td>
              <td class="px-4 py-2.5 text-right whitespace-nowrap">
                <button @click="openPassword(u.name)" class="px-2 py-1 rounded bg-ink-700 hover:bg-ink-800 text-xs" :title="t('users.changePassword')">🔑</button>
                <button
                  v-if="u.name !== 'root'"
                  @click="toggleSudo(u)"
                  class="px-2 py-1 rounded text-xs ml-1"
                  :class="u.sudo ? 'bg-bad/15 text-bad hover:bg-bad/25' : 'bg-accent-500/15 text-accent-400 hover:bg-accent-500/25'"
                  :title="u.sudo ? t('users.removeSudo') : t('users.grantSudo')"
                >
                  {{ u.sudo ? '– sudo' : '+ sudo' }}
                </button>
                <button v-if="u.name !== 'root'" @click="deleteUser(u.name)" class="px-2 py-1 rounded bg-bad/15 text-bad hover:bg-bad/25 text-xs ml-1" :title="t('users.delete')">🗑</button>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="5" class="px-4 py-6 text-center text-slate-500">{{ t('users.empty') }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ДОБАВИТЬ ПОЛЬЗОВАТЕЛЯ -->
    <div v-if="addOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="addOpen = false">
      <div class="card w-full max-w-sm p-5">
        <h3 class="font-semibold text-white mb-4">{{ t('users.newUser') }}</h3>
        <div class="space-y-3">
          <input v-model="nName" :placeholder="t('users.username')" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          <input v-model="nPassword" type="password" :placeholder="t('users.password')" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent-500" />
          <select v-model="nShell" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none">
            <option v-for="s in shellOptions" :key="s" :value="s">{{ s }}</option>
          </select>
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" v-model="nSudo" />
            <span class="text-slate-300">{{ t('users.grantSudoRights') }}</span>
          </label>
        </div>
        <div class="flex gap-2 justify-end mt-4">
          <button @click="addOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('users.cancel') }}</button>
          <button @click="addUser" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('users.create') }}</button>
        </div>
      </div>
    </div>

    <!-- СМЕНА ПАРОЛЯ -->
    <div v-if="passOpen" class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="passOpen = false">
      <div class="card w-full max-w-sm p-5">
        <h3 class="font-semibold text-white mb-4">{{ t('users.changePasswordTitle') }}: {{ passName }}</h3>
        <input v-model="passValue" type="password" @keyup.enter="changePassword" :placeholder="t('users.newPassword')" class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 text-sm font-mono mb-4 focus:outline-none focus:border-accent-500" />
        <div class="flex gap-2 justify-end">
          <button @click="passOpen = false" class="px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 text-sm">{{ t('users.cancel') }}</button>
          <button @click="changePassword" class="px-3 py-1.5 rounded-lg bg-accent-500 text-ink-950 font-semibold text-sm">{{ t('users.save') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
