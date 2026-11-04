# Design note: indexed dates for upcoming and the calendar

Status: agreed with the owner and built. Numbers are in `probes.md`, runs `a2`–`a9`.

## The problem

- `upcoming` fails at the 30 s limit on the dump's date and in a busy week, and it alone fails the home page.
- The show calendar takes 3.3 s in any month, against a 500 ms target.

Three separate causes, each needing its own fix:

1. **Nothing can find a week's episodes.** The date sits inside JSON and is cast per row, so every read scans the
   catalog (644,137 casts) or the library (441,130 episodes).
2. **`upcoming` computes per-title fields over the window.** In a busy week the per-title `total` evaluates the
   episode state check 36 M times. An index does not change this: 208 s with one.
3. **Postgres misjudges the library.** It estimates 54 titles for 14,708, so it starts from the library even when
   a date index exists. Forcing date-first takes the busy calendar from 3.5 s to 120 ms.

## Proposal

**A. A declared, indexed date on entities.**

- An entity schema can name one of its date properties, such as `occursAtProperty: "publishDate"`.
- A trigger copies the value to a new `entity.occurs_at` column in the same write, indexed on
  `(entity_schema_slug, occurs_at)`, and RyotQL exposes it like any physical column. A trigger, because backup
  restores and one-time migrations write entities without going through the services.
- A plugin revision that changes the declaration backfills that schema's rows.
- The kernel learns nothing about any plugin. Other plugins can declare dates too.

**B. RyotQL lets a date-rooted query drive its joins.** When a query's root has a closed range on `occurs_at`,
the statement runs with the written join order, set in its own transaction next to `jit`. Only those statements
change.

**C. `upcoming` starts from the window.** The show and podcast sources become two queries over the window's
episodes, joined up to the followed title. A rows query reads at most 100 episodes soonest first, RyotQL's limit,
and `map` groups them into titles and `occurrences`. A grouped aggregate counts `total`, exact for up to 1,000
titles. A title first reached past 100 episodes is dropped, which leaves the rail's soonest titles intact.

## Alternatives rejected

- **Stored `nextAiringAt` only, no kernel change.** It narrows `upcoming` to followed titles airing soon, but the
  calendar stays at 3.3 s, and it covers only the next airing rather than a window.
- **Hoisting more closed ranges, no schema change.** One scan of the catalog costs 0.9–1.7 s per statement, which
  misses the target, and hoisting is what makes the busy week quadratic.
- **Plugin-declared expression indexes.** Per-plugin DDL at install, on one shared table, while users can run
  different versions of a plugin.

## What this does not cover

- Anime airings are an array in one property, so they stay as they are. They take 49 ms today.
- The backfill runs inside the activating transaction: 94 s for the whole migration on 664,155 dated rows. It runs
  only when a revision adds the declaration.
- With B, a wide window on a small library visits the whole window first, so it could be slower than starting from
  the library. Upcoming and the calendar use windows of at most about a month.
