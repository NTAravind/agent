# Autonomous Multi-Agent AI Platform
## Product Development & Technical Specification

**Version:** 2.1  
**Status:** Development blueprint  
**Architecture:** Multi-agent · MCP-based · Autonomous execution  
**Applications:** Web + Mobile  
**Web UI:** shadcn/ui (Tailwind CSS + Radix)

---

# 1. Product Overview

Build a universal autonomous AI agent platform where users can create, configure and deploy AI agents capable of independently performing real-world tasks.

Agents should be able to:
- Browse the internet.
- Send and receive WhatsApp messages.
- Send and receive emails.
- Access connected third-party applications.
- Research businesses and generate leads.
- Create and manage documents.
- Schedule meetings.
- Execute multi-step workflows.
- Delegate tasks to other agents.
- Communicate and collaborate with other agents.
- Remember previous interactions and completed work.
- Execute scheduled and event-triggered tasks.

The platform should work like an extensible AI operating system.

Users should not need to write code to give agents new capabilities. They should be able to connect an integration, grant permissions and assign it to an agent.

## Core product principles

1. Agents must be extensible through integrations.
2. Credentials must be managed centrally.
3. Agents must support autonomous multi-step execution.
4. Multiple agents must collaborate through structured communication.
5. Memory must persist across tasks.
6. External actions must respect permissions and approval policies.
7. Users must have visibility into everything agents do.

---

# 2. Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Web | Next.js | Main dashboard and application |
| Web UI | shadcn/ui + Tailwind CSS + Radix UI + lucide-react | Component library, design system, theming |
| Mobile | Expo / React Native | Mobile application |
| Mobile UI | NativeWind + React Native Reusables | shadcn-style components sharing web design tokens |
| AI interface | AI SDK | Model integration, streaming, tool interfaces |
| Agent orchestration | LangGraph | Planning, reasoning, agent execution |
| Database | Supabase PostgreSQL | Persistent application data |
| Authentication | Supabase Auth | User authentication |
| Vector database | pgvector | Semantic memory retrieval |
| Backend events | Inngest | Durable background execution |
| Realtime | Supabase Realtime | Live status and updates |
| File storage | Supabase Storage | Agent-generated artifacts |
| Integrations | MCP + API connectors | External capabilities |
| Validation | Zod | Runtime schema validation |
| Deployment | Docker / VPS | Production infrastructure |

**Important separation of responsibilities:**

- AI SDK: model interaction and streaming.
- LangGraph: reasoning, planning and agent orchestration.
- Inngest: durable execution, retries, schedules and event processing.
- Supabase: application data, authentication, memory and realtime.
- MCP Manager: discovering, managing and executing integrations.
- Credential Vault: securely storing and providing access to external credentials.

---

# 3. System Architecture

```text
                    USER
                     |
                     v
              NEXT.JS / EXPO
                     |
                     v
               API BACKEND
                     |
          +----------+----------+
          |          |          |
          v          v          v
       AGENT      CREDENTIAL   TASK
       ENGINE       VAULT     ENGINE
          |          |          |
          v          v          v
       LANGGRAPH   SUPABASE   INNGEST
          |
          v
     SUPERVISOR AGENT
          |
     +----+-----+
     |          |
     v          v
 WORKER 1    WORKER 2
     |          |
     +-----+----+
           |
           v
    CAPABILITY REGISTRY
           |
     +-----+------+
     |            |
     v            v
  MCP SERVER   API CONNECTORS
     |            |
     +------+-----+
            |
            v
    EXTERNAL SERVICES
 WhatsApp / Gmail / Browser
 Google Calendar / CRM
```

The system should be modular. Individual agents should never be directly coupled to specific integration implementations.

---

# 4. Workspace Management

Every user should have a workspace.

Workspace features:
- Workspace creation.
- Workspace settings.
- Agent management.
- Connected accounts.
- MCP integrations.
- Skills.
- Memory.
- Task history.
- Agent teams.
- Usage tracking.
- Workspace permissions.

For the initial individual project, implement one personal workspace per user while keeping the database structure ready for future multi-user workspaces.

---

# 5. Agent Management

Users must be able to create and configure agents.

## Agent configuration

Each agent should have:

- Name.
- Description.
- Avatar.
- System instructions.
- Selected AI model.
- Temperature and generation settings.
- Assigned tools.
- Connected accounts.
- Assigned skills.
- Memory settings.
- Execution limits.
- Permission settings.
- Autonomy level.
- Agent status.

## Autonomy levels

| Level | Behavior |
|---|---|
| Manual | Executes only when instructed |
| Assisted | Plans and asks before executing |
| Supervised | Executes permitted tasks and asks for approval for restricted actions |
| Autonomous | Executes within explicitly granted permissions and limits |

Autonomy must never bypass account permissions, platform restrictions or approval policies.

## Agent operations

- Create agent.
- Edit agent.
- Delete agent.
- Duplicate agent.
- Enable / disable agent.
- Chat with agent.
- Assign capabilities.
- Assign memory.
- Assign to a team.
- View execution history.

---

# 6. Multi-Agent Orchestration

This is one of the core features.

Use a hierarchical supervisor architecture.

## Supervisor agent

The supervisor receives a user request and determines:

1. What the user wants.
2. Whether the task requires multiple agents.
3. Which agents are suitable.
4. What capabilities are required.
5. How the task should be divided.
6. Which tasks can run in parallel.
7. Which tasks depend on other tasks.
8. Whether user approval is required.
9. Whether the results satisfy the request.

## Worker agents

Worker agents execute assigned subtasks.

Examples:

- Research Agent.
- Sales Agent.
- Marketing Agent.
- Coding Agent.
- Email Agent.
- Browser Agent.
- Data Analysis Agent.

Workers should return structured results to the supervisor.

## Agent communication

Implement a typed message bus.

Message types:

- TASK_ASSIGNMENT
- TASK_ACCEPTED
- TASK_PROGRESS
- TASK_COMPLETED
- TASK_FAILED
- INFORMATION_REQUEST
- INFORMATION_RESPONSE
- APPROVAL_REQUIRED
- RESULT_SUBMITTED
- TASK_CANCELLED

Every message should contain:

- Sender agent ID.
- Receiver agent ID.
- Task ID.
- Message type.
- Payload.
- Timestamp.
- Execution status.

Avoid unlimited agent-to-agent conversations. Use explicit tasks, messages and completion conditions.

## Delegation

Support:

- Parent tasks.
- Child tasks.
- Task dependencies.
- Parallel execution.
- Sequential execution.
- Task reassignment.
- Worker failure recovery.
- Result evaluation.
- Supervisor aggregation.

Add limits for delegation depth, concurrent agents, token consumption and tool calls.

---

# 7. Credential Vault

## Purpose

The Credential Vault is a central system for storing external account credentials.

Users connect an account once and can grant selected agents permission to use it.

Examples:

- WhatsApp Business.
- Gmail.
- Google Calendar.
- Slack.
- CRM applications.
- Other third-party services.

## Credential management

Implement:

- Account connection.
- OAuth authorization.
- API token storage.
- Credential encryption.
- Credential decryption.
- Token refresh.
- Credential validation.
- Connection health checks.
- Account disconnection.
- Credential rotation.
- Access audit logs.

## Storage architecture

Use Supabase PostgreSQL for encrypted credential records.

Store the encryption key outside the database, preferably in a secret manager or server environment.

Use authenticated encryption such as AES-256-GCM.

Each record should include:

- Credential ID.
- Owner user ID.
- Provider.
- Account name.
- Encrypted credential payload.
- Encryption key version.
- Connection status.
- Token expiration.
- Created timestamp.
- Updated timestamp.

Never store plaintext tokens in agent prompts, conversation history, task messages or logs.

## Credential access flow

```text
Agent requests an action
          |
          v
Capability execution layer
          |
          v
Identify connected account
          |
          v
Check agent permissions
          |
          v
Credential Vault
          |
          v
Decrypt credential server-side
          |
          v
Call external provider API
          |
          v
Return sanitized result
```

Agents must never receive raw access tokens.

## Account permissions

Users should be able to assign connected accounts to individual agents.

Example:

| Agent | Connected account | Permissions |
|---|---|---|
| Sales Agent | WhatsApp Business | Send messages |
| Support Agent | WhatsApp Business | Read and reply |
| Research Agent | Gmail | Read emails |
| Assistant Agent | Google Calendar | Read and create events |

Support:
- Read permissions.
- Write permissions.
- Send permissions.
- Delete permissions.
- Account-specific restrictions.
- Approval requirements.

Credentials belong to the workspace or user, not the agent.

---

# 8. MCP Manager & Capability Registry

The MCP Manager allows agents to access external tools dynamically.

## Supported capability sources

1. MCP servers.
2. Native API integrations.
3. Internal platform tools.
4. Custom user-defined integrations.

## MCP Manager features

- MCP server registry.
- Add MCP server.
- Install MCP server.
- Remove MCP server.
- Configure connection.
- Authenticate server.
- Discover available tools.
- Validate tool schemas.
- Execute tools.
- Monitor server health.
- Manage server permissions.
- Assign tools to agents.

## Dynamic capability discovery

Do not hardcode every available tool into every agent.

Create a capability registry that supports:

- `search_capabilities`
- `inspect_capability`
- `execute_capability`

An agent should be able to discover relevant tools when it needs them.

The registry should provide:
- Capability name.
- Description.
- Input schema.
- Required permissions.
- Connected account requirements.
- Execution endpoint.
- Availability status.

## MCP security

- Validate all tool inputs.
- Restrict server network access where possible.
- Isolate untrusted MCP servers.
- Enforce execution timeouts.
- Limit output sizes.
- Maintain tool execution logs.
- Never expose secrets to tool descriptions or model context.

---

# 9. Communication Integrations

Build a unified communication layer.

## WhatsApp Business

Support:

- Connect WhatsApp Business Cloud API.
- Configure Meta webhook.
- Receive incoming messages.
- Send text messages.
- Send approved templates.
- Receive message status updates.
- Read conversation context.
- Reply to incoming messages.
- Handle opt-outs and consent.

Example capability names:

- `send_whatsapp_message`
- `send_whatsapp_template`
- `get_whatsapp_conversation`
- `get_whatsapp_message_status`
- `reply_to_incoming_message`

Respect Meta's messaging policies, template requirements and customer service windows.

## Gmail

Support:

- OAuth connection.
- Read emails.
- Search emails.
- Send emails.
- Reply to emails.
- Create drafts.
- Read attachments.
- Manage labels.

## Google Calendar

Support:

- Read calendar events.
- Create events.
- Update events.
- Delete events.
- Check availability.

## Unified communication interface

Agents should be able to request communication actions without knowing the underlying provider implementation.

For example:

"Contact this lead through WhatsApp and email."

The capability layer selects the correct connected account and provider.

---

# 10. Skills System

Skills define how agents should perform tasks.

MCP provides capabilities. Skills provide reusable instructions and procedures.

Examples:

- Lead generation.
- Customer support.
- SEO research.
- Email writing.
- Competitor analysis.
- Social media planning.
- Website auditing.

Each skill should contain:

- Name.
- Description.
- Instructions.
- Required capabilities.
- Input requirements.
- Output requirements.
- Version.
- Author.
- Installation status.

Skills should be reusable across agents.

Support:
- Create skills.
- Edit skills.
- Install skills.
- Remove skills.
- Assign skills.
- Share skills.
- Version skills.

---

# 11. Hybrid Memory System

Use three types of memory.

## A. Workspace memory

Shared knowledge available to authorized agents.

Examples:
- Company information.
- Brand guidelines.
- Customer information.
- Business policies.
- Previous project details.

## B. Private agent memory

Knowledge specific to one agent.

Examples:
- Agent preferences.
- Specialized instructions.
- Previous decisions.
- Agent-specific learning.

## C. Temporary task memory

Information that exists for a particular execution.

Examples:
- Current research.
- Intermediate findings.
- Tool outputs.
- Task-specific context.

## Memory implementation

Use:
- Supabase PostgreSQL for structured records.
- pgvector for semantic search.
- Retrieval filtering by workspace and agent permissions.
- Summarization for long conversations.
- Explicit memory update and deletion policies.

Do not assume every agent can read every memory record.

---

# 12. Task Management

Every user request that requires execution should become a task.

Task fields:

- Task ID.
- Workspace ID.
- Parent task ID.
- Assigned agent ID.
- Task title.
- Description.
- Input.
- Output.
- Priority.
- Status.
- Start time.
- Completion time.
- Error details.

Task states:

- CREATED
- PLANNING
- QUEUED
- RUNNING
- WAITING_FOR_APPROVAL
- COMPLETED
- FAILED
- CANCELLED

Support task history, subtasks, dependencies, retries, cancellation and execution logs.

---

# 13. Autonomous Execution Engine

Use LangGraph for reasoning and Inngest for durable execution.

## Execution lifecycle

```text
USER REQUEST
     |
     v
TASK CREATION
     |
     v
SUPERVISOR PLANNING
     |
     v
CAPABILITY DISCOVERY
     |
     v
PERMISSION CHECK
     |
     v
TASK EXECUTION
     |
     v
RESULT EVALUATION
     |
     v
RETRY / DELEGATE / CONTINUE
     |
     v
FINAL RESULT
```

## Inngest responsibilities

- Background task execution.
- Retries.
- Scheduled execution.
- Event-triggered workflows.
- Long-running workflows.
- Approval waits.
- Task continuation.
- Failure handling.

## LangGraph responsibilities

- Agent reasoning.
- Task planning.
- Tool selection.
- Multi-agent delegation.
- State transitions.
- Result evaluation.
- Decision making.

Avoid running long-lived agent executions directly inside normal Next.js request handlers.

---

# 14. Permissions & Human Approval

External actions must follow an explicit permission policy.

Examples of sensitive actions:

- Sending WhatsApp messages.
- Sending emails.
- Deleting records.
- Publishing content.
- Making purchases.
- Changing account settings.
- Deploying applications.

Support configurable approval policies:

- Always ask.
- Ask for sensitive actions.
- Automatically execute permitted actions.

Each approval request should include:

- Agent.
- Action.
- Target.
- Proposed content or changes.
- Connected account.
- Approve / reject options.

Maintain an audit trail of decisions and executed actions.

---

# 15. Model Management

Support multiple model providers.

Features:

- Provider configuration.
- API key management.
- Model selection.
- Default model.
- Per-agent model selection.
- Fallback models.
- Token usage tracking.
- Cost tracking.
- Context window management.

Keep model providers behind a unified interface so providers can be added without rewriting the agent engine.

---

# 16. Monitoring & Observability

Users need to understand what their agents are doing.

Implement:

- Live agent activity.
- Task execution history.
- Tool execution history.
- Agent communication logs.
- Errors and retries.
- Token usage.
- Cost estimates.
- Execution duration.
- Approval history.
- Connected account health.

Every execution should have a trace ID that connects its tasks, agents, messages and tool calls.

---

# 17. Frontend Applications

## Web application — Next.js

Main sections:

1. Dashboard.
2. Agents.
3. Agent builder.
4. Agent chat.
5. Agent teams.
6. Task manager.
7. Task execution visualizer.
8. MCP marketplace.
9. Connected accounts.
10. Credential management.
11. Skills marketplace.
12. Memory manager.
13. Approval inbox.
14. Execution history.
15. Usage analytics.
16. Workspace settings.

## UI standards (shadcn/ui)

All web UI must be built with shadcn/ui.

**Setup**
- Shared primitives live in `packages/ui` (monorepo shadcn setup). `apps/web` and `packages/ui` each have a valid `components.json`.
- Components are added only via the CLI: `pnpm dlx shadcn@latest add <component>`. Do not hand-copy or imitate shadcn components.
- App-specific composed components live in `apps/web/components` and `apps/web/features/*`.
- Theme tokens (CSS variables) are defined once and shared. Light and dark modes via `next-themes`, with a theme toggle.

**Conventions**
- Style with Tailwind utilities and theme tokens (`bg-background`, `text-muted-foreground`, `border`). No hardcoded hex colors, no inline styles, no other UI libraries.
- Use `cn()` for conditional classes.
- Icons: `lucide-react` only.
- Forms: shadcn `Form` + `react-hook-form` + Zod resolver, reusing backend Zod schemas where possible.
- Data tables: shadcn `Table` + TanStack Table.
- Toasts: `sonner`.
- Charts: shadcn `Chart` (Recharts).
- Every screen handles loading (`Skeleton`), empty, and error (`Alert`) states, is responsive, and is keyboard accessible.

**Component map**

| Feature | Primary shadcn components |
|---|---|
| App shell | `sidebar`, `breadcrumb`, `command`, `dropdown-menu`, `avatar` |
| Agent builder | `form`, `tabs`, `slider`, `switch`, `select`, `textarea`, `card` |
| Agent chat | `scroll-area`, `textarea`, `button`, `avatar`, `skeleton` |
| Connected accounts / vault | `table`, `dialog`, `alert-dialog`, `badge`, `checkbox` |
| MCP / skills marketplace | `card`, `command`, `sheet`, `badge`, `input`, `tabs` |
| Task manager / history | `table`, `badge`, `progress`, `select`, `pagination` |
| Task execution visualizer | `resizable`, `collapsible`, `accordion`, `hover-card`, `sheet` |
| Approval inbox | `card`, `button`, `dialog`, `badge`, `sonner` |
| Memory manager | `tabs`, `table`, `dialog`, `command` |
| Usage analytics | `chart`, `card`, `calendar`, `popover` |

## Mobile application — Expo

Mobile features:

- Agent chat.
- Task creation.
- Live execution status.
- Agent notifications.
- Approval requests.
- Task history.
- Basic agent management.
- Connected account status.

Build mobile after the core backend and web execution flow are stable.

---

# 18. Database Design

Initial database tables:

## Users and workspaces

- `profiles`
- `workspaces`
- `workspace_members`

## Agents

- `agents`
- `agent_configs`
- `agent_tools`
- `agent_teams`
- `agent_team_members`

## Credentials

- `connected_accounts`
- `account_credentials`
- `agent_account_permissions`
- `credential_audit_logs`

## MCP and capabilities

- `mcp_servers`
- `mcp_installations`
- `capabilities`
- `agent_capabilities`
- `tool_execution_logs`

## Skills

- `skills`
- `skill_versions`
- `agent_skills`

## Tasks and communication

- `tasks`
- `agent_messages`
- `agent_runs`
- `task_dependencies`
- `agent_approvals`

## Memory and artifacts

- `agent_memory`
- `memory_embeddings`
- `artifacts`

## Monitoring

- `usage_records`
- `execution_events`
- `audit_logs`

Use UUID primary keys, timestamps, foreign keys, indexes and appropriate Supabase Row Level Security policies.

Do not store plaintext credentials in these tables.

---

# 19. Monorepo Structure

```text
autonomous-ai/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   └── lib/
│   │
│   ├── mobile/
│   │   ├── app/
│   │   ├── components/
│   │   └── features/
│   │
│   └── worker/
│       ├── inngest/
│       ├── events/
│       └── functions/
│
├── packages/
│   ├── agent-core/
│   ├── ai/
│   ├── orchestration/
│   ├── mcp/
│   ├── capabilities/
│   ├── credential-vault/
│   ├── skills/
│   ├── memory/
│   ├── task-engine/
│   ├── communication/
│   ├── database/
│   ├── auth/
│   ├── ui/                # shared shadcn/ui components + theme tokens
│   ├── shared/
│   └── observability/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── seed.sql
│
├── infrastructure/
│   ├── docker/
│   └── deployment/
│
├── package.json
└── pnpm-workspace.yaml
```

Keep packages independent and expose clear interfaces. Avoid circular dependencies.

---

# 20. Development Execution Order

Build in this exact order.

## Phase 1 — Foundation

- Set up monorepo.
- Configure Next.js.
- Set up shadcn/ui (`packages/ui`, theme tokens, dark mode, baseline components, app shell with sidebar).
- Configure Supabase.
- Implement authentication.
- Create workspace management.
- Set up database migrations.
- Configure Inngest.
- Configure environment management.

**Milestone:** User can sign up, log in and create a workspace.

## Phase 2 — Agent Core

- Agent CRUD.
- Agent configuration.
- AI SDK integration.
- Model provider abstraction.
- LangGraph runtime.
- Conversation history.
- Streaming chat.
- Basic tool-calling interface.

**Milestone:** User can create an agent and chat with it.

## Phase 3 — Credential Vault

- Connected account schema.
- Encryption and decryption.
- OAuth callback infrastructure.
- API token storage.
- Credential validation.
- Credential retrieval service.
- Account connection UI.
- Account permission management.
- Audit logs.

**Milestone:** User can connect an external account securely and grant an agent scoped access.

## Phase 4 — MCP Manager & Capability Registry

- MCP server registry.
- MCP installation.
- MCP connection lifecycle.
- Dynamic tool discovery.
- Capability registry.
- Tool execution.
- Credential injection.
- Permission validation.
- Execution logs.

**Milestone:** An agent can dynamically discover and execute tools using a connected account without seeing its credentials.

## Phase 5 — Single-Agent Autonomy

- Task creation.
- Task planning.
- Tool selection.
- Multi-step execution.
- Inngest background processing.
- Retries.
- Error recovery.
- Result evaluation.
- Approval checkpoints.
- Task monitoring.

**Milestone:** An agent can independently complete a multi-step task.

## Phase 6 — Memory

- Workspace memory.
- Private agent memory.
- Temporary task memory.
- Conversation summarization.
- pgvector integration.
- Semantic retrieval.
- Memory permissions.
- Memory update and deletion.

**Milestone:** Agents can recall relevant information from previous work.

## Phase 7 — Multi-Agent Orchestration

- Supervisor agent.
- Worker agents.
- Agent teams.
- Structured message bus.
- Parent-child tasks.
- Delegation.
- Parallel execution.
- Shared task context.
- Result aggregation.
- Failure recovery.

**Milestone:** A supervisor can delegate a task to multiple agents and combine their results.

## Phase 8 — Integrations & Skills Marketplace

- WhatsApp Business integration.
- Gmail integration.
- Google Calendar integration.
- Browser integration.
- CRM integrations.
- Skills engine.
- Skills marketplace.
- MCP marketplace.
- Agent templates.
- Scheduled automations.

**Milestone:** Users can extend agents through installable integrations and skills.

## Phase 9 — Frontend & Mobile

- Dashboard.
- Design consistency pass across all screens using shadcn/ui components and theme tokens.
- Agent builder.
- Team builder.
- Connected accounts UI.
- MCP marketplace UI.
- Skills marketplace UI.
- Task visualizer.
- Approval inbox.
- Memory manager.
- Expo application (NativeWind + React Native Reusables, shared design tokens).
- Push notifications.

**Milestone:** Complete user-facing web and mobile experience.

## Phase 10 — Production Hardening

- Security testing.
- Credential rotation.
- Rate limiting.
- Cost controls.
- Execution limits.
- Monitoring.
- Backups.
- Deployment.
- Error reporting.
- Performance testing.

**Milestone:** Production-ready platform.

---

# 21. First End-to-End Acceptance Scenario

Do not consider the core system complete until this scenario works.

**User instruction:**

"Find 20 potential website development clients in Bangalore, evaluate their businesses and prepare personalized WhatsApp messages."

Expected execution:

1. Supervisor receives the instruction.
2. Supervisor creates a task plan.
3. Research Agent discovers potential businesses using browser/search tools.
4. Analysis Agent evaluates the leads.
5. Supervisor combines the findings.
6. Sales Agent generates personalized messages.
7. WhatsApp capability checks the connected account and permissions.
8. The platform presents the messages for approval if required.
9. On approval, the WhatsApp integration sends the messages.
10. Execution results and message statuses are saved.

Acceptance criteria:

- Agents work independently.
- Agents communicate through structured messages.
- Tasks have parent-child relationships.
- Tools are dynamically discovered.
- Credentials remain hidden from agents.
- Permission checks happen before external actions.
- Failures can be retried safely.
- User can inspect the complete execution history.

---

# 22. Non-Functional Requirements

## Security
- Supabase RLS.
- Encrypted credentials.
- Server-side secret management.
- Scoped agent permissions.
- OAuth where supported.
- Webhook signature validation.
- Audit logs.
- Secure MCP execution.

## Reliability
- Durable background jobs.
- Retry policies.
- Idempotency for external actions.
- Task recovery.
- Timeout handling.
- Webhook deduplication.

## Performance and cost
- Parallel task execution where appropriate.
- Model routing.
- Token limits.
- Execution budgets.
- Tool call limits.
- Context management.
- Cached capability metadata.

## Extensibility
- Provider-independent model interface.
- Provider-independent communication interface.
- Dynamic capability registry.
- Versioned skills.
- Modular agent runtime.

---

# 23. Development Rules

1. Build backend functionality before polishing the UI.
2. Never hardcode integrations into agent definitions.
3. Never expose credentials to the LLM.
4. Never allow an agent to bypass permission checks.
5. Keep LangGraph responsible for reasoning and Inngest responsible for durable execution.
6. Use typed schemas for agent messages, task payloads and tool inputs.
7. Use structured database records instead of relying on conversation history as the source of truth.
8. Make external actions idempotent wherever possible.
9. Maintain complete execution logs.
10. Test each phase before starting the next.
11. Keep the system ready for future multi-user and multi-workspace support.
12. Build a functioning vertical slice before expanding the marketplace.
13. All web UI uses shadcn/ui, installed through the CLI. Do not build custom replicas of components that shadcn provides.
14. Every screen implements loading, empty and error states and works in light and dark mode.

---

# 24. First Development Target

The first usable version should support:

- One user workspace.
- Multiple agents.
- Agent chat.
- One connected WhatsApp Business account.
- One Credential Vault.
- One working MCP integration.
- Dynamic tool discovery.
- Single-agent task execution.
- Two-agent collaboration.
- Basic shared and private memory.
- Approval before sending external messages.
- Execution history.

Do not build every integration before proving this workflow.

**The central product concept:**

Users connect their accounts once, install capabilities, assign those capabilities to agents, and give agents instructions. The platform handles planning, permissions, execution, collaboration and reporting.

The long-term goal is an extensible autonomous AI platform where new capabilities can be installed without changing the underlying agent engine.