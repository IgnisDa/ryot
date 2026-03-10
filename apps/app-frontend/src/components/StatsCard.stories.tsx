import type React from "react";
import preview from "#.storybook/preview";
import { StatsCard } from "./StatsCard";

const meta = preview.meta({
	title: "Components/StatsCard",
	component: StatsCard as React.ComponentType,
});

export const Default = meta.story({
	args: {
		label: "Total Items",
		value: "247",
		change: "+12% from last month",
		color: "#5B7FFF",
		isDark: false,
	},
});

export const WithoutChange = meta.story({
	args: {
		label: "Active Users",
		value: "1,234",
		color: "#2DD4BF",
		isDark: false,
	},
});

export const GoldAccent = meta.story({
	args: {
		label: "Completed",
		value: "89%",
		change: "+5% this week",
		color: "#D4A574",
		isDark: false,
	},
});

export const PurpleAccent = meta.story({
	args: {
		label: "Locations",
		value: "42",
		change: "+3 new",
		color: "#A78BFA",
		isDark: false,
	},
});

export const AllColors = meta.story({
	render: () => (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(2, 280px)",
				gap: 16,
			}}
		>
			<StatsCard
				label="Total Items"
				value="247"
				change="+12%"
				color="#5B7FFF"
			/>
			<StatsCard
				label="Fitness"
				value="89"
				change="+5 this week"
				color="#2DD4BF"
			/>
			<StatsCard label="Whiskey" value="42" change="+3 new" color="#D4A574" />
			<StatsCard label="Places" value="15" color="#A78BFA" />
		</div>
	),
});
