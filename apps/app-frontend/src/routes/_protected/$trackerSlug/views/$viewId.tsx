import {
	Box,
	Center,
	Container,
	Flex,
	Loader,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { EntitiesSection } from "#/features/entities/section";
import { useEntitySchemasQuery } from "#/features/entity-schemas/hooks";
import { useSavedViewQuery } from "#/features/saved-views/hooks";
import { useTrackersQuery } from "#/features/trackers/hooks";
import { TrackerIcon } from "#/features/trackers/icons";

export const Route = createFileRoute("/_protected/$trackerSlug/views/$viewId")({
	component: RouteComponent,
});

function RouteComponent() {
	const params = Route.useParams();
	const trackersQuery = useTrackersQuery();
	const savedViewQuery = useSavedViewQuery({ viewId: params.viewId });
	const tracker = trackersQuery.trackerBySlug(params.trackerSlug);

	const firstEntitySchemaId =
		savedViewQuery.savedView?.queryDefinition.entitySchemaIds[0];
	const entitySchemasQuery = useEntitySchemasQuery(
		tracker?.id ?? "",
		!!tracker && !!firstEntitySchemaId,
	);
	const entitySchema = entitySchemasQuery.entitySchemas.find(
		(schema) => schema.id === firstEntitySchemaId,
	);

	if (trackersQuery.isLoading || savedViewQuery.isLoading)
		return (
			<Container size="xl" py="xl">
				<Center py="xl">
					<Loader />
				</Center>
			</Container>
		);

	if (!tracker)
		return (
			<Container size="xl" py="xl">
				<Paper p="xl">
					<Text c="red">Tracker not found</Text>
				</Paper>
			</Container>
		);

	if (!savedViewQuery.savedView)
		return (
			<Container size="xl" py="xl">
				<Paper p="xl">
					<Text c="red">Saved view not found</Text>
				</Paper>
			</Container>
		);

	if (!entitySchema)
		return (
			<Container size="xl" py="xl">
				<Paper p="xl">
					<Text c="red">Entity schema not found</Text>
				</Paper>
			</Container>
		);

	return (
		<Container size="xl" py="xl">
			<Stack gap="xl">
				<Box>
					<Flex gap="md" align="flex-start">
						{tracker.icon && (
							<Box
								w={48}
								h={48}
								style={{ display: "grid", placeItems: "center" }}
							>
								<TrackerIcon icon={tracker.icon} size={32} />
							</Box>
						)}
						<Stack gap={4} flex={1}>
							<Title order={1}>{savedViewQuery.savedView.name}</Title>
							<Text c="dimmed" size="sm">
								Viewing {entitySchema.name} entities
							</Text>
						</Stack>
					</Flex>
				</Box>

				<EntitiesSection
					entitySchema={entitySchema}
					trackerSlug={params.trackerSlug}
				/>
			</Stack>
		</Container>
	);
}
