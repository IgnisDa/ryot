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

export const Route = createFileRoute("/themes/supabase/")({
	component: SupabaseTheme,
});

const supabaseTheme = createTheme({
	fontFamily: "Inter, -apple-system, sans-serif",
	fontFamilyMonospace: "JetBrains Mono, monospace",
	primaryColor: "green",
	defaultRadius: "lg",
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
		green: [
			"#E6FCF5",
			"#C3F9E5",
			"#9EF3D4",
			"#6EEAC0",
			"#3ECF8E",
			"#10B981",
			"#0D9668",
			"#0A7550",
			"#075439",
			"#043422",
		],
		blue: [
			"#EFF6FF",
			"#DBEAFE",
			"#BFDBFE",
			"#93C5FD",
			"#60A5FA",
			"#3B82F6",
			"#2563EB",
			"#1D4ED8",
			"#1E40AF",
			"#1E3A8A",
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

function SupabaseTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");

	return (
		<MantineProvider theme={supabaseTheme} forceColorScheme={colorScheme}>
			<Flex h="100vh" bg="dark.8">
				<Box
					w={280}
					bg="dark.9"
					style={{ borderRight: "1px solid rgba(255, 255, 255, 0.06)" }}
				>
					<Stack gap={0} h="100%">
						<Box p="md">
							<Group gap="xs">
								<Box
									w={32}
									h={32}
									bg="green.5"
									style={{
										borderRadius: 8,
										display: "grid",
										placeItems: "center",
									}}
								>
									<Text size="lg" fw={700} c="white">
										R
									</Text>
								</Box>
								<Box>
									<Text size="xl" fw={700} c="dark.0">
										Ryot
									</Text>
								</Box>
							</Group>
							<Text size="xs" c="dark.1" mt={4}>
								Supabase Theme
							</Text>
						</Box>

						<Box px="xs" py="sm">
							<TextInput
								placeholder="Search..."
								leftSection={<Search size={16} />}
								size="sm"
								styles={{
									input: {
										backgroundColor: "var(--mantine-color-dark-6)",
										border: "1px solid var(--mantine-color-dark-3)",
										color: "var(--mantine-color-dark-0)",
										"&:focus": {
											borderColor: "var(--mantine-color-green-5)",
											boxShadow: "0 0 0 2px rgba(62, 207, 142, 0.1)",
										},
									},
								}}
							/>
						</Box>

						<Divider color="dark.3" />

						<Stack gap={4} p="xs" style={{ flex: 1, overflowY: "auto" }}>
							<NavLink
								label="Home"
								leftSection={<Home size={18} />}
								color="green.5"
								variant="subtle"
								styles={{
									root: {
										borderRadius: 8,
										"&:hover": {
											backgroundColor: "var(--mantine-color-dark-5)",
										},
									},
									label: { fontWeight: 500 },
								}}
							/>

							<Box mt="md">
								<Text
									size="xs"
									c="dark.1"
									tt="uppercase"
									px="sm"
									mb={6}
									fw={600}
								>
									Tracking
								</Text>

								<NavLink
									label="Media"
									leftSection={<Film size={18} />}
									color="blue.5"
									defaultOpened
									styles={{
										root: { borderRadius: 8 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 500,
										},
									}}
								>
									<NavLink
										label="Movies"
										color="blue.5"
										styles={{ label: { fontWeight: 400 } }}
									/>
									<NavLink
										label="Books"
										color="blue.5"
										styles={{ label: { fontWeight: 400 } }}
									/>
									<NavLink
										label="TV Shows"
										color="blue.5"
										styles={{ label: { fontWeight: 400 } }}
									/>
								</NavLink>

								<NavLink
									label="Fitness"
									leftSection={<Dumbbell size={18} />}
									color="green.5"
									styles={{
										root: { borderRadius: 8 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 500,
										},
									}}
								>
									<NavLink
										label="Workouts"
										color="green.5"
										styles={{ label: { fontWeight: 400 } }}
									/>
									<NavLink
										label="Measurements"
										color="green.5"
										styles={{ label: { fontWeight: 400 } }}
									/>
								</NavLink>

								<NavLink
									label="Whiskey"
									leftSection={<Wine size={18} />}
									color="dark.0"
									styles={{
										root: { borderRadius: 8 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 500,
										},
									}}
								/>

								<NavLink
									label="Places"
									leftSection={<MapPin size={18} />}
									color="dark.0"
									styles={{
										root: { borderRadius: 8 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 500,
										},
									}}
								/>
							</Box>

							<Box mt="md">
								<Text
									size="xs"
									c="dark.1"
									tt="uppercase"
									px="sm"
									mb={6}
									fw={600}
								>
									Library
								</Text>
								{savedViews.map((view) => (
									<NavLink
										key={view.id}
										label={view.name}
										leftSection={<BookOpen size={18} />}
										color="dark.1"
										styles={{
											root: { borderRadius: 8 },
											label: {
												color: "var(--mantine-color-dark-1)",
												fontWeight: 400,
											},
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
							<Group gap="sm">
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
									color="green"
									size="md"
									styles={{
										root: {
											transition: "all 0.2s ease",
											"&:hover": {
												backgroundColor: "var(--mantine-color-green-6)",
												transform: "translateY(-1px)",
												boxShadow:
													"0 8px 16px rgba(16, 185, 129, 0.4), 0 0 20px rgba(16, 185, 129, 0.3)",
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
								const borderColors = ["green.5", "blue.5", "cyan.5", "green.6"];
								return (
									<Grid.Col key={stat.label} span={3}>
										<Card
											p="lg"
											bg="dark.7"
											radius="lg"
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
															"0 8px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(16, 185, 129, 0.15)",
													},
												},
											}}
										>
											<Stack gap={6}>
												<Text
													size="xs"
													c="dark.1"
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
															size={14}
															color="var(--mantine-color-green-5)"
														/>
														<Text size="xs" c="green.5" fw={500}>
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
										radius="lg"
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
														"0 12px 24px rgba(0, 0, 0, 0.5), 0 0 24px rgba(16, 185, 129, 0.2)",
													border: "1px solid rgba(16, 185, 129, 0.3)",
												},
											},
										}}
									>
										{entity.image && (
											<Box
												h={200}
												style={{
													backgroundImage: `url(${entity.image})`,
													backgroundSize: "cover",
													backgroundPosition: "center",
												}}
											/>
										)}
										{!entity.image && (
											<Box
												h={200}
												bg="dark.5"
												style={{
													display: "grid",
													placeItems: "center",
												}}
											>
												<Text c="dark.2" size="sm" fw={500}>
													No image
												</Text>
											</Box>
										)}
										<Box p="md">
											<Group justify="space-between" mb={6}>
												<Text fw={600} c="dark.0" size="sm">
													{entity.name}
												</Text>
												{entity.properties.rating && (
													<Badge
														size="sm"
														color="green"
														variant="light"
														styles={{
															root: {
																backgroundColor: "rgba(62, 207, 142, 0.15)",
																color: "var(--mantine-color-green-4)",
																fontWeight: 600,
															},
														}}
													>
														{entity.properties.rating}
													</Badge>
												)}
											</Group>
											<Text size="xs" c="dark.1" mb={8} fw={500}>
												{entity.schemaName}
											</Text>
											<Text size="xs" c="dark.2">
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
							p="lg"
							radius="lg"
							style={{ border: "1px solid var(--mantine-color-dark-3)" }}
						>
							<Stack gap="md">
								{events.map((event, idx) => (
									<Box key={event.id}>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="xs" mb={6}>
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
																fontWeight: 500,
															},
														}}
													>
														{event.schemaName}
													</Badge>
												</Group>
												<Text size="xs" c="dark.1" mb={6}>
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
											<Divider color="dark.3" mt="md" />
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
