import { Badge, Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { Check } from "lucide-react";

type SetupStepStatus = "pending" | "active" | "completed";

interface SetupStepCardProps {
	title: string;
	summary?: string;
	stepNumber: number;
	description: string;
	status: SetupStepStatus;
	primaryActionLabel?: string;
	onPrimaryAction?: () => void;
	secondaryActionLabel?: string;
	onSecondaryAction?: () => void;
}

const getStatusStyles = (status: SetupStepStatus) => {
	switch (status) {
		case "completed":
			return {
				opacity: 0.7,
				borderColor: "var(--mantine-color-green-6)",
			};
		case "active":
			return {
				opacity: 1,
				borderColor: "var(--mantine-color-accent-6)",
			};
		case "pending":
			return {
				opacity: 0.5,
				borderColor: "var(--mantine-color-default-border)",
			};
	}
};

export function SetupStepCard(props: SetupStepCardProps) {
	const styles = getStatusStyles(props.status);

	return (
		<Paper
			p="lg"
			withBorder
			style={{
				borderWidth: 2,
				opacity: styles.opacity,
				borderColor: styles.borderColor,
			}}
		>
			<Stack gap="md">
				<Group gap="md" wrap="nowrap">
					{props.status === "completed" ? (
						<Badge
							size="lg"
							color="green"
							variant="filled"
							style={{ minWidth: 32 }}
						>
							<Check size={16} />
						</Badge>
					) : (
						<Badge
							size="lg"
							style={{ minWidth: 32 }}
							color={props.status === "active" ? "accent" : "gray"}
							variant={props.status === "active" ? "filled" : "outline"}
						>
							{props.stepNumber}
						</Badge>
					)}
					<Box style={{ flex: 1 }}>
						<Text fw={600} size="lg">
							{props.title}
						</Text>
						<Text size="sm" c="dimmed" mt={4}>
							{props.status === "completed" && props.summary
								? props.summary
								: props.description}
						</Text>
					</Box>
				</Group>

				{props.status === "active" &&
					(props.onPrimaryAction || props.onSecondaryAction) && (
						<Group gap="sm" mt="xs">
							{props.onPrimaryAction && (
								<Button
									color="accent"
									variant="filled"
									onClick={props.onPrimaryAction}
								>
									{props.primaryActionLabel || "Continue"}
								</Button>
							)}
							{props.onSecondaryAction && (
								<Button variant="subtle" onClick={props.onSecondaryAction}>
									{props.secondaryActionLabel || "Skip"}
								</Button>
							)}
						</Group>
					)}
			</Stack>
		</Paper>
	);
}
