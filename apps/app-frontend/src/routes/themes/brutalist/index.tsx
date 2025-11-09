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

export const Route = createFileRoute("/themes/brutalist/")({
	component: BrutalistTheme,
});

const brutalistTheme = createTheme({
	fontFamily: '"IBM Plex Sans", -apple-system, sans-serif',
	fontFamilyMonospace: '"IBM Plex Mono", monospace',
	primaryColor: "red",
	defaultRadius: 0,
	colors: {
		dark: [
			"#FFFFFF",
			"#E0E0E0",
			"#C0C0C0",
			"#A0A0A0",
			"#808080",
			"#505050",
			"#303030",
			"#181818",
			"#0D0D0D",
			"#000000",
		],
		red: [
			"#FFF1F1",
			"#FFD6D6",
			"#FFB3B3",
			"#FF8A8A",
			"#FF5C5C",
			"#FF0000",
			"#CC0000",
			"#990000",
			"#660000",
			"#330000",
		],
		blue: [
			"#F0F4FF",
			"#D6E4FF",
			"#ADC8FF",
			"#85A3FF",
			"#6B8EFF",
			"#5B7FFF",
			"#0047FF",
			"#0038CC",
			"#002999",
			"#001A66",
		],
	},
	headings: {
		fontFamily: '"DM Sans", -apple-system, sans-serif',
		fontWeight: "700",
	},
});

function BrutalistTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");

	return (
		<MantineProvider theme={brutalistTheme} forceColorScheme={colorScheme}>
			<Flex
				h="100vh"
				bg="dark.9"
				style={{
					backgroundImage: `
						linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
						linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
					`,
					backgroundSize: "32px 32px",
				}}
			>
				<Box
					w={280}
					bg="dark.8"
					style={{
						borderRight: "3px solid var(--mantine-color-red-5)",
						position: "relative",
					}}
				>
					<Stack gap={0} h="100%">
						<Box
							p="lg"
							style={{
								borderBottom: "3px solid var(--mantine-color-red-5)",
							}}
						>
							<Text size="xl" fw={900} c="dark.0" tt="uppercase">
								RYOT
							</Text>
							<Text
								size="xs"
								c="dark.4"
								tt="uppercase"
								mt={4}
								fw={700}
								style={{ letterSpacing: "2px" }}
							>
								BRUTALIST
							</Text>
						</Box>

						<Box p="md">
							<TextInput
								placeholder="SEARCH..."
								leftSection={<Search size={18} />}
								size="md"
								styles={{
									input: {
										backgroundColor: "transparent",
										border: "2px solid var(--mantine-color-dark-6)",
										borderRadius: 0,
										color: "var(--mantine-color-dark.0)",
										fontWeight: 600,
										textTransform: "uppercase",
										transition: "all 0.15s ease",
										"&:focus": {
											borderColor: "var(--mantine-color-red-5)",
											backgroundColor: "var(--mantine-color-dark-8)",
										},
										"&::placeholder": {
											color: "var(--mantine-color-dark-5)",
											fontWeight: 700,
										},
									},
								}}
							/>
						</Box>

						<Box h={3} bg="dark.7" />

						<Stack gap={0} p="md" style={{ flex: 1, overflowY: "auto" }}>
							<NavLink
								label="HOME"
								leftSection={<Home size={20} />}
								color="dark.0"
								variant="subtle"
								styles={{
									root: {
										borderRadius: 0,
										borderLeft: "3px solid transparent",
										padding: "12px 16px",
										fontWeight: 700,
										textTransform: "uppercase",
										letterSpacing: "1px",
										"&:hover": {
											backgroundColor: "var(--mantine-color-dark-7)",
											borderLeftColor: "var(--mantine-color-red-5)",
										},
									},
									label: {
										fontWeight: 700,
									},
								}}
							/>

							<Box mt="lg">
								<Box
									p="sm"
									mb="xs"
									style={{
										backgroundColor: "var(--mantine-color-dark-8)",
										borderLeft: "3px solid var(--mantine-color-red-5)",
									}}
								>
									<Text
										size="xs"
										c="dark.0"
										tt="uppercase"
										fw={900}
										style={{ letterSpacing: "2px" }}
									>
										TRACKING
									</Text>
								</Box>

								<NavLink
									label="MEDIA"
									leftSection={<Film size={20} />}
									color="red.5"
									defaultOpened
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontWeight: 700,
											textTransform: "uppercase",
											"&:hover": {
												backgroundColor: "var(--mantine-color-dark-7)",
												borderLeftColor: "var(--mantine-color-red-5)",
											},
										},
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 700,
										},
									}}
								>
									<NavLink
										label="MOVIES"
										color="red.5"
										styles={{
											root: { borderRadius: 0, textTransform: "uppercase" },
											label: { fontWeight: 600 },
										}}
									/>
									<NavLink
										label="BOOKS"
										color="red.5"
										styles={{
											root: { borderRadius: 0, textTransform: "uppercase" },
											label: { fontWeight: 600 },
										}}
									/>
									<NavLink
										label="TV SHOWS"
										color="red.5"
										styles={{
											root: { borderRadius: 0, textTransform: "uppercase" },
											label: { fontWeight: 600 },
										}}
									/>
								</NavLink>

								<NavLink
									label="FITNESS"
									leftSection={<Dumbbell size={20} />}
									color="blue.6"
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontWeight: 700,
											textTransform: "uppercase",
											"&:hover": {
												backgroundColor: "var(--mantine-color-dark-7)",
												borderLeftColor: "var(--mantine-color-blue-6)",
											},
										},
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 700,
										},
									}}
								/>

								<NavLink
									label="WHISKEY"
									leftSection={<Wine size={20} />}
									color="red.6"
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontWeight: 700,
											textTransform: "uppercase",
											"&:hover": {
												backgroundColor: "var(--mantine-color-dark-7)",
												borderLeftColor: "var(--mantine-color-red-6)",
											},
										},
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 700,
										},
									}}
								/>

								<NavLink
									label="PLACES"
									leftSection={<MapPin size={20} />}
									color="blue.5"
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontWeight: 700,
											textTransform: "uppercase",
											"&:hover": {
												backgroundColor: "var(--mantine-color-dark-7)",
												borderLeftColor: "var(--mantine-color-blue-5)",
											},
										},
										label: {
											color: "var(--mantine-color-dark-0)",
											fontWeight: 700,
										},
									}}
								/>
							</Box>

							<Box mt="lg">
								<Box
									p="sm"
									mb="xs"
									style={{
										backgroundColor: "var(--mantine-color-dark-8)",
										borderLeft: "3px solid var(--mantine-color-blue-6)",
									}}
								>
									<Text
										size="xs"
										c="dark.0"
										tt="uppercase"
										fw={900}
										style={{ letterSpacing: "2px" }}
									>
										LIBRARY
									</Text>
								</Box>
								{savedViews.map((view) => (
									<NavLink
										key={view.id}
										label={view.name.toUpperCase()}
										leftSection={<BookOpen size={20} />}
										color="blue.6"
										styles={{
											root: {
												borderRadius: 0,
												borderLeft: "3px solid transparent",
												fontWeight: 700,
												textTransform: "uppercase",
												"&:hover": {
													backgroundColor: "var(--mantine-color-dark-7)",
													borderLeftColor: "var(--mantine-color-blue-6)",
												},
											},
											label: {
												color: "var(--mantine-color-dark-1)",
												fontWeight: 600,
											},
										}}
									/>
								))}
							</Box>
						</Stack>
					</Stack>
				</Box>

				<Box flex={1} style={{ overflowY: "auto" }}>
					<Box
						p="xl"
						style={{
							borderBottom: "3px solid var(--mantine-color-red-5)",
							backgroundColor: "var(--mantine-color-dark-8)",
						}}
					>
						<Group justify="space-between" align="flex-start">
							<Box>
								<Title order={1} c="dark.0" fw={900} tt="uppercase" size="3rem">
									DASHBOARD
								</Title>
								<Text
									c="dark.4"
									size="sm"
									mt={8}
									fw={700}
									tt="uppercase"
									style={{ letterSpacing: "2px" }}
								>
									TRACKING OVERVIEW
								</Text>
							</Box>
							<Group gap="md">
								<Button
									variant="outline"
									color="dark.5"
									size="md"
									onClick={() =>
										setColorScheme(colorScheme === "dark" ? "light" : "dark")
									}
									leftSection={
										colorScheme === "dark" ? (
											<Sun size={18} />
										) : (
											<Moon size={18} />
										)
									}
									styles={{
										root: {
											borderRadius: 0,
											border: "2px solid var(--mantine-color-dark-6)",
											fontWeight: 700,
											textTransform: "uppercase",
											transition: "all 0.1s ease",
											"&:hover": {
												borderColor: "var(--mantine-color-red-5)",
												backgroundColor: "var(--mantine-color-dark-7)",
											},
										},
									}}
								>
									{colorScheme === "dark" ? "LIGHT" : "DARK"}
								</Button>
								<Button
									variant="filled"
									color="red"
									size="lg"
									styles={{
										root: {
											borderRadius: 0,
											fontWeight: 900,
											textTransform: "uppercase",
											letterSpacing: "1px",
											border: "3px solid var(--mantine-color-red-7)",
											transition: "all 0.1s ease",
											"&:hover": {
												transform: "translate(2px, 2px)",
												boxShadow: "none",
											},
										},
									}}
									style={{
										boxShadow: "4px 4px 0 var(--mantine-color-red-7)",
									}}
								>
									LOG ACTIVITY
								</Button>
							</Group>
						</Group>
					</Box>

					<Box p="xl">
						<Grid mb="xl">
							{stats.map((stat, idx) => {
								const accentColors = ["red.5", "blue.6", "red.6", "blue.5"];
								const shadowColors = ["red.7", "blue.7", "red.7", "blue.7"];
								return (
									<Grid.Col key={stat.label} span={3}>
										<Card
											p="xl"
											bg="dark.8"
											style={{
												borderRadius: 0,
												border: `3px solid var(--mantine-color-${accentColors[idx]})`,
												boxShadow: `6px 6px 0 var(--mantine-color-${shadowColors[idx]})`,
												transition: "all 0.1s ease",
												animation: `fadeIn 0.4s ease ${idx * 0.1}s backwards`,
											}}
											styles={{
												root: {
													"&:hover": {
														transform: "translate(3px, 3px)",
														boxShadow: "3px 3px 0 var(--mantine-color-dark-6)",
													},
												},
											}}
										>
											<Stack gap={8}>
												<Text
													size="xs"
													c="dark.4"
													tt="uppercase"
													fw={900}
													style={{ letterSpacing: "2px" }}
												>
													{stat.label}
												</Text>
												<Text size="3rem" fw={900} c="dark.0" lh={0.9}>
													{stat.value}
												</Text>
												{stat.change && (
													<Group gap={6} mt={4}>
														<TrendingUp
															size={16}
															color={`var(--mantine-color-${accentColors[idx]})`}
															strokeWidth={3}
														/>
														<Text
															size="sm"
															c={accentColors[idx]}
															fw={700}
															tt="uppercase"
														>
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
						<style>
							{`
								@keyframes fadeIn {
									from {
										opacity: 0
										transform: translateY(20px)
									}
									to {
										opacity: 1
										transform: translateY(0)
									}
								}
							`}
						</style>

						<Box
							mb="xl"
							p="md"
							style={{
								borderLeft: "4px solid var(--mantine-color-red-5)",
								backgroundColor: "var(--mantine-color-dark-8)",
							}}
						>
							<Title order={2} size="2rem" c="dark.0" fw={900} tt="uppercase">
								RECENT ENTITIES
							</Title>
						</Box>

						<Grid mb="xl">
							{entities.slice(0, 6).map((entity, idx) => (
								<Grid.Col key={entity.id} span={4}>
									<Card
										p={0}
										bg="dark.8"
										style={{
											borderRadius: 0,
											border: "3px solid var(--mantine-color-dark-6)",
											cursor: "pointer",
											overflow: "hidden",
											boxShadow: "6px 6px 0 var(--mantine-color-dark-7)",
											transition: "all 0.1s ease",
											animation: `fadeIn 0.4s ease ${(idx + 4) * 0.1}s backwards`,
										}}
										styles={{
											root: {
												"&:hover": {
													transform: "translate(3px, 3px)",
													boxShadow: "3px 3px 0 var(--mantine-color-dark-7)",
													borderColor: "var(--mantine-color-red-5)",
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
														top: 0,
														left: 0,
														right: 0,
														bottom: 0,
														background:
															"linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.8) 100%)",
													}}
												/>
											</Box>
										)}
										{!entity.image && (
											<Box
												h={200}
												bg="dark.7"
												style={{
													display: "grid",
													placeItems: "center",
													border: "2px dashed var(--mantine-color-dark-5)",
												}}
											>
												<Text c="dark.5" size="sm" fw={900} tt="uppercase">
													NO IMAGE
												</Text>
											</Box>
										)}
										<Box p="lg">
											<Group justify="space-between" mb={8}>
												<Text fw={900} c="dark.0" size="md" tt="uppercase">
													{entity.name}
												</Text>
												{entity.properties.rating && (
													<Badge
														size="lg"
														color="red"
														variant="filled"
														styles={{
															root: {
																borderRadius: 0,
																backgroundColor: "var(--mantine-color-red-5)",
																color: "var(--mantine-color-dark-9)",
																fontWeight: 900,
																border: "2px solid var(--mantine-color-red-7)",
															},
														}}
													>
														{entity.properties.rating}
													</Badge>
												)}
											</Group>
											<Box
												mt="xs"
												p="xs"
												style={{
													backgroundColor: "var(--mantine-color-dark-7)",
													borderLeft: "3px solid var(--mantine-color-blue-6)",
												}}
											>
												<Text
													size="xs"
													c="dark.3"
													mb={4}
													fw={700}
													tt="uppercase"
													style={{ letterSpacing: "1px" }}
												>
													{entity.schemaName}
												</Text>
											</Box>
											<Text size="xs" c="dark.2" mt="sm" fw={600}>
												{entity.lastEvent.toUpperCase()}
											</Text>
										</Box>
									</Card>
								</Grid.Col>
							))}
						</Grid>

						<Box
							mb="xl"
							p="md"
							style={{
								borderLeft: "4px solid var(--mantine-color-blue-6)",
								backgroundColor: "var(--mantine-color-dark-8)",
							}}
						>
							<Title order={2} size="2rem" c="dark.0" fw={900} tt="uppercase">
								RECENT ACTIVITY
							</Title>
						</Box>
						<Paper
							bg="dark.8"
							p="xl"
							style={{
								borderRadius: 0,
								border: "3px solid var(--mantine-color-dark-6)",
								boxShadow: "6px 6px 0 var(--mantine-color-dark-7)",
							}}
						>
							<Stack gap="md">
								{events.map((event, idx) => (
									<Box
										key={event.id}
										p="md"
										style={{
											borderRadius: 0,
											border: "2px solid var(--mantine-color-dark-6)",
											borderLeft: `4px solid ${idx % 2 === 0 ? "var(--mantine-color-red-5)" : "var(--mantine-color-blue-6)"}`,
											backgroundColor: "var(--mantine-color-dark-7)",
										}}
									>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="xs" mb={6}>
													<Text fw={900} c="dark.0" size="sm" tt="uppercase">
														{event.entityName}
													</Text>
													<Badge
														size="sm"
														color={idx % 2 === 0 ? "red" : "blue"}
														variant="filled"
														styles={{
															root: {
																borderRadius: 0,
																fontWeight: 900,
																textTransform: "uppercase",
																letterSpacing: "1px",
															},
														}}
													>
														{event.schemaName}
													</Badge>
												</Group>
												<Text
													size="xs"
													c="dark.3"
													mb={6}
													fw={700}
													tt="uppercase"
													style={{ letterSpacing: "1px" }}
												>
													{event.type} · {event.occurredAt}
												</Text>
												{Object.keys(event.properties).length > 0 && (
													<Text size="xs" c="dark.4" fw={600}>
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
