# Trail orchestration

Use this guide with `Agents.md`, the authoritative requirements in `PRD.md`, the target design in `Architecture.md`, and the ordered work in `Tasks.md`. `PRD.md` wins when documents conflict. Every work item must cite its `Tasks.md` item and applicable PRD IDs, remain within v1 scope, and satisfy the phase exit criteria before the phase is complete.

## Roles

- `swe-worker`: general backend, contracts, domain, data, and cross-cutting implementation.
- `mobile-specialist`: Expo, iOS/Android, local persistence, recording, sync, permissions, and platform behavior.
- `design-specialist`: visual specification, interaction, responsive behavior, and accessibility implementation.
- `infrastructure-specialist`: CI/CD, environments, deployment, providers, data-service operations, observability, and recovery.
- `security-specialist`: authentication, authorization, privacy, secrets, storage boundaries, redaction, and deletion.
- `testing-specialist`: test design and automation, failure-mode coverage, device scripts, and release evidence.
- `code-reviewer`: independent correctness, maintainability, requirements, and regression review.

A phase lead coordinates and integrates; it does not absorb work owned by a specialist. Support roles are engaged only for the relevant slice. Reviewer roles must be independent of the implementation they review.

## Phase ownership

| Phase                                                | Lead                        | Support                                                                                                            | Reviewers                              |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 0 — Decisions and project foundation                 | `infrastructure-specialist` | `swe-worker`, `security-specialist`, `testing-specialist`                                                          | `code-reviewer`, `security-specialist` |
| 1 — Contracts, domain, and data                      | `swe-worker`                | `infrastructure-specialist`, `security-specialist`, `testing-specialist`                                           | `code-reviewer`, `security-specialist` |
| 2 — Authentication, profile, and app shell           | `swe-worker`                | `mobile-specialist`, `security-specialist`, `design-specialist`, `testing-specialist`                              | `code-reviewer`, `security-specialist` |
| 3 — Reliable GPS recording                           | `mobile-specialist`         | `swe-worker`, `design-specialist`, `testing-specialist`, `security-specialist`                                     | `code-reviewer`, `testing-specialist`  |
| 4 — Activity synchronization and review              | `swe-worker`                | `mobile-specialist`, `design-specialist`, `testing-specialist`, `security-specialist`                              | `code-reviewer`, `security-specialist` |
| 5 — Photos                                           | `swe-worker`                | `mobile-specialist`, `infrastructure-specialist`, `design-specialist`, `security-specialist`, `testing-specialist` | `code-reviewer`, `security-specialist` |
| 6 — Routes                                           | `mobile-specialist`         | `swe-worker`, `design-specialist`, `infrastructure-specialist`, `testing-specialist`                               | `code-reviewer`, `security-specialist` |
| 7 — Training stats and calendar                      | `swe-worker`                | `mobile-specialist`, `design-specialist`, `testing-specialist`                                                     | `code-reviewer`, `testing-specialist`  |
| 8 — Privacy, accessibility, reliability, and release | `testing-specialist`        | `security-specialist`, `infrastructure-specialist`, `mobile-specialist`, `design-specialist`, `swe-worker`         | `code-reviewer`, `security-specialist` |

When one role appears as both support and reviewer, use different agent runs and require the reviewer run to inspect rather than defend the implementation. Security-sensitive changes always receive security review even when the table does not repeat it; visual or interaction changes receive design review, and platform release claims receive testing review.

## Delivery loop

For each small, dependency-complete slice, run this loop:

1. **Plan** — The phase lead reads the governing documents, names the task and PRD IDs, defines acceptance criteria, affected boundaries, assigned files, verification commands, reviewer, dependencies, and rollback concerns. Resolve specification conflicts before editing.
2. **Isolated implementation** — Assign one implementer per file set in an isolated branch/worktree or a strictly disjoint working set. The implementer makes the smallest coherent change and reports files, tests, and risks. Parallel work is allowed only when dependencies and file ownership are independent.
3. **Review** — The assigned independent reviewer inspects the complete diff and affected callers, contracts, migrations, and tests. Findings must cite files and lines and separate blockers from optional suggestions.
4. **Repair** — Return blocking findings to the original implementer unless reassignment is explicit. Keep repairs within the planned slice; repeat review until no blocking findings remain.
5. **Verify** — The testing specialist or phase lead runs the narrowest relevant checks followed by applicable format, lint, type-check, tests, builds, migrations, smoke tests, and device scripts. Record exact commands and results; never convert missing external evidence into a pass.
6. **Commit** — After review and verification pass, the phase lead confirms the diff is scoped and commits the slice with a focused imperative message. Include task/PRD references and retain the evidence, risks, migrations, provider dependencies, and platform notes needed for the pull request.

Do not concurrently edit overlapping files, generated outputs, shared lockfiles, migrations, contracts, or configuration with more than one agent. If planned work overlaps, serialize it behind a single owner, integrate and verify the first change, then rebase or refresh the next assignment. Stop parallel work immediately when unplanned overlap or a shared dependency is discovered.

## External stop conditions

Stop the affected slice and escalate to the parent or product owner when any of the following prevents safe, truthful completion:

- A PRD conflict, missing acceptance criterion, or unresolved product/policy decision would require inventing behavior or expanding v1 scope.
- Required provider selection, commercial license, region, quota, retention policy, legal/privacy URL, final product identity, bundle/package ID, or account-linking policy is unresolved.
- Required credentials, signing keys, store accounts, external service access, production-like environment, or permission to perform a destructive operation is unavailable.
- A third-party service, provider sandbox, CI system, or package registry is unavailable and prevents meaningful verification.
- Real iOS/Android hardware, OS permission behavior, locked-screen duration, battery measurement, store review evidence, or another external release gate is required. Simulator or mocked evidence must not be substituted.
- A migration, deletion, auth/token change, storage cleanup, or deployment lacks an approved rollback/recovery path or risks production/user data.
- A security or privacy finding could expose credentials, tokens, signed URLs, GPS tracks, photos, cross-owner data, or misleading collection/retention claims.
- Required checks fail for reasons outside the assigned slice, or the repository lacks the promised command or dependency and changing it would exceed scope.

A stopped report must name the blocker, affected task and PRD IDs, evidence gathered, work that remains safe, and the exact owner decision, access, service, or device evidence needed to resume. Do not commit partial work that weakens controls or falsely appears verified.
