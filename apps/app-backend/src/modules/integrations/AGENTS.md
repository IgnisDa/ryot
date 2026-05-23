# Integrations Module

This module owns integration CRUD, sink webhook ingress, yank admission, and integration run orchestration.

- Sink ingress never parses the webhook body. The contract declares one text payload per accepted content type, the route forwards `{ rawBody, contentType }` unchanged, and `IntegrationRunJobData.webhook` carries that envelope to the sandbox script. Provider-specific parsing, including Plex multipart boundaries, belongs to the integration script.
- Add a content type to `integrationWebhookContentTypes` before a provider that posts it can reach a sink; anything else is rejected with `415` before the module is entered. Contract clients encode webhook bodies as the first entry, so `application/json` stays first.
- Never forward request headers other than `content-type` into the workflow payload.
- `handleWebhook` creates one run per delivery, so sink runs are not idle-gated; only yank admission is exclusive.
