import { getActiveProfileDir } from './hermes-profile'
import { spawnHermesWithBin } from './hermes-process'
import { createWriteStream, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { botLogFile, botLogger } from '../logger'
import type { Stream } from 'stream'

function createBotLogStream(): Stream | 'ignore' {
  try {
    const dir = dirname(botLogFile)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return createWriteStream(botLogFile, { flags: 'a' }) as unknown as Stream
  } catch (err) {
    botLogger.warn({ err }, '[gateway] failed to open bot.log, falling back to ignore')
    return 'ignore'
  }
}

export function startGatewayRunManaged(
  hermesBin: string,
  opts: { profileDir?: string } = {},
): { pid: number | null; reused: boolean } {
  const profileDir = opts.profileDir || getActiveProfileDir()
  const botLog = createBotLogStream()
  const child = spawnHermesWithBin(hermesBin, ['gateway', 'run', '--replace'], {
    detached: true,
    stdio: ['ignore', botLog, botLog],
    windowsHide: true,
    env: {
      ...process.env,
      HERMES_HOME: profileDir,
    },
  })
  child.unref()

  const pid = child.pid ?? null
  botLogger.info({ pid, profileDir }, '[gateway] managed gateway run started')
  return { pid, reused: false }
}
