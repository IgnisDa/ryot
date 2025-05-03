# Sidebar Integration Design

**Date:** 2026-03-11  
**Status:** Approved  

## Overview

Integrate the journal theme sidebar into the Ryot application, replacing the current facet tracking sidebar with a hierarchical navigation structure that displays facets, entity schemas, and saved views.

## Context

The application currently has:
- A basic sidebar (25% width) showing facet tracking sections
- A customize mode for reordering facets
- Backend-driven facets with entity schemas (e.g., Media facet contains Movies, Books, TV Shows)
- Saved views feature

The journal theme (from git history) had a polished sidebar with:
- Hierarchical navigation (Home, Facets with sub-items, Views)
- Distinctive visual design (accent gold, left border accents on hover)
- Collapsible facet sections
- Full dark/light mode support

## Goals

1. Replace current sidebar with journal theme design
2. Backend-driven data (facets, entity schemas, views)
3. Maintain customize mode functionality
4. Support both light and dark color schemes
5. Mobile responsive (drawer on small screens)
6. Create Storybook stories with fake data

## Non-Goals

- Functional routing (all links redirect to `/` for now)
- Search functionality (UI only)
- Real API integration in stories (use fake data)

## Component Architecture

### Sidebar Component (`/components/Sidebar.tsx`)

Stateless presentational component that accepts full data tree via props.

**Props:**
```typescript
interface SidebarProps {
  facets: AppFacet[];           // Facets with entity schemas
  views: SavedView[];           // Saved views
  colorScheme: 'light' | 'dark';
  isCustomizeMode: boolean;
  onToggleCustomize: () => void;
  onReorderFacets: (facets: AppFacet[]) => void;
}

interface AppFacet {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  icon?: string | null;
  accentColor?: string | null;
  entitySchemas: EntitySchema[];
}

interface EntitySchema {
  id: string;
  name: string;
  slug: string;
}

interface SavedView {
  id: string;
  name: string;
  slug: string;
}
```

### SidebarContainer (in `/routes/_protected/route.tsx`)

Container component that:
- Fetches facets and views from backend APIs
- Manages customize mode state
- Handles facet reordering
- Passes data to Sidebar component

## Visual Design

Based on journal theme with these elements:

### Header Section
- Ryot logo (32x32 gradient box with "R")
- Title: "Ryot" (Space Grotesk font)
- Tagline: "A journal of personal tracking"
- Settings icon button for customize mode

### Search Section
- Search input with search icon
- Accent color border on focus
- Gold focus shadow

### Navigation Sections

**Home**
- House icon with accent color
- Links to `/`

**Facets** (collapsible)
- Section header with accent left border
- Each facet has icon and accent color
- Collapsible with chevron indicator
- Entity schemas indented as children
- Default open/closed state maintained

**Views**
- Section header
- Book icon for each view
- Smaller font size than facets

### Customize Mode
- Settings icon toggles mode
- Drag handles appear when active
- Visual feedback during drag
- Save automatically on reorder

### Color Tokens

**Light Mode:**
- Background: stone.1
- Surface: white
- Border: stone.3
- Text primary: dark.9
- Text secondary: dark.5
- Text muted: stone.5

**Dark Mode:**
- Background: dark.9
- Surface: dark.8
- Border: dark.6
- Text primary: dark.0
- Text secondary: dark.3
- Text muted: dark.4

**Accent (both modes):**
- Primary: #D4A574
- Muted: rgba(212, 165, 116, 0.12)
- Focus shadow: rgba(212, 165, 116, 0.15)

## Data Flow

```
Backend API → SidebarContainer → Sidebar Component
                ↓
           State Management
           (customize mode,
            facet ordering,
            collapsed state)
                ↓
           NavLink Components
```

## Interactions

1. **Facet Collapse/Expand**: Click facet to toggle entity schemas visibility
2. **Hover States**: Left border accent appears on hover
3. **Customize Mode**: 
   - Settings icon in header toggles mode
   - Drag handles appear on facets
   - Drag to reorder facets
   - Auto-save on change
4. **Mobile**: Burger menu opens drawer with sidebar content
5. **Navigation**: All links redirect to `/` (placeholder)

## API Integration

Will integrate with existing backend APIs:

1. **Fetch Facets**: Get all facets with entity schemas
2. **Fetch Views**: Get user's saved views
3. **Update Facet Order**: Save reordered facets (customize mode)

API client already exists in `hooks/api.tsx`.

## Implementation Approach

### Phase 1: Storybook Stories (for approval)
1. Create Sidebar component with all visual elements
2. Create stories with fake data
3. Show all states: default, customize mode, collapsed/expanded
4. Test dark/light mode
5. Get user approval

### Phase 2: Application Integration
1. Update `_protected/route.tsx` to use new Sidebar
2. Hook up backend API calls
3. Implement state management for customize mode
4. Add mobile responsive drawer
5. Test TypeScript compilation and build

## Testing Strategy

- **No presentation/rendering tests** (as requested)
- **Functional tests** for:
  - Facet reordering logic
  - Collapse/expand state management
  - Data transformation from API to props

## Migration Notes

- Remove old `FacetSidebarContent` from `_protected/route.tsx`
- Keep `FacetSidebarProvider` context if needed for state
- Maintain existing API integration patterns
- Use existing `theme.ts` configuration

## Open Questions

✅ Customize mode approach → Settings icon in header  
✅ Navigation targets → All redirect to `/` for now  
✅ Entity schemas structure → Nested under facets  
✅ Views data source → Backend API  

## Success Criteria

1. ✅ Sidebar matches journal theme visual design
2. ✅ Works in both light and dark mode
3. ✅ Storybook stories show all states with fake data
4. ✅ Customize mode allows reordering facets
5. ✅ Mobile responsive with drawer
6. ✅ TypeScript compilation passes
7. ✅ Backend-driven data (facets, entity schemas, views)
8. ✅ All links redirect to `/`
