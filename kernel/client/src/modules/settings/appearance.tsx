import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { SegmentedControl } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useSyncExternalStore } from "react";

import type { ThemePreference } from "#/modules/theme/preference";
import type { ThemeStore } from "#/modules/theme/store";

const THEME_OPTIONS = [
	{ icon: "sun", value: "light" },
	{ icon: "moon", value: "dark" },
	{ icon: "monitor", value: "system" },
] as const satisfies readonly { readonly icon: string; readonly value: ThemePreference }[];

export function Appearance(props: { readonly theme: ThemeStore }) {
	const t = useT();
	const preference = useSyncExternalStore(
		props.theme.subscribe,
		props.theme.getPreference,
		props.theme.getPreference,
	);

	return (
		<SegmentedControl
			value={preference}
			optionClassName="px-3"
			className="self-start"
			onChange={props.theme.setPreference}
			label={t(kernelMessage("client.settings.appearance.label"))}
			options={THEME_OPTIONS.map((option) => ({
				value: option.value,
				label: t(kernelMessage("client.settings.appearance.use", { theme: option.value })),
				content: (
					<>
						<AppIcon size={15} name={option.icon} />
						{t(kernelMessage("client.settings.appearance.theme", { theme: option.value }))}
					</>
				),
			}))}
		/>
	);
}
