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
import type { AppType } from "@ryot/app-backend";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { hc } from "hono/client";
import { useEffect, useState } from "react";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/schema-search")({
	component: SchemaSearchPage,
});

const api = hc<AppType>("/api");

function SchemaSearchPage() {
	const authClient = useAuthClient();
	const [page, setPage] = useState(1);
	const [query, setQuery] = useState("harry potter");
	const [schemaSlug, setSchemaSlug] = useState("book");

	useEffect(() => {
		void authClient.signIn.anonymous();
	}, [authClient]);

	const search = useQuery({
		queryKey: ["entity-schema-search", schemaSlug, query.trim(), page],
		enabled: Boolean(schemaSlug.trim()) && Boolean(query.trim()),
		queryFn: async () => {
			const response = await api.protected["entity-schemas"][
				":schemaSlug"
			].search.$post({
				json: { page, query: query.trim() },
				param: { schemaSlug: schemaSlug.trim() },
			});

			const payload = await response.json();
			if ("error" in payload) throw new Error(payload.error);

			return payload;
		},
	});

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
							Calls `/api/protected/entity-schemas/:schemaSlug/search` with
							React Query.
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

					{search.isLoading ? (
						<Group>
							<Loader size="sm" />
							<Text size="sm" c="dimmed">
								Searching...
							</Text>
						</Group>
					) : null}

					{search.error ? (
						<Alert color="red" title="Search failed">
							{search.error.message}
						</Alert>
					) : null}

					{search.data ? (
						<Group>
							<Badge color="blue" variant="light">
								Total: {search.data.details.total_items}
							</Badge>
							<Badge color="teal" variant="light">
								Next page: {search.data.details.next_page ?? "none"}
							</Badge>
						</Group>
					) : null}

					<SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
						{search.data?.items.map((item) => (
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
