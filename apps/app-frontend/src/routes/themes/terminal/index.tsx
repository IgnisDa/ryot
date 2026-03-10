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
	const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
		useDisclosure(false);
	const isMobile = useMediaQuery("(max-width: 768px)") ?? false;
	const isDark = colorScheme === "dark";

	const bg = isDark ? "dark.9" : "green.0";
	const surface = isDark ? "dark.9" : "#FFFFFF";
	const surfaceAlt = isDark ? "dark.8" : "#F5F7F5";
	const textPrimary = isDark ? "green.5" : "green.8";
	const textSecondary = isDark ? "green.4" : "green.7";
	const textMuted = isDark ? "green.3" : "green.6";
	const textCyan = isDark ? "cyan.5" : "cyan.8";
	const textCyanAlt = isDark ? "cyan.4" : "cyan.7";
	const textPurple = isDark ? "purple.5" : "purple.8";
	const textPurpleAlt = isDark ? "purple.4" : "purple.7";
	const textPurpleMuted = isDark ? "purple.3" : "purple.6";
	const borderGreen = isDark
		? "var(--mantine-color-green-5)"
		: "var(--mantine-color-green-6)";
	const borderCyan = isDark
		? "var(--mantine-color-cyan-5)"
		: "var(--mantine-color-cyan-6)";
	const borderPurple = isDark
		? "var(--mantine-color-purple-5)"
		: "var(--mantine-color-purple-6)";
	const glowGreen = isDark ? "0 0 20px rgba(0, 255, 0, 0.3)" : "none";
	const glowGreenStrong = isDark ? "0 0 30px rgba(0, 255, 0, 0.9)" : "none";
	const glowCyan = isDark ? "0 0 10px rgba(0, 255, 255, 0.4)" : "none";
	const glowPurple = isDark ? "0 0 15px rgba(255, 0, 255, 0.3)" : "none";
	const glowPurpleHover = isDark ? "0 0 10px rgba(255, 0, 255, 0.3)" : "none";
	const textShadowGreen = isDark ? "0 0 8px rgba(0, 255, 0, 0.8)" : "none";
	const textShadowGreenMed = isDark ? "0 0 5px rgba(0, 255, 0, 0.6)" : "none";
	const textShadowGreenLight = isDark ? "0 0 5px rgba(0, 255, 0, 0.5)" : "none";
	const textShadowGreenTitle = isDark
		? "0 0 10px rgba(0, 255, 0, 0.8)"
		: "none";
	const textShadowCyan = isDark ? "0 0 5px rgba(0, 255, 255, 0.6)" : "none";
	const textShadowCyanLight = isDark
		? "0 0 5px rgba(0, 255, 255, 0.5)"
		: "none";
	const textShadowPurple = isDark ? "0 0 10px rgba(255, 0, 255, 0.8)" : "none";
	const textShadowPurpleLight = isDark
		? "0 0 5px rgba(255, 0, 255, 0.5)"
		: "none";
	const bgGreenTrans = isDark
		? "rgba(0, 255, 0, 0.15)"
		: "rgba(0, 255, 0, 0.08)";
	const bgGreenTransHover = isDark
		? "rgba(0, 255, 0, 0.25)"
		: "rgba(0, 255, 0, 0.15)";
	const bgCyanTrans = isDark
		? "rgba(0, 255, 255, 0.1)"
		: "rgba(0, 255, 255, 0.05)";
	const bgPurpleTrans = isDark
		? "rgba(255, 0, 255, 0.1)"
		: "rgba(255, 0, 255, 0.05)";
	const bgPurpleTransCard = isDark
		? "rgba(255, 0, 255, 0.05)"
		: "rgba(255, 0, 255, 0.03)";
	const bgPurpleTransHover = isDark
		? "rgba(255, 0, 255, 0.1)"
		: "rgba(255, 0, 255, 0.08)";
	const searchBoxBg = isDark ? "rgba(0, 255, 0, 0.05)" : "#FFFFFF";
	const searchBoxShadow = isDark
		? "inset 0 0 10px rgba(0, 255, 0, 0.1)"
		: "inset 0 0 5px rgba(0, 100, 0, 0.05)";
	const scanLineGradient = isDark
		? `repeating-linear-gradient(
				0deg,
				rgba(0, 255, 0, 0.03) 0px,
				transparent 1px,
				transparent 2px,
				rgba(0, 255, 0, 0.03) 3px
			)`
		: `repeating-linear-gradient(
				0deg,
				rgba(0, 100, 0, 0.04) 0px,
				transparent 1px,
				transparent 2px,
				rgba(0, 100, 0, 0.04) 3px
			)`;

	const accentColors = ["green.5", "cyan.5", "purple.5", "green.6"];
	const accentColorsDark = [textPrimary, textCyan, textPurple, textPrimary];

	const sidebarContent = (
		<Stack gap={0} h="100%">
			<Box
				p="lg"
				style={{
					backgroundColor: surfaceAlt,
					borderBottom: `2px solid ${borderGreen}`,
					boxShadow: isDark ? "0 0 10px rgba(0, 255, 0, 0.3)" : "none",
				}}
			>
				<Text
					size="xl"
					fw={700}
					c={textPrimary}
					style={{
						fontFamily: "monospace",
						textShadow: textShadowGreen,
					}}
				>
					&gt; RYOT_TERMINAL
				</Text>
				<Text
					size="xs"
					c={textCyan}
					mt={4}
					style={{
						fontFamily: "monospace",
						textShadow: textShadowCyan,
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
						border: `1px solid ${borderGreen}`,
						backgroundColor: searchBoxBg,
						boxShadow: searchBoxShadow,
					}}
				>
					<Group gap="xs" wrap="nowrap">
						<Text
							size="sm"
							c={textPrimary}
							fw={700}
							style={{ fontFamily: "monospace" }}
						>
							&gt
						</Text>
						<Text
							size="sm"
							c={textSecondary}
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
				bg={textPrimary}
				style={{
					boxShadow: isDark ? "0 0 8px rgba(0, 255, 0, 0.5)" : "none",
				}}
			/>

			<Stack gap={0} p="md" style={{ flex: 1, overflowY: "auto" }}>
				<NavLink
					label=">> HOME"
					leftSection={<Home size={18} color={borderGreen} />}
					color={textPrimary}
					active
					onClick={closeDrawer}
					styles={{
						root: {
							borderRadius: 0,
							backgroundColor: bgGreenTrans,
							borderLeft: `3px solid ${borderGreen}`,
							fontFamily: "monospace",
							padding: "10px 12px",
							"&:hover": {
								backgroundColor: bgGreenTransHover,
								boxShadow: isDark ? "0 0 10px rgba(0, 255, 0, 0.3)" : "none",
							},
						},
						label: {
							fontWeight: 700,
							color: textSecondary,
							textShadow: textShadowGreenLight,
						},
					}}
				/>

				<Box mt="lg">
					<Box
						px="sm"
						py="xs"
						mb="xs"
						style={{
							backgroundColor: bgCyanTrans,
							borderLeft: `2px solid ${borderCyan}`,
						}}
					>
						<Text
							size="xs"
							c={textCyan}
							tt="uppercase"
							fw={700}
							style={{
								fontFamily: "monospace",
								letterSpacing: "2px",
								textShadow: textShadowCyanLight,
							}}
						>
							[MODULES]
						</Text>
					</Box>

					<NavLink
						label=">> MEDIA"
						leftSection={<Film size={18} color={borderGreen} />}
						color={textPrimary}
						defaultOpened
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontFamily: "monospace",
								"&:hover": {
									backgroundColor: isDark
										? "rgba(0, 255, 0, 0.1)"
										: "rgba(0, 255, 0, 0.05)",
									borderLeftColor: borderGreen,
								},
							},
							label: {
								color: textSecondary,
								fontWeight: 700,
							},
						}}
					>
						<NavLink
							label=":: movies"
							color={textPrimary}
							onClick={closeDrawer}
							styles={{
								label: {
									fontWeight: 500,
									fontSize: 13,
									fontFamily: "monospace",
									color: textMuted,
								},
								root: { borderRadius: 0, paddingLeft: "40px" },
							}}
						/>
						<NavLink
							label=":: books"
							color={textPrimary}
							onClick={closeDrawer}
							styles={{
								label: {
									fontWeight: 500,
									fontSize: 13,
									fontFamily: "monospace",
									color: textMuted,
								},
								root: { borderRadius: 0, paddingLeft: "40px" },
							}}
						/>
						<NavLink
							label=":: tv_shows"
							color={textPrimary}
							onClick={closeDrawer}
							styles={{
								label: {
									fontWeight: 500,
									fontSize: 13,
									fontFamily: "monospace",
									color: textMuted,
								},
								root: { borderRadius: 0, paddingLeft: "40px" },
							}}
						/>
					</NavLink>

					<NavLink
						label=">> FITNESS"
						leftSection={<Dumbbell size={18} color={borderGreen} />}
						color={textPrimary}
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontFamily: "monospace",
								"&:hover": {
									backgroundColor: isDark
										? "rgba(0, 255, 0, 0.1)"
										: "rgba(0, 255, 0, 0.05)",
									borderLeftColor: borderGreen,
								},
							},
							label: {
								color: textSecondary,
								fontWeight: 700,
							},
						}}
					>
						<NavLink
							label=":: workouts"
							color={textPrimary}
							onClick={closeDrawer}
							styles={{
								label: {
									fontWeight: 500,
									fontSize: 13,
									fontFamily: "monospace",
									color: textMuted,
								},
								root: { borderRadius: 0, paddingLeft: "40px" },
							}}
						/>
						<NavLink
							label=":: measurements"
							color={textPrimary}
							onClick={closeDrawer}
							styles={{
								label: {
									fontWeight: 500,
									fontSize: 13,
									fontFamily: "monospace",
									color: textMuted,
								},
								root: { borderRadius: 0, paddingLeft: "40px" },
							}}
						/>
					</NavLink>

					<NavLink
						label=">> WHISKEY"
						leftSection={<Wine size={18} color={borderGreen} />}
						color={textPrimary}
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontFamily: "monospace",
								"&:hover": {
									backgroundColor: isDark
										? "rgba(0, 255, 0, 0.1)"
										: "rgba(0, 255, 0, 0.05)",
									borderLeftColor: borderGreen,
								},
							},
							label: {
								color: textSecondary,
								fontWeight: 700,
							},
						}}
					/>

					<NavLink
						label=">> PLACES"
						leftSection={<MapPin size={18} color={borderGreen} />}
						color={textPrimary}
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontFamily: "monospace",
								"&:hover": {
									backgroundColor: isDark
										? "rgba(0, 255, 0, 0.1)"
										: "rgba(0, 255, 0, 0.05)",
									borderLeftColor: borderGreen,
								},
							},
							label: {
								color: textSecondary,
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
							backgroundColor: bgPurpleTrans,
							borderLeft: `2px solid ${borderPurple}`,
						}}
					>
						<Text
							size="xs"
							c={textPurple}
							tt="uppercase"
							fw={700}
							style={{
								fontFamily: "monospace",
								letterSpacing: "2px",
								textShadow: textShadowPurpleLight,
							}}
						>
							[SAVED_VIEWS]
						</Text>
					</Box>
					{savedViews.map((view) => (
						<NavLink
							key={view.id}
							label={`:: ${view.name.toLowerCase().replace(/ /g, "_")}`}
							leftSection={<BookOpen size={16} color={borderPurple} />}
							color={textPurple}
							onClick={closeDrawer}
							styles={{
								root: {
									borderRadius: 0,
									borderLeft: "3px solid transparent",
									fontFamily: "monospace",
									"&:hover": {
										backgroundColor: bgPurpleTrans,
										borderLeftColor: borderPurple,
									},
								},
								label: {
									color: textPurpleAlt,
									fontSize: 13,
									fontWeight: 600,
								},
							}}
						/>
					))}
				</Box>
			</Stack>
		</Stack>
	);

	return (
		<MantineProvider theme={terminalTheme} forceColorScheme={colorScheme}>
			<Flex
				h="100vh"
				bg={bg}
				style={{
					position: "relative",
					backgroundImage: scanLineGradient,
				}}
			>
				{isMobile && (
					<Drawer
						opened={drawerOpened}
						onClose={closeDrawer}
						size={280}
						padding={0}
						styles={{
							content: {
								backgroundColor: surface,
								borderRight: `2px solid ${borderGreen}`,
								boxShadow: glowGreen,
							},
							header: { display: "none" },
						}}
					>
						{sidebarContent}
					</Drawer>
				)}

				{!isMobile && (
					<Box
						w={320}
						bg={surface}
						style={{
							borderRight: `2px solid ${borderGreen}`,
							boxShadow: glowGreen,
						}}
					>
						{sidebarContent}
					</Box>
				)}

				<Box flex={1} style={{ overflowY: "auto" }}>
					{isMobile && (
						<Box
							p="md"
							style={{
								borderBottom: `2px solid ${borderGreen}`,
								backgroundColor: surfaceAlt,
								boxShadow: isDark ? "0 0 10px rgba(0, 255, 0, 0.2)" : "none",
							}}
						>
							<Group justify="space-between" align="center">
								<Burger
									opened={drawerOpened}
									onClick={openDrawer}
									color={borderGreen}
									size="sm"
								/>
								<Text
									size="lg"
									fw={700}
									c={textPrimary}
									style={{
										fontFamily: "monospace",
										textShadow: textShadowGreen,
									}}
								>
									&gt; RYOT_TERMINAL
								</Text>
								<Button
									variant="outline"
									color="green"
									size="xs"
									onClick={() =>
										setColorScheme(colorScheme === "dark" ? "light" : "dark")
									}
									p={8}
									styles={{
										root: {
											borderRadius: 0,
											border: `1px solid ${borderGreen}`,
											fontFamily: "monospace",
											fontWeight: 700,
											backgroundColor: isDark
												? "rgba(0, 255, 0, 0.05)"
												: "#FFFFFF",
											minWidth: "auto",
										},
									}}
								>
									{colorScheme === "dark" ? (
										<Sun size={16} color={borderGreen} />
									) : (
										<Moon size={16} color={borderGreen} />
									)}
								</Button>
							</Group>
						</Box>
					)}

					<Box
						p={isMobile ? "md" : "xl"}
						style={{
							borderBottom: `2px solid ${borderGreen}`,
							backgroundColor: isDark
								? "rgba(0, 0, 0, 0.3)"
								: "rgba(255, 255, 255, 0.5)",
							boxShadow: isDark ? "0 0 10px rgba(0, 255, 0, 0.2)" : "none",
						}}
					>
						<Group justify="space-between" align="flex-start">
							<Box>
								<Title
									order={1}
									c={textPrimary}
									fw={700}
									size={isMobile ? "1.75rem" : "2.5rem"}
									style={{
										fontFamily: "monospace",
										textShadow: textShadowGreenTitle,
									}}
								>
									&gt;&gt; DASHBOARD
								</Title>
								<Text
									c={textCyan}
									size="sm"
									mt={8}
									fw={600}
									style={{
										fontFamily: "monospace",
										textShadow: textShadowCyan,
									}}
								>
									{"// TRACKING_COMMAND_CENTER v2.0"}
								</Text>
							</Box>
							{!isMobile && (
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
												<Sun size={18} color={borderGreen} />
											) : (
												<Moon size={18} color={borderGreen} />
											)
										}
										styles={{
											root: {
												borderRadius: 0,
												border: `2px solid ${borderGreen}`,
												fontFamily: "monospace",
												fontWeight: 700,
												backgroundColor: isDark
													? "rgba(0, 255, 0, 0.05)"
													: "#FFFFFF",
												transition: "all 0.1s ease",
												"&:hover": {
													backgroundColor: isDark
														? "rgba(0, 255, 0, 0.15)"
														: "rgba(0, 255, 0, 0.1)",
													boxShadow: isDark
														? "0 0 15px rgba(0, 255, 0, 0.4)"
														: "none",
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
												backgroundColor: isDark
													? "var(--mantine-color-green-5)"
													: "var(--mantine-color-green-6)",
												color: "black",
												border: isDark
													? "2px solid var(--mantine-color-green-6)"
													: "2px solid var(--mantine-color-green-7)",
												transition: "all 0.1s ease",
												boxShadow: isDark
													? "0 0 20px rgba(0, 255, 0, 0.6)"
													: "none",
												"&:hover": {
													backgroundColor: isDark
														? "var(--mantine-color-green-4)"
														: "var(--mantine-color-green-5)",
													boxShadow: glowGreenStrong,
												},
											},
										}}
									>
										QUICK_ACTION
									</Button>
								</Group>
							)}
						</Group>
					</Box>

					<Box p={isMobile ? "md" : "xl"}>
						<Grid mb="xl">
							{stats.map((stat, idx) => {
								const getRgba = (colorIdx: number) => {
									if (colorIdx === 0 || colorIdx === 3) return "0, 255, 0";
									if (colorIdx === 1) return "0, 255, 255";
									return "255, 0, 255";
								};
								const rgba = getRgba(idx);
								return (
									<Grid.Col key={stat.label} span={{ base: 6, md: 3 }}>
										<Card
											p="lg"
											bg={surface}
											className="terminal-stat-card"
											style={{
												borderRadius: 0,
												border: `2px solid var(--mantine-color-${accentColors[idx]})`,
												boxShadow: isDark
													? `0 0 15px rgba(${rgba}, 0.3)`
													: "none",
												transition: "all 0.15s ease",
												animation: `fadeIn 0.4s ease ${idx * 0.1}s backwards`,
											}}
										>
											<Stack gap={8}>
												<Text
													size="xs"
													c={accentColorsDark[idx]}
													tt="uppercase"
													fw={900}
													style={{
														letterSpacing: "2px",
														fontFamily: "monospace",
														textShadow: isDark
															? `0 0 5px rgba(${rgba}, 0.8)`
															: "none",
													}}
												>
													[{stat.label.toUpperCase()}]
												</Text>
												<Text
													size={isMobile ? "1.75rem" : "3rem"}
													fw={900}
													c={accentColorsDark[idx]}
													lh={1}
													style={{
														fontFamily: "monospace",
														textShadow: isDark
															? `0 0 10px rgba(${rgba}, 0.8)`
															: "none",
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
															c={accentColorsDark[idx]}
															fw={700}
															style={{
																fontFamily: "monospace",
																textShadow: isDark
																	? `0 0 5px rgba(${rgba}, 0.6)`
																	: "none",
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
										opacity: 0;
										transform: translateY(20px);
									}
									to {
										opacity: 1;
										transform: translateY(0);
									}
								}
								@media (min-width: 769px) {
									.terminal-stat-card:hover {
										transform: scale(1.02) !important;
									}
								}
							`}
						</style>

						<Group justify="space-between" align="center" mb="lg">
							<Title
								order={2}
								size="xl"
								c={textPrimary}
								fw={900}
								style={{
									fontFamily: "monospace",
									textShadow: textShadowGreenTitle,
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
										border: `1px solid ${borderCyan}`,
										backgroundColor: isDark
											? "rgba(0, 255, 255, 0.05)"
											: "#FFFFFF",
										"&:hover": {
											backgroundColor: isDark
												? "rgba(0, 255, 255, 0.1)"
												: "rgba(0, 255, 255, 0.08)",
											boxShadow: glowCyan,
										},
									},
								}}
							>
								[VIEW_ALL]
							</Button>
						</Group>
						<Grid mb="xl">
							{entities.slice(0, 6).map((entity, idx) => (
								<Grid.Col key={entity.id} span={{ base: 12, sm: 6, md: 4 }}>
									<Card
										p={0}
										bg={surface}
										className="terminal-entity-card"
										style={{
											borderRadius: 0,
											border: `2px solid ${borderGreen}`,
											cursor: "pointer",
											transition: "all 0.15s ease",
											overflow: "hidden",
											boxShadow: isDark
												? "0 0 15px rgba(0, 255, 0, 0.3)"
												: "none",
											animation: `fadeIn 0.4s ease ${(idx + 4) * 0.1}s backwards`,
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
																	backgroundColor: isDark
																		? "var(--mantine-color-green-5)"
																		: "var(--mantine-color-green-6)",
																	color: "black",
																	border: isDark
																		? "2px solid var(--mantine-color-green-6)"
																		: "2px solid var(--mantine-color-green-7)",
																	boxShadow: isDark
																		? "0 0 10px rgba(0, 255, 0, 0.8)"
																		: "none",
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
												bg={surfaceAlt}
												style={{
													display: "grid",
													placeItems: "center",
													border: "2px dashed var(--mantine-color-green-6)",
												}}
											>
												<Text
													c={textPrimary}
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
												c={textPrimary}
												size="md"
												mb={8}
												style={{
													fontFamily: "monospace",
													textShadow: textShadowGreenMed,
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
														backgroundColor: isDark
															? "rgba(0, 255, 255, 0.2)"
															: "rgba(0, 255, 255, 0.15)",
														color: textCyanAlt,
														fontWeight: 700,
														fontFamily: "monospace",
														border: `1px solid ${borderCyan}`,
													},
												}}
											>
												{entity.schemaName.toUpperCase()}
											</Badge>
											<Text
												size="xs"
												c={textSecondary}
												style={{ fontFamily: "monospace" }}
											>
												{entity.lastEvent.toLowerCase()}
											</Text>
										</Box>
									</Card>
								</Grid.Col>
							))}
						</Grid>
						<style>
							{`
								@media (min-width: 769px) {
									.terminal-entity-card:hover {
										transform: scale(1.02) !important;
										box-shadow: ${isDark ? "0 0 25px rgba(0, 255, 0, 0.6)" : "0 2px 8px rgba(0, 0, 0, 0.1)"} !important;
										border-color: ${isDark ? "var(--mantine-color-cyan-5)" : "var(--mantine-color-green-7)"} !important;
									}
								}
							`}
						</style>

						<Group justify="space-between" align="center" mb="lg">
							<Title
								order={2}
								size="xl"
								c={textPurple}
								fw={900}
								style={{
									fontFamily: "monospace",
									textShadow: textShadowPurple,
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
										border: `1px solid ${borderPurple}`,
										backgroundColor: isDark
											? "rgba(255, 0, 255, 0.05)"
											: "#FFFFFF",
										"&:hover": {
											backgroundColor: bgPurpleTransHover,
											boxShadow: glowPurpleHover,
										},
									},
								}}
							>
								[SHOW_MORE]
							</Button>
						</Group>
						{isMobile && (
							<Button
								variant="filled"
								color="green"
								size="md"
								fullWidth
								mb="lg"
								leftSection={<Zap size={18} color="black" />}
								styles={{
									root: {
										borderRadius: 0,
										fontFamily: "monospace",
										fontWeight: 900,
										backgroundColor: isDark
											? "var(--mantine-color-green-5)"
											: "var(--mantine-color-green-6)",
										color: "black",
										border: isDark
											? "2px solid var(--mantine-color-green-6)"
											: "2px solid var(--mantine-color-green-7)",
										boxShadow: isDark
											? "0 0 20px rgba(0, 255, 0, 0.6)"
											: "none",
									},
								}}
							>
								QUICK_ACTION
							</Button>
						)}
						<Paper
							bg={surface}
							p={isMobile ? "md" : "xl"}
							style={{
								borderRadius: 0,
								border: `2px solid ${borderPurple}`,
								boxShadow: glowPurple,
							}}
						>
							<Stack gap="md">
								{events.map((event) => (
									<Box
										key={event.id}
										p={isMobile ? "sm" : "md"}
										className="terminal-activity-box"
										style={{
											borderRadius: 0,
											border: `1px solid ${borderPurple}`,
											borderLeft: `3px solid ${borderPurple}`,
											backgroundColor: bgPurpleTransCard,
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
														c={textPurpleAlt}
														size="sm"
														style={{
															fontFamily: "monospace",
															textShadow: textShadowPurpleLight,
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
																backgroundColor: isDark
																	? "rgba(255, 0, 255, 0.3)"
																	: "rgba(255, 0, 255, 0.2)",
																color: textPurpleMuted,
																fontWeight: 700,
																fontFamily: "monospace",
																border: `1px solid ${borderPurple}`,
															},
														}}
													>
														{event.schemaName.toUpperCase()}
													</Badge>
												</Group>
												<Text
													size="xs"
													c={textPurpleMuted}
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
																			color: textPurpleAlt,
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
									@media (min-width: 769px) {
										.terminal-activity-box:hover {
											background-color: ${bgPurpleTransHover} !important;
											box-shadow: ${glowPurpleHover};
										}
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
