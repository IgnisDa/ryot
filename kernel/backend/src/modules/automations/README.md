# Automations

Automation triggers are immutable records of accepted commands and committed changes. Request triggers retain normalized command drafts; change triggers retain exact before/after snapshots; signal triggers retain the emitted payload and recipients; provider-import completion triggers retain provider identity. A caller-supplied command identity produces deterministic trigger and run identities, so replay reuses matching records and rejects conflicting payloads.

## Planning And Execution

Owning services append trigger planning inside the same transaction as the source write. Planning resolves stable manifest hooks and persists pinned runs before commit; sandbox work starts only after commit. Before-policy hooks run in deterministic order before the source write, cannot perform mutations, and may accept, reject, or transform the command draft. Accepted writes create a separate change trigger linked to the request trigger. After hooks run independently, so one failure does not roll back committed source data or prevent sibling hooks.

Each run pins the exact sandbox script, plugin revision, and plugin configuration revision accepted during planning. Kernel runs pin a source-zero script and use null plugin/configuration revisions. The workflow claims numbered attempts, prepares the retained trigger payload, executes the exact pin, and records bounded logs, errors, timing, and output. Plugin upgrades, disablement, and uninstall affect future planning but do not change accepted runs during their retry window.

`LifecyclePlanner.plan` runs on the caller's active transaction and returns the persisted trigger, ordered pinned runs, and policy declarations from their pinned revisions. Callers resolve signal audiences and supply recipients; the planner deduplicates the actor. A caller inspects `result.trigger.blockedReason`: a blocked request must reject the write, while blocked post-write planning produces a warning only when `hasRequiredHooks` is true. Callers execute the returned policies sequentially after the transaction commits and submit after-hook runs only after the source commit.

Batch owners pass identities already processed for the current entity as `excludedOncePerSubjectPolicies`, keyed by the run's stable `pluginId`/`hookSlug` and the batch's deterministic subject key. Before-event `once-per-subject` hooks are excluded before budget counting and insertion, and the normalized input is persisted on the trigger, so a replay must supply the same normalized exclusions even for a zero-run plan.

Planning takes a catalog lock and a root advisory lock and holds both through recipient and run writes, so `wasCreated` describes the whole plan rather than one row. The trigger repository is immutable: planning persists its final decision once, before any recipients or runs, in the same transaction.

Retry policy belongs to the pinned after hook. Only classified infrastructure failures retry automatically, and external HTTP hooks require explicit run-ID idempotency. The frequent reconciler claims due queued runs; manual retry revalidates ownership, attempt count, retention, and artifacts before queueing another attempt. Before-policy failures never retry. User history exposes bounded, redacted trigger/run/attempt detail without script source, encrypted configuration, or cross-user payloads.

## Causation And Limits

Every trigger carries an initiator, source, execution ID, root execution ID, depth, optional parent trigger, and optional parent run. Automation host mutations derive this context from the trusted run; plugin input cannot choose its parents. Command request and committed change triggers retain their direct link, while both remain attributed to the parent run. The root budget blocks descendants beyond the configured depth or run count and records omitted hooks without executing them.

Notification subscriptions remain user configuration. A signal trigger snapshots its recipient set, then creates at most one run for each matching user/hook pair. Provider-import completion uses the same trigger, run, attempt, causation, retry, and history model as entity, event, relationship, and signal operations.

Current-state queries cannot replace retained trigger payloads. Later updates, deletion, or plugin changes must not alter accepted execution input. Artifact retention keeps executable/configuration pins through the retry window; later pruning removes sensitive attempt detail and executable material while compact attribution remains available for the history period.
