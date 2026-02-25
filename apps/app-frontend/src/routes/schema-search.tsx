import {
	Alert,
	Badge,
	Box,
	Button,
	Card,
	Container,
	Group,
	Image,
	Loader,
	NumberInput,
	SegmentedControl,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApiClient } from "@/hooks/api";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/schema-search")({
	component: SchemaSearchPage,
});

const openLibrarySearchScriptSlug = "openlibrary.book.search";
const googleBooksSearchScriptSlug = "google-books.book.search";

function SchemaSearchPage() {
	const apiClient = useApiClient();
	const authClient = useAuthClient();
	const navigate = Route.useNavigate();
	const [page, setPage] = useState(1);
	const [query, setQuery] = useState("harry potter");
	const [searchScriptSlug, setSearchScriptSlug] = useState(
		openLibrarySearchScriptSlug,
	);
	const [importingIdentifier, setImportingIdentifier] = useState<string | null>(
		null,
	);

	const trimmedQuery = query.trim();

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const searchRequest = useQuery({
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		enabled: Boolean(trimmedQuery),
		queryKey: ["entity-schema-search", trimmedQuery, searchScriptSlug, page],
		queryFn: async () => {
			const response = await apiClient.protected["entity-schemas"].search.$post(
				{
					json: {
						page,
						query: trimmedQuery,
						search_script_slug: searchScriptSlug,
					},
				},
			);

			const payload = await response.json();
			if ("error" in payload) throw new Error(payload.error);

			return payload;
		},
	});

	const completedResult = searchRequest.data;
	const isSearching = searchRequest.isFetching || searchRequest.isPending;
	const loadingLabel = "Searching...";
	const searchError = searchRequest.error?.message;

	const importEntityRequest = useMutation({
		mutationFn: async (identifier: string) => {
			const response = await apiClient.protected["entity-schemas"].import.$post(
				{
					json: { identifier, search_script_slug: searchScriptSlug },
				},
			);

			const payload = await response.json();

			if (!response.ok) {
				if (
					payload &&
					typeof payload === "object" &&
					"error" in payload &&
					typeof payload.error === "string"
				)
					throw new Error(payload.error);

				throw new Error("Import failed");
			}

			if (
				!payload ||
				typeof payload !== "object" ||
				!("entity_id" in payload) ||
				typeof payload.entity_id !== "string"
			)
				throw new Error("Import returned invalid payload");

			return payload.entity_id;
		},
		onMutate: (identifier) => {
			setImportingIdentifier(identifier);
		},
		onSuccess: (entityId) => {
			void navigate({ params: { entityId }, to: "/entities/$entityId" });
		},
		onSettled: () => {
			setImportingIdentifier(null);
		},
	});

	const importError = importEntityRequest.error?.message;

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
							Runs `/api/protected/entity-schemas/search` and returns results
							directly. Use the source picker below to switch between
							OpenLibrary and Google Books.
						</Text>
					</Stack>

					<Group grow align="start">
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

					<SegmentedControl
						fullWidth
						value={searchScriptSlug}
						data={[
							{ label: "OpenLibrary", value: openLibrarySearchScriptSlug },
							{ label: "Google Books", value: googleBooksSearchScriptSlug },
						]}
						onChange={(value) => setSearchScriptSlug(value)}
					/>

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

					{importError ? (
						<Alert color="red" title="Import failed">
							{importError}
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
									<Button
										variant="light"
										disabled={importEntityRequest.isPending}
										loading={
											importEntityRequest.isPending &&
											importingIdentifier === item.identifier
										}
										onClick={() => importEntityRequest.mutate(item.identifier)}
									>
										Import
									</Button>
								</Stack>
							</Card>
						))}
					</SimpleGrid>
				</Stack>
			</Container>
		</Box>
	);
}
