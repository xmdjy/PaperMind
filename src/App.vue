<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="主导航">
      <div class="sidebar-logo">
        <span class="logo-mark" aria-hidden="true">P</span>
        <div class="logo-copy">
          <span class="logo-text font-display">PaperMind</span>
          <span class="logo-sub">本地论文助手</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
        >
          <el-icon aria-hidden="true"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="sidebar-bottom">
        <router-link to="/settings" class="nav-item">
          <el-icon aria-hidden="true"><Setting /></el-icon>
          <span>设置</span>
        </router-link>
      </div>
    </aside>

    <main class="main-content" id="main">
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
  { path: '/library', icon: Collection, label: '知识库' },
  { path: '/chat', icon: ChatDotRound, label: '对话' },
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
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(12px);
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px 18px 18px;
  border-bottom: 1px solid var(--border);
}

.logo-mark {
  width: 32px;
  height: 32px;
  background: linear-gradient(145deg, var(--accent-hover), var(--accent));
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Playfair Display', serif;
  font-size: 17px;
  font-weight: 700;
  color: #0c0e11;
  flex-shrink: 0;
  line-height: 1;
  box-shadow: 0 0 0 1px rgba(61, 184, 160, 0.25), 0 6px 16px rgba(61, 184, 160, 0.18);
}

.logo-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.logo-text {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.2px;
  line-height: 1.2;
}

.logo-sub {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.2px;
}

.sidebar-nav {
  flex: 1;
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-bottom {
  padding: 10px 10px 18px;
  border-top: 1px solid var(--border);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition:
    background 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    box-shadow 0.15s var(--ease-out);
  cursor: pointer;
  position: relative;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item.router-link-active {
  background: var(--accent-dim);
  color: var(--accent);
  box-shadow: inset 3px 0 0 var(--accent);
}

.nav-item .el-icon { font-size: 16px; }

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: transparent;
}
</style>
