import { createRouter, createWebHashHistory } from 'vue-router'
import { hasApiKey, isStoredSuperAdmin } from '@/api/client'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('@/views/hermes/ChatView.vue'),
      props: { simple: true },
    },
    {
      path: '/chat/session/:sessionId',
      name: 'chat.session',
      component: () => import('@/views/hermes/ChatView.vue'),
      props: { simple: true },
    },
    {
      path: '/admin',
      redirect: { name: 'admin.chat' },
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/admin/chat',
      name: 'admin.chat',
      component: () => import('@/views/hermes/ChatView.vue'),
      props: { adminTest: true },
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/session/:sessionId',
      name: 'admin.session',
      component: () => import('@/views/hermes/ChatView.vue'),
      props: { adminTest: true },
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/hermes/chat',
      redirect: { name: 'admin.chat' },
    },
    {
      path: '/hermes/session/:sessionId',
      redirect: to => ({ name: 'admin.session', params: { sessionId: to.params.sessionId } }),
    },
    {
      path: '/admin/history',
      name: 'admin.history',
      component: () => import('@/views/hermes/HistoryView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/history/session/:sessionId',
      name: 'admin.historySession',
      component: () => import('@/views/hermes/HistoryView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/jobs',
      name: 'admin.jobs',
      component: () => import('@/views/hermes/JobsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/kanban',
      name: 'admin.kanban',
      component: () => import('@/views/hermes/KanbanView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/models',
      name: 'admin.models',
      component: () => import('@/views/hermes/ModelsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/profiles',
      name: 'admin.profiles',
      component: () => import('@/views/hermes/ProfilesView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/logs',
      name: 'admin.logs',
      component: () => import('@/views/hermes/LogsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/usage',
      name: 'admin.usage',
      component: () => import('@/views/hermes/UsageView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/performance',
      name: 'admin.performance',
      component: () => import('@/views/hermes/PerformanceView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/skills-usage',
      name: 'admin.skillsUsage',
      component: () => import('@/views/hermes/SkillsUsageView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/skills',
      name: 'admin.skills',
      component: () => import('@/views/hermes/SkillsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/plugins',
      name: 'admin.plugins',
      component: () => import('@/views/hermes/PluginsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/memory',
      name: 'admin.memory',
      component: () => import('@/views/hermes/MemoryView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/settings',
      name: 'admin.settings',
      component: () => import('@/views/hermes/SettingsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/channels',
      name: 'admin.channels',
      component: () => import('@/views/hermes/ChannelsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/terminal',
      name: 'admin.terminal',
      component: () => import('@/views/hermes/TerminalView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/group-chat',
      name: 'admin.groupChat',
      component: () => import('@/views/hermes/GroupChatView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/group-chat/room/:roomId',
      name: 'admin.groupChatRoom',
      component: () => import('@/views/hermes/GroupChatView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/files',
      name: 'admin.files',
      component: () => import('@/views/hermes/FilesView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/coding-agents',
      name: 'admin.codingAgents',
      component: () => import('@/views/hermes/CodingAgentsView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
    {
      path: '/admin/mcp',
      name: 'admin.mcp',
      component: () => import('@/views/hermes/McpManagerView.vue'),
      meta: { requiresSuperAdmin: true, adminLayout: true },
    },
  ],
})

router.beforeEach((to, _from, next) => {
  // Public pages don't need auth
  if (to.meta.public) {
    // Already has key, skip login
    if (to.name === 'login' && hasApiKey()) {
      next({ name: 'chat' })
      return
    }
    next()
    return
  }

  // All other pages require token
  if (!hasApiKey()) {
    next({ name: 'login' })
    return
  }

  if (to.meta.requiresSuperAdmin && !isStoredSuperAdmin()) {
    next({ name: 'chat' })
    return
  }

  next()
})

export default router
