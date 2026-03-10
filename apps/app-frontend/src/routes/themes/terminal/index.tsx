import {
	Badge,
	Box,
	Button,
	Card,
	createTheme,
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
	Dumbbell,
	Film,
	Home,
	MapPin,
	Moon,
	Sun,
	TrendingUp,
	Wine,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { entities, events, savedViews, stats } from "../-common-data";

export const Route = createFileRoute("/themes/terminal/")({
	component: TerminalTheme,
});

const terminalTheme = createTheme({
	fontFamily: '"Fira Code", "Courier New", monospace',
	fontFamilyMonospace: '"Fira Code", "Courier New", monospace',
	primaryColor: "green",
	defaultRadius: 0,
	headings: {
		fontFamily: '"Fira Code", "Courier New", monospace',
		fontWeight: "700",
	},
	colors: {
		dark: [
			"#E0FFE0",
			"#B0D0B0",
			"#80A080",
			"#507050",
			"#304030",
			"#202820",
			"#181C18",
			"#101410",
			"#080C08",
			"#000000",
		],
		green: [
			"#E0FFE0",
			"#C0FFC0",
			"#A0FFA0",
			"#80FF80",
			"#60FF60",
			"#00FF00",
			"#00CC00",
			"#009900",
			"#006600",
			"#003300",
		],
		cyan: [
			"#E0FFFF",
			"#C0FFFF",
			"#A0FFFF",
			"#80FFFF",
			"#60FFFF",
			"#00FFFF",
			"#00CCCC",
			"#009999",
			"#006666",
			"#003333",
		],
		purple: [
			"#FFE0FF",
			"#FFC0FF",
			"#FFA0FF",
			"#FF80FF",
			"#FF60FF",
			"#FF00FF",
			"#CC00CC",
			"#990099",
			"#660066",
			"#330033",
		],
	},
});

function TerminalTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");

	return (
		<MantineProvider theme={terminalTheme} forceColorScheme={colorScheme}>
			<Flex
				h="100vh"
				bg="dark.9"
				style={{
					position: "relative",
					backgroundImage: `
						repeating-linear-gradient(
							0deg,
							rgba(0, 255, 0, 0.03) 0px,
							transparent 1px,
							transparent 2px,
							rgba(0, 255, 0, 0.03) 3px
						)
					`,
				}}
			>
				<Box
					w={320}
					bg="dark.9"
					style={{
						borderRight: "2px solid var(--mantine-color-green-5)",
						boxShadow: "0 0 20px rgba(0, 255, 0, 0.3)",
					}}
				>
					<Stack gap={0} h="100%">
						<Box
							p="lg"
							style={{
								backgroundColor: "var(--mantine-color-dark.8)",
								borderBottom: "2px solid var(--mantine-color-green-5)",
								boxShadow: "0 0 10px rgba(0, 255, 0, 0.3)",
							}}
						>
							<Text
								size="xl"
								fw={700}
								c="green.5"
								style={{
									fontFamily: "monospace",
									textShadow: "0 0 8px rgba(0, 255, 0, 0.8)",
								}}
							>
								&gt; RYOT_TERMINAL
							</Text>
							<Text
								size="xs"
								c="cyan.5"
								mt={4}
								style={{
									fontFamily: "monospace",
									textShadow: "0 0 5px rgba(0, 255, 255, 0.6)",
								}}
							>
								v2.0.26 [RETRO_MODE]
							</Text>
						</Box>

						<Box p="md">
							<Box
								p="sm"
								style={{
									borderRadius: 0,
									border: "1px solid var(--mantine-color-green-5)",
									backgroundColor: "rgba(0, 255, 0, 0.05)",
									boxShadow: "inset 0 0 10px rgba(0, 255, 0, 0.1)",
								}}
							>
								<Group gap="xs" wrap="nowrap">
									<Text
										size="sm"
										c="green.5"
										fw={700}
										style={{ fontFamily: "monospace" }}
									>
										&gt
									</Text>
									<Text
										size="sm"
										c="green.4"
										fw={500}
										style={{
											fontFamily: "monospace",
											opacity: 0.7,
										}}
									>
										search_query...
									</Text>
								</Group>
							</Box>
						</Box>

						<Box
							h={2}
							bg="green.5"
							style={{ boxShadow: "0 0 8px rgba(0, 255, 0, 0.5)" }}
						/>

						<Stack gap={0} p="md" style={{ flex: 1, overflowY: "auto" }}>
							<NavLink
								label=">> HOME"
								leftSection={
									<Home size={18} color="var(--mantine-color-green-5)" />
								}
								color="green.5"
								active
								styles={{
									root: {
										borderRadius: 0,
										backgroundColor: "rgba(0, 255, 0, 0.15)",
										borderLeft: "3px solid var(--mantine-color-green-5)",
										fontFamily: "monospace",
										padding: "10px 12px",
										"&:hover": {
											backgroundColor: "rgba(0, 255, 0, 0.25)",
											boxShadow: "0 0 10px rgba(0, 255, 0, 0.3)",
										},
									},
									label: {
										fontWeight: 700,
										color: "var(--mantine-color-green-4)",
										textShadow: "0 0 5px rgba(0, 255, 0, 0.5)",
									},
								}}
							/>

							<Box mt="lg">
								<Box
									px="sm"
									py="xs"
									mb="xs"
									style={{
										backgroundColor: "rgba(0, 255, 255, 0.1)",
										borderLeft: "2px solid var(--mantine-color-cyan-5)",
									}}
								>
									<Text
										size="xs"
										c="cyan.5"
										tt="uppercase"
										fw={700}
										style={{
											fontFamily: "monospace",
											letterSpacing: "2px",
											textShadow: "0 0 5px rgba(0, 255, 255, 0.5)",
										}}
									>
										[MODULES]
									</Text>
								</Box>

								<NavLink
									label=">> MEDIA"
									leftSection={
										<Film size={18} color="var(--mantine-color-green-5)" />
									}
									color="green.5"
									defaultOpened
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontFamily: "monospace",
											"&:hover": {
												backgroundColor: "rgba(0, 255, 0, 0.1)",
												borderLeftColor: "var(--mantine-color-green-5)",
											},
										},
										label: {
											color: "var(--mantine-color-green-4)",
											fontWeight: 700,
										},
									}}
								>
									<NavLink
										label=":: movies"
										color="green.5"
										styles={{
											label: {
												fontWeight: 500,
												fontSize: 13,
												fontFamily: "monospace",
												color: "var(--mantine-color-green-3)",
											},
											root: { borderRadius: 0, paddingLeft: "40px" },
										}}
									/>
									<NavLink
										label=":: books"
										color="green.5"
										styles={{
											label: {
												fontWeight: 500,
												fontSize: 13,
												fontFamily: "monospace",
												color: "var(--mantine-color-green-3)",
											},
											root: { borderRadius: 0, paddingLeft: "40px" },
										}}
									/>
									<NavLink
										label=":: tv_shows"
										color="green.5"
										styles={{
											label: {
												fontWeight: 500,
												fontSize: 13,
												fontFamily: "monospace",
												color: "var(--mantine-color-green-3)",
											},
											root: { borderRadius: 0, paddingLeft: "40px" },
										}}
									/>
								</NavLink>

								<NavLink
									label=">> FITNESS"
									leftSection={
										<Dumbbell size={18} color="var(--mantine-color-green-5)" />
									}
									color="green.5"
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontFamily: "monospace",
											"&:hover": {
												backgroundColor: "rgba(0, 255, 0, 0.1)",
												borderLeftColor: "var(--mantine-color-green-5)",
											},
										},
										label: {
											color: "var(--mantine-color-green-4)",
											fontWeight: 700,
										},
									}}
								>
									<NavLink
										label=":: workouts"
										color="green.5"
										styles={{
											label: {
												fontWeight: 500,
												fontSize: 13,
												fontFamily: "monospace",
												color: "var(--mantine-color-green-3)",
											},
											root: { borderRadius: 0, paddingLeft: "40px" },
										}}
									/>
									<NavLink
										label=":: measurements"
										color="green.5"
										styles={{
											label: {
												fontWeight: 500,
												fontSize: 13,
												fontFamily: "monospace",
												color: "var(--mantine-color-green-3)",
											},
											root: { borderRadius: 0, paddingLeft: "40px" },
										}}
									/>
								</NavLink>

								<NavLink
									label=">> WHISKEY"
									leftSection={
										<Wine size={18} color="var(--mantine-color-green-5)" />
									}
									color="green.5"
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontFamily: "monospace",
											"&:hover": {
												backgroundColor: "rgba(0, 255, 0, 0.1)",
												borderLeftColor: "var(--mantine-color-green-5)",
											},
										},
										label: {
											color: "var(--mantine-color-green-4)",
											fontWeight: 700,
										},
									}}
								/>

								<NavLink
									label=">> PLACES"
									leftSection={
										<MapPin size={18} color="var(--mantine-color-green-5)" />
									}
									color="green.5"
									styles={{
										root: {
											borderRadius: 0,
											borderLeft: "3px solid transparent",
											fontFamily: "monospace",
											"&:hover": {
												backgroundColor: "rgba(0, 255, 0, 0.1)",
												borderLeftColor: "var(--mantine-color-green-5)",
											},
										},
										label: {
											color: "var(--mantine-color-green-4)",
											fontWeight: 700,
										},
									}}
								/>
							</Box>

							<Box mt="lg">
								<Box
									px="sm"
									py="xs"
									mb="xs"
									style={{
										backgroundColor: "rgba(255, 0, 255, 0.1)",
										borderLeft: "2px solid var(--mantine-color-purple-5)",
									}}
								>
									<Text
										size="xs"
										c="purple.5"
										tt="uppercase"
										fw={700}
										style={{
											fontFamily: "monospace",
											letterSpacing: "2px",
											textShadow: "0 0 5px rgba(255, 0, 255, 0.5)",
										}}
									>
										[SAVED_VIEWS]
									</Text>
								</Box>
								{savedViews.map((view) => (
									<NavLink
										key={view.id}
										label={`:: ${view.name.toLowerCase().replace(/ /g, "_")}`}
										leftSection={
											<BookOpen
												size={16}
												color="var(--mantine-color-purple-5)"
											/>
										}
										color="purple.5"
										styles={{
											root: {
												borderRadius: 0,
												borderLeft: "3px solid transparent",
												fontFamily: "monospace",
												"&:hover": {
													backgroundColor: "rgba(255, 0, 255, 0.1)",
													borderLeftColor: "var(--mantine-color-purple-5)",
												},
											},
											label: {
												color: "var(--mantine-color-purple-4)",
												fontSize: 13,
												fontWeight: 600,
											},
										}}
									/>
								))}
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
					<Box
						p="xl"
						style={{
							borderBottom: "2px solid var(--mantine-color-green-5)",
							backgroundColor: "rgba(0, 0, 0, 0.3)",
							boxShadow: "0 0 10px rgba(0, 255, 0, 0.2)",
						}}
					>
						<Group justify="space-between" align="flex-start">
							<Box>
								<Title
									order={1}
									c="green.5"
									fw={700}
									size="2.5rem"
									style={{
										fontFamily: "monospace",
										textShadow: "0 0 10px rgba(0, 255, 0, 0.8)",
									}}
								>
									&gt;&gt; DASHBOARD
								</Title>
								<Text
									c="cyan.5"
									size="sm"
									mt={8}
									fw={600}
									style={{
										fontFamily: "monospace",
										textShadow: "0 0 5px rgba(0, 255, 255, 0.6)",
									}}
								>
									{"// TRACKING_COMMAND_CENTER v2.0"}
								</Text>
							</Box>
							<Group gap="md">
								<Button
									variant="outline"
									color="green"
									size="md"
									onClick={() =>
										setColorScheme(colorScheme === "dark" ? "light" : "dark")
									}
									leftSection={
										colorScheme === "dark" ? (
											<Sun size={18} color="var(--mantine-color-green-5)" />
										) : (
											<Moon size={18} color="var(--mantine-color-green-5)" />
										)
									}
									styles={{
										root: {
											borderRadius: 0,
											border: "2px solid var(--mantine-color-green-5)",
											fontFamily: "monospace",
											fontWeight: 700,
											backgroundColor: "rgba(0, 255, 0, 0.05)",
											transition: "all 0.1s ease",
											"&:hover": {
												backgroundColor: "rgba(0, 255, 0, 0.15)",
												boxShadow: "0 0 15px rgba(0, 255, 0, 0.4)",
											},
										},
									}}
								>
									{colorScheme === "dark" ? "[LIGHT]" : "[DARK]"}
								</Button>
								<Button
									variant="filled"
									color="green"
									size="lg"
									leftSection={<Zap size={20} color="black" />}
									styles={{
										root: {
											borderRadius: 0,
											fontFamily: "monospace",
											fontWeight: 900,
											backgroundColor: "var(--mantine-color-green-5)",
											color: "black",
											border: "2px solid var(--mantine-color-green-6)",
											transition: "all 0.1s ease",
											boxShadow: "0 0 20px rgba(0, 255, 0, 0.6)",
											"&:hover": {
												backgroundColor: "var(--mantine-color-green-4)",
												boxShadow: "0 0 30px rgba(0, 255, 0, 0.9)",
											},
										},
									}}
								>
									QUICK_ACTION
								</Button>
							</Group>
						</Group>
					</Box>

					<Box p="xl">
						<Grid mb="xl">
							{stats.map((stat, idx) => {
								const accentColors = [
									"green.5",
									"cyan.5",
									"purple.5",
									"green.6",
								];
								return (
									<Grid.Col key={stat.label} span={3}>
										<Card
											p="lg"
											bg="dark.9"
											style={{
												borderRadius: 0,
												border: `2px solid var(--mantine-color-${accentColors[idx]})`,
												boxShadow: `0 0 15px rgba(${idx === 0 || idx === 3 ? "0, 255, 0" : idx === 1 ? "0, 255, 255" : "255, 0, 255"}, 0.3)`,
												transition: "all 0.15s ease",
												animation: `fadeIn 0.4s ease ${idx * 0.1}s backwards`,
											}}
											styles={{
												root: {
													"&:hover": {
														transform: "scale(1.02)",
														boxShadow: `0 0 25px rgba(${idx === 0 || idx === 3 ? "0, 255, 0" : idx === 1 ? "0, 255, 255" : "255, 0, 255"}, 0.6)`,
													},
												},
											}}
										>
											<Stack gap={8}>
												<Text
													size="xs"
													c={accentColors[idx]}
													tt="uppercase"
													fw={900}
													style={{
														letterSpacing: "2px",
														fontFamily: "monospace",
														textShadow: `0 0 5px rgba(${idx === 0 || idx === 3 ? "0, 255, 0" : idx === 1 ? "0, 255, 255" : "255, 0, 255"}, 0.8)`,
													}}
												>
													[{stat.label.toUpperCase()}]
												</Text>
												<Text
													size="3rem"
													fw={900}
													c={accentColors[idx]}
													lh={1}
													style={{
														fontFamily: "monospace",
														textShadow: `0 0 10px rgba(${idx === 0 || idx === 3 ? "0, 255, 0" : idx === 1 ? "0, 255, 255" : "255, 0, 255"}, 0.8)`,
													}}
												>
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
															style={{
																fontFamily: "monospace",
																textShadow: `0 0 5px rgba(${idx === 0 || idx === 3 ? "0, 255, 0" : idx === 1 ? "0, 255, 255" : "255, 0, 255"}, 0.6)`,
															}}
														>
															{stat.change.toUpperCase()}
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

						<Group justify="space-between" align="center" mb="lg">
							<Title
								order={2}
								size="xl"
								c="green.5"
								fw={900}
								style={{
									fontFamily: "monospace",
									textShadow: "0 0 10px rgba(0, 255, 0, 0.8)",
								}}
							>
								&gt;&gt; RECENT_ENTITIES
							</Title>
							<Button
								variant="outline"
								color="cyan"
								size="sm"
								styles={{
									root: {
										borderRadius: 0,
										fontFamily: "monospace",
										fontWeight: 700,
										border: "1px solid var(--mantine-color-cyan-5)",
										backgroundColor: "rgba(0, 255, 255, 0.05)",
										"&:hover": {
											backgroundColor: "rgba(0, 255, 255, 0.1)",
											boxShadow: "0 0 10px rgba(0, 255, 255, 0.4)",
										},
									},
								}}
							>
								[VIEW_ALL]
							</Button>
						</Group>
						<Grid mb="xl">
							{entities.slice(0, 6).map((entity, idx) => (
								<Grid.Col key={entity.id} span={4}>
									<Card
										p={0}
										bg="dark.9"
										style={{
											borderRadius: 0,
											border: "2px solid var(--mantine-color-green-5)",
											cursor: "pointer",
											transition: "all 0.15s ease",
											overflow: "hidden",
											boxShadow: "0 0 15px rgba(0, 255, 0, 0.3)",
											animation: `fadeIn 0.4s ease ${(idx + 4) * 0.1}s backwards`,
										}}
										styles={{
											root: {
												"&:hover": {
													transform: "scale(1.02)",
													boxShadow: "0 0 25px rgba(0, 255, 0, 0.6)",
													borderColor: "var(--mantine-color-cyan-5)",
												},
											},
										}}
									>
										{entity.image && (
											<Box
												h={220}
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
														inset: 0,
														background:
															"linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.9) 100%)",
													}}
												/>
												{entity.properties.rating && (
													<Box
														style={{
															position: "absolute",
															top: 12,
															right: 12,
														}}
													>
														<Badge
															size="lg"
															color="green"
															variant="filled"
															styles={{
																root: {
																	borderRadius: 0,
																	fontFamily: "monospace",
																	fontWeight: 900,
																	backgroundColor:
																		"var(--mantine-color-green-5)",
																	color: "black",
																	border:
																		"2px solid var(--mantine-color-green-6)",
																	boxShadow: "0 0 10px rgba(0, 255, 0, 0.8)",
																},
															}}
														>
															{entity.properties.rating}
														</Badge>
													</Box>
												)}
											</Box>
										)}
										{!entity.image && (
											<Box
												h={220}
												bg="dark.8"
												style={{
													display: "grid",
													placeItems: "center",
													border: "2px dashed var(--mantine-color-green-6)",
												}}
											>
												<Text
													c="green.5"
													size="sm"
													fw={900}
													style={{ fontFamily: "monospace" }}
												>
													[NO_IMAGE]
												</Text>
											</Box>
										)}
										<Box p="lg">
											<Text
												fw={900}
												c="green.5"
												size="md"
												mb={8}
												style={{
													fontFamily: "monospace",
													textShadow: "0 0 5px rgba(0, 255, 0, 0.6)",
												}}
											>
												{entity.name.toUpperCase()}
											</Text>
											<Badge
												size="sm"
												variant="filled"
												color="cyan"
												mb={8}
												styles={{
													root: {
														borderRadius: 0,
														backgroundColor: "rgba(0, 255, 255, 0.2)",
														color: "var(--mantine-color-cyan-4)",
														fontWeight: 700,
														fontFamily: "monospace",
														border: "1px solid var(--mantine-color-cyan-5)",
													},
												}}
											>
												{entity.schemaName.toUpperCase()}
											</Badge>
											<Text
												size="xs"
												c="green.4"
												style={{ fontFamily: "monospace" }}
											>
												{entity.lastEvent.toLowerCase()}
											</Text>
										</Box>
									</Card>
								</Grid.Col>
							))}
						</Grid>

						<Group justify="space-between" align="center" mb="lg">
							<Title
								order={2}
								size="xl"
								c="purple.5"
								fw={900}
								style={{
									fontFamily: "monospace",
									textShadow: "0 0 10px rgba(255, 0, 255, 0.8)",
								}}
							>
								&gt;&gt; ACTIVITY_STREAM
							</Title>
							<Button
								variant="outline"
								color="purple"
								size="sm"
								styles={{
									root: {
										borderRadius: 0,
										fontFamily: "monospace",
										fontWeight: 700,
										border: "1px solid var(--mantine-color-purple-5)",
										backgroundColor: "rgba(255, 0, 255, 0.05)",
										"&:hover": {
											backgroundColor: "rgba(255, 0, 255, 0.1)",
											boxShadow: "0 0 10px rgba(255, 0, 255, 0.4)",
										},
									},
								}}
							>
								[SHOW_MORE]
							</Button>
						</Group>
						<Paper
							bg="dark.9"
							p="xl"
							style={{
								borderRadius: 0,
								border: "2px solid var(--mantine-color-purple-5)",
								boxShadow: "0 0 15px rgba(255, 0, 255, 0.3)",
							}}
						>
							<Stack gap="md">
								{events.map((event) => (
									<Box
										key={event.id}
										p="md"
										className="terminal-activity-box"
										style={{
											borderRadius: 0,
											border: "1px solid var(--mantine-color-purple-5)",
											borderLeft: "3px solid var(--mantine-color-purple-5)",
											backgroundColor: "rgba(255, 0, 255, 0.05)",
											transition: "all 0.15s ease",
										}}
									>
										<Group
											justify="space-between"
											align="flex-start"
											wrap="nowrap"
										>
											<Box flex={1}>
												<Group gap="xs" mb={8}>
													<Text
														fw={900}
														c="purple.4"
														size="sm"
														style={{
															fontFamily: "monospace",
															textShadow: "0 0 5px rgba(255, 0, 255, 0.5)",
														}}
													>
														{event.entityName.toUpperCase()}
													</Text>
													<Badge
														size="sm"
														variant="filled"
														color="purple"
														styles={{
															root: {
																borderRadius: 0,
																backgroundColor: "rgba(255, 0, 255, 0.3)",
																color: "var(--mantine-color-purple-3)",
																fontWeight: 700,
																fontFamily: "monospace",
																border:
																	"1px solid var(--mantine-color-purple-5)",
															},
														}}
													>
														{event.schemaName.toUpperCase()}
													</Badge>
												</Group>
												<Text
													size="xs"
													c="purple.3"
													mb={8}
													fw={600}
													style={{ fontFamily: "monospace" }}
												>
													&gt; {event.type.toLowerCase()} :: {event.occurredAt}
												</Text>
												{Object.keys(event.properties).length > 0 && (
													<Group gap={8}>
														{Object.entries(event.properties).map(
															([key, value]) => (
																<Badge
																	key={key}
																	size="xs"
																	variant="outline"
																	color="purple"
																	styles={{
																		root: {
																			borderRadius: 0,
																			backgroundColor: "transparent",
																			color: "var(--mantine-color-purple-4)",
																			textTransform: "none",
																			fontFamily: "monospace",
																			border:
																				"1px solid var(--mantine-color-purple-6)",
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
								))}
							</Stack>
							<style>
								{`
									.terminal-activity-box:hover {
										background-color: rgba(255, 0, 255, 0.1) !important;
										box-shadow: 0 0 10px rgba(255, 0, 255, 0.3);
									}
								`}
							</style>
						</Paper>
					</Box>
				</Box>
			</Flex>
		</MantineProvider>
	);
}
