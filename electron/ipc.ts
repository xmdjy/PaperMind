import { ipcMain } from 'electron'
import { kbApi, paperApi, chatApi, highlightApi, settingsApi, exportAll, clearAll } from './db'

// Register all IPC handlers. Each channel maps to a db api call.
// Renderer invokes via window.db.* (see preload.ts).
export function registerIpc() {
  const handlers: Record<string, (...args: any[]) => any> = {
    // knowledge bases
    'kb:list': () => kbApi.list(),
    'kb:create': (_e, kb) => kbApi.create(kb),
    'kb:remove': (_e, id) => kbApi.remove(id),
    // papers
    'paper:list': () => paperApi.list(),
    'paper:get': (_e, id) => paperApi.get(id),
    'paper:create': (_e, paper) => paperApi.create(paper),
    'paper:update': (_e, id, patch) => paperApi.update(id, patch),
    'paper:remove': (_e, id) => paperApi.remove(id),
    'paper:readFile': (_e, id) => paperApi.readFile(id),
    // chat
    'chat:listConversations': () => chatApi.listConversations(),
    'chat:createConversation': (_e, conv) => chatApi.createConversation(conv),
    'chat:updateConversation': (_e, id, patch) => chatApi.updateConversation(id, patch),
    'chat:removeConversation': (_e, id) => chatApi.removeConversation(id),
    'chat:addMessage': (_e, msg) => chatApi.addMessage(msg),
    // highlights
    'highlight:listByPaper': (_e, paperId) => highlightApi.listByPaper(paperId),
    'highlight:create': (_e, h) => highlightApi.create(h),
    'highlight:remove': (_e, id) => highlightApi.remove(id),
    // settings
    'settings:get': (_e, key) => settingsApi.get(key),
    'settings:set': (_e, key, value) => settingsApi.set(key, value),
    // data management
    'data:export': () => exportAll(),
    'data:clear': () => clearAll(),
  }

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, fn)
  }
}
