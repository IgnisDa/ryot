import {
	Alert,
	Badge,
	Box,
	Card,
	Container,
	Group,
	Image,
	Loader,
	NumberInput,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApiClient } from "@/hooks/api";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/schema-search")({
	component: SchemaSearchPage,
});

function SchemaSearchPage() {
	const apiClient = useApiClient();
	const authClient = useAuthClient();
	const [page, setPage] = useState(1);
	const [query, setQuery] = useState("harry potter");
	const [schemaSlug, setSchemaSlug] = useState("book");

	const trimmedQuery = query.trim();
	const trimmedSchemaSlug = schemaSlug.trim();

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const searchRequest = useQuery({
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		enabled: Boolean(trimmedSchemaSlug) && Boolean(trimmedQuery),
		queryKey: ["entity-schema-search", trimmedSchemaSlug, trimmedQuery, page],
		queryFn: async () => {
			const response = await apiClient.protected["entity-schemas"][
				":schemaSlug"
			].search.$post({
				json: { page, query: trimmedQuery },
				param: { schemaSlug: trimmedSchemaSlug },
			});

			const payload = await response.json();
			if ("error" in payload) throw new Error(payload.error);

			return payload;
		},
	});

	const completedResult = searchRequest.data;
	const isSearching = searchRequest.isFetching || searchRequest.isPending;
	const loadingLabel = "Searching...";
	const searchError = searchRequest.error?.message;

	return (
		<Box
			style={{
				minHeight: "100vh",
				background: "linear-gradient(180deg, #f7fafc 0%, #edf2f7 100%)",
			}}
		>
			<Container size="lg" py="xl">
				<Stack gap="lg">
					<Stack gap={4}>
						<Title order={2}>Entity Schema Search</Title>
						<Text c="dimmed">
							Runs `/api/protected/entity-schemas/:schemaSlug/search` and
							returns results directly.
						</Text>
					</Stack>

					<Group grow align="start">
						<TextInput
							value={schemaSlug}
							label="Schema slug"
							onChange={(event) => setSchemaSlug(event.currentTarget.value)}
						/>
						<TextInput
							label="Query"
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
						/>
						<NumberInput
							min={1}
							label="Page"
							value={page}
							onChange={(value) => setPage(Number(value) || 1)}
						/>
					</Group>

					{isSearching ? (
						<Group>
							<Loader size="sm" />
							<Text size="sm" c="dimmed">
								{loadingLabel}
							</Text>
						</Group>
					) : null}

					{searchError ? (
						<Alert color="red" title="Search failed">
							{searchError}
						</Alert>
					) : null}

					{completedResult ? (
						<Group>
							<Badge color="blue" variant="light">
								Total: {completedResult.details.total_items}
							</Badge>
							<Badge color="teal" variant="light">
								Next page: {completedResult.details.next_page ?? "none"}
							</Badge>
						</Group>
					) : null}

					<SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
						{completedResult?.items.map((item) => (
							<Card key={item.identifier} withBorder radius="md" padding="md">
								<Stack gap="sm">
									{item.image ? (
										<Image
											h={180}
											radius="sm"
											fit="contain"
											src={item.image}
											alt={item.title}
										/>
									) : null}
									<Title order={4}>{item.title}</Title>
									<Text size="sm" c="dimmed">
										Identifier: {item.identifier}
									</Text>
									<Text size="sm" c="dimmed">
										Publish year: {item.publish_year ?? "unknown"}
									</Text>
								</Stack>
							</Card>
						))}
					</SimpleGrid>
				</Stack>
			</Container>
		</Box>
	);
}
