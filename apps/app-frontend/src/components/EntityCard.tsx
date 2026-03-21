import { Badge, Box, Card, Text } from "@mantine/core";

export interface EntityCardProps {
	name: string;
	image?: string;
	rating?: string;
	isDark?: boolean;
	lastEvent: string;
	schemaName: string;
	trackerColor?: { base: string; muted: string };
}

export function EntityCard(props: EntityCardProps) {
	const isDark = props.isDark ?? false;
	const surface = isDark ? "var(--mantine-color-dark-8)" : "white";
	const surfaceHover = isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-stone-1)";
	const border = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-3)";
	const borderAccent = "var(--mantine-color-accent-5)";
	const textPrimary = isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textSecondary = isDark
		? "var(--mantine-color-dark-3)"
		: "var(--mantine-color-dark-5)";
	const textMuted = isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	const trackerColor = props.trackerColor ?? {
		base: "#5B7FFF",
		muted: "rgba(91, 127, 255, 0.12)",
	};

	return (
		<Card
			p={0}
			bg={surface}
			radius="sm"
			style={{
				cursor: "pointer",
				overflow: "hidden",
				transition: "all 0.25s ease",
				border: `1px solid ${border}`,
			}}
			styles={{
				root: {
					"&:hover": {
						borderColor: borderAccent,
						transform: "translateY(-4px)",
						boxShadow: `0 12px 32px rgba(0, 0, 0, ${isDark ? "0.35" : "0.1"})`,
					},
				},
			}}
		>
			{props.image && (
				<Box
					h={220}
					style={{
						position: "relative",
						backgroundSize: "cover",
						backgroundPosition: "center",
						backgroundImage: `url(${props.image})`,
					}}
				>
					<Box
						style={{
							inset: 0,
							position: "absolute",
							background: `linear-gradient(180deg, transparent 50%, ${isDark ? "rgba(26, 24, 22, 0.7)" : "rgba(0, 0, 0, 0.35)"} 100%)`,
						}}
					/>
					{props.rating && (
						<Box style={{ top: 12, right: 12, position: "absolute" }}>
							<Badge
								size="lg"
								variant="filled"
								styles={{
									root: {
										color: "white",
										border: "none",
										fontWeight: 700,
										backgroundColor: trackerColor.base,
										fontFamily: '"Space Grotesk", sans-serif',
										boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
									},
								}}
							>
								{props.rating}
							</Badge>
						</Box>
					)}
				</Box>
			)}
			{!props.image && (
				<Box
					h={220}
					bg={surfaceHover}
					style={{ display: "grid", placeItems: "center" }}
				>
					<Text c={textMuted} size="sm" fw={500}>
						No image
					</Text>
				</Box>
			)}
			<Box p="lg">
				<Text
					fw={600}
					size="md"
					mb={6}
					style={{
						color: textPrimary,
						fontFamily: '"Space Grotesk", sans-serif',
					}}
				>
					{props.name}
				</Text>
				<Badge
					size="sm"
					variant="light"
					mb={8}
					styles={{
						root: {
							fontWeight: 600,
							color: trackerColor.base,
							backgroundColor: trackerColor.muted,
							fontFamily: '"Space Grotesk", sans-serif',
							border: `1px solid ${trackerColor.base}33`,
						},
					}}
				>
					{props.schemaName}
				</Badge>
				<Text size="xs" c={textSecondary} mt={4} style={{ lineHeight: 1.5 }}>
					{props.lastEvent}
				</Text>
			</Box>
		</Card>
	);
}
