import type { GameId } from '../../shared/types'
import type { GameAdapter } from './types'
import { cyberpunk2077 } from './cyberpunk2077'

const GAMES: Record<GameId, GameAdapter> = { cyberpunk2077 }

export function getGame(id: GameId): GameAdapter {
  const g = GAMES[id]
  if (!g) throw new Error(`Unsupported game: ${id}`)
  return g
}

export function listGames(): GameAdapter[] {
  return Object.values(GAMES)
}
