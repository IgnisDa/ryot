import {
	type RyotQuery,
	type RyotQueryResult,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import clsx from "clsx";
import { type ReactNode, useState } from "react";

import { MediaHistoryButton } from "./activity-history";
import { MediaLogActivityButton } from "./activity-log/button";
import type { MediaActivityLogger } from "./activity-log/state";
import {
	type MediaActivityFigure,
	type MediaActivityRowRender,
	MediaActivitySummaryFigures,
	MediaActivityTimelineView,
} from "./activity-rows";
import {
	mapMediaActivity,
	mediaActivityError,
	type MediaActivityRowBase,
	type MediaActivityState,
	type MediaActivityTimeline,
} from "./activity-timeline";
import type { MediaCursorPage } from "./cursor-page-state";
import { MediaRefreshStatus, MediaStatusMessage } from "./primitives";
import { MediaReviewButton } from "./review";

export type MediaActivityCopy = {
	readonly recordLabel: string;
	readonly emptyDetail: string;
	readonly loadingDetail: string;
};

export type MediaActivityEmptyAction = MediaActivityLogger | "write-review";

function MediaActivityFooter(props: { readonly partial: boolean; readonly history?: ReactNode }) {
	if (!props.partial && !props.history) {
		return null;
	}
	return (
		<div className="flex flex-col items-start gap-2 border-t border-border pt-4">
			{props.partial ? (
				<p className="font-ui text-[12px] text-text-subtle">
					Only your most recent activity is shown here.
				</p>
			) : null}
			{props.history}
		</div>
	);
}

function MediaActivityEmpty(props: {
	readonly detail: string;
	readonly compact: boolean;
	readonly entityId: string;
	readonly action: MediaActivityEmptyAction;
	readonly onOpenChange: (open: boolean) => void;
}) {
	return (
		<div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6">
			<p className="text-center font-ui font-medium text-base text-text">No activity yet</p>
			<p className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</p>
			{props.action === "write-review" ? (
				<MediaReviewButton link entityId={props.entityId} />
			) : (
				<MediaLogActivityButton
					link
					logger={props.action}
					compact={props.compact}
					entityId={props.entityId}
					onOpenChange={props.onOpenChange}
				/>
			)}
		</div>
	);
}

export function MediaActivityRecord<Row extends MediaActivityRowBase>(props: {
	readonly compact: boolean;
	readonly partial: boolean;
	readonly aside?: ReactNode;
	readonly history?: ReactNode;
	readonly recordLabel: string;
	readonly render: MediaActivityRowRender<Row>;
	readonly timeline: MediaActivityTimeline<Row>;
	readonly figures: readonly MediaActivityFigure[];
}) {
	const { compact } = props;
	return (
		<div
			className={clsx(
				"flex gap-6",
				compact ? "flex-col pt-6" : "flex-row justify-center gap-10 pt-8",
			)}
		>
			<div className={clsx("flex flex-col gap-5", !compact && "w-72 shrink-0")}>
				<MediaActivitySummaryFigures compact={compact} figures={props.figures} />
				{props.aside}
			</div>
			<div
				role="list"
				aria-label={props.recordLabel}
				className={clsx("flex min-w-0 flex-col gap-5", !compact && "max-w-2xl flex-1")}
			>
				<MediaActivityTimelineView render={props.render} timeline={props.timeline} />
				<MediaActivityFooter partial={props.partial} history={props.history} />
			</div>
		</div>
	);
}

export function MediaActivity<View>(props: {
	readonly entityId: string;
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly copy: MediaActivityCopy;
	readonly state: MediaActivityState<View>;
	readonly emptyAction: MediaActivityEmptyAction;
	readonly history?: ReactNode;
	readonly Record: (input: {
		readonly view: View;
		readonly compact: boolean;
		readonly history?: ReactNode;
	}) => ReactNode;
}) {
	const { state } = props;
	const [logging, setLogging] = useState(false);
	if (state.status === "empty" || logging) {
		return (
			<MediaActivityEmpty
				compact={props.compact}
				entityId={props.entityId}
				onOpenChange={setLogging}
				action={props.emptyAction}
				detail={props.copy.emptyDetail}
			/>
		);
	}
	if (state.status === "loading") {
		return <MediaStatusMessage title="Loading activity..." detail={props.copy.loadingDetail} />;
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...mediaActivityError(state)} onRetry={props.refresh} />;
	}
	return <props.Record view={state.view} compact={props.compact} history={props.history} />;
}

/** The activity state mapper, its screen, and the tab that loads it for one entity. */
export const defineMediaActivityTab = <Result, View, Event>(input: {
	readonly copy: MediaActivityCopy;
	readonly emptyAction: MediaActivityEmptyAction;
	readonly view: (result: Result) => View | undefined;
	readonly hasMoreActivities: (result: Result) => boolean;
	readonly renderHistory: (items: readonly Event[]) => ReactNode;
	readonly query: RyotQuery<{ readonly entityId: string }, Result>;
	readonly historyQuery: RyotQuery<
		{ readonly entityId: string; readonly after: string | null },
		MediaCursorPage<Event>
	>;
	readonly Record: (props: {
		readonly view: View;
		readonly compact: boolean;
		readonly history?: ReactNode;
	}) => ReactNode;
}) => {
	const mapActivity = (result: RyotQueryResult<Result>) => mapMediaActivity(result, input.view);

	function Activity(props: {
		readonly entityId: string;
		readonly compact: boolean;
		readonly refresh: () => void;
		readonly history?: ReactNode;
		readonly state: MediaActivityState<View>;
	}) {
		return (
			<MediaActivity
				copy={input.copy}
				state={props.state}
				Record={input.Record}
				history={props.history}
				compact={props.compact}
				refresh={props.refresh}
				entityId={props.entityId}
				emptyAction={input.emptyAction}
			/>
		);
	}

	function ActivityTab(props: {
		readonly compact: boolean;
		readonly entityId: string;
		readonly safeAreaTop: number;
	}) {
		const result = useRyotQuery(input.query, { entityId: props.entityId });
		const history =
			result.data !== undefined && input.hasMoreActivities(result.data) ? (
				<MediaHistoryButton
					key={props.entityId}
					compact={props.compact}
					entityId={props.entityId}
					query={input.historyQuery}
					safeAreaTop={props.safeAreaTop}
					renderPage={input.renderHistory}
				/>
			) : null;
		return (
			<>
				<MediaRefreshStatus result={result} />
				<Activity
					history={history}
					compact={props.compact}
					refresh={result.refetch}
					entityId={props.entityId}
					state={mapActivity(result)}
				/>
			</>
		);
	}

	return { Activity, ActivityTab, mapActivity };
};
