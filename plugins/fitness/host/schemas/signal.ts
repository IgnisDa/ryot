export const fitnessSignalSchemas = () =>
	[
		{
			slug: "workout.created",
			name: "Workout Created",
			catalogState: "active" as const,
			audiencePolicy: { kind: "actor" as const },
			notificationHookSlug: "fitness.notification",
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
		{
			catalogState: "hidden" as const,
			slug: "exercise.context-changed",
			name: "Exercise Context Changed",
			notificationHookSlug: "fitness.notification",
			propertiesSchema: { fields: {}, unknownKeys: "strict" as const },
			audiencePolicy: {
				role: "entity" as const,
				eventSchemaSlug: "workout-set",
				kind: "dependent_event_owners" as const,
			},
		},
		{
			slug: "workout.context-changed",
			name: "Workout Context Changed",
			catalogState: "hidden" as const,
			notificationHookSlug: "fitness.notification",
			propertiesSchema: { fields: {}, unknownKeys: "strict" as const },
			audiencePolicy: {
				role: "session" as const,
				eventSchemaSlug: "workout-set",
				kind: "dependent_event_owners" as const,
			},
		},
	] as const;
