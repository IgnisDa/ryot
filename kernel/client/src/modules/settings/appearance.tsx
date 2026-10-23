import { SegmentedControl } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useSyncExternalStore } from "react";

import type { ThemePreference } from "#/modules/theme/preference";
import type { ThemeStore } from "#/modules/theme/store";

const THEME_OPTIONS = [
	{ icon: "sun", text: "Light", value: "light", label: "Use Light theme" },
	{ icon: "moon", text: "Dark", value: "dark", label: "Use Dark theme" },
	{ text: "System", icon: "monitor", value: "system", label: "Use System theme" },
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
		<SegmentedControl
			value={preference}
			label="Appearance"
			optionClassName="px-3"
			className="self-start"
			onChange={props.theme.setPreference}
			options={THEME_OPTIONS.map((option) => ({
				value: option.value,
				label: option.label,
				content: (
					<>
						<AppIcon size={15} name={option.icon} />
						{option.text}
					</>
				),
			}))}
		/>
	);
}
