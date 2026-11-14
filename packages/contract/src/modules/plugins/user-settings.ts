import { Effect, Schema } from "effect";

import { JsonValue } from "../../schema/json";
import type { AppSchema } from "../../schema/property-schema";
import { parseAppSchemaProperties } from "../../schema/property-values";

export const resolvePluginUserSettings = Effect.fn("resolvePluginUserSettings")(function* (
	settingsSchema: AppSchema,
	values: unknown,
) {
	const parsed = yield* parseAppSchemaProperties({
		properties: values,
		kind: "Plugin user settings",
		propertiesSchema: { ...settingsSchema, unknownKeys: "strict" },
	});
	return yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(parsed);
});

export const resolveStoredPluginUserSettings = Effect.fn("resolveStoredPluginUserSettings")(
	function* (settingsSchema: AppSchema, values: Readonly<Record<string, unknown>>) {
		return yield* resolvePluginUserSettings(
			settingsSchema,
			Object.fromEntries(
				Object.entries(values).filter(([key]) => Object.hasOwn(settingsSchema.fields, key)),
			),
		);
	},
);
