# Testing Infrastructure

`@ryot-app/testing/postgres-container` owns the shared PostgreSQL test container. Its
`startPostgresContainerEffect` and `stopPostgresContainerEffect` operations wrap Testcontainers
and Node log-stream completion once, with typed `PostgresContainerError` failures. The existing
Promise-returning `startPostgresContainer` and `stopPostgresContainer` exports serve the E2E
fixture; `postgresGlobalSetup` returns a Promise to Vitest's global-setup interface. An explicit
`TEST_DATABASE_URL` uses the supplied database without starting a container.
