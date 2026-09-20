import { Button, FieldMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type {
	SchemaFileUpload,
	SchemaFormApi,
	SchemaOAuthConnect,
} from "@ryot-app/client-ui-sdk/schema-form";
import { toSchemaFormPayload } from "@ryot-app/client-ui-sdk/schema-form";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

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

function IntegrationWebhookRow(props: {
	readonly webhookUrl: string;
	readonly onCopy: (value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
			<span className="text-xs font-medium text-text-muted">Webhook URL</span>
			<span className="font-mono text-xs leading-5 break-all text-text">{props.webhookUrl}</span>
			<Button
				type="button"
				variant="secondary"
				onClick={() => props.onCopy(props.webhookUrl)}
				className="flex min-h-9 items-center gap-1.5 self-start px-3 py-1.5 text-sm"
			>
				<AppIcon size={14} name="clipboard-list" className="text-text-muted" />
				Copy webhook URL
			</Button>
		</div>
	);
}

function IntegrationRunRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly run: ImportRunSummary;
}) {
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
					{formatRelativeTime(props.run.createdAt, props.nowMs)}
				</span>
				<span className="max-w-40 text-right text-xs tabular-nums text-text-muted">
					{importRunOutcomeLabel(props.run)}
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

export function IntegrationDetailView(props: {
	readonly nowMs: number;
	readonly saving: boolean;
	readonly onSave: () => void;
	readonly form: SchemaFormApi;
	readonly uploadFile: SchemaFileUpload;
	readonly saveDetail: string | undefined;
	readonly integration: IntegrationClientDetail;
	readonly onCopy: (value: string) => void;
	readonly runs: readonly ImportRunSummary[];
	readonly provider: IntegrationProviderItem | undefined;
	readonly connectOAuth: SchemaOAuthConnect;
	readonly oauthDisabledReason: string | undefined;
}) {
	return (
		<div className="flex flex-col gap-6 pb-4">
			{props.integration.webhookUrl === undefined ? (
				<p className="text-sm leading-6 text-text-muted">
					{props.provider === undefined ? "" : integrationLotDetail(props.provider.lot)}
				</p>
			) : (
				<IntegrationWebhookRow onCopy={props.onCopy} webhookUrl={props.integration.webhookUrl} />
			)}
			{props.integration.pluginSlug === null ? (
				<p className="text-sm leading-6 text-text-muted">
					Send a JSON data document with Content-Type: application/json and an Idempotency-Key
					header. Reuse the key only when retrying the same submission. A new key appends new
					records.
				</p>
			) : null}
			{props.provider === undefined ? (
				<p className="text-sm text-text-muted">
					This service is no longer available on your server, so its settings cannot be edited.
				</p>
			) : (
				<div className="flex flex-col gap-4">
					<IntegrationSettingsForm
						mode="edit"
						form={props.form}
						provider={props.provider}
						uploadFile={props.uploadFile}
						connectOAuth={props.connectOAuth}
						oauthDisabledReason={props.oauthDisabledReason}
					/>
					<props.form.Subscribe selector={(state) => state.values}>
						{(values) =>
							props.provider === undefined ? null : (
								<SelectedIntegrationReadiness
									slug={props.provider.slug}
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
						{props.saving ? "Saving..." : "Save changes"}
					</Button>
				</div>
			)}
			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
					Recent runs
				</span>
				{props.runs.length === 0 ? (
					<p className="text-sm text-text-muted">This integration has not run yet.</p>
				) : (
					<div>
						{props.runs.map((run, index) => (
							<IntegrationRunRow run={run} key={run.id} nowMs={props.nowMs} isFirst={index === 0} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
