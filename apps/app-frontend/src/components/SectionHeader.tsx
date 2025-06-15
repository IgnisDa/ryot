import { Button, Group, Stack, Text } from "@mantine/core";

interface SectionHeaderAction {
	label: string;
	disabled?: boolean;
	onClick: () => void;
}

export function SectionHeader(props: {
	title: string;
	description: string;
	action?: SectionHeaderAction;
}) {
	return (
		<Group justify="space-between" align="flex-end">
			<Stack gap={2}>
				<Text size="sm" fw={500} c="dimmed">
					{props.title}
				</Text>
				<Text c="dimmed" size="sm">
					{props.description}
				</Text>
			</Stack>
			{props.action && (
				<Button
					size="xs"
					variant="light"
					onClick={props.action.onClick}
					disabled={props.action.disabled}
				>
					{props.action.label}
				</Button>
			)}
		</Group>
	);
}
