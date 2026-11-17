import { catalogMessage } from "../../shared/messages.generated";

export const fitnessSignalSchemas = () =>
	[
		{
			slug: "workout.created",
			catalogState: "active" as const,
			audiencePolicy: { kind: "actor" as const },
			notificationHookSlug: "fitness.notification",
			name: catalogMessage("signal-schema.workout-created.name"),
			propertiesSchema: {
				unknownKeys: "strict" as const,
				fields: {
					workoutId: {
						type: "string" as const,
						description: "Created workout ID",
						validation: { required: true as const },
						label: catalogMessage("property.workout-id"),
					},
					workoutName: {
						type: "string" as const,
						description: "Created workout name",
						validation: { required: true as const },
						label: catalogMessage("property.workout-name"),
					},
				},
			},
		},
	] as const;
