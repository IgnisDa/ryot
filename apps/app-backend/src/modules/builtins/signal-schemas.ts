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
	] as const satisfies ReadonlyArray<BuiltinSignalSchemaInput>;
