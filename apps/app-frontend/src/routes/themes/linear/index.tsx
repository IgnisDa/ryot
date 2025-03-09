import {
	Badge,
	Box,
	Button,
	Card,
	createTheme,
	Divider,
	Flex,
	Grid,
	Group,
	MantineProvider,
	NavLink,
	Paper,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import {
	BookOpen,
	Dumbbell,
	Film,
	Home,
	MapPin,
	Moon,
	Search,
	Sun,
	TrendingUp,
	Wine,
} from "lucide-react";
import { useState } from "react";
import { entities, events, savedViews, stats } from "../-common-data";

export const Route = createFileRoute("/themes/linear/")({
	component: LinearTheme,
});

const linearTheme = createTheme({
	fontFamily: "Inter, -apple-system, sans-serif",
	fontFamilyMonospace: "JetBrains Mono, monospace",
	primaryColor: "violet",
	defaultRadius: "md",
	colors: {
		dark: [
			"#EDEDED",
			"#B0B0B0",
			"#808080",
			"#404040",
			"#1E1E1E",
			"#171717",
			"#121212",
			"#0E0E0E",
			"#0A0A0A",
			"#050505",
		],
		violet: [
			"#F5F3FF",
			"#EDE9FE",
			"#DDD6FE",
			"#C4B5FD",
			"#A78BFA",
			"#9333EA",
			"#7E22CE",
			"#6B21A8",
			"#581C87",
			"#4C1D95",
		],
		emerald: [
			"#ECFDF5",
			"#D1FAE5",
			"#A7F3D0",
			"#6EE7B7",
			"#34D399",
			"#10B981",
			"#059669",
			"#047857",
			"#065F46",
			"#064E3B",
		],
		amber: [
			"#FFFBEB",
			"#FEF3C7",
			"#FDE68A",
			"#FCD34D",
			"#FBBF24",
			"#F59E0B",
			"#D97706",
			"#B45309",
			"#92400E",
			"#78350F",
		],
		cyan: [
			"#ECFEFF",
			"#CFFAFE",
			"#A5F3FC",
			"#67E8F9",
			"#22D3EE",
			"#06B6D4",
			"#0891B2",
			"#0E7490",
			"#155E75",
			"#164E63",
		],
	},
});

function LinearTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");

	return (
		<MantineProvider theme={linearTheme} forceColorScheme={colorScheme}>
			<Flex h="100vh" bg="dark.8">
				<Box
					w={280}
					bg="dark.9"
					style={{ borderRight: "1px solid rgba(255, 255, 255, 0.06)" }}
				>
					<Stack gap={0} h="100%">
						<Box p="md">
							<Text size="xl" fw={700} c="dark.0">
								Ryot
							</Text>
							<Text size="xs" c="dark.2" tt="uppercase" mt={4}>
								Linear Theme
							</Text>
						</Box>

						<Box px="xs" py="sm">
							<TextInput
								placeholder="Search..."
								leftSection={<Search size={16} />}
								size="sm"
								styles={{
									input: {
										backgroundColor: "var(--mantine-color-dark-8)",
										border: "1px solid rgba(255, 255, 255, 0.08)",
										color: "var(--mantine-color-dark.0)",
										transition: "all 0.2s ease",
										"&:focus": {
											borderColor: "var(--mantine-color-violet-5)",
											boxShadow: "0 0 0 2px rgba(147, 51, 234, 0.2)",
										},
									},
								}}
							/>
						</Box>

						<Divider color="rgba(255, 255, 255, 0.06)" />

						<Stack gap={2} p="xs" style={{ flex: 1, overflowY: "auto" }}>
							<NavLink
								label="Home"
								leftSection={<Home size={18} />}
								color="dark.0"
								variant="subtle"
								styles={{
									root: {
										borderRadius: 6,
										"&:hover": {
											backgroundColor: "var(--mantine-color-dark-5)",
										},
									},
								}}
							/>

							<Box mt="md">
								<Text
									size="xs"
									c="dark.2"
									tt="uppercase"
									px="sm"
									mb={4}
									fw={600}
								>
									Tracking
								</Text>

								<NavLink
									label="Media"
									leftSection={<Film size={18} />}
									color="violet.5"
									defaultOpened
									styles={{
										root: { borderRadius: 6 },
										label: { color: "var(--mantine-color-dark-0)" },
									}}
								>
									<NavLink label="Movies" color="violet.5" />
									<NavLink label="Books" color="violet.5" />
									<NavLink label="TV Shows" color="violet.5" />
								</NavLink>

								<NavLink
									label="Fitness"
									leftSection={<Dumbbell size={18} />}
									color="emerald.5"
									styles={{
										root: { borderRadius: 6 },
										label: { color: "var(--mantine-color-dark-0)" },
									}}
								>
									<NavLink label="Workouts" color="emerald.5" />
									<NavLink label="Measurements" color="emerald.5" />
								</NavLink>

								<NavLink
									label="Whiskey"
									leftSection={<Wine size={18} />}
									color="amber.5"
									styles={{
										root: { borderRadius: 6 },
										label: { color: "var(--mantine-color-dark-0)" },
									}}
								/>

								<NavLink
									label="Places"
									leftSection={<MapPin size={18} />}
									color="dark.0"
									styles={{
										root: { borderRadius: 6 },
										label: { color: "var(--mantine-color-dark-0)" },
									}}
								/>
							</Box>

							<Box mt="md">
								<Text
									size="xs"
									c="dark.2"
									tt="uppercase"
									px="sm"
									mb={4}
									fw={600}
								>
									Library
								</Text>
								{savedViews.map((view) => (
									<NavLink
										key={view.id}
										label={view.name}
										leftSection={<BookOpen size={18} />}
										color="dark.0"
										styles={{
											root: { borderRadius: 6 },
											label: { color: "var(--mantine-color-dark-1)" },
										}}
									/>
								))}
							</Box>
						</Stack>
					</Stack>
				</Box>

				<Box flex={1} style={{ overflowY: "auto" }}>
					<Box p="xl">
						<Group justify="space-between" mb="xl">
							<Box>
								<Title order={1} c="dark.0" fw={700}>
									Dashboard
								</Title>
								<Text c="dark.1" size="sm" mt={4}>
									Your personal tracking overview
								</Text>
							</Box>
							<Group>
								<Button
									variant="subtle"
									color="dark"
									size="sm"
									onClick={() =>
										setColorScheme(colorScheme === "dark" ? "light" : "dark")
									}
									leftSection={
										colorScheme === "dark" ? (
											<Sun size={16} />
										) : (
											<Moon size={16} />
										)
									}
								>
									{colorScheme === "dark" ? "Light" : "Dark"}
								</Button>
								<Button
									variant="filled"
									color="violet"
									styles={{
										root: {
											transition: "all 0.2s ease",
											"&:hover": {
												backgroundColor: "var(--mantine-color-violet-6)",
												transform: "translateY(-1px)",
												boxShadow:
													"0 8px 16px rgba(147, 51, 234, 0.4), 0 0 20px rgba(147, 51, 234, 0.3)",
											},
										},
									}}
								>
									Log Activity
								</Button>
							</Group>
						</Group>

						<Grid mb="xl">
							{stats.map((stat, idx) => {
								const borderColors = [
									"violet.5",
									"emerald.5",
									"cyan.5",
									"amber.5",
								];
								return (
									<Grid.Col key={stat.label} span={3}>
										<Card
											p="lg"
											bg="dark.7"
											style={{
												border: "1px solid rgba(255, 255, 255, 0.08)",
												borderBottom: `3px solid var(--mantine-color-${borderColors[idx % borderColors.length]})`,
												transition: "all 0.2s ease",
											}}
											styles={{
												root: {
													"&:hover": {
														transform: "translateY(-2px)",
														boxShadow:
															"0 8px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(147, 51, 234, 0.15)",
													},
												},
											}}
										>
											<Stack gap={4}>
												<Text
													size="xs"
													c="dark.2"
													tt="uppercase"
													fw={600}
													style={{ letterSpacing: "0.5px" }}
												>
													{stat.label}
												</Text>
												<Text size="2rem" fw={700} c="dark.0" lh={1}>
													{stat.value}
												</Text>
												{stat.change && (
													<Group gap={4}>
														<TrendingUp
															size={12}
															color="var(--mantine-color-emerald-5)"
														/>
														<Text size="xs" c="emerald.5">
															{stat.change}
														</Text>
													</Group>
												)}
											</Stack>
										</Card>
									</Grid.Col>
								);
							})}
						</Grid>

						<Title order={2} size="h3" c="dark.0" fw={600} mb="md">
							Recent Entities
						</Title>
						<Grid mb="xl">
							{entities.slice(0, 6).map((entity) => (
								<Grid.Col key={entity.id} span={4}>
									<Card
										p={0}
										bg="dark.7"
										style={{
											border: "1px solid rgba(255, 255, 255, 0.08)",
											cursor: "pointer",
											transition: "all 0.25s ease",
											overflow: "hidden",
										}}
										styles={{
											root: {
												"&:hover": {
													transform: "translateY(-4px)",
													boxShadow:
														"0 12px 24px rgba(0, 0, 0, 0.5), 0 0 24px rgba(147, 51, 234, 0.2)",
													border: "1px solid rgba(147, 51, 234, 0.3)",
												},
											},
										}}
									>
										{entity.image && (
											<Box
												h={180}
												style={{
													backgroundImage: `url(${entity.image})`,
													backgroundSize: "cover",
													backgroundPosition: "center",
													transition: "all 0.3s ease",
												}}
												className="entity-image"
											/>
										)}
										{!entity.image && (
											<Box
												h={180}
												bg="dark.8"
												style={{
													display: "grid",
													placeItems: "center",
												}}
											>
												<Text c="dark.3" size="sm">
													No image
												</Text>
											</Box>
										)}
										<Box p="md">
											<Group justify="space-between" mb={4}>
												<Text fw={600} c="dark.0" size="sm">
													{entity.name}
												</Text>
												{entity.properties.rating && (
													<Badge
														size="sm"
														color="violet"
														variant="light"
														styles={{
															root: {
																backgroundColor: "rgba(147, 51, 234, 0.2)",
																color: "var(--mantine-color-violet-4)",
																border: "1px solid rgba(147, 51, 234, 0.3)",
															},
														}}
													>
														{entity.properties.rating}
													</Badge>
												)}
											</Group>
											<Text size="xs" c="dark.2" mb={8}>
												{entity.schemaName}
											</Text>
											<Text size="xs" c="dark.1">
												{entity.lastEvent}
											</Text>
										</Box>
									</Card>
								</Grid.Col>
							))}
						</Grid>

						<Title order={2} size="h3" c="dark.0" fw={600} mb="md">
							Recent Activity
						</Title>
						<Paper
							bg="dark.4"
							p="md"
							style={{ border: "1px solid var(--mantine-color-dark-3)" }}
						>
							<Stack gap="sm">
								{events.map((event, idx) => (
									<Box key={event.id}>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="xs" mb={4}>
													<Text fw={600} c="dark.0" size="sm">
														{event.entityName}
													</Text>
													<Badge
														size="xs"
														color="dark.3"
														variant="light"
														styles={{
															root: {
																backgroundColor: "var(--mantine-color-dark-5)",
																color: "var(--mantine-color-dark-1)",
															},
														}}
													>
														{event.schemaName}
													</Badge>
												</Group>
												<Text size="xs" c="dark.1" mb={4}>
													{event.type} · {event.occurredAt}
												</Text>
												{Object.keys(event.properties).length > 0 && (
													<Text size="xs" c="dark.2">
														{Object.entries(event.properties)
															.map(([key, value]) => `${key}: ${value}`)
															.join(" · ")}
													</Text>
												)}
											</Box>
										</Group>
										{idx < events.length - 1 && (
											<Divider color="dark.3" mt="sm" />
										)}
									</Box>
								))}
							</Stack>
						</Paper>
					</Box>
				</Box>
			</Flex>
		</MantineProvider>
	);
}
