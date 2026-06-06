import { Text } from "react-native";

import { SettingsSectionFrame } from "./settings-section-frame";

export function SettingsPlaceholderScreen(props: { title: string; detail: string }) {
	return (
		<SettingsSectionFrame title={props.title}>
			<Text className="font-ui text-sm leading-6 text-text-muted">{props.detail}</Text>
		</SettingsSectionFrame>
	);
}
