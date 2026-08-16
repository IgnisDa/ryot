import clsx from "clsx";
import { useSyncExternalStore } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import type { ThemePreference } from "#/modules/theme/preference";
import type { ThemeStore } from "#/modules/theme/store";

const THEME_OPTIONS = [
	{ icon: "sun", label: "Light", value: "light" },
	{ icon: "moon", label: "Dark", value: "dark" },
	{ icon: "monitor", label: "System", value: "system" },
] as const satisfies readonly {
	readonly icon: string;
	readonly label: string;
	readonly value: ThemePreference;
}[];

export function Appearance(props: { readonly theme: ThemeStore }) {
	const preference = useSyncExternalStore(
		props.theme.subscribe,
		props.theme.getPreference,
		props.theme.getPreference,
	);

	return (
		<div
			role="radiogroup"
			aria-label="Appearance"
			className="flex gap-2 rounded-xl border border-border bg-surface p-2"
		>
			{THEME_OPTIONS.map((option) => {
				const active = preference === option.value;
				return (
					<button
						type="button"
						role="radio"
						key={option.value}
						aria-checked={active}
						aria-label={`Use ${option.label} theme`}
						onClick={() => props.theme.setPreference(option.value)}
						className={clsx(
							"flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border py-3.5",
							active
								? "border-accent bg-accent-soft text-accent-text"
								: "border-transparent text-text-muted",
						)}
					>
						<AppIcon name={option.icon} size={18} />
						<span className="text-xs font-medium">{option.label}</span>
					</button>
				);
			})}
		</div>
	);
}
