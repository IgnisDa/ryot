import { useAtomSet } from "@effect/atom-react";
import clsx from "clsx";
import { Exit } from "effect";
import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useAuthClient } from "@/modules/auth/client";
import { AppIcon } from "@/modules/icons";
import { AppAvatar } from "@/modules/ui/avatar";
import { AppButton } from "@/modules/ui/button";

import { refreshUserAvatarAtom, userSettingsReactivityKeys } from "./atoms";
import { SettingsSection, UserSettingsContainer } from "./user-settings-container";

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
						<AppAvatar className="h-16 w-16 rounded-full" iconSize={30} url={image} />
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
					<AppButton
						pending={pending}
						label="New avatar"
						pendingLabel="Generating..."
						onPress={() => void handleRefresh()}
						accessibilityLabel="Generate a new profile avatar"
						leading={
							pending ? (
								<ActivityIndicator size="small" accessibilityLabel="Generating avatar" />
							) : (
								<AppIcon name="rotate-ccw" size={15} className="text-text-muted" />
							)
						}
					/>
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

function ServerAdministration() {
	return (
		<SettingsSection
			title="Server administration"
			detail="Manage every account on this server. Requires the admin access token."
		>
			<Link asChild href="/god-mode">
				<Pressable
					accessibilityRole="link"
					accessibilityLabel="Open god mode"
					className="h-12 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 focus-visible:outline-2 focus-visible:outline-accent"
				>
					<AppIcon size={18} name="users" className="text-text-muted" />
					<Text className="flex-1 font-ui-medium text-sm text-text">God mode</Text>
					<AppIcon size={15} name="chevron-right" className="text-text-subtle" />
				</Pressable>
			</Link>
		</SettingsSection>
	);
}

function SessionSettings() {
	const client = useAuthClient();
	const [pending, setPending] = useState(false);

	async function handleSignOut() {
		setPending(true);
		await client.signOut();
		router.replace("/auth");
	}

	return (
		<SettingsSection title="Session" detail="Manage your current session.">
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

export function AccountScreen() {
	return (
		<UserSettingsContainer>
			{(settings) => (
				<>
					<ProfileSettings
						id={settings.id}
						name={settings.name}
						email={settings.email}
						image={settings.image}
					/>
					<ServerAdministration />
					<SessionSettings />
				</>
			)}
		</UserSettingsContainer>
	);
}
