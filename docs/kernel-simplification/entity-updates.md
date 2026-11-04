# Entity updates

Status: accepted by the owner.

Recommendation: decide provider fetches on the server by staleness, coalesce them per entity, and push
completions to the client over one Server-Sent Events stream fed by PostgreSQL `LISTEN/NOTIFY`. This
replaces the entity-interest WebSocket (1,792 lines plus about 2,800 lines of tests, built on Redis and
account generations) and avoids V1's refresh storms without polling.

## What caused V1's storms

The storms came from what triggered provider work, not from how the client learned the result:

- [#1362](https://github.com/IgnisDA/ryot/issues/1362) made media refresh when it became visible on screen.
- [#1795](https://github.com/IgnisDA/ryot/issues/1795) reports the result: every library page refreshes
  every item on it, old movies and books included, and providers throttle. It asks for per-type staleness
  limits and per-provider request limits.
- Client polling multiplied the reads on top of that.

The current V2 socket keeps the visibility trigger and adds a protocol around it: per-session membership
sets with revisions, foreground and visible priorities, tickets, heartbeats and Redis reverse indexes. That
bounds the rate, but the trigger is the same as in V1.

## Design

1. **Staleness decides provider work.** Each entity schema declares a refresh interval in its manifest, for
   example a show weekly and a movie every six months, and an admin can override it per schema. An entity
   is fetched only when it has no data yet, or when it is older than its interval.
2. **The client asks once per page, and the server coalesces.** Entity reads return
   `populationStatus` as today. When a page renders entities that are missing data or stale, the client
   sends one `POST /api/entities/populate` with their IDs and a priority: `interactive` for a detail page
   and `background` for a list. The server upserts one job per entity on a coalescing key, so 50 viewers
   of one show cost one job. The requesting user IDs are appended to the job. Reads stay free of side
   effects.
3. **Provider limits bound the rest.** The job worker takes the provider host's rate-limit row before
   each request, as in the inventory's admission entry. A cold library page queues work; it never bursts.
4. **Completions are pushed.** The client holds one `GET /api/events` stream per tab, authenticated like any
   other request (fetch streaming, so the Capacitor app can send its token). A finished job runs
   `NOTIFY entity_updated` with the entity ID and requester IDs in the same transaction as its write. Each
   process holds one `LISTEN` connection and forwards the frame to its streams for those users. The client
   invalidates that entity's queries; only mounted queries refetch.
5. **Derived-data hints stay, and become rarer.** Background jobs that change a user's derived data send
   `derived-data-updated` to that user's streams, collapsed to at most one frame every 3 seconds as today.
   Under rule 5 most derived data is written by the request itself, so these become rare.
6. **Reconnects recover missed frames.** After a reconnect the client refetches its open queries, as it does
   today, since `NOTIFY` is not durable.

## What goes

Tickets and the ticket store, per-session membership and revisions, foreground and visible priorities,
heartbeats and leases, Redis reverse indexes and Pub/Sub, and the account generation on population
requests. Translation follows the same path as population: a coalesced job, then an `entity-updated`
frame.

## Open points

- Default refresh intervals for each Media and Fitness entity schema.
- Whether the populate call should cap its batch, for example 100 IDs, to bound one page's queueing.
