import { Box, Group, Paper, Stack, Text } from "@mantine/core";

import { colorMix, getSectionBackground } from "../shared";

interface SectionHeaderProps {
	title: string;
	eyebrow?: string;
	textMuted: string;
	textPrimary: string;
	accentColor: string;
	right?: React.ReactNode;
}

export function SectionHeader(props: SectionHeaderProps) {
	return (
		<Group justify="space-between" align="flex-end" mb="md" gap="sm">
			<Stack gap={4}>
				{props.eyebrow ? (
					<Group gap={8}>
						<Box h={2} w={18} style={{ borderRadius: 999, backgroundColor: props.accentColor }} />
						<Text
							fz={10}
							fw={700}
							tt="uppercase"
							c={props.accentColor}
							style={{ letterSpacing: "1px" }}
							ff="var(--mantine-headings-font-family)"
						>
							{props.eyebrow}
						</Text>
					</Group>
				) : null}
				<Text
					fz="xl"
					fw={700}
					lh={1.1}
					c={props.textPrimary}
					ff="var(--mantine-headings-font-family)"
				>
					{props.title}
				</Text>
			</Stack>
			{props.right ? <Box>{props.right}</Box> : null}
		</Group>
	);
}

interface SectionFrameProps {
	border: string;
	isDark: boolean;
	surface: string;
	accentColor: string;
	children: React.ReactNode;
}

export function SectionFrame(props: SectionFrameProps) {
	return (
		<Paper
			p="md"
			radius="sm"
			style={{
				overflow: "hidden",
				position: "relative",
				border: `1px solid ${props.border}`,
				boxShadow: props.isDark
					? `0 12px 32px ${colorMix("#000000", 0.22)}`
					: `0 10px 30px ${colorMix(props.accentColor, 0.08)}`,
				background: getSectionBackground({
					isDark: props.isDark,
					surface: props.surface,
					accent: props.accentColor,
				}),
			}}
		>
			<Box
				style={{
					top: 0,
					left: 0,
					height: 3,
					width: "100%",
					position: "absolute",
					background: `linear-gradient(90deg, ${props.accentColor} 0%, ${colorMix(props.accentColor, 0)} 100%)`,
				}}
			/>
			{props.children}
		</Paper>
	);
}
