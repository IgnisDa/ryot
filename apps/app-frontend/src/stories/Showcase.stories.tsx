import {
	Badge,
	Button,
	Group,
	Paper,
	Progress,
	SimpleGrid,
	Stack,
	Text,
	ThemeIcon,
	useComputedColorScheme,
} from "@mantine/core";
import { MoonStar, Sparkles, Sun } from "lucide-react";
import preview from "#.storybook/preview";

function ThemeShowcase(_props: Record<string, never>) {
	const scheme = useComputedColorScheme("light");
	const SchemeIcon = scheme === "dark" ? MoonStar : Sun;
	const schemeColor = scheme === "dark" ? "violet" : "orange";

	return (
		<Paper p="xl" mx="auto" maw={760} radius="lg" withBorder>
			<Stack gap="xl">
				<Group align="flex-start" justify="space-between">
					<Stack gap={6}>
						<Text c="dimmed" fw={700} size="xs" tt="uppercase">
							Theme Showcase
						</Text>
						<Text fw={700} size="xl">
							Switch themes to inspect how Mantine restyles the same UI
						</Text>
						<Text c="dimmed" maw={540} size="sm">
							The layout stays fixed, while surfaces, borders, text contrast,
							and default variants react to the toolbar theme.
						</Text>
					</Stack>
					<Badge
						size="lg"
						variant="light"
						color={schemeColor}
						leftSection={<SchemeIcon size={14} />}
					>
						{scheme} mode
					</Badge>
				</Group>

				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
					<Paper p="lg" radius="md" withBorder>
						<Stack gap="md">
							<Group justify="space-between">
								<ThemeIcon color="teal" radius="md" size="lg" variant="light">
									<Sparkles size={16} />
								</ThemeIcon>
								<Badge color="teal" variant="dot">
									Adaptive surface
								</Badge>
							</Group>
							<Stack gap={4}>
								<Text fw={600}>Readable at a glance</Text>
								<Text c="dimmed" size="sm">
									Neutral surfaces and secondary copy shift tone with the active
									theme without changing the content.
								</Text>
							</Stack>
							<Progress color="teal" radius="xl" size="sm" value={72} />
						</Stack>
					</Paper>

					<Paper p="lg" radius="md" withBorder>
						<Stack gap="md">
							<Group justify="space-between">
								<Text fw={600}>Contrast check</Text>
								<Badge color={schemeColor} variant="light">
									{scheme === "dark" ? "Low-glare" : "High-clarity"}
								</Badge>
							</Group>
							<Text c="dimmed" size="sm">
								This card uses the same Mantine tokens in both modes, so
								buttons, borders, and copy reveal the theme change immediately.
							</Text>
							<Group>
								<Button variant="default">Default</Button>
								<Button variant="light">Quiet</Button>
							</Group>
						</Stack>
					</Paper>
				</SimpleGrid>

				<Paper p="lg" radius="md" withBorder>
					<Group align="center" justify="space-between">
						<Stack gap={4}>
							<Text fw={600}>Action row</Text>
							<Text c="dimmed" size="sm">
								Try the toolbar switcher now - the badge, surface tone, and
								default button treatment should all respond.
							</Text>
						</Stack>
						<Group>
							<Button variant="subtle">Subtle</Button>
							<Button>Primary action</Button>
						</Group>
					</Group>
				</Paper>
			</Stack>
		</Paper>
	);
}

const meta = preview.meta({
	title: "Mantine/Showcase",
});

export const ThemeModes = meta.story({
	render: () => <ThemeShowcase />,
});
