# Media Plugin

- Read `README.md` before changing operation contracts, monitoring, or lifecycle behavior.
- Keep operation input/output schemas in `operations/schemas.ts`, outside sandbox modules. Workflow consumers import `Schema` from `@ryot/sandbox-sdk/workflow`.
- Media signal definitions own notification message vocabulary and select `automation.media-notification`; do not move either into kernel.
- Keep `shared/title-parsing.ts` and `shared/title-matching.ts` within sandbox compiler ES2022 support; do not use `toReversed`.
- Contract or lifecycle changes must update `README.md`, manifest bindings, scripts, and focused tests together.
