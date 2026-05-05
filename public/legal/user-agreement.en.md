# Lattice User Agreement and Local Call Audit Notice

Version: v0.1
Effective Date: May 5, 2026

This Agreement applies to the Lattice desktop application and its related features. By installing, launching, accessing, or continuing to use Lattice, you confirm that you have read, understood, and agreed to this Agreement. If you do not agree, you should stop using Lattice.

This document is a product agreement draft and does not constitute legal advice. Before public release, it should be reviewed by qualified legal counsel based on the applicable jurisdictions, target users, data processing practices, and third-party service terms.

## 1. Service Description

Lattice is a desktop tool for research, writing, computation, and automated workflows. The application may provide capabilities including:

- Managing local workspaces, files, projects, and runtime environments.
- Calling user-configured model services, API services, MCP services, plugins, or external tools.
- Assisting with generation, analysis, or processing in Creator, LaTeX, paper writing, code generation, compute scripts, Agent tool calls, and related modules.
- Recording certain call information locally for debugging, issue diagnosis, performance analysis, security auditing, and reproducibility investigation.

Lattice does not guarantee the accuracy, completeness, suitability, publishability, or reliability of any AI output, computation result, paper content, code snippet, or analysis conclusion. You are responsible for reviewing, verifying, and using such results.

## 2. Accounts, Configuration, and Local Environment

Lattice may allow you to configure third-party model providers, API keys, MCP servers, plugins, proxies, runtime commands, and local working directories. You are responsible for ensuring that your configurations are lawful, secure, and authorized.

You are responsible for securing your device, system account, API keys, access tokens, workspace files, and network environment. Losses caused by device compromise, credential leakage, untrusted plugins, external service failures, or incorrect local configuration are your responsibility.

## 3. AI and Third-Party Services

When you use Lattice to call third-party models, APIs, MCP servers, plugins, or other external services, relevant inputs, context, file snippets, prompts, tool parameters, or generated outputs may be sent to the corresponding service providers for processing.

You understand and agree that:

- Third-party services are independently operated by their providers. Lattice does not control their data processing practices, security policies, availability, pricing, rate limits, or output quality.
- You are responsible for reading and complying with the terms of service, privacy policies, license terms, and usage restrictions of those third-party services.
- You must not submit data or requests through Lattice that you are not authorized to process, that violate law or third-party rights, that contain restricted sensitive information, or that violate third-party terms.
- Fees, quota usage, account restrictions, service unavailability, or incorrect results from third-party services are your responsibility based on your relationship with those providers.

## 4. Workspace and Local File Operations

Lattice workspace features may read, create, modify, delete, index, or execute files and commands in directories selected by you. You should ensure that the selected workspace does not contain files you are not authorized to process and that your use complies with organizational policies, confidentiality requirements, and applicable law.

When command execution, script runs, dependency installation, batch file processing, compilation, testing, or automated Agent operations are involved, you understand that such operations may modify local files, generate new files, access network resources, consume compute resources, or trigger third-party service calls.

## 5. Local Call Audit Logs

To improve observability, diagnose issues, analyze performance, and support security auditing, Lattice may record API call and tool call information on your local device. The recorded information may include:

- Model calls, stream start and end events, provider, model, status, latency, error summaries, and token or usage information.
- Workspace IPC, workspace bash, file operations, compute script saves, and related module call summaries.
- Creator, LaTeX, paper writing, Agent tool calls, plugin calls, MCP tool calls, and related module events.
- Structured summaries of requests and responses, such as input fields, output types, text length, binary size, hash summaries, error categories, and call context.
- Timestamps, session identifiers, workspace identifiers, module names, operation names, and performance metrics associated with calls.

Audit logs are stored by default under the local application data directory in a `logs/api-calls/` subdirectory, such as Electron's `userData/logs/api-calls/`. Logs may use append-oriented writes, batched flushing, compression, rotation, and queueing mechanisms to improve write throughput and storage efficiency under high concurrency.

## 6. Sensitive Information Handling

Lattice makes reasonable efforts to reduce sensitive information in audit logs. For example:

- Common sensitive fields such as API Key, Token, Authorization, Cookie, Secret, and Password may be redacted or omitted.
- Large text, file content, or binary content may be recorded as length, type, summary, or SHA-256 hash instead of full content.
- Error objects and call parameters may be summarized in structured form to avoid storing unnecessary full context.

However, audit logs may still contain file paths, project names, prompt snippets, tool names, error messages, model names, call parameter structures, workflow context, or other information that may identify business or research content. You should not process information in Lattice that you are not authorized to process or do not want recorded in local logs unless you have confirmed that the relevant log settings meet your needs.

## 7. User Control and Deletion

You may control audit logging through application settings, environment variables, or local file management features made available by Lattice. In the current implementation, API call audit logging can be disabled with `LATTICE_API_AUDIT_ENABLED=0`. Future versions may provide more granular log switches, retention controls, export options, and cleanup features in the application settings.

You may delete audit log files from your local device. Deleting logs may affect issue diagnosis, error reproduction, performance analysis, and security auditing. If your organization has specific requirements for log retention, research data, confidentiality, or compliance audits, you are responsible for confirming that your use satisfies those requirements.

## 8. Plugins, MCP, and External Tool Risks

Lattice may support plugins, MCP servers, external commands, or user-defined tools. These extensions may read workspace content, call network services, execute local commands, generate or modify files, or access credentials configured by you.

You should only install, enable, and run plugins, MCP servers, and external tools from trusted sources. Data leakage, file corruption, service abuse, financial loss, or security incidents caused by third-party plugins, MCP servers, scripts, commands, or dependencies are your responsibility unless mandatory law provides otherwise.

## 9. Prohibited Uses

You must not use Lattice to:

- Violate applicable laws, regulations, research ethics, or organizational compliance policies.
- Access, copy, process, upload, disclose, or damage another party's data, systems, accounts, or intellectual property without authorization.
- Submit malicious code, credential theft scripts, attack payloads, requests to bypass security measures, or other high-risk content.
- Abuse third-party models, APIs, plugins, MCP servers, or compute resources.
- Present AI output as unreviewed facts, experimental results, peer review comments, legal advice, medical advice, investment advice, or other professional conclusions.

## 10. Intellectual Property and Content Responsibility

You retain the rights you lawfully own in your input content, workspace files, project data, and generated outputs. You are responsible for ensuring that your inputs, references, uploads, generated content, saved materials, and publications do not infringe intellectual property rights, trade secrets, privacy rights, publicity rights, reputation rights, or other lawful rights of others.

AI-generated content may be similar to existing public content and may contain factual errors, citation errors, license incompatibilities, or material unsuitable for public release. Before using, publishing, submitting, commercializing, or distributing such content, you should perform plagiarism checks, factual verification, citation verification, license review, and human review.

## 11. Data Security and Backups

You are responsible for maintaining backups of important files, projects, papers, experimental data, configurations, credentials, and logs. Lattice does not promise cloud backup of your local data and does not guarantee that file operations, automated tasks, external commands, or third-party service calls will not cause data loss, overwriting, corruption, or disclosure.

For important workspaces, you should keep recoverable copies through version control, snapshots, backup directories, or other reliable methods before enabling automated editing, batch processing, command execution, plugin calls, or Agent operations.

## 12. Agreement Updates

Lattice may update this Agreement due to feature changes, logging capability changes, third-party service changes, compliance requirements, or security reasons. Updated terms may be presented through in-app notices, settings pages, release notes, repository documents, or other reasonable methods.

If an update materially changes important rights and obligations, data processing scope, or audit logging practices, Lattice should make reasonable efforts to provide prominent notice. Your continued use of Lattice after an update constitutes acceptance of the updated Agreement.

## 13. Disclaimers and Limitation of Liability

To the maximum extent permitted by applicable law, Lattice is provided as is and makes no express or implied warranties that:

- The service will be continuously available, error-free, uninterrupted, or fully secure.
- AI output, computation results, code, citations, formatting, paper content, or analysis conclusions will be accurate, complete, reliable, or fit for a particular purpose.
- Third-party models, APIs, MCP servers, plugins, dependencies, or external tools will meet your expectations.
- Local logging, summarization, redaction, compression, rotation, or deletion mechanisms will satisfy your or your organization's compliance requirements in all scenarios.

To the extent permitted by applicable law, Lattice will not be liable for indirect damages, lost profits, data loss, research delays, business interruption, reputational harm, or third-party claims arising from the use or inability to use Lattice, third-party services, plugins, MCP servers, external commands, AI output, or local logging features.

## 14. Contact and Feedback

If you have questions about this Agreement, audit logs, data processing practices, or security issues, you may contact the project maintainers through the available channels. If you use Lattice in an organizational, team, or regulated environment, you should consult your organization's legal, information security, data protection, or compliance personnel first.
