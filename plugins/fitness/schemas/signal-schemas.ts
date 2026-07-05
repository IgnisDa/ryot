export const fitnessSignalSchemas = () =>
	[
		{
			slug: "workout.created",
			name: "Workout Created",
			catalogState: "active" as const,
			audiencePolicy: { kind: "actor" as const },
			notificationScriptSlug: "automation.fitness-notification",
			propertiesSchema: {
				unknownKeys: "strict" as const,
				fields: {
					workoutId: {
						label: "Workout ID",
						type: "string" as const,
						description: "Created workout ID",
						validation: { required: true as const },
					},
					workoutName: {
						label: "Workout name",
						type: "string" as const,
						description: "Created workout name",
						validation: { required: true as const },
					},
				},
			},
		},
	] as const;
