# Tailwind/shadcn to Mantine v9 Migration Design

**Date:** 2026-03-03  
**Scope:** apps/app-frontend  
**Strategy:** Big Bang Migration

## Overview

Migrate the app-frontend from Tailwind CSS 4.2 + shadcn components to Mantine v9 (beta). This is a complete replacement of the styling system and UI component library. The app is small (17 TypeScript files, 5 shadcn components) making a clean, single-step migration the optimal approach.

## Goals

- Remove all Tailwind and shadcn dependencies
- Replace with Mantine v9 component library
- Remove custom CSS variables (sea-ink, lagoon, palm, etc.)
- Use Mantine's standard color scheme and theming
- Preserve dark mode support using Mantine's built-in system
- Clean up all unused files and dependencies

## Design Decisions

### 1. Migration Strategy: Big Bang

**Chosen Approach:** Complete migration in one changeset

**Rationale:**
- App has only 17 TypeScript files and 5 components
- Avoiding bundle bloat from running two styling systems
- Clean finish line with no mixed paradigms
- Easier to verify completion

**Rejected Alternatives:**
- Gradual migration: Unnecessary complexity for small codebase
- Hybrid approach: Goes against goal to fully remove Tailwind

### 2. Dependencies

**Remove:**
```json
{
  "tailwindcss": "4.2.1",
  "@tailwindcss/vite": "4.2.1", 
  "@tailwindcss/typography": "0.5.19",
  "tailwind-merge": "3.5.0",
  "tw-animate-css": "1.4.0",
  "class-variance-authority": "0.7.1",
  "clsx": "2.1.1",
  "radix-ui": "1.4.3"
}
```

**Add:**
```json
{
  "@mantine/core": "9.0.0-beta.22",
  "@mantine/hooks": "9.0.0-beta.22",
  "postcss": "8.4.49",
  "postcss-preset-mantine": "1.18.3"
}
```

### 3. Component Mapping

| shadcn Component | Mantine v9 Equivalent | Notes |
|-----------------|----------------------|-------|
| Button | `@mantine/core/Button` | Similar variant API |
| Card | `@mantine/core/Card` | Use Card.Section for sections |
| Input | `@mantine/core/TextInput` or `Input` | TextInput for labeled inputs |
| Label | `@mantine/core/Label` | Standalone label component |
| Tabs | `@mantine/core/Tabs` | Compound component with Tabs.List, Tabs.Tab, Tabs.Panel |

**Strategy:** Delete entire `src/components/ui/` directory and import Mantine components directly. No wrapper components needed.

### 4. Styling Approach

**Combination Strategy:**
- **CSS Modules:** For complex component styles, layouts, animations
- **Inline styles:** For simple one-off styles
- **Mantine props:** Use built-in props (p, m, c, bg, etc.) where available

**Common Tailwind → Mantine Conversions:**

| Tailwind Pattern | Mantine Equivalent |
|-----------------|-------------------|
| `flex`, `grid` | `<Group>`, `<Stack>`, `<Grid>`, `<Flex>` |
| `px-4`, `py-2` | `px={16}`, `py={8}` props |
| `gap-3` | `gap="md"` prop |
| `text-sm` | `<Text size="sm">` |
| `font-bold` | `fw={700}` or `fw="bold"` |
| `rounded-md` | `radius="md"` |
| `bg-primary` | `bg="blue"` or theme color |

### 5. Theme Configuration

**Font:** Keep Manrope font family (already in use)

**Colors:** Use Mantine's default color palette (no custom CSS variables)

**Dark Mode:** 
- Use Mantine's `ColorSchemeScript` for SSR
- `useMantineColorScheme()` hook for theme toggling
- Mantine auto-handles dark mode for all components

**Theme Object:**
```typescript
{
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'Manrope, sans-serif',
}
```

### 6. Root Setup

**`__root.tsx` changes:**
- Wrap app with `<MantineProvider>`
- Add `<ColorSchemeScript />` in document head
- Configure theme
- Set up color scheme provider

**`src/styles.css` changes:**
- Keep Google Fonts import for Manrope
- Add `@import '@mantine/core/styles.css';`
- Remove all custom CSS variables
- Remove all Tailwind imports

### 7. Files to Clean Up

**Delete:**
- `components.json` (shadcn config)
- `src/components/ui/` (entire directory)
- `src/lib/utils.ts` (cn utility for Tailwind)

**Update:**
- `src/styles.css` (replace content)
- `vite.config.ts` (remove tailwindcss plugin)
- `package.json` (dependencies)
- All route files (convert Tailwind classes)
- `src/router.tsx` (if has styling)

**Keep unchanged:**
- `src/hooks/` (business logic)
- `src/lib/api/` (API client)
- Build configs (tsconfig.json, etc.)

## Verification Strategy

1. **Type checking:** `bun run turbo typecheck`
2. **Build:** `bun run turbo build --filter=@ryot/app-frontend`
3. **Visual testing:** Start dev server, check all pages
4. **Dark mode:** Verify theme toggle works

## Rollback Plan

If critical issues arise, `git revert` the migration commit. Small codebase makes rollback straightforward.

## Non-Goals

- No custom color system migration (using Mantine defaults)
- No wrapper components (use Mantine directly)
- No preservation of exact visual appearance (expect minor differences)

## Success Criteria

- ✅ No Tailwind dependencies in package.json
- ✅ No shadcn components in codebase
- ✅ No Tailwind classes in any file
- ✅ TypeScript compiles without errors
- ✅ Build succeeds
- ✅ Dark mode works
- ✅ All pages render without errors
