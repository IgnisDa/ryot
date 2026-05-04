import { Stack, Text } from "@mantine/core";

import type { AppEntitySchema } from "~/features/entity-schemas/model";
import type { AppTracker } from "~/features/trackers/model";

import { SetupStepCard } from "./setup-step-card";

interface SetupGuidedFlowProps {
	tracker: AppTracker;
	onOpenCreateEntityModal: () => void;
	entitySchemas: Array<AppEntitySchema>;
	onOpenCreateEventSchemaModal: () => void;
	onOpenCreateEntitySchemaModal: () => void;
}

export function SetupGuidedFlow(props: SetupGuidedFlowProps) {
	const primaryEntitySchema = props.entitySchemas[0];
	const hasMainEntitySchema = props.entitySchemas.length > 0;

	const step2State = hasMainEntitySchema ? "active" : "pending";
	const step3State = hasMainEntitySchema ? "active" : "pending";
	const step1State = hasMainEntitySchema ? "completed" : "active";

	const step3Title = primaryEntitySchema
		? `Add Your First ${primaryEntitySchema.name}`
		: "Add Your First Entity";
	const step3Description = primaryEntitySchema
		? `Create your first ${primaryEntitySchema.name.toLowerCase()} to start tracking.`
		: "Create your first entity to start tracking.";

	return (
		<Stack gap="lg">
			<Text size="xs" c="dimmed" fw={600} tt="uppercase" ta="center">
				Setup Your Tracker
			</Text>

			<SetupStepCard
				stepNumber={1}
				status={step1State}
				title="Define Your Main Entity Schema"
				primaryActionLabel="Create Entity Schema"
				onPrimaryAction={props.onOpenCreateEntitySchemaModal}
				description="Create the blueprint for what you want to track (e.g., 'Workout', 'Recipe')."
			/>

			<SetupStepCard
				stepNumber={2}
				status={step2State}
				title="Add an Event Schema (Optional)"
				primaryActionLabel="Create Event Schema"
				onPrimaryAction={props.onOpenCreateEventSchemaModal}
				description="Define actions or events related to your entities (e.g., 'Completed', 'Reviewed')."
			/>

			<SetupStepCard
				stepNumber={3}
				title={step3Title}
				status={step3State}
				description={step3Description}
				primaryActionLabel="Create Entity"
				onPrimaryAction={props.onOpenCreateEntityModal}
			/>
		</Stack>
	);
}
