export const fitnessSignalSchemas = () =>
	[
		{
			catalogState: "active" as const,
			slug: "workout.created",
			name: "Workout Created",
			audiencePolicy: { kind: "actor" as const },
			propertiesSchema: {
				unknownKeys: "strict" as const,
				fields: {
					workoutId: {
						type: "string" as const,
						label: "Workout ID",
						validation: { required: true as const },
						description: "Created workout ID",
					},
					workoutName: {
						type: "string" as const,
						label: "Workout name",
						validation: { required: true as const },
						description: "Created workout name",
					},
				},
			},
		},
	] as const;
