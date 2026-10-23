# Mutation admission and workflow ownership

`MutationReceipts` owns persistence and account-generation admission. It does not import concrete workflows or the workflow engine.

`workflow-dispatch.ts` binds ownership to actual workflow definitions:

- `dispatchAdmittedWorkflow` accepts the workflow, an account generation (including explicit `null` for system work), and execution options. It derives a missing execution ID once, admits ownership, then calls the existing engine with that same ID.
- Its admission and execution transformations keep boundary error mapping, dispatch recovery, and interruption masks separate. Execution recovery cannot consume admission failures.
- `admitWorkflow` records ownership at replay-body and preparation boundaries. These checks remain necessary after reset, retirement, or account recreation, even if dispatch previously registered the same owner.

Boot assembles `AdmittedWorkflowCatalogueLive` from defining workflow modules and freezes its array. User retirement receives the catalogue through `AdmittedWorkflowCatalogue`; it interrupts each retained owner before deleting receipts and fails closed when an owner is absent. There is no mutable registration catalogue or separate ownership table.
