import { SandboxRunError } from "@ryot-app/contract/errors";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "effect";

export const selectProviderInputProperties = Effect.fnUntraced(function* (
	subject: string,
	properties: Readonly<Record<string, unknown>>,
	keys: ReadonlyArray<string>,
) {
	for (const key of keys) {
		if (!Object.hasOwn(properties, key) || properties[key] === undefined) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: `${subject} input property '${key}' is unavailable`,
			});
		}
	}
	return yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue))(
		Object.fromEntries(keys.map((key) => [key, properties[key]])),
	).pipe(
		Effect.mapError(
			() =>
				new SandboxRunError({
					kind: "invalid-input",
					message: `${subject} input properties must be JSON`,
				}),
		),
	);
});
