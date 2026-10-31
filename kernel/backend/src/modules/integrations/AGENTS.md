# Integrations

- Capture plugin webhook bodies as durable `{ rawBody, contentType }` envelopes before acknowledgement. Scripts parse them; workflows carry identifiers, not bodies.
- Forward only `content-type` to execution. Data admission consumes `idempotency-key` without forwarding it.
- Declare accepted types in `integrationWebhookContentTypes`; keep `application/json` first because contract clients encode through the first entry.
