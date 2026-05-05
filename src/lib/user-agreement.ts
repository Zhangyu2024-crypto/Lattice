export const USER_AGREEMENT_VERSION = '2026-05-05'

export const USER_AGREEMENT_TITLE = 'Lattice User Agreement & Local Audit Notice'

export const USER_AGREEMENT_SECTIONS = [
  {
    title: 'Local call audit logging',
    body:
      'Lattice can keep a local audit trail for model requests, workspace file operations, Creator/LaTeX AI actions, agent tool calls, plugins, MCP servers, workspace shell commands, and related app integrations.',
  },
  {
    title: 'Storage location',
    body:
      'Audit logs are stored on this computer under Electron userData/logs/api-calls as JSONL files. They are not uploaded by Lattice unless you explicitly export or share them.',
  },
  {
    title: 'Sensitive data handling',
    body:
      'Lattice redacts API keys, authorization headers, approval tokens, passwords, secrets, access tokens, cookies, and similarly named fields. Large text and binary payloads are summarized by byte length and SHA-256 instead of being written in full.',
  },
  {
    title: 'Third-party services',
    body:
      'LLM providers, MCP servers, plugins, sync backends, and other integrations may be configured by you. Their data handling depends on the provider or tool you choose, not only on Lattice.',
  },
  {
    title: 'Your controls',
    body:
      'You can keep audit logging disabled, enable or disable it later from Settings, open the log folder, export the log folder, clear audit logs, and adjust retention. Clearing audit logs only removes the local audit log directory.',
  },
  {
    title: 'Draft notice',
    body:
      'This engineering notice is intended to describe app behavior. It is not legal advice and should be reviewed before public distribution.',
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
