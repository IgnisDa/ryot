# Mobile navigation revamp

Treat the mobile header as a **navigation state machine**, not one fixed component that merely swaps its title. Ryot currently has three meaningful navigation levels:

```text
Workspace home                     Root
Saved view                         Root
Entity details                     Child
```

A workspace switch changes the application context. A saved view changes the current root destination within that context. Opening an item pushes a child screen.

This document covers the mobile app only. The web app will not have a page header or page title; all header and large-title behavior described below is mobile-only and has no web equivalent.

## Recommended route behavior

```text
Media
├── Home
├── All Persons
├── All Companies
├── All Shows
├── All Books
├── All Movies
│   └── Movie details
├── All Music
└── Collections

Fitness
├── Home
├── Saved view
└── Exercise details
```

Workspace home and saved views should be peers. Entity details should sit above whichever saved view opened them.

This distinction determines the header:

| Screen role    | Leading control | Title                       | Right-side actions |
| -------------- | --------------- | --------------------------- | ------------------ |
| Workspace home | Menu            | Workspace name              | Global search      |
| Saved view     | Menu            | Saved-view name             | Search, filter     |
| Entity details | Back            | Entity name after scrolling | Overflow or edit   |
| Search mode    | Close/back      | Search field                | Clear or filter    |
| Selection mode | Close           | Selection count             | Batch actions      |

The leading control should be determined by the **screen’s role**, not by how the user happened to reach it.

## 1. Workspace home header

The workspace home page is a top-level destination. Its header should use the menu icon, never a back arrow.

At the top of the page:

```text
[☰]                                      [Search]

Media
```

After scrolling:

```text
[☰] Media                                [Search]
```

Use the workspace name as the page title. Do not title it “Home.” “Media” or “Fitness” communicates more useful context.

The title can initially appear as a large heading below the compact navigation row. As the page scrolls, it moves or crossfades into the navigation row. This produces a more native result than placing a large title, subtitle, hamburger, search, and filter buttons into one crowded horizontal block.

The search action on this page should search across the workspace. In Media, it could search movies, books, shows, people, companies, and music. In Fitness, it would search the corresponding fitness entities.

Switching from Media to Fitness should:

1. Close the drawer.
2. Dismiss search, filters, sheets, and selection states.
3. Reset the navigation stack.
4. Replace the current route with Fitness home.

Do not push Fitness home on top of the Media stack. Otherwise, the back button could unexpectedly return the user to Media.

## 2. Saved-view header

Saved views such as “All Movies” are also top-level destinations because they are directly available in the drawer.

The saved-view header should therefore use a menu icon, not a back arrow:

```text
[☰]                                      [Search] [Filters]

All Movies
20+ results · Count all
```

Once the page scrolls:

```text
[☰] All Movies                           [Search] [Filters 3]
```

The result count and secondary metadata disappear from the compact state. The title remains visible and truncates to one line when necessary.

Selecting different saved views from the drawer should replace the current saved-view route rather than accumulating a stack:

```text
All Movies → All Books → All Music
```

should not create:

```text
All Movies
  └── All Books
        └── All Music
```

They are sibling roots. Android back should not walk through every drawer destination previously opened.

This rule should also hold when a saved view is linked from the workspace home page. “All Movies” should have the same header whether it was opened from the drawer or from a “View all movies” button. The route’s meaning should not change based on entry path.

### Search behavior

Tapping search should transform the header into a dedicated search state:

```text
[←] [ Search All Movies…                         ] [Clear]
```

The search field should consume most of the width. Do not attempt to keep the page title, hamburger, search field, and filter button visible simultaneously.

Back behavior while searching:

1. Close the keyboard if appropriate.
2. Exit search mode.
3. Only then perform navigation.

The search query, filter state, sort order, and scroll position should belong to the saved view. Opening a movie and returning should restore the exact list state.

### Filter behavior

Filters should open in a bottom sheet rather than expanding inside the header. The header only needs the filter icon and active-filter count:

```text
[Filters 3]
```

The sheet can contain filtering, sorting, grouping, and saved-view-specific options. This scales better across movies, books, music, workouts, and other domains.

### Add behavior

The saved-view header already has menu, search, and filter controls. Adding another visible action will make it crowded.

Use a contextual floating action button only when adding is genuinely the primary action:

```text
All Movies     + → Add movie
All Books      + → Add book
All Exercises  + → Add exercise
```

The button should be hidden on screens where creation is uncommon. Do not show a global floating `+` on every route.

## 3. Entity-detail header

Opening a movie from “All Movies” creates a child route. The header changes from menu navigation to back navigation.

At the top of a visually rich detail page:

```text
[←]                                               [⋯]

[poster, artwork, image, or hero content]

Wuthering Heights
Movie · 2026
```

After scrolling:

```text
[←] Wuthering Heights                             [⋯]
```

The header should initially be transparent or visually integrated with the hero section. As content scrolls underneath, it becomes opaque and introduces a subtle bottom divider. The entity title fades into the header only after the large title in the page body is leaving the viewport.

This pattern remains generic:

```text
Movie details       Wuthering Heights
Book details        The Left Hand of Darkness
Person details      Person name
Workout details     Upper Body Strength
Exercise details    Barbell Squat
```

The header should not display the entity type unless it is necessary to disambiguate the title. Put type, year, status, and metadata in the detail content instead.

The overflow menu can hold secondary operations:

```text
Edit
Move to collection
Duplicate
Share
Delete
```

Domain-specific primary actions should usually live in the page body or a contextual bottom action area rather than being forced into the header.

### Returning to the source view

Back must return to the exact source context:

```text
All Movies
Search: "drama"
Filters: Completed
Sort: Release year
Scroll position: row 14
    ↓ open item
Wuthering Heights
    ↓ back
Same All Movies state
```

Store a return context containing at least:

```ts
type ReturnContext = {
	workspaceId: string;
	viewId: string;
	query?: string;
	filters?: Record<string, unknown>;
	sort?: string;
	scrollOffset?: number;
};
```

When a detail page is entered through a deep link and has no previous in-app route, the back button should fall back to the relevant workspace home. Do not render a nonfunctional back arrow.

## 4. Gesture and system-back rules

The drawer and detail navigation compete for the same left-edge gesture. Resolve that based on route level.

On workspace homes and saved views:

- Menu button opens the drawer.
- Left-edge swipe may open the drawer.
- Android back closes the drawer before doing anything else.

On detail screens:

- Back button pops the detail route.
- iOS left-edge swipe performs back navigation.
- Drawer edge-swipe is disabled.
- Android back closes menus or sheets first, then pops the detail route.

This prevents an edge swipe on a movie detail page from unexpectedly opening the workspace drawer instead of returning to the movie list.

## 5. Header dimensions and styling

The current mobile screenshot feels oversized because the back, search, and filter controls are placed inside large circular surfaces.

Use these approximate dimensions:

```text
Safe-area inset               Device-dependent
Compact header row            52–56 dp
Large-title area              48–64 dp
Horizontal padding            16 dp
Icon touch target             44–48 dp
Visible icon size             20–24 dp
Gap between actions           4–8 dp
Compact title                 17–20 dp
Large title                   28–32 dp
Subtitle                      13–14 dp
```

A 44–48 dp touch target does not require a 48 dp filled circle. The pressable can be large while the visible treatment remains subtle.

Recommended visual treatment:

- Use the same background surface as the page at the top.
- Introduce an opaque header and thin divider only after scrolling.
- Avoid gradients and heavy glass effects.
- Use orange for the primary action, active filter count, or active state—not every icon.
- Keep action buttons visually quieter than the page title.
- Limit the compact header to two right-side actions.
- Truncate long titles rather than reducing their font size.
- Match the status-bar background to the header.

## 6. Header component architecture

Use one adaptive header system with explicit variants rather than several unrelated headers:

```ts
type MobileHeaderConfig =
	| {
			mode: "workspace";
			title: string;
			onOpenMenu: () => void;
			onSearch?: () => void;
	  }
	| {
			mode: "saved-view";
			title: string;
			subtitle?: string;
			activeFilterCount?: number;
			onOpenMenu: () => void;
			onSearch: () => void;
			onFilter: () => void;
	  }
	| {
			mode: "detail";
			title: string;
			overlayAtTop?: boolean;
			onBack: () => void;
			onOpenActions?: () => void;
	  }
	| {
			mode: "search";
			query: string;
			placeholder: string;
			onChangeQuery: (value: string) => void;
			onClose: () => void;
			onClear: () => void;
	  };
```

Route metadata should determine the mode:

```text
/workspaces/:workspaceId
    → workspace

/workspaces/:workspaceId/views/:viewId
    → saved-view

/workspaces/:workspaceId/entities/:entityType/:entityId
    → detail
```

The final mobile hierarchy should behave as follows:

```text
Media home
  Header: menu + Media

All Movies
  Header: menu + All Movies + search/filter

Movie details
  Header: back + contextual title + overflow

Switch to Fitness
  Reset stack → Fitness home
  Header: menu + Fitness
```

The central rule is:

> Menu for root destinations. Back for child destinations. Workspace switching resets context. Saved-view state survives detail navigation.
