import { Button } from "@mantine/core";
import type React from "react";
import preview from "#.storybook/preview";

const meta = preview.meta({
	title: "Mantine/Button",
	component: Button as React.ComponentType,
	args: {
		children: "Button",
	},
});

export const Filled = meta.story({
	args: { variant: "filled" },
});

export const Light = meta.story({
	args: { variant: "light" },
});

export const Outline = meta.story({
	args: { variant: "outline" },
});

export const Subtle = meta.story({
	args: { variant: "subtle" },
});

export const Sizes = meta.story({
	render: () => (
		<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
			<Button size="xs">xs</Button>
			<Button size="sm">sm</Button>
			<Button size="md">md</Button>
			<Button size="lg">lg</Button>
			<Button size="xl">xl</Button>
		</div>
	),
});

export const Colors = meta.story({
	render: () => (
		<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
			{["blue", "red", "green", "yellow", "violet", "orange", "teal"].map(
				(color) => (
					<Button key={color} color={color}>
						{color}
					</Button>
				),
			)}
		</div>
	),
});

export const Loading = meta.story({
	args: { loading: true },
});

export const Disabled = meta.story({
	args: { disabled: true },
});

export const FullWidth = meta.story({
	args: { fullWidth: true },
});
