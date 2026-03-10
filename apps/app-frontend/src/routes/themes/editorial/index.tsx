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

export const Route = createFileRoute("/themes/editorial/")({
	component: EditorialTheme,
});

const editorialTheme = createTheme({
	fontFamily: '"Lora", "Georgia", serif',
	fontFamilyMonospace: '"Courier New", monospace',
	primaryColor: "gold",
	defaultRadius: "sm",
	colors: {
		dark: [
			"#FAFAF9",
			"#E7E5E4",
			"#D6D3D1",
			"#A8A29E",
			"#78716C",
			"#57534E",
			"#44403C",
			"#292524",
			"#1C1917",
			"#0C0A09",
		],
		gold: [
			"#FFFBEB",
			"#FEF3C7",
			"#FDE68A",
			"#FCD34D",
			"#FBBF24",
			"#D4A574",
			"#C4963C",
			"#9F7928",
			"#7C5D20",
			"#5A4318",
		],
		sage: [
			"#F6F7F6",
			"#E8EBE8",
			"#D4DBD4",
			"#B8C4B8",
			"#9AAD9A",
			"#7C967C",
			"#657F65",
			"#4F684F",
			"#3A513A",
			"#283A28",
		],
		cream: [
			"#FEFDFB",
			"#FDF9F3",
			"#FBF3E8",
			"#F7EBDB",
			"#F1DDCA",
			"#E8D0B8",
			"#D9BFA0",
			"#C7A982",
			"#B08F64",
			"#967548",
		],
	},
	headings: {
		fontFamily: '"Playfair Display", "Georgia", serif',
		fontWeight: "700",
	},
});

function EditorialTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");

	return (
		<MantineProvider theme={editorialTheme} forceColorScheme={colorScheme}>
			<Flex h="100vh" bg="cream.0">
				<Box
					w={320}
					bg="cream.1"
					style={{
						borderRight: "3px double var(--mantine-color-gold-5)",
						boxShadow: "2px 0 8px rgba(0, 0, 0, 0.05)",
					}}
				>
					<Stack gap={0} h="100%">
						<Box p="xl" pb="lg">
							<Text
								size="2.5rem"
								fw={400}
								c="dark.9"
								style={{
									fontFamily: '"Playfair Display", serif',
									lineHeight: 1,
								}}
							>
								Ryot
							</Text>
							<Text
								size="xs"
								c="dark.5"
								mt={8}
								style={{
									fontFamily: '"Lora", serif',
									fontStyle: "italic",
									letterSpacing: "0.5px",
								}}
							>
								A Journal of Personal Tracking
							</Text>
						</Box>

						<Box px="lg" pb="lg">
							<TextInput
								placeholder="Search archives..."
								leftSection={
									<Search size={18} color="var(--mantine-color-gold-5)" />
								}
								size="md"
								styles={{
									input: {
										backgroundColor: "white",
										border: "1px solid var(--mantine-color-gold-4)",
										color: "var(--mantine-color-dark-9)",
										fontFamily: '"Lora", serif',
										borderRadius: "2px",
										"&:focus": {
											borderColor: "var(--mantine-color-gold-5)",
											boxShadow: "0 0 0 2px rgba(212, 165, 116, 0.15)",
										},
										"&::placeholder": {
											color: "var(--mantine-color-dark-4)",
											fontStyle: "italic",
										},
									},
								}}
							/>
						</Box>

						<Box h={1} bg="gold.4" mb="lg" />

						<Stack gap={0} px="lg" style={{ flex: 1, overflowY: "auto" }}>
							<NavLink
								label="Home"
								leftSection={
									<Home size={20} color="var(--mantine-color-gold-6)" />
								}
								color="gold.6"
								variant="subtle"
								styles={{
									root: {
										borderRadius: "2px",
										padding: "12px 16px",
										borderLeft: "3px solid transparent",
										fontFamily: '"Lora", serif',
										"&:hover": {
											backgroundColor: "rgba(212, 165, 116, 0.08)",
											borderLeftColor: "var(--mantine-color-gold-5)",
										},
									},
									label: { fontWeight: 500, fontSize: "15px" },
								}}
							/>

							<Box mt="xl" mb="md">
								<Text
									size="sm"
									c="dark.7"
									px="md"
									mb="md"
									style={{
										fontFamily: '"Playfair Display", serif',
										fontSize: "13px",
										letterSpacing: "1.5px",
										textTransform: "uppercase",
										fontWeight: 600,
									}}
								>
									Collections
								</Text>
								<Box h={1} bg="gold.3" mb="md" />
							</Box>

							<NavLink
								label="Media"
								leftSection={
									<Film size={20} color="var(--mantine-color-sage-6)" />
								}
								color="sage.6"
								defaultOpened
								styles={{
									root: {
										borderRadius: "2px",
										padding: "12px 16px",
										borderLeft: "3px solid transparent",
										fontFamily: '"Lora", serif',
										"&:hover": {
											backgroundColor: "rgba(124, 150, 124, 0.08)",
											borderLeftColor: "var(--mantine-color-sage-5)",
										},
									},
									label: { fontWeight: 500, fontSize: "15px" },
								}}
							>
								<NavLink
									label="Movies"
									color="sage.7"
									styles={{
										root: { paddingLeft: "40px", fontFamily: '"Lora", serif' },
										label: { fontWeight: 400, fontSize: "14px" },
									}}
								/>
								<NavLink
									label="Books"
									color="sage.7"
									styles={{
										root: { paddingLeft: "40px", fontFamily: '"Lora", serif' },
										label: { fontWeight: 400, fontSize: "14px" },
									}}
								/>
								<NavLink
									label="TV Shows"
									color="sage.7"
									styles={{
										root: { paddingLeft: "40px", fontFamily: '"Lora", serif' },
										label: { fontWeight: 400, fontSize: "14px" },
									}}
								/>
							</NavLink>

							<NavLink
								label="Fitness"
								leftSection={
									<Dumbbell size={20} color="var(--mantine-color-gold-6)" />
								}
								color="gold.6"
								styles={{
									root: {
										borderRadius: "2px",
										padding: "12px 16px",
										borderLeft: "3px solid transparent",
										fontFamily: '"Lora", serif',
										"&:hover": {
											backgroundColor: "rgba(212, 165, 116, 0.08)",
											borderLeftColor: "var(--mantine-color-gold-5)",
										},
									},
									label: { fontWeight: 500, fontSize: "15px" },
								}}
							/>

							<NavLink
								label="Whiskey"
								leftSection={
									<Wine size={20} color="var(--mantine-color-gold-7)" />
								}
								color="gold.7"
								styles={{
									root: {
										borderRadius: "2px",
										padding: "12px 16px",
										borderLeft: "3px solid transparent",
										fontFamily: '"Lora", serif',
										"&:hover": {
											backgroundColor: "rgba(212, 165, 116, 0.08)",
											borderLeftColor: "var(--mantine-color-gold-5)",
										},
									},
									label: { fontWeight: 500, fontSize: "15px" },
								}}
							/>

							<NavLink
								label="Places"
								leftSection={
									<MapPin size={20} color="var(--mantine-color-sage-6)" />
								}
								color="sage.6"
								styles={{
									root: {
										borderRadius: "2px",
										padding: "12px 16px",
										borderLeft: "3px solid transparent",
										fontFamily: '"Lora", serif',
										"&:hover": {
											backgroundColor: "rgba(124, 150, 124, 0.08)",
											borderLeftColor: "var(--mantine-color-sage-5)",
										},
									},
									label: { fontWeight: 500, fontSize: "15px" },
								}}
							/>

							<Box mt="xl" mb="md">
								<Text
									size="sm"
									c="dark.7"
									px="md"
									mb="md"
									style={{
										fontFamily: '"Playfair Display", serif',
										fontSize: "13px",
										letterSpacing: "1.5px",
										textTransform: "uppercase",
										fontWeight: 600,
									}}
								>
									Curated Views
								</Text>
								<Box h={1} bg="gold.3" mb="md" />
							</Box>
							{savedViews.map((view) => (
								<NavLink
									key={view.id}
									label={view.name}
									leftSection={
										<BookOpen size={18} color="var(--mantine-color-gold-6)" />
									}
									color="gold.6"
									styles={{
										root: {
											borderRadius: "2px",
											padding: "10px 16px",
											borderLeft: "3px solid transparent",
											fontFamily: '"Lora", serif',
											"&:hover": {
												backgroundColor: "rgba(212, 165, 116, 0.08)",
												borderLeftColor: "var(--mantine-color-gold-5)",
											},
										},
										label: {
											fontWeight: 400,
											fontSize: "14px",
											fontStyle: "italic",
										},
									}}
								/>
							))}
						</Stack>
					</Stack>
				</Box>

				<Box flex={1} style={{ overflowY: "auto", backgroundColor: "white" }}>
					<Box
						p="3rem"
						pt="4rem"
						style={{
							borderBottom: "2px solid var(--mantine-color-gold-4)",
							background: "linear-gradient(to bottom, #FFFBEB 0%, white 100%)",
						}}
					>
						<Group justify="space-between" align="flex-start">
							<Box>
								<Text
									size="xs"
									c="gold.7"
									mb="sm"
									style={{
										fontFamily: '"Playfair Display", serif',
										letterSpacing: "3px",
										textTransform: "uppercase",
										fontWeight: 600,
									}}
								>
									Volume I • Issue XII
								</Text>
								<Title
									order={1}
									c="dark.9"
									fw={400}
									mb="md"
									style={{
										fontFamily: '"Playfair Display", serif',
										fontSize: "3.5rem",
										lineHeight: 1.1,
									}}
								>
									Dashboard
								</Title>
								<Text
									c="dark.6"
									size="md"
									style={{
										fontFamily: '"Lora", serif',
										fontStyle: "italic",
										maxWidth: "500px",
										lineHeight: 1.7,
									}}
								>
									A comprehensive overview of your personal tracking endeavors,
									curated for your review.
								</Text>
							</Box>
							<Group gap="md" mt="xl">
								<Button
									variant="outline"
									color="gold.7"
									size="md"
									onClick={() =>
										setColorScheme(colorScheme === "dark" ? "light" : "dark")
									}
									leftSection={
										colorScheme === "dark" ? (
											<Sun size={18} color="var(--mantine-color-gold-7)" />
										) : (
											<Moon size={18} color="var(--mantine-color-gold-7)" />
										)
									}
									styles={{
										root: {
											borderRadius: "2px",
											border: "1.5px solid var(--mantine-color-gold-5)",
											fontFamily: '"Lora", serif',
											fontWeight: 500,
											transition: "all 0.2s ease",
											"&:hover": {
												backgroundColor: "rgba(212, 165, 116, 0.08)",
												transform: "translateY(-1px)",
											},
										},
									}}
								>
									{colorScheme === "dark" ? "Light" : "Dark"}
								</Button>
								<Button
									variant="filled"
									color="gold"
									size="lg"
									styles={{
										root: {
											borderRadius: "2px",
											backgroundColor: "var(--mantine-color-gold-5)",
											color: "var(--mantine-color-dark-9)",
											fontFamily: '"Lora", serif',
											fontWeight: 600,
											border: "1.5px solid var(--mantine-color-gold-6)",
											transition: "all 0.2s ease",
											"&:hover": {
												backgroundColor: "var(--mantine-color-gold-6)",
												transform: "translateY(-1px)",
												boxShadow: "0 4px 12px rgba(212, 165, 116, 0.3)",
											},
										},
									}}
								>
									Log Activity
								</Button>
							</Group>
						</Group>
					</Box>

					<Box p="3rem">
						<Grid mb="4rem">
							{stats.map((stat, idx) => {
								const accentColors = ["gold.6", "sage.6", "gold.7", "sage.7"];
								return (
									<Grid.Col key={stat.label} span={3}>
										<Card
											p="xl"
											bg="cream.0"
											radius="sm"
											style={{
												border: "2px solid var(--mantine-color-gold-3)",
												borderTop: `4px solid var(--mantine-color-${accentColors[idx]})`,
												transition: "all 0.25s ease",
												animation: `fadeIn 0.5s ease ${idx * 0.15}s backwards`,
											}}
											className="editorial-stat-card"
										>
											<Stack gap={12}>
												<Text
													size="xs"
													c={accentColors[idx]}
													tt="uppercase"
													fw={600}
													style={{
														fontFamily: '"Playfair Display", serif',
														letterSpacing: "2px",
													}}
												>
													{stat.label}
												</Text>
												<Text
													size="3.5rem"
													fw={400}
													c="dark.9"
													lh={0.9}
													style={{ fontFamily: '"Playfair Display", serif' }}
												>
													{stat.value}
												</Text>
												{stat.change && (
													<Group gap={6} mt={4}>
														<TrendingUp
															size={16}
															color={`var(--mantine-color-${accentColors[idx]})`}
														/>
														<Text
															size="sm"
															c={accentColors[idx]}
															fw={500}
															style={{
																fontFamily: '"Lora", serif',
																fontStyle: "italic",
															}}
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
								.editorial-stat-card:hover {
									transform: translateY(-4px);
									box-shadow: 0 8px 20px rgba(212, 165, 116, 0.2);
								}
							`}
						</style>

						<Box mb="2rem" mt="4rem">
							<Box h={2} bg="gold.4" mb="lg" />
							<Title
								order={2}
								size="2.5rem"
								c="dark.9"
								fw={400}
								mb="md"
								style={{ fontFamily: '"Playfair Display", serif' }}
							>
								Featured Entries
							</Title>
							<Text
								c="dark.6"
								size="sm"
								mb="xl"
								style={{ fontFamily: '"Lora", serif', fontStyle: "italic" }}
							>
								A curated selection from your personal archive
							</Text>
						</Box>

						<Grid mb="4rem">
							{entities.slice(0, 6).map((entity, idx) => (
								<Grid.Col key={entity.id} span={4}>
									<Card
										p={0}
										bg="white"
										radius="sm"
										style={{
											border: "2px solid var(--mantine-color-gold-3)",
											cursor: "pointer",
											transition: "all 0.3s ease",
											overflow: "hidden",
											animation: `fadeIn 0.5s ease ${(idx + 4) * 0.1}s backwards`,
										}}
										className="editorial-entity-card"
									>
										{entity.image && (
											<Box
												h={260}
												style={{
													backgroundImage: `url(${entity.image})`,
													backgroundSize: "cover",
													backgroundPosition: "center",
													position: "relative",
												}}
											>
												{entity.properties.rating && (
													<Box
														style={{
															position: "absolute",
															top: 16,
															right: 16,
														}}
													>
														<Badge
															size="lg"
															color="gold"
															variant="filled"
															styles={{
																root: {
																	borderRadius: "2px",
																	backgroundColor:
																		"var(--mantine-color-gold-5)",
																	color: "var(--mantine-color-dark-9)",
																	fontFamily: '"Playfair Display", serif',
																	fontWeight: 700,
																	fontSize: "1rem",
																	border:
																		"2px solid var(--mantine-color-gold-6)",
																	boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
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
												h={260}
												bg="cream.1"
												style={{
													display: "grid",
													placeItems: "center",
													border: "2px dashed var(--mantine-color-gold-4)",
												}}
											>
												<Text
													c="gold.6"
													size="sm"
													fw={500}
													style={{
														fontFamily: '"Lora", serif',
														fontStyle: "italic",
													}}
												>
													No image available
												</Text>
											</Box>
										)}
										<Box p="xl">
											<Text
												fw={400}
												c="dark.9"
												size="xl"
												mb="sm"
												style={{ fontFamily: '"Playfair Display", serif' }}
											>
												{entity.name}
											</Text>
											<Text
												size="xs"
												c="gold.7"
												mb="sm"
												fw={600}
												tt="uppercase"
												style={{
													fontFamily: '"Playfair Display", serif',
													letterSpacing: "1.5px",
												}}
											>
												{entity.schemaName}
											</Text>
											<Text
												size="sm"
												c="dark.6"
												style={{
													fontFamily: '"Lora", serif',
													fontStyle: "italic",
													lineHeight: 1.6,
												}}
											>
												{entity.lastEvent}
											</Text>
										</Box>
									</Card>
								</Grid.Col>
							))}
						</Grid>
						<style>
							{`
								.editorial-entity-card:hover {
									transform: translateY(-6px);
									box-shadow: 0 12px 28px rgba(212, 165, 116, 0.2);
									border-color: var(--mantine-color-gold-5);
								}
							`}
						</style>

						<Box mb="2rem" mt="4rem">
							<Box h={2} bg="gold.4" mb="lg" />
							<Title
								order={2}
								size="2.5rem"
								c="dark.9"
								fw={400}
								mb="md"
								style={{ fontFamily: '"Playfair Display", serif' }}
							>
								Activity Chronicle
							</Title>
							<Text
								c="dark.6"
								size="sm"
								mb="xl"
								style={{ fontFamily: '"Lora", serif', fontStyle: "italic" }}
							>
								Recent engagements and milestones
							</Text>
						</Box>

						<Paper
							bg="cream.0"
							p="2rem"
							radius="sm"
							style={{ border: "2px solid var(--mantine-color-gold-3)" }}
						>
							<Stack gap="lg">
								{events.map((event) => (
									<Box
										key={event.id}
										p="lg"
										style={{
											borderLeft: "3px solid var(--mantine-color-gold-5)",
											borderBottom: "1px solid var(--mantine-color-gold-3)",
											paddingBottom: "1.5rem",
										}}
									>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="sm" mb={8}>
													<Text
														fw={400}
														c="dark.9"
														size="lg"
														style={{ fontFamily: '"Playfair Display", serif' }}
													>
														{event.entityName}
													</Text>
													<Badge
														size="sm"
														color="gold"
														variant="outline"
														styles={{
															root: {
																borderRadius: "2px",
																backgroundColor: "rgba(212, 165, 116, 0.08)",
																border:
																	"1.5px solid var(--mantine-color-gold-5)",
																color: "var(--mantine-color-gold-7)",
																fontFamily: '"Lora", serif',
																fontWeight: 600,
															},
														}}
													>
														{event.schemaName}
													</Badge>
												</Group>
												<Text
													size="sm"
													c="dark.6"
													mb={8}
													style={{
														fontFamily: '"Lora", serif',
														fontStyle: "italic",
													}}
												>
													{event.type} · {event.occurredAt}
												</Text>
												{Object.keys(event.properties).length > 0 && (
													<Group gap={8} mt={8}>
														{Object.entries(event.properties).map(
															([key, value]) => (
																<Badge
																	key={key}
																	size="xs"
																	color="sage"
																	variant="filled"
																	styles={{
																		root: {
																			borderRadius: "2px",
																			backgroundColor:
																				"var(--mantine-color-sage-4)",
																			color: "var(--mantine-color-dark-9)",
																			fontFamily: '"Lora", serif',
																			fontWeight: 500,
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
						</Paper>
					</Box>
				</Box>
			</Flex>
		</MantineProvider>
	);
}
