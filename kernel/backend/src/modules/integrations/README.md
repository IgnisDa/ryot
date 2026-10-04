# Integrations

This module owns integration CRUD, sink webhook ingress, yank admission, and integration run
orchestration. Plugin sinks create one run per delivery; kernel Data webhooks reuse a run by
submission key. Only yank admission is idle-gated.

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
