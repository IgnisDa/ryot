# Mantine to Reshaped Migration Design

**Date:** 2026-03-01  
**Status:** Approved  
**Approach:** Direct Component Replacement

## Overview

This document outlines the design for migrating the @ryot/app-frontend application from Mantine v9.0.0-alpha.2 to Reshaped. The migration will be a complete replacement of all Mantine components with Reshaped equivalents, embracing Reshaped's design language and default theme.

## Goals

1. Remove all Mantine dependencies from app-frontend
2. Replace all Mantine components with Reshaped equivalents
3. Adopt Reshaped's design system and visual language
4. Maintain existing functionality and user workflows
5. Complete migration in a single change (no mixed dependencies)

## Non-Goals

1. Preserving exact pixel-perfect visual appearance
2. Running both libraries side-by-side
3. Creating a full component abstraction layer
4. Migrating other apps in the monorepo

## Current State Analysis

### Mantine Footprint

**Dependencies:**
- `@mantine/core`: 9.0.0-alpha.2
- `@mantine/hooks`: 9.0.0-alpha.2
- `postcss-preset-mantine`: 1.18.0
- `postcss-simple-vars`: 7.0.1

**Components in Use:**
- Layout: Box, Container, Stack, Group, SimpleGrid
- Typography: Text, Title
- Forms: TextInput, Textarea, Select, NumberInput, Slider, Switch, Button
- Display: Card, Badge, Image, Alert, Loader, Anchor

**Files Using Mantine:**
1. `src/routes/__root.tsx` - MantineProvider setup
2. `src/routes/index.tsx` - Box, Container, Button
3. `src/routes/playground.tsx` - Box, Container, Stack, Group, Card, SimpleGrid, Text, Title, Textarea, Button
4. `src/routes/schema-search.tsx` - All form components, cards, images, badges
5. `src/routes/entities.$entityId.tsx` - Full display components
6. `src/components/demo.FormComponents.tsx` - Form wrapper components
7. `src/styles.css` - Mantine CSS import

**Build Configuration:**
- `postcss.config.cjs` - Mantine PostCSS preset
- `vite.config.ts` - No Mantine-specific config
- `package.json` - Dependencies listed above

## Architecture & Dependencies

### Dependencies to Remove

```json
{
  "@mantine/core": "9.0.0-alpha.2",
  "@mantine/hooks": "9.0.0-alpha.2",
  "postcss-preset-mantine": "1.18.0",
  "postcss-simple-vars": "7.0.1"
}
```

### Dependencies to Add

```json
{
  "reshaped": "latest"
}
```

Installation command: `bun add -E reshaped --filter=@ryot/app-frontend`

### Build Configuration Changes

**Delete:**
- `postcss.config.cjs` (Mantine PostCSS configuration)

**Create:**
- `postcss.config.js` with Reshaped PostCSS config:
```javascript
export { config as default } from "reshaped/config/postcss.js"
```

**Update:**
- `styles.css`: Replace Mantine CSS import with Reshaped theme:
```css
/* Before */
@import "@mantine/core/styles.css";

/* After */
@import "reshaped/themes/reshaped/theme.css";
```

**No changes needed:**
- `vite.config.ts` - Works with PostCSS config out of the box

### Provider Setup

**In `__root.tsx`:**

```typescript
// Before
import { ColorSchemeScript, MantineProvider } from "@mantine/core";

<head>
  <ColorSchemeScript />
  <HeadContent />
</head>
<body>
  <MantineProvider>
    {props.children}
  </MantineProvider>
</body>

// After
import { Reshaped } from "reshaped";

<head>
  <HeadContent />
</head>
<body>
  <Reshaped theme="reshaped">
    {props.children}
  </Reshaped>
</body>
```

## Component Mapping

### Layout Components

| Mantine | Reshaped | Notes |
|---------|----------|-------|
| `Box` | `View` | Universal layout primitive with flexbox props |
| `Stack` | `View` with `direction="column"` | Use `gap` for spacing |
| `Group` | `View` with `direction="row"` | Use `gap` for spacing |
| `Container` | `Container` | Direct equivalent |
| `SimpleGrid` | `Grid` or `View` with columns | Use `View.Item` with `columns` prop |

### Typography Components

| Mantine | Reshaped | Notes |
|---------|----------|-------|
| `Title order={2}` | `Text variant="title-2"` | Variants: title-1 through title-6 |
| `Title order={4}` | `Text variant="title-4"` | Use `as="h4"` for semantic HTML |
| `Text` | `Text variant="body-2"` | Variants: body-1, body-2, body-3 |
| `Text c="dimmed"` | `Text color="neutral-faded"` | Semantic color tokens |
| `Text fw="bold"` | `Text weight="bold"` | Weight property |
| `Text size="sm"` | `Text variant="caption-1"` | Smaller text variants |

### Form Components

| Mantine | Reshaped | Notes |
|---------|----------|-------|
| `TextInput` | `TextField` | Direct equivalent |
| `Textarea` | `TextArea` | Direct equivalent |
| `Select` | `Select` | Direct equivalent |
| `NumberInput` | `NumberField` | Direct equivalent |
| `Slider` | `Slider` | Direct equivalent |
| `Switch` | `Switch` | Direct equivalent |
| `Button` | `Button` | Direct equivalent |

### Display Components

| Mantine | Reshaped | Notes |
|---------|----------|-------|
| `Card` | `Card` | Use `View` with `borderColor` instead of `withBorder` |
| `Badge` | `Badge` | `variant="light"` becomes `variant="faded"` |
| `Image` | `Image` | Direct equivalent |
| `Alert` | `Alert` | Direct equivalent |
| `Loader` | `Loader` | Direct equivalent |
| `Anchor` | `Link` | Direct equivalent |

### Spacing & Layout Patterns

**Mantine uses string tokens, Reshaped uses numeric multipliers (base unit: 4px):**

| Mantine | Reshaped | Pixels |
|---------|----------|--------|
| `gap="xs"` | `gap={2}` | 8px |
| `gap="sm"` | `gap={3}` | 12px |
| `gap="md"` | `gap={4}` | 16px |
| `gap="lg"` | `gap={6}` | 24px |
| `py="xl"` | `paddingBlock={8}` | 32px |
| `mt={4}` | `marginTop` not supported | Use wrapper View with gap |

**Common pattern transformations:**

```typescript
// Stack pattern
// Before
<Stack gap="lg">
  <Text>Item 1</Text>
  <Text>Item 2</Text>
</Stack>

// After
<View gap={6}>
  <Text>Item 1</Text>
  <Text>Item 2</Text>
</View>

// Group pattern
// Before
<Group gap="xs">
  <Badge>Tag 1</Badge>
  <Badge>Tag 2</Badge>
</Group>

// After
<View direction="row" gap={2}>
  <Badge>Tag 1</Badge>
  <Badge>Tag 2</Badge>
</View>

// Card pattern
// Before
<Card withBorder radius="md" padding="md">
  <Title order={4}>Title</Title>
</Card>

// After
<Card padding={4}>
  <View borderColor="neutral-faded" borderRadius="medium">
    <Text variant="title-4" as="h4">Title</Text>
  </View>
</Card>
```

## Migration Workflow

### Phase 1: Infrastructure Setup

**Priority:** Critical - must be done first

1. Install Reshaped dependency
   - Command: `bun add -E reshaped --filter=@ryot/app-frontend`
   
2. Update PostCSS configuration
   - Delete `postcss.config.cjs`
   - Create `postcss.config.js` with Reshaped config
   
3. Update styles
   - Modify `styles.css` to import Reshaped theme
   
4. Update root provider
   - Replace MantineProvider with Reshaped provider in `__root.tsx`
   - Remove ColorSchemeScript
   
5. Remove Mantine dependencies
   - Command: `bun remove @mantine/core @mantine/hooks postcss-preset-mantine postcss-simple-vars --filter=@ryot/app-frontend`

### Phase 2: Component Migration

**Order: Simple to Complex**

1. **Form component wrappers** (`components/demo.FormComponents.tsx`)
   - Update imports from `@mantine/core` to `reshaped`
   - Update component implementations to use Reshaped equivalents
   - Update error message styling (Text color="critical")
   
2. **Simple page** (`routes/index.tsx`)
   - Replace Box → View
   - Replace Container → Container (keep as-is)
   - Replace Button → Button (keep as-is mostly)
   - Update inline styles to use View props
   
3. **Moderate page** (`routes/playground.tsx`)
   - Replace layout components (Box, Stack, Group)
   - Replace Card with borderColor instead of withBorder
   - Replace SimpleGrid → Grid or View with columns
   - Update Text and Title to Text with variants
   - Replace Textarea → TextArea
   
4. **Complex form page** (`routes/schema-search.tsx`)
   - All form inputs (TextInput, NumberInput, Select)
   - Layout components (Box, Container, Stack, Group)
   - Display components (Card, Badge, Image, Alert, Loader)
   - Update spacing throughout
   
5. **Complex display page** (`routes/entities.$entityId.tsx`)
   - All display components
   - Complex layouts with nested Stack/Group
   - Images, badges, links, cards
   - Conditional rendering patterns

### Phase 3: Verification

1. Run type checking: `bun run turbo typecheck --filter=@ryot/app-frontend`
2. Run build: `bun run turbo build --filter=@ryot/app-frontend`
3. Start dev server and manually test each page
4. Verify no console errors or warnings

## File-by-File Changes

### `postcss.config.js` (new file)

```javascript
export { config as default } from "reshaped/config/postcss.js";
```

### `src/styles.css`

```css
@import "reshaped/themes/reshaped/theme.css";

body {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu",
    "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### `src/routes/__root.tsx`

- Remove `ColorSchemeScript` import and usage
- Replace `MantineProvider` with `Reshaped` provider
- Import from `reshaped` instead of `@mantine/core`

### `src/components/demo.FormComponents.tsx`

- Update all imports from `@mantine/core` to `reshaped`
- `TextInput` → `TextField`
- `Textarea` → `TextArea`
- `Select` → `Select` (same name, different import)
- `Slider` → `Slider` (same name, different import)
- `Switch` → `Switch` (same name, different import)
- `Text` → `Text` (update color props to use tokens)
- Rename aliased imports to avoid conflicts

### `src/routes/index.tsx`

- Replace `Box` with `View`
- Keep `Container` as-is
- Keep `Button` mostly as-is
- Update inline styles to View props

### `src/routes/playground.tsx`

- Replace all layout components (Box, Stack, Group, Card, SimpleGrid)
- Update Text and Title with variant props
- Update spacing to numeric values
- Replace Textarea → TextArea

### `src/routes/schema-search.tsx`

- Replace all components following the mapping table
- Update form inputs (TextInput, NumberInput, Select)
- Update display components (Card, Badge, Image, Alert, Loader)
- Update all layout components

### `src/routes/entities.$entityId.tsx`

- Replace all components following the mapping table
- Update complex nested layouts
- Update images, badges, links, anchors
- Preserve all data transformation logic

## Risk Mitigation

### Breaking Changes

**Risk:** Reshaped API differences cause runtime errors  
**Mitigation:** Type checking will catch most issues during migration

**Risk:** Visual regressions in production  
**Mitigation:** Manual testing of all pages before committing

**Risk:** Missing Reshaped components for Mantine equivalents  
**Mitigation:** Component mapping verified against Reshaped docs

### Performance Considerations

**Bundle Size:**
- Removing Mantine alpha (~200KB gzipped estimated)
- Adding Reshaped (~150KB gzipped estimated)
- Net improvement expected

**Runtime Performance:**
- Both libraries are performant
- Reshaped uses CSS-in-JS, similar to Mantine

### Rollback Plan

If critical issues are discovered:
1. Revert the migration commit
2. Run `bun install` to restore Mantine dependencies
3. Investigation can happen in a separate branch

## Success Criteria

1. ✅ All Mantine dependencies removed from package.json
2. ✅ No Mantine imports in any source files
3. ✅ `bun run turbo typecheck` passes
4. ✅ `bun run turbo build` succeeds
5. ✅ All pages render without console errors
6. ✅ All interactive elements function correctly
7. ✅ Forms submit and validate properly

## Future Considerations

### Theming

Currently using Reshaped's default theme. Future enhancements could include:
- Custom theme with brand colors
- Dark mode support using Reshaped's theme system
- Theme tokens exported for use in other apps

### Component Library

If other apps need to migrate, consider:
- Creating shared component wrappers
- Extracting common patterns
- Building a unified design system layer

### Documentation

Update any developer documentation that references Mantine:
- Component examples
- Styling guidelines
- Form patterns

## References

- [Reshaped Documentation](https://www.reshaped.so/docs/getting-started/overview)
- [Reshaped Vite Integration](https://www.reshaped.so/docs/getting-started/integrations/vite)
- [Reshaped View Component](https://www.reshaped.so/docs/utilities/view)
- [Reshaped Text Component](https://www.reshaped.so/docs/utilities/text)
- [Reshaped Button Component](https://www.reshaped.so/docs/components/button)
