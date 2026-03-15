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
	Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import {
	BookOpen,
	Command,
	Dumbbell,
	Film,
	Home,
	MapPin,
	Moon,
	Search,
	Sun,
	TrendingUp,
	Wine,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { entities, events, savedViews, stats } from "../-common-data";

export const Route = createFileRoute("/themes/raycast/")({
	component: RaycastTheme,
});

const raycastTheme = createTheme({
	fontFamily: "Inter, -apple-system, sans-serif",
	fontFamilyMonospace: "SF Mono, monospace",
	primaryColor: "red",
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
		red: [
			"#FFE5E5",
			"#FFB8B8",
			"#FF8A8A",
			"#FF6363",
			"#FF4545",
			"#FF3B3B",
			"#E62E2E",
			"#CC2929",
			"#B32424",
			"#991F1F",
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
		teal: [
			"#E6FFFA",
			"#B2F5EA",
			"#81E6D9",
			"#4FD1C5",
			"#38B2AC",
			"#319795",
			"#2C7A7B",
			"#285E61",
			"#234E52",
			"#1D4044",
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

function RaycastTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");

	return (
		<MantineProvider theme={raycastTheme} forceColorScheme={colorScheme}>
			<Flex h="100vh" bg="dark.8">
				<Box
					w={280}
					bg="dark.9"
					style={{
						borderRight: "1px solid rgba(255, 255, 255, 0.06)",
						boxShadow: "2px 0 12px rgba(0, 0, 0, 0.3)",
					}}
				>
					<Stack gap={0} h="100%">
						<Box p="md" pb="sm">
							<Group gap="xs" mb={8}>
								<Box
									w={32}
									h={32}
									style={{
										borderRadius: 8,
										background:
											"linear-gradient(135deg, #FF6363 0%, #FF3B3B 100%)",
										display: "grid",
										placeItems: "center",
										boxShadow: "0 2px 8px rgba(255, 99, 99, 0.4)",
									}}
								>
									<Zap size={18} color="white" strokeWidth={2.5} />
								</Box>
								<Box>
									<Text size="xl" fw={700} c="dark.0">
										Ryot
									</Text>
								</Box>
							</Group>
							<Group gap={4} c="dark.1">
								<Command size={12} />
								<Text size="xs">Raycast Theme</Text>
							</Group>
						</Box>

						<Box px="xs" py="xs">
							<Box
								p="xs"
								style={{
									borderRadius: 8,
									border: "1.5px solid var(--mantine-color-red-5)",
									backgroundColor: "rgba(255, 99, 99, 0.08)",
									boxShadow: "0 0 0 4px rgba(255, 99, 99, 0.05)",
								}}
							>
								<Group gap="xs" wrap="nowrap">
									<Search size={16} color="var(--mantine-color-red-5)" />
									<Text size="sm" c="dark.0" fw={500}>
										Search everything...
									</Text>
									<Group gap={4} ml="auto">
										<Box
											px={6}
											py={2}
											style={{
												borderRadius: 4,
												backgroundColor: "var(--mantine-color-dark-5)",
												border: "1px solid var(--mantine-color-dark-3)",
											}}
										>
											<Text size="10px" c="dark.1" fw={600}>
												⌘K
											</Text>
										</Box>
									</Group>
								</Group>
							</Box>
						</Box>

						<Divider color="dark.3" />

						<Stack gap={2} p="xs" style={{ flex: 1, overflowY: "auto" }}>
							<NavLink
								label="Home"
								leftSection={<Home size={18} />}
								color="red.4"
								active
								styles={{
									root: {
										borderRadius: 6,
										backgroundColor: "rgba(255, 99, 99, 0.12)",
										"&:hover": {
											backgroundColor: "rgba(255, 99, 99, 0.18)",
										},
									},
									label: {
										fontWeight: 600,
										color: "var(--mantine-color-red-4)",
									},
								}}
							/>

							<Box mt="sm">
								<Group justify="space-between" px="sm" mb={6}>
									<Text size="xs" c="dark.1" tt="uppercase" fw={700}>
										Extensions
									</Text>
									<Text size="10px" c="dark.2" fw={600}>
										4 ACTIVE
									</Text>
								</Group>

								<NavLink
									label="Media"
									leftSection={<Film size={18} />}
									color="violet.5"
									defaultOpened
									styles={{
										root: { borderRadius: 6 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 600,
										},
									}}
								>
									<NavLink
										label="Movies"
										color="violet.5"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: { borderRadius: 6 },
										}}
									/>
									<NavLink
										label="Books"
										color="violet.5"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: { borderRadius: 6 },
										}}
									/>
									<NavLink
										label="TV Shows"
										color="violet.5"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: { borderRadius: 6 },
										}}
									/>
								</NavLink>

								<NavLink
									label="Fitness"
									leftSection={<Dumbbell size={18} />}
									color="teal.5"
									styles={{
										root: { borderRadius: 6 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 600,
										},
									}}
								>
									<NavLink
										label="Workouts"
										color="teal.5"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: { borderRadius: 6 },
										}}
									/>
									<NavLink
										label="Measurements"
										color="teal.5"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: { borderRadius: 6 },
										}}
									/>
								</NavLink>

								<NavLink
									label="Whiskey"
									leftSection={<Wine size={18} />}
									color="dark.0"
									styles={{
										root: { borderRadius: 6 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 600,
										},
									}}
								/>

								<NavLink
									label="Places"
									leftSection={<MapPin size={18} />}
									color="dark.0"
									styles={{
										root: { borderRadius: 6 },
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 600,
										},
									}}
								/>
							</Box>

							<Box mt="sm">
								<Text
									size="xs"
									c="dark.1"
									tt="uppercase"
									px="sm"
									mb={6}
									fw={700}
								>
									Collections
								</Text>
								{savedViews.map((view) => (
									<NavLink
										key={view.id}
										label={view.name}
										leftSection={<BookOpen size={18} />}
										color="dark.1"
										styles={{
											root: { borderRadius: 6 },
											label: {
												color: "var(--mantine-color-dark-1)",
												fontWeight: 500,
												fontSize: 13,
											},
										}}
									/>
								))}
							</Box>
						</Stack>

						<Box
							p="xs"
							style={{
								borderTop: "1px solid var(--mantine-color-dark-3)",
								backgroundColor: "var(--mantine-color-dark-5)",
							}}
						>
							<Group gap="xs" wrap="nowrap">
								<Box
									w={28}
									h={28}
									style={{
										borderRadius: 6,
										background:
											"linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)",
										display: "grid",
										placeItems: "center",
									}}
								>
									<Text size="xs" fw={700} c="white">
										U
									</Text>
								</Box>
								<Box flex={1}>
									<Text size="xs" fw={600} c="dark.0">
										User Account
									</Text>
									<Text size="10px" c="dark.2">
										Settings & Preferences
									</Text>
								</Box>
							</Group>
						</Box>
					</Stack>
				</Box>

				<Box flex={1} style={{ overflowY: "auto" }}>
					<Box p="xl">
						<Group justify="space-between" mb="xl" align="flex-start">
							<Box>
								<Title order={1} c="dark.0" fw={700} size="2rem">
									Dashboard
								</Title>
								<Text c="dark.1" size="sm" mt={4}>
									Your personal tracking command center
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
									color="red"
									size="md"
									leftSection={<Zap size={18} />}
									styles={{
										root: {
											boxShadow: "0 2px 8px rgba(255, 99, 99, 0.3)",
											transition: "all 0.2s ease",
											"&:hover": {
												transform: "translateY(-1px)",
												boxShadow:
													"0 8px 16px rgba(255, 99, 99, 0.5), 0 0 20px rgba(255, 99, 99, 0.3)",
											},
										},
									}}
								>
									Quick Action
								</Button>
							</Group>
						</Group>

						<Grid mb="xl">
							{stats.map((stat, idx) => {
								const borderColors = ["red.5", "teal.5", "cyan.5", "violet.5"];
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
															"0 8px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 99, 99, 0.15)",
													},
												},
											}}
										>
											<Stack gap={6}>
												<Text
													size="xs"
													c="dark.1"
													tt="uppercase"
													fw={700}
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
															color="var(--mantine-color-teal-5)"
														/>
														<Text size="xs" c="teal.5" fw={600}>
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

						<Group justify="space-between" align="center" mb="md">
							<Title order={2} size="h3" c="dark.0" fw={700}>
								Recent Entities
							</Title>
							<Button variant="subtle" color="dark.1" size="sm">
								View All
							</Button>
						</Group>
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
														"0 12px 24px rgba(0, 0, 0, 0.5), 0 0 24px rgba(255, 99, 99, 0.2)",
													border: "1px solid rgba(255, 99, 99, 0.3)",
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
													position: "relative",
												}}
											>
												<Box
													style={{
														position: "absolute",
														top: 8,
														right: 8,
													}}
												>
													{entity.properties.rating && (
														<Badge
															size="md"
															color="red"
															variant="filled"
															styles={{
																root: {
																	fontWeight: 700,
																	backdropFilter: "blur(8px)",
																	backgroundColor: "rgba(255, 99, 99, 0.9)",
																},
															}}
														>
															{entity.properties.rating}
														</Badge>
													)}
												</Box>
											</Box>
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
												<Text c="dark.2" size="sm" fw={600}>
													No image
												</Text>
											</Box>
										)}
										<Box p="md">
											<Text fw={700} c="dark.0" size="sm" mb={6}>
												{entity.name}
											</Text>
											<Badge
												size="xs"
												variant="light"
												color="dark.2"
												mb={8}
												styles={{
													root: {
														backgroundColor: "var(--mantine-color-dark-5)",
														color: "var(--mantine-color-dark-1)",
														fontWeight: 600,
													},
												}}
											>
												{entity.schemaName}
											</Badge>
											<Text size="xs" c="dark.1">
												{entity.lastEvent}
											</Text>
										</Box>
									</Card>
								</Grid.Col>
							))}
						</Grid>

						<Group justify="space-between" align="center" mb="md">
							<Title order={2} size="h3" c="dark.0" fw={700}>
								Activity Stream
							</Title>
							<Button variant="subtle" color="dark.1" size="sm">
								Show More
							</Button>
						</Group>
						<Paper
							bg="dark.4"
							p="md"
							style={{ border: "1px solid var(--mantine-color-dark-3)" }}
						>
							<Stack gap="xs">
								{events.map((event, idx) => (
									<Box key={event.id}>
										<Box
											p="sm"
											style={{
												borderRadius: 6,
												transition: "background-color 0.15s",
												"&:hover": {
													backgroundColor: "var(--mantine-color-dark-5)",
												},
											}}
										>
											<Group
												justify="space-between"
												align="flex-start"
												wrap="nowrap"
											>
												<Box flex={1}>
													<Group gap="xs" mb={6}>
														<Text fw={700} c="dark.0" size="sm">
															{event.entityName}
														</Text>
														<Badge
															size="xs"
															variant="dot"
															color="red"
															styles={{
																root: {
																	backgroundColor: "transparent",
																	color: "var(--mantine-color-dark-1)",
																	paddingLeft: 0,
																	fontWeight: 600,
																},
															}}
														>
															{event.schemaName}
														</Badge>
													</Group>
													<Text size="xs" c="dark.1" mb={6} fw={500}>
														{event.type} · {event.occurredAt}
													</Text>
													{Object.keys(event.properties).length > 0 && (
														<Group gap={8}>
															{Object.entries(event.properties).map(
																([key, value]) => (
																	<Badge
																		key={key}
																		size="xs"
																		variant="light"
																		color="dark.3"
																		styles={{
																			root: {
																				backgroundColor:
																					"var(--mantine-color-dark-5)",
																				color: "var(--mantine-color-dark-1)",
																				textTransform: "none",
																			},
																		}}
																	>
																		{key}: {value}
																	</Badge>
																),
															)}
														</Group>
													)}
												</Box>
											</Group>
										</Box>
										{idx < events.length - 1 && <Divider color="dark.3" />}
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
