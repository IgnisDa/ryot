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

export const Route = createFileRoute("/themes/arc/")({
	component: ArcTheme,
});

const arcTheme = createTheme({
	fontFamily: "Inter, -apple-system, sans-serif",
	fontFamilyMonospace: "JetBrains Mono, monospace",
	primaryColor: "purple",
	defaultRadius: "xl",
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
		purple: [
			"#FAF5FF",
			"#F3E8FF",
			"#E9D5FF",
			"#D8B4FE",
			"#C084FC",
			"#A78BFA",
			"#9333EA",
			"#7E22CE",
			"#6B21A8",
			"#581C87",
		],
		green: [
			"#F0FDF4",
			"#DCFCE7",
			"#BBF7D0",
			"#86EFAC",
			"#4ADE80",
			"#34D399",
			"#22C55E",
			"#16A34A",
			"#15803D",
			"#166534",
		],
		yellow: [
			"#FEFCE8",
			"#FEF9C3",
			"#FEF08A",
			"#FDE047",
			"#FACC15",
			"#FBBF24",
			"#EAB308",
			"#CA8A04",
			"#A16207",
			"#854D0E",
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

function ArcTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");

	return (
		<MantineProvider theme={arcTheme} forceColorScheme={colorScheme}>
			<Flex h="100vh" bg="dark.8">
				<Box
					w={280}
					bg="dark.7"
					style={{
						borderRight: "1px solid rgba(255, 255, 255, 0.05)",
						background:
							"linear-gradient(180deg, rgba(18, 18, 18, 1) 0%, rgba(10, 10, 10, 1) 100%)",
					}}
				>
					<Stack gap={0} h="100%">
						<Box p="lg" pb="md">
							<Group gap="xs" mb={2}>
								<Box
									w={36}
									h={36}
									style={{
										borderRadius: 10,
										background:
											"linear-gradient(135deg, rgba(167, 139, 250, 1) 0%, rgba(147, 51, 234, 1) 100%)",
										display: "grid",
										placeItems: "center",
										boxShadow: "0 2px 8px rgba(147, 51, 234, 0.3)",
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
							<Text size="xs" c="dark.2" ml={44}>
								Arc Theme
							</Text>
						</Box>

						<Box px="sm" py="sm">
							<TextInput
								placeholder="Search..."
								leftSection={<Search size={16} />}
								size="sm"
								radius="xl"
								styles={{
									input: {
										backgroundColor: "rgba(255, 255, 255, 0.05)",
										border: "1px solid rgba(255, 255, 255, 0.08)",
										color: "var(--mantine-color-dark-0)",
										"&:focus": {
											borderColor: "var(--mantine-color-purple-5)",
											boxShadow: "0 0 0 3px rgba(167, 139, 250, 0.15)",
										},
										"&::placeholder": {
											color: "var(--mantine-color-dark-2)",
										},
									},
								}}
							/>
						</Box>

						<Divider color="rgba(255, 255, 255, 0.05)" />

						<Stack gap={3} p="sm" style={{ flex: 1, overflowY: "auto" }}>
							<NavLink
								label="Home"
								leftSection={<Home size={18} />}
								color="purple.5"
								variant="subtle"
								styles={{
									root: {
										borderRadius: 12,
										"&:hover": {
											backgroundColor: "rgba(255, 255, 255, 0.05)",
										},
									},
									label: { fontWeight: 500, fontSize: 14 },
								}}
							/>

							<Box mt="lg">
								<Text
									size="xs"
									c="dark.2"
									tt="uppercase"
									px="sm"
									mb={8}
									fw={700}
									style={{ letterSpacing: 0.5 }}
								>
									Spaces
								</Text>

								<NavLink
									label="Media"
									leftSection={<Film size={18} />}
									color="purple.4"
									defaultOpened
									styles={{
										root: {
											borderRadius: 12,
											backgroundColor: "rgba(167, 139, 250, 0.08)",
										},
										label: {
											color: "var(--mantine-color-purple-4)",
											fontWeight: 600,
											fontSize: 14,
										},
									}}
								>
									<NavLink
										label="Movies"
										color="purple.4"
										styles={{
											label: { fontWeight: 400, fontSize: 13 },
											root: { borderRadius: 10 },
										}}
									/>
									<NavLink
										label="Books"
										color="purple.4"
										styles={{
											label: { fontWeight: 400, fontSize: 13 },
											root: { borderRadius: 10 },
										}}
									/>
									<NavLink
										label="TV Shows"
										color="purple.4"
										styles={{
											label: { fontWeight: 400, fontSize: 13 },
											root: { borderRadius: 10 },
										}}
									/>
								</NavLink>

								<NavLink
									label="Fitness"
									leftSection={<Dumbbell size={18} />}
									color="green.5"
									styles={{
										root: {
											borderRadius: 12,
											backgroundColor: "rgba(52, 211, 153, 0.08)",
										},
										label: {
											color: "var(--mantine-color-green-5)",
											fontWeight: 600,
											fontSize: 14,
										},
									}}
								>
									<NavLink
										label="Workouts"
										color="green.5"
										styles={{
											label: { fontWeight: 400, fontSize: 13 },
											root: { borderRadius: 10 },
										}}
									/>
									<NavLink
										label="Measurements"
										color="green.5"
										styles={{
											label: { fontWeight: 400, fontSize: 13 },
											root: { borderRadius: 10 },
										}}
									/>
								</NavLink>

								<NavLink
									label="Whiskey"
									leftSection={<Wine size={18} />}
									color="yellow.5"
									styles={{
										root: {
											borderRadius: 12,
											backgroundColor: "rgba(251, 191, 36, 0.08)",
										},
										label: {
											color: "var(--mantine-color-yellow-5)",
											fontWeight: 600,
											fontSize: 14,
										},
									}}
								/>

								<NavLink
									label="Places"
									leftSection={<MapPin size={18} />}
									color="dark.1"
									styles={{
										root: { borderRadius: 12 },
										label: {
											color: "var(--mantine-color-dark-1)",
											fontWeight: 500,
											fontSize: 14,
										},
									}}
								/>
							</Box>

							<Box mt="lg">
								<Text
									size="xs"
									c="dark.2"
									tt="uppercase"
									px="sm"
									mb={8}
									fw={700}
									style={{ letterSpacing: 0.5 }}
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
											root: { borderRadius: 12 },
											label: {
												color: "var(--mantine-color-dark-1)",
												fontWeight: 400,
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
						<Group justify="space-between" mb="xl">
							<Box>
								<Title order={1} c="dark.0" fw={700} size="2rem">
									Dashboard
								</Title>
								<Text c="dark.1" size="sm" mt={6}>
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
									variant="gradient"
									gradient={{ from: "purple.5", to: "purple.6", deg: 135 }}
									size="md"
									radius="xl"
									styles={{
										root: {
											boxShadow: "0 4px 12px rgba(167, 139, 250, 0.25)",
											transition: "all 0.2s ease",
											"&:hover": {
												transform: "translateY(-1px)",
												boxShadow:
													"0 8px 16px rgba(167, 139, 250, 0.5), 0 0 20px rgba(167, 139, 250, 0.3)",
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
									"linear-gradient(135deg, rgba(167, 139, 250, 0.15) 0%, rgba(147, 51, 234, 0.05) 100%)",
									"linear-gradient(135deg, rgba(52, 211, 153, 0.15) 0%, rgba(34, 197, 94, 0.05) 100%)",
									"linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(234, 179, 8, 0.05) 100%)",
									"linear-gradient(135deg, rgba(34, 211, 238, 0.15) 0%, rgba(6, 182, 212, 0.05) 100%)",
								];
								const borderColors = [
									"purple.6",
									"green.5",
									"yellow.5",
									"cyan.5",
								];
								return (
									<Grid.Col key={stat.label} span={3}>
										<Card
											p="lg"
											bg="dark.7"
											radius="xl"
											style={{
												border: "1px solid rgba(255, 255, 255, 0.08)",
												borderBottom: `3px solid var(--mantine-color-${borderColors[idx % borderColors.length]})`,
												background: gradients[idx % 4],
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
															color="var(--mantine-color-green-5)"
														/>
														<Text size="xs" c="green.5" fw={600}>
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

						<Title order={2} size="h3" c="dark.0" fw={700} mb="lg">
							Recent Entities
						</Title>
						<Grid mb="xl">
							{entities.slice(0, 6).map((entity) => (
								<Grid.Col key={entity.id} span={4}>
									<Card
										p={0}
										bg="dark.7"
										radius="xl"
										style={{
											border: "1px solid rgba(255, 255, 255, 0.08)",
											cursor: "pointer",
											transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
											overflow: "hidden",
										}}
										styles={{
											root: {
												"&:hover": {
													transform: "translateY(-4px)",
													boxShadow:
														"0 12px 24px rgba(0, 0, 0, 0.5), 0 0 24px rgba(167, 139, 250, 0.25)",
													border: "1px solid rgba(167, 139, 250, 0.4)",
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
														inset: 0,
														background:
															"linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.4) 100%)",
													}}
												/>
											</Box>
										)}
										{!entity.image && (
											<Box
												h={200}
												style={{
													background:
														"linear-gradient(135deg, rgba(167, 139, 250, 0.1) 0%, rgba(147, 51, 234, 0.05) 100%)",
													display: "grid",
													placeItems: "center",
												}}
											>
												<Text c="dark.2" size="sm" fw={600}>
													No image
												</Text>
											</Box>
										)}
										<Box p="lg">
											<Group justify="space-between" mb={8}>
												<Text fw={700} c="dark.0" size="sm">
													{entity.name}
												</Text>
												{entity.properties.rating && (
													<Badge
														size="sm"
														variant="gradient"
														gradient={{
															from: "purple.4",
															to: "purple.6",
															deg: 135,
														}}
														styles={{
															root: {
																fontWeight: 700,
															},
														}}
													>
														{entity.properties.rating}
													</Badge>
												)}
											</Group>
											<Text size="xs" c="dark.1" mb={8} fw={600}>
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

						<Title order={2} size="h3" c="dark.0" fw={700} mb="lg">
							Recent Activity
						</Title>
						<Paper
							bg="dark.4"
							p="xl"
							radius="xl"
							style={{ border: "1px solid rgba(255, 255, 255, 0.08)" }}
						>
							<Stack gap="lg">
								{events.map((event, idx) => (
									<Box key={event.id}>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="xs" mb={8}>
													<Text fw={700} c="dark.0" size="sm">
														{event.entityName}
													</Text>
													<Badge
														size="sm"
														color="dark.3"
														variant="light"
														styles={{
															root: {
																backgroundColor: "rgba(255, 255, 255, 0.05)",
																color: "var(--mantine-color-dark-1)",
																fontWeight: 600,
															},
														}}
													>
														{event.schemaName}
													</Badge>
												</Group>
												<Text size="xs" c="dark.1" mb={8} fw={500}>
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
											<Divider color="rgba(255, 255, 255, 0.05)" mt="lg" />
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
