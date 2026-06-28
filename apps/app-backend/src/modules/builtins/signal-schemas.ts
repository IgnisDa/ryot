import type { BuiltinSignalSchemaInput } from "#modules/signals/signal-schemas-repository";

export const builtinSignalSchemas = () =>
	[
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
