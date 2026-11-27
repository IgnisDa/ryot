# Website

Route modules connect React Router to the website’s account, billing, contact, and marketing features.
Paddle and Polar webhook adapters verify the request and translate it into a billing event.
The billing service owns fulfillment, renewal, and revocation. The website calls the instance
admin API through `@ryot-app/instance-contract`.

Billing events are keyed by provider and event ID. A PostgreSQL advisory lock serializes processing
per customer. The website checkpoints provisioned resources and enrollment email progress so a
provider retry can resume after a failure. Pending email data is encrypted with a key derived from
`SERVER_ADMIN_ACCESS_TOKEN` and cleared after delivery. Changing that token invalidates active website
sessions and prevents decryption of pending billing emails.

## Tests

Run the website checks and tests from the repository root. The e2e task builds the production website
and uses the shared PostgreSQL test container. Install Playwright Chromium in the website workspace
before running browser tests. The tests use a local SMTP inbox and fake provider endpoints.

```sh
bun turbo --filter=@ryot-app/website check
bun turbo --filter=@ryot-app/website test test:e2e
bun turbo --filter=@ryot-app/e2e test -- src/api/website/cloud-purchase.test.ts
```
