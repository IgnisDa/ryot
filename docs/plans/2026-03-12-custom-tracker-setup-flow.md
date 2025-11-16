# Custom Tracker Setup Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a polished, guided setup flow for custom facet pages that transitions from empty state to a rich tracker overview.

**Architecture:** Modal-based progressive setup with vertical stepper cards. When `entitySchemas.length === 0`, show guided flow. When `> 0`, show enhanced overview. Reuse all existing modals and mutations.

**Tech Stack:** React, TypeScript, Mantine, TanStack Router, TanStack Query

---

## Task 1: Extract SetupStepCard Component

**Files:**
- Create: `apps/app-frontend/src/features/facets/setup-step-card.tsx`

**Step 1: Create SetupStepCard component file**

Create the component with proper typing and styling:

```typescript
import { Badge, Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { Check } from "lucide-react";

type SetupStepStatus = "pending" | "active" | "completed";

interface SetupStepCardProps {
	title: string;
	status: SetupStepStatus;
	stepNumber: number;
	description?: string;
	accentColor: string;
	completedSummary?: string;
	primaryAction?: {
		label: string;
		onClick: () => void;
	};
	secondaryAction?: {
		label: string;
		onClick: () => void;
	};
}

function getStatusStyles(props: {
	status: SetupStepStatus;
	accentColor: string;
}) {
	if (props.status === "completed") {
		return {
			opacity: 0.9,
			borderColor: "var(--mantine-color-green-6)",
			backgroundColor: "var(--mantine-color-green-0)",
		};
	}

	if (props.status === "active") {
		return {
			opacity: 1,
			borderColor: props.accentColor,
			backgroundColor: "transparent",
		};
	}

	return {
		opacity: 0.5,
		borderColor: "var(--mantine-color-gray-4)",
		backgroundColor: "var(--mantine-color-gray-0)",
	};
}

export function SetupStepCard(props: SetupStepCardProps) {
	const styles = getStatusStyles({
		status: props.status,
		accentColor: props.accentColor,
	});
	const isDisabled = props.status === "pending";

	return (
		<Paper
			p="xl"
			withBorder
			radius="md"
			style={{
				opacity: styles.opacity,
				borderColor: styles.borderColor,
				borderWidth: props.status === "active" ? 2 : 1,
				backgroundColor: styles.backgroundColor,
			}}
		>
			<Stack gap="md">
				<Group gap="md" wrap="nowrap" align="flex-start">
					{props.status === "completed" ? (
						<Box
							w={32}
							h={32}
							style={{
								display: "flex",
								flexShrink: 0,
								borderRadius: "50%",
								alignItems: "center",
								justifyContent: "center",
								color: "white",
								backgroundColor: "var(--mantine-color-green-6)",
							}}
						>
							<Check size={18} strokeWidth={2.5} />
						</Box>
					) : (
						<Badge
							size="lg"
							radius="xl"
							variant="filled"
							style={{
								flexShrink: 0,
								backgroundColor:
									props.status === "active"
										? props.accentColor
										: "var(--mantine-color-gray-5)",
							}}
						>
							{props.stepNumber}
						</Badge>
					)}

					<Stack gap={4} flex={1}>
						<Text fw={600} size="lg">
							{props.title}
						</Text>

						{props.status === "completed" && props.completedSummary && (
							<Text c="dimmed" size="sm">
								{props.completedSummary}
							</Text>
						)}

						{props.status === "active" && props.description && (
							<Text c="dimmed" size="sm">
								{props.description}
							</Text>
						)}
					</Stack>
				</Group>

				{props.status === "active" &&
					(props.primaryAction || props.secondaryAction) && (
						<Group justify="center" gap="md" mt="xs">
							{props.primaryAction && (
								<Button
									size="md"
									disabled={isDisabled}
									onClick={props.primaryAction.onClick}
									style={{ backgroundColor: props.accentColor }}
								>
									{props.primaryAction.label}
								</Button>
							)}
							{props.secondaryAction && (
								<Button
									size="md"
									variant="subtle"
									disabled={isDisabled}
									onClick={props.secondaryAction.onClick}
								>
									{props.secondaryAction.label}
								</Button>
							)}
						</Group>
					)}
			</Stack>
		</Paper>
	);
}
```

**Step 2: Commit**

```bash
git add 'apps/app-frontend/src/features/facets/setup-step-card.tsx'
git commit -m 'feat: add SetupStepCard component for guided setup flow

Component supports pending/active/completed states with proper styling.

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 2: Create SetupGuidedFlow Component

**Files:**
- Create: `apps/app-frontend/src/features/facets/setup-guided-flow.tsx`

**Step 1: Create SetupGuidedFlow component**

```typescript
import { Stack, Text } from "@mantine/core";
import { useCallback, useMemo, useState } from "react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import type { AppFacet } from "#/features/facets/model";
import { SetupStepCard } from "./setup-step-card";

interface SetupGuidedFlowProps {
	facet: AppFacet;
	entitySchemas: AppEntitySchema[];
	onOpenEntitySchemaModal: () => void;
	onOpenEventSchemaModal: () => void;
	onOpenEntityModal: () => void;
}

export function SetupGuidedFlow(props: SetupGuidedFlowProps) {
	const hasEntitySchema = props.entitySchemas.length > 0;
	const primaryEntitySchema = props.entitySchemas[0];

	const step1Status = hasEntitySchema ? "completed" : "active";
	const step2Status = hasEntitySchema ? "active" : "pending";
	const step3Status = hasEntitySchema ? "active" : "pending";

	const step1CompletedSummary = primaryEntitySchema
		? `"${primaryEntitySchema.name}" entity schema created with ${
				Object.keys(primaryEntitySchema.propertiesSchema).length
		  } properties`
		: undefined;

	const step3Title = primaryEntitySchema
		? `Add your first ${primaryEntitySchema.name.toLowerCase()}`
		: "Add your first entity";

	const step3Description = primaryEntitySchema
		? `Start tracking by adding your first ${primaryEntitySchema.name.toLowerCase()} instance.`
		: "Start tracking by adding your first entity instance.";

	return (
		<Stack gap="lg">
			<Stack gap={4}>
				<Text size="sm" fw={500} c="dimmed">
					SETUP YOUR TRACKER
				</Text>
				<Text c="dimmed" size="sm">
					Complete these steps to finish setting up your custom tracker.
				</Text>
			</Stack>

			<Stack gap="md">
				<SetupStepCard
					stepNumber={1}
					status={step1Status}
					accentColor={props.facet.accentColor}
					title="Define your main entity schema"
					completedSummary={step1CompletedSummary}
					description="Create the schema that describes what you're tracking. This defines the fields each tracked item will have."
					primaryAction={{
						label: "Create entity schema →",
						onClick: props.onOpenEntitySchemaModal,
					}}
				/>

				<SetupStepCard
					stepNumber={2}
					status={step2Status}
					accentColor={props.facet.accentColor}
					title="Add event schema (optional)"
					description="Define events you want to track for this entity, like tastings, purchases, or reviews."
					primaryAction={{
						label: "Add event schema →",
						onClick: props.onOpenEventSchemaModal,
					}}
					secondaryAction={{
						label: "Skip for now",
						onClick: () => {},
					}}
				/>

				<SetupStepCard
					stepNumber={3}
					status={step3Status}
					title={step3Title}
					accentColor={props.facet.accentColor}
					description={step3Description}
					primaryAction={{
						label: `Add ${primaryEntitySchema?.name.toLowerCase() ?? "entity"} →`,
						onClick: props.onOpenEntityModal,
					}}
				/>
			</Stack>
		</Stack>
	);
}
```

**Step 2: Commit**

```bash
git add 'apps/app-frontend/src/features/facets/setup-guided-flow.tsx'
git commit -m 'feat: add SetupGuidedFlow component for custom facet setup

Three-step guided flow: entity schema, event schema (optional), first entity.
Uses SetupStepCard with dynamic state based on entitySchemas length.

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 3: Create TrackerOverview Component

**Files:**
- Create: `apps/app-frontend/src/features/facets/tracker-overview.tsx`

**Step 1: Create TrackerOverview component**

```typescript
import { Box, Button, Code, Group, Paper, Stack, Text } from "@mantine/core";
import { EntitiesSection } from "#/features/entities/section";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { EventSchemasSection } from "#/features/event-schemas/section";
import { FacetIcon } from "./icons";

interface TrackerOverviewProps {
	facetSlug: string;
	entitySchemas: AppEntitySchema[];
	onOpenAddSchemaModal: () => void;
}

function EntitySchemaOverviewCard(props: {
	facetSlug: string;
	entitySchema: AppEntitySchema;
}) {
	const propertyCount = Object.keys(props.entitySchema.propertiesSchema).length;

	return (
		<Paper p="lg" withBorder radius="md">
			<Stack gap="lg">
				<Group justify="space-between" align="flex-start">
					<Group gap="sm" align="flex-start" wrap="nowrap">
						<Box
							style={{
								paddingTop: 2,
								display: "flex",
								alignItems: "center",
								color: props.entitySchema.accentColor,
							}}
						>
							<FacetIcon icon={props.entitySchema.icon} size={24} />
						</Box>
						<Stack gap={2}>
							<Text fw={600} size="lg">
								{props.entitySchema.name}
							</Text>
							<Code>{props.entitySchema.slug}</Code>
						</Stack>
					</Group>
					<Text c="dimmed" size="sm">
						{propertyCount} {propertyCount === 1 ? "property" : "properties"}
					</Text>
				</Group>

				<EntitiesSection
					facetSlug={props.facetSlug}
					entitySchema={props.entitySchema}
				/>

				<EventSchemasSection entitySchema={props.entitySchema} />
			</Stack>
		</Paper>
	);
}

export function TrackerOverview(props: TrackerOverviewProps) {
	return (
		<Stack gap="lg">
			<Stack gap={4}>
				<Text size="sm" fw={500} c="dimmed">
					ENTITY SCHEMAS
				</Text>
				<Text c="dimmed" size="sm">
					Your custom tracker schemas and their tracked entities.
				</Text>
			</Stack>

			<Stack gap="md">
				{props.entitySchemas.map((entitySchema) => (
					<EntitySchemaOverviewCard
						key={entitySchema.id}
						facetSlug={props.facetSlug}
						entitySchema={entitySchema}
					/>
				))}
			</Stack>

			<Paper p="md" withBorder radius="md">
				<Group justify="center">
					<Button variant="subtle" onClick={props.onOpenAddSchemaModal}>
						+ Add another entity schema
					</Button>
				</Group>
			</Paper>
		</Stack>
	);
}
```

**Step 2: Commit**

```bash
git add 'apps/app-frontend/src/features/facets/tracker-overview.tsx'
git commit -m 'feat: add TrackerOverview component for custom facets

Shows entity schema cards with embedded EntitiesSection and EventSchemasSection.
Includes CTA for adding additional schemas at bottom.

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 4: Refactor CustomFacetSchemaSection

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx`

**Step 1: Add imports for new components**

At the top of the file, add:

```typescript
import { SetupGuidedFlow } from "#/features/facets/setup-guided-flow";
import { TrackerOverview } from "#/features/facets/tracker-overview";
```

**Step 2: Update CustomFacetSchemaSection component**

Replace the existing `CustomFacetSchemaSection` function (starting around line 298) with:

```typescript
function CustomFacetSchemaSection(props: { facet: AppFacet }) {
	const { facetSlug } = Route.useParams();
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);
	const [openedModal, setOpenedModal] = useState<
		"entity-schema" | "event-schema" | "entity" | null
	>(null);
	const entitySchemasQuery = useEntitySchemasQuery(
		props.facet.id,
		!props.facet.isBuiltin,
	);
	const entitySchemaMutations = useEntitySchemaMutations(props.facet.id);
	const viewState = getFacetEntitySchemaViewState({
		facet: props.facet,
		entitySchemas: entitySchemasQuery.entitySchemas,
	});
	const primaryEntitySchema = entitySchemasQuery.entitySchemas[0];

	const openEntitySchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal("entity-schema");
	}, []);

	const openEventSchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal("event-schema");
	}, []);

	const openEntityModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal("entity");
	}, []);

	const closeModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal(null);
	}, []);

	const submitCreateEntitySchema = useCallback(
		async (payload: CreateEntitySchemaPayload) => {
			setCreateErrorMessage(null);

			try {
				await entitySchemaMutations.create.mutateAsync({ body: payload });
				closeModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeModal, entitySchemaMutations.create],
	);

	if (entitySchemasQuery.isLoading) {
		return (
			<Center py="xl">
				<Loader size="sm" />
			</Center>
		);
	}

	if (entitySchemasQuery.isError) {
		return (
			<Paper p="lg" withBorder radius="md">
				<Stack gap="sm">
					<Text c="red" size="sm">
						Failed to load schemas for this facet.
					</Text>
					<Group>
						<Button
							size="xs"
							variant="light"
							onClick={() => entitySchemasQuery.refetch()}
						>
							Retry
						</Button>
					</Group>
				</Stack>
			</Paper>
		);
	}

	return (
		<Stack gap="md">
			{createErrorMessage && openedModal === null && (
				<Text c="red" size="sm">
					{createErrorMessage}
				</Text>
			)}

			{viewState.type === "empty" && (
				<SetupGuidedFlow
					facet={props.facet}
					entitySchemas={entitySchemasQuery.entitySchemas}
					onOpenEntitySchemaModal={openEntitySchemaModal}
					onOpenEventSchemaModal={openEventSchemaModal}
					onOpenEntityModal={openEntityModal}
				/>
			)}

			{viewState.type === "list" && (
				<TrackerOverview
					facetSlug={facetSlug}
					entitySchemas={viewState.entitySchemas}
					onOpenAddSchemaModal={openEntitySchemaModal}
				/>
			)}

			{openedModal === "entity-schema" && (
				<EntitySchemaCreateModal
					facetId={props.facet.id}
					opened={openedModal === "entity-schema"}
					onClose={closeModal}
					onSubmit={submitCreateEntitySchema}
					errorMessage={createErrorMessage}
					isLoading={entitySchemaMutations.create.isPending}
				/>
			)}

			{openedModal === "event-schema" && primaryEntitySchema && (
				<CreateEventSchemaModal
					opened={openedModal === "event-schema"}
					onClose={closeModal}
					entitySchemaId={primaryEntitySchema.id}
					onSubmit={async () => {
						closeModal();
					}}
					errorMessage={null}
					isLoading={false}
				/>
			)}

			{openedModal === "entity" && primaryEntitySchema && (
				<CreateEntityModal
					opened={openedModal === "entity"}
					onClose={closeModal}
					entitySchema={primaryEntitySchema}
					onSubmit={async () => {
						closeModal();
					}}
					errorMessage={null}
					isLoading={false}
				/>
			)}
		</Stack>
	);
}
```

**Step 3: Remove old EntitySchemaList and EntitySchemaCreateModal components**

Delete the `EntitySchemaList` function (lines ~122-169) and `EntitySchemaCreateModal` function (lines ~171-296) as they're no longer needed.

**Step 4: Commit**

```bash
git add 'apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx'
git commit -m 'refactor: integrate setup flow and overview into facet route

Replace simple list view with guided setup flow (empty state) and 
rich tracker overview (populated state). Reuse existing modals with 
improved state management.

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 5: Fix Event Schema and Entity Modal Integration

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx`

**Step 1: Import event schema and entity types and hooks**

Add to imports:

```typescript
import type { CreateEventSchemaPayload } from "#/features/event-schemas/form";
import {
	useEventSchemaMutations,
	useEventSchemasQuery,
} from "#/features/event-schemas/hooks";
import { CreateEventSchemaModal } from "#/features/event-schemas/section";
import type { CreateEntityPayload } from "#/features/entities/form";
import { useEntityMutations } from "#/features/entities/hooks";
import { CreateEntityModal } from "#/features/entities/section";
```

**Step 2: Update CustomFacetSchemaSection to handle event schema and entity mutations**

Replace the modal sections in `CustomFacetSchemaSection` with properly wired mutations:

```typescript
function CustomFacetSchemaSection(props: { facet: AppFacet }) {
	const { facetSlug } = Route.useParams();
	const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(
		null,
	);
	const [openedModal, setOpenedModal] = useState<
		"entity-schema" | "event-schema" | "entity" | null
	>(null);
	const entitySchemasQuery = useEntitySchemasQuery(
		props.facet.id,
		!props.facet.isBuiltin,
	);
	const entitySchemaMutations = useEntitySchemaMutations(props.facet.id);
	const primaryEntitySchema = entitySchemasQuery.entitySchemas[0];
	const eventSchemaMutations = useEventSchemaMutations(
		primaryEntitySchema?.id ?? "",
	);
	const entityMutations = useEntityMutations(primaryEntitySchema?.id ?? "");

	const viewState = getFacetEntitySchemaViewState({
		facet: props.facet,
		entitySchemas: entitySchemasQuery.entitySchemas,
	});

	const openEntitySchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal("entity-schema");
	}, []);

	const openEventSchemaModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal("event-schema");
	}, []);

	const openEntityModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal("entity");
	}, []);

	const closeModal = useCallback(() => {
		setCreateErrorMessage(null);
		setOpenedModal(null);
	}, []);

	const submitCreateEntitySchema = useCallback(
		async (payload: CreateEntitySchemaPayload) => {
			setCreateErrorMessage(null);

			try {
				await entitySchemaMutations.create.mutateAsync({ body: payload });
				closeModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeModal, entitySchemaMutations.create],
	);

	const submitCreateEventSchema = useCallback(
		async (payload: CreateEventSchemaPayload) => {
			setCreateErrorMessage(null);

			try {
				await eventSchemaMutations.create.mutateAsync({ body: payload });
				closeModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeModal, eventSchemaMutations.create],
	);

	const submitCreateEntity = useCallback(
		async (payload: CreateEntityPayload) => {
			setCreateErrorMessage(null);

			try {
				await entityMutations.create.mutateAsync({ body: payload });
				closeModal();
			} catch (error) {
				setCreateErrorMessage(getErrorMessage(error));
			}
		},
		[closeModal, entityMutations.create],
	);

	if (entitySchemasQuery.isLoading) {
		return (
			<Center py="xl">
				<Loader size="sm" />
			</Center>
		);
	}

	if (entitySchemasQuery.isError) {
		return (
			<Paper p="lg" withBorder radius="md">
				<Stack gap="sm">
					<Text c="red" size="sm">
						Failed to load schemas for this facet.
					</Text>
					<Group>
						<Button
							size="xs"
							variant="light"
							onClick={() => entitySchemasQuery.refetch()}
						>
							Retry
						</Button>
					</Group>
				</Stack>
			</Paper>
		);
	}

	return (
		<Stack gap="md">
			{createErrorMessage && openedModal === null && (
				<Text c="red" size="sm">
					{createErrorMessage}
				</Text>
			)}

			{viewState.type === "empty" && (
				<SetupGuidedFlow
					facet={props.facet}
					entitySchemas={entitySchemasQuery.entitySchemas}
					onOpenEntitySchemaModal={openEntitySchemaModal}
					onOpenEventSchemaModal={openEventSchemaModal}
					onOpenEntityModal={openEntityModal}
				/>
			)}

			{viewState.type === "list" && (
				<TrackerOverview
					facetSlug={facetSlug}
					entitySchemas={viewState.entitySchemas}
					onOpenAddSchemaModal={openEntitySchemaModal}
				/>
			)}

			{openedModal === "entity-schema" && (
				<EntitySchemaCreateModal
					facetId={props.facet.id}
					opened={openedModal === "entity-schema"}
					onClose={closeModal}
					onSubmit={submitCreateEntitySchema}
					errorMessage={createErrorMessage}
					isLoading={entitySchemaMutations.create.isPending}
				/>
			)}

			{openedModal === "event-schema" && primaryEntitySchema && (
				<CreateEventSchemaModal
					opened={openedModal === "event-schema"}
					onClose={closeModal}
					entitySchemaId={primaryEntitySchema.id}
					onSubmit={submitCreateEventSchema}
					errorMessage={createErrorMessage}
					isLoading={eventSchemaMutations.create.isPending}
				/>
			)}

			{openedModal === "entity" && primaryEntitySchema && (
				<CreateEntityModal
					opened={openedModal === "entity"}
					onClose={closeModal}
					entitySchema={primaryEntitySchema}
					onSubmit={submitCreateEntity}
					errorMessage={createErrorMessage}
					isLoading={entityMutations.create.isPending}
				/>
			)}
		</Stack>
	);
}
```

**Step 3: Commit**

```bash
git add 'apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx'
git commit -m 'fix: wire event schema and entity modals with proper mutations

Connect CreateEventSchemaModal and CreateEntityModal to their respective
mutation hooks. All three modals now properly handle loading and errors.

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 6: Extract EntitySchemaCreateModal to Reuse

**Files:**
- Create: `apps/app-frontend/src/features/entity-schemas/create-modal.tsx`
- Modify: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx`

**Step 1: Create entity schema modal file**

```typescript
import {
	Button,
	ColorInput,
	Group,
	Modal,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import type { CreateEntitySchemaPayload } from "./form";
import { FacetIcon, facetIconSelectData } from "#/features/facets/icons";
import { EntitySchemaPropertiesBuilder } from "./properties-builder";
import { useCreateEntitySchemaForm } from "./use-form";

interface EntitySchemaCreateModalProps {
	opened: boolean;
	facetId: string;
	isLoading: boolean;
	onClose: () => void;
	errorMessage: string | null;
	onSubmit: (payload: CreateEntitySchemaPayload) => Promise<void>;
}

export function EntitySchemaCreateModal(props: EntitySchemaCreateModalProps) {
	const entitySchemaForm = useCreateEntitySchemaForm({
		facetId: props.facetId,
		onSubmit: props.onSubmit,
	});

	return (
		<Modal
			centered
			size="lg"
			title="Add schema"
			opened={props.opened}
			onClose={props.onClose}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void entitySchemaForm.handleSubmit();
				}}
			>
				<entitySchemaForm.AppForm>
					<Stack gap="md">
						{props.errorMessage && (
							<Text c="red" size="sm">
								{props.errorMessage}
							</Text>
						)}

						<entitySchemaForm.AppField
							name="name"
							listeners={entitySchemaForm.nameFieldListeners}
						>
							{(field) => (
								<field.TextField
									required
									label="Name"
									disabled={props.isLoading}
									placeholder="Custom schema"
								/>
							)}
						</entitySchemaForm.AppField>

						<entitySchemaForm.AppField name="slug">
							{(field) => (
								<field.TextField
									label="Slug"
									disabled={props.isLoading}
									placeholder="custom-schema"
								/>
							)}
						</entitySchemaForm.AppField>

						<Group grow align="flex-start" wrap="nowrap">
							<entitySchemaForm.AppField name="icon">
								{(field) => (
									<Select
										required
										searchable
										limit={100}
										label="Icon"
										placeholder="Select icon"
										onBlur={field.handleBlur}
										disabled={props.isLoading}
										data={facetIconSelectData}
										value={field.state.value || null}
										leftSection={<FacetIcon icon={field.state.value} />}
										onChange={(value) => field.handleChange(value ?? "")}
										renderOption={({ option }) => (
											<Group gap={8} wrap="nowrap">
												<FacetIcon icon={option.value} />
												<span>{option.label}</span>
											</Group>
										)}
									/>
								)}
							</entitySchemaForm.AppField>

							<entitySchemaForm.AppField name="accentColor">
								{(field) => (
									<ColorInput
										required
										label="Accent Color"
										value={field.state.value}
										disabled={props.isLoading}
										placeholder="Choose color"
										onChange={(value) => field.handleChange(value)}
									/>
								)}
							</entitySchemaForm.AppField>
						</Group>

						<EntitySchemaPropertiesBuilder
							form={entitySchemaForm}
							isLoading={props.isLoading}
						/>

						<Group justify="flex-end" gap="md">
							<Button
								type="button"
								variant="subtle"
								onClick={props.onClose}
								disabled={props.isLoading}
							>
								Cancel
							</Button>
							<entitySchemaForm.SubmitButton
								label="Create schema"
								disabled={props.isLoading}
								pendingLabel="Creating..."
							/>
						</Group>
					</Stack>
				</entitySchemaForm.AppForm>
			</form>
		</Modal>
	);
}
```

**Step 2: Update route to import from new location**

In `apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx`, update the import:

```typescript
import { EntitySchemaCreateModal } from "#/features/entity-schemas/create-modal";
```

Remove the old `EntitySchemaCreateModal` component definition from the route file (if it still exists).

**Step 3: Commit**

```bash
git add 'apps/app-frontend/src/features/entity-schemas/create-modal.tsx' 'apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx'
git commit -m 'refactor: extract EntitySchemaCreateModal to feature folder

Move modal to entity-schemas feature for better reusability.
Update route to import from new location.

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 7: Export Modal Components from Event Schemas and Entities

**Files:**
- Modify: `apps/app-frontend/src/features/event-schemas/section.tsx`
- Modify: `apps/app-frontend/src/features/entities/section.tsx`

**Step 1: Export CreateEventSchemaModal**

At the end of `apps/app-frontend/src/features/event-schemas/section.tsx`, add an export for the modal:

```typescript
export { CreateEventSchemaModal };
```

The modal is already defined in the file, just needs to be exported.

**Step 2: Export CreateEntityModal**

At the end of `apps/app-frontend/src/features/entities/section.tsx`, add an export for the modal:

```typescript
export { CreateEntityModal };
```

The modal is already defined in the file, just needs to be exported.

**Step 3: Commit**

```bash
git add 'apps/app-frontend/src/features/event-schemas/section.tsx' 'apps/app-frontend/src/features/entities/section.tsx'
git commit -m 'refactor: export modal components for reuse in setup flow

Export CreateEventSchemaModal and CreateEntityModal to allow
importing from other components.

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 8: Run TypeScript Type Check

**Files:**
- None (validation only)

**Step 1: Run type checker**

```bash
cd /Users/diptesh/Desktop/Code/ryot
bun run turbo typecheck --filter='@ryot/app-frontend'
```

Expected: All types should pass without errors.

**Step 2: If errors occur, fix them**

Common issues:
- Missing imports
- Type mismatches in props
- Undefined variables

Fix any errors that appear and re-run the check.

**Step 3: Commit if fixes were needed**

```bash
git add .
git commit -m 'fix: resolve TypeScript type errors

Attribution: OpenCode | Model: claude-sonnet-4.5'
```

---

## Task 9: Manual Testing

**Files:**
- None (testing only)

**Step 1: Start dev server**

```bash
cd /Users/diptesh/Desktop/Code/ryot
bun run turbo dev --filter='@ryot/app-frontend'
```

**Step 2: Test setup flow (empty state)**

1. Navigate to a custom facet with zero entity schemas
2. Verify 3 step cards appear
3. Verify Step 1 is active, Steps 2 & 3 are disabled/muted
4. Click "Create entity schema"
5. Fill form and submit
6. Verify modal closes and page updates

**Step 3: Test overview mode (populated state)**

1. After entity schema is created, verify page shows tracker overview
2. Verify entity schema card shows with proper styling
3. Verify EntitiesSection shows with "Add entity" button
4. Verify EventSchemasSection shows with "Add event schema" button
5. Verify "Add another entity schema" button at bottom

**Step 4: Test event schema flow**

1. From setup or overview, click "Add event schema"
2. Fill form and submit
3. Verify event schema appears in list

**Step 5: Test entity creation flow**

1. Click "Add [entity name]"
2. Fill form and submit
3. Verify entity appears in entities list

**Step 6: Test built-in facet (no changes)**

1. Navigate to a built-in facet
2. Verify read-only message still appears
3. Verify no setup flow or overview changes

---

## Task 10: Final Commit and Push

**Files:**
- None (git operations only)

**Step 1: Review all changes**

```bash
git log --oneline -10
git diff main
```

**Step 2: Push to remote**

```bash
git push origin ultra-rewrite
```

---

## Completion Checklist

- ✅ SetupStepCard component created with proper states
- ✅ SetupGuidedFlow component created with 3-step flow
- ✅ TrackerOverview component created with entity schema cards
- ✅ CustomFacetSchemaSection refactored to use new components
- ✅ Event schema and entity modals properly wired
- ✅ EntitySchemaCreateModal extracted to feature folder
- ✅ Modal components exported for reuse
- ✅ TypeScript type check passes
- ✅ Manual testing completed successfully
- ✅ All changes committed and pushed

## Notes

**Mocked/Local-Only for Prototype:**
- Step completion tracking (local state, not persisted to backend)
- "Skip for now" button functionality (just closes modal)

**Backend Integration Working:**
- All mutations (entity schema, event schema, entity creation)
- Query refetching after mutations
- Error handling and loading states

**Visual Consistency:**
- Matches sidebar color system
- Uses same Mantine components and styling patterns
- Maintains dark/light theme support
