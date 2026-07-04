import type { BuiltinSignalSchemaInput } from "#modules/signals/signal-schemas-repository";

export const builtinSignalSchemas = () =>
	[
		{
			catalogState: "active",
			slug: "review.created",
			name: "Review Created",
			audiencePolicy: { kind: "actor" },
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityId: {
						type: "string",
						label: "Entity ID",
						validation: { required: true },
						description: "Reviewed entity ID",
					},
					entityName: {
						type: "string",
						label: "Entity name",
						validation: { required: true },
						description: "Reviewed entity name",
					},
					reviewEventId: {
						type: "string",
						label: "Review event ID",
						validation: { required: true },
						description: "Created review event ID",
					},
					entitySchemaSlug: {
						type: "string",
						label: "Entity schema slug",
						validation: { required: true },
						description: "Reviewed entity schema slug",
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "workout.created",
			name: "Workout Created",
			audiencePolicy: { kind: "actor" },
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					workoutId: {
						type: "string",
						label: "Workout ID",
						validation: { required: true },
						description: "Created workout ID",
					},
					workoutName: {
						type: "string",
						label: "Workout name",
						validation: { required: true },
						description: "Created workout name",
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "integration.disabled",
			name: "Integration Disabled",
			audiencePolicy: { kind: "actor" },
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					integrationId: {
						type: "string",
						label: "Integration ID",
						validation: { required: true },
						description: "Disabled integration ID",
					},
					providerName: {
						type: "string",
						label: "Provider name",
						validation: { required: true },
						description: "Disabled integration provider",
					},
				},
			},
		},
		{
			catalogState: "hidden",
			slug: "automation.test-tracer",
			name: "Automation Test Tracer",
			audiencePolicy: { kind: "actor" },
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					message: {
						type: "string",
						label: "Message",
						description: "Tracer message",
						validation: { required: true },
					},
				},
			},
		},
		{
			catalogState: "hidden",
			slug: "automation.test-emitted",
			audiencePolicy: { kind: "actor" },
			name: "Automation Test Emitted Signal",
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					message: {
						type: "string",
						label: "Message",
						validation: { required: true },
						description: "Emitted test message",
					},
				},
			},
		},
	] as const satisfies ReadonlyArray<BuiltinSignalSchemaInput>;
