import { Effect } from "effect";
import { useEffect, useSyncExternalStore } from "react";

import type { ThemeStore } from "#/modules/theme/store";
import { ClientStorage } from "#/persistence/storage";

type ThemeControllerRuntime = {
	readonly runPromise: <A, E>(
		effect: Effect.Effect<A, E, ClientStorage>,
		options?: Effect.RunOptions,
	) => Promise<A>;
};

export function ThemeController(props: {
	readonly theme: ThemeStore;
	readonly runtime: ThemeControllerRuntime;
}) {
	const preference = useSyncExternalStore(
		props.theme.subscribe,
		props.theme.getPreference,
		props.theme.getPreference,
	);

	useEffect(() => {
		void props.runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setThemePreference(preference)),
		);
	}, [preference, props.runtime]);

	return null;
}
