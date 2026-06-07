<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-mark">P</span>
        <span class="logo-text font-display">PaperMind</span>
      </div>

      <nav class="sidebar-nav">
        <router-link v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebar-bottom">
        <router-link to="/settings" class="nav-item">
          <el-icon><Setting /></el-icon>
          <span>设置</span>
        </router-link>
      </div>
    </aside>

    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { Collection, ChatDotRound, Setting } from '@element-plus/icons-vue'
import { usePaperStore } from './stores/paper'
import { useChatStore } from './stores/chat'

const paperStore = usePaperStore()
const chatStore = useChatStore()

onMounted(async () => {
  await Promise.all([paperStore.init(), chatStore.init()])
})

const navItems = [
  { path: '/library', icon: 'Collection', label: '知识库' },
  { path: '/chat', icon: 'ChatDotRound', label: '对话' },
]
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 18px;
  border-bottom: 1px solid var(--border);
}

.logo-mark {
  width: 28px; height: 28px;
  background: var(--accent);
  border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Playfair Display', serif;
  font-size: 16px; font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  line-height: 1;
  padding-top: 1px;
}

.logo-text {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.3px;
}

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-bottom {
  padding: 8px 8px 16px;
  border-top: 1px solid var(--border);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 450;
  transition: all 0.15s ease;
  cursor: pointer;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.router-link-active {
  background: var(--accent-dim);
  color: var(--accent);
}

.nav-item .el-icon { font-size: 16px; }

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
