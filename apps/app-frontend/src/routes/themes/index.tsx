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
						Explore four bold, distinctive design aesthetics for Ryot's
						interface
					</Text>
				</Box>

				<Stack gap="md">
					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Brutalist Theme
								</Text>
								<Text c="dimmed" size="sm">
									Bold Swiss design with sharp geometric shapes, uppercase
									typography, zero border radius, and offset box shadows. Red
									and blue accents on rich black backgrounds.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/brutalist">
									<Button variant="filled" color="red">
										View Brutalist Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>

					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Terminal Theme
								</Text>
								<Text c="dimmed" size="sm">
									Retro-futuristic hacker aesthetic with neon green, cyan, and
									purple colors. Monospace Fira Code font, scanline effects, and
									glowing borders for a terminal-inspired experience.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/terminal">
									<Button variant="filled" color="green">
										View Terminal Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>

					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Editorial Theme
								</Text>
								<Text c="dimmed" size="sm">
									Elegant magazine-style design with Playfair Display and Lora
									serif fonts. Gold and sage green accents on cream backgrounds
									with generous spacing and sophisticated typography.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/editorial">
									<Button variant="filled" color="yellow">
										View Editorial Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>

					<Paper p="xl" withBorder radius="lg">
						<Stack gap="md">
							<Box>
								<Text fw={700} size="xl" mb={4}>
									Pastel Theme
								</Text>
								<Text c="dimmed" size="sm">
									Soft, playful, toy-like design with bubbly pastel colors.
									Space Grotesk and Outfit fonts, rounded corners, smooth
									animations, and delightful interactions on cream backgrounds.
								</Text>
							</Box>
							<Group>
								<Link to="/themes/pastel">
									<Button
										variant="gradient"
										gradient={{ from: "pink", to: "violet", deg: 135 }}
									>
										View Pastel Theme
									</Button>
								</Link>
							</Group>
						</Stack>
					</Paper>
				</Stack>

				<Paper p="lg" withBorder radius="lg" bg="blue.0">
					<Text size="sm" c="blue.9">
						<strong>Note:</strong> These are full immersive previews with sample
						data. Each theme showcases a completely unique design direction with
						distinctive typography, colors, and interactions.
					</Text>
				</Paper>
			</Stack>
		</Container>
	);
}
