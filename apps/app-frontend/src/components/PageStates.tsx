import {
	Box,
	Button,
	Center,
	Loader,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { X } from "lucide-react";

export function LoadingState() {
	return (
		<Center h="100vh">
			<Loader size="lg" />
		</Center>
	);
}

export function ErrorState(props: {
	title: string;
	description: string;
	onRetry?: () => void;
}) {
	return (
		<Box py={80} px="xl">
			<Stack align="center" gap="lg" maw={600} mx="auto">
				<Title order={1} ta="center">
					{props.title}
				</Title>
				<Text c="dimmed" size="lg" ta="center">
					{props.description}
				</Text>
				{props.onRetry ? (
					<Button variant="light" onClick={props.onRetry}>
						Retry
					</Button>
				) : null}
			</Stack>
		</Box>
	);
}

export function EmptyState(props: {
	title?: string;
	description: string;
	accentColor: string;
	accentMuted: string;
}) {
	return (
		<Paper p="xl" withBorder radius="sm" ta="center">
			<Stack gap="md" align="center">
				<Box
					w={64}
					h={64}
					c={props.accentColor}
					bg={props.accentMuted}
					style={{ display: "grid", borderRadius: "50%", placeItems: "center" }}
				>
					<X size={28} />
				</Box>
				<Text fw={600} size="lg" ff="var(--mantine-headings-font-family)">
					{props.title ?? "No results found"}
				</Text>
				<Text size="sm" c="dimmed" maw={400}>
					{props.description}
				</Text>
			</Stack>
		</Paper>
	);
}
