import { RadioGroup } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useSyncExternalStore } from "react";

import { AppIcon } from "#/modules/navigation/app-icon";
import type { ThemePreference } from "#/modules/theme/preference";
import type { ThemeStore } from "#/modules/theme/store";

const THEME_OPTIONS = [
	{ icon: "sun", text: "Light", value: "light", label: "Use Light theme" },
	{ icon: "moon", text: "Dark", value: "dark", label: "Use Dark theme" },
	{ icon: "monitor", text: "System", value: "system", label: "Use System theme" },
] as const satisfies readonly {
	readonly icon: string;
	readonly text: string;
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
		<RadioGroup
			value={preference}
			label="Appearance"
			options={THEME_OPTIONS}
			onChange={props.theme.setPreference}
			className="flex gap-2 rounded-xl border border-border bg-surface p-2"
			renderOption={(option, selected) => ({
				className: clsx(
					"flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border py-3.5",
					selected
						? "border-accent-deep bg-accent-soft text-accent-text"
						: "border-transparent text-text-muted",
				),
				content: (
					<>
						<AppIcon size={18} name={option.icon} />
						<span className="text-xs font-medium">{option.text}</span>
					</>
				),
			})}
		/>
	);
}
