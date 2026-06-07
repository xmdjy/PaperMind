// Renderer-side type declaration for the db API exposed via preload contextBridge.
export interface DbApi {
  kb: {
    list: () => Promise<any[]>
    create: (kb: any) => Promise<any>
    remove: (id: string) => Promise<void>
  }
  paper: {
    list: () => Promise<any[]>
    get: (id: string) => Promise<any | null>
    create: (paper: any) => Promise<any>
    update: (id: string, patch: any) => Promise<void>
    remove: (id: string) => Promise<void>
    readFile: (id: string) => Promise<string | null>
  }
  chat: {
    listConversations: () => Promise<any[]>
    createConversation: (conv: any) => Promise<any>
    updateConversation: (id: string, patch: any) => Promise<void>
    removeConversation: (id: string) => Promise<void>
    addMessage: (msg: any) => Promise<void>
  }
  highlight: {
    listByPaper: (paperId: string) => Promise<any[]>
    create: (h: any) => Promise<any>
    remove: (id: string) => Promise<void>
  }
  settings: {
    get: (key: string) => Promise<any | null>
    set: (key: string, value: any) => Promise<void>
  }
  data: {
    export: () => Promise<any>
    clear: () => Promise<void>
  }
}

declare global {
  interface Window {
    db: DbApi
  }
}

export {}
