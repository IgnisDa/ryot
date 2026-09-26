# Integrations Module

This module owns integration CRUD, sink webhook ingress, yank admission, and integration run orchestration.

- Plugin sink ingress never parses the webhook body. The contract declares one text payload per accepted content type, the route forwards `{ rawBody, contentType }` unchanged, and `IntegrationRunJobData.webhook` carries that envelope to the sandbox script. Provider-specific parsing, including Plex multipart boundaries, belongs to the integration script. The kernel-owned Data webhook validates its generic document through import admission.
- Add a content type to `integrationWebhookContentTypes` before a provider that posts it can reach a sink; anything else is rejected with `415` before the module is entered. Contract clients encode webhook bodies as the first entry, so `application/json` stays first.
- Never forward request headers other than `content-type` into the workflow payload. Data webhook admission consumes `idempotency-key` without forwarding it to execution.
- Plugin sinks create one run per delivery; Data webhooks reuse a run by submission key. Only yank admission is idle-gated.
