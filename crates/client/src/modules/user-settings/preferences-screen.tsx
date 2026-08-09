import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot-app/contract/modules/user-settings/schemas";
import clsx from "clsx";
import { Exit } from "effect";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { AppIcon } from "@/modules/icons";
import { themeAtom } from "@/modules/theme/atoms";

import { updateUserPreferencesAtom, userSettingsReactivityKeys } from "./atoms";
import { PreferenceSettingsForm } from "./preference-settings-form";
import { SettingsSection, UserSettingsContainer } from "./user-settings-container";

const THEME_OPTIONS = [
	{ icon: "sun", label: "Light", value: "light" },
	{ icon: "moon", label: "Dark", value: "dark" },
	{ icon: "monitor", label: "System", value: "system" },
] as const;

function ThemeSettings() {
	const theme = useAtomValue(themeAtom);
	const setTheme = useAtomSet(themeAtom);

	return (
		<SettingsSection title="Appearance" detail="Choose how Ryot looks on this device.">
			<View className="flex-row gap-2 rounded-xl border border-border bg-surface p-2">
				{THEME_OPTIONS.map((option) => {
					const active = theme === option.value;
					return (
						<Pressable
							key={option.value}
							accessibilityRole="radio"
							onPress={() => setTheme(option.value)}
							accessibilityState={{ checked: active }}
							accessibilityLabel={`Use ${option.label} theme`}
							className={clsx(
								"h-17 flex-1 items-center justify-center gap-1.5 rounded-lg border",
								active ? "border-accent bg-accent-soft" : "border-transparent",
							)}
						>
							<AppIcon
								size={18}
								name={option.icon}
								className={clsx(active ? "text-accent-text" : "text-text-muted")}
							/>
							<Text
								className={clsx(
									"font-ui-medium text-xs",
									active ? "text-accent-text" : "text-text-muted",
								)}
							>
								{option.label}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</SettingsSection>
	);
}

function PreferenceSettings(props: { preferences: UserPreferences }) {
	const scope = useApiScope();
	const [failure, setFailure] = useState<unknown>();
	const updatePreferences = useAtomSet(updateUserPreferencesAtom(scope), { mode: "promiseExit" });
	useInternalRequestFailureLogging("user preference update failed", failure);

	async function save(payload: UpdateUserPreferencesBody) {
		const result = await updatePreferences({
			payload,
			reactivityKeys: userSettingsReactivityKeys(scope),
		});
		setFailure(Exit.isFailure(result) ? result.cause : undefined);
		return result;
	}

	return (
		<SettingsSection title="Content and data" detail="Control metadata and background connections.">
			<PreferenceSettingsForm preferences={props.preferences} onSave={save} />
		</SettingsSection>
	);
}

export function PreferencesScreen() {
	return (
		<UserSettingsContainer>
			{(settings) => (
				<>
					<ThemeSettings />
					<PreferenceSettings preferences={settings.preferences} />
				</>
			)}
		</UserSettingsContainer>
	);
}
