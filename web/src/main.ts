import { createApp } from 'vue'
import { role } from './lib/auth'
import App from './App.vue'
import router from './router'
import './style.css'

const adminOnly = (element: HTMLElement) => { element.hidden = role.value === 'viewer' }
createApp(App).directive('admin', { mounted: adminOnly, updated: adminOnly }).use(router).mount('#app')
