# Collaboration & Workflow Guide

This guide explains how we can collaborate on Project Undercroft: Workbench, how work items are tracked, and what to expect from each development cycle.

## Roles & Responsibilities

- **You (project owner)**
  - Define priorities and approve roadmap updates.
  - Review pull requests that summarize the changes I make.
  - Provide feedback, new requirements, or clarifications.
- **Me (AI collaborator)**
  - Help refine requirements into actionable tasks.
  - Implement code and documentation changes in small, reviewable chunks.
  - Run tests or manual checks when applicable and report the results.
  - Prepare a pull request summary after each committed change set.

## Tracking Work

1. **Roadmap as the source of truth** – The `workbench/ROADMAP.md` document captures high-level epics and near-term tasks. We can expand it with status markers (`✅`, `🚧`, `📝`) or link out to deeper specifications as work progresses.
2. **Task breakdown** – When you request new work, we can reference the roadmap section and agree on a concrete deliverable (e.g., “Tailwind base layout setup”). I will restate the scope before coding to ensure alignment.
3. **Iteration cadence** – Each interaction should produce either:
   - A documented plan/spec update, or
   - A committed code/documentation change accompanied by tests/checks when feasible.

## Development Workflow

1. **Plan** – We discuss the desired change. If it’s sizeable, I draft a plan or checklist and you confirm before implementation.
2. **Implement** – I modify the necessary files, respecting any coding guidelines. For significant UI updates, I’ll capture screenshots when tools are available.
3. **Test & Report** – I run relevant commands (unit tests, linters, manual scripts) and note the results in the final summary.
4. **Commit & PR** – I commit the changes directly in this environment and generate a PR summary using the `make_pr` tool so you have a concise record.
5. **Review & Iterate** – You review the summary and diff, provide feedback, and I follow up with additional commits or revisions as needed.

## Task Ownership

- I manage the in-session implementation details and keep the roadmap updated with progress notes when tasks change state.
- You maintain the overall backlog/prioritization. If you track items elsewhere (issues, personal notes), feel free to share; I can mirror them into the roadmap for continuity.

## Getting Started

1. Identify the first roadmap task you want tackled (e.g., server generalization, Tailwind integration).
2. Share any constraints or success criteria.
3. I’ll confirm the task breakdown and begin the workflow above.

By following this loop, we maintain transparency on what’s being built, how it’s validated, and what’s next on deck.
