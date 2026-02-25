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
	Select,
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

function SchemaSearchPage() {
	const apiClient = useApiClient();
	const authClient = useAuthClient();
	const navigate = Route.useNavigate();
	const [page, setPage] = useState(1);
	const [query, setQuery] = useState("harry potter");
	const [selectedSearchScriptId, setSelectedSearchScriptId] = useState<
		string | null
	>(null);
	const [importingIdentifier, setImportingIdentifier] = useState<string | null>(
		null,
	);

	const trimmedQuery = query.trim();

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const schemasQuery = useQuery({
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		queryKey: ["entity-schemas-list"],
		queryFn: async () => {
			const response = await apiClient.protected["entity-schemas"].list.$get();
			const payload = await response.json();
			return payload;
		},
	});

	const searchScripts = schemasQuery.data?.schemas.flatMap((schema) =>
		schema.scripts
			.filter((script) => script.type === "search")
			.map((script) => ({
				value: script.id,
				schemaId: schema.id,
				label: `${schema.name} - ${script.name}`,
			})),
	);

	useEffect(() => {
		if (searchScripts && searchScripts.length > 0 && !selectedSearchScriptId) {
			setSelectedSearchScriptId(searchScripts[0].value);
		}
	}, [searchScripts, selectedSearchScriptId]);

	const searchRequest = useQuery({
		refetchOnMount: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		enabled: Boolean(trimmedQuery && selectedSearchScriptId),
		queryKey: [
			"entity-schema-search",
			trimmedQuery,
			selectedSearchScriptId,
			page,
		],
		queryFn: async () => {
			if (!selectedSearchScriptId) throw new Error("No search script selected");

			const response = await apiClient.protected["entity-schemas"].search.$post(
				{
					json: {
						page,
						query: trimmedQuery,
						search_script_id: selectedSearchScriptId,
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

	const detailsScripts = schemasQuery.data?.schemas
		.find((schema) =>
			schema.scripts.some(
				(script) =>
					script.type === "search" && script.id === selectedSearchScriptId,
			),
		)
		?.scripts.filter((script) => script.type === "details");

	const importEntityRequest = useMutation({
		mutationFn: async (identifier: string) => {
			const detailsScript = detailsScripts?.[0];
			if (!detailsScript) throw new Error("No details script available");

			const response = await apiClient.protected["entity-schemas"].import.$post(
				{ json: { identifier, details_script_id: detailsScript.id } },
			);

			const payload = await response.json();

			if ("error" in payload)
				throw new Error("Import returned invalid payload");

			return payload.entityId;
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
							Search and import entities from various sources. Select a search
							script below to get started.
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

					<Select
						searchable
						label="Search Script"
						data={searchScripts ?? []}
						value={selectedSearchScriptId}
						onChange={(value) => setSelectedSearchScriptId(value)}
						placeholder={
							schemasQuery.isPending
								? "Loading schemas..."
								: "Select a search script"
						}
						disabled={schemasQuery.isPending || !searchScripts?.length}
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
