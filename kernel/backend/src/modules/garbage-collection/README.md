# Garbage collection

The module owns script artifact and workflow garbage collectors. Domain repositories retain ownership of their tables and deletion rules.

Uninstalled plugin installations use the automation retry window in elapsed 24-hour days, independent of the database session timezone. Live workflow references and retained automation artifacts still prevent removal.

The workflow engine records execution membership and terminal results in `workflow_execution` and durable progress in `workflow_step`. Child admission, step writes and expiry lock the root execution row. Active executions, unfinished descendants, and unfired durable clocks prevent collection of the entire tree.

The frequent cron collects successful trees 24 hours after their last execution completes. Trees containing any failed execution remain for 168 elapsed hours after their last completion. Each batch expires at most 100 trees and clears at most 1,000 executions by deleting their steps and stored payloads and results. Expiry fences the whole tree before deletion; interrupted cleanup resumes from the persisted pending records.

Cleared executions retain compact tombstones. Expired execution IDs cannot be submitted again, new descendants cannot join an expired tree, and late step writes cannot recreate its storage. An intentional rerun uses a new execution ID.
