<script setup lang="ts">
import { ref, watch } from 'vue'
import router from './router'
import LoginView from './views/LoginView.vue'
import Sidebar from './components/Sidebar.vue'
import Topbar from './components/Topbar.vue'
import { token, role } from './lib/auth'
import { t } from './lib/i18n'
import { connectAgent, disconnectAgent } from './lib/agent'

const sidebarOpen = ref(false)

watch(
  token,
  (t) => {
    if (t) { connectAgent(); if (role.value === 'viewer' && ['/files', '/terminal', '/users', '/settings', '/audit'].includes(router.currentRoute.value.path)) router.replace('/') }
    else disconnectAgent()
  },
  { immediate: true },
)
</script>

<template>
  <LoginView v-if="!token" />
  <div v-else class="flex h-screen overflow-hidden">
    <Sidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <div v-if="sidebarOpen" class="fixed inset-0 z-30 bg-black/60 lg:hidden" @click="sidebarOpen = false"></div>
    <div class="flex-1 flex flex-col min-w-0">
      <Topbar @menu="sidebarOpen = true" />
      <main class="flex-1 overflow-y-auto p-4 md:p-6 bg-ink-950">
        <div v-if="role === 'viewer'" class="mb-3 text-sm text-accent-400">{{ t('viewer.label') }}</div>
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>
