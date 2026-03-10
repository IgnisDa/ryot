import {
	Badge,
	Box,
	Burger,
	Button,
	Card,
	createTheme,
	Drawer,
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
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
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
import { entities, events, facets, savedViews, stats } from "./-common-data";

export const Route = createFileRoute("/themes/")({
	component: JournalTheme,
});

const DEFAULT_FACET_COLOR = {
	base: "#5B7FFF",
	muted: "rgba(91, 127, 255, 0.12)",
};

const facetColors: Record<string, { base: string; muted: string }> = {
	media: DEFAULT_FACET_COLOR,
	fitness: { base: "#2DD4BF", muted: "rgba(45, 212, 191, 0.12)" },
	whiskey: { base: "#D4A574", muted: "rgba(212, 165, 116, 0.12)" },
	places: { base: "#A78BFA", muted: "rgba(167, 139, 250, 0.12)" },
};

const facetIconMap: Record<string, typeof Film> = {
	media: Film,
	fitness: Dumbbell,
	whiskey: Wine,
	places: MapPin,
};

const schemaToFacet: Record<string, string> = {};
for (const facet of facets) {
	for (const schema of facet.entitySchemas) {
		schemaToFacet[schema.name] = facet.slug;
	}
}

function getFacetColor(schemaName: string) {
	const slug = schemaToFacet[schemaName] ?? "media";
	return facetColors[slug] ?? DEFAULT_FACET_COLOR;
}

const journalTheme = createTheme({
	fontFamily: '"Outfit", -apple-system, sans-serif',
	fontFamilyMonospace: '"IBM Plex Mono", monospace',
	primaryColor: "accent",
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
			"#302E2B",
			"#23211F",
			"#1A1816",
		],
		accent: [
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
		stone: [
			"#FAFAF9",
			"#F5F5F4",
			"#E7E5E4",
			"#D6D3D1",
			"#A8A29E",
			"#78716C",
			"#57534E",
			"#44403C",
			"#292524",
			"#1C1917",
		],
	},
	headings: {
		fontFamily: '"Space Grotesk", -apple-system, sans-serif',
		fontWeight: "600",
	},
});

function JournalTheme() {
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");
	const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
		useDisclosure(false);
	const isMobile = useMediaQuery("(max-width: 768px)") ?? false;
	const isDark = colorScheme === "dark";

	const bg = isDark ? "dark.9" : "stone.1";
	const surface = isDark ? "dark.8" : "white";
	const surfaceHover = isDark ? "dark.7" : "stone.1";
	const border = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-3)";
	const borderAccent = "var(--mantine-color-accent-5)";
	const textPrimary = isDark ? "dark.0" : "dark.9";
	const textSecondary = isDark ? "dark.3" : "dark.5";
	const textMuted = isDark ? "dark.4" : "stone.5";

	const sidebarContent = (
		<Stack gap={0} h="100%">
			<Box p="xl" pb="lg">
				<Group gap="sm" mb={4}>
					<Box
						w={32}
						h={32}
						style={{
							borderRadius: 6,
							background: "linear-gradient(135deg, #D4A574 0%, #C4963C 100%)",
							display: "grid",
							placeItems: "center",
						}}
					>
						<Text
							size="md"
							fw={700}
							c="white"
							style={{ fontFamily: '"Space Grotesk", sans-serif' }}
						>
							R
						</Text>
					</Box>
					<Text
						size="xl"
						fw={600}
						c={textPrimary}
						style={{ fontFamily: '"Space Grotesk", sans-serif' }}
					>
						Ryot
					</Text>
				</Group>
				<Text size="xs" c={textMuted} style={{ letterSpacing: "0.3px" }}>
					A journal of personal tracking
				</Text>
			</Box>

			<Box px="lg" pb="md">
				<TextInput
					placeholder="Search..."
					leftSection={<Search size={16} color={borderAccent} />}
					size="sm"
					styles={{
						input: {
							backgroundColor: isDark
								? "var(--mantine-color-dark-7)"
								: "var(--mantine-color-stone-1)",
							border: `1px solid ${border}`,
							fontWeight: 400,
							fontSize: "13px",
							"&:focus": {
								borderColor: borderAccent,
								boxShadow: "0 0 0 2px rgba(212, 165, 116, 0.15)",
							},
							"&::placeholder": {
								color: isDark
									? "var(--mantine-color-dark-4)"
									: "var(--mantine-color-stone-4)",
							},
						},
					}}
				/>
			</Box>

			<Box h={1} mx="lg" style={{ backgroundColor: border }} />

			<Stack gap={0} px="sm" py="md" style={{ flex: 1, overflowY: "auto" }}>
				<NavLink
					label="Home"
					leftSection={<Home size={18} color={borderAccent} />}
					color="accent.5"
					variant="subtle"
					onClick={closeDrawer}
					styles={{
						root: {
							padding: "10px 14px",
							borderLeft: "2px solid transparent",
							"&:hover": {
								backgroundColor: "rgba(212, 165, 116, 0.06)",
								borderLeftColor: borderAccent,
							},
						},
						label: { fontWeight: 500, fontSize: "14px" },
					}}
				/>

				<Box mt="xl" mb="sm">
					<Box
						px="md"
						py="xs"
						style={{ borderLeft: `2px solid ${borderAccent}` }}
					>
						<Text
							size="xs"
							c={textMuted}
							fw={600}
							style={{
								fontFamily: '"Space Grotesk", sans-serif',
								letterSpacing: "1px",
								textTransform: "uppercase",
							}}
						>
							Facets
						</Text>
					</Box>
				</Box>

				{facets.map((facet) => {
					const color = facetColors[facet.slug] ?? DEFAULT_FACET_COLOR;
					const Icon = facetIconMap[facet.slug] ?? Film;
					return (
						<NavLink
							key={facet.id}
							label={facet.name}
							leftSection={<Icon size={18} color={color.base} />}
							defaultOpened={facet.slug === "media"}
							styles={{
								root: {
									padding: "10px 14px",
									borderLeft: "2px solid transparent",
									"&:hover": {
										backgroundColor: color.muted,
										borderLeftColor: color.base,
									},
								},
								label: { fontWeight: 500, fontSize: "14px" },
							}}
						>
							{facet.entitySchemas.map((schema) => (
								<NavLink
									key={schema.id}
									label={schema.name}
									onClick={closeDrawer}
									styles={{
										root: {
											paddingLeft: "40px",
											"&:hover": { backgroundColor: color.muted },
										},
										label: {
											fontWeight: 400,
											fontSize: "13px",
											color: isDark
												? "var(--mantine-color-dark-2)"
												: "var(--mantine-color-dark-6)",
										},
									}}
								/>
							))}
						</NavLink>
					);
				})}

				<Box mt="xl" mb="sm">
					<Box px="md" py="xs" style={{ borderLeft: `2px solid ${border}` }}>
						<Text
							size="xs"
							c={textMuted}
							fw={600}
							style={{
								fontFamily: '"Space Grotesk", sans-serif',
								letterSpacing: "1px",
								textTransform: "uppercase",
							}}
						>
							Views
						</Text>
					</Box>
				</Box>

				{savedViews.map((view) => (
					<NavLink
						key={view.id}
						label={view.name}
						leftSection={<BookOpen size={16} color={borderAccent} />}
						onClick={closeDrawer}
						styles={{
							root: {
								padding: "8px 14px",
								borderLeft: "2px solid transparent",
								"&:hover": {
									backgroundColor: "rgba(212, 165, 116, 0.06)",
									borderLeftColor: borderAccent,
								},
							},
							label: {
								fontWeight: 400,
								fontSize: "13px",
								color: isDark
									? "var(--mantine-color-dark-2)"
									: "var(--mantine-color-dark-6)",
							},
						}}
					/>
				))}
			</Stack>
		</Stack>
	);

	return (
		<MantineProvider theme={journalTheme} forceColorScheme={colorScheme}>
			<style>
				{`
					@keyframes journalFadeIn {
						from { opacity: 0; transform: translateY(12px); }
						to { opacity: 1; transform: translateY(0); }
					}
					.journal-card:hover {
						transform: translateY(-3px);
						box-shadow: 0 8px 24px rgba(0, 0, 0, ${isDark ? "0.3" : "0.08"});
					}
					.journal-entity:hover {
						transform: translateY(-4px);
						box-shadow: 0 12px 32px rgba(0, 0, 0, ${isDark ? "0.35" : "0.1"});
						border-color: ${borderAccent} !important;
					}
					.journal-event:hover {
						background-color: ${isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.015)"};
					}
					@media (max-width: 768px) {
						.journal-card:hover,
						.journal-entity:hover {
							transform: none
							box-shadow: none
						}
					}
				`}
			</style>

			{isMobile && (
				<Drawer
					opened={drawerOpened}
					onClose={closeDrawer}
					size={300}
					padding={0}
					withCloseButton={false}
					styles={{
						body: {
							height: "100%",
							backgroundColor: isDark ? "var(--mantine-color-dark-8)" : "white",
						},
						content: {
							backgroundColor: isDark ? "var(--mantine-color-dark-8)" : "white",
						},
					}}
				>
					{sidebarContent}
				</Drawer>
			)}

			<Flex h="100vh" bg={bg}>
				{!isMobile && (
					<Box
						w={300}
						bg={surface}
						style={{
							borderRight: `1px solid ${border}`,
							display: "flex",
							flexDirection: "column",
							flexShrink: 0,
						}}
					>
						{sidebarContent}
					</Box>
				)}

				<Box flex={1} style={{ overflowY: "auto", minWidth: 0 }}>
					<Box
						p={isMobile ? "lg" : "2.5rem"}
						pb={isMobile ? "md" : "2rem"}
						style={{
							borderBottom: `1px solid ${border}`,
							background: isDark
								? "linear-gradient(180deg, var(--mantine-color-dark-8) 0%, var(--mantine-color-dark-9) 100%)"
								: "linear-gradient(180deg, white 0%, var(--mantine-color-stone-1) 100%)",
						}}
					>
						<Stack gap={isMobile ? "md" : 0}>
							{isMobile && (
								<Group justify="space-between">
									<Burger
										opened={drawerOpened}
										onClick={openDrawer}
										size="sm"
										color={
											isDark
												? "var(--mantine-color-dark-1)"
												: "var(--mantine-color-dark-7)"
										}
									/>
									<Group gap="xs">
										<Box
											w={28}
											h={28}
											style={{
												borderRadius: 5,
												background:
													"linear-gradient(135deg, #D4A574 0%, #C4963C 100%)",
												display: "grid",
												placeItems: "center",
											}}
										>
											<Text
												size="sm"
												fw={700}
												c="white"
												style={{ fontFamily: '"Space Grotesk", sans-serif' }}
											>
												R
											</Text>
										</Box>
										<Text
											size="lg"
											fw={600}
											c={textPrimary}
											style={{ fontFamily: '"Space Grotesk", sans-serif' }}
										>
											Ryot
										</Text>
									</Group>
									<Button
										variant="subtle"
										size="compact-sm"
										p={4}
										onClick={() => setColorScheme(isDark ? "light" : "dark")}
										styles={{
											root: {
												color: isDark
													? "var(--mantine-color-dark-1)"
													: "var(--mantine-color-dark-6)",
											},
										}}
									>
										{isDark ? <Sun size={18} /> : <Moon size={18} />}
									</Button>
								</Group>
							)}

							<Group
								justify="space-between"
								align={isMobile ? "flex-start" : "flex-start"}
								wrap={isMobile ? "wrap" : "nowrap"}
							>
								<Box>
									<Text
										size="xs"
										c="accent.5"
										mb="xs"
										fw={600}
										style={{
											fontFamily: '"Space Grotesk", sans-serif',
											letterSpacing: "2px",
											textTransform: "uppercase",
										}}
									>
										Overview
									</Text>
									<Title
										order={1}
										c={textPrimary}
										fw={600}
										mb="xs"
										style={{
											fontFamily: '"Space Grotesk", sans-serif',
											fontSize: isMobile ? "1.75rem" : "2.25rem",
											lineHeight: 1.15,
										}}
									>
										Dashboard
									</Title>
									<Text c={textSecondary} size="sm" style={{ maxWidth: 420 }}>
										Your tracking at a glance. 4 facets, 247 entities, always in
										your control.
									</Text>
								</Box>
								{!isMobile && (
									<Group gap="sm" mt="sm">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setColorScheme(isDark ? "light" : "dark")}
											leftSection={
												isDark ? <Sun size={16} /> : <Moon size={16} />
											}
											styles={{
												root: {
													borderColor: border,
													color: isDark
														? "var(--mantine-color-dark-1)"
														: "var(--mantine-color-dark-6)",
													fontWeight: 500,
													"&:hover": {
														backgroundColor: surfaceHover,
														borderColor: borderAccent,
													},
												},
											}}
										>
											{isDark ? "Light" : "Dark"}
										</Button>
										<Button
											variant="filled"
											color="accent"
											size="md"
											styles={{
												root: {
													backgroundColor: "var(--mantine-color-accent-5)",
													color: "var(--mantine-color-dark-9)",
													fontWeight: 600,
													border: "1px solid var(--mantine-color-accent-6)",
													"&:hover": {
														backgroundColor: "var(--mantine-color-accent-6)",
														transform: "translateY(-1px)",
														boxShadow: "0 4px 12px rgba(212, 165, 116, 0.25)",
													},
												},
											}}
										>
											Log Activity
										</Button>
									</Group>
								)}
								{isMobile && (
									<Button
										variant="filled"
										color="accent"
										size="sm"
										fullWidth
										styles={{
											root: {
												backgroundColor: "var(--mantine-color-accent-5)",
												color: "var(--mantine-color-dark-9)",
												fontWeight: 600,
												border: "1px solid var(--mantine-color-accent-6)",
											},
										}}
									>
										Log Activity
									</Button>
								)}
							</Group>
						</Stack>
					</Box>

					<Box p={isMobile ? "md" : "2.5rem"}>
						<Grid mb={isMobile ? "lg" : "2.5rem"}>
							{stats.map((stat, idx) => {
								const cardColors = ["#5B7FFF", "#2DD4BF", "#D4A574", "#A78BFA"];
								return (
									<Grid.Col key={stat.label} span={{ base: 6, md: 3 }}>
										<Card
											p={isMobile ? "md" : "xl"}
											bg={surface}
											radius="sm"
											className="journal-card"
											style={{
												border: `1px solid ${border}`,
												borderTop: `3px solid ${cardColors[idx]}`,
												transition: "all 0.2s ease",
												animation: `journalFadeIn 0.4s ease ${idx * 0.1}s backwards`,
											}}
										>
											<Stack gap={isMobile ? 6 : 10}>
												<Text
													size="xs"
													fw={600}
													tt="uppercase"
													style={{
														fontFamily: '"Space Grotesk", sans-serif',
														letterSpacing: "1px",
														color: cardColors[idx],
													}}
												>
													{stat.label}
												</Text>
												<Text
													size={isMobile ? "1.75rem" : "2.5rem"}
													fw={600}
													c={textPrimary}
													lh={1}
													style={{
														fontFamily: '"Space Grotesk", sans-serif',
													}}
												>
													{stat.value}
												</Text>
												{stat.change && (
													<Group gap={5} mt={2}>
														<TrendingUp size={14} color={cardColors[idx]} />
														<Text
															size="xs"
															fw={500}
															style={{
																color: cardColors[idx],
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

						<SectionHeader
							title="Recent Entries"
							subtitle="From across your facets"
							border={border}
						/>

						<Grid mb={isMobile ? "lg" : "2.5rem"}>
							{entities.slice(0, 6).map((entity, idx) => {
								const color = getFacetColor(entity.schemaName);
								return (
									<Grid.Col key={entity.id} span={{ base: 12, sm: 6, md: 4 }}>
										<Card
											p={0}
											bg={surface}
											radius="sm"
											className="journal-entity"
											style={{
												border: `1px solid ${border}`,
												cursor: "pointer",
												overflow: "hidden",
												transition: "all 0.25s ease",
												animation: `journalFadeIn 0.4s ease ${(idx + 4) * 0.08}s backwards`,
											}}
										>
											{entity.image && (
												<Box
													h={isMobile ? 180 : 220}
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
															background: `linear-gradient(180deg, transparent 50%, ${isDark ? "rgba(26, 24, 22, 0.7)" : "rgba(0, 0, 0, 0.35)"} 100%)`,
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
																variant="filled"
																styles={{
																	root: {
																		backgroundColor: color.base,
																		color: "white",
																		fontFamily: '"Space Grotesk", sans-serif',
																		fontWeight: 700,
																		border: "none",
																		boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
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
													h={isMobile ? 180 : 220}
													bg={surfaceHover}
													style={{
														display: "grid",
														placeItems: "center",
													}}
												>
													<Text c={textMuted} size="sm" fw={500}>
														No image
													</Text>
												</Box>
											)}
											<Box p={isMobile ? "md" : "lg"}>
												<Text
													fw={600}
													c={textPrimary}
													size="md"
													mb={6}
													style={{
														fontFamily: '"Space Grotesk", sans-serif',
													}}
												>
													{entity.name}
												</Text>
												<Badge
													size="sm"
													variant="light"
													mb={8}
													styles={{
														root: {
															backgroundColor: color.muted,
															color: color.base,
															border: `1px solid ${color.base}33`,
															fontWeight: 600,
															fontFamily: '"Space Grotesk", sans-serif',
														},
													}}
												>
													{entity.schemaName}
												</Badge>
												<Text
													size="xs"
													c={textSecondary}
													mt={4}
													style={{ lineHeight: 1.5 }}
												>
													{entity.lastEvent}
												</Text>
											</Box>
										</Card>
									</Grid.Col>
								);
							})}
						</Grid>

						<SectionHeader
							title="Activity Log"
							subtitle="Recent events across all facets"
							border={border}
						/>

						<Paper
							bg={surface}
							p={isMobile ? "sm" : "xl"}
							radius="sm"
							style={{ border: `1px solid ${border}` }}
						>
							<Stack gap={0}>
								{events.map((event, idx) => {
									const color = getFacetColor(event.schemaName);
									return (
										<Box
											key={event.id}
											p={isMobile ? "sm" : "lg"}
											className="journal-event"
											style={{
												borderLeft: `3px solid ${color.base}`,
												borderBottom:
													idx < events.length - 1
														? `1px solid ${border}`
														: "none",
												transition: "background-color 0.15s ease",
												animation: `journalFadeIn 0.4s ease ${(idx + 10) * 0.06}s backwards`,
											}}
										>
											<Box>
												<Group gap="sm" mb={6} wrap="wrap">
													<Text
														fw={600}
														c={textPrimary}
														size="sm"
														style={{
															fontFamily: '"Space Grotesk", sans-serif',
														}}
													>
														{event.entityName}
													</Text>
													<Badge
														size="sm"
														variant="light"
														styles={{
															root: {
																backgroundColor: color.muted,
																color: color.base,
																border: `1px solid ${color.base}33`,
																fontWeight: 600,
																fontFamily: '"Space Grotesk", sans-serif',
															},
														}}
													>
														{event.schemaName}
													</Badge>
												</Group>
												<Text size="xs" c={textSecondary} mb={6}>
													{event.type} · {event.occurredAt}
												</Text>
												{Object.keys(event.properties).length > 0 && (
													<Group gap={6} mt={6} wrap="wrap">
														{Object.entries(event.properties).map(
															([key, value]) => (
																<Badge
																	key={key}
																	size="xs"
																	variant="outline"
																	styles={{
																		root: {
																			borderColor: border,
																			color: isDark
																				? "var(--mantine-color-dark-2)"
																				: "var(--mantine-color-dark-6)",
																			fontWeight: 500,
																			backgroundColor: isDark
																				? "rgba(255, 255, 255, 0.03)"
																				: "rgba(0, 0, 0, 0.02)",
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
										</Box>
									);
								})}
							</Stack>
						</Paper>
					</Box>
				</Box>
			</Flex>
		</MantineProvider>
	);
}

function SectionHeader(props: {
	title: string;
	subtitle: string;
	border: string;
}) {
	return (
		<Box mb="xl" mt="xl">
			<Box
				mb="md"
				pb="sm"
				style={{ borderBottom: `1px solid ${props.border}` }}
			>
				<Title
					order={2}
					size="1.5rem"
					fw={600}
					mb={4}
					style={{ fontFamily: '"Space Grotesk", sans-serif' }}
				>
					{props.title}
				</Title>
				<Text size="sm" c="dimmed">
					{props.subtitle}
				</Text>
			</Box>
		</Box>
	);
}
