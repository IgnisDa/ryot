import clsx from "clsx";
import type { ReactNode } from "react";

import {
	MediaActivitySummaryFigures,
	MediaActivityTimelineView,
	type MediaActivityFigure,
	type MediaActivityRowRender,
} from "./activity-rows";
import {
	mediaActivityError,
	type MediaActivityRowBase,
	type MediaActivityTimeline,
} from "./activity-timeline";
import { MediaLinkButton, MediaStatusMessage } from "./primitives";
import type { MappedRyotQueryState } from "./query-state";

export type MediaActivityCopy = {
	readonly recordLabel: string;
	readonly emptyDetail: string;
	readonly loadingDetail: string;
};

export type MediaActivityState<View> = MappedRyotQueryState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly view: View }
>;

function MediaActivityFooter(props: { readonly partial: boolean }) {
	return (
		<div className="flex flex-col items-start gap-2 border-t border-border pt-4">
			{props.partial ? (
				<p className="font-ui text-[12px] text-text-subtle">
					Only your most recent activity is shown here.
				</p>
			) : null}
			<MediaLinkButton
				label="View complete history"
				onClick={() => console.log("TODO: open complete activity history")}
			/>
		</div>
	);
}

function MediaActivityEmpty(props: { readonly detail: string }) {
	return (
		<div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6">
			<p className="text-center font-ui font-medium text-base text-text">No activity yet</p>
			<p className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</p>
			<MediaLinkButton
				label="Log activity"
				onClick={() => console.log("TODO: open activity form")}
			/>
		</div>
	);
}

export function MediaActivityRecord<Row extends MediaActivityRowBase>(props: {
	readonly compact: boolean;
	readonly partial: boolean;
	readonly aside?: ReactNode;
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
				<MediaActivityFooter partial={props.partial} />
			</div>
		</div>
	);
}

export function MediaActivity<View>(props: {
	readonly compact: boolean;
	readonly refresh: () => void;
	readonly copy: MediaActivityCopy;
	readonly state: MediaActivityState<View>;
	readonly Record: (input: { readonly compact: boolean; readonly view: View }) => ReactNode;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return <MediaStatusMessage title="Loading activity..." detail={props.copy.loadingDetail} />;
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <MediaStatusMessage {...mediaActivityError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "empty") {
		return <MediaActivityEmpty detail={props.copy.emptyDetail} />;
	}
	return <props.Record view={state.view} compact={props.compact} />;
}
