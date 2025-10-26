import {
	Anchor,
	Box,
	Button,
	Container,
	Flex,
	Grid,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useApiClient } from "#/hooks/api";
import { useAuthClient } from "#/hooks/auth";

export const Route = createFileRoute("/_protected/")({
	component: App,
});

function App() {
	const apiClient = useApiClient();
	const authClient = useAuthClient();
	const { user } = Route.useRouteContext();

	const entitySchemasQuery = apiClient.useQuery("get", "/entity-schemas/list");

	const runMutation = useMutation({
		mutationFn: async () => {
			const response = await authClient.apiKey.create();
			return response.data;
		},
	});

	return (
		<Container size="lg" px="md" pb={32} pt={56}>
			<Paper
				shadow="md"
				radius="xl"
				p={{ base: 24, sm: 40 }}
				pos="relative"
				style={{ overflow: "hidden" }}
			>
				<Button onClick={() => runMutation.mutate()}>Create API Key</Button>
				{runMutation.data?.key && <Text>API Key: {runMutation.data.key}</Text>}
				<pre>{JSON.stringify(entitySchemasQuery.data, null, 2)}</pre>
				{JSON.stringify(user, null, 3)}
				<Box
					pos="absolute"
					left={-80}
					top={-96}
					h={224}
					w={224}
					style={{
						borderRadius: "50%",
						background:
							"radial-gradient(circle, rgba(79, 184, 178, 0.32), transparent 66%)",
						pointerEvents: "none",
					}}
				/>
				<Box
					pos="absolute"
					bottom={-80}
					right={-80}
					h={224}
					w={224}
					style={{
						borderRadius: "50%",
						background:
							"radial-gradient(circle, rgba(47, 106, 74, 0.18), transparent 66%)",
						pointerEvents: "none",
					}}
				/>
				<Text c="teal" size="sm" fw={600} mb={12}>
					TanStack Start Base Template
				</Text>
				<Title order={1} size="3rem" lh={1.02} fw={700} maw={768} mb={20}>
					Island hours, but for product teams.
				</Title>
				<Text c="dimmed" size="lg" maw={672} mb={32}>
					A tropical, breathable app starter with full-document SSR, server
					functions, streaming, and type-safe routing. Calm on the eyes. Fast in
					production.
				</Text>
				<Flex gap="md" wrap="wrap">
					<Anchor
						href="/blog"
						px={20}
						py={10}
						style={{
							borderRadius: 9999,
							border: "1px solid rgba(50, 143, 151, 0.3)",
							background: "rgba(79, 184, 178, 0.14)",
							fontSize: "0.875rem",
							fontWeight: 600,
							color: "var(--mantine-color-teal-7)",
							textDecoration: "none",
							transition: "all 0.2s",
						}}
					>
						Explore Posts
					</Anchor>
					<Anchor
						href="https://tanstack.com/router"
						target="_blank"
						rel="noopener noreferrer"
						px={20}
						py={10}
						style={{
							borderRadius: 9999,
							border: "1px solid rgba(23, 58, 64, 0.2)",
							background: "rgba(255, 255, 255, 0.5)",
							fontSize: "0.875rem",
							fontWeight: 600,
							textDecoration: "none",
							transition: "all 0.2s",
						}}
					>
						Router Guide
					</Anchor>
				</Flex>
			</Paper>

			<Grid mt={32}>
				{[
					[
						"Type-Safe Routing",
						"Routes and links stay in sync across every page.",
					],
					[
						"Server Functions",
						"Call server code from your UI without creating API boilerplate.",
					],
					[
						"Streaming by Default",
						"Ship progressively rendered responses for faster experiences.",
					],
					[
						"Mantine Components",
						"Build quickly with a comprehensive component library.",
					],
				].map(([title, desc]) => (
					<Grid.Col key={title} span={{ base: 12, sm: 6, lg: 3 }}>
						<Paper shadow="sm" radius="md" p="lg">
							<Stack gap="xs">
								<Text fw={600}>{title}</Text>
								<Text c="dimmed" size="sm">
									{desc}
								</Text>
							</Stack>
						</Paper>
					</Grid.Col>
				))}
			</Grid>

			<Paper shadow="sm" radius="md" p="xl" mt={32}>
				<Text c="teal" size="sm" fw={600} mb={8}>
					Quick Start
				</Text>
				<Stack gap="sm">
					<Text size="sm" c="dimmed">
						• Edit <code>src/routes/index.tsx</code> to customize the hero and
						product narrative.
					</Text>
					<Text size="sm" c="dimmed">
						• Update <code>src/components/Header.tsx</code> and{" "}
						<code>src/components/Footer.tsx</code> for brand links.
					</Text>
					<Text size="sm" c="dimmed">
						• Add routes in <code>src/routes</code> and tweak visual tokens in{" "}
						<code>src/styles.css</code>.
					</Text>
				</Stack>
			</Paper>
		</Container>
	);
}
