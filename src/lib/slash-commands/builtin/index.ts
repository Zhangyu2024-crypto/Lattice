// Builtin slash commands. To add one:
//   1. Create `./<name>.ts` exporting a `Command`.
//   2. Import and append to `BUILTIN_COMMANDS` below.
//   3. If it should also appear in the Ctrl+Shift+P palette, set
//      `paletteGroup` on the command.

import type { Command } from '../types'
import { clearCommand } from './clear'
import { helpCommand } from './help'
import { settingsCommand } from './settings'
import { libraryCommand } from './library'
import { researchCommand } from './research'

export const BUILTIN_COMMANDS: Command[] = [
  clearCommand,
  helpCommand,
  settingsCommand,
  libraryCommand,
  researchCommand,
]
