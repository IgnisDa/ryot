import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot/contract/modules/user-settings/schemas";
import clsx from "clsx";
import { Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useAuthClient } from "@/modules/auth/client";
import { AppIcon } from "@/modules/icons";
import { themeAtom } from "@/modules/theme/atoms";
import { RemoteImage } from "@/modules/ui/image-with-fallback";

import {
	refreshUserAvatarAtom,
	updateUserPreferencesAtom,
	userSettingsAtom,
	userSettingsReactivityKeys,
} from "./atoms";
import { PreferenceSettingsForm } from "./preference-settings-form";

const THEME_OPTIONS = [
	{ icon: "sun", label: "Light", value: "light" },
	{ icon: "moon", label: "Dark", value: "dark" },
	{ icon: "monitor", label: "System", value: "system" },
] as const;

function SettingsSection(props: { title: string; detail: string; children: ReactNode }) {
	return (
		<View className="gap-3">
			<View className="gap-0.5 px-1">
				<Text className="font-ui-semibold text-base text-text">{props.title}</Text>
				<Text className="font-ui text-sm text-text-muted">{props.detail}</Text>
			</View>
			{props.children}
		</View>
	);
}

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

function ProfileSettings(props: { id: string; image: string | null; name: string; email: string }) {
	const scope = useApiScope();
	const authClient = useAuthClient();
	const { refetch: refetchSession } = authClient.useSession();
	const refreshAvatar = useAtomSet(refreshUserAvatarAtom(scope), { mode: "promiseExit" });
	const [image, setImage] = useState(props.image);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<unknown>();
	useInternalRequestFailureLogging("user avatar refresh failed", failure);
	useEffect(() => setImage(props.image), [props.image]);

	async function handleRefresh() {
		setPending(true);
		setFailure(undefined);
		const result = await refreshAvatar({ reactivityKeys: userSettingsReactivityKeys(scope) });
		setPending(false);
		if (Exit.isFailure(result)) {
			setFailure(result.cause);
			return;
		}
		setImage(result.value.image);
		await refetchSession();
	}

	return (
		<SettingsSection title="Profile" detail="Your identity across this Ryot server.">
			<View className="gap-3 rounded-xl border border-border bg-surface p-4">
				<View className="gap-4 sm:flex-row sm:items-center">
					<View className="flex-row items-center gap-3 sm:flex-1">
						{image === null ? (
							<View className="h-16 w-16 items-center justify-center rounded-full bg-surface-2">
								<AppIcon name="user" size={30} className="text-text-subtle" />
							</View>
						) : (
							<RemoteImage key={image} url={image} className="h-16 w-16 rounded-full" />
						)}
						<View className="min-w-0 flex-1 gap-0.5">
							<Text numberOfLines={1} className="font-ui-semibold text-base text-text">
								{props.name}
							</Text>
							<Text numberOfLines={1} className="font-ui text-sm text-text-muted">
								{props.email}
							</Text>
							<Text selectable className="font-ui text-xs text-text-subtle">
								ID: {props.id}
							</Text>
						</View>
					</View>
					<Pressable
						disabled={pending}
						accessibilityRole="button"
						onPress={() => void handleRefresh()}
						accessibilityLabel="Generate a new profile avatar"
						className={clsx(
							"h-10 flex-row items-center justify-center gap-2 rounded-lg border border-border-strong px-3",
							pending && "opacity-60",
						)}
					>
						{pending ? (
							<ActivityIndicator size="small" accessibilityLabel="Generating avatar" />
						) : (
							<AppIcon name="rotate-ccw" size={15} className="text-text-muted" />
						)}
						<Text className="font-ui-medium text-sm text-text">
							{pending ? "Generating..." : "New avatar"}
						</Text>
					</Pressable>
				</View>
				{failure === undefined ? null : (
					<Text className="font-ui text-xs text-danger">
						Could not generate a new avatar. Try again.
					</Text>
				)}
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

function AccountSettings() {
	const client = useAuthClient();
	const [pending, setPending] = useState(false);

	async function handleSignOut() {
		setPending(true);
		await client.signOut();
		router.replace("/auth");
	}

	return (
		<SettingsSection title="Account" detail="Manage your current session.">
			<Pressable
				disabled={pending}
				accessibilityRole="button"
				accessibilityLabel="Sign out"
				onPress={() => void handleSignOut()}
				className={clsx(
					"h-12 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4",
					pending && "opacity-60",
				)}
			>
				<AppIcon size={18} name="logout" className="text-danger" />
				<Text className="flex-1 font-ui-medium text-sm text-danger">
					{pending ? "Signing out..." : "Sign out"}
				</Text>
			</Pressable>
		</SettingsSection>
	);
}

export function UserSettingsScreen() {
	const scope = useApiScope();
	const settingsAtom = userSettingsAtom(scope);
	const settings = useAtomValue(settingsAtom);
	const refresh = useAtomRefresh(settingsAtom);
	const failure = AsyncResult.isFailure(settings) ? settings.cause : undefined;
	useInternalRequestFailureLogging("user settings query failed", failure);

	if (settings.waiting && !AsyncResult.isSuccess(settings)) {
		return (
			<View className="items-center gap-2 py-16">
				<ActivityIndicator accessibilityLabel="Loading settings" />
				<Text className="font-ui text-sm text-text-muted">Loading your settings...</Text>
			</View>
		);
	}
	if (AsyncResult.isFailure(settings)) {
		return (
			<View className="items-center gap-3 rounded-xl border border-border bg-surface p-6">
				<Text className="text-center font-ui text-sm text-danger">
					Could not load your settings. Check the server and try again.
				</Text>
				<Pressable
					onPress={refresh}
					accessibilityRole="button"
					className="rounded-lg border border-border-strong px-4 py-2"
				>
					<Text className="font-ui-medium text-sm text-text">Retry</Text>
				</Pressable>
			</View>
		);
	}
	if (!AsyncResult.isSuccess(settings)) {
		return null;
	}

	return (
		<View className="w-full max-w-2xl gap-8 self-center pb-4">
			<ProfileSettings
				id={settings.value.id}
				name={settings.value.name}
				email={settings.value.email}
				image={settings.value.image}
			/>
			<ThemeSettings />
			<PreferenceSettings preferences={settings.value.preferences} />
			<AccountSettings />
		</View>
	);
}
