# Collections

Collections are user-owned kernel entities. Memberships are kernel `member-of` relationships.
Member fields are validated against the collection's declarations; `rank` is reserved for ordering.

## Manual order

The relationship repository owns all runtime rank writes. New memberships prepend under the same
collection lock used by moves. Batch insertion allocates ranks per collection before set-based writes.
Ordinary relationship updates retain the current rank, including generic writers and merges.
Collection preparation does not allocate a position. Historical restore preserves saved ranks;
the V1 converter instead assigns spaced ranks in legacy order.

Ranks are integers strictly between `-2^52` and `2^52`, with an initial step of `2^32`. A move normally
changes one row using its actual database neighbors, not client-supplied positions. When a gap is full,
the repository respaces up to 128 neighbors on each side. A fully dense surrounding window requires
a set-based collection-wide respace in the same transaction. This fallback does not load the collection
into application memory. It is exceptional maintenance, not part of every move, insertion, or deletion.

Locks follow the existing entity-reference, collection-row, and relationship-identity order. Collection
rows use `NO KEY UPDATE`, compatible with entity reference locks. Rank allocation and rebalancing never
hold a transaction across lifecycle policies or network calls.

The database advances `entity.collection_order_revision` for committed membership insertion, deletion,
or rank changes, including cascading deletion. Metadata-only changes do not advance it. This trigger
does not alter the collection's content, timestamps, or content generation. A partial rank index serves
the RyotQL `relationship.collectionRank` field, ordered with the member's stable identity, not its title.

## Commands and reads

`POST /collections/memberships/reorder` takes the member, an anchor or absolute end, expected revision,
and immutable submission identity/time. Ownership, revision validation, position changes, and the
mutation receipt commit atomically. Completed commands replay before checking newer revisions;
reusing an identity for different input is a conflict. No collection add/remove events or domain hooks
are emitted for internal rank changes.

The collection-members recipe reads its revision and page in one RyotQL repeatable-read snapshot.
Continuation cursors carry that revision. A changed revision marks the response stale and withholds
its member rows; consumers reject that page and refresh from the start rather than mix orders.
The shared pagination controller refreshes all loaded pages before publishing them together.
