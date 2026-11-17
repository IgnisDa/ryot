import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { formatError } from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { IntegrationSummary } from "@ryot-app/ryotql-recipes/integrations";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import { DemoProtectionMessage } from "#/modules/demo-protection";
import {
	type IntegrationProviderNames,
	integrationStateLabel,
	integrationSyncLabel,
	integrationTitle,
} from "#/modules/integrations/presentation";
import { integrationLotLabel } from "#/modules/integrations/provider-selection";
import { PreferenceRow } from "#/modules/settings/preferences-form";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { StatusState } from "#/modules/ui/status-state";

export type IntegrationPauseState = {
	readonly paused: boolean;
	readonly isSaving: boolean;
	readonly error: null | Error;
};

export type IntegrationListState =
	| { readonly status: "empty" }
	| { readonly status: "failed" }
	| {
			readonly status: "ready";
			readonly hasMore: boolean;
			readonly integrations: readonly IntegrationSummary[];
	  };

type IntegrationsViewProps = {
	readonly nowMs: number;
	readonly isSyncing: boolean;
	readonly readOnly?: boolean;
	readonly onRetry: () => void;
	readonly isFetching?: boolean;
	readonly onConnect: () => void;
	readonly onSyncAll: () => void;
	readonly syncSucceeded: boolean;
	readonly onShowMore: () => void;
	readonly isFetchingNextPage: boolean;
	readonly state: IntegrationListState;
	readonly syncDetail: string | undefined;
	readonly providerNames: IntegrationProviderNames;
	readonly pause: undefined | IntegrationPauseState;
	readonly onPauseChange: (paused: boolean) => void;
};

export function IntegrationsView(props: IntegrationsViewProps) {
	const t = useT();
	if (props.state.status === "failed") {
		return (
			<LoadErrorState
				onRetry={props.onRetry}
				title={t(kernelMessage("client.integrations.list.load-failed-title"))}
				detail={t(kernelMessage("client.integrations.list.load-failed-detail"))}
			/>
		);
	}
	const ready = props.state.status === "ready" ? props.state : undefined;
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">
				{t(kernelMessage("client.integrations.list.intro"))}
			</p>
			{props.readOnly === true && <DemoProtectionMessage />}
			{props.pause === undefined ? null : (
				<PauseIntegrations
					state={props.pause}
					onChange={props.onPauseChange}
					readOnly={props.readOnly === true}
				/>
			)}
			{ready === undefined ? null : (
				<Button
					type="button"
					variant="primary"
					onClick={props.onConnect}
					disabled={props.readOnly === true}
					className="flex w-full items-center justify-center gap-2 sm:w-auto sm:self-start sm:px-6"
				>
					<AppIcon size={16} name="plus" className="text-accent-ink" />
					{t(kernelMessage("client.integrations.wizard.title"))}
				</Button>
			)}
			{ready === undefined ? (
				<StatusState
					className="py-12"
					title={t(kernelMessage("client.integrations.list.empty-title"))}
					detail={t(kernelMessage("client.integrations.list.empty-detail"))}
					icon={<AppIcon size={40} name="globe" className="text-text-subtle" />}
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onConnect}
							disabled={props.readOnly === true}
							className="w-full sm:w-auto sm:px-6"
						>
							{t(kernelMessage("client.integrations.wizard.title"))}
						</Button>
					}
				/>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
							{t(kernelMessage("client.integrations.list.connected"))}
						</span>
						<Button
							type="button"
							variant="secondary"
							onClick={props.onSyncAll}
							disabled={props.readOnly === true || props.isSyncing}
							className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
							aria-label={t(kernelMessage("client.integrations.list.sync-all-label"))}
						>
							<AppIcon size={14} name="rotate-ccw" className="text-text" />
							{t(
								props.isSyncing
									? kernelMessage("client.integrations.list.syncing")
									: kernelMessage("client.integrations.list.sync-all"),
							)}
						</Button>
					</div>
					{props.syncDetail === undefined ? null : (
						<StatusMessage className="text-sm" tone={props.syncSucceeded ? "success" : "error"}>
							{props.syncDetail}
						</StatusMessage>
					)}
					<div>
						{ready.integrations.map((integration, index) => (
							<IntegrationRow
								nowMs={props.nowMs}
								key={integration.id}
								isFirst={index === 0}
								integration={integration}
								providerNames={props.providerNames}
							/>
						))}
					</div>
					{ready.hasMore ? (
						<LoadMoreButton
							type="button"
							variant="ghost"
							onClick={props.onShowMore}
							disabled={props.isFetching}
							isFetchingNextPage={props.isFetchingNextPage}
							label={t(kernelMessage("client.integrations.list.show-more"))}
							className="self-start py-2 text-sm font-medium text-accent-text"
							aria-label={t(kernelMessage("client.integrations.list.show-more"))}
						/>
					) : null}
				</div>
			)}
			<Link
				to="/settings/import-data"
				search={{ start: undefined }}
				className="flex items-center gap-1.5 self-start py-1 text-sm"
				aria-label={t(kernelMessage("client.integrations.list.import-link"))}
			>
				<span className="text-text-muted">
					{t(kernelMessage("client.integrations.list.import-prompt"))}
				</span>
				<span className="font-medium text-accent-text">
					{t(kernelMessage("client.settings.section.import-data"))}
				</span>
				<AppIcon size={14} name="arrow-right" className="text-accent-text" />
			</Link>
		</div>
	);
}

function PauseIntegrations(props: {
	readonly readOnly: boolean;
	readonly state: IntegrationPauseState;
	readonly onChange: (paused: boolean) => void;
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-2">
			<div className="rounded-xl border border-border bg-surface">
				<PreferenceRow
					onChange={props.onChange}
					checked={props.state.paused}
					disabled={props.readOnly || props.state.isSaving}
					title={t(kernelMessage("client.integrations.list.pause-title"))}
					detail={t(kernelMessage("client.integrations.list.pause-detail"))}
				/>
			</div>
			{props.state.error !== null && (
				<StatusMessage tone="error" className="text-sm">
					{formatError(
						t,
						props.state.error,
						kernelMessage("client.integrations.list.pause-failed"),
					)}
				</StatusMessage>
			)}
		</div>
	);
}

function IntegrationRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly integration: IntegrationSummary;
	readonly providerNames: IntegrationProviderNames;
}) {
	const t = useT();
	const formatters = useFormatters();
	const title = integrationTitle(props.integration, props.providerNames);
	return (
		<Link
			to="/settings/integrations/$integrationId"
			params={{ integrationId: props.integration.id }}
			aria-label={t(kernelMessage("client.integrations.list.open", { title }))}
			className={clsx(
				"flex items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
				props.integration.isDisabled && "opacity-70",
			)}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-text">{title}</span>
				<span className="truncate text-xs text-text-subtle">
					{t(
						kernelMessage("client.integrations.row-detail", {
							state: integrationStateLabel(props.integration),
							sync: integrationSyncLabel(formatters, t, props.integration, props.nowMs),
						}),
					)}
				</span>
			</span>
			<span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-text-muted">
				{t(integrationLotLabel(props.integration.lot))}
			</span>
			<AppIcon size={16} name="chevron-right" className="shrink-0 text-text-subtle" />
		</Link>
	);
}
