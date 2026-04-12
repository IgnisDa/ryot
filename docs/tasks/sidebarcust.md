# Sidebar customization

We need to allow users to customize the sidebar for their active workspace in apps/app-client.

## Plan

Use a dedicated **Customize sidebar** mode rather than exposing drag handles and visibility controls during normal navigation.

The normal sidebar should remain optimized for opening pages. Permanent handles, eye icons, or row menus would make the current design noisier and increase accidental edits—particularly on mobile.

The customization should be **workspace-specific**, so the action belongs in the menu opened from the **Media** workspace selector:

> Customize sidebar…

On web, a secondary **Edit** action will appear beside the **Views** and **Saved Views** headings on hover or keyboard focus. Selecting it would open the same global customization mode, initially scrolled to that section. The workspace menu should remain the discoverable entry point; hover and long-press should never be the only way to find it.

## Shared behavior across web and mobile

In customization mode, show only the two editable sections:

### Views

Each row contains:

- A dedicated drag handle
- The existing icon and view name
- A **Show in sidebar** toggle

### Saved Views

Use the same row design and behavior.

Keep the hidden and visible items in **one ordered list**. When an item is turned off, it remains in the customizer but becomes visually muted.

For example:

```text
≡  All Persons       On
≡  All Companies     Off
≡  All Shows         On
```

The normal sidebar would show All Persons followed by All Shows. Re-enabling All Companies would restore it between them. This is preferable to moving disabled items into a separate “Hidden” bucket, because it preserves their intended position and makes future re-enabling predictable.

The section heading can communicate the state:

> Views · 7 of 9 shown

### Use “hide,” not “disable,” in the interface

“disable” means **remove from this sidebar without deleting or deactivating the view**. The UI should therefore use language such as:

- Show in sidebar
- Hide from sidebar
- Hidden

## Home should be the one exception

Make **Home always visible and fixed at the top**:

```text
⌂  Home             Always shown
```

It would have no visibility toggle and no active drag handle. A small lock indicator and label saying “Always shown”.

## Collections

Collections should not appear as disabled-looking rows in the customization screen. Showing controls that cannot be used would make the restriction feel arbitrary.

Instead, place a brief note below the customizable sections:

> Collections are always shown and are not included in sidebar customization.

## Web experience

On web, transform the existing sidebar into an **in-place editing mode** rather than opening a separate settings modal. This lets users see the exact navigation structure they are changing.

While editing:

- Rows no longer navigate when clicked.
- Chevrons are replaced by visibility controls.
- Dragging begins only from the handle, not from anywhere on the row.
- A clear insertion line appears between potential drop positions.
- The sidebar auto-scrolls when the pointer approaches its top or bottom.
- Hidden rows remain visible and muted until the user exits customization.
- A sticky action area contains **Cancel** and **Save changes**.

Changes should remain drafts until saved. That prevents an accidental drag or toggle from immediately altering navigation.

## Mobile experience

On mobile, customization should open as a **full-screen screen or modal**, not inside the swipeable sidebar drawer.

Editing inside the drawer would create several conflicts:

- Horizontal drawer gestures versus touch movement
- Vertical list scrolling versus dragging
- Limited room for handles, icons, labels, and toggles
- Accidental drawer closure during a reorder

The mobile screen would have:

```text
Cancel      Customize sidebar      Save
```

The same Views and Saved Views lists appear below it. Touching the handle lifts the row; dragging near an edge auto-scrolls the list. A subtle haptic response on pickup and drop would make the interaction clearer.

Attempting to leave with unsaved changes should produce a simple discard confirmation.

## Established Rules

Section order should remain fixed:

1. Views
2. Saved Views
3. Collections

Views should only be reordered within Views, and Saved Views within Saved Views. Dragging between the sections would blur the distinction between system-provided destinations and user-created views. A separate “Favorites” or “Pinned” section could be introduced later if users genuinely need a mixed list.

Other useful rules:

- Counts in the normal sidebar should either reflect visible items or be explicitly labeled as totals. Avoid showing “3” when only one row is visible without explaining why.

The design shows a "Restore Defaults" button. This is not needed anymore. Please do not add it.
