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
import { useFacetsQuery } from "#/features/facets/hooks";
import { FacetIcon } from "#/features/facets/icons";
import { useSavedViewQuery } from "#/features/saved-views/hooks";

export const Route = createFileRoute("/_protected/$facetSlug/views/$viewId")({
	component: RouteComponent,
});

function RouteComponent() {
	const params = Route.useParams();
	const facetsQuery = useFacetsQuery();
	const savedViewQuery = useSavedViewQuery({ viewId: params.viewId });
	const facet = facetsQuery.facetBySlug(params.facetSlug);

	const firstEntitySchemaId =
		savedViewQuery.savedView?.queryDefinition.entitySchemaIds[0];
	const entitySchemasQuery = useEntitySchemasQuery(
		facet?.id ?? "",
		!!facet && !!firstEntitySchemaId,
	);
	const entitySchema = entitySchemasQuery.entitySchemas.find(
		(schema) => schema.id === firstEntitySchemaId,
	);

	if (facetsQuery.isLoading || savedViewQuery.isLoading)
		return (
			<Container size="xl" py="xl">
				<Center py="xl">
					<Loader />
				</Center>
			</Container>
		);

	if (!facet)
		return (
			<Container size="xl" py="xl">
				<Paper p="xl">
					<Text c="red">Facet not found</Text>
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
						{facet.icon && (
							<Box
								w={48}
								h={48}
								style={{ display: "grid", placeItems: "center" }}
							>
								<FacetIcon icon={facet.icon} size={32} />
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
					facetSlug={params.facetSlug}
				/>
			</Stack>
		</Container>
	);
}
