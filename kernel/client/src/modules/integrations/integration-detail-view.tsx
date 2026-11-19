import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useSchemaAssetUpload } from "@ryot-app/plugin-client-sdk/react";
import { Button, CopyField, FieldMessage, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import type {
	SchemaFileUpload,
	SchemaFormApi,
	SchemaOAuthConnect,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { toSchemaFormPayload } from "@ryot-app/plugin-ui-sdk/schema-form";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import { useShareAction } from "#/modules/device/share";
import { IngestionRunReport } from "#/modules/imports/ingestion-run-report";
import { importRunOutcomeLabel } from "#/modules/imports/run-presentation";
import { SelectedIntegrationReadiness } from "#/modules/imports/selected-readiness";
import { integrationLotDetail } from "#/modules/integrations/provider-selection";
import type {
	IntegrationClientDetail,
	IntegrationProviderItem,
} from "#/modules/integrations/service";
import { IntegrationSettingsForm } from "#/modules/integrations/settings-form";
import { formatRelativeTime } from "#/modules/ui/run/run-status";
import { RunStatusGlyph } from "#/modules/ui/run/run-status-pill";

export function IntegrationDetailView(props: {
	readonly nowMs: number;
	readonly saving: boolean;
	readonly onSave: () => void;
	readonly form: SchemaFormApi;
	readonly hasMoreRuns: boolean;
	readonly isFetchingRuns: boolean;
	readonly isFetchingNextRuns: boolean;
	readonly onShowOlderRuns: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly saveDetail: string | undefined;
	readonly connectOAuth: SchemaOAuthConnect;
	readonly runs: readonly ImportRunSummary[];
	readonly integration: IntegrationClientDetail;
	readonly oauthDisabledReason: Text | undefined;
	readonly provider: undefined | IntegrationProviderItem;
}) {
	const t = useT();
	const uploadAsset = useSchemaAssetUpload();
	const shareAction = useShareAction();
	return (
		<div className="flex flex-col gap-6 pb-4">
			{props.integration.webhookUrl === undefined ? (
				<p className="text-sm leading-6 text-text-muted">
					{props.provider === undefined ? "" : t(integrationLotDetail(props.provider.lot))}
				</p>
			) : (
				<CopyField
					value={props.integration.webhookUrl}
					action={shareAction({ url: props.integration.webhookUrl })}
					label={t(kernelMessage("client.integrations.detail.webhook-url"))}
				/>
			)}
			{props.integration.pluginId === null ? (
				<p className="text-sm leading-6 text-text-muted">
					{t(kernelMessage("client.integrations.detail.webhook-help"))}
				</p>
			) : null}
			{props.provider === undefined ? (
				<p className="text-sm text-text-muted">
					{t(kernelMessage("client.integrations.detail.provider-gone"))}
				</p>
			) : (
				<div className="flex flex-col gap-4">
					<IntegrationSettingsForm
						mode="edit"
						form={props.form}
						provider={props.provider}
						uploadAsset={uploadAsset}
						uploadFile={props.uploadFile}
						connectOAuth={props.connectOAuth}
						oauthDisabledReason={props.oauthDisabledReason}
					/>
					<props.form.Subscribe selector={(state) => state.values.fields}>
						{(values) =>
							props.provider === undefined ? null : (
								<SelectedIntegrationReadiness
									reference={props.provider.reference}
									integrationId={props.integration.id}
									settings={toSchemaFormPayload(props.provider.settingsSchema, values)}
								>
									{() => null}
								</SelectedIntegrationReadiness>
							)
						}
					</props.form.Subscribe>
					{props.saveDetail === undefined ? null : <FieldMessage>{props.saveDetail}</FieldMessage>}
					<Button
						type="button"
						variant="primary"
						onClick={props.onSave}
						disabled={props.saving}
						className="w-full sm:w-auto sm:self-start sm:px-6"
					>
						{t(
							props.saving
								? kernelMessage("common.status.saving")
								: kernelMessage("common.action.save-changes"),
						)}
					</Button>
				</div>
			)}
			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
					{t(kernelMessage("client.integrations.detail.recent-runs"))}
				</span>
				{props.runs.length === 0 ? (
					<p className="text-sm text-text-muted">
						{t(kernelMessage("client.integrations.detail.no-runs"))}
					</p>
				) : (
					<div>
						{props.runs.map((run, index) => (
							<IntegrationRunRow run={run} key={run.id} nowMs={props.nowMs} isFirst={index === 0} />
						))}
					</div>
				)}
				{props.hasMoreRuns ? (
					<LoadMoreButton
						type="button"
						variant="ghost"
						onClick={props.onShowOlderRuns}
						disabled={props.isFetchingRuns}
						isFetchingNextPage={props.isFetchingNextRuns}
						className="self-start py-2 text-sm font-medium text-accent-text"
						label={t(kernelMessage("client.integrations.detail.older-runs"))}
						aria-label={t(kernelMessage("client.integrations.detail.older-runs"))}
						loadingLabel={t(kernelMessage("client.integrations.detail.loading-older"))}
					/>
				) : null}
			</div>
		</div>
	);
}

function IntegrationRunRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly run: ImportRunSummary;
}) {
	const t = useT();
	const formatters = useFormatters();
	return (
		<div>
			<Link
				params={{ runId: props.run.id }}
				to="/settings/import-data/$runId"
				className={clsx(
					"flex items-center gap-3 border-b border-border py-3",
					props.isFirst && "border-t",
				)}
			>
				<RunStatusGlyph status={props.run.status} />
				<span className="min-w-0 flex-1 truncate text-xs text-text-subtle">
					{formatRelativeTime(formatters, t, props.run.createdAt, props.nowMs)}
				</span>
				<span className="max-w-40 text-right text-xs tabular-nums text-text-muted">
					{importRunOutcomeLabel(t, formatters, props.run)}
				</span>
			</Link>
			{props.run.status === "blocked" ||
			props.run.status === "running" ||
			props.run.status === "pending" ||
			props.run.status === "expired" ? (
				<IngestionRunReport run={props.run} />
			) : null}
		</div>
	);
}
