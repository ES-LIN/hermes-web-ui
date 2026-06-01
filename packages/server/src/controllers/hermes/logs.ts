import { existsSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import * as hermesCli from '../../services/hermes/hermes-cli'
import { config } from '../../config'
import { botLogFile } from '../../services/logger'

const WEBUI_LOG_FILE = join(config.appHome, 'logs', 'server.log')
const BRIDGE_LOG_FILE = join(config.appHome, 'logs', 'bridge.log')
const BOT_LOG_FILE = botLogFile

interface LogEntry {
  timestamp: string; level: string; logger: string; message: string; raw: string
}

function appendPinoContext(message: string, obj: any): string {
  const parts: string[] = []
  const runtime = obj.runtime && typeof obj.runtime === 'object' ? obj.runtime : null
  if (runtime) {
    if (runtime.profile) parts.push(`profile=${runtime.profile}`)
    if (runtime.cwd) parts.push(`cwd=${runtime.cwd}`)
    if (runtime.profile_dir) parts.push(`profile_dir=${runtime.profile_dir}`)
    if (runtime.config_path) parts.push(`config=${runtime.config_path}`)
  } else if (obj.profile) {
    parts.push(`profile=${obj.profile}`)
  }
  if (obj.request?.action) parts.push(`action=${obj.request.action}`)
  if (obj.sessionId) parts.push(`session=${obj.sessionId}`)
  if (obj.runId) parts.push(`run=${obj.runId}`)
  if (obj.status) parts.push(`status=${obj.status}`)
  return parts.length > 0 ? `${message} ${parts.join(' ')}` : message
}

function parseLine(line: string): LogEntry {
  try {
    const obj = JSON.parse(line)
    if (obj.level && obj.time) {
      const ts = new Date(obj.time).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
      const levelMap: Record<number, string> = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' }
      // Pino 日志格式: { level, time, msg, name (logger name), hostname, pid, ... }
      const loggerName = obj.name || obj.logger || 'app'
      const message = obj.msg || (obj.err ? obj.err.message : '')
      const baseMessage = typeof message === 'string' ? message : JSON.stringify(message)
      return { timestamp: ts, level: levelMap[obj.level] || 'INFO', logger: loggerName, message: appendPinoContext(baseMessage, obj), raw: line }
    }
  } catch {}
  let match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(\S+?):\s(.*)$/)
  if (match) { return { timestamp: match[1], level: match[2], logger: match[3], message: match[4], raw: line } }
  match = line.match(/^\[(\S+?)\]\s+\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\]\s+\[(DEBUG|INFO|WARNING|ERROR|CRITICAL)\]\s(.*)$/)
  if (match) { return { timestamp: match[2], level: match[3], logger: match[1], message: match[4], raw: line } }
  return { timestamp: '', level: '', logger: '', message: line, raw: line }
}

function fileInfo(name: string, file: string) {
  if (!existsSync(file)) return null
  try {
    const stat = statSync(file)
    const size = stat.size > 1024 * 1024 ? `${(stat.size / 1024 / 1024).toFixed(1)}MB` : `${(stat.size / 1024).toFixed(1)}KB`
    const modified = stat.mtime.toLocaleString()
    return { name, size, modified }
  } catch {
    return null
  }
}

function localLogPath(logName: string): string | null {
  if (logName === 'webui') return WEBUI_LOG_FILE
  if (logName === 'bridge') return BRIDGE_LOG_FILE
  if (logName === 'bot') return BOT_LOG_FILE
  return null
}

function filterEntries(entries: LogEntry[], level?: string, session?: string, since?: string): LogEntry[] {
  let result = entries
  if (level) {
    const wanted = level.toUpperCase()
    result = result.filter(entry => entry.level.toUpperCase() === wanted)
  }
  if (session) {
    result = result.filter(entry => entry.raw.includes(session) || entry.message.includes(session))
  }
  if (since) {
    const sinceTime = Date.parse(since)
    if (Number.isFinite(sinceTime)) {
      result = result.filter(entry => {
        const entryTime = Date.parse(entry.timestamp)
        return Number.isFinite(entryTime) && entryTime >= sinceTime
      })
    }
  }
  return result
}

function parseEntriesFromContent(content: string, lines: number): LogEntry[] {
  const rawLines = content.split('\n')
  const sliced = rawLines.length > lines ? rawLines.slice(-lines) : rawLines
  const entries: LogEntry[] = []
  for (const line of sliced) {
    if (!line.trim()) continue
    entries.push(parseLine(line))
  }
  return entries
}

async function readLocalLog(logName: string, lines: number, level?: string, session?: string, since?: string): Promise<{ raw: string; entries: LogEntry[] }> {
  const file = localLogPath(logName)
  if (!file || !existsSync(file)) return { raw: '', entries: [] }
  const content = await readFile(file, 'utf-8')
  const entries = filterEntries(parseEntriesFromContent(content, Number.MAX_SAFE_INTEGER), level, session, since)
  const sliced = entries.length > lines ? entries.slice(-lines) : entries
  const raw = sliced.map(entry => entry.raw).filter(line => line.trim()).join('\n')
  return { raw, entries: sliced }
}

async function readAnyLog(logName: string, lines: number, level?: string, session?: string, since?: string): Promise<{ raw: string; entries: LogEntry[] }> {
  if (localLogPath(logName)) {
    return readLocalLog(logName, lines, level, session, since)
  }
  const content = await hermesCli.readLogs(logName, lines, level, session, since)
  const entries: LogEntry[] = []
  for (const line of content.split('\n')) {
    if (line.startsWith('---') || line.trim() === '') continue
    entries.push(parseLine(line))
  }
  return { raw: content, entries }
}

export async function list(ctx: any) {
  const files = await hermesCli.listLogFiles()
  for (const info of [
    fileInfo('webui', WEBUI_LOG_FILE),
    fileInfo('bridge', BRIDGE_LOG_FILE),
    fileInfo('bot', BOT_LOG_FILE),
  ]) {
    if (info) files.push(info)
  }
  ctx.body = { files }
}

export async function read(ctx: any) {
  const logName = ctx.params.name
  const lines = ctx.query.lines ? parseInt(ctx.query.lines as string, 10) : 100
  const level = (ctx.query.level as string) || undefined
  const session = (ctx.query.session as string) || undefined
  const since = (ctx.query.since as string) || undefined

  try {
    const { entries } = await readAnyLog(logName, lines, level, session, since)
    ctx.body = { entries: entries.reverse() }
  } catch (err: any) {
    ctx.status = 500; ctx.body = { error: err.message }
  }
}

export async function exportLog(ctx: any) {
  const logName = ctx.params.name
  const lines = ctx.query.lines ? parseInt(ctx.query.lines as string, 10) : 100
  const level = (ctx.query.level as string) || undefined
  const session = (ctx.query.session as string) || undefined
  const since = (ctx.query.since as string) || undefined
  const format = ctx.query.format === 'json' ? 'json' : 'txt'

  try {
    const { raw, entries } = await readAnyLog(logName, lines, level, session, since)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeName = String(logName).replace(/[^a-z0-9_-]/gi, '_')
    ctx.set('Content-Disposition', `attachment; filename="hermes-log-${safeName}-${timestamp}.${format}"`)
    if (format === 'json') {
      ctx.type = 'application/json'
      ctx.body = JSON.stringify(entries, null, 2)
      return
    }
    ctx.type = 'text/plain; charset=utf-8'
    ctx.body = raw || entries.map(entry => entry.raw).join('\n')
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
}
