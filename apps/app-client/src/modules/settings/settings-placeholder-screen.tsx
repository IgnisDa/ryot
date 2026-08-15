import { Text } from "react-native";

import { SectionFrame } from "@/modules/ui/section-frame";

export function SettingsPlaceholderScreen(props: { title: string; detail: string }) {
	return (
		<SectionFrame title={props.title}>
			<Text className="font-ui text-sm leading-6 text-text-muted">{props.detail}</Text>
		</SectionFrame>
	);
}
