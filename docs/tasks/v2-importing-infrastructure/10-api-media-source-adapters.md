# API Media Source Adapters

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Port API-backed media sources onto the V2 import pipeline: `plex`, `jellyfin`, `trakt`, `mediatracker`, and `audiobookshelf`. This slice should prove source API credential handling, source-level auth/fetch failures, LAN/self-hosted URL support, host-only input summaries, source-specific bounded fetch concurrency, and item-level failures for API items.

Use existing HTTP/client safety patterns where available. User-provided URLs are allowed, including private/LAN hosts. API keys and passwords may be accepted for execution but must never be persisted in `inputSummary`, failure context, logs, or raw response storage.

## Acceptance criteria

- [ ] Source input schemas are added for `plex`, `jellyfin`, `trakt`, `mediatracker`, and `audiobookshelf`.
- [ ] Input summaries persist safe host/source metadata only and never store API keys, passwords, raw URLs with secret paths, or temp paths.
- [ ] Authentication or source fetch failures that prevent continuing fail the whole run with `errorSummary`.
- [ ] Per-item API/lookup failures become item-level failures when the source can continue.
- [ ] Source adapters may use modest bounded internal concurrency for external API calls.
- [ ] API adapters emit normalized media entity groups and failures without DB writes.
- [ ] Plex/Jellyfin/Mediatracker watched episodes map to episodic `progress(100)` coverage where season/episode data exists.
- [ ] Trakt history/list/watchlist/rating data maps to V2 lifecycle events, review events, and collections according to parent PRD semantics.
- [ ] Audiobookshelf audiobook/podcast imports preserve provider-backed media, podcast episode coverage where available, reviews, and collections.
- [ ] Tests use mocked/fake source responses and do not require real external services.
- [ ] Tests verify secret redaction from summaries and failure context.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 4
- User story 5
- User story 7
- User story 8
- User story 9
- User story 11
- User story 12
- User story 15
- User story 22
- User story 23
- User story 24
