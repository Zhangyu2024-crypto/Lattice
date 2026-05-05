export const USER_AGREEMENT_VERSION = '2026-05-05'

export const USER_AGREEMENT_TITLE = 'Lattice User Agreement & Local Audit Notice'

export const USER_AGREEMENT_SECTIONS = [
  {
    title: 'Local activity records',
    body:
      'Lattice may keep local records of actions that help explain how the app was used, including AI requests routed through configured providers, workspace file operations, Creator and LaTeX assistant actions, agent tool calls, plugin and MCP activity, workspace shell commands, and related app integrations.',
  },
  {
    title: 'Where records are stored',
    body:
      'These records are stored only on this computer under Electron userData/logs/api-calls as JSONL files. Lattice does not upload these local records unless you choose to export, share, sync, or otherwise transmit them.',
  },
  {
    title: 'Sensitive information',
    body:
      'Lattice is designed to redact API keys, authorization headers, approval tokens, passwords, secrets, access tokens, cookies, and similarly named fields before they are written to local records. Large text and binary payloads are summarized with byte length and SHA-256 rather than being stored in full.',
  },
  {
    title: 'Third-party services',
    body:
      'You may connect Lattice to LLM providers, MCP servers, plugins, sync backends, and other integrations. Data sent to those services is handled according to the provider, server, plugin, or tool you choose, in addition to Lattice settings.',
  },
  {
    title: 'Your controls',
    body:
      'You can keep local activity records disabled, enable or disable them later from Settings, open the record folder, export the record folder, clear local records, and adjust retention. Clearing records removes only the local activity record directory.',
  },
] as const

export function getUserAgreementMarkdown(): string {
  return [
    `# ${USER_AGREEMENT_TITLE}`,
    '',
    `Version: ${USER_AGREEMENT_VERSION}`,
    '',
    ...USER_AGREEMENT_SECTIONS.flatMap((section) => [
      `## ${section.title}`,
      section.body,
      '',
    ]),
  ].join('\n')
}
