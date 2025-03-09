import {
	Box,
	Button,
	Container,
	Group,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/themes/")({
	component: ThemeIndex,
});

function ThemeIndex() {
	return (
		<Container size="md" py={60}>
			<Stack gap="xl">
				<Box>
					<Title order={1} mb="sm">
						Ryot Theme Showcase
					</Title>
					<Text c="dimmed" size="lg">
						Compare four design system approaches for Ryot's interface
					</Text>
				</Box>

				<Stack gap="md">
					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Linear-inspired Theme
								</Text>
								<Text c="dimmed" size="sm">
									Data-dense, keyboard-first, dark mode excellence. Violet
									accent for Media, Emerald for Fitness, Amber for custom
									trackers.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/linear">
									<Button variant="filled" color="violet">
										View Linear Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>

					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Supabase-inspired Theme
								</Text>
								<Text c="dimmed" size="sm">
									Developer-first aesthetic with documentation quality. Fresh
									green accent, approachable and muted.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/supabase">
									<Button variant="filled" color="teal">
										View Supabase Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>

					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Raycast-inspired Theme
								</Text>
								<Text c="dimmed" size="sm">
									Command-centric productivity with spotlight-style search.
									Extensions model with red accent, fast interactions.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/raycast">
									<Button variant="filled" color="red">
										View Raycast Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>

					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Arc Browser-inspired Theme
								</Text>
								<Text c="dimmed" size="sm">
									Consumer-grade polish with gradients and depth. Sidebar-first,
									color-coded spaces, modern experience.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/arc">
									<Button
										variant="gradient"
										gradient={{ from: "violet", to: "purple", deg: 135 }}
									>
										View Arc Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>
				</Stack>

				<Paper p="lg" withBorder radius="lg" bg="blue.0">
					<Text size="sm" c="blue.9">
						<strong>Note:</strong> These are full immersive previews with sample
						data. All four themes use the same components and layout but with
						different color schemes, typography, and visual polish.
					</Text>
				</Paper>
			</Stack>
		</Container>
	);
}
