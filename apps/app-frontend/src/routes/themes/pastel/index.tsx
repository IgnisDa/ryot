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

export const Route = createFileRoute("/themes/pastel/")({
	component: PastelTheme,
});

const pastelTheme = createTheme({
	fontFamily: '"Outfit", -apple-system, sans-serif',
	headings: {
		fontFamily: '"Space Grotesk", -apple-system, sans-serif',
	},
	primaryColor: "bubblegum",
	defaultRadius: "xl",
	colors: {
		bubblegum: [
			"#FFF0F8",
			"#FFE0F0",
			"#FFC9E5",
			"#FFB0DA",
			"#FF94CE",
			"#FF6BB8",
			"#FF4DA6",
			"#E6308C",
			"#CC1A75",
			"#B3005E",
		],
		sky: [
			"#F0F9FF",
			"#E0F2FE",
			"#BAE6FD",
			"#7DD3FC",
			"#38BDF8",
			"#0EA5E9",
			"#0284C7",
			"#0369A1",
			"#075985",
			"#0C4A6E",
		],
		mint: [
			"#F0FDF9",
			"#CCFBEF",
			"#99F6E0",
			"#5EEAD4",
			"#2DD4BF",
			"#14B8A6",
			"#0D9488",
			"#0F766E",
			"#115E59",
			"#134E4A",
		],
		peach: [
			"#FFF7ED",
			"#FFEDD5",
			"#FED7AA",
			"#FDBA74",
			"#FB923C",
			"#F97316",
			"#EA580C",
			"#C2410C",
			"#9A3412",
			"#7C2D12",
		],
		lavender: [
			"#FAF5FF",
			"#F3E8FF",
			"#E9D5FF",
			"#D8B4FE",
			"#C084FC",
			"#A855F7",
			"#9333EA",
			"#7E22CE",
			"#6B21A8",
			"#581C87",
		],
		cream: [
			"#FFFBF5",
			"#FFF8ED",
			"#FFF4E0",
			"#FFEFD0",
			"#FFE9BF",
			"#FFE2A8",
			"#FFDA8F",
			"#FFD177",
			"#FFC75E",
			"#FFBC45",
		],
	},
});

function PastelTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("light");

	return (
		<MantineProvider theme={pastelTheme} forceColorScheme={colorScheme}>
			<style>
				{`
					@keyframes fadeIn {
						from {
							opacity: 0
							transform: translateY(10px);
						}
						to {
							opacity: 1
							transform: translateY(0);
						}
					}
				`}
			</style>
			<Flex
				h="100vh"
				bg="cream.0"
				style={{
					background:
						"radial-gradient(circle at 20% 30%, rgba(255, 182, 193, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(173, 216, 230, 0.15) 0%, transparent 50%), repeating-linear-gradient(45deg, transparent, transparent 40px, rgba(255, 192, 203, 0.03) 40px, rgba(255, 192, 203, 0.03) 80px), linear-gradient(180deg, #FFFBF5 0%, #FFF8ED 100%)",
				}}
			>
				<Box
					w={280}
					style={{
						borderRight: "2px solid rgba(255, 107, 184, 0.15)",
						background:
							"linear-gradient(180deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 251, 245, 0.85) 100%)",
						backdropFilter: "blur(10px)",
					}}
				>
					<Stack gap={0} h="100%">
						<Box p="lg" pb="md">
							<Group
								gap="xs"
								mb={2}
								style={{
									animation: "fadeIn 0.5s ease-out",
								}}
							>
								<Box
									w={40}
									h={40}
									style={{
										borderRadius: 16,
										background:
											"linear-gradient(135deg, #FF6BB8 0%, #FF4DA6 100%)",
										display: "grid",
										placeItems: "center",
										boxShadow:
											"0 4px 12px rgba(255, 107, 184, 0.4), 0 0 0 3px rgba(255, 107, 184, 0.1)",
									}}
								>
									<Text size="xl" fw={800} c="white">
										R
									</Text>
								</Box>
								<Box>
									<Text size="xl" fw={700} c="bubblegum.9">
										Ryot
									</Text>
								</Box>
							</Group>
							<Text
								size="xs"
								c="bubblegum.7"
								ml={48}
								fw={600}
								style={{ letterSpacing: "0.5px" }}
							>
								Arc Theme
							</Text>
						</Box>

						<Box
							px="sm"
							py="sm"
							style={{
								animation: "fadeIn 0.6s ease-out",
							}}
						>
							<TextInput
								placeholder="Search..."
								leftSection={<Search size={16} />}
								size="sm"
								radius="xl"
								styles={{
									input: {
										backgroundColor: "rgba(255, 255, 255, 0.6)",
										border: "2px solid rgba(255, 107, 184, 0.15)",
										color: "#B3005E",
										fontWeight: 500,
										"&:focus": {
											borderColor: "var(--mantine-color-bubblegum-5)",
											boxShadow: "0 0 0 3px rgba(255, 107, 184, 0.15)",
											transform: "translateY(-1px)",
										},
										"&::placeholder": {
											color: "var(--mantine-color-bubblegum-6)",
											fontWeight: 500,
										},
										transition: "all 0.2s ease",
									},
								}}
							/>
						</Box>

						<Divider color="rgba(255, 107, 184, 0.1)" />

						<Stack
							gap={3}
							p="sm"
							style={{
								flex: 1,
								overflowY: "auto",
								animation: "fadeIn 0.7s ease-out",
							}}
						>
							<NavLink
								label="Home"
								leftSection={<Home size={18} />}
								color="bubblegum.6"
								variant="subtle"
								styles={{
									root: {
										borderRadius: 16,
										"&:hover": {
											backgroundColor: "rgba(255, 107, 184, 0.1)",
											transform: "translateX(4px)",
										},
										transition: "all 0.2s ease",
									},
									label: { fontWeight: 600, fontSize: 14 },
								}}
							/>

							<Box mt="lg">
								<Text
									size="xs"
									c="bubblegum.7"
									px="sm"
									mb={8}
									fw={700}
									style={{ letterSpacing: "1px" }}
								>
									Spaces
								</Text>

								<NavLink
									label="Media"
									leftSection={<Film size={18} />}
									color="bubblegum.6"
									defaultOpened
									styles={{
										root: {
											borderRadius: 16,
											backgroundColor: "rgba(255, 107, 184, 0.12)",
											border: "2px solid rgba(255, 107, 184, 0.2)",
										},
										label: {
											color: "var(--mantine-color-bubblegum-8)",
											fontWeight: 700,
											fontSize: 14,
										},
									}}
								>
									<NavLink
										label="Movies"
										color="bubblegum.6"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: {
												borderRadius: 12,
												"&:hover": { transform: "translateX(4px)" },
												transition: "all 0.2s ease",
											},
										}}
									/>
									<NavLink
										label="Books"
										color="bubblegum.6"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: {
												borderRadius: 12,
												"&:hover": { transform: "translateX(4px)" },
												transition: "all 0.2s ease",
											},
										}}
									/>
									<NavLink
										label="TV Shows"
										color="bubblegum.6"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: {
												borderRadius: 12,
												"&:hover": { transform: "translateX(4px)" },
												transition: "all 0.2s ease",
											},
										}}
									/>
								</NavLink>

								<NavLink
									label="Fitness"
									leftSection={<Dumbbell size={18} />}
									color="mint.6"
									styles={{
										root: {
											borderRadius: 16,
											backgroundColor: "rgba(45, 212, 191, 0.12)",
											border: "2px solid rgba(45, 212, 191, 0.2)",
										},
										label: {
											color: "var(--mantine-color-mint-7)",
											fontWeight: 700,
											fontSize: 14,
										},
									}}
								>
									<NavLink
										label="Workouts"
										color="mint.6"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: {
												borderRadius: 12,
												"&:hover": { transform: "translateX(4px)" },
												transition: "all 0.2s ease",
											},
										}}
									/>
									<NavLink
										label="Measurements"
										color="mint.6"
										styles={{
											label: { fontWeight: 500, fontSize: 13 },
											root: {
												borderRadius: 12,
												"&:hover": { transform: "translateX(4px)" },
												transition: "all 0.2s ease",
											},
										}}
									/>
								</NavLink>

								<NavLink
									label="Whiskey"
									leftSection={<Wine size={18} />}
									color="peach.5"
									styles={{
										root: {
											borderRadius: 16,
											backgroundColor: "rgba(251, 146, 60, 0.12)",
											border: "2px solid rgba(251, 146, 60, 0.2)",
										},
										label: {
											color: "var(--mantine-color-peach-7)",
											fontWeight: 700,
											fontSize: 14,
										},
									}}
								/>

								<NavLink
									label="Places"
									leftSection={<MapPin size={18} />}
									color="sky.6"
									styles={{
										root: {
											borderRadius: 16,
											"&:hover": {
												backgroundColor: "rgba(56, 189, 248, 0.1)",
												transform: "translateX(4px)",
											},
											transition: "all 0.2s ease",
										},
										label: {
											color: "var(--mantine-color-sky-7)",
											fontWeight: 600,
											fontSize: 14,
										},
									}}
								/>
							</Box>

							<Box mt="lg">
								<Text
									size="xs"
									c="bubblegum.7"
									px="sm"
									mb={8}
									fw={700}
									style={{ letterSpacing: "1px" }}
								>
									Library
								</Text>
								{savedViews.map((view, idx) => (
									<NavLink
										key={view.id}
										label={view.name}
										leftSection={<BookOpen size={18} />}
										color="lavender.6"
										styles={{
											root: {
												borderRadius: 16,
												"&:hover": {
													backgroundColor: "rgba(168, 85, 247, 0.1)",
													transform: "translateX(4px)",
												},
												transition: "all 0.2s ease",
												animation: `fadeIn ${0.8 + idx * 0.1}s ease-out`,
											},
											label: {
												color: "var(--mantine-color-lavender-7)",
												fontWeight: 500,
												fontSize: 13,
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
						<Group
							justify="space-between"
							mb="xl"
							style={{ animation: "fadeIn 0.5s ease-out" }}
						>
							<Box>
								<Title order={1} c="bubblegum.9" fw={800} size="2.5rem">
									Dashboard
								</Title>
								<Text c="bubblegum.7" size="sm" mt={6} fw={600}>
									Your personal tracking overview
								</Text>
							</Box>
							<Group gap="sm">
								<Button
									variant="light"
									color="bubblegum"
									size="sm"
									radius="xl"
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
									styles={{
										root: {
											fontWeight: 600,
											border: "2px solid rgba(255, 107, 184, 0.2)",
											"&:hover": {
												transform: "translateY(-2px)",
												boxShadow: "0 4px 12px rgba(255, 107, 184, 0.25)",
											},
											transition: "all 0.2s ease",
										},
									}}
								>
									{colorScheme === "dark" ? "Light" : "Dark"}
								</Button>
								<Button
									variant="gradient"
									gradient={{
										from: "bubblegum.5",
										to: "bubblegum.6",
										deg: 135,
									}}
									size="md"
									radius="xl"
									styles={{
										root: {
											fontWeight: 700,
											boxShadow:
												"0 4px 12px rgba(255, 107, 184, 0.4), 0 0 0 3px rgba(255, 107, 184, 0.1)",
											transition: "all 0.2s ease",
											"&:hover": {
												transform: "translateY(-2px) scale(1.02)",
												boxShadow:
													"0 8px 20px rgba(255, 107, 184, 0.5), 0 0 0 4px rgba(255, 107, 184, 0.15)",
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
								const gradients = [
									"linear-gradient(135deg, rgba(255, 107, 184, 0.15) 0%, rgba(255, 77, 166, 0.08) 100%)",
									"linear-gradient(135deg, rgba(45, 212, 191, 0.15) 0%, rgba(20, 184, 166, 0.08) 100%)",
									"linear-gradient(135deg, rgba(251, 146, 60, 0.15) 0%, rgba(249, 115, 22, 0.08) 100%)",
									"linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(14, 165, 233, 0.08) 100%)",
								];
								const borderColors = [
									"bubblegum.5",
									"mint.5",
									"peach.4",
									"sky.4",
								];
								const textColors = [
									"bubblegum.8",
									"mint.8",
									"peach.8",
									"sky.8",
								];
								return (
									<Grid.Col key={stat.label} span={3}>
										<Card
											p="lg"
											bg="white"
											radius="xl"
											style={{
												border: `3px solid var(--mantine-color-${borderColors[idx % borderColors.length]})`,
												background: gradients[idx % 4],
												transition:
													"all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
												animation: `fadeIn ${0.6 + idx * 0.1}s ease-out`,
											}}
											styles={{
												root: {
													"&:hover": {
														transform: "translateY(-6px) scale(1.02)",
														boxShadow:
															"0 12px 24px rgba(255, 107, 184, 0.2), 0 0 0 4px rgba(255, 107, 184, 0.1)",
													},
												},
											}}
										>
											<Stack gap={6}>
												<Text
													size="xs"
													c={textColors[idx % textColors.length]}
													fw={700}
													style={{ letterSpacing: "1px" }}
												>
													{stat.label}
												</Text>
												<Text
													size="2.5rem"
													fw={800}
													c={textColors[idx % textColors.length]}
													lh={1}
												>
													{stat.value}
												</Text>
												{stat.change && (
													<Group gap={4}>
														<TrendingUp
															size={14}
															color="var(--mantine-color-mint-6)"
														/>
														<Text size="xs" c="mint.7" fw={700}>
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

						<Title
							order={2}
							size="h3"
							c="bubblegum.9"
							fw={800}
							mb="lg"
							style={{ animation: "fadeIn 0.7s ease-out" }}
						>
							Recent Entities
						</Title>
						<Grid mb="xl">
							{entities.slice(0, 6).map((entity, idx) => (
								<Grid.Col key={entity.id} span={4}>
									<Card
										p={0}
										bg="white"
										radius="xl"
										style={{
											border: "3px solid rgba(255, 107, 184, 0.2)",
											cursor: "pointer",
											transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
											overflow: "hidden",
											animation: `fadeIn ${0.8 + idx * 0.1}s ease-out`,
										}}
										styles={{
											root: {
												"&:hover": {
													transform: "translateY(-8px) rotate(-1deg)",
													boxShadow:
														"0 16px 32px rgba(255, 107, 184, 0.3), 0 0 0 4px rgba(255, 107, 184, 0.15)",
													border: "3px solid rgba(255, 107, 184, 0.5)",
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
															"linear-gradient(180deg, transparent 40%, rgba(255, 107, 184, 0.3) 100%)",
													}}
												/>
											</Box>
										)}
										{!entity.image && (
											<Box
												h={220}
												style={{
													background:
														"linear-gradient(135deg, rgba(255, 107, 184, 0.15) 0%, rgba(255, 77, 166, 0.08) 100%)",
													display: "grid",
													placeItems: "center",
												}}
											>
												<Text c="bubblegum.5" size="sm" fw={700}>
													No image
												</Text>
											</Box>
										)}
										<Box p="lg">
											<Group justify="space-between" mb={8}>
												<Text fw={800} c="bubblegum.9" size="sm">
													{entity.name}
												</Text>
												{entity.properties.rating && (
													<Badge
														size="sm"
														variant="gradient"
														gradient={{
															from: "bubblegum.4",
															to: "bubblegum.6",
															deg: 135,
														}}
														styles={{
															root: {
																fontWeight: 800,
																boxShadow: "0 2px 8px rgba(255, 107, 184, 0.3)",
															},
														}}
													>
														{entity.properties.rating}
													</Badge>
												)}
											</Group>
											<Text size="xs" c="bubblegum.7" mb={8} fw={700}>
												{entity.schemaName}
											</Text>
											<Text size="xs" c="bubblegum.6" fw={600}>
												{entity.lastEvent}
											</Text>
										</Box>
									</Card>
								</Grid.Col>
							))}
						</Grid>

						<Title
							order={2}
							size="h3"
							c="bubblegum.9"
							fw={800}
							mb="lg"
							style={{ animation: "fadeIn 0.9s ease-out" }}
						>
							Recent Activity
						</Title>
						<Paper
							bg="white"
							p="xl"
							radius="xl"
							style={{
								border: "3px solid rgba(255, 107, 184, 0.2)",
								background:
									"linear-gradient(135deg, rgba(255, 255, 255, 1) 0%, rgba(255, 251, 245, 0.8) 100%)",
								animation: "fadeIn 1s ease-out",
							}}
						>
							<Stack gap="lg">
								{events.map((event, idx) => (
									<Box
										key={event.id}
										style={{
											animation: `fadeIn ${1.1 + idx * 0.1}s ease-out`,
										}}
									>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="xs" mb={8}>
													<Text fw={800} c="bubblegum.9" size="sm">
														{event.entityName}
													</Text>
													<Badge
														size="sm"
														color="lavender"
														variant="light"
														styles={{
															root: {
																backgroundColor: "rgba(168, 85, 247, 0.12)",
																color: "var(--mantine-color-lavender-7)",
																fontWeight: 700,
																border: "2px solid rgba(168, 85, 247, 0.2)",
															},
														}}
													>
														{event.schemaName}
													</Badge>
												</Group>
												<Text size="xs" c="bubblegum.7" mb={8} fw={600}>
													{event.type} · {event.occurredAt}
												</Text>
												{Object.keys(event.properties).length > 0 && (
													<Text size="xs" c="bubblegum.6" fw={600}>
														{Object.entries(event.properties)
															.map(([key, value]) => `${key}: ${value}`)
															.join(" · ")}
													</Text>
												)}
											</Box>
										</Group>
										{idx < events.length - 1 && (
											<Divider color="rgba(255, 107, 184, 0.15)" mt="lg" />
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
