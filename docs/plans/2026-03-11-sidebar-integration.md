# Sidebar Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a journal theme sidebar component with Storybook stories, then integrate it into the application with backend API data.

**Architecture:** Build a presentational Sidebar component that accepts data via props (facets with entity schemas, saved views, customize mode state). Create comprehensive Storybook stories with fake data for approval. After approval, integrate into `_protected/route.tsx` by fetching data from existing backend APIs.

**Tech Stack:** React, TypeScript, Mantine UI, TanStack Router, Storybook, @dnd-kit/sortable (drag-and-drop)

---

## Phase 1: Storybook Component (For Approval)

### Task 1: Install dependencies

**Files:**
- Modify: `apps/app-frontend/package.json`

**Step 1: Install drag-and-drop library**

Run: `cd apps/app-frontend && bun add -E @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities lucide-react`

**Step 2: Verify installation**

Run: `cd apps/app-frontend && bun install`
Expected: Dependencies installed successfully

**Step 3: Commit**

```bash
git add apps/app-frontend/package.json apps/app-frontend/bun.lockb
git commit -m "deps: add dnd-kit and lucide-react for sidebar

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 2: Create Sidebar types

**Files:**
- Create: `apps/app-frontend/src/components/Sidebar.types.ts`

**Step 1: Write types file**

Create file with these interfaces:

```typescript
export interface SidebarEntitySchema {
	id: string;
	name: string;
	slug: string;
}

export interface SidebarFacet {
	id: string;
	slug: string;
	name: string;
	enabled: boolean;
	sortOrder: number;
	icon?: string | null;
	accentColor?: string | null;
	entitySchemas: SidebarEntitySchema[];
}

export interface SidebarView {
	id: string;
	name: string;
	slug: string;
}

export interface SidebarProps {
	facets: SidebarFacet[];
	views: SidebarView[];
	colorScheme: 'light' | 'dark';
	isCustomizeMode: boolean;
	onToggleCustomize: () => void;
	onReorderFacets: (facets: SidebarFacet[]) => void;
	onNavigate?: (path: string) => void;
}
```

**Step 2: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.types.ts
git commit -m "feat: add sidebar type definitions

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 3: Create Sidebar component

**Files:**
- Create: `apps/app-frontend/src/components/Sidebar.tsx`

**Step 1: Create component file with header and search**

```typescript
import { Box, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Home, Search, Settings } from "lucide-react";
import { useState } from "react";
import type { SidebarProps } from "./Sidebar.types";

export function Sidebar(props: SidebarProps) {
	const isDark = props.colorScheme === "dark";
	const [collapsedFacets, setCollapsedFacets] = useState<Set<string>>(new Set());

	const bg = isDark ? "dark.8" : "white";
	const border = isDark ? "var(--mantine-color-dark-6)" : "var(--mantine-color-stone-3)";
	const borderAccent = "var(--mantine-color-accent-5)";
	const textPrimary = isDark ? "dark.0" : "dark.9";
	const textMuted = isDark ? "dark.4" : "stone.5";
	const surfaceHover = isDark ? "dark.7" : "stone.1";

	const handleNavigate = (path: string) => {
		props.onNavigate?.(path);
	};

	const toggleFacet = (facetId: string) => {
		setCollapsedFacets((prev) => {
			const next = new Set(prev);
			if (next.has(facetId)) {
				next.delete(facetId);
			} else {
				next.add(facetId);
			}
			return next;
		});
	};

	return (
		<Stack gap={0} h="100%" bg={bg}>
			{/* Header */}
			<Box p="xl" pb="lg">
				<Group gap="sm" mb={4} justify="space-between">
					<Group gap="sm">
						<Box
							w={32}
							h={32}
							style={{
								borderRadius: 6,
								background: "linear-gradient(135deg, #D4A574 0%, #C4963C 100%)",
								display: "grid",
								placeItems: "center",
							}}
						>
							<Text
								size="md"
								fw={700}
								c="white"
								style={{ fontFamily: '"Space Grotesk", sans-serif' }}
							>
								R
							</Text>
						</Box>
						<Text
							size="xl"
							fw={600}
							c={textPrimary}
							style={{ fontFamily: '"Space Grotesk", sans-serif' }}
						>
							Ryot
						</Text>
					</Group>
					<Button
						size="xs"
						variant={props.isCustomizeMode ? "filled" : "subtle"}
						color="accent"
						onClick={props.onToggleCustomize}
						leftSection={<Settings size={14} />}
					>
						{props.isCustomizeMode ? "Save" : "Customize"}
					</Button>
				</Group>
				<Text size="xs" c={textMuted} style={{ letterSpacing: "0.3px" }}>
					A journal of personal tracking
				</Text>
			</Box>

			{/* Search */}
			<Box px="lg" pb="md">
				<TextInput
					placeholder="Search..."
					leftSection={<Search size={16} color={borderAccent} />}
					size="sm"
					styles={{
						input: {
							backgroundColor: isDark
								? "var(--mantine-color-dark-7)"
								: "var(--mantine-color-stone-1)",
							border: `1px solid ${border}`,
							fontWeight: 400,
							fontSize: "13px",
							"&:focus": {
								borderColor: borderAccent,
								boxShadow: "0 0 0 2px rgba(212, 165, 116, 0.15)",
							},
							"&::placeholder": {
								color: isDark
									? "var(--mantine-color-dark-4)"
									: "var(--mantine-color-stone-4)",
							},
						},
					}}
				/>
			</Box>

			<Box h={1} mx="lg" style={{ backgroundColor: border }} />

			{/* Navigation - will be completed in next steps */}
			<Stack gap={0} px="sm" py="md" style={{ flex: 1, overflowY: "auto" }}>
				<Text>Navigation content here</Text>
			</Stack>
		</Stack>
	);
}
```

**Step 2: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.tsx
git commit -m "feat: add sidebar component with header and search

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 4: Add Home navigation and section headers

**Files:**
- Modify: `apps/app-frontend/src/components/Sidebar.tsx`

**Step 1: Import NavLink**

Add to imports:
```typescript
import { Box, Button, Group, NavLink, Stack, Text, TextInput } from "@mantine/core";
```

**Step 2: Replace navigation placeholder**

Replace the "Navigation content here" section with:

```typescript
{/* Home Link */}
<NavLink
	label="Home"
	leftSection={<Home size={18} color={borderAccent} />}
	onClick={() => handleNavigate("/")}
	styles={{
		root: {
			padding: "10px 14px",
			borderLeft: "2px solid transparent",
			"&:hover": {
				backgroundColor: "rgba(212, 165, 116, 0.06)",
				borderLeftColor: borderAccent,
			},
		},
		label: { fontWeight: 500, fontSize: "14px" },
	}}
/>

{/* Facets Section Header */}
<Box mt="xl" mb="sm">
	<Box
		px="md"
		py="xs"
		style={{ borderLeft: `2px solid ${borderAccent}` }}
	>
		<Text
			size="xs"
			c={textMuted}
			fw={600}
			style={{
				fontFamily: '"Space Grotesk", sans-serif',
				letterSpacing: "1px",
				textTransform: "uppercase",
			}}
		>
			Facets
		</Text>
	</Box>
</Box>

{/* Facets list - will be added next */}
<Text size="sm">Facets will go here</Text>

{/* Views Section Header */}
<Box mt="xl" mb="sm">
	<Box px="md" py="xs" style={{ borderLeft: `2px solid ${border}` }}>
		<Text
			size="xs"
			c={textMuted}
			fw={600}
			style={{
				fontFamily: '"Space Grotesk", sans-serif',
				letterSpacing: "1px",
				textTransform: "uppercase",
			}}
		>
			Views
		</Text>
	</Box>
</Box>

{/* Views list - will be added next */}
<Text size="sm">Views will go here</Text>
```

**Step 3: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.tsx
git commit -m "feat: add home link and section headers to sidebar

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 5: Add facets navigation with icon support

**Files:**
- Modify: `apps/app-frontend/src/components/Sidebar.tsx`

**Step 1: Import icon utilities**

Add imports:
```typescript
import { BookOpen, ChevronDown, ChevronRight, Film } from "lucide-react";
import * as LucideIcons from "lucide-react";
```

**Step 2: Add icon resolver function**

Add before the component:

```typescript
function getIconComponent(iconName?: string | null): React.ElementType {
	if (!iconName) return Film;
	const Icon = (LucideIcons as Record<string, React.ElementType>)[iconName];
	return Icon || Film;
}
```

**Step 3: Replace facets placeholder**

Replace "Facets will go here" with:

```typescript
{props.facets.filter((f) => f.enabled).map((facet) => {
	const isCollapsed = collapsedFacets.has(facet.id);
	const Icon = getIconComponent(facet.icon);
	const color = facet.accentColor || "#5B7FFF";
	const hasSchemas = facet.entitySchemas.length > 0;

	return (
		<NavLink
			key={facet.id}
			label={facet.name}
			leftSection={<Icon size={18} color={color} />}
			rightSection={
				hasSchemas ? (
					isCollapsed ? (
						<ChevronRight size={16} />
					) : (
						<ChevronDown size={16} />
					)
				) : null
			}
			opened={!isCollapsed}
			onClick={() => hasSchemas && toggleFacet(facet.id)}
			styles={{
				root: {
					padding: "10px 14px",
					borderLeft: "2px solid transparent",
					"&:hover": {
						backgroundColor: `${color}15`,
						borderLeftColor: color,
					},
				},
				label: { fontWeight: 500, fontSize: "14px" },
			}}
		>
			{!isCollapsed &&
				facet.entitySchemas.map((schema) => (
					<NavLink
						key={schema.id}
						label={schema.name}
						onClick={() => handleNavigate(`/${facet.slug}/${schema.slug}`)}
						styles={{
							root: {
								paddingLeft: "40px",
								"&:hover": { backgroundColor: `${color}10` },
							},
							label: {
								fontWeight: 400,
								fontSize: "13px",
								color: isDark
									? "var(--mantine-color-dark-2)"
									: "var(--mantine-color-dark-6)",
							},
						}}
					/>
				))}
		</NavLink>
	);
})}
```

**Step 4: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.tsx
git commit -m "feat: add facets navigation with collapsible entity schemas

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 6: Add views navigation

**Files:**
- Modify: `apps/app-frontend/src/components/Sidebar.tsx`

**Step 1: Replace views placeholder**

Replace "Views will go here" with:

```typescript
{props.views.map((view) => (
	<NavLink
		key={view.id}
		label={view.name}
		leftSection={<BookOpen size={16} color={borderAccent} />}
		onClick={() => handleNavigate(`/views/${view.slug}`)}
		styles={{
			root: {
				padding: "8px 14px",
				borderLeft: "2px solid transparent",
				"&:hover": {
					backgroundColor: "rgba(212, 165, 116, 0.06)",
					borderLeftColor: borderAccent,
				},
			},
			label: {
				fontWeight: 400,
				fontSize: "13px",
				color: isDark
					? "var(--mantine-color-dark-2)"
					: "var(--mantine-color-dark-6)",
			},
		}}
	/>
))}
```

**Step 2: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.tsx
git commit -m "feat: add views navigation to sidebar

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 7: Add drag-and-drop for customize mode

**Files:**
- Modify: `apps/app-frontend/src/components/Sidebar.tsx`

**Step 1: Import dnd-kit**

Add imports:
```typescript
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
```

**Step 2: Add SortableFacetItem component**

Add before Sidebar component:

```typescript
function SortableFacetItem(props: {
	facet: SidebarProps["facets"][0];
	isCustomizeMode: boolean;
	isCollapsed: boolean;
	onToggle: () => void;
	onNavigate: (path: string) => void;
	isDark: boolean;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: props.facet.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	const Icon = getIconComponent(props.facet.icon);
	const color = props.facet.accentColor || "#5B7FFF";
	const hasSchemas = props.facet.entitySchemas.length > 0;

	return (
		<div ref={setNodeRef} style={style}>
			<NavLink
				label={
					<Group gap="xs">
						{props.isCustomizeMode && (
							<Box
								{...attributes}
								{...listeners}
								style={{ cursor: "grab", display: "flex" }}
							>
								<GripVertical size={16} />
							</Box>
						)}
						<Text>{props.facet.name}</Text>
					</Group>
				}
				leftSection={<Icon size={18} color={color} />}
				rightSection={
					hasSchemas ? (
						props.isCollapsed ? (
							<ChevronRight size={16} />
						) : (
							<ChevronDown size={16} />
						)
					) : null
				}
				opened={!props.isCollapsed}
				onClick={() => hasSchemas && props.onToggle()}
				styles={{
					root: {
						padding: "10px 14px",
						borderLeft: "2px solid transparent",
						"&:hover": {
							backgroundColor: `${color}15`,
							borderLeftColor: color,
						},
					},
					label: { fontWeight: 500, fontSize: "14px" },
				}}
			>
				{!props.isCollapsed &&
					props.facet.entitySchemas.map((schema) => (
						<NavLink
							key={schema.id}
							label={schema.name}
							onClick={() =>
								props.onNavigate(`/${props.facet.slug}/${schema.slug}`)
							}
							styles={{
								root: {
									paddingLeft: "40px",
									"&:hover": { backgroundColor: `${color}10` },
								},
								label: {
									fontWeight: 400,
									fontSize: "13px",
									color: props.isDark
										? "var(--mantine-color-dark-2)"
										: "var(--mantine-color-dark-6)",
								},
							}}
						/>
					))}
			</NavLink>
		</div>
	);
}
```

**Step 3: Update Sidebar component to use DndContext**

Add sensors at the start of Sidebar component:

```typescript
const sensors = useSensors(
	useSensor(PointerSensor),
	useSensor(KeyboardSensor, {
		coordinateGetter: sortableKeyboardCoordinates,
	}),
);

const handleDragEnd = (event: DragEndEvent) => {
	const { active, over } = event;
	if (!over || active.id === over.id) return;

	const oldIndex = props.facets.findIndex((f) => f.id === active.id);
	const newIndex = props.facets.findIndex((f) => f.id === over.id);

	const reordered = [...props.facets];
	const [moved] = reordered.splice(oldIndex, 1);
	reordered.splice(newIndex, 0, moved);

	const updated = reordered.map((f, idx) => ({ ...f, sortOrder: idx }));
	props.onReorderFacets(updated);
};
```

**Step 4: Wrap facets list in DndContext**

Replace facets map with:

```typescript
<DndContext
	sensors={sensors}
	collisionDetection={closestCenter}
	onDragEnd={handleDragEnd}
>
	<SortableContext
		items={props.facets.filter((f) => f.enabled).map((f) => f.id)}
		strategy={verticalListSortingStrategy}
	>
		{props.facets.filter((f) => f.enabled).map((facet) => (
			<SortableFacetItem
				key={facet.id}
				facet={facet}
				isCustomizeMode={props.isCustomizeMode}
				isCollapsed={collapsedFacets.has(facet.id)}
				onToggle={() => toggleFacet(facet.id)}
				onNavigate={handleNavigate}
				isDark={isDark}
			/>
		))}
	</SortableContext>
</DndContext>
```

**Step 5: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.tsx
git commit -m "feat: add drag-and-drop reordering for customize mode

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 8: Export Sidebar from components index

**Files:**
- Modify: `apps/app-frontend/src/components/index.ts`

**Step 1: Add exports**

Add to file:
```typescript
export { Sidebar } from "./Sidebar";
export type { SidebarProps, SidebarFacet, SidebarView, SidebarEntitySchema } from "./Sidebar.types";
```

**Step 2: Commit**

```bash
git add apps/app-frontend/src/components/index.ts
git commit -m "feat: export Sidebar component and types

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 9: Create Sidebar Storybook stories

**Files:**
- Create: `apps/app-frontend/src/components/Sidebar.stories.tsx`

**Step 1: Create stories file with fake data**

```typescript
import type React from "react";
import { useState } from "react";
import preview from "#.storybook/preview";
import { Sidebar } from "./Sidebar";
import type { SidebarFacet, SidebarView } from "./Sidebar.types";

const fakeFacets: SidebarFacet[] = [
	{
		id: "1",
		slug: "media",
		name: "Media",
		enabled: true,
		sortOrder: 0,
		icon: "Film",
		accentColor: "#5B7FFF",
		entitySchemas: [
			{ id: "1-1", name: "Movies", slug: "movies" },
			{ id: "1-2", name: "Books", slug: "books" },
			{ id: "1-3", name: "TV Shows", slug: "tv-shows" },
		],
	},
	{
		id: "2",
		slug: "fitness",
		name: "Fitness",
		enabled: true,
		sortOrder: 1,
		icon: "Dumbbell",
		accentColor: "#2DD4BF",
		entitySchemas: [
			{ id: "2-1", name: "Workouts", slug: "workouts" },
			{ id: "2-2", name: "Measurements", slug: "measurements" },
		],
	},
	{
		id: "3",
		slug: "whiskey",
		name: "Whiskey",
		enabled: true,
		sortOrder: 2,
		icon: "Wine",
		accentColor: "#D4A574",
		entitySchemas: [{ id: "3-1", name: "Whiskey", slug: "whiskey" }],
	},
	{
		id: "4",
		slug: "places",
		name: "Places",
		enabled: true,
		sortOrder: 3,
		icon: "MapPin",
		accentColor: "#A78BFA",
		entitySchemas: [{ id: "4-1", name: "Places", slug: "places" }],
	},
];

const fakeViews: SidebarView[] = [
	{ id: "v1", name: "Currently Reading", slug: "currently-reading" },
	{ id: "v2", name: "Watchlist", slug: "watchlist" },
	{ id: "v3", name: "Completed This Month", slug: "completed-this-month" },
];

const meta = preview.meta({
	title: "Components/Sidebar",
	component: Sidebar as React.ComponentType,
});

export const LightMode = meta.story({
	render: () => {
		const [isCustomizeMode, setIsCustomizeMode] = useState(false);
		const [facets, setFacets] = useState(fakeFacets);

		return (
			<div style={{ width: 300, height: "100vh", border: "1px solid #e0e0e0" }}>
				<Sidebar
					facets={facets}
					views={fakeViews}
					colorScheme="light"
					isCustomizeMode={isCustomizeMode}
					onToggleCustomize={() => setIsCustomizeMode(!isCustomizeMode)}
					onReorderFacets={setFacets}
					onNavigate={(path) => console.log("Navigate to:", path)}
				/>
			</div>
		);
	},
});

export const DarkMode = meta.story({
	render: () => {
		const [isCustomizeMode, setIsCustomizeMode] = useState(false);
		const [facets, setFacets] = useState(fakeFacets);

		return (
			<div style={{ width: 300, height: "100vh", border: "1px solid #333" }}>
				<Sidebar
					facets={facets}
					views={fakeViews}
					colorScheme="dark"
					isCustomizeMode={isCustomizeMode}
					onToggleCustomize={() => setIsCustomizeMode(!isCustomizeMode)}
					onReorderFacets={setFacets}
					onNavigate={(path) => console.log("Navigate to:", path)}
				/>
			</div>
		);
	},
});

export const CustomizeMode = meta.story({
	render: () => {
		const [facets, setFacets] = useState(fakeFacets);

		return (
			<div style={{ width: 300, height: "100vh", border: "1px solid #e0e0e0" }}>
				<Sidebar
					facets={facets}
					views={fakeViews}
					colorScheme="light"
					isCustomizeMode={true}
					onToggleCustomize={() => {}}
					onReorderFacets={(newFacets) => {
						console.log("Reordered:", newFacets.map((f) => f.name));
						setFacets(newFacets);
					}}
					onNavigate={(path) => console.log("Navigate to:", path)}
				/>
			</div>
		);
	},
});

export const EmptyState = meta.story({
	args: {
		facets: [],
		views: [],
		colorScheme: "light",
		isCustomizeMode: false,
		onToggleCustomize: () => {},
		onReorderFacets: () => {},
	},
	render: (args) => (
		<div style={{ width: 300, height: "100vh", border: "1px solid #e0e0e0" }}>
			<Sidebar {...args} />
		</div>
	),
});

export const WithoutEntitySchemas = meta.story({
	render: () => {
		const [isCustomizeMode, setIsCustomizeMode] = useState(false);
		const [facets, setFacets] = useState<SidebarFacet[]>([
			{
				id: "1",
				slug: "journals",
				name: "Journals",
				enabled: true,
				sortOrder: 0,
				icon: "BookOpen",
				accentColor: "#8B5CF6",
				entitySchemas: [],
			},
			{
				id: "2",
				slug: "notes",
				name: "Notes",
				enabled: true,
				sortOrder: 1,
				icon: "StickyNote",
				accentColor: "#F59E0B",
				entitySchemas: [],
			},
		]);

		return (
			<div style={{ width: 300, height: "100vh", border: "1px solid #e0e0e0" }}>
				<Sidebar
					facets={facets}
					views={fakeViews}
					colorScheme="light"
					isCustomizeMode={isCustomizeMode}
					onToggleCustomize={() => setIsCustomizeMode(!isCustomizeMode)}
					onReorderFacets={setFacets}
					onNavigate={(path) => console.log("Navigate to:", path)}
				/>
			</div>
		);
	},
});
```

**Step 2: Verify TypeScript compilation**

Run: `cd apps/app-frontend && bun run typecheck`
Expected: No type errors

**Step 3: Start Storybook to verify**

Run: `cd apps/app-frontend && bun run storybook`
Expected: Storybook opens, sidebar stories visible in both light/dark modes

**Step 4: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.stories.tsx
git commit -m "feat: add comprehensive Sidebar storybook stories

Stories include light/dark modes, customize mode, empty state, and various configurations with fake data.

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

## Phase 2: Application Integration (After Approval)

### Task 10: Create hooks for API data fetching

**Files:**
- Create: `apps/app-frontend/src/features/facets/hooks-sidebar.ts`

**Step 1: Create hooks file**

```typescript
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import type { SidebarFacet, SidebarView } from "#/components/Sidebar.types";
import type { AppEntitySchema } from "../entity-schemas/model";
import type { AppSavedView } from "../saved-views/model";

export function useSidebarFacets() {
	const client = useApiClient();

	return useQuery({
		queryKey: ["sidebar-facets"],
		queryFn: async (): Promise<SidebarFacet[]> => {
			const facetsRes = await client.GET("/facets/list");
			if (facetsRes.error) throw new Error("Failed to fetch facets");

			const facets = facetsRes.data.data;

			const facetsWithSchemas = await Promise.all(
				facets.map(async (facet) => {
					if (facet.isBuiltin) {
						return {
							...facet,
							entitySchemas: [],
						};
					}

					const schemasRes = await client.GET("/entity-schemas/list", {
						params: { query: { facetId: facet.id } },
					});

					const entitySchemas =
						schemasRes.data?.data.map((schema: AppEntitySchema) => ({
							id: schema.id,
							name: schema.name,
							slug: schema.slug,
						})) || [];

					return {
						...facet,
						entitySchemas,
					};
				}),
			);

			return facetsWithSchemas;
		},
	});
}

export function useSidebarViews() {
	const client = useApiClient();

	return useQuery({
		queryKey: ["sidebar-views"],
		queryFn: async (): Promise<SidebarView[]> => {
			const res = await client.GET("/saved-views");
			if (res.error) throw new Error("Failed to fetch views");

			return res.data.data.map((view: AppSavedView) => ({
				id: view.id,
				name: view.name,
				slug: view.name.toLowerCase().replace(/\s+/g, "-"),
			}));
		},
	});
}
```

**Step 2: Commit**

```bash
git add apps/app-frontend/src/features/facets/hooks-sidebar.ts
git commit -m "feat: add hooks for fetching sidebar data from API

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 11: Add reorder facets mutation

**Files:**
- Modify: `apps/app-frontend/src/features/facets/hooks-sidebar.ts`

**Step 1: Add mutation hook**

Add to end of file:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useReorderFacets() {
	const client = useApiClient();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (facets: SidebarFacet[]) => {
			const facetIds = facets.map((f) => f.id);
			const res = await client.POST("/facets/reorder", {
				body: { facetIds },
			});

			if (res.error) throw new Error("Failed to reorder facets");
			return res.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["sidebar-facets"] });
		},
	});
}
```

**Step 2: Commit**

```bash
git add apps/app-frontend/src/features/facets/hooks-sidebar.ts
git commit -m "feat: add mutation hook for reordering facets

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 12: Update _protected/route.tsx to use new Sidebar

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/route.tsx`

**Step 1: Update imports**

Replace existing imports with:

```typescript
import { Box, Flex } from "@mantine/core";
import { useColorScheme } from "@mantine/hooks";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Sidebar } from "#/components/Sidebar";
import type { SidebarFacet } from "#/components/Sidebar.types";
import {
	useSidebarFacets,
	useSidebarViews,
	useReorderFacets,
} from "#/features/facets/hooks-sidebar";
```

**Step 2: Replace RouteComponent**

Replace entire RouteComponent with:

```typescript
function RouteComponent() {
	const navigate = useNavigate();
	const colorScheme = useColorScheme();
	const [isCustomizeMode, setIsCustomizeMode] = useState(false);

	const { data: facets = [], isLoading: facetsLoading } = useSidebarFacets();
	const { data: views = [], isLoading: viewsLoading } = useSidebarViews();
	const reorderMutation = useReorderFacets();

	const handleReorderFacets = (reordered: SidebarFacet[]) => {
		reorderMutation.mutate(reordered);
	};

	const handleNavigate = (path: string) => {
		navigate({ to: "/" });
	};

	const isLoading = facetsLoading || viewsLoading;

	return (
		<Flex gap={0} h="100vh">
			<Box w="300px" style={{ flexShrink: 0, overflowY: "auto" }}>
				{!isLoading && (
					<Sidebar
						facets={facets}
						views={views}
						colorScheme={colorScheme}
						isCustomizeMode={isCustomizeMode}
						onToggleCustomize={() => setIsCustomizeMode(!isCustomizeMode)}
						onReorderFacets={handleReorderFacets}
						onNavigate={handleNavigate}
					/>
				)}
			</Box>

			<Box flex={1} p={16} style={{ overflowY: "auto" }}>
				<Outlet />
			</Box>
		</Flex>
	);
}
```

**Step 3: Remove old FacetSidebarContent function**

Delete the old `FacetSidebarContent` function entirely.

**Step 4: Verify TypeScript compilation**

Run: `cd apps/app-frontend && bun run typecheck`
Expected: No type errors

**Step 5: Commit**

```bash
git add apps/app-frontend/src/routes/_protected/route.tsx
git commit -m "feat: integrate new Sidebar component into protected routes

Replace old facet sidebar with journal theme sidebar connected to backend APIs.

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 13: Remove unused sidebar context (if no longer needed)

**Files:**
- Check: `apps/app-frontend/src/features/facets/sidebar-context.tsx`
- Check: Other files importing from sidebar-context

**Step 1: Search for sidebar-context usage**

Run: `cd apps/app-frontend && grep -r "sidebar-context" src/`
Expected: List of files importing sidebar-context

**Step 2: Evaluate if still needed**

If only used by old sidebar code that's been removed:
- Delete `sidebar-context.tsx`
- Remove related imports

If still used elsewhere:
- Skip this task

**Step 3: Commit (only if removed)**

```bash
git add apps/app-frontend/src/features/facets/sidebar-context.tsx
git commit -m "chore: remove unused sidebar-context

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 14: Test the application

**Step 1: Start development server**

Run in separate terminals:
```bash
cargo run
caddy run --config 'ci/Caddyfile'
cd apps/app-frontend && bun run dev
```

**Step 2: Manual testing checklist**

- [ ] Visit http://localhost:8000
- [ ] Sidebar appears with facets and views
- [ ] Light/dark mode toggle works
- [ ] Clicking Home navigates to `/`
- [ ] Clicking entity schemas navigates to `/`
- [ ] Clicking views navigates to `/`
- [ ] Customize mode button works
- [ ] In customize mode, drag handles appear
- [ ] Drag-and-drop reorders facets
- [ ] Reorder persists after save
- [ ] Collapsing/expanding facets works
- [ ] Search input renders (doesn't need to work yet)

**Step 3: Fix any issues found**

If issues found, create additional tasks to address them.

---

### Task 15: Add mobile responsiveness with drawer

**Files:**
- Modify: `apps/app-frontend/src/components/Sidebar.tsx`

**Step 1: Add Drawer and mobile state**

Add imports:
```typescript
import { Box, Burger, Button, Drawer, Group, NavLink, Stack, Text, TextInput } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
```

**Step 2: Add mobile props to SidebarProps**

Modify `Sidebar.types.ts`:
```typescript
export interface SidebarProps {
	facets: SidebarFacet[];
	views: SidebarView[];
	colorScheme: 'light' | 'dark';
	isCustomizeMode: boolean;
	onToggleCustomize: () => void;
	onReorderFacets: (facets: SidebarFacet[]) => void;
	onNavigate?: (path: string) => void;
	isMobile?: boolean;
	mobileOpened?: boolean;
	onMobileToggle?: () => void;
}
```

**Step 3: Update Sidebar component for mobile**

Wrap entire Sidebar return with:

```typescript
const sidebarContent = (
	<Stack gap={0} h="100%" bg={bg}>
		{/* All existing sidebar content */}
	</Stack>
);

if (props.isMobile) {
	return (
		<Drawer
			opened={props.mobileOpened ?? false}
			onClose={props.onMobileToggle ?? (() => {})}
			size={300}
			padding={0}
			withCloseButton={false}
			styles={{
				body: {
					height: "100%",
					backgroundColor: bg,
				},
				content: {
					backgroundColor: bg,
				},
			}}
		>
			{sidebarContent}
		</Drawer>
	);
}

return sidebarContent;
```

**Step 4: Update _protected/route.tsx for mobile**

Add mobile state:

```typescript
const isMobile = useMediaQuery("(max-width: 768px)") ?? false;
const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);

const handleNavigate = (path: string) => {
	closeMobile();
	navigate({ to: "/" });
};
```

Update Sidebar props:
```typescript
<Sidebar
	facets={facets}
	views={views}
	colorScheme={colorScheme}
	isCustomizeMode={isCustomizeMode}
	onToggleCustomize={() => setIsCustomizeMode(!isCustomizeMode)}
	onReorderFacets={handleReorderFacets}
	onNavigate={handleNavigate}
	isMobile={isMobile}
	mobileOpened={mobileOpened}
	onMobileToggle={toggleMobile}
/>
```

Add burger menu:
```typescript
<Flex gap={0} h="100vh">
	{isMobile && (
		<Box p="md">
			<Burger opened={mobileOpened} onClick={toggleMobile} />
		</Box>
	)}
	
	{!isMobile && (
		<Box w="300px" style={{ flexShrink: 0, overflowY: "auto" }}>
			{!isLoading && <Sidebar {...sidebarProps} />}
		</Box>
	)}

	{isMobile && !isLoading && <Sidebar {...sidebarProps} />}

	<Box flex={1} p={16} style={{ overflowY: "auto" }}>
		<Outlet />
	</Box>
</Flex>
```

**Step 5: Commit**

```bash
git add apps/app-frontend/src/components/Sidebar.tsx apps/app-frontend/src/components/Sidebar.types.ts apps/app-frontend/src/routes/_protected/route.tsx
git commit -m "feat: add mobile responsiveness with drawer

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

### Task 16: Final verification and build

**Step 1: Run TypeScript check**

Run: `cd apps/app-frontend && bun run typecheck`
Expected: No errors

**Step 2: Run build**

Run: `cd apps/app-frontend && bun run build`
Expected: Build succeeds

**Step 3: Run Storybook build**

Run: `cd apps/app-frontend && bun run build-storybook`
Expected: Storybook builds successfully

**Step 4: Final commit**

```bash
git add .
git commit -m "chore: verify sidebar integration build passes

Attribution: OpenCode | Model: claude-sonnet-4.5"
```

---

## Completion Checklist

- [ ] Phase 1: Storybook stories created with fake data
- [ ] User approved Storybook stories
- [ ] Phase 2: Backend integration completed
- [ ] All navigation redirects to `/`
- [ ] Light and dark mode both work
- [ ] Customize mode with drag-and-drop works
- [ ] Mobile responsive with drawer
- [ ] TypeScript compilation passes
- [ ] Vite build succeeds
- [ ] Manual testing completed
- [ ] All commits have attribution

---

## Notes

- No presentation/rendering tests added per requirements
- Functional tests can be added for reorder logic if needed
- Search input is UI-only (no functionality yet)
- All navigation redirects to `/` as requested
- Icon names must match Lucide React icon names
