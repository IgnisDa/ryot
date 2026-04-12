import { Badge, Box, Stack, Text, ThemeIcon } from "@mantine/core";
import { useState } from "react";
import { TrackerIcon } from "~/features/trackers/icons";
import { colorMix, STONE } from "../shared";

interface ArtworkProps {
	url?: string;
	icon: string;
	note?: string;
	color: string;
	title: string;
	width?: number;
	height?: number;
	radius?: number;
}

export function Artwork(props: ArtworkProps) {
	const [hasError, setHasError] = useState(!props.url);

	return (
		<Box
			w={props.width}
			h={props.height}
			style={{
				overflow: "hidden",
				position: "relative",
				borderRadius: props.radius ?? 8,
				background: `linear-gradient(160deg, ${colorMix(props.color, 0.2)} 0%, ${colorMix(STONE, 0.08)} 100%)`,
			}}
		>
			{props.url && !hasError ? (
				<Box
					w="100%"
					h="100%"
					src={props.url}
					component="img"
					alt={props.title}
					style={{ objectFit: "cover" }}
					onError={() => setHasError(true)}
				/>
			) : (
				<Stack
					p="sm"
					gap={8}
					h="100%"
					align="center"
					justify="center"
					style={{
						background: `linear-gradient(180deg, ${colorMix(props.color, 0.28)} 0%, ${colorMix(STONE, 0.08)} 100%)`,
					}}
				>
					<ThemeIcon
						size={32}
						radius="xl"
						variant="light"
						style={{
							color: props.color,
							backgroundColor: colorMix(props.color, 0.16),
						}}
					>
						<TrackerIcon icon={props.icon} size={16} color={props.color} />
					</ThemeIcon>
					<Text
						fz={10}
						fw={600}
						ta="center"
						lineClamp={3}
						ff="var(--mantine-headings-font-family)"
						c={colorMix("#2D241D", 0.84)}
					>
						{props.title}
					</Text>
				</Stack>
			)}

			<Box
				style={{
					inset: 0,
					position: "absolute",
					background:
						"linear-gradient(180deg, rgba(0, 0, 0, 0) 45%, rgba(0, 0, 0, 0.6) 100%)",
				}}
			/>
			{props.note ? (
				<Badge
					size="xs"
					variant="filled"
					style={{
						left: 8,
						bottom: 8,
						color: "white",
						position: "absolute",
						backgroundColor: colorMix("#201812", 0.72),
					}}
				>
					{props.note}
				</Badge>
			) : null}
		</Box>
	);
}
