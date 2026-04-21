# App Frontend Guidelines

> Inherits from root `AGENTS.md`. Rules below are additive.

## Product Context

Ryot is a self-hosted personal tracker for people who want to own and reflect on their data. The UI should feel like a crafted personal journal — warm, calm, and confident — not a generic SaaS dashboard or flashy consumer app.

- **Typography**: Space Grotesk (headings), Outfit (body), IBM Plex Mono (technical values)
- **Colors**: Warm gold accents, warm stone neutrals. Dark mode: warm/stone-based, not blue-tinted. Light mode: warm off-whites, not sterile white
- **Density**: Compact and scannable; optimize for calm information density, not cramped. Accessibility baseline: WCAG AA
- **Platform nature**: Designs must work whether a user tracks one thing or many
- **Anti-patterns**: Avoid cold enterprise dashboards, social-feed aesthetics, novelty motion effects, and generic productivity-tool chrome

## Engineering Guardrails

### Type Safety

- Derive API types from `@ryot/generated/openapi/app-backend` via helpers in `src/lib/api/types.ts` (`ApiRequestBody`, `ApiResponseData`). Do not duplicate wire shapes manually.
- Before adding a new type, check if `z.infer`, `ReturnType`, `Pick`, `Omit`, indexed access, or an OpenAPI-derived type covers it first.

### Components

- **React props**: Use a single `props` parameter, not destructured arguments.

```typescript
function MyComponent(props: MyComponentProps) {
  return <div>{props.title}</div>;
}
```

### Styling

- **Prefer Mantine props over inline styles**: Use props like `c`, `bg`, `ff`, `fw`, `lh`, `ta`, `tt`, `maw`, `miw`, `pt`, `mt`, etc. instead of `style={{}}` where direct equivalents exist.
- **Keep inline styles for**: Properties without Mantine props (`flex`, `overflow`, `letterSpacing`, `whiteSpace`, gradients, complex borders, transitions).
- **Typography**: Use `ff="var(--mantine-headings-font-family)"` for headings, never hardcode font names.
- **Non-Mantine components**: Use inline styles for components from other libraries (e.g., TanStack Router `Link`).

### Routing And Data Loading

- **Router**: TanStack Router with file-based routing. Routes live in `src/routes/`. The route tree is auto-generated in `src/routeTree.gen.ts` — do not edit it manually.
- **Route guards**: Protected routes use `beforeLoad` for auth checks (see `src/routes/_protected/route.tsx`). Redirect unauthenticated users to `/start`.
- **Data fetching**: Use `openapi-react-query` (`src/hooks/api.tsx`) for type-safe queries and mutations. Call `apiClient.useQuery` and `apiClient.useMutation` — do not use raw `fetch` or `useEffect` for data loading.
- **Invalidation**: Call `queryClient.invalidateQueries` on mutation success to keep caches consistent.
- **State management**: Server state via TanStack Query; UI state via React Context (e.g., `TrackerSidebarProvider`). No external state library (Zustand, Jotai, etc.).
- **Auth**: `better-auth` client in `src/lib/auth.tsx` with session cookies.

### Tests

- Prefer shared setup/data fixtures over repeating inline builders across `src/**/*.test.*`.
- Put cross-feature frontend fixtures in `src/features/test-fixtures/`; keep feature-only fixtures in their feature directory until another domain needs them.
- Split fixture modules by ownership (`entities`, `events`, `saved-views`, `property-schemas`, etc.) instead of growing one generic helper file.
