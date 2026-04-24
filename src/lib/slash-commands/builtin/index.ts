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
import { artifactCommand } from './artifact'
import { researchCommand } from './research'
import { modelCommand } from './model'
import { effortCommand } from './effort'
import { compactCommand } from './compact'
import { resumeCommand } from './resume'

export const BUILTIN_COMMANDS: Command[] = [
  clearCommand,
  helpCommand,
  settingsCommand,
  libraryCommand,
  artifactCommand,
  researchCommand,
  // Model-routing knobs — session-scoped overrides mutate
  // `useModelRouteStore` and take effect on the next submit.
  // /model swaps provider+model; /effort is the real reasoning axis.
  modelCommand,
  effortCommand,
  // Conversation management.
  compactCommand,
  // Session navigation.
  resumeCommand,
]
