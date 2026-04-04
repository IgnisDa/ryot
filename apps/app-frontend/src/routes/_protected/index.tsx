import {
	Box,
	Button,
	Container,
	Flex,
	Loader,
	Paper,
	Text,
	Title,
} from "@mantine/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTrackersQuery } from "~/features/trackers/hooks";

export const Route = createFileRoute("/_protected/")({
	component: App,
});

function App() {
	const trackersQuery = useTrackersQuery();

	const hasEnabledTrackers = trackersQuery.enabledTrackers.length > 0;

	return (
		<Container size="lg" px="md" pb={32} pt={56}>
			<Paper
				shadow="md"
				radius="xl"
				pos="relative"
				p={{ base: 24, sm: 40 }}
				style={{ overflow: "hidden" }}
			>
				<Box
					h={224}
					w={224}
					top={-96}
					left={-80}
					pos="absolute"
					style={{
						borderRadius: "50%",
						pointerEvents: "none",
						background:
							"radial-gradient(circle, rgba(79, 184, 178, 0.32), transparent 66%)",
					}}
				/>
				<Box
					h={224}
					w={224}
					right={-80}
					bottom={-80}
					pos="absolute"
					style={{
						borderRadius: "50%",
						pointerEvents: "none",
						background:
							"radial-gradient(circle, rgba(47, 106, 74, 0.18), transparent 66%)",
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
				{trackersQuery.isLoading && (
					<Flex justify="center" p={24}>
						<Loader size="sm" />
					</Flex>
				)}

				{!trackersQuery.isLoading && trackersQuery.isError && (
					<Flex align="center" direction="column" gap="xs">
						<Text c="red" size="sm">
							Failed to load trackers.
						</Text>
						<Button
							size="xs"
							variant="light"
							onClick={() => trackersQuery.refetch()}
						>
							Retry
						</Button>
					</Flex>
				)}

				{!trackersQuery.isLoading &&
					!trackersQuery.isError &&
					!hasEnabledTrackers && (
						<Text c="dimmed" size="sm">
							No enabled trackers yet. Hover the Tracking header in the sidebar
							and click + to create one.
						</Text>
					)}

				{!trackersQuery.isLoading &&
					!trackersQuery.isError &&
					hasEnabledTrackers && (
						<Flex gap="md" wrap="wrap">
							{trackersQuery.enabledTrackers.map((tracker) => (
								<Link
									key={tracker.slug}
									to="/$trackerSlug"
									params={{ trackerSlug: tracker.slug }}
									style={{
										fontWeight: 600,
										borderRadius: 9999,
										padding: "10px 20px",
										fontSize: "0.875rem",
										transition: "all 0.2s",
										textDecoration: "none",
										display: "inline-block",
										color: "var(--mantine-color-teal-7)",
										background: "rgba(79, 184, 178, 0.14)",
										border: "1px solid rgba(50, 143, 151, 0.3)",
									}}
								>
									{tracker.name}
								</Link>
							))}
						</Flex>
					)}
			</Paper>
		</Container>
	);
}
