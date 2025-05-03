import { Badge, Button, Card, Group, Image, Text } from "@mantine/core";
import type React from "react";
import preview from "#.storybook/preview";

const meta = preview.meta({
	title: "Mantine/Card",
	component: Card as React.ComponentType,
});

export const Simple = meta.story({
	render: () => (
		<Card shadow="sm" padding="lg" radius="md" withBorder w={320}>
			<Text fw={500}>Simple Card</Text>
			<Text size="sm" c="dimmed" mt={4}>
				A basic card with some text content inside.
			</Text>
		</Card>
	),
});

export const WithImage = meta.story({
	render: () => (
		<Card shadow="sm" padding="lg" radius="md" withBorder w={320}>
			<Card.Section>
				<Image
					src="https://images.unsplash.com/photo-1527004013197-933c4bb611b3?w=600&auto=format"
					height={160}
					alt="Norway"
				/>
			</Card.Section>
			<Group justify="space-between" mt="md" mb="xs">
				<Text fw={500}>Norway Fjords</Text>
				<Badge color="pink">On Sale</Badge>
			</Group>
			<Text size="sm" c="dimmed">
				With Fjord Tours you can explore more of the magical fjord landscapes
				with tours and activities on and around the fjords of Norway.
			</Text>
			<Button color="blue" fullWidth mt="md" radius="md">
				Book classic tour now
			</Button>
		</Card>
	),
});

export const WithSections = meta.story({
	render: () => (
		<Card shadow="sm" padding="lg" radius="md" withBorder w={320}>
			<Card.Section withBorder inheritPadding py="xs">
				<Group justify="space-between">
					<Text fw={500}>Card with sections</Text>
					<Badge>New</Badge>
				</Group>
			</Card.Section>
			<Text size="sm" c="dimmed" mt="sm">
				This card uses Card.Section to create distinct areas with borders.
			</Text>
			<Card.Section withBorder inheritPadding mt="sm" pb="md">
				<Text size="xs" c="dimmed">
					Footer section
				</Text>
			</Card.Section>
		</Card>
	),
});

export const NoBorder = meta.story({
	render: () => (
		<Card shadow="sm" padding="lg" radius="md" w={320} bg="blue.0">
			<Text fw={500}>No border card</Text>
			<Text size="sm" c="dimmed" mt={4}>
				Card without border, using background color instead.
			</Text>
		</Card>
	),
});

export const Shadows = meta.story({
	render: () => (
		<div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
			{(["xs", "sm", "md", "lg", "xl"] as const).map((shadow) => (
				<Card
					key={shadow}
					shadow={shadow}
					padding="lg"
					radius="md"
					withBorder
					w={140}
				>
					<Text fw={500} size="sm">
						shadow={shadow}
					</Text>
				</Card>
			))}
		</div>
	),
});
