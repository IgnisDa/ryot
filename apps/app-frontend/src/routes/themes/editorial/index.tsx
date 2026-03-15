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
	const [colorScheme, setColorScheme] = useState<"light" | "dark">("light");
	const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
		useDisclosure(false);
	const isMobile = useMediaQuery("(max-width: 768px)") ?? false;
	const isDark = colorScheme === "dark";

	const bg = isDark ? "dark.9" : "cream.0";
	const surface = isDark ? "dark.8" : "cream.1";
	const mainContent = isDark ? "dark.8" : "white";
	const textPrimary = isDark ? "cream.0" : "dark.9";
	const textSecondary = isDark ? "dark.3" : "dark.6";
	const textMuted = isDark ? "dark.4" : "dark.5";
	const sectionLabel = isDark ? "cream.2" : "dark.7";
	const border = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-gold-3)";
	const doubleBorder = isDark
		? "var(--mantine-color-gold-6)"
		: "var(--mantine-color-gold-5)";
	const accentText = isDark ? "gold.5" : "gold.7";
	const headerGradient = isDark
		? "linear-gradient(to bottom, var(--mantine-color-dark-7) 0%, var(--mantine-color-dark-8) 100%)"
		: "linear-gradient(to bottom, #FFFBEB 0%, white 100%)";
	const cardBg = isDark ? "dark.7" : "cream.0";
	const entityCardBg = isDark ? "dark.8" : "white";
	const searchInputBg = isDark ? "var(--mantine-color-dark-7)" : "white";
	const searchInputBorder = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-gold-4)";
	const searchInputFocus = isDark
		? "var(--mantine-color-gold-6)"
		: "var(--mantine-color-gold-5)";
	const sageColor = isDark ? "sage.5" : "sage.6";
	const sageColorDark = isDark ? "sage.6" : "sage.7";
	const goldBorder = isDark
		? "var(--mantine-color-gold-6)"
		: "var(--mantine-color-gold-4)";
	const goldButton = isDark
		? "var(--mantine-color-gold-6)"
		: "var(--mantine-color-gold-5)";
	const goldButtonHover = isDark
		? "var(--mantine-color-gold-7)"
		: "var(--mantine-color-gold-6)";
	const eventPropertyBadgeBg = isDark
		? "var(--mantine-color-sage-7)"
		: "var(--mantine-color-sage-4)";
	const eventPropertyBadgeColor = isDark
		? "var(--mantine-color-cream-0)"
		: "var(--mantine-color-dark-9)";

	const sidebarContent = (
		<Stack gap={0} h="100%">
			<Box p="xl" pb="lg">
				<Text
					size="2.5rem"
					fw={400}
					c={textPrimary}
					style={{
						fontFamily: '"Playfair Display", serif',
						lineHeight: 1,
					}}
				>
					Ryot
				</Text>
				<Text
					size="xs"
					c={textMuted}
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
						<Search
							size={18}
							color={
								isDark
									? "var(--mantine-color-gold-6)"
									: "var(--mantine-color-gold-5)"
							}
						/>
					}
					size="md"
					styles={{
						input: {
							backgroundColor: searchInputBg,
							border: `1px solid ${searchInputBorder}`,
							color: textPrimary,
							fontFamily: '"Lora", serif',
							borderRadius: "2px",
							"&:focus": {
								borderColor: searchInputFocus,
								boxShadow: isDark
									? "0 0 0 2px rgba(212, 165, 116, 0.25)"
									: "0 0 0 2px rgba(212, 165, 116, 0.15)",
							},
							"&::placeholder": {
								color: textMuted,
								fontStyle: "italic",
							},
						},
					}}
				/>
			</Box>

			<Box h={1} bg={isDark ? "gold.6" : "gold.4"} mb="lg" />

			<Stack gap={0} px="lg" style={{ flex: 1, overflowY: "auto" }}>
				<NavLink
					label="Home"
					onClick={closeDrawer}
					leftSection={
						<Home
							size={20}
							color={
								isDark
									? "var(--mantine-color-gold-5)"
									: "var(--mantine-color-gold-6)"
							}
						/>
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
								backgroundColor: isDark
									? "rgba(212, 165, 116, 0.12)"
									: "rgba(212, 165, 116, 0.08)",
								borderLeftColor: isDark
									? "var(--mantine-color-gold-6)"
									: "var(--mantine-color-gold-5)",
							},
						},
						label: { fontWeight: 500, fontSize: "15px" },
					}}
				/>

				<Box mt="xl" mb="md">
					<Text
						size="sm"
						c={sectionLabel}
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
					<Box h={1} bg={border} mb="md" />
				</Box>

				<NavLink
					label="Media"
					onClick={closeDrawer}
					leftSection={
						<Film
							size={20}
							color={
								isDark
									? "var(--mantine-color-sage-5)"
									: "var(--mantine-color-sage-6)"
							}
						/>
					}
					color={sageColor}
					defaultOpened
					styles={{
						root: {
							borderRadius: "2px",
							padding: "12px 16px",
							borderLeft: "3px solid transparent",
							fontFamily: '"Lora", serif',
							"&:hover": {
								backgroundColor: isDark
									? "rgba(124, 150, 124, 0.12)"
									: "rgba(124, 150, 124, 0.08)",
								borderLeftColor: isDark
									? "var(--mantine-color-sage-6)"
									: "var(--mantine-color-sage-5)",
							},
						},
						label: { fontWeight: 500, fontSize: "15px" },
					}}
				>
					<NavLink
						label="Movies"
						onClick={closeDrawer}
						color={sageColorDark}
						styles={{
							root: { paddingLeft: "40px", fontFamily: '"Lora", serif' },
							label: { fontWeight: 400, fontSize: "14px" },
						}}
					/>
					<NavLink
						label="Books"
						onClick={closeDrawer}
						color={sageColorDark}
						styles={{
							root: { paddingLeft: "40px", fontFamily: '"Lora", serif' },
							label: { fontWeight: 400, fontSize: "14px" },
						}}
					/>
					<NavLink
						label="TV Shows"
						onClick={closeDrawer}
						color={sageColorDark}
						styles={{
							root: { paddingLeft: "40px", fontFamily: '"Lora", serif' },
							label: { fontWeight: 400, fontSize: "14px" },
						}}
					/>
				</NavLink>

				<NavLink
					label="Fitness"
					onClick={closeDrawer}
					leftSection={
						<Dumbbell
							size={20}
							color={
								isDark
									? "var(--mantine-color-gold-5)"
									: "var(--mantine-color-gold-6)"
							}
						/>
					}
					color="gold.6"
					styles={{
						root: {
							borderRadius: "2px",
							padding: "12px 16px",
							borderLeft: "3px solid transparent",
							fontFamily: '"Lora", serif',
							"&:hover": {
								backgroundColor: isDark
									? "rgba(212, 165, 116, 0.12)"
									: "rgba(212, 165, 116, 0.08)",
								borderLeftColor: isDark
									? "var(--mantine-color-gold-6)"
									: "var(--mantine-color-gold-5)",
							},
						},
						label: { fontWeight: 500, fontSize: "15px" },
					}}
				/>

				<NavLink
					label="Whiskey"
					onClick={closeDrawer}
					leftSection={
						<Wine
							size={20}
							color={
								isDark
									? "var(--mantine-color-gold-6)"
									: "var(--mantine-color-gold-7)"
							}
						/>
					}
					color={isDark ? "gold.6" : "gold.7"}
					styles={{
						root: {
							borderRadius: "2px",
							padding: "12px 16px",
							borderLeft: "3px solid transparent",
							fontFamily: '"Lora", serif',
							"&:hover": {
								backgroundColor: isDark
									? "rgba(212, 165, 116, 0.12)"
									: "rgba(212, 165, 116, 0.08)",
								borderLeftColor: isDark
									? "var(--mantine-color-gold-6)"
									: "var(--mantine-color-gold-5)",
							},
						},
						label: { fontWeight: 500, fontSize: "15px" },
					}}
				/>

				<NavLink
					label="Places"
					onClick={closeDrawer}
					leftSection={
						<MapPin
							size={20}
							color={
								isDark
									? "var(--mantine-color-sage-5)"
									: "var(--mantine-color-sage-6)"
							}
						/>
					}
					color={sageColor}
					styles={{
						root: {
							borderRadius: "2px",
							padding: "12px 16px",
							borderLeft: "3px solid transparent",
							fontFamily: '"Lora", serif',
							"&:hover": {
								backgroundColor: isDark
									? "rgba(124, 150, 124, 0.12)"
									: "rgba(124, 150, 124, 0.08)",
								borderLeftColor: isDark
									? "var(--mantine-color-sage-6)"
									: "var(--mantine-color-sage-5)",
							},
						},
						label: { fontWeight: 500, fontSize: "15px" },
					}}
				/>

				<Box mt="xl" mb="md">
					<Text
						size="sm"
						c={sectionLabel}
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
					<Box h={1} bg={border} mb="md" />
				</Box>
				{savedViews.map((view) => (
					<NavLink
						key={view.id}
						label={view.name}
						onClick={closeDrawer}
						leftSection={
							<BookOpen
								size={18}
								color={
									isDark
										? "var(--mantine-color-gold-5)"
										: "var(--mantine-color-gold-6)"
								}
							/>
						}
						color="gold.6"
						styles={{
							root: {
								borderRadius: "2px",
								padding: "10px 16px",
								borderLeft: "3px solid transparent",
								fontFamily: '"Lora", serif',
								"&:hover": {
									backgroundColor: isDark
										? "rgba(212, 165, 116, 0.12)"
										: "rgba(212, 165, 116, 0.08)",
									borderLeftColor: isDark
										? "var(--mantine-color-gold-6)"
										: "var(--mantine-color-gold-5)",
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
	);

	return (
		<MantineProvider theme={editorialTheme} forceColorScheme={colorScheme}>
			{isMobile && (
				<Drawer
					opened={drawerOpened}
					onClose={closeDrawer}
					size={320}
					padding={0}
					withCloseButton={false}
					styles={{
						body: {
							height: "100%",
							backgroundColor: surface,
						},
						content: {
							backgroundColor: surface,
						},
					}}
				>
					{sidebarContent}
				</Drawer>
			)}
			<Flex h="100vh" bg={bg}>
				{!isMobile && (
					<Box
						w={320}
						bg={surface}
						style={{
							borderRight: `3px double ${doubleBorder}`,
							boxShadow: isDark
								? "2px 0 8px rgba(0, 0, 0, 0.3)"
								: "2px 0 8px rgba(0, 0, 0, 0.05)",
						}}
					>
						{sidebarContent}
					</Box>
				)}

				<Box
					flex={1}
					style={{ overflowY: "auto", backgroundColor: mainContent }}
				>
					<Box
						p={isMobile ? "lg" : "3rem"}
						pt={isMobile ? "lg" : "4rem"}
						style={{
							borderBottom: `2px solid ${goldBorder}`,
							background: headerGradient,
						}}
					>
						{isMobile && (
							<Group justify="space-between" mb="lg">
								<Burger
									opened={drawerOpened}
									onClick={openDrawer}
									size="sm"
									color={textPrimary}
								/>
								<Text
									size="xl"
									fw={400}
									c={textPrimary}
									style={{ fontFamily: '"Playfair Display", serif' }}
								>
									Ryot
								</Text>
								<Button
									variant="subtle"
									size="compact-sm"
									p={4}
									onClick={() =>
										setColorScheme(colorScheme === "dark" ? "light" : "dark")
									}
								>
									{isDark ? (
										<Sun size={18} color={accentText} />
									) : (
										<Moon size={18} color={accentText} />
									)}
								</Button>
							</Group>
						)}
						<Group justify="space-between" align="flex-start">
							<Box>
								<Text
									size="xs"
									c={accentText}
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
									c={textPrimary}
									fw={400}
									mb="md"
									style={{
										fontFamily: '"Playfair Display", serif',
										fontSize: isMobile ? "2.25rem" : "3.5rem",
										lineHeight: 1.1,
									}}
								>
									Dashboard
								</Title>
								<Text
									c={textSecondary}
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
							{!isMobile && (
								<Group gap="md" mt="xl">
									<Button
										variant="outline"
										color={isDark ? "gold.6" : "gold.7"}
										size="md"
										onClick={() =>
											setColorScheme(colorScheme === "dark" ? "light" : "dark")
										}
										leftSection={
											colorScheme === "dark" ? (
												<Sun
													size={18}
													color={
														isDark
															? "var(--mantine-color-gold-5)"
															: "var(--mantine-color-gold-7)"
													}
												/>
											) : (
												<Moon
													size={18}
													color={
														isDark
															? "var(--mantine-color-gold-5)"
															: "var(--mantine-color-gold-7)"
													}
												/>
											)
										}
										styles={{
											root: {
												borderRadius: "2px",
												border: `1.5px solid ${isDark ? "var(--mantine-color-gold-6)" : "var(--mantine-color-gold-5)"}`,
												fontFamily: '"Lora", serif',
												fontWeight: 500,
												transition: "all 0.2s ease",
												"&:hover": {
													backgroundColor: isDark
														? "rgba(212, 165, 116, 0.12)"
														: "rgba(212, 165, 116, 0.08)",
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
												backgroundColor: goldButton,
												color: "var(--mantine-color-dark-9)",
												fontFamily: '"Lora", serif',
												fontWeight: 600,
												border: `1.5px solid ${goldButtonHover}`,
												transition: "all 0.2s ease",
												"&:hover": {
													backgroundColor: goldButtonHover,
													transform: "translateY(-1px)",
													boxShadow: isDark
														? "0 4px 12px rgba(212, 165, 116, 0.4)"
														: "0 4px 12px rgba(212, 165, 116, 0.3)",
												},
											},
										}}
									>
										Log Activity
									</Button>
								</Group>
							)}
						</Group>
						{isMobile && (
							<Button
								variant="filled"
								color="gold"
								size="lg"
								fullWidth
								mt="lg"
								styles={{
									root: {
										borderRadius: "2px",
										backgroundColor: goldButton,
										color: "var(--mantine-color-dark-9)",
										fontFamily: '"Lora", serif',
										fontWeight: 600,
										border: `1.5px solid ${goldButtonHover}`,
										transition: "all 0.2s ease",
										"&:hover": {
											backgroundColor: goldButtonHover,
											boxShadow: isDark
												? "0 4px 12px rgba(212, 165, 116, 0.4)"
												: "0 4px 12px rgba(212, 165, 116, 0.3)",
										},
									},
								}}
							>
								Log Activity
							</Button>
						)}
					</Box>

					<Box p={isMobile ? "lg" : "3rem"}>
						<Grid mb="4rem">
							{stats.map((stat, idx) => {
								const accentColors = ["gold.6", "sage.6", "gold.7", "sage.7"];
								const accentColorsDark = [
									"gold.5",
									"sage.5",
									"gold.6",
									"sage.6",
								];
								const currentAccent = isDark
									? accentColorsDark[idx]
									: accentColors[idx];
								return (
									<Grid.Col key={stat.label} span={{ base: 6, md: 3 }}>
										<Card
											p="xl"
											bg={cardBg}
											radius="sm"
											style={{
												border: `2px solid ${border}`,
												borderTop: `4px solid var(--mantine-color-${currentAccent})`,
												transition: "all 0.25s ease",
												animation: `fadeIn 0.5s ease ${idx * 0.15}s backwards`,
											}}
											className="editorial-stat-card"
										>
											<Stack gap={12}>
												<Text
													size="xs"
													c={currentAccent}
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
													size={isMobile ? "2rem" : "3.5rem"}
													fw={400}
													c={textPrimary}
													lh={0.9}
													style={{ fontFamily: '"Playfair Display", serif' }}
												>
													{stat.value}
												</Text>
												{stat.change && (
													<Group gap={6} mt={4}>
														<TrendingUp
															size={16}
															color={`var(--mantine-color-${currentAccent})`}
														/>
														<Text
															size="sm"
															c={currentAccent}
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
										opacity: 0;
										transform: translateY(20px);
									}
									to {
										opacity: 1;
										transform: translateY(0);
									}
								}
								@media (min-width: 769px) {
									.editorial-stat-card:hover {
										transform: translateY(-4px);
										box-shadow: ${
											isDark
												? "0 8px 20px rgba(212, 165, 116, 0.3)"
												: "0 8px 20px rgba(212, 165, 116, 0.2)"
										};
									}
								}
							`}
						</style>

						<Box mb="2rem" mt="4rem">
							<Box h={2} bg={isDark ? "gold.6" : "gold.4"} mb="lg" />
							<Title
								order={2}
								size="2.5rem"
								c={textPrimary}
								fw={400}
								mb="md"
								style={{ fontFamily: '"Playfair Display", serif' }}
							>
								Featured Entries
							</Title>
							<Text
								c={textSecondary}
								size="sm"
								mb="xl"
								style={{ fontFamily: '"Lora", serif', fontStyle: "italic" }}
							>
								A curated selection from your personal archive
							</Text>
						</Box>

						<Grid mb="4rem">
							{entities.slice(0, 6).map((entity, idx) => (
								<Grid.Col key={entity.id} span={{ base: 12, sm: 6, md: 4 }}>
									<Card
										p={0}
										bg={entityCardBg}
										radius="sm"
										style={{
											border: `2px solid ${border}`,
											cursor: "pointer",
											transition: "all 0.3s ease",
											overflow: "hidden",
											animation: `fadeIn 0.5s ease ${(idx + 4) * 0.1}s backwards`,
										}}
										className="editorial-entity-card"
									>
										{entity.image && (
											<Box
												h={isMobile ? 200 : 260}
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
																	backgroundColor: goldButton,
																	color: "var(--mantine-color-dark-9)",
																	fontFamily: '"Playfair Display", serif',
																	fontWeight: 700,
																	fontSize: "1rem",
																	border: `2px solid ${goldButtonHover}`,
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
												h={isMobile ? 200 : 260}
												bg={isDark ? "dark.7" : "cream.1"}
												style={{
													display: "grid",
													placeItems: "center",
													border: `2px dashed ${goldBorder}`,
												}}
											>
												<Text
													c={isDark ? "gold.5" : "gold.6"}
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
												c={textPrimary}
												size="xl"
												mb="sm"
												style={{ fontFamily: '"Playfair Display", serif' }}
											>
												{entity.name}
											</Text>
											<Text
												size="xs"
												c={accentText}
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
												c={textSecondary}
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
								@media (min-width: 769px) {
									.editorial-entity-card:hover {
										transform: translateY(-6px);
										box-shadow: ${
											isDark
												? "0 12px 28px rgba(212, 165, 116, 0.3)"
												: "0 12px 28px rgba(212, 165, 116, 0.2)"
										};
										border-color: ${
											isDark
												? "var(--mantine-color-gold-6)"
												: "var(--mantine-color-gold-5)"
										};
									}
								}
							`}
						</style>

						<Box mb="2rem" mt="4rem">
							<Box h={2} bg={isDark ? "gold.6" : "gold.4"} mb="lg" />
							<Title
								order={2}
								size="2.5rem"
								c={textPrimary}
								fw={400}
								mb="md"
								style={{ fontFamily: '"Playfair Display", serif' }}
							>
								Activity Chronicle
							</Title>
							<Text
								c={textSecondary}
								size="sm"
								mb="xl"
								style={{ fontFamily: '"Lora", serif', fontStyle: "italic" }}
							>
								Recent engagements and milestones
							</Text>
						</Box>

						<Paper
							bg={cardBg}
							p="2rem"
							radius="sm"
							style={{ border: `2px solid ${border}` }}
						>
							<Stack gap="lg">
								{events.map((event) => (
									<Box
										key={event.id}
										p="lg"
										style={{
											borderLeft: `3px solid ${isDark ? "var(--mantine-color-gold-6)" : "var(--mantine-color-gold-5)"}`,
											borderBottom: `1px solid ${border}`,
											paddingBottom: "1.5rem",
										}}
									>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="sm" mb={8}>
													<Text
														fw={400}
														c={textPrimary}
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
																backgroundColor: isDark
																	? "rgba(212, 165, 116, 0.12)"
																	: "rgba(212, 165, 116, 0.08)",
																border: `1.5px solid ${isDark ? "var(--mantine-color-gold-6)" : "var(--mantine-color-gold-5)"}`,
																color: isDark
																	? "var(--mantine-color-gold-5)"
																	: "var(--mantine-color-gold-7)",
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
													c={textSecondary}
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
																			backgroundColor: eventPropertyBadgeBg,
																			color: eventPropertyBadgeColor,
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
