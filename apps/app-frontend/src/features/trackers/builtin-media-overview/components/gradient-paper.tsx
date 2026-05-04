import { Badge, Group, Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { colorMix, STONE } from "../shared";

interface GradientPaperProps {
	color: string;
	border: string;
	surface: string;
	children: ReactNode;
	surfaceHover?: string;
}

export function GradientPaper(props: GradientPaperProps) {
	const hoverColor = props.surfaceHover ?? props.surface;
	return (
		<Paper
			radius="sm"
			style={{
				overflow: "hidden",
				border: `1px solid ${props.border}`,
				boxShadow: `0 10px 24px ${colorMix(props.color, 0.08)}`,
				background: `linear-gradient(180deg, ${colorMix(props.color, 0.08)} 0%, ${props.surface} 34%, ${props.surface} 100%)`,
			}}
			styles={{
				root: {
					transition: "all 0.18s ease",
					"&:hover": {
						transform: "translateY(-2px)",
						background: `linear-gradient(180deg, ${colorMix(props.color, 0.1)} 0%, ${hoverColor} 30%, ${hoverColor} 100%)`,
					},
				},
			}}
		>
			{props.children}
		</Paper>
	);
}

interface CardTitleProps {
	lineClamp?: number;
	children: ReactNode;
	textPrimary: string;
}

export function CardTitle(props: CardTitleProps) {
	return (
		<Text
			fz="sm"
			fw={600}
			lh={1.3}
			c={props.textPrimary}
			lineClamp={props.lineClamp ?? 1}
			ff="var(--mantine-headings-font-family)"
		>
			{props.children}
		</Text>
	);
}

interface CardSubtitleProps {
	textMuted: string;
	children: ReactNode;
}

export function CardSubtitle(props: CardSubtitleProps) {
	return (
		<Text fz="xs" c={props.textMuted} lineClamp={1}>
			{props.children}
		</Text>
	);
}

interface CardBadgeProps {
	color: string;
	children: ReactNode;
}

export function CardBadge(props: CardBadgeProps) {
	return (
		<Badge
			size="xs"
			variant="light"
			style={{
				color: props.color,
				backgroundColor: colorMix(props.color, 0.12),
			}}
		>
			{props.children}
		</Badge>
	);
}

interface EntitySchemaRowProps {
	right?: ReactNode;
	textMuted: string;
	entitySchemaSlug: string;
	schemaBySlug: Map<string, { accentColor?: string; icon?: string; name?: string }>;
}

export function EntitySchemaRow(props: EntitySchemaRowProps) {
	const schema = props.schemaBySlug.get(props.entitySchemaSlug);
	const color = schema?.accentColor ?? STONE;
	return (
		<Group gap={6}>
			<CardBadge color={color}>{schema?.name ?? "Item"}</CardBadge>
			{props.right}
		</Group>
	);
}
