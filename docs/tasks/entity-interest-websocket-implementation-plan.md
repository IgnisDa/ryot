# Entity Interest WebSocket Implementation Plan

## Objective

Replace the entity-interest SSE stream and full-set declaration POST with one authenticated WebSocket session that supports batched incremental interest changes.

The new design must:

- Handle entity detail pages, partial recommendation results, pagination, and other sources that add IDs in several waves.
- Send only changed IDs during a connected session.
- Restore the complete selected interest set after reconnecting.
- Keep population and translation demand-driven and keep entity reads side-effect-free.
- Preserve Redis-backed multi-instance delivery without sticky routing.
- Work on web and Expo native without putting a session cookie or another long-lived credential in a WebSocket URL.
- Use the direct Effect `HttpRouter` server path so Bun's native WebSocket upgrade remains available.
- Remove the old SSE and declaration POST implementation completely. Do not retain compatibility endpoints, adapters, aliases, feature flags, or dual transport.

This is a greenfield breaking change. No production migration or backward compatibility is required.

## Locked Decisions

No product or architecture decisions remain open for this implementation.

### Effect version and integration

Implement against the repository's pinned versions:

- `effect@4.0.0-beta.107`
- `@effect/platform-bun@4.0.0-beta.107`

The matching Effect source was inspected at tag `effect@4.0.0-beta.107`, commit `3c495ae7c96d43bfc3b8020250562a194c2c895e`.

Use:

- `HttpRouter.serve` as the top-level HTTP server layer.
- `HttpServerRequest.upgrade` for the backend WebSocket upgrade.
- `effect/unstable/socket/Socket` for scoped socket reading and writing.
- `Socket.makeWebSocket`, `runString`, and `writer` through an app-client transport owned under `src/api`.

Do not use `HttpRouter.toWebHandler` or `HttpEffect.fromWebHandler` for normal API or WebSocket routes. Keep `HttpEffect.fromWebHandler` only around Better Auth's Web handler because Better Auth does not need request upgrade support.

### External endpoints

The only entity-interest HTTP endpoint will be:

```text
POST /api/entity-interest/socket-ticket
```

It is part of `AppContract`, protected by the existing `AuthMiddleware`, and returns:

```ts
{
	ticket: string;
	expiresAt: string;
}
```

The WebSocket endpoint will be a raw `HttpRouter` route:

```text
GET /api/entity-interest/ws
```

Delete these endpoints without redirects or replacements at their old paths:

```text
GET /api/entity-interest/stream
POST /api/entity-interest
```

The ticket endpoint remains in OpenAPI. The WebSocket route does not pretend to be a typed `HttpApiEndpoint`; shared Effect Schemas and module documentation are the protocol authority. Do not add an AsyncAPI toolchain in this change.

### Authentication

Use a short-lived, opaque, single-use ticket:

1. The authenticated client requests a ticket over normal HTTP.
2. The backend generates exactly 32 cryptographically secure random bytes and encodes them as unpadded base64url.
3. The backend stores only a SHA-256 hash of the ticket in Redis.
4. The Redis value contains the user ID and preferred language needed by the interest session.
5. The ticket expires after 30 seconds, and `expiresAt` is the corresponding ISO 8601 UTC timestamp.
6. The client opens `/api/entity-interest/ws` without credentials in its URL.
7. The first WebSocket application message carries the ticket.
8. The backend atomically consumes the ticket with `GETDEL` semantics.
9. Missing, expired, reused, or invalid tickets all produce the same policy failure and close code. Do not reveal which condition failed.

Do not put the ticket in the URL, cookie, log annotation, close reason, error detail, atom key, or reactivity key. Redact protocol decode errors before logging if they can contain the authentication frame.

An unauthenticated socket has five seconds to send a valid authentication frame. Before authentication it cannot issue interest commands, open Redis stream state, or register a local connection callback.

### Session identity

The backend generates a random `sessionId` after ticket authentication. It replaces the current client-generated `streamId` as the Redis and local-routing identity.

The server includes `sessionId` in the `ready` message. Production clients treat it as opaque. End-to-end test support uses it to register a session without reconciliation when testing externally triggered population.

No production endpoint accepts a client-supplied session ID.

### Interest limit and priority

Keep `MAX_INTEREST_ENTITY_IDS = 500` until load evidence supports changing it.

Never silently truncate a server command.

The client selects at most 500 IDs before sending. Interest registrations have one owner-level priority:

```ts
type EntityInterestPriority = "foreground" | "visible" | "prefetch";
```

Priority order is:

1. `foreground`: the primary entity or equivalent essential detail content.
2. `visible`: loaded content currently presented to the user, including saved-view rows.
3. `prefetch`: off-screen recommendations and speculative content.

Within a priority, select unique entity IDs in ascending lexical order. If the same ID appears under several owners, use its highest priority. This makes selection deterministic across renders and reconnects.

When the union exceeds 500, the client sends the selected 500, logs the omitted count and counts by priority without logging IDs, and keeps omitted IDs locally so they can enter the selected set when higher-priority interest leaves. The server independently rejects any command whose resulting membership exceeds 500.

The existing saved-view consumer uses `visible`. Future entity detail primary data uses `foreground`; recommendation sections use `visible` only while displayed and `prefetch` otherwise.

### Client batching and removal grace

- Batch desired-set additions and changes for 100 milliseconds.
- Delay removals for two seconds.
- Cancel a delayed removal if the ID becomes selected again.
- Keep exactly one unacknowledged interest command per socket.
- While a command is unacknowledged, coalesce all local changes into the next command.
- After `ready`, always send one complete `replace` snapshot before sending incremental updates.
- After reconnect, discard the prior socket's applied state and revision, then send a new complete snapshot.

These timings belong in named constants and use Effect durations where the surrounding code uses Effect scheduling. Do not make them configurable until a concrete need exists.

### Revisions and acknowledgements

Each socket session starts with server revision `0`.

- The first interest command must be `replace` with revision `1`.
- Every later `replace` or `update` revision must equal the current revision plus one.
- `applied` means Redis membership and reverse indexes are durable for that revision.
- `applied` does not mean population or translation has completed.
- The server sends `applied` immediately after the atomic Redis command succeeds and before beginning reconciliation for newly pending IDs.
- A command rejected for validation, ordering, or limit reasons does not advance the revision.
- A revision mismatch is a protocol error. Close the socket and let the client reconnect with a new ticket and snapshot; do not implement in-session revision repair.

The client uses the revision as the command correlation identifier. Do not add a second request ID.

### Protocol

Use JSON text frames only. Define all client and server message schemas, decoders, encoders, and derived types in `packages/contract/src/modules/entity-interest/messages.ts`. Do not handwrite mirror interfaces in consumers.

Client messages:

```ts
type EntityInterestClientMessage =
	| {
			type: "authenticate";
			ticket: string;
	  }
	| {
			type: "replace";
			revision: number;
			entityIds: string[];
	  }
	| {
			type: "update";
			revision: number;
			add: string[];
			remove: string[];
	  }
	| {
			type: "pong";
			nonce: string;
	  };
```

Server messages:

```ts
type EntityInterestServerMessage =
	| {
			type: "ready";
			sessionId: string;
			maxEntityIds: number;
			heartbeatIntervalMs: number;
	  }
	| {
			type: "applied";
			revision: number;
	  }
	| {
			type: "entity-updated";
			entityId: string;
			reason: "populated" | "translated";
	  }
	| {
			type: "ping";
			nonce: string;
	  }
	| {
			type: "rejected";
			revision: number;
			code: "interest-limit-exceeded";
			maxEntityIds: number;
	  };
```

Protocol rules:

- `authenticate` is valid only as the first message.
- `replace` and `update` are valid only after `ready`.
- `replace` deduplicates its IDs.
- `update` deduplicates each side and rejects an ID present in both `add` and `remove`.
- Empty `add` and `remove` arrays are invalid; the client must avoid no-op commands.
- Replacing with an empty set and removing the last selected ID are valid.
- Binary frames, unknown message tags, malformed JSON, schema failures, invalid ordering, and revision mismatches close with protocol error `1002`.
- Authentication failure or authentication timeout closes with policy violation `1008` and a generic reason.
- Internal failures close with `1011` after logging sanitized context.
- Normal scoped disposal closes with `1000`.
- Heartbeat timeout closes with application code `4000`.
- An over-limit command sends `rejected` and leaves the session and revision active. The production client treats this as an invariant failure, reports it, and reconnects only after recomputing a valid selected set.

The old `ConnectedFrame`, `DeclareInterestBody`, `DeclareInterestResponse`, SSE frame encoders, and terminal POST result path must be deleted.

Keep the Redis Pub/Sub `EntityUpdatedMessage` schema and encoder/decoder because workflow publishers and subscribers still use it. Derive the WebSocket `entity-updated` message from the same entity ID and reason schemas.

### Heartbeat and lifecycle

Use application messages because Effect beta.107 does not expose generic WebSocket ping/pong control frames.

- Send `ping` every 25 seconds after authentication.
- Generate an unpredictable nonce for each ping.
- Require the matching `pong` within 10 seconds.
- Ignore no stale or mismatched pong; treat repeated invalid pong messages as protocol failures.
- Keep the existing Redis stream TTL at 15 minutes and renewal interval at five minutes.
- Renewal refreshes stream metadata, membership TTL, and reverse-index expiry scores.
- A missing stream during renewal terminates the socket and reconnects from the client.

The client uses the existing centralized app/network revalidation signal when it needs to restart connection work. Do not add feature-owned `AppState` or network listeners.

### Inbound and outbound serialization

Do not execute interest commands concurrently from `socket.runString` callbacks.

Use a bounded inbound command queue with one sequential processor. The expected client behavior permits only one unacknowledged command, so a capacity of 16 is sufficient. Overflow is a protocol failure.

Use one outbound writer fiber. All `ready`, `applied`, `entity-updated`, `ping`, `rejected`, and close decisions pass through the same session-owned output abstraction so frames are not written concurrently.

Completion signals are refresh hints, not authoritative data. Coalesce pending `entity-updated` messages by entity ID before writing when the writer is busy. `translated` supersedes `populated` for the same pending entity. Bound the pending completion map by the 500-ID membership limit.

### Reconciliation concurrency

Membership command processing and reconciliation are separate:

1. The command processor atomically applies membership and revision.
2. It enqueues `applied`.
3. It submits returned pending membership tokens to one session reconciliation worker.
4. The worker reconciles sequential chunks of `MAX_ROOT_PAGE_SIZE`.
5. The command processor remains available while reconciliation runs.

The reconciliation worker deduplicates work by entity ID plus pending token. It retries failures with exponential backoff from one second to 30 seconds while the session remains active. Socket closure interrupts retries; reconnect snapshot returns all still-pending memberships and resumes work.

Terminal reconciliation results are sent only if the exact pending membership token is still current. They use the same `entity-updated` WebSocket message as asynchronous Pub/Sub completions. There is no separate terminal response or client deduplication path.

### Redis membership state

Retain these concepts:

- Session metadata hash.
- Per-session entity membership hash.
- Per-entity reverse sorted set scored by session expiry.
- Per-entity progression lease.

Rename code and documentation from stream identity to session identity where it no longer describes an HTTP stream. Replace the old Redis keys with exactly these forms and do not read or clean old key forms:

```text
ryot:entity-interest:ticket:<sha256-ticket>
ryot:entity-interest:session:<sessionId>
ryot:entity-interest:session:<sessionId>:entities
ryot:entity-interest:entity:<entityId>:sessions
ryot:entity-interest:progress:<entityId>
```

Session metadata contains:

```text
userId
preferredLanguage
revision
```

Membership values must distinguish an entity's pending incarnation:

```text
watching
pending:<revision>
```

This prevents an old reconciliation from marking a removed and later re-added entity as watching.

The atomic replace/update script must:

- Verify that the session exists.
- Verify that the incoming revision is current revision plus one.
- Deduplicate inputs defensively.
- Calculate the final membership count before mutating state.
- Reject a final count over 500 without partial mutation.
- Remove dropped memberships and reverse-index entries.
- Preserve retained membership values.
- Add new IDs as `pending:<incomingRevision>`.
- Refresh reverse-index scores for added and retained IDs.
- Update the session revision and TTLs.
- Return every current pending entity with its pending revision, not only newly added IDs, so prior failed reconciliation is retried.

The mark-reconciled script changes `pending:<revision>` to `watching` only when the supplied entity ID and pending revision still match. It does not require the session's global revision to remain unchanged.

Update `markPending` so progression failure changes a currently interested membership to `pending:<current-session-revision>`. It must read the corresponding session metadata and must not recreate removed membership.

Keep cleanup idempotent. Normal close removes local routing first, then Redis memberships and metadata. Process crashes continue to rely on TTLs and reverse-index pruning.

### Multi-instance delivery

Preserve the current Redis Pub/Sub design:

- Every backend process receives entity completion publications.
- Each process resolves interested session IDs from Redis.
- Each process sends only through locally owned socket sessions.
- No sticky routing is required.
- Pub/Sub remains live and non-durable.
- Reconnect snapshot and reconciliation provide catch-up from durable entity state.

Rename `LocalStreamConnections` to `LocalInterestSessions`. Its stored callback must be transport-neutral and session-owned. The subscriber should enqueue an `entity-updated` message into the session output mailbox instead of writing a socket directly.

## Existing Code Context

### Client

`apps/app-client/src/modules/entity-interest/provider.tsx` currently creates one SSE stream per API scope, creates a client `streamId`, waits for `connected`, and delegates declarations to the coordinator.

`apps/app-client/src/modules/entity-interest/coordinator.ts` currently tracks owner sets, computes their union, sends single-flight full replacements by POST, retries declaration failures, and routes completion frames to interested owners.

`apps/app-client/src/modules/entity-interest/sse.ts` is a custom SSE parser and must be deleted.

`apps/app-client/src/modules/entity-interest/use-entity-updates.ts` and `update-batcher.ts` own completion-to-refetch batching. Preserve that behavior while updating message types and interest priority input.

The only current production consumer is `apps/app-client/src/modules/saved-views/use-saved-view.tsx`. It registers loaded page IDs and should use `visible` priority.

### Backend

`apps/app-backend/src/app/server.ts` currently converts the API router to a Web handler, strips `/api`, converts the Bun request into a Web `Request`, then converts it back. That loses Bun's upgrade implementation. Replace this composition rather than routing the socket around it.

`apps/app-backend/src/modules/entity-interest/stream.ts` owns SSE heartbeats, stream lifecycle, and cleanup. Delete the file after moving transport-independent lifecycle behavior into the socket session.

`store.ts`, `service.ts`, `reconciler.ts`, `subscriber.ts`, and `progression.ts` contain the durable membership, reconciliation, fan-out, and translation progression behavior. Refactor these for sessions, revisions, and pending tokens; do not rewrite unrelated entity lifecycle behavior.

### Tests

`tests/src/fixtures/interest-sse.ts` implements the current SSE and declaration fixture. Replace it with a WebSocket fixture and remove the old file and export name.

The admin-only `testSupport.setEntityInterest` operation intentionally registers interest without reconciliation so media-monitoring tests can observe externally triggered population. Keep this test capability, update it to the new session store/service, and use the `sessionId` received in `ready`. It is not a production compatibility endpoint.

## Implementation Steps

### 1. Replace shared schemas and HTTP contract

Update `packages/contract/src/modules/entity-interest/messages.ts`:

- Preserve `EntityUpdatedReason`, Redis Pub/Sub `EntityUpdatedMessage`, and its codec.
- Add schema-backed socket client and server message unions.
- Add synchronous JSON text decoders/encoders suitable for socket callbacks.
- Add the ticket response schema.
- Preserve `MAX_INTEREST_ENTITY_IDS` as the shared bound.
- Delete all SSE and declaration POST types and encoders.

Update `packages/contract/src/modules/entity-interest/contract.ts`:

- Remove `stream` and `declareInterest`.
- Add authenticated `createSocketTicket` at `/entity-interest/socket-ticket`.
- Return the ticket response schema.
- Keep typed authentication and expected HTTP errors.

Add focused contract tests for message decoding, malformed messages, finite positive revisions, duplicate-side validation that belongs in schemas, and ticket response encoding. Do not test Effect Schema itself.

### 2. Add ticket storage and service

Add a ticket service under the backend entity-interest module or a narrowly named store owned by it.

- Add the Redis ticket key builder.
- Generate opaque random tickets.
- Hash before storage and lookup.
- Store user ID and preferred language with a 30-second TTL.
- Atomically consume once.
- Return one generic typed authentication failure for missing, expired, reused, and malformed tickets.
- Ensure logs and error rendering never include the ticket.

Add unit tests for creation, expiry, one-time consumption, concurrent consumption, malformed Redis values, and redaction.

### 3. Convert the backend to direct `HttpRouter.serve`

Refactor `apps/app-backend/src/app/server.ts`:

- Remove API `toWebHandler`, its manual disposal, `ApiContext`, and the normal API `fromWebHandler` conversion.
- Build the existing `HttpApiBuilder.layer`, Scalar route, decode-error middleware, and raw socket route into an inner API router.
- Convert that inner router to an HTTP effect with `HttpRouter.toHttpEffect` and mount it under a root router's `/api` prefix. Prefix mounting must preserve the native `HttpServerRequest` and strip `/api` for existing contract paths.
- Keep Better Auth under `/api/auth/*` through its Web handler.
- Rewrite `/_i/*` by providing a modified native request to the inner API effect rather than round-tripping the normal API through Web requests.
- Serve static client assets from the root fallback.
- Replace manual `BunHttpServer.make` plus `HttpServer.serveEffect` with `HttpRouter.serve` provided by an effectfully constructed `BunHttpServer.layer` using `AppConfig`.
- Set Bun WebSocket limits explicitly: one MiB maximum payload and a 60-second idle timeout.
- Preserve current logging, decode-error mapping, static fallback, webhook behavior, docs location, and server address logging.

Add server routing tests that cover a normal API endpoint, `/api/docs`, Better Auth routing, webhook rewriting, static fallback, and a successful real Bun WebSocket upgrade. A Fetch-compatible handler test is not sufficient for the socket route.

### 4. Replace Redis stream generation with session revisions

Refactor `apps/app-backend/src/modules/entity-interest/store.ts` and its tests:

- Rename public stream methods and types to session terminology.
- Store `revision` instead of `generation`.
- Implement atomic replace and incremental update commands.
- Implement pending revision tokens.
- Make mark-reconciled token-specific rather than globally generation-specific.
- Update mark-pending, renewal, close, metadata lookup, and reverse-index cleanup.
- Reject bounds instead of truncating.
- Return typed command outcomes for applied, revision mismatch, missing session, and limit exceeded.
- Preserve user visibility by passing the authenticated user to reconciliation, not by trusting message data.

Cover replace, add, remove, retained watching state, remove/re-add races, duplicate IDs, overlap rejection, empty final sets, revision mismatch, over-limit atomicity, renewal, cleanup, stale reverse entries, and concurrent command behavior.

Delete generation-specific tests and assertions rather than retaining alternate behavior.

### 5. Refactor reconciliation service

Refactor `apps/app-backend/src/modules/entity-interest/service.ts`:

- Delete `declareInterest` and its `DeclareInterestBody` dependency.
- Keep a transport-neutral reconcile operation over pending entity/token pairs.
- Continue chunking RyotQL work by `MAX_ROOT_PAGE_SIZE`.
- Keep visibility filtering, populate-before-translate ordering, deterministic workflow IDs, and terminal reason mapping.
- Mark reconciled memberships only when pending tokens still match.
- Check current exact membership before emitting terminal updates.
- Return terminal messages to the socket session output path.

Retain an internal test-support operation that applies membership without reconciliation. Rename it to `setEntityInterestMembership` at `/test-support/entity-interest-membership`, and update the test-support contract, service, tests, and `AGENTS.md`. Do not expose it outside the existing admin test-support group.

### 6. Add the socket session

Create backend files with focused responsibilities:

- `socket-route.ts`: raw GET registration and request upgrade.
- `socket-session.ts`: authentication deadline, session acquisition/release, queues, heartbeat, renewal, command processor, and reconciliation worker.

Shared wire codecs remain in `@ryot/contract`; do not add backend-local mirror schemas.

The session acquisition order is:

1. Upgrade the native Bun request.
2. Wait up to five seconds for one authentication message.
3. Consume the ticket.
4. Generate the session ID.
5. Open Redis session metadata.
6. Register the local output callback.
7. Start writer, command, reconciliation, heartbeat, and renewal fibers in the socket scope.
8. Send `ready`.

If acquisition fails after Redis open, cleanup must still remove any local callback and Redis state.

The finalizer order is:

1. Stop accepting and writing messages.
2. Remove the local session callback.
3. Close Redis session membership and reverse indexes.
4. Log cleanup failures without hiding the original socket exit.

Use scoped Effect resources and fibers. Do not use detached promises or unmanaged timers.

### 7. Make local delivery transport-neutral

Refactor `connections.ts`, `connections.test.ts`, and `subscriber.ts`:

- Rename `LocalStreamConnections` to `LocalInterestSessions`.
- Store a callback that enqueues an entity update into the session mailbox.
- Preserve claim-once and remove-only-if-same-callback semantics.
- Preserve no-op delivery when a session is not local.
- Keep one duplicated Redis subscriber per backend process.
- Keep progression dispatch after `populated` publication.

Update layer wiring and all tests/imports. Do not leave type aliases with old names.

### 8. Add app-client WebSocket transport

Keep transport construction under `apps/app-client/src/api`.

- Add a WebSocket URL resolver that converts normalized `http`/`https` server origins to `ws`/`wss` and appends `/api/entity-interest/ws` without credentials.
- Add an Effect socket constructor using `Socket.makeWebSocket` and `Socket.layerWebSocketConstructorGlobal` or the matching beta.107 API.
- Keep ticket acquisition through `appClient(scope).request` and the generated HTTP contract client.
- Do not create a feature-owned authenticated HTTP client.
- Verify the global WebSocket constructor on web, iOS, and Android builds or tests available in the repository.

Add unit tests for URL normalization, secure protocol conversion, path handling, and absence of credentials in the URL.

### 9. Replace the client provider and coordinator

Rewrite `provider.tsx` and `coordinator.ts` around socket sessions:

- One coordinator and one socket per authenticated API scope.
- Acquire a ticket for every connection attempt.
- Open the socket and send `authenticate` as the first frame.
- Wait for `ready` before sending interest.
- Decode every server frame with shared schemas.
- Respond to `ping` immediately through the serialized writer.
- Route `entity-updated` only to currently interested local owners.
- Track desired selected IDs, acknowledged applied IDs, next revision, and one active command.
- Send a complete revision-1 snapshot on every new socket.
- Send incremental add/remove commands afterward.
- Apply the 100 ms batching window and two-second removal grace.
- Coalesce changes while awaiting `applied`.
- Retry connection and ticket acquisition with exponential backoff from one second to 30 seconds.
- Reset the backoff after a stable authenticated connection.
- On scope change or provider disposal, interrupt the socket scope and clear all state.
- Use the shared app revalidation signal for foreground/network recovery rather than adding listeners.

Change the registration API to require priority. Update `useEntityInterest`, `useEntityUpdates`, all callers, tests, and README examples in one change. Do not retain an overload with an implicit priority.

Preserve `update-batcher.ts` behavior for consumer refetches unless message type imports require mechanical updates.

Delete `sse.ts` and `sse.test.ts`.

### 10. Replace end-to-end fixtures and behavior tests

Delete `tests/src/fixtures/interest-sse.ts`. Add `tests/src/fixtures/interest-websocket.ts` with no compatibility exports.

The fixture must:

- Request a ticket with the authenticated contract client.
- Open a real WebSocket to the backend.
- Authenticate with the first frame.
- Wait for and expose `ready.sessionId` for admin test support.
- Send revisioned replace/update commands.
- Wait for matching `applied` revisions.
- Buffer validated `entity-updated` messages.
- Respond to server heartbeats.
- Expose scoped close and completion-wait helpers.
- Fail tests on malformed server messages, unexpected close, rejected commands, or acknowledgement timeout.

Rename all fixture imports and helper names. Update:

- `tests/src/fixtures/index.ts`
- `tests/src/fixtures/media-monitoring.ts`
- `tests/src/tests/kernel/entity-interest/authz.test.ts`
- `tests/src/tests/kernel/entity-interest/population-dispatch.test.ts`
- `tests/src/tests/kernel/entity-translation/entity-translation.test.ts`
- `tests/src/tests/plugins/media/smoke/providers-live-smoke.test.ts`
- Any other reference found by repository-wide search.

Replace POST-terminal assertions with waits for `entity-updated` after `applied`.

Required end-to-end coverage:

- Unauthenticated ticket request is rejected.
- Missing, expired, malformed, and reused tickets close identically.
- Authentication must be the first frame and must arrive before timeout.
- Ticket binds the socket to the ticket's user and preferred language.
- Initial snapshot triggers population and terminal catch-up.
- Incremental add triggers work without replacing retained IDs.
- Incremental remove stops delivery.
- Remove and re-add does not let stale reconciliation mark the new membership.
- Reconnect snapshot catches up after a missed live publication.
- Private entities remain invisible and do not produce updates.
- Over-limit commands are rejected atomically.
- Revision mismatch closes and reconnect restores state.
- Heartbeat timeout closes abandoned sockets.
- Normal close removes membership.
- Process-level delivery still reaches only the locally owned socket in focused backend tests.
- Partial recommendation-style waves coalesce into bounded incremental commands in client coordinator tests.

### 11. Remove obsolete code and documentation

Delete, do not deprecate:

- `apps/app-backend/src/modules/entity-interest/stream.ts`
- `apps/app-backend/src/modules/entity-interest/stream.test.ts`
- `apps/app-client/src/modules/entity-interest/sse.ts`
- `apps/app-client/src/modules/entity-interest/sse.test.ts`
- `tests/src/fixtures/interest-sse.ts`
- Old `stream` and `declareInterest` contract endpoints.
- Old declaration payload/response and connected/SSE frame schemas.
- Old coordinator POST declaration code and retry naming.
- Old generation-only Redis behavior.
- Old aliases such as `streamId`, `InterestStream`, `openInterestStream`, `LocalStreamConnections`, and `declareInterest` where they refer to the removed transport.

Rewrite current documentation rather than appending contradictory notes:

- `apps/app-backend/src/modules/entity-interest/README.md`
- `apps/app-client/src/modules/entity-interest/README.md`
- `apps/app-backend/src/modules/entity-interest/AGENTS.md`
- `tests/README.md`
- `docs/decisions.md`, especially Decision 3 and references from Decision 4
- Any comments or runbooks found by repository-wide search

Decision 3 must describe the WebSocket, ticket authentication, incremental revisions, Redis sessions, direct Effect router, and why the earlier POST/SSE design was replaced. Remove the section arguing against WebSocket and all descriptions of duplicate POST/SSE terminal delivery.

Do not preserve historical implementation prose inside active documentation. Git history is the history.

At completion, repository-wide searches for these obsolete production terms must return no entity-interest transport references:

```text
interest-sse
InterestSseParser
text/event-stream
/entity-interest/stream
declareInterest
DeclareInterestBody
DeclareInterestResponse
ConnectedFrame
buildInterestStreamResponse
LocalStreamConnections
```

Generic uses of `stream`, `SSE`, or `declareInterest` outside entity interest are not part of this cleanup.

### 12. Final cleanup pass

Load and follow the `codebase-cleanup` skill after implementation and tests pass.

- Remove dead imports, schemas, Redis scripts, test utilities, constants, and comments.
- Remove compatibility branches and transitional naming.
- Confirm no duplicate socket codecs exist outside `@ryot/contract`.
- Confirm feature modules use the shared API transport rather than constructing parallel clients.
- Confirm all timers, queues, socket fibers, and Redis sessions are scoped and finalized.
- Confirm no ticket or entity ID list is logged.
- Confirm documentation matches final code names and timing constants.

## Suggested Implementation Order

Use this order to keep intermediate changes understandable. A single final commit is not required, but no intermediate compatibility layer should survive.

1. Shared protocol schemas and ticket HTTP contract.
2. Ticket Redis service and tests.
3. Direct `HttpRouter.serve` backend conversion and real upgrade test.
4. Session Redis scripts and store tests.
5. Reconciliation service token semantics.
6. Socket route/session, local delivery, heartbeat, and backend tests.
7. App-client socket transport.
8. Coordinator/provider rewrite and client tests.
9. End-to-end fixture and test migration.
10. Delete old files and rewrite documentation.
11. Repository-wide cleanup and complete verification.

Do not implement a temporary dual mode. If an intermediate step needs the old code to keep compiling locally, remove it before completing the same implementation task.

## Verification

Run focused tests while changing each package, then run all required package checks.

Minimum commands:

```sh
bun turbo --filter=@ryot/contract test
bun turbo --filter=@ryot/contract check
bun turbo --filter=@ryot/app-client test
bun turbo --filter=@ryot/app-client check
bun turbo --filter=@ryot/app-backend test
bun turbo --filter=@ryot/app-backend check
bun turbo --filter=@ryot/tests check
bun turbo --filter=@ryot/tests test
```

The backend check and test commands are mandatory under repository guidance:

```sh
bun turbo --filter=@ryot/app-backend check
bun turbo --filter=@ryot/app-backend test
```

Also build the app client for web to catch WebSocket global and bundling problems:

```sh
bun turbo --filter=@ryot/app-client build
```

If the full live integration suite requires infrastructure unavailable in the implementation environment, run all available focused entity-interest suites and state exactly which live command was not run and why.

## Completion Criteria

The work is complete only when all of these are true:

- Ryot's top-level backend uses direct `HttpRouter.serve` and a successful test proves Bun request upgrade works.
- The only production entity-interest HTTP endpoint creates a single-use socket ticket.
- One WebSocket carries authentication, initial snapshot, incremental updates, acknowledgements, heartbeats, and entity completion signals.
- Normal connected updates send deltas rather than full interest sets.
- Reconnect always sends one complete snapshot.
- Redis membership uses revisions and pending incarnation tokens.
- Reconciliation does not block command acknowledgement or allow stale remove/re-add work to win.
- The 500-ID limit is deterministic on the client and atomic on the server, with no silent server truncation.
- Web and Expo clients do not need custom WebSocket authentication headers.
- Multi-instance Redis Pub/Sub routing and progression behavior remain covered.
- The admin test-support path still supports monitoring tests without triggering demand reconciliation.
- All SSE parser, stream response, declaration POST, duplicate terminal response, and compatibility code is deleted.
- All affected unit, backend, client, contract, and end-to-end tests pass.
- Active documentation contains only the WebSocket design.
- Repository-wide obsolete-term searches are clean.

## Out of Scope

- Changing the entity-interest cap based on unmeasured load.
- Adding durable replay of Pub/Sub completion messages.
- Adding sticky-session routing.
- Adding an AsyncAPI generator or documentation UI.
- Adding binary WebSocket frames or compression-specific protocol behavior.
- Building the future entity detail and recommendation UI itself.
- Generalizing the socket into an application-wide realtime gateway before another concrete realtime feature exists.
