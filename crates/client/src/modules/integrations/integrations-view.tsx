import type { IntegrationSummary } from "@ryot/ryotql-recipes/integrations";
import clsx from "clsx";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { AppStatusState } from "@/modules/ui/status-state";

import {
	integrationStateLabel,
	integrationSyncLabel,
	integrationTitle,
} from "./integration-presentation";
import { integrationLotLabel } from "./provider-selection";
import { integrationListError, type IntegrationListState } from "./state";

const INTRO =
	"Keep Ryot in step with the services you already use. Integrations run on your own server, on a schedule or as events arrive.";

type ProviderNames = ReadonlyMap<string, string>;

function IntegrationRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly onPress: () => void;
	readonly providerNames: ProviderNames;
	readonly integration: IntegrationSummary;
}) {
	const title = integrationTitle(props.integration, props.providerNames);
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityLabel={`Open the ${title} integration`}
			className={clsx(
				"flex-row items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
				props.integration.isDisabled && "opacity-70",
			)}
		>
			<View className="min-w-0 flex-1 gap-0.5">
				<Text numberOfLines={1} className="font-ui-medium text-sm text-text">
					{title}
				</Text>
				<Text numberOfLines={1} className="font-ui text-xs text-text-subtle">
					{`${integrationStateLabel(props.integration)} · ${integrationSyncLabel(props.integration, props.nowMs)}`}
				</Text>
			</View>
			<Text className="rounded-pill border border-border-strong px-2 py-0.5 font-ui-medium text-[11px] text-text-muted">
				{integrationLotLabel(props.integration.lot)}
			</Text>
			<AppIcon size={16} name="chevron-right" className="text-text-subtle" />
		</Pressable>
	);
}

export function IntegrationsView(props: {
	readonly nowMs: number;
	readonly isSyncing: boolean;
	readonly onRetry: () => void;
	readonly onConnect: () => void;
	readonly onSyncAll: () => void;
	readonly syncSucceeded: boolean;
	readonly isLoadingMore: boolean;
	readonly onShowMore: () => void;
	readonly onOpenImports: () => void;
	readonly state: IntegrationListState;
	readonly providerNames: ProviderNames;
	readonly syncDetail: string | undefined;
	readonly onOpen: (integrationId: string) => void;
}) {
	if (props.state.status === "loading") {
		return (
			<AppStatusState
				className="py-16"
				detail="Loading your integrations..."
				icon={<ActivityIndicator accessibilityLabel="Loading integrations" />}
			/>
		);
	}
	if (props.state.status === "malformed" || props.state.status === "transport-error") {
		const error = integrationListError(props.state);
		return (
			<AppStatusState
				detailTone="danger"
				title={error.title}
				detail={error.detail}
				className="rounded-xl border border-border bg-surface p-6"
				action={<AppButton label="Try again" onPress={props.onRetry} />}
			/>
		);
	}
	const ready = props.state.status === "ready" ? props.state : undefined;
	const integrations = ready?.integrations ?? [];
	return (
		<View className="gap-6 pb-4">
			<Text className="font-ui text-sm leading-6 text-text-muted">{INTRO}</Text>
			{props.state.status === "empty" ? null : (
				<AppButton
					size="default"
					variant="primary"
					label="Connect a service"
					onPress={props.onConnect}
					className="w-full sm:w-auto sm:self-start sm:px-6"
					leading={<AppIcon size={16} name="plus" className="text-accent-ink" />}
				/>
			)}
			{props.state.status === "empty" ? (
				<AppStatusState
					className="py-12"
					title="No integrations yet"
					icon={<AppIcon size={40} name="globe" className="text-text-subtle" />}
					detail="Connect a service and Ryot keeps your library in step with it, without you having to do anything."
					action={
						<AppButton
							size="default"
							variant="primary"
							label="Connect a service"
							onPress={props.onConnect}
							className="w-full sm:w-auto sm:px-6"
						/>
					}
				/>
			) : (
				<View className="gap-2">
					<View className="flex-row items-center justify-between">
						<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
							Connected
						</Text>
						<AppButton
							size="compact"
							label="Sync all"
							variant="outline"
							onPress={props.onSyncAll}
							pending={props.isSyncing}
							pendingLabel="Syncing..."
							accessibilityLabel="Sync all integrations"
							leading={<AppIcon size={14} name="rotate-ccw" className="text-text" />}
						/>
					</View>
					{props.syncDetail === undefined ? null : (
						<Text
							accessibilityRole="alert"
							className={clsx(
								"font-ui text-sm",
								props.syncSucceeded ? "text-success" : "text-danger",
							)}
						>
							{props.syncDetail}
						</Text>
					)}
					<View>
						{integrations.map((integration, index) => (
							<IntegrationRow
								key={integration.id}
								isFirst={index === 0}
								integration={integration}
								nowMs={props.nowMs}
								providerNames={props.providerNames}
								onPress={() => props.onOpen(integration.id)}
							/>
						))}
					</View>
					{ready?.hasMore === true ? (
						<Pressable
							accessibilityRole="button"
							onPress={props.onShowMore}
							disabled={props.isLoadingMore}
							accessibilityLabel="Show more integrations"
							accessibilityState={{ disabled: props.isLoadingMore }}
							className={clsx("self-start py-2", props.isLoadingMore && "opacity-50")}
						>
							<Text className="font-ui-medium text-sm text-accent-text">
								{props.isLoadingMore ? "Loading more..." : "Show more integrations"}
							</Text>
						</Pressable>
					) : null}
				</View>
			)}
			<Pressable
				accessibilityRole="link"
				onPress={props.onOpenImports}
				className="flex-row items-center gap-1.5 self-start py-1"
				accessibilityLabel="Bringing over a one-off history? Import data"
			>
				<Text className="font-ui text-sm text-text-muted">Bringing over a one-off history?</Text>
				<Text className="font-ui-medium text-sm text-accent-text">Import data</Text>
				<AppIcon size={14} name="arrow-right" className="text-accent-text" />
			</Pressable>
		</View>
	);
}
