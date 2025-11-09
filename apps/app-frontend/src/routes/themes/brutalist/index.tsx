import {
	Badge,
	Box,
	Burger,
	Button,
	Card,
	createTheme,
	Divider,
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
	const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
		useDisclosure(false);
	const isMobile = useMediaQuery("(max-width: 768px)") ?? false;
	const isDark = colorScheme === "dark";

	const bg = isDark ? "dark.9" : "dark.0";
	const surface = isDark ? "dark.8" : "dark.1";
	const surfaceAlt = isDark ? "dark.7" : "dark.2";
	const textPrimary = isDark ? "dark.0" : "dark.9";
	const textSecondary = isDark ? "dark.2" : "dark.7";
	const textMuted = isDark ? "dark.4" : "dark.5";
	const borderColor = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-dark-3)";
	const borderHoverColor = isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-dark-2)";
	const gridPattern = isDark
		? "rgba(255, 255, 255, 0.02)"
		: "rgba(0, 0, 0, 0.03)";
	const boxShadowColor = isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-dark-3)";
	const searchBg = isDark
		? "var(--mantine-color-dark-8)"
		: "var(--mantine-color-dark-1)";
	const searchPlaceholder = isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-dark-4)";
	const placeholderText = isDark
		? "var(--mantine-color-dark-5)"
		: "var(--mantine-color-dark-4)";
	const imageOverlayGradient = isDark
		? "linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.8) 100%)"
		: "linear-gradient(180deg, transparent 0%, rgba(255, 255, 255, 0.9) 100%)";

	const sidebarContent = (
		<Stack gap={0} h="100%">
			<Box
				p="lg"
				style={{
					borderBottom: "3px solid var(--mantine-color-red-5)",
				}}
			>
				<Text size="xl" fw={900} c={textPrimary} tt="uppercase">
					RYOT
				</Text>
				<Text
					size="xs"
					c={textMuted}
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
							border: `2px solid ${borderColor}`,
							borderRadius: 0,
							color: textPrimary,
							fontWeight: 600,
							textTransform: "uppercase",
							transition: "all 0.15s ease",
							"&:focus": {
								borderColor: "var(--mantine-color-red-5)",
								backgroundColor: searchBg,
							},
							"&::placeholder": {
								color: searchPlaceholder,
								fontWeight: 700,
							},
						},
					}}
				/>
			</Box>

			<Box h={3} bg={surfaceAlt} />

			<Stack gap={0} p="md" style={{ flex: 1, overflowY: "auto" }}>
				<NavLink
					label="HOME"
					leftSection={<Home size={20} />}
					color={textPrimary}
					variant="subtle"
					onClick={closeDrawer}
					styles={{
						root: {
							borderRadius: 0,
							borderLeft: "3px solid transparent",
							padding: "12px 16px",
							fontWeight: 700,
							textTransform: "uppercase",
							letterSpacing: "1px",
							"&:hover": {
								backgroundColor: borderHoverColor,
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
							backgroundColor: surface,
							borderLeft: "3px solid var(--mantine-color-red-5)",
						}}
					>
						<Text
							size="xs"
							c={textPrimary}
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
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontWeight: 700,
								textTransform: "uppercase",
								"&:hover": {
									backgroundColor: borderHoverColor,
									borderLeftColor: "var(--mantine-color-red-5)",
								},
							},
							label: {
								color: textPrimary,
								fontWeight: 700,
							},
						}}
					>
						<NavLink
							label="MOVIES"
							color="red.5"
							onClick={closeDrawer}
							styles={{
								root: { borderRadius: 0, textTransform: "uppercase" },
								label: { fontWeight: 600 },
							}}
						/>
						<NavLink
							label="BOOKS"
							color="red.5"
							onClick={closeDrawer}
							styles={{
								root: { borderRadius: 0, textTransform: "uppercase" },
								label: { fontWeight: 600 },
							}}
						/>
						<NavLink
							label="TV SHOWS"
							color="red.5"
							onClick={closeDrawer}
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
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontWeight: 700,
								textTransform: "uppercase",
								"&:hover": {
									backgroundColor: borderHoverColor,
									borderLeftColor: "var(--mantine-color-blue-6)",
								},
							},
							label: {
								color: textPrimary,
								fontWeight: 700,
							},
						}}
					/>

					<NavLink
						label="WHISKEY"
						leftSection={<Wine size={20} />}
						color="red.6"
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontWeight: 700,
								textTransform: "uppercase",
								"&:hover": {
									backgroundColor: borderHoverColor,
									borderLeftColor: "var(--mantine-color-red-6)",
								},
							},
							label: {
								color: textPrimary,
								fontWeight: 700,
							},
						}}
					/>

					<NavLink
						label="PLACES"
						leftSection={<MapPin size={20} />}
						color="blue.5"
						onClick={closeDrawer}
						styles={{
							root: {
								borderRadius: 0,
								borderLeft: "3px solid transparent",
								fontWeight: 700,
								textTransform: "uppercase",
								"&:hover": {
									backgroundColor: borderHoverColor,
									borderLeftColor: "var(--mantine-color-blue-5)",
								},
							},
							label: {
								color: textPrimary,
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
							backgroundColor: surface,
							borderLeft: "3px solid var(--mantine-color-blue-6)",
						}}
					>
						<Text
							size="xs"
							c={textPrimary}
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
							onClick={closeDrawer}
							styles={{
								root: {
									borderRadius: 0,
									borderLeft: "3px solid transparent",
									fontWeight: 700,
									textTransform: "uppercase",
									"&:hover": {
										backgroundColor: borderHoverColor,
										borderLeftColor: "var(--mantine-color-blue-6)",
									},
								},
								label: {
									color: textSecondary,
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
		<MantineProvider theme={brutalistTheme} forceColorScheme={colorScheme}>
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
			<Flex
				h="100vh"
				bg={bg}
				style={{
					backgroundImage: `
						linear-gradient(${gridPattern} 1px, transparent 1px),
						linear-gradient(90deg, ${gridPattern} 1px, transparent 1px)
					`,
					backgroundSize: "32px 32px",
				}}
			>
				{!isMobile && (
					<Box
						w={280}
						bg={surface}
						style={{
							borderRight: "3px solid var(--mantine-color-red-5)",
							position: "relative",
						}}
					>
						{sidebarContent}
					</Box>
				)}

				<Box flex={1} style={{ overflowY: "auto" }}>
					<Box
						p={isMobile ? "lg" : "xl"}
						style={{
							borderBottom: "3px solid var(--mantine-color-red-5)",
							backgroundColor: surface,
						}}
					>
						{isMobile && (
							<Group justify="space-between" mb="md">
								<Burger
									opened={drawerOpened}
									onClick={openDrawer}
									size="sm"
									color={textPrimary}
								/>
								<Group gap="xs">
									<Text size="lg" fw={900} c={textPrimary} tt="uppercase">
										RYOT
									</Text>
								</Group>
								<Button
									variant="subtle"
									size="compact-sm"
									p={4}
									onClick={() =>
										setColorScheme(colorScheme === "dark" ? "light" : "dark")
									}
								>
									{colorScheme === "dark" ? (
										<Sun size={18} />
									) : (
										<Moon size={18} />
									)}
								</Button>
							</Group>
						)}
						<Group justify="space-between" align="flex-start">
							<Box>
								<Title
									order={1}
									c={textPrimary}
									fw={900}
									tt="uppercase"
									size={isMobile ? "2rem" : "3rem"}
								>
									DASHBOARD
								</Title>
								<Text
									c={textMuted}
									size="sm"
									mt={8}
									fw={700}
									tt="uppercase"
									style={{ letterSpacing: "2px" }}
								>
									TRACKING OVERVIEW
								</Text>
							</Box>
							{!isMobile && (
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
												border: `2px solid ${borderColor}`,
												fontWeight: 700,
												textTransform: "uppercase",
												transition: "all 0.1s ease",
												"&:hover": {
													borderColor: "var(--mantine-color-red-5)",
													backgroundColor: borderHoverColor,
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
							)}
						</Group>
						{isMobile && (
							<Button
								variant="filled"
								color="red"
								size="lg"
								fullWidth
								mt="md"
								styles={{
									root: {
										borderRadius: 0,
										fontWeight: 900,
										textTransform: "uppercase",
										letterSpacing: "1px",
										border: "3px solid var(--mantine-color-red-7)",
										transition: "all 0.1s ease",
									},
								}}
								style={{
									boxShadow: "4px 4px 0 var(--mantine-color-red-7)",
								}}
							>
								LOG ACTIVITY
							</Button>
						)}
					</Box>

					<Box p={isMobile ? "lg" : "xl"}>
						<Grid mb="xl">
							{stats.map((stat, idx) => {
								const accentColors = ["red.5", "blue.6", "red.6", "blue.5"];
								return (
									<Grid.Col key={stat.label} span={{ base: 6, md: 3 }}>
										<Card
											p={isMobile ? "md" : "xl"}
											bg={surface}
											className="brutalist-card"
											style={{
												borderRadius: 0,
												border: `3px solid var(--mantine-color-${accentColors[idx]})`,
												boxShadow: `6px 6px 0 ${boxShadowColor}`,
												transition: "all 0.1s ease",
												animation: `fadeIn 0.4s ease ${idx * 0.1}s backwards`,
											}}
											styles={{
												root: {
													"&:hover": {
														transform: "translate(3px, 3px)",
														boxShadow: `3px 3px 0 ${boxShadowColor}`,
													},
												},
											}}
										>
											<Stack gap={8}>
												<Text
													size="xs"
													c={textMuted}
													tt="uppercase"
													fw={900}
													style={{ letterSpacing: "2px" }}
												>
													{stat.label}
												</Text>
												<Text
													size={isMobile ? "1.75rem" : "3rem"}
													fw={900}
													c={textPrimary}
													lh={0.9}
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
										opacity: 0;
										transform: translateY(20px);
									}
									to {
										opacity: 1;
										transform: translateY(0);
									}
								}
								@media (max-width: 768px) {
									.brutalist-card:hover,
									.brutalist-entity:hover {
										transform: none !important;
										box-shadow: 6px 6px 0 ${boxShadowColor} !important;
									}
								}
							`}
						</style>

						<Box
							mb="xl"
							p="md"
							style={{
								borderLeft: "4px solid var(--mantine-color-red-5)",
								backgroundColor: surface,
							}}
						>
							<Title
								order={2}
								size={isMobile ? "1.5rem" : "2rem"}
								c={textPrimary}
								fw={900}
								tt="uppercase"
							>
								RECENT ENTITIES
							</Title>
						</Box>

						<Grid mb="xl">
							{entities.slice(0, 6).map((entity, idx) => (
								<Grid.Col key={entity.id} span={{ base: 12, sm: 6, md: 4 }}>
									<Card
										p={0}
										bg={surface}
										className="brutalist-entity"
										style={{
											borderRadius: 0,
											border: `3px solid ${borderColor}`,
											cursor: "pointer",
											overflow: "hidden",
											boxShadow: `6px 6px 0 ${boxShadowColor}`,
											transition: "all 0.1s ease",
											animation: `fadeIn 0.4s ease ${(idx + 4) * 0.1}s backwards`,
										}}
										styles={{
											root: {
												"&:hover": {
													transform: "translate(3px, 3px)",
													boxShadow: `3px 3px 0 ${boxShadowColor}`,
													borderColor: "var(--mantine-color-red-5)",
												},
											},
										}}
									>
										{entity.image && (
											<Box
												h={isMobile ? 160 : 200}
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
														background: imageOverlayGradient,
													}}
												/>
											</Box>
										)}
										{!entity.image && (
											<Box
												h={isMobile ? 160 : 200}
												bg={surfaceAlt}
												style={{
													display: "grid",
													placeItems: "center",
													border: `2px dashed ${placeholderText}`,
												}}
											>
												<Text
													c={placeholderText}
													size="sm"
													fw={900}
													tt="uppercase"
												>
													NO IMAGE
												</Text>
											</Box>
										)}
										<Box p="lg">
											<Group justify="space-between" mb={8}>
												<Text fw={900} c={textPrimary} size="md" tt="uppercase">
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
																color: isDark
																	? "var(--mantine-color-dark-9)"
																	: "var(--mantine-color-dark-0)",
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
													backgroundColor: surfaceAlt,
													borderLeft: "3px solid var(--mantine-color-blue-6)",
												}}
											>
												<Text
													size="xs"
													c={textSecondary}
													mb={4}
													fw={700}
													tt="uppercase"
													style={{ letterSpacing: "1px" }}
												>
													{entity.schemaName}
												</Text>
											</Box>
											<Text size="xs" c={textSecondary} mt="sm" fw={600}>
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
								backgroundColor: surface,
							}}
						>
							<Title
								order={2}
								size={isMobile ? "1.5rem" : "2rem"}
								c={textPrimary}
								fw={900}
								tt="uppercase"
							>
								RECENT ACTIVITY
							</Title>
						</Box>
						<Paper
							bg={surface}
							p={isMobile ? "md" : "xl"}
							style={{
								borderRadius: 0,
								border: `3px solid ${borderColor}`,
								boxShadow: `6px 6px 0 ${boxShadowColor}`,
							}}
						>
							<Stack gap="md">
								{events.map((event, idx) => (
									<Box
										key={event.id}
										p="md"
										style={{
											borderRadius: 0,
											border: `2px solid ${borderColor}`,
											borderLeft: `4px solid ${idx % 2 === 0 ? "var(--mantine-color-red-5)" : "var(--mantine-color-blue-6)"}`,
											backgroundColor: surfaceAlt,
										}}
									>
										<Group justify="space-between" align="flex-start">
											<Box flex={1}>
												<Group gap="xs" mb={6}>
													<Text
														fw={900}
														c={textPrimary}
														size="sm"
														tt="uppercase"
													>
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
													c={textSecondary}
													mb={6}
													fw={700}
													tt="uppercase"
													style={{ letterSpacing: "1px" }}
												>
													{event.type} · {event.occurredAt}
												</Text>
												{Object.keys(event.properties).length > 0 && (
													<Text size="xs" c={textMuted} fw={600}>
														{Object.entries(event.properties)
															.map(([key, value]) => `${key}: ${value}`)
															.join(" · ")}
													</Text>
												)}
											</Box>
										</Group>
										{idx < events.length - 1 && (
											<Divider color={textSecondary} mt="sm" />
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
