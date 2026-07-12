import clsx from "clsx";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";

import {
	settingsSections,
	type SettingsSection,
	type SettingsSectionSlug,
} from "./settings-sections";

export function SettingsNavigationList(props: {
	showDisclosure: boolean;
	active: SettingsSectionSlug | null;
	onSelect: (section: SettingsSection) => void;
}) {
	return (
		<View className="gap-1">
			{settingsSections.map((section) => {
				const isActive = section.slug === props.active;
				return (
					<Pressable
						key={section.slug}
						accessibilityRole="button"
						accessibilityLabel={section.label}
						onPress={() => props.onSelect(section)}
						accessibilityState={{ selected: isActive }}
						className={clsx(
							"min-h-11 flex-row items-center gap-3 rounded-lg px-3",
							isActive && "bg-nav-indicator",
						)}
					>
						<AppIcon className="text-text-muted" name={section.icon} size={17} />
						<Text
							className={clsx(
								"flex-1 font-ui text-sm",
								isActive ? "font-ui-medium text-text" : "text-text-muted",
							)}
						>
							{section.label}
						</Text>
						{props.showDisclosure ? (
							<AppIcon className="text-text-subtle" name="chevron-right" size={15} />
						) : null}
					</Pressable>
				);
			})}
		</View>
	);
}
