import {
	Anchor,
	Button,
	Center,
	Container,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	getEntityDetailProperties,
	hasDeferredEntityDetailProperties,
} from "#/features/entities/detail";
import { useEntityQuery } from "#/features/entities/hooks";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import { useEventSchemasQuery } from "#/features/event-schemas/hooks";
import { EntityEventsSection } from "#/features/events/section";
import { useFacetsQuery } from "#/features/facets/hooks";

export const Route = createFileRoute(
	"/_protected/tracking/$facetSlug/entities/$entityId",
)({
	component: RouteComponent,
});

function LoadingState() {
	return (
		<Center h="100vh">
			<Loader size="lg" />
		</Center>
	);
}

function ErrorState(props: {
	title: string;
	description: string;
	onRetry?: () => void;
}) {
	return (
		<Container size="md" py={80}>
			<Stack align="center" gap="lg">
				<Title order={1}>{props.title}</Title>
				<Text c="dimmed" size="lg" ta="center">
					{props.description}
				</Text>
				{props.onRetry ? (
					<Button variant="light" onClick={props.onRetry}>
						Retry
					</Button>
				) : null}
			</Stack>
		</Container>
	);
}

function PropertiesSection(props: {
	hasDeferredProperties: boolean;
	properties: ReturnType<typeof getEntityDetailProperties>;
}) {
	return (
		<Paper p="lg" withBorder radius="md">
			<Stack gap="md">
				<Stack gap={2}>
					<Text size="sm" fw={500} c="dimmed">
						PROPERTIES
					</Text>
					<Text c="dimmed" size="sm">
						Schema-driven values captured for this entity.
					</Text>
				</Stack>

				{props.properties.length === 0 ? (
					<Paper
						p="sm"
						withBorder
						radius="md"
						style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
					>
						<Stack gap={2}>
							<Text fw={500} size="sm">
								No primitive properties yet
							</Text>
							<Text c="dimmed" size="sm">
								Relationship-style object and array rendering is deferred.
							</Text>
						</Stack>
					</Paper>
				) : (
					<Stack gap="xs">
						{props.hasDeferredProperties ? (
							<Text c="dimmed" size="sm">
								Object and array property rendering, including generic
								relationship-style fields, is intentionally deferred in this
								slice.
							</Text>
						) : null}
						{props.properties.map((property) => (
							<Paper
								p="sm"
								withBorder
								radius="md"
								key={property.key}
								style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
							>
								<Group justify="space-between" align="flex-start">
									<Stack gap={2}>
										<Text size="xs" fw={500} c="dimmed">
											{property.label}
										</Text>
										<Text>{property.value}</Text>
									</Stack>
								</Group>
							</Paper>
						))}
					</Stack>
				)}
			</Stack>
		</Paper>
	);
}

function RouteComponent() {
	const { entityId, facetSlug } = Route.useParams();
	const facetsQuery = useFacetsQuery();
	const entityQuery = useEntityQuery(entityId);
	const facet = facetsQuery.facetBySlug(facetSlug);
	const entitySchemasQuery = useEntitySchemasQuery(
		facet?.id ?? "",
		!!facet && !facet.isBuiltin,
	);
	const entitySchema = entityQuery.entity
		? entitySchemasQuery.entitySchemas.find(
				(schema) => schema.id === entityQuery.entity?.entitySchemaId,
			)
		: undefined;
	const eventSchemasQuery = useEventSchemasQuery(
		entityQuery.entity?.entitySchemaId ?? "",
		!!entityQuery.entity,
	);

	if (
		facetsQuery.isLoading ||
		entityQuery.isLoading ||
		(!!facet && !facet.isBuiltin && entitySchemasQuery.isLoading)
	)
		return <LoadingState />;

	if (facetsQuery.isError)
		return (
			<ErrorState
				title="Failed to load facet"
				onRetry={() => facetsQuery.refetch()}
				description="We could not load tracking facets right now."
			/>
		);

	if (entityQuery.isError)
		return (
			<ErrorState
				title="Failed to load entity"
				onRetry={() => entityQuery.refetch()}
				description="We could not load this tracked entity right now."
			/>
		);

	if (!facet || facet.isBuiltin)
		return (
			<ErrorState
				title="Entity not found"
				description={`The custom facet "${facetSlug}" is not available.`}
			/>
		);

	if (entitySchemasQuery.isError)
		return (
			<ErrorState
				title="Failed to load schema"
				onRetry={() => entitySchemasQuery.refetch()}
				description="We could not load the schema for this tracked entity."
			/>
		);

	if (!entityQuery.entity || !entitySchema)
		return (
			<ErrorState
				title="Entity not found"
				description="This entity does not exist in the selected custom facet."
			/>
		);

	const properties = getEntityDetailProperties(
		entitySchema.propertiesSchema,
		entityQuery.entity.properties,
	);
	const hasDeferredProperties = hasDeferredEntityDetailProperties(
		entitySchema.propertiesSchema,
	);

	return (
		<Container size="md" py={56}>
			<Stack gap="xl">
				<Stack gap="xs">
					<Link to="/tracking/$facetSlug" params={{ facetSlug }}>
						<Anchor component="span" size="sm">
							Back to {facet.name}
						</Anchor>
					</Link>
					<Title order={1}>{entityQuery.entity.name}</Title>
					<Text c="dimmed" size="sm">
						{entitySchema.name} in {facet.name}
					</Text>
				</Stack>

				<Paper p="lg" withBorder radius="md">
					<Stack gap="md">
						<Stack gap={2}>
							<Text size="sm" fw={500} c="dimmed">
								OVERVIEW
							</Text>
							<Text c="dimmed" size="sm">
								Base metadata for this tracked entity.
							</Text>
						</Stack>

						<Stack gap="xs">
							<Paper
								p="sm"
								withBorder
								radius="md"
								style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
							>
								<Text size="xs" fw={500} c="dimmed">
									Schema
								</Text>
								<Text>{entitySchema.name}</Text>
							</Paper>
							<Paper
								p="sm"
								withBorder
								radius="md"
								style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
							>
								<Text size="xs" fw={500} c="dimmed">
									Created
								</Text>
								<Text>{entityQuery.entity.createdAt.toLocaleString()}</Text>
							</Paper>
							<Paper
								p="sm"
								withBorder
								radius="md"
								style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
							>
								<Text size="xs" fw={500} c="dimmed">
									Updated
								</Text>
								<Text>{entityQuery.entity.updatedAt.toLocaleString()}</Text>
							</Paper>
							{entityQuery.entity.externalId ? (
								<Paper
									p="sm"
									withBorder
									radius="md"
									style={{ backgroundColor: "var(--mantine-color-gray-0)" }}
								>
									<Text size="xs" fw={500} c="dimmed">
										External id
									</Text>
									<Text>{entityQuery.entity.externalId}</Text>
								</Paper>
							) : null}
						</Stack>
					</Stack>
				</Paper>

				<PropertiesSection
					properties={properties}
					hasDeferredProperties={hasDeferredProperties}
				/>

				<EntityEventsSection
					entity={entityQuery.entity}
					title="EVENT HISTORY"
					eventLimit={Number.MAX_SAFE_INTEGER}
					eventSchemas={eventSchemasQuery.eventSchemas}
					eventSchemasError={eventSchemasQuery.isError}
					eventSchemasLoading={eventSchemasQuery.isLoading}
					description="All logged events for this entity using the existing tracking flow."
				/>
			</Stack>
		</Container>
	);
}
