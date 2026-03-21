import { Card, Group, Stack, Text } from "@mantine/core";
import { TrendingUp } from "lucide-react";
import { useThemeTokens } from "#/hooks/theme";

export interface StatsCardProps {
	label: string;
	color?: string;
	change?: string;
	value: string | number;
}

export function StatsCard(props: StatsCardProps) {
	const color = props.color ?? "#5B7FFF";
	const { isDark, surface, border, textPrimary } = useThemeTokens();

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
					fw={600}
					c={color}
					size="xs"
					tt="uppercase"
					style={{ letterSpacing: "1px" }}
					ff="var(--mantine-headings-font-family)"
				>
					{props.label}
				</Text>
				<Text
					lh={1}
					fw={600}
					size="2.5rem"
					c={textPrimary}
					ff="var(--mantine-headings-font-family)"
				>
					{props.value}
				</Text>
				{props.change && (
					<Group gap={5} mt={2}>
						<TrendingUp size={14} color={color} />
						<Text size="xs" fw={500} c={color}>
							{props.change}
						</Text>
					</Group>
				)}
			</Stack>
		</Card>
	);
}
