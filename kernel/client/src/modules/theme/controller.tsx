import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { getThemePreference, setThemePreference } from "../../persistence/storage";
import {
	THEME_PREFERENCES,
	applyThemePreference,
	isThemePreference,
	type ThemePreference,
} from "./preference";

const initialThemePreference = getThemePreference();
applyThemePreference(document.documentElement, initialThemePreference);

const themePreferenceAtom = Atom.make<ThemePreference>(initialThemePreference).pipe(Atom.keepAlive);

export function ThemeController() {
	const preference = useAtomValue(themePreferenceAtom);

	useEffect(() => {
		applyThemePreference(document.documentElement, preference);
		setThemePreference(preference);
	}, [preference]);

	return null;
}

export function ThemePreferenceControl() {
	const preference = useAtomValue(themePreferenceAtom);
	const setPreference = useAtomSet(themePreferenceAtom);

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
