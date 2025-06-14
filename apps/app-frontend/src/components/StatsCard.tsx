import { Card, Group, Stack, Text } from "@mantine/core";
import { TrendingUp } from "lucide-react";

export interface StatsCardProps {
	label: string;
	color?: string;
	change?: string;
	isDark?: boolean;
	value: string | number;
}

export function StatsCard(props: StatsCardProps) {
	const color = props.color ?? "#5B7FFF";
	const isDark = props.isDark ?? false;
	const surface = isDark ? "var(--mantine-color-dark-8)" : "white";
	const border = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-3)";
	const textPrimary = isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";

	return (
		<Card
			p="xl"
			bg={surface}
			radius="sm"
			style={{
				border: `1px solid ${border}`,
				borderTop: `3px solid ${color}`,
				transition: "all 0.2s ease",
			}}
			styles={{
				root: {
					"&:hover": {
						transform: "translateY(-3px)",
						boxShadow: `0 8px 24px rgba(0, 0, 0, ${isDark ? "0.3" : "0.08"})`,
					},
				},
			}}
		>
			<Stack gap={10}>
				<Text
					size="xs"
					fw={600}
					tt="uppercase"
					style={{
						color: color,
						letterSpacing: "1px",
						fontFamily: '"Space Grotesk", sans-serif',
					}}
				>
					{props.label}
				</Text>
				<Text
					size="2.5rem"
					fw={600}
					lh={1}
					style={{
						color: textPrimary,
						fontFamily: '"Space Grotesk", sans-serif',
					}}
				>
					{props.value}
				</Text>
				{props.change && (
					<Group gap={5} mt={2}>
						<TrendingUp size={14} color={color} />
						<Text size="xs" fw={500} style={{ color: color }}>
							{props.change}
						</Text>
					</Group>
				)}
			</Stack>
		</Card>
	);
}
