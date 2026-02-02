# Architecture Improvements — Taking the Platform to Production-Grade

**Date:** 2026-02-02  
**Context:** Improvements over the current GyanMirai multi-agent architecture + the universal platform architecture

---

## 1. The 10 Biggest Gaps in the Current Architecture

| # | Gap | Impact | Severity |
|---|---|---|---|
| 1 | **Polling-only execution** — agents only work on heartbeats | 30-60 min latency between task creation and pickup | 🔴 Critical |
| 2 | **No concurrent task execution** — one agent = one task at a time | Underutilizes agents, wastes idle time | 🔴 Critical |
| 3 | **JSON file as database** — task-board.json has no locking/versioning | Race conditions when multiple agents write simultaneously | 🔴 Critical |
| 4 | **No feedback loops** — agents don't learn from past mistakes | Same errors repeat across heartbeats | 🟡 High |
| 5 | **Orchestrator bottleneck** — Squad Lead is a single point of failure | If lead crashes, entire system stalls | 🟡 High |
| 6 | **No artifact validation** — deliverables aren't auto-verified | Bad content passes through unless reviewer catches it | 🟡 High |
| 7 | **Flat task model** — no subtasks, epics, or dependency DAGs | Can't model complex multi-step workflows | 🟠 Medium |
| 8 | **No human approval workflow** — human just watches Slack | No structured approve/reject/redirect UX | 🟠 Medium |
| 9 | **No cross-project learning** — each project starts from zero | Doesn't get smarter over time | 🟠 Medium |

---

## 2. Improvement 1: Event-Driven Architecture (Replace Pure Polling)

### Problem
Current: Agent heartbeats every 30-60 min → checks for tasks → works → waits again.  
A task created at minute 1 waits up to 59 minutes to be picked up.

### Solution: Hybrid Event + Heartbeat

```
┌──────────────────────────────────────────────────────────────────┐
│                    EVENT BUS (Redis Pub/Sub)                      │
│                                                                   │
│  Events:                                                          │
│  • task.created    → target agent wakes immediately               │
│  • task.reviewed   → assignee wakes for revision/next             │
│  • task.blocked    → lead wakes for escalation                    │
│  • goal.updated    → lead wakes for re-planning                   │
│  • cost.warning    → cost controller triggers                     │
│  • human.directive → lead wakes for human input                   │
│                                                                   │
│  FLOW:                                                            │
│                                                                   │
│  Lead creates task → publishes task.created{agentId: "dev"}       │
│       │                    │                                      │
│       │                    ▼                                      │
│       │              Event Bus routes to dev agent                │
│       │                    │                                      │
│       │                    ▼                                      │
│       │              Dev agent wakes IMMEDIATELY                  │
│       │              (not waiting for next heartbeat)             │
│       │                    │                                      │
│       │                    ▼                                      │
│       │              Dev does work → publishes task.review_ready  │
│       │                    │                                      │
│       │                    ▼                                      │
│       │              QA agent wakes IMMEDIATELY                   │
│       │              Reviews → publishes task.approved            │
│       │                                                           │
│       ▼                                                           │
│  Heartbeats remain as BACKUP:                                     │
│  • Catch missed events                                            │
│  • Periodic health checks                                         │
│  • Memory maintenance                                             │
│  • Goal re-evaluation (Lead only)                                 │
└──────────────────────────────────────────────────────────────────┘

LATENCY COMPARISON:
  Before: Task created → 30-60 min → Agent picks up
  After:  Task created → ~5 sec → Agent picks up
```

### Implementation
```yaml
# Event configuration in squad.yaml
events:
  bus: "redis"  # or "file-watcher" for MVP, "nats" for scale
  channels:
    - "project.{projectId}.tasks"
    - "project.{projectId}.reviews"
    - "project.{projectId}.alerts"
  
agents:
  - id: dev
    wake_on:
      - "task.created[assignee=dev]"
      - "task.needs_revision[assignee=dev]"
    heartbeat: "60m"  # fallback only
```

---

## 3. Improvement 2: Workflow Engine (Beyond Linear Task Lifecycle)

### Problem
Current lifecycle is flat: `inbox → assigned → in_progress → review → done`.  
Real work is more complex: parallel subtasks, conditional branching, multi-stage pipelines.

### Solution: DAG-Based Workflow Engine

```
CURRENT (flat):
  Task A ──→ Task B ──→ Task C ──→ Done

IMPROVED (DAG):
                    ┌── Task B (Dev: Backend API) ──┐
  Task A (Design) ──┤                                ├── Task D (QA: Integration Test) ── Task E (Deploy)
                    └── Task C (Dev: Frontend UI) ──┘
                                                      │
                                                      ├── Task F (SEO: Meta tags) ─── auto
                                                      
  FEATURES:
  • Parallel execution: B and C run simultaneously
  • Auto-triggers: D starts automatically when B AND C both complete
  • Conditional: F only runs if Task A has label "public-facing"
  • Subtasks: B can spawn B.1, B.2, B.3 internally
```

### Enhanced Task Schema
```json
{
  "id": "task-042",
  "title": "Build user dashboard",
  "type": "epic | task | subtask",
  "parentId": "task-040",           // for subtasks
  "dependsOn": ["task-038", "task-039"],  // DAG: both must be done
  "triggers": [                     // auto-create when this completes
    { "template": "qa-review", "assignTo": "qa" },
    { "template": "seo-check", "condition": "labels.includes('public')" }
  ],
  "subtasks": [                     // decomposed by assignee
    { "id": "task-042-a", "title": "API endpoints", "status": "done" },
    { "id": "task-042-b", "title": "UI components", "status": "in_progress" }
  ],
  "estimatedTokens": 50000,        // for cost prediction
  "actualTokens": null,            // filled after completion
  "timeTracking": {
    "assignedAt": "ISO",
    "startedAt": "ISO",
    "reviewedAt": "ISO",
    "completedAt": "ISO",
    "totalRevisions": 0
  }
}
```

### Workflow Templates (Reusable Patterns)
```yaml
# workflows/content-pipeline.yaml
name: "Content Generation Pipeline"
steps:
  - id: research
    role: content-creator
    tools: [web_search, web_fetch]
    output: "research-notes.md"
    
  - id: draft
    role: content-creator
    dependsOn: [research]
    output: "draft-content.json"
    
  - id: review
    role: qa-reviewer
    dependsOn: [draft]
    checklist: "content-quality-checklist.md"
    outcomes:
      approved: { next: publish }
      rejected: { next: draft, max_revisions: 3 }
      
  - id: publish
    role: developer
    dependsOn: [review]
    action: "commit to repo"

# workflows/feature-pipeline.yaml
name: "Feature Development Pipeline"
steps:
  - id: spec
    role: analyst
    output: "spec.md"
  - id: implement
    role: developer
    dependsOn: [spec]
    parallel: true  # can split into subtasks
  - id: test
    role: qa-reviewer
    dependsOn: [implement]
  - id: deploy
    role: devops
    dependsOn: [test]
    requires_approval: true  # human must approve
```

---

## 4. Improvement 3: Agent Memory & Learning System

### Problem
Agents start fresh every session. Ronin rejects task-003 for duplication issues. Sensei fixes it. Next time Sensei generates content, same duplication pattern appears because Sensei doesn't remember the lesson.

### Solution: Three-Tier Memory Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT MEMORY SYSTEM                            │
│                                                                   │
│  TIER 1: WORKING MEMORY (per-session)                            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ • Current task context                                       │ │
│  │ • Files being worked on                                      │ │
│  │ • Recent conversation with other agents                      │ │
│  │ Lifetime: single session / heartbeat cycle                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  TIER 2: AGENT MEMORY (persistent per-agent)                     │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ LESSONS.md — Things I've learned from reviews                │ │
│  │ • "Always check for duplicate example sentences"             │ │
│  │ • "N1 kanji must have 3+ example sentences minimum"          │ │
│  │ • "Run schema validation before marking task complete"        │ │
│  │                                                               │ │
│  │ PATTERNS.md — Successful patterns I've developed             │ │
│  │ • "Cross-reference jisho.org AND weblio for accuracy"         │ │
│  │ • "Build command: always use --fail-on-warning flag"          │ │
│  │                                                               │ │
│  │ MISTAKES.md — Specific failures and their fixes               │ │
│  │ • "task-003 rejected: duplicate sentences in N5 papers"       │ │
│  │   → Fix: deduplicate against existing content before writing  │ │
│  │                                                               │ │
│  │ Lifetime: persists across all sessions for this agent         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  TIER 3: COLLECTIVE MEMORY (shared across all agents in project) │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ project-knowledge/                                            │ │
│  │ ├── decisions.md    — Architectural decisions + rationale     │ │
│  │ ├── conventions.md  — Code/content conventions agreed upon    │ │
│  │ ├── glossary.md     — Domain terms + definitions              │ │
│  │ ├── blockers.md     — Known issues + workarounds              │ │
│  │ └── reviews/        — Review feedback archive (searchable)    │ │
│  │                                                               │ │
│  │ Lifetime: project lifetime, curated by Lead agent             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  TIER 4: PLATFORM MEMORY (cross-project, cross-customer)         │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Anonymized patterns that work across projects:                │ │
│  │ • "Content agents produce 40% fewer revisions when they       │ │
│  │    research from 3+ sources before generating"                │ │
│  │ • "QA agents catch 2x more issues with structured checklists  │ │
│  │    vs. freeform review"                                       │ │
│  │ • "Tasks with clear acceptance criteria have 60% higher       │ │
│  │    first-pass approval rate"                                  │ │
│  │                                                               │ │
│  │ Lifetime: platform lifetime, improves all future projects     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

LEARNING LOOP:
  Agent does work → Reviewer rejects → Agent reads feedback
       │                                      │
       ▼                                      ▼
  Agent fixes work                    Agent updates LESSONS.md
       │                              (auto-extracted from rejection)
       ▼
  Reviewer approves → Agent updates PATTERNS.md
                      (what worked this time)
```

### Auto-Learning Implementation
```
When task status changes to needs_revision:
  1. Extract rejection reasons from reviewer comments
  2. Append to assignee's MISTAKES.md with task context
  3. Generate lesson from pattern (if 2+ similar rejections)
  4. Append to assignee's LESSONS.md

When task status changes to done:
  1. If task had revisions, note what fixed it in PATTERNS.md
  2. Update collective conventions.md if new pattern emerged

Every agent heartbeat:
  1. Read LESSONS.md before starting work (top 10 most recent)
  2. Apply relevant lessons as pre-checks before submitting
```

---

## 5. Improvement 4: Automated Artifact Validation

### Problem
Currently only Ronin (QA) catches issues. No automated gates. Bad JSON, broken builds, duplicate content can all pass through.

### Solution: Validation Pipeline (Pre-Review Gates)

```
┌───────────────────────────────────────────────────────────────────┐
│              AUTOMATED VALIDATION PIPELINE                         │
│                                                                    │
│  Agent completes work → BEFORE moving to "review":                │
│                                                                    │
│  GATE 1: SCHEMA VALIDATION                                        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ • JSON files: validate against project schema                 │ │
│  │ • Code files: lint + type check                               │ │
│  │ • Content files: structure validation                         │ │
│  │ → FAIL = auto-reject back to agent with specific errors       │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  GATE 2: BUILD VERIFICATION                                       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ • Run project build (nuxt build, npm test, etc.)              │ │
│  │ • Check for new warnings/errors vs baseline                   │ │
│  │ → FAIL = auto-reject with build output                        │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  GATE 3: DUPLICATION CHECK                                        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ • Semantic similarity against existing content                │ │
│  │ • Exact match detection for copy-paste                        │ │
│  │ • Cross-file duplicate detection                              │ │
│  │ → WARN = flag for reviewer, don't auto-reject                 │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  GATE 4: REGRESSION CHECK                                         │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ • Compare key metrics before/after (page count, route count)  │ │
│  │ • Check no existing content was accidentally deleted          │ │
│  │ • Verify file sizes are reasonable                            │ │
│  │ → FAIL = block and alert Lead                                 │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ALL GATES PASS → Move to "review" for human/agent review         │
│  ANY GATE FAILS → Auto-reject with diagnostic report              │
└───────────────────────────────────────────────────────────────────┘
```

### Configurable Per-Project
```yaml
# In squad.yaml
validation:
  gates:
    - name: schema
      enabled: true
      schemas:
        "content/vocab/*.json": "schemas/vocab-question.schema.json"
        "content/tests/*.json": "schemas/test-paper.schema.json"
      
    - name: build
      enabled: true
      command: "npx nuxt build 2>&1"
      fail_on: "error"
      warn_on: "warning"
      
    - name: duplication
      enabled: true
      similarity_threshold: 0.85
      scope: ["content/"]
      
    - name: regression
      enabled: true
      checks:
        - "find content/ -name '*.json' | wc -l"  # file count shouldn't decrease
        - "npx nuxt build --analyze | grep routes"  # route count check
```

---

## 6. Improvement 5: Human-in-the-Loop UX

### Problem
Currently the human watches a Slack feed. No structured way to approve, reject, redirect, or prioritize. The dashboard is read-only.

### Solution: Interactive Command Interface

```
┌───────────────────────────────────────────────────────────────┐
│            HUMAN INTERACTION LAYER                              │
│                                                                 │
│  OPTION A: SLACK COMMANDS (MVP)                                │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ @bot approve task-042                                      │ │
│  │ @bot reject task-042 "Fix the N5 duplication issue"        │ │
│  │ @bot priority task-042 critical                            │ │
│  │ @bot reassign task-042 to hashi                            │ │
│  │ @bot pause sensei                                          │ │
│  │ @bot status                                                │ │
│  │ @bot create-task "Add dark mode" assign=hashi priority=med │ │
│  │ @bot budget set daily=30                                   │ │
│  │ @bot focus "Phase 2 only, skip Phase 3 for now"            │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  OPTION B: INTERACTIVE DASHBOARD (Scale)                       │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ • Drag-and-drop task kanban                                │ │
│  │ • One-click approve/reject with comment field              │ │
│  │ • Agent chat sidebar (talk directly to any agent)          │ │
│  │ • Priority slider (drag tasks up/down)                     │ │
│  │ • Budget controls (sliders for daily limits)               │ │
│  │ • Goal editor (update PROJECT.md from UI)                  │ │
│  │ • Deliverable preview (render content/code inline)         │ │
│  │ • Review queue (notification badge, approval workflow)     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  OPTION C: APPROVAL GATES (Critical Tasks)                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ For tasks marked requires_approval: true                   │ │
│  │                                                            │ │
│  │ 1. Agent completes work                                    │ │
│  │ 2. Auto-validation passes                                  │ │
│  │ 3. QA agent approves                                       │ │
│  │ 4. → BLOCKED: Waiting for human approval                   │ │
│  │ 5. Human gets Slack notification with diff/preview         │ │
│  │ 6. Human clicks ✅ Approve or ❌ Reject                    │ │
│  │ 7. → Proceeds to deploy/publish                            │ │
│  │                                                            │ │
│  │ Use for: deployments, public content, infrastructure       │ │
│  │ Skip for: internal content, minor fixes, reviews           │ │
│  └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

---

## 7. Improvement 6: Observability & Metrics

### Problem
Current dashboard shows status and tasks but no analytics. Can't answer: "Which agent is most productive?" "What's the average review cycle time?" "Where are the bottlenecks?"

### Solution: Metrics Engine

```
┌───────────────────────────────────────────────────────────────┐
│                  OBSERVABILITY LAYER                            │
│                                                                 │
│  AGENT METRICS (per agent, per project):                       │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ • tasks_completed_total      (counter)                     │ │
│  │ • tasks_rejected_total       (counter)                     │ │
│  │ • first_pass_approval_rate   (ratio) ← quality signal      │ │
│  │ • avg_task_duration_seconds  (gauge) ← speed signal        │ │
│  │ • tokens_used_total          (counter) ← cost signal       │ │
│  │ • tokens_per_task_avg        (gauge) ← efficiency signal   │ │
│  │ • cost_per_deliverable       (gauge) ← ROI signal          │ │
│  │ • revisions_per_task_avg     (gauge) ← quality signal      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  PROJECT METRICS:                                               │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ • goal_completion_percent    — PROJECT.md checkboxes       │ │
│  │ • phase_velocity             — tasks/day per phase         │ │
│  │ • review_queue_depth         — bottleneck indicator        │ │
│  │ • avg_cycle_time             — task created → done         │ │
│  │ • blocker_resolution_time    — how fast P0s get fixed      │ │
│  │ • Total tokens            — running total               │ │
│  │ • Tokens_per_goal              — ROI per goal                │ │
│  │ • content_output_rate        — deliverables     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  SYSTEM HEALTH:                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ • agent_uptime               — heartbeat hit rate          │ │
│  │ • event_bus_latency          — time from publish to wake   │ │
│  │ • task_board_write_conflicts — coordination health         │ │
│  │ • api_error_rate             — LLM provider issues         │ │
│  │ • memory_usage_per_agent     — context window utilization  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  DASHBOARD PANELS:                                              │
│  ┌─────────────┬─────────────┬─────────────┬───────────────┐   │
│  │ Throughput   │ Quality     │ Cost        │ Bottlenecks   │   │
│  │ ▁▃▅▇█▇▅▃▁   │ 87% pass   │ $23.50/day  │ QA queue: 3   │   │
│  │ 12 tasks/day │ ↑ from 72% │ ↓ from $35  │ Dev idle: 2h  │   │
│  └─────────────┴─────────────┴─────────────┴───────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

---

## 8. Improvement 7: Smart Orchestration (Beyond Simple Assignment)

### Problem
Current Lead creates tasks and assigns by domain. No intelligence in HOW tasks are decomposed, sequenced, or load-balanced.

### Solution: Intelligent Task Decomposition & Scheduling

```
┌──────────────────────────────────────────────────────────────┐
│              SMART ORCHESTRATOR                                │
│                                                                │
│  CAPABILITY 1: AUTO-DECOMPOSITION                             │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Goal: "Add user authentication system"                    │ │
│  │                                                           │ │
│  │ Orchestrator auto-decomposes into:                        │ │
│  │ ├── task-A: Design auth flow (Designer, 1h)               │ │
│  │ ├── task-B: Backend auth API (Developer, 3h)              │ │
│  │ │   ├── subtask: JWT token service                        │ │
│  │ │   ├── subtask: User model + migration                   │ │
│  │ │   └── subtask: Login/register endpoints                 │ │
│  │ ├── task-C: Frontend auth pages (Developer, 2h)           │ │
│  │ │   dependsOn: [task-A]                                   │ │
│  │ ├── task-D: Auth integration tests (QA, 1h)               │ │
│  │ │   dependsOn: [task-B, task-C]                           │ │
│  │ └── task-E: Security audit (Security, 1h)                 │ │
│  │     dependsOn: [task-D]                                   │ │
│  │                                                           │ │
│  │ Decomposition informed by:                                │ │
│  │ • Role templates (what each role can do)                  │ │
│  │ • Project tech stack (from PROJECT.md)                    │ │
│  │ • Past similar tasks (from platform memory)               │ │
│  │ • Existing codebase analysis                              │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  CAPABILITY 2: WORKLOAD BALANCING                             │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Before assigning, check:                                  │ │
│  │ • Agent current queue depth                               │ │
│  │ • Agent's avg task completion time                        │ │
│  │ • Agent's current cost vs budget                          │ │
│  │ • Agent's first-pass approval rate (quality)              │ │
│  │                                                           │ │
│  │ If multiple agents share a role:                          │ │
│  │ → Assign to agent with best (quality × speed / cost)      │ │
│  │                                                           │ │
│  │ If agent is overloaded:                                   │ │
│  │ → Spawn temporary sub-agent for overflow                  │ │
│  │ → Or queue with estimated start time                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  CAPABILITY 3: PREDICTIVE SCHEDULING                          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Based on historical data:                                 │ │
│  │                                                           │ │
│  │ "Phase 2 has 12 remaining tasks.                          │ │
│  │  At current velocity (4 tasks/day), ETA: 3 days.          │ │
│  │  QA is bottleneck (review queue avg: 2.5 tasks).          │ │
│  │  Recommendation: Add second QA reviewer or reduce         │ │
│  │  review scope for low-risk content tasks."                │ │
│  │                                                           │ │
│  │ Surfaces in:                                              │ │
│  │ • Daily standup report → Slack                            │ │
│  │ • Dashboard "Forecast" panel                              │ │
│  │ • Lead's planning context                                 │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 10. Improvement 9: Multi-Model Intelligence

### Problem
Current: all agents use opus ($15/MTok output). That's massive overkill for simple tasks like schema validation or formatting checks.

### Solution: Dynamic Model Routing

```
┌──────────────────────────────────────────────────────────────┐
│               DYNAMIC MODEL ROUTER                            │
│                                                                │
│  ROUTING RULES:                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  TASK COMPLEXITY → MODEL SELECTION                       │ │
│  │                                                          │ │
│  │  Strategic planning, complex reasoning    → Opus ($$$)   │ │
│  │  • Goal decomposition by Lead                            │ │
│  │  • Architecture decisions                                │ │
│  │  • Novel content generation                              │ │
│  │                                                          │ │
│  │  Standard work, coding, content           → Sonnet ($$)  │ │
│  │  • Feature implementation                                │ │
│  │  • Content generation (with sources)                     │ │
│  │  • Code review                                           │ │
│  │  • SEO analysis                                          │ │
│  │                                                          │ │
│  │  Simple, repetitive, validation           → Haiku ($)    │ │
│  │  • Schema validation                                     │ │
│  │  • Format checking                                       │ │
│  │  • Simple data transformation                            │ │
│  │  • Status report compilation                             │ │
│  │                                                          │ │
│  │  FALLBACK LOGIC:                                         │ │
│  │  If Sonnet fails quality gate → retry with Opus          │ │
│  │  If Haiku fails → escalate to Sonnet                     │ │
│  │  Track per-model success rates → auto-adjust thresholds  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  COST IMPACT:                                                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Current (all Opus):     $25/day                          │ │
│  │ Optimized (mixed):      $8-12/day  (50-68% savings)      │ │
│  │                                                          │ │
│  │ Breakdown:                                               │ │
│  │ • Lead: Opus for planning, Sonnet for status reports     │ │
│  │ • Content: Sonnet for generation, Haiku for validation   │ │
│  │ • Dev: Sonnet for coding, Haiku for linting              │ │
│  │ • QA: Sonnet for review, Haiku for schema checks         │ │
│  │ • SEO: Sonnet for analysis, Haiku for data extraction    │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 11. Improvement 10: Resilience & Fault Tolerance

### Problem
- Squad Lead crashes → entire system stalls
- JSON write conflict → data corruption
- LLM API rate limit → agent hangs
- Disk full → silent failures

### Solution: Resilience Patterns

```
┌──────────────────────────────────────────────────────────────┐
│               RESILIENCE LAYER                                │
│                                                                │
│  1. LEADER ELECTION (no single point of failure)              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Primary Lead: main agent                                  │ │
│  │ Fallback: If Lead misses 3 heartbeats, QA agent assumes  │ │
│  │           limited orchestration (assign from backlog)     │ │
│  │ Recovery: When Lead comes back, it reclaims control       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  2. ATOMIC TASK BOARD WRITES                                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Every task-board.json has a version number.               │ │
│  │ Write flow:                                               │ │
│  │   1. Read task-board.json → get version N                 │ │
│  │   2. Make changes in memory                               │ │
│  │   3. Write to task-board.json with version N+1            │ │
│  │   4. If file version != N → CONFLICT → re-read & merge   │ │
│  │                                                           │ │
│  │ OR: migrate to SQLite for proper ACID transactions        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  3. RETRY & CIRCUIT BREAKER                                   │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ LLM API call failed?                                      │ │
│  │   → Retry 3x with exponential backoff                     │ │
│  │   → If still failing: circuit breaker opens               │ │
│  │   → Try fallback model (opus → sonnet → haiku)            │ │
│  │   → If all fail: mark task as "blocked_by_system"         │ │
│  │   → Alert human on Slack                                  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  4. CHECKPOINT & RECOVERY                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Every task status change → snapshot task-board.json       │ │
│  │ Keep last 50 snapshots (rolling)                          │ │
│  │ On corruption: auto-restore from last valid snapshot      │ │
│  │ Git commit deliverables after each completed task         │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  5. GRACEFUL DEGRADATION                                      │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Cost limit hit    → Pause workers, keep Lead alive        │ │
│  │ Disk > 90%        → Stop content generation, alert human  │ │
│  │ API rate limited   → Reduce heartbeat frequency 2x        │ │
│  │ Agent stuck > 1hr → Kill session, reassign task           │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 12. Improvement 11: Security & Tenant Isolation

```
┌──────────────────────────────────────────────────────────────┐
│               SECURITY LAYER                                  │
│                                                                │
│  1. AGENT SANDBOXING                                          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Each agent runs in a restricted context:                  │ │
│  │ • Can ONLY read/write its own workspace + shared dirs     │ │
│  │ • Cannot access other projects' files                     │ │
│  │ • Cannot access platform config or secrets                │ │
│  │ • Web access limited to approved_sources list             │ │
│  │ • Shell commands limited to allowlist                     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  2. SECRET MANAGEMENT                                         │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ • Secrets stored in vault (not in PROJECT.md)             │ │
│  │ • Agents access secrets via environment variables         │ │
│  │ • Secrets never written to task board or activity log     │ │
│  │ • Rotation support (vault auto-rotates API keys)          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  3. AUDIT TRAIL                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Every action logged with:                                 │ │
│  │ • Who (agent ID)                                          │ │
│  │ • What (action type + details)                            │ │
│  │ • When (timestamp)                                        │ │
│  │ • Result (success/failure + output hash)                  │ │
│  │ Immutable log (append-only, checksummed)                  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  4. RBAC (Role-Based Access Control)                          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Human roles:                                              │ │
│  │ • Owner: full control, billing, delete project            │ │
│  │ • Admin: configure agents, approve deploys                │ │
│  │ • Viewer: read-only dashboard access                      │ │
│  │                                                           │ │
│  │ Agent roles:                                              │ │
│  │ • Lead: create tasks, message human, read all agents      │ │
│  │ • Worker: own tasks only, shared filesystem               │ │
│  │ • Reviewer: read all deliverables, approve/reject         │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 13. Improvement 12: Self-Serve Onboarding UX

### Problem
Current setup requires editing YAML and markdown files. Non-technical customers can't use it.

### Solution: Guided Project Setup Wizard

```
┌──────────────────────────────────────────────────────────────┐
│           SELF-SERVE ONBOARDING WIZARD                        │
│                                                                │
│  STEP 1: "What are you building?"                             │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  ○ Website / Web App                                      │ │
│  │  ○ Content / Blog / Documentation                         │ │
│  │  ○ E-commerce Store                                       │ │
│  │  ○ Research Project                                       │ │
│  │  ○ Marketing Campaign                                     │ │
│  │  ○ Custom (describe it)                                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  STEP 2: "What are your goals?" (free text → parsed)          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  "I need to build a Japanese learning platform with        │ │
│  │   5000 practice questions across 5 JLPT levels,           │ │
│  │   SEO-optimized, with a Nuxt 3 frontend"                  │ │
│  │                                                           │ │
│  │  AI parses into structured goals:                         │ │
│  │  ✓ Phase 1: Generate 5000 practice questions              │ │
│  │  ✓ Phase 2: SEO optimization                              │ │
│  │  ✓ Phase 3: Frontend polish                               │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  STEP 3: "Here's your recommended squad"                      │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Based on your goals, we recommend:                       │ │
│  │                                                           │ │
│  │  🎯 Squad Lead (Orchestrator)       — included always     │ │
│  │  📝 Content Creator                 — for 5000 questions  │ │
│  │  🔧 Developer                       — for Nuxt 3 work    │ │
│  │  ⚔️ QA Reviewer                     — quality assurance   │ │
│  │  📊 SEO Analyst                     — for SEO goals       │ │
│  │                                                           │ │
│  │  Estimated cost: ~$15-25/day                              │ │
│  │  Estimated timeline: 2-3 weeks to Phase 2 complete        │ │
│  │                                                           │ │
│  │  [Customize Squad]  [Looks Good →]                        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  STEP 4: "Connect your tools"                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  ☐ GitHub repo: [________________________]               │ │
│  │  ☐ Slack channel: [_____________________]                │ │
│  │  ☐ Domain knowledge (upload files or URLs)               │ │
│  │  ☐ Budget limit: [$___/day]                              │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  STEP 5: "Your squad is live! 🚀"                             │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Dashboard: https://app.platform.com/projects/gyanmirai  │ │
│  │  Slack: Connected to #gyanmirai-squad                     │ │
│  │  First tasks created automatically ✓                      │ │
│  │                                                           │ │
│  │  Your Lead agent will message you on Slack shortly.       │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 14. Priority-Ordered Implementation Plan

| Priority | Improvement | Effort | Impact | Do When |
|---|---|---|---|---|
| 🔴 P0 | Atomic task board writes (SQLite) | 2 days | Prevents data corruption | NOW |
| 🔴 P0 | Event-driven agent wake | 3 days | 10x faster task pickup | NOW |
| 🔴 P0 | Multi-model routing (opus/sonnet/haiku) | 1 day | 50-68% cost reduction | NOW |
| 🟡 P1 | Automated validation gates | 3 days | Fewer bad reviews, faster cycle | Week 2 |
| 🟡 P1 | Agent learning (LESSONS.md) | 2 days | Reduces repeat mistakes | Week 2 |
| 🟡 P1 | Metrics engine + dashboard panels | 4 days | Visibility into ROI | Week 3 |
| 🟡 P1 | Human command interface (Slack) | 3 days | Better human control | Week 3 |
| 🟠 P2 | DAG-based workflow engine | 5 days | Complex task support | Week 4-5 |
| 🟠 P2 | Plugin system (GitHub, Vercel) | 5 days | Integration ecosystem | Week 5-6 |
| 🟠 P2 | Smart orchestration (decomposition) | 4 days | Better task quality | Week 6-7 |
| 🟢 P3 | Resilience (circuit breaker, recovery) | 4 days | Production reliability | Week 8 |
| 🟢 P3 | Security & RBAC | 3 days | Multi-tenant readiness | Week 8-9 |
| 🟢 P3 | Self-serve onboarding wizard | 5 days | Customer acquisition | Week 10-12 |
| 🟢 P3 | Cross-project platform memory | 3 days | Platform gets smarter | Week 12+ |

---

## 15. The Vision: What This Becomes

```
TODAY (v1):
  "Here's a markdown file and a YAML. Agents run on your server."
  → Developer tool. Manual setup. Single project.

NEXT (v2):
  "Paste your GitHub repo. We auto-deploy a squad."
  → Semi-automated. Event-driven. Multi-project. Dashboard.

FUTURE (v3):
  "Describe what you're building. We handle everything."
  → Self-serve SaaS. AI-generated squad config.
  → Marketplace of domain plugins.
  → Cross-project learning makes every new project better.
  → Human approves deliverables, not tasks.

ENDGAME:
  "You have an idea. We have a team."
  → From natural language description to working product.
  → Agent squads as a service.
  → Pay per deliverable, not per token.
```

---

*This document identifies 12 concrete improvements across reliability, intelligence, UX, and scalability — with a prioritized implementation plan.*
