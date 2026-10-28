import type { ParsedSummaryInput } from '../utils/parsedSummary'

export type SummarySourceKind = 'paper' | 'web'
export type SummaryRecordSlot = 'materials' | 'report' | 'task'

/** Serialized, versioned pipeline state. Provider credentials never belong here. */
export interface DocumentSummaryWrite {
  kind: SummarySourceKind
  sourceId: string
  slot: SummaryRecordSlot
  sourceHash: string
  payload: string
}

export interface DocumentSummaryRecord extends DocumentSummaryWrite {
  updatedAt: number
}

export interface DocumentSummaryApi {
  parse: (kind: SummarySourceKind, sourceId: string) => Promise<ParsedSummaryInput>
  get: (kind: SummarySourceKind, sourceId: string, slot: SummaryRecordSlot) => Promise<DocumentSummaryRecord | null>
  save: (record: DocumentSummaryWrite) => Promise<DocumentSummaryRecord>
  saveAsset: (kind: SummarySourceKind, sourceId: string, data: string) => Promise<string>
  readAsset: (id: string) => Promise<string | null>
}
