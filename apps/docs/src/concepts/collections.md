# Collections

Collections are a way to organize and categorize your media. Ryot comes with several default
collections that have special behaviors and affect how items appear in the UI.

## Default Collections

These collections are created automatically for each user and cannot be deleted.

| Collection      | Description                              | Special Behavior                                    |
| --------------- | ---------------------------------------- | --------------------------------------------------- |
| **Watchlist**   | Items you want to consume in the future  | Automatically removed when you start watching       |
| **In Progress** | Items you are currently consuming        | Shown in the "In Progress" section on the dashboard |
| **Completed**   | Items you have finished                  | Used for completion tracking                        |
| **Monitoring**  | Items you want to keep an eye on         | Triggers notifications for new episodes/seasons     |
| **Owned**       | Items in your physical/digital inventory | Has an optional "Owned on" date field               |
| **Reminders**   | Items with scheduled reminders           | Requires a reminder date and text                   |

## Automatic Collection Management

Ryot automatically manages certain collections based on your activity. Understanding this
behavior helps avoid confusion about why items appear in certain sections.

### When You Start Watching

When you mark any episode, chapter, or media item as "in progress":

1. The item is **added** to `In Progress`
2. The item is **added** to `Monitoring`
3. The item is **removed** from `Watchlist` (if present)

### When You Complete Something

The behavior depends on the media type:

**For movies, books, music, visual novels, and video games:**

- The item is **added** to `Completed`
- The item is **removed** from `In Progress`
- The item is **removed** from `Monitoring`

**For shows, anime, manga, and podcasts:**

- Progress is calculated (see below)
- If fully complete: moved to `Completed`, removed from `In Progress`
- If not fully complete: stays in `In Progress` and `Monitoring`

### When You Drop or Put on Hold

- The item is **removed** from `In Progress`
- The item stays in `Monitoring` (you'll still get notifications)

## Progress Calculation

For episodic media (shows, anime, manga, podcasts), Ryot uses a specific algorithm to
determine if you have "completed" the media.

### The Rule

**All episodes/chapters must be watched an equal number of times.**

For example, if a show has 10 episodes:

- Watching episodes 1-10 once each = **Completed**
- Watching episodes 1-9 once, and episode 10 twice = **Not completed** (unequal watch counts)
- Watching episodes 1-10 twice each = **Completed** (second re-watch)

This means if you re-watch a random episode in the middle, Ryot will move the show back to
"In Progress" until you've watched all other episodes an equal number of times.

### Specials Are Excluded

Seasons named "Specials" or "Extras" (typically Season 0) are **not** counted towards
progress. You can leave them unwatched without affecting your completion status.

### When Episode Count Is Unknown

For anime or manga where the total episode/chapter count is unknown (ongoing series with no
defined end), Ryot considers the media "complete" by default. Progress tracking kicks in
once the total count is known.

## Manual Collection Management

You can always manually add or remove items from collections. This is useful when:

- You want to mark something as "Completed" even if Ryot's algorithm disagrees
- You want to remove something from "In Progress" that you don't plan to finish
- You want to stop monitoring something but keep it in "In Progress"

::: tip
Manually adding an item to `Completed` does **not** stop notifications. Notifications are
controlled by the `Monitoring` collection. Remove an item from `Monitoring` if you no longer
want notifications about new episodes/seasons.
:::

## Collections and the Dashboard

The dashboard displays items based on their collection membership:

- **In Progress** section shows items in the `In Progress` collection
- **Upcoming** section shows items in `Monitoring` that have upcoming releases

If an item appears in "In Progress" unexpectedly, check if you've watched episodes an
unequal number of times (common with re-watches of favorite episodes).
