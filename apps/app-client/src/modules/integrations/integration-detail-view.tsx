import type {
	ListedIntegration,
	ListedIntegrationProvider,
} from "@ryot/contract/modules/integrations/schemas";
import type { ImportRunSummary } from "@ryot/ryotql-recipes/import-runs";
import clsx from "clsx";
import { ActivityIndicator, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { importRunOutcomeLabel } from "@/modules/imports/run-presentation";
import { AppButton } from "@/modules/ui/button";
import { FormMessage } from "@/modules/ui/form";
import { formatRelativeTime } from "@/modules/ui/run/run-status";
import { RunStatusGlyph } from "@/modules/ui/run/run-status-pill";
import type { SchemaFileUpload } from "@/modules/ui/schema-form/file/file-upload";
import type { SchemaFormApi } from "@/modules/ui/schema-form/schema-form";
import { AppStatusState } from "@/modules/ui/status-state";

import { IntegrationSettingsForm } from "./integration-settings-form";
import { integrationLotDetail } from "./provider-selection";
import { integrationDetailError, type IntegrationDetailState } from "./state";

function IntegrationWebhookRow(props: {
	readonly webhookUrl: string;
	readonly onCopy: (value: string) => void;
}) {
	return (
		<View className="gap-2 rounded-lg border border-border bg-surface p-3">
			<Text className="font-ui-medium text-xs text-text-muted">Webhook URL</Text>
			<Text selectable className="font-mono text-xs leading-5 text-text">
				{props.webhookUrl}
			</Text>
			<AppButton
				size="compact"
				className="self-start"
				label="Copy webhook URL"
				onPress={() => props.onCopy(props.webhookUrl)}
				leading={<AppIcon size={14} name="clipboard-list" className="text-text-muted" />}
			/>
		</View>
	);
}

function IntegrationRunRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly run: ImportRunSummary;
}) {
	return (
		<View
			className={clsx(
				"flex-row items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
			)}
		>
			<RunStatusGlyph status={props.run.status} />
			<Text numberOfLines={1} className="min-w-0 flex-1 font-ui text-xs text-text-subtle">
				{formatRelativeTime(props.run.createdAt, props.nowMs)}
			</Text>
			<Text
				numberOfLines={2}
				className="max-w-40 text-right font-ui text-xs tabular-nums text-text-muted"
			>
				{importRunOutcomeLabel(props.run)}
			</Text>
		</View>
	);
}

export function IntegrationDetailView(props: {
	readonly nowMs: number;
	readonly saving: boolean;
	readonly onSave: () => void;
	readonly onRetry: () => void;
	readonly form: SchemaFormApi;
	readonly uploadFile: SchemaFileUpload;
	readonly state: IntegrationDetailState;
	readonly saveDetail: string | undefined;
	readonly onCopy: (value: string) => void;
	readonly runs: readonly ImportRunSummary[];
	readonly provider: ListedIntegrationProvider | undefined;
}) {
	if (props.state.status === "loading") {
		return (
			<AppStatusState
				className="py-16"
				detail="Loading this integration..."
				icon={<ActivityIndicator accessibilityLabel="Loading integration" />}
			/>
		);
	}
	if (props.state.status === "malformed" || props.state.status === "transport-error") {
		const error = integrationDetailError(props.state);
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
	if (props.state.status === "not-found") {
		return (
			<AppStatusState
				className="py-16"
				title="Integration not found"
				detail="This integration may have been deleted from another device."
				icon={<AppIcon size={36} name="search-x" className="text-text-subtle" />}
			/>
		);
	}

	const integration: ListedIntegration = props.state.integration;
	return (
		<View className="gap-6 pb-4">
			{integration.webhookUrl === undefined ? (
				<Text className="font-ui text-sm leading-6 text-text-muted">
					{props.provider === undefined ? "" : integrationLotDetail(props.provider.lot)}
				</Text>
			) : (
				<IntegrationWebhookRow onCopy={props.onCopy} webhookUrl={integration.webhookUrl} />
			)}
			{props.provider === undefined ? (
				<Text className="font-ui text-sm text-text-muted">
					This service is no longer available on your server, so its settings cannot be edited.
				</Text>
			) : (
				<View className="gap-4">
					<IntegrationSettingsForm
						mode="edit"
						form={props.form}
						provider={props.provider}
						uploadFile={props.uploadFile}
					/>
					{props.saveDetail === undefined ? null : <FormMessage>{props.saveDetail}</FormMessage>}
					<AppButton
						size="default"
						variant="primary"
						label="Save changes"
						pending={props.saving}
						onPress={props.onSave}
						pendingLabel="Saving..."
						className="w-full sm:w-auto sm:self-start sm:px-6"
					/>
				</View>
			)}
			<View className="gap-2">
				<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
					Recent runs
				</Text>
				{props.runs.length === 0 ? (
					<Text className="font-ui text-sm text-text-muted">This integration has not run yet.</Text>
				) : (
					<View>
						{props.runs.map((run, index) => (
							<IntegrationRunRow run={run} key={run.id} nowMs={props.nowMs} isFirst={index === 0} />
						))}
					</View>
				)}
			</View>
		</View>
	);
}
