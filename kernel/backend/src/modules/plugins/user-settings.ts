import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Schema } from "effect";

import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

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
