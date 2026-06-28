import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import type { IntegrationSummary } from "@ryot-app/ryotql-recipes/integrations";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import {
	integrationStateLabel,
	integrationSyncLabel,
	integrationTitle,
	type IntegrationProviderNames,
} from "#/modules/integrations/presentation";
import { integrationLotLabel } from "#/modules/integrations/provider-selection";
import { AppIcon } from "#/modules/navigation/app-icon";
import { StatusState } from "#/modules/ui/status-state";

const INTRO =
	"Keep Ryot in step with the services you already use. Integrations run on your own server, on a schedule or as events arrive.";

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
	readonly onRetry: () => void;
	readonly onConnect: () => void;
	readonly onSyncAll: () => void;
	readonly syncSucceeded: boolean;
	readonly isLoadingMore: boolean;
	readonly onShowMore: () => void;
	readonly state: IntegrationListState;
	readonly syncDetail: string | undefined;
	readonly providerNames: IntegrationProviderNames;
};

function IntegrationRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly integration: IntegrationSummary;
	readonly providerNames: IntegrationProviderNames;
}) {
	const title = integrationTitle(props.integration, props.providerNames);
	return (
		<Link
			to="/settings/integrations/$integrationId"
			params={{ integrationId: props.integration.id }}
			aria-label={`Open the ${title} integration`}
			className={clsx(
				"flex items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
				props.integration.isDisabled && "opacity-70",
			)}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-text">{title}</span>
				<span className="truncate text-xs text-text-subtle">
					{`${integrationStateLabel(props.integration)} · ${integrationSyncLabel(props.integration, props.nowMs)}`}
				</span>
			</span>
			<span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-text-muted">
				{integrationLotLabel(props.integration.lot)}
			</span>
			<AppIcon size={16} name="chevron-right" className="shrink-0 text-text-subtle" />
		</Link>
	);
}

export function IntegrationsView(props: IntegrationsViewProps) {
	if (props.state.status === "failed") {
		return (
			<StatusState
				detailTone="danger"
				title="Unable to load integrations"
				className="rounded-xl border border-border bg-surface p-6"
				detail="Your integrations could not be loaded. Check the server and try again."
				action={
					<Button type="button" variant="secondary" onClick={props.onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}
	const ready = props.state.status === "ready" ? props.state : undefined;
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">{INTRO}</p>
			{ready === undefined ? null : (
				<Button
					type="button"
					variant="primary"
					onClick={props.onConnect}
					className="flex w-full items-center justify-center gap-2 sm:w-auto sm:self-start sm:px-6"
				>
					<AppIcon size={16} name="plus" className="text-accent-ink" />
					Connect a service
				</Button>
			)}
			{ready === undefined ? (
				<StatusState
					className="py-12"
					title="No integrations yet"
					icon={<AppIcon size={40} name="globe" className="text-text-subtle" />}
					detail="Connect a service and Ryot keeps your library in step with it, without you having to do anything."
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onConnect}
							className="w-full sm:w-auto sm:px-6"
						>
							Connect a service
						</Button>
					}
				/>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
							Connected
						</span>
						<Button
							type="button"
							variant="secondary"
							disabled={props.isSyncing}
							onClick={props.onSyncAll}
							aria-label="Sync all integrations"
							className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
						>
							<AppIcon size={14} name="rotate-ccw" className="text-text" />
							{props.isSyncing ? "Syncing..." : "Sync all"}
						</Button>
					</div>
					{props.syncDetail === undefined ? null : (
						<StatusMessage tone={props.syncSucceeded ? "success" : "error"} className="text-sm">
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
						<button
							type="button"
							onClick={props.onShowMore}
							disabled={props.isLoadingMore}
							aria-label="Show more integrations"
							className={clsx(
								"self-start py-2 text-sm font-medium text-accent-text",
								props.isLoadingMore && "opacity-50",
							)}
						>
							{props.isLoadingMore ? "Loading more..." : "Show more integrations"}
						</button>
					) : null}
				</div>
			)}
			<Link
				to="/settings/import-data"
				search={{ start: undefined }}
				aria-label="Bringing over a one-off history? Import data"
				className="flex items-center gap-1.5 self-start py-1 text-sm"
			>
				<span className="text-text-muted">Bringing over a one-off history?</span>
				<span className="font-medium text-accent-text">Import data</span>
				<AppIcon size={14} name="arrow-right" className="text-accent-text" />
			</Link>
		</div>
	);
}
