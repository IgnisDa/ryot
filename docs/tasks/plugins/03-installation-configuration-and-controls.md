# Installation Configuration And Controls

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Complete user management of an existing installation as specified by the parent plan's Configuration and HTTP Contract sections. Users must be able to patch private plugin config, explicitly remove values, disable or enable installations, and change ordering without resubmitting source. Responses must expose non-secret values and configured-secret indicators while never returning secret values.

Keep user-controlled disablement separate from service-controlled lifecycle health. A disabled installation must disappear from runtime operations, providers, imports, integrations, automations, and private cron discovery while its qualified definitions remain available to decode historical data. Re-enabling requires ready health and a complete valid config.

Configuration patches merge persisted values, replacements, explicit unset keys, and schema defaults before validating the complete result. Omitted keys preserve stored values. System installation config remains immutable and environment-backed.

## Acceptance criteria

- [ ] The authenticated installation patch contract supports config replacements, explicit unset keys, disabled state, and sort order with strict decoding.
- [ ] Omitted config keys preserve existing values, including secrets, while explicit unset keys remove values before complete schema validation.
- [ ] Required values and schema rules are validated with the canonical property-schema runtime for install and patch paths.
- [ ] List and patch responses omit every schema-marked secret value and report whether each secret key is configured.
- [ ] A user cannot patch another user's installation or use a slug from another user's registry to infer its existence.
- [ ] System installations reject user config changes while still allowing supported disabled-state and order changes.
- [ ] Disabled installations are unavailable to every new runtime dispatch surface but retain definitions needed to read existing qualified data.
- [ ] Enabling is rejected when lifecycle health is not ready or configuration is incomplete.
- [ ] Configuration lookup rejects authority mismatches, undeclared script keys, and keys absent from the current manifest.
- [ ] Contract, config resolver, installation service, registry, and runtime tests cover secrets, defaults, explicit unsets, disablement, and cross-user isolation.

## User stories addressed

- User story 9
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 17

## Implementor Notes

Do not introduce plugin-specific encryption. Preserve the parent plan's database trust assumption while ensuring secrets never cross the read API boundary.
