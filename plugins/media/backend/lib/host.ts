import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

const userSettingsSchema = Schema.Struct({ allowNsfw: Schema.Boolean });

export const getUserAllowNsfw = (host: Pick<ScriptHost, "getUserSettings">) =>
	host.getUserSettings().pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(userSettingsSchema)),
		Effect.map(({ allowNsfw }) => allowNsfw),
	);
