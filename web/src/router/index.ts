import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const DashboardView = () => import('../views/DashboardView.vue')
const PlaceholderView = () => import('../views/PlaceholderView.vue')
const ServicesView = () => import('../views/ServicesView.vue')
const ProcessesView = () => import('../views/ProcessesView.vue')
const FilesView = () => import('../views/FilesView.vue')
const LogsView = () => import('../views/LogsView.vue')
const NetworkView = () => import('../views/NetworkView.vue')
const ContainersView = () => import('../views/ContainersView.vue')
const UsersView = () => import('../views/UsersView.vue')
const UpdatesView = () => import('../views/UpdatesView.vue')
const TerminalView = () => import('../views/TerminalView.vue')
const SettingsView = () => import('../views/SettingsView.vue')

export interface NavItem {
  id: string
  icon: string
  label: string
  path: string
}

export const nav: NavItem[] = [
  { id: 'dashboard', icon: '◈', label: 'Дашборд', path: '/' },
  { id: 'services', icon: '⚙', label: 'Сервисы', path: '/services' },
  { id: 'processes', icon: '▤', label: 'Процессы', path: '/processes' },
  { id: 'files', icon: '▣', label: 'Файлы', path: '/files' },
  { id: 'terminal', icon: '❯_', label: 'Терминал', path: '/terminal' },
  { id: 'network', icon: '⇅', label: 'Сеть', path: '/network' },
  { id: 'containers', icon: '▦', label: 'Контейнеры', path: '/containers' },
  { id: 'logs', icon: '≡', label: 'Журнал', path: '/logs' },
  { id: 'users', icon: '◉', label: 'Пользователи', path: '/users' },
  { id: 'updates', icon: '⇪', label: 'Обновления', path: '/updates' },
  { id: 'settings', icon: '✶', label: 'Настройки', path: '/settings' },
]

const sectionComponent: Record<string, RouteRecordRaw['component']> = {
  services: ServicesView,
  processes: ProcessesView,
  files: FilesView,
  logs: LogsView,
  network: NetworkView,
  containers: ContainersView,
  users: UsersView,
  updates: UpdatesView,
  terminal: TerminalView,
  settings: SettingsView,
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
      meta: { title: 'Дашборд' },
    },
    ...nav
      .filter((n) => n.id !== 'dashboard')
      .map((n) => ({
        path: n.path,
        name: n.id,
        component: sectionComponent[n.id] || PlaceholderView,
        meta: { title: n.label, icon: n.icon, id: n.id },
      })),
  ],
})

export default router
