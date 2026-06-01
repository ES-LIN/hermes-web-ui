import { getActiveProfileDir } from './hermes-profile'
import { spawnHermesWithBin } from './hermes-process'
import { createWriteStream, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { botLogFile, botLogger } from '../logger'

function createBotLogStream(): NodeJS.WritableStream {
  try {
    const dir = dirname(botLogFile)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const stream = createWriteStream(botLogFile, { flags: 'a' })
    // Verify the stream opened successfully
    if (stream.fd === null || stream.fd === undefined) {
      botLogger.warn('[gateway] bot.log stream fd is null, falling back to ignore')
      return 'ignore' as any
    }
    return stream
  } catch (err) {
    botLogger.warn({ err }, '[gateway] failed to open bot.log, falling back to ignore')
    return 'ignore' as any
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
