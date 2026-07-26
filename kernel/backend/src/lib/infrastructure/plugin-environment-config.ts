import { Context, Effect, Layer } from "effect";

export type PluginEnvironmentConfigEntry = {
	readonly configRevisionId: string;
	readonly pluginRevisionId: string;
};

export type PluginEnvironmentConfigSnapshot = Readonly<
	Record<string, PluginEnvironmentConfigEntry>
>;

export const makePluginEnvironmentConfig = (initial: PluginEnvironmentConfigSnapshot = {}) => {
	let snapshot: PluginEnvironmentConfigSnapshot = Object.freeze({ ...initial });
	return {
		getSnapshot: () => snapshot,
		find: (pluginId: string) => snapshot[pluginId],
		replace: (next: PluginEnvironmentConfigSnapshot) => {
			snapshot = Object.freeze({ ...next });
		},
	};
};

// Construction must stay pure: this layer builds before `SchemaMigrationLive`, so any I/O here
// would run against a pre-migration database. `PluginIngestionService` populates the map instead.
// The layer must also stay memoized; `Layer.fresh` would give boot and runtime separate empty maps.
export class PluginEnvironmentConfig extends Context.Service<PluginEnvironmentConfig>()(
	"PluginEnvironmentConfig",
	{ make: Effect.sync(() => makePluginEnvironmentConfig()) },
) {
	static readonly layer = Layer.effect(this, this.make);
}
