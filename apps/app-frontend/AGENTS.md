# App Frontend Guidelines

> Inherits from root `AGENTS.md`. Rules below are additive.

## Product Context

Ryot is a self-hosted personal tracker. The UI should feel like a crafted personal journal — warm, calm, and confident — not a generic SaaS dashboard.

- **Typography**: Space Grotesk (headings), Outfit (body), IBM Plex Mono (technical values)
- **Colors**: Warm gold accents, warm stone neutrals. Dark mode: warm/stone-based, not blue-tinted
- **Density**: Compact and scannable. Accessibility baseline: WCAG AA
- **Anti-patterns**: Avoid cold enterprise dashboards, social-feed aesthetics, novelty motion effects

## Engineering Guardrails

### Type Safety

- Derive API types from `@ryot/generated/openapi/app-backend` via helpers in `src/lib/api/types.ts` (`ApiRequestBody`, `ApiResponseData`). Do not duplicate wire shapes.
- Before adding a type, check if `z.infer`, `ReturnType`, `Pick`, `Omit`, indexed access, or an OpenAPI-derived type covers it.

### Components

- **React props**: Use a single `props` parameter, not destructured arguments.

```typescript
function MyComponent(props: MyComponentProps) {
  return <div>{props.title}</div>;
}
```

### Styling

- **Prefer Mantine props** (`c`, `bg`, `ff`, `fw`, `ta`, `tt`, `maw`, `pt`, `mt`, etc.) over `style={{}}`.
- **Inline styles for**: Properties without Mantine props (`flex`, `overflow`, `letterSpacing`, gradients, transitions).
- **Typography**: Use `ff="var(--mantine-headings-font-family)"` for headings.
- **Non-Mantine components**: Use inline styles for other libraries (e.g., TanStack Router `Link`).

### Routing And Data Loading

- **Router**: TanStack Router, file-based. Routes in `src/routes/`, auto-generated tree in `src/routeTree.gen.ts` — do not edit manually.
- **Route guards**: `beforeLoad` for auth checks (see `src/routes/_protected/route.tsx`).
- **Data fetching**: `openapi-react-query` via `apiClient.useQuery`/`apiClient.useMutation` (`src/hooks/api.tsx`). No raw `fetch` or `useEffect` for data loading.
- **State**: Server state via TanStack Query; UI state via React Context. No Zustand/Jotai.
- **Auth**: `better-auth` client in `src/lib/auth.tsx`.

### Tests

- Shared fixtures in `src/features/test-fixtures/`; feature-only fixtures stay in their feature directory.
- Split fixture modules by ownership, not one generic file.
