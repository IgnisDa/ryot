import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { UserSettings } from "@ryot-app/contract/modules/user-settings/schemas";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { AppButton } from "@/modules/ui/button";
import { AppStatusState } from "@/modules/ui/status-state";

import { userSettingsAtom } from "./atoms";

export function SettingsSection(props: {
	readonly title: string;
	readonly detail: string;
	readonly children: ReactNode;
}) {
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

export function UserSettingsContainer(props: {
	readonly children: (settings: UserSettings) => ReactNode;
}) {
	const scope = useApiScope();
	const settingsAtom = userSettingsAtom(scope);
	const settings = useAtomValue(settingsAtom);
	const refresh = useAtomRefresh(settingsAtom);
	const failure = AsyncResult.isFailure(settings) ? settings.cause : undefined;
	useInternalRequestFailureLogging("user settings query failed", failure);

	if (settings.waiting && !AsyncResult.isSuccess(settings)) {
		return (
			<AppStatusState
				className="py-16"
				detail="Loading your settings..."
				icon={<ActivityIndicator accessibilityLabel="Loading settings" />}
			/>
		);
	}
	if (AsyncResult.isFailure(settings)) {
		return (
			<AppStatusState
				detailTone="danger"
				action={<AppButton label="Retry" onPress={refresh} />}
				className="rounded-xl border border-border bg-surface p-6"
				detail="Could not load your settings. Check the server and try again."
			/>
		);
	}
	if (!AsyncResult.isSuccess(settings)) {
		return null;
	}

	return (
		<View className="w-full max-w-2xl gap-8 self-center pb-4">
			{props.children(settings.value)}
		</View>
	);
}
