# Provider entity population

Provider details are fetched before database work. Population then commits the root entity, each
related-entity group, each child-entity set, and the final population timestamp in separate short
transactions. Lifecycle dispatch and Redis publication happen after those transactions commit.

## Mutation lock order

Concurrent populations can contain the same related entities and relationships. Every population
transaction must acquire locks in this order before it mutates rows:

1. Provider entity identities, sorted by scope, user, entity schema, provider, and external ID.
2. Relationship identities, sorted by scope, user, relationship schema provenance, source entity,
   and target entity.
3. Entity rows followed by relationship rows in the same identity order.

The repositories implement the first two steps with transaction-scoped PostgreSQL advisory locks.
The lock keys use JSON arrays so field boundaries are unambiguous. Callers acquire all known locks
before the first write; they must not lock one entity and then discover another mutation target.

The locks are granular. Unrelated entity graphs continue concurrently, while transactions touching
the same provider entity or relationship serialize their conflicting mutations.

## Deadlock retry

PostgreSQL can still select a transaction as a deadlock victim when a new mutation path violates the
protocol. Population and relationship service transactions retry SQLSTATE `40P01` at most twice
after the initial attempt. The retry wraps the complete `database.transaction` effect, so rollback
finishes before a fresh transaction starts. SQL errors remain `DbError` values until retry is
complete and are converted to the durable `SandboxRunError` contract only afterward.

Do not retry individual statements and do not move sandbox, workflow, lifecycle, Redis, network, or
sleeping work into these transactions.
