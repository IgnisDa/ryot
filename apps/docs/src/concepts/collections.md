# Collections

Collections are one of the core organizing systems in Ryot. They are not only labels for your
media: they also drive dashboard sections, notification behavior, and some automatic status
transitions.

## Default Collections

Ryot creates these collections automatically for every user account. They are default system
collections and cannot be deleted.

| Collection      | Description                              | Special behavior                                           |
| --------------- | ---------------------------------------- | ---------------------------------------------------------- |
| **Watchlist**   | Items you want to consume in the future  | Automatically removed when progress/seen is updated        |
| **In Progress** | Items you are currently consuming        | Powers the "In Progress" dashboard section                 |
| **Completed**   | Items you have finished                  | Used for completion history and filters                    |
| **Monitoring**  | Items you want to keep an eye on         | Powers upcoming events and update notifications            |
| **Owned**       | Items in your physical/digital inventory | Includes an optional `Owned on` date field                 |
| **Reminders**   | Items with scheduled reminders           | Uses reminder-specific extra fields                        |
| **Custom**      | Items you created manually in Ryot       | Custom metadata/groups/people are added here automatically |

## Automatic Collection Management

Ryot applies collection automation when progress/seen state changes are recorded.

### Step 1: Watchlist removal

On every progress/seen update, Ryot first removes the item from `Watchlist` (if present).

### Step 2: State-based rules

When state becomes `In Progress`:

1. Add item to `In Progress`
2. Add item to `Monitoring`

When state becomes `Dropped` or `On Hold`:

1. Remove item from `In Progress`
2. Leave `Monitoring` unchanged

When state becomes `Completed`, behavior depends on media type:

- **Non-episodic media** (movies, books, audiobooks, music, video games, comic books, visual
  novels):
  1. Add to `Completed`
  2. Remove from `In Progress`
  3. Remove from `Monitoring`
- **Episodic media** (shows, anime, manga, podcasts):
  - Use the completion algorithm below
  - If complete: add to `Completed`, remove from `In Progress`
  - If not complete: keep/add in `In Progress` and `Monitoring`

::: info
For episodic media, `Monitoring` is not auto-removed on completion. This helps ongoing series
continue surfacing future updates.
:::

## Episodic Completion Algorithm

For shows, anime, manga, and podcasts, Ryot decides completion using consume counts.

### Core rule

All tracked episodes/chapters must have equal, non-zero consume counts.

Example for a 10-episode show:

- Episodes 1-10 watched once each -> **Completed**
- Episodes 1-9 watched once, episode 10 watched twice -> **Not completed**
- Episodes 1-10 watched twice each -> **Completed** (second full pass)

This is why rewatching a single favorite episode can put a show back in `In Progress` until
other episodes catch up.

### Specials and extras exclusion

For shows, seasons named `Specials` or `Extras` are excluded from completion counting.

### Unknown totals

If Ryot cannot determine a full episode/chapter set (common with ongoing anime/manga), it treats
the item as complete by default. Strict counting starts once totals become known.

## Show Update Edge Case: Completed -> Watchlist

There is one additional automation path for shows during metadata refresh.

If a show is in both `Completed` and `Monitoring`, and provider updates add new not-yet-seen
content (for example new episodes/seasons), Ryot can:

1. Remove it from `Completed`
2. Add it to `Watchlist`
3. Send a notification about the move

This helps re-surface shows that were previously complete.

## Monitoring and Notifications

`Monitoring` is the main driver for update-based awareness in Ryot.

- The dashboard `Upcoming` section is built from monitored items with upcoming calendar events
- Monitoring notifications include more than episode releases, such as metadata status changes,
  release-date changes, and episode/chapter count changes

## Reminders Behavior

The default `Reminders` collection uses reminder-specific data fields (date + text). On the
scheduled date, Ryot sends a reminder notification and removes the item from `Reminders`.

## Manual Collection Management

You can always add or remove collection memberships manually from an item page.

Common use cases:

- Keep manual control when algorithmic completion is not what you want
- Remove from `In Progress` when you decide not to continue
- Keep in `In Progress` but remove `Monitoring` to reduce notifications

::: tip
Notifications are controlled by `Monitoring`, not `Completed`. Adding something to `Completed`
does not disable update notifications by itself.
:::

::: warning
If you update progress again later, automation rules may add `In Progress`/`Monitoring` back,
depending on the new state.
:::

## Dashboard Mapping

- **In Progress** section shows items in the `In Progress` collection
- **Upcoming** section is driven by monitored items that have upcoming events
