import {
	Box,
	Center,
	Container,
	Flex,
	Loader,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useFacetsQuery } from "#/features/facets/hooks";
import { FacetIcon } from "#/features/facets/icons";

export const Route = createFileRoute("/_protected/tracking/$facetSlug")({
	component: RouteComponent,
});

function RouteComponent() {
	const facetsQuery = useFacetsQuery();
	const { facetSlug } = Route.useParams();

	const facet = facetsQuery.facetBySlug(facetSlug);

	if (facetsQuery.isLoading)
		return (
			<Center h="100vh">
				<Loader size="lg" />
			</Center>
		);

	if (!facet)
		return (
			<Container size="md" py={80}>
				<Stack align="center" gap="lg">
					<Title order={1}>Facet not found</Title>
					<Text c="dimmed" size="lg">
						The facet "{facetSlug}" does not exist or is not enabled.
					</Text>
				</Stack>
			</Container>
		);

	return (
		<Container size="md" py={56}>
			<Stack gap="xl">
				<Box>
					<Flex gap="md" align="flex-start">
						{facet.icon && (
							<Box
								w={48}
								h={48}
								style={{
									display: "grid",
									placeItems: "center",
								}}
							>
								<FacetIcon icon={facet.icon} size={32} />
							</Box>
						)}
						<Stack gap={4} flex={1}>
							<Title order={1}>{facet.name}</Title>
							{facet.description && (
								<Text c="dimmed" size="sm">
									{facet.description}
								</Text>
							)}
						</Stack>
					</Flex>
				</Box>

				{facet.mode && (
					<Box>
						<Text size="sm" fw={500} c="dimmed" mb={8}>
							MODE
						</Text>
						<Text>{facet.mode}</Text>
					</Box>
				)}

				{facet.isBuiltin && (
					<Box>
						<Text size="sm" fw={500} c="dimmed" mb={8}>
							TYPE
						</Text>
						<Text>Built-in</Text>
					</Box>
				)}

				<Box
					p="md"
					style={{
						borderRadius: "var(--mantine-radius-md)",
						backgroundColor: "var(--mantine-color-gray-0)",
					}}
				>
					<Text c="dimmed" size="sm">
						Facet tracking content will be added here.
					</Text>
				</Box>
			</Stack>
		</Container>
	);
}
