import { getApiKey, getBaseUrlValue, request } from '../client'

export interface LogFileInfo {
  name: string
  size: string
  modified: string
}

export interface LogEntry {
  timestamp: string
  level: string
  logger: string
  message: string
  raw: string
}

export async function fetchLogFiles(): Promise<LogFileInfo[]> {
  const res = await request<{ files: LogFileInfo[] }>('/api/hermes/logs')
  return res.files
}

export async function fetchLogs(name: string, params?: {
  lines?: number
  level?: string
  session?: string
  since?: string
}): Promise<LogEntry[]> {
  const query = new URLSearchParams()
  if (params?.lines) query.set('lines', String(params.lines))
  if (params?.level) query.set('level', params.level)
  if (params?.session) query.set('session', params.session)
  if (params?.since) query.set('since', params.since)
  const qs = query.toString()
  const res = await request<{ entries: (LogEntry | null)[] }>(`/api/hermes/logs/${name}${qs ? `?${qs}` : ''}`)
  return res.entries.filter((e): e is LogEntry => e !== null)
}

export function buildLogExportUrl(name: string, params?: {
  lines?: number
  level?: string
  session?: string
  since?: string
  format?: 'txt' | 'json'
}): string {
  const query = new URLSearchParams()
  if (params?.lines) query.set('lines', String(params.lines))
  if (params?.level) query.set('level', params.level)
  if (params?.session) query.set('session', params.session)
  if (params?.since) query.set('since', params.since)
  if (params?.format) query.set('format', params.format)
  query.set('token', getApiKey())
  return `${getBaseUrlValue()}/api/hermes/logs/${encodeURIComponent(name)}/export?${query.toString()}`
}

export function downloadLog(name: string, params?: Parameters<typeof buildLogExportUrl>[1]): void {
  const a = document.createElement('a')
  a.href = buildLogExportUrl(name, params)
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}
