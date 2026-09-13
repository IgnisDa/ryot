# Garbage collection

The module owns script artifact and Effect workflow garbage collectors. Domain repositories retain ownership of their tables and deletion rules.

Workflow message storage records execution membership and terminal replies in `workflow_execution`, in the same PostgreSQL transaction as the corresponding Effect mailbox write. Admission and expiry lock the root execution row. Suspended executions, unfinished descendants, and unprocessed workflow messages prevent collection of the entire tree.

The frequent cron collects successful trees 24 hours after their last execution completes. Trees containing any failed execution remain for seven days after their last completion. Each batch expires at most 100 trees and clears at most 1,000 executions through Effect's `MessageStorage.clearAddress`, including their durable clocks. Expiry fences the whole tree before deletion; interrupted cleanup resumes from the persisted pending records.

Cleared executions retain compact tombstones. Expired execution IDs cannot be submitted again, new descendants cannot join an expired tree, and late replies cannot recreate its storage. An intentional rerun uses a new execution ID.
