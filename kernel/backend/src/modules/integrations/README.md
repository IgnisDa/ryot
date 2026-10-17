# Integrations

This module owns integration CRUD, sink webhook ingress, yank admission, and integration run
orchestration. Plugin sinks create one run per delivery; kernel Data webhooks reuse a run by
submission key. Only yank admission is idle-gated.

## Sync Worklist

Sync first commits yank admission, then journals a database-clock cutoff. It pages the persisted
blocked, pending, and cancelling integration runs through that cutoff in creation-time then ID order.
New yank runs and recovery runs share this worklist; unreleasable owners do not stop cursor progress.
Release retains expiry, cancellation, account-generation, readiness, and pinned-input checks. Child
workflows retain each run's original execution ID.

Admission itself still reads the enabled yank integrations as one collection. The worklist does not
make that read bounded. Deliveries created after the cutoff wait for a later sync.

## Webhook Admission

The contract accepts one text payload per declared content type. Plugin sink ingress captures
`{ rawBody, contentType }` unchanged through the imports owner before acknowledging delivery.
Workflow jobs carry identifiers and execution loads the durable envelope. Provider-specific parsing,
including multipart boundaries, belongs to the integration script. The kernel Data webhook instead
validates its generic document through import admission.

`integrationWebhookContentTypes` declares accepted types; other types receive `415` before entering
the module. Contract clients encode through its first entry, so `application/json` remains first.
Execution receives no request headers except `content-type`; Data admission consumes
`idempotency-key` without forwarding it.

Plugin admission failures log the integration ID and, for database failures, SQLSTATE and constraint
name. Request bodies, webhook tokens, and database error messages are not logged.
