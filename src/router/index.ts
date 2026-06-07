import { createRouter, createWebHashHistory } from 'vue-router'
import LibraryView from '../views/LibraryView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/library', component: LibraryView },
    { path: '/library/:id', component: () => import('../views/ReaderView.vue') },
    { path: '/chat', component: () => import('../views/ChatView.vue') },
    { path: '/settings', component: () => import('../views/SettingsView.vue') },
  ],
})
