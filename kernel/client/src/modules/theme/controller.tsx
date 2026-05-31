import { Effect } from "effect";
import { useEffect, useState } from "react";

import { ClientStorage } from "../../persistence/storage";
import type { ClientRuntime } from "../../runtime";
import {
	THEME_PREFERENCES,
	applyThemePreference,
	isThemePreference,
	type ThemePreference,
} from "./preference";

export function ThemeController(props: {
	readonly runtime: ClientRuntime;
	readonly initialPreference: ThemePreference;
}) {
	const [preference, setPreference] = useState(props.initialPreference);

	useEffect(() => {
		applyThemePreference(document.documentElement, preference);
		void props.runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.setThemePreference(preference)),
		);
	}, [preference, props.runtime]);

	return (
		<label className="fixed top-[max(16px,env(safe-area-inset-top))] right-[max(16px,env(safe-area-inset-right))] z-2 flex items-center gap-2 text-[13px] font-semibold text-text-muted">
			<span>Theme</span>
			<select
				className="min-h-9 rounded-md border border-border bg-surface py-1.5 pr-7 pl-2.5 text-text"
				value={preference}
				onChange={(event) => {
					const newPreference = event.currentTarget.value;
					if (isThemePreference(newPreference)) {
						setPreference(newPreference);
					}
				}}
			>
				{THEME_PREFERENCES.map((value) => (
					<option key={value} value={value}>
						{value[0]?.toUpperCase()}
						{value.slice(1)}
					</option>
				))}
			</select>
		</label>
	);
}
