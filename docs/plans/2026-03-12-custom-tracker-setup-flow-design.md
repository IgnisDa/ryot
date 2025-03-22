# Custom Tracker Setup Flow - Design Document

**Date:** 2026-03-12  
**Status:** Approved  
**Type:** Frontend-only UX improvement

## Overview

Redesign the custom facet landing page experience to provide a guided, polished setup flow for new custom trackers. Currently, custom facet pages show a simple "Add schema" button with an empty state, which leaves users without clear guidance on how to complete their tracker setup.

## Goals

1. Create a productized first-run experience for custom facets
2. Guide users through setting up their primary entity schema
3. Encourage (but don't require) event schema setup
4. Provide clear path to adding first entity instance
5. Transform the page into a rich tracker overview once setup is complete
6. Maintain visual consistency with existing sidebar and app aesthetic

## Non-Goals

- Backend changes or API modifications
- Perfect persistence or complex state management
- Built-in facet changes (remain read-only)
- Query builder or saved view architecture
- Automated facet creation redirects

## User Scenarios

### Scenario 1: Whiskey Tracker Setup
1. User creates custom facet "Whiskeys" from sidebar
2. User navigates to `/tracking/whiskeys`
3. Page shows guided setup with 3 clear steps
4. User creates "Whiskey" entity schema with properties (distillery, age, type)
5. Page transitions to overview mode
6. User optionally adds "Taste" event schema
7. User adds first whiskey entity "Lagavulin 16"
8. Page now shows rich tracker overview with entities and events

### Scenario 2: Returning to Custom Facet
1. User with existing entity schemas visits facet page
2. Page shows tracker overview mode immediately
3. User sees all entity schemas as cards
4. Each card shows entities and event schemas
5. Clear CTAs to add more entities or event schemas
6. "Add another schema" CTA at bottom for edge cases

## Design Decisions

### Decision 1: Setup Trigger
**Chosen:** Option A - Always show setup until first entity schema is created

**Alternatives considered:**
- Option B: Show until first entity is created (too much hand-holding)
- Option C: Show with dismiss option (adds complexity)

**Rationale:** Clean trigger condition. Once entity schema exists, the tracker is functionally ready, even if empty.

### Decision 2: Event Schema Timing
**Chosen:** Option B - Optional/suggested in guided setup

**Alternatives considered:**
- Option A: Required in setup (too restrictive)
- Option C: Completely separate after setup (less guidance)

**Rationale:** Balances guidance with flexibility. Users can skip and add later.

### Decision 3: Visual Structure
**Chosen:** Option A - Vertical stepper/progress cards

**Alternatives considered:**
- Option B: Single hero card with embedded form (less step-by-step feel)
- Option C: Split view (too complex for mobile)

**Rationale:** Clear progressive disclosure, works well on all screen sizes, feels like a guided journey.

### Decision 4: Implementation Approach
**Chosen:** Option A - Modal-based progressive setup

**Alternatives considered:**
- Option B: Inline form progressive setup (duplicates modal UI)
- Option C: Hybrid hero card (less clear progression)

**Rationale:** Reuses existing robust modal infrastructure, minimal complexity, easy to maintain.

## Component Architecture

### Component Hierarchy

```
RouteComponent
├── FacetHeader (existing)
├── FacetMetadata (existing)
└── CustomFacetSchemaSection (refactored)
    ├── SetupGuidedFlow (new - when entitySchemas.length === 0)
    │   ├── SetupStepCard (Step 1: Entity Schema)
    │   ├── SetupStepCard (Step 2: Event Schema - optional)
    │   ├── SetupStepCard (Step 3: First Entity)
    │   └── Modals (existing)
    │       ├── EntitySchemaCreateModal
    │       ├── CreateEventSchemaModal
    │       └── CreateEntityModal
    └── TrackerOverview (new - when entitySchemas.length > 0)
        ├── EntitySchemaCard[] (enhanced)
        │   ├── Schema metadata
        │   ├── EntitiesSection (existing)
        │   └── EventSchemasSection (existing)
        └── AddSchemaButton (bottom CTA)
```

### State Management

**No new global state required.**

Local React state manages:
- `activeModal: 'entity-schema' | 'event-schema' | 'entity' | null`
- `completedSteps: Set<'entity-schema' | 'event-schema' | 'entity'>` (for UI indicators)

All data fetching and mutations use existing TanStack Query hooks:
- `useEntitySchemasQuery()` - determines view mode
- `useEntitySchemaMutations()` - handles schema creation
- `useEventSchemaMutations()` - handles event schema creation
- `useEntityMutations()` - handles entity creation

View mode transition is purely data-driven via `getFacetEntitySchemaViewState()`.

## Visual Design

### Setup Mode: Guided Flow

**Step Card States:**
- **Pending:** Muted gray, disabled appearance, no CTA
- **Active:** Full accent color, primary CTA button, detailed description
- **Completed:** Green checkmark icon, collapsed summary, subtle green background

**Step 1: Create Primary Entity Schema (Active State)**
```
┌──────────────────────────────────────────────────────┐
│ ① Define your main entity schema                    │
│                                                      │
│ Create the schema that describes what you're        │
│ tracking. This defines the fields each tracked      │
│ item will have.                                     │
│                                                      │
│                    [Create entity schema →]         │
└──────────────────────────────────────────────────────┘
```

**Step 1: Create Primary Entity Schema (Completed State)**
```
┌──────────────────────────────────────────────────────┐
│ ✓ Define your main entity schema                    │
│   "Whiskey" entity schema created with 8 properties │
└──────────────────────────────────────────────────────┘
```

**Step 2: Add Event Schema (Optional, Active State)**
```
┌──────────────────────────────────────────────────────┐
│ ② Add event schema (optional)                       │
│                                                      │
│ Define events you want to track for this entity,    │
│ like tastings, purchases, or reviews.               │
│                                                      │
│        [Add event schema →]    [Skip for now]       │
└──────────────────────────────────────────────────────┘
```

**Step 3: Add First Entity (Active State)**
```
┌──────────────────────────────────────────────────────┐
│ ③ Add your first whiskey                            │
│                                                      │
│ Start tracking by adding your first entity          │
│ instance. You can add more anytime.                 │
│                                                      │
│                    [Add whiskey →]                   │
└──────────────────────────────────────────────────────┘
```

**Step Progression Logic:**
- Step 1 is always active on initial load
- Steps 2 & 3 become active once entity schema is created
- Steps 2 & 3 can be completed in any order
- Page transitions to overview mode after entity schema exists (regardless of steps 2/3)

### Overview Mode: Tracker Overview

Once at least one entity schema exists, the page shows:

**Entity Schema Card (enhanced)**
```
┌──────────────────────────────────────────────────────┐
│ 🥃 Whiskey                                           │
│ whiskey-slug                        8 properties     │
├──────────────────────────────────────────────────────┤
│                                                      │
│ ENTITIES                        [Add whiskey →]     │
│ Tracked instances of this schema                    │
│                                                      │
│ • Lagavulin 16                                      │
│   Added 2 days ago • 3 events                       │
│                                                      │
│ • Ardbeg 10                                         │
│   Added 1 week ago • 1 event                        │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│ EVENT SCHEMAS            [Add event schema →]       │
│ Define the events tracked for this schema           │
│                                                      │
│ • Taste (4 properties)                              │
│ • Purchase (2 properties)                           │
│                                                      │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│            [+ Add another entity schema]             │
└──────────────────────────────────────────────────────┘
```

**Key Enhancements:**
- Entity schema becomes primary visual unit (large card)
- Each card embeds `EntitiesSection` and `EventSchemasSection`
- Stronger empty states with contextual guidance
- "Add schema" CTA moves to bottom (less prominent)
- Visual hierarchy emphasizes content over management

### Visual Styling Alignment

**Color System (from Sidebar):**
- Surface: `isDark ? 'var(--mantine-color-dark-8)' : 'white'`
- Border: `isDark ? 'var(--mantine-color-dark-6)' : 'var(--mantine-color-stone-3)'`
- Accent: `'var(--mantine-color-accent-5)'` + facet.accentColor
- Text primary: `isDark ? 'var(--mantine-color-dark-0)' : 'var(--mantine-color-dark-9)'`
- Text muted: `isDark ? 'var(--mantine-color-dark-4)' : 'var(--mantine-color-stone-5)'`

**Component Styles:**
- `Paper` with `withBorder`, `radius="md"`, `p="lg"` or `p="xl"`
- Step numbers use facet accent color with circular badge
- Checkmarks use `var(--mantine-color-green-6)`
- Buttons use facet accent color for primary actions
- Empty states use `backgroundColor: 'var(--mantine-color-gray-0)'`

## Data Flow

### Setup Flow

```
User clicks "Create entity schema" 
  → SetupGuidedFlow opens EntitySchemaCreateModal
  → User fills form and submits
  → useEntitySchemaMutations().create.mutate()
  → Backend creates entity schema
  → TanStack Query refetches entitySchemas
  → entitySchemas.length > 0
  → getFacetEntitySchemaViewState() returns 'list'
  → Page transitions to TrackerOverview component
  → Steps 2 & 3 become active (if still in setup)
```

### Modal Reuse Pattern

All existing modals remain unchanged:
- `EntitySchemaCreateModal` - creates entity schema
- `CreateEventSchemaModal` - creates event schema
- `CreateEntityModal` - creates entity instance

Setup flow simply triggers these modals via local state:
```typescript
const [activeModal, setActiveModal] = useState<string | null>(null);

// Step 1 button onClick:
setActiveModal('entity-schema');

// Modal onClose:
setActiveModal(null);
```

## Error Handling

**Modal-level errors:**
- Already handled by existing modal components
- Error messages show at top of modal
- Network errors show with retry buttons
- Form validation errors show per-field

**Query errors:**
- Loading spinner shows during initial fetch
- Error state shows with retry button
- Already implemented in current code

**Edge cases:**
1. User closes modal mid-setup → state persists, can reopen
2. Multiple entity schemas created → all show in overview mode
3. Built-in facets → continue showing read-only section
4. Network errors during mutation → modal shows error, user can retry

## File Structure

### Files to Modify
- `apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx`
  - Extract `SetupGuidedFlow` component (or new file)
  - Extract `TrackerOverview` component (or new file)
  - Refactor `CustomFacetSchemaSection` to handle both modes
  - Keep route file under 500 lines (extract if needed)

### Files to Potentially Create
- `apps/app-frontend/src/features/facets/setup-flow.tsx` (if route file gets too large)
- `apps/app-frontend/src/features/facets/tracker-overview.tsx` (if route file gets too large)

### Files to Reuse (No Changes)
- `apps/app-frontend/src/features/entity-schemas/hooks.ts`
- `apps/app-frontend/src/features/entity-schemas/use-form.ts`
- `apps/app-frontend/src/features/entity-schemas/properties-builder.tsx`
- `apps/app-frontend/src/features/event-schemas/hooks.ts`
- `apps/app-frontend/src/features/event-schemas/section.tsx`
- `apps/app-frontend/src/features/entities/section.tsx`

## Testing Strategy

### Manual Testing Flow

1. **Setup mode test:**
   - Create new custom facet with zero entity schemas
   - Navigate to facet page
   - Verify setup guided flow appears with 3 steps
   - Verify Step 1 is active, Steps 2 & 3 are disabled

2. **Entity schema creation:**
   - Click "Create entity schema"
   - Verify modal opens with form
   - Fill form and submit
   - Verify modal closes
   - Verify page transitions to overview mode

3. **Overview mode test:**
   - Verify entity schema card appears
   - Verify entities section shows within card
   - Verify event schemas section shows within card
   - Verify "Add another schema" button at bottom

4. **Built-in facet test:**
   - Navigate to built-in facet
   - Verify read-only message still appears
   - Verify no setup flow or overview changes

### TypeScript Validation
```bash
bun run turbo typecheck --filter='@ryot/app-frontend'
```

### Acceptance Criteria
- ✅ Setup flow only appears for custom facets with zero entity schemas
- ✅ All existing modals continue working without modification
- ✅ Visual styling matches sidebar aesthetic (colors, borders, spacing)
- ✅ Page transitions smoothly between setup and overview modes
- ✅ Built-in facets remain unchanged
- ✅ TypeScript compiles without errors
- ✅ Route file or extracted components stay under 500 lines each

## Implementation Notes

### React Component Props Pattern
All new components must use single `props` parameter (not destructured):
```typescript
// ✅ Correct
function SetupStepCard(props: SetupStepCardProps) {
  return <div>{props.title}</div>;
}

// ❌ Incorrect
function SetupStepCard({ title }: SetupStepCardProps) {
  return <div>{title}</div>;
}
```

### No Comments Unless Necessary
Prefer self-documenting code with clear variable and function names.

### Field Ordering by Line Length
Object literals and variable declarations should be ordered by ascending line length:
```typescript
const state = {
  modal: null,
  isSetupComplete: false,
  completedSteps: new Set<string>(),
};
```

### No Explicit Return Types
Let TypeScript infer return types unless specifically needed for complex cases.

## Prototype Limitations

**Intentionally mocked/local-only for this prototype:**
- Step completion tracking (local UI state, not persisted)
- "Skip for now" button (just closes modal, no backend tracking)
- Quick stats bar (can be mocked or omitted)

**Backend integration already working:**
- Entity schema creation
- Event schema creation
- Entity creation
- Data fetching and refetching

**Not implemented in this phase:**
- Redirect from facet creation to facet page (requires backend coordination)
- Persistent "setup completed" flag (not needed; derived from data)
- Analytics/telemetry for setup flow
- Onboarding tooltips or tours
