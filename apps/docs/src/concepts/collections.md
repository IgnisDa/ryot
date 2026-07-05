# Collections

Collections organize media and control dashboard sections, notifications, and status changes.

## Default collections

These system collections cannot be deleted.

| Collection      | Description                              | Special behavior                                           |
| --------------- | ---------------------------------------- | ---------------------------------------------------------- |
| **Watchlist**   | Items you plan to consume                | Removed when progress or seen state changes                |
| **In Progress** | Items you are currently consuming        | Powers the "In Progress" dashboard section                 |
| **Completed**   | Items you have finished                  | Used for completion history and filters                    |
| **Monitoring**  | Items you want to keep an eye on         | Powers upcoming events and update notifications            |
| **Owned**       | Items in your physical/digital inventory | Includes an optional `Owned on` date field                 |
| **Reminders**   | Items with scheduled reminders           | Uses reminder-specific extra fields                        |
| **Custom**      | Items you created manually in Ryot       | Custom metadata/groups/people are added here automatically |

## Automatic rules

Each progress or seen update first removes the item from `Watchlist`, then applies these rules:

| State                  | Result                                                 |
| ---------------------- | ------------------------------------------------------ |
| `In Progress`          | Add to `In Progress` and `Monitoring`.                 |
| `Dropped` or `On Hold` | Remove from `In Progress`; do not change `Monitoring`. |
| `Completed`            | Apply the completion rules below.                      |

For completed items:

- **Non-episodic media** (movies, books, audiobooks, music, video games, comic books, visual
  novels):
  Add to `Completed`; remove from `In Progress` and `Monitoring`.
- **Episodic media** (shows, anime, manga, podcasts):
  Use the algorithm below. If complete, add to `Completed` and remove from `In Progress`. If not,
  keep it in `In Progress` and `Monitoring`.

::: info
For episodic media, `Monitoring` is not auto-removed on completion. This helps ongoing series
continue surfacing future updates.
:::

## Episodic completion

All tracked episodes/chapters must have equal, non-zero consume counts.

- Episodes 1-10 watched once each -> **Completed**
- Episodes 1-9 watched once, episode 10 watched twice -> **Not completed**
- Episodes 1-10 watched twice each -> **Completed** (second full pass)

This is why rewatching a single favorite episode can put a show back in `In Progress` until
other episodes catch up.

For shows, seasons named `Specials` or `Extras` are excluded from completion counting.

If Ryot cannot determine a full episode/chapter set (common with ongoing anime/manga), it treats
the item as complete by default. Strict counting starts once totals become known.

## New show content

If a show is in both `Completed` and `Monitoring`, and provider updates add new not-yet-seen
content (for example new episodes/seasons), Ryot can:

1. Remove it from `Completed`
2. Add it to `Watchlist`
3. Send a notification about the move

## Monitoring and notifications

- `Upcoming` shows monitored items with upcoming calendar events.
- Notifications include releases, metadata status changes, release-date changes, and
  episode/chapter count changes.

## Reminders

The default `Reminders` collection uses reminder-specific data fields (date + text). On the
scheduled date, Ryot sends a reminder notification and removes the item from `Reminders`.

## Manual changes

You can add or remove collection membership on an item page. Remove `Monitoring` to reduce
notifications without removing `In Progress`.

::: tip
Notifications are controlled by `Monitoring`, not `Completed`. Adding something to `Completed`
does not disable update notifications by itself.
:::

::: warning
If you update progress again later, automation rules may add `In Progress`/`Monitoring` back,
depending on the new state.
:::
