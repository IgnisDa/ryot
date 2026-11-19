import type { AppSchemaInput, AppSchemaValue } from "./app-schema-inference";
import type { AppSchema } from "./property-schema";

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
const definition = {
	fields: {
		count: {
			label: "Count",
			type: "integer",
			defaultValue: 1,
			description: "Count",
			validation: { required: true },
		},
		state: {
			type: "enum",
			label: "State",
			description: "State",
			choices: { kind: "static", values: [{ value: "open" }, { value: "closed" }] },
		},
		settings: {
			type: "object",
			label: "Settings",
			description: "Settings",
			validation: { required: true },
			properties: {
				enabled: {
					type: "boolean",
					label: "Enabled",
					defaultValue: false,
					description: "Enabled",
					validation: { required: true },
				},
			},
		},
	},
} as const satisfies AppSchema;
export type AppSchemaInferenceChecks = [
	Assert<Equal<AppSchemaInput<typeof definition>["count"], number | undefined>>,
	Assert<Equal<AppSchemaValue<typeof definition>["count"], number>>,
	Assert<Equal<AppSchemaInput<typeof definition>["state"], null | "open" | "closed" | undefined>>,
	Assert<Equal<AppSchemaInput<typeof definition>["settings"]["enabled"], boolean | undefined>>,
	Assert<Equal<AppSchemaValue<typeof definition>["settings"]["enabled"], boolean>>,
];
