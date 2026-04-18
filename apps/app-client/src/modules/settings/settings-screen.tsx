import { useAtomSet, useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { useAuthClient } from "@/modules/auth/client";
import { AppIcon } from "@/modules/icons";
import { themeAtom } from "@/modules/theme/atoms";

const THEME_OPTIONS = [
	{ icon: "sun", label: "Light", value: "light" },
	{ icon: "moon", label: "Dark", value: "dark" },
	{ icon: "monitor", label: "System", value: "system" },
] as const;

function SettingsSection(props: { title: string; children: ReactNode }) {
	return (
		<View className="gap-2">
			<Text className="font-ui-semibold text-xs uppercase tracking-[1.6px] text-text-subtle">
				{props.title}
			</Text>
			<View className="gap-2">{props.children}</View>
		</View>
	);
}

function ThemeOption(props: {
	icon: string;
	label: string;
	isActive: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityLabel={`Use ${props.label} theme`}
			accessibilityState={{ selected: props.isActive }}
			className={clsx(
				"h-12 flex-row items-center gap-3 rounded-lg border px-3.5",
				props.isActive ? "border-accent bg-accent-soft" : "border-border bg-surface",
			)}
		>
			<AppIcon
				size={18}
				name={props.icon}
				className={clsx(props.isActive ? "text-accent-text" : "text-text-muted")}
			/>
			<Text className="flex-1 font-ui-medium text-sm text-text">{props.label}</Text>
			{props.isActive && <AppIcon size={16} name="check" className="text-accent-text" />}
		</Pressable>
	);
}

function SignOutRow() {
	const client = useAuthClient();

	async function handleSignOut() {
		await client.signOut();
		router.replace("/auth");
	}

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Sign out"
			onPress={() => void handleSignOut()}
			className="h-12 flex-row items-center gap-3 rounded-lg border border-border bg-surface px-3.5"
		>
			<AppIcon size={18} name="logout" className="text-danger" />
			<Text className="flex-1 font-ui-medium text-sm text-danger">Sign out</Text>
		</Pressable>
	);
}

export function SettingsScreen() {
	const theme = useAtomValue(themeAtom);
	const setTheme = useAtomSet(themeAtom);

	return (
		<View className="w-full max-w-2xl gap-6 self-center">
			<SettingsSection title="Appearance">
				{THEME_OPTIONS.map((option) => (
					<ThemeOption
						key={option.value}
						icon={option.icon}
						label={option.label}
						isActive={theme === option.value}
						onPress={() => setTheme(option.value)}
					/>
				))}
			</SettingsSection>
			<SettingsSection title="Account">
				<SignOutRow />
			</SettingsSection>
		</View>
	);
}
