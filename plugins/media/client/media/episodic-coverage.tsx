import { useLocalMessage } from "@ryot-app/plugin-client-sdk/react";
import clsx from "clsx";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaMessages } from "../messages";
import type { MediaEpisodicCoverageRow } from "./episodic-activity-state";

export function MediaEpisodicCoverageStrip(props: {
	readonly rows: readonly MediaEpisodicCoverageRow[];
}) {
	const text = useMediaMessages();
	if (props.rows.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2.5">
			<p className="font-ui font-medium text-[11px] tracking-widest text-text-subtle uppercase">
				{text("coverage.title")}
			</p>
			<div className="flex flex-col gap-2">
				{props.rows.map((row) => (
					<MediaEpisodicCoverageBar row={row} key={row.key} />
				))}
			</div>
		</div>
	);
}

function MediaEpisodicCoverageBar(props: { readonly row: MediaEpisodicCoverageRow }) {
	const { row } = props;
	const text = useMediaMessages();
	const local = useLocalMessage(PLUGIN_PACKAGE_ID);
	return (
		<div className="flex h-4 items-center gap-3">
			<p className="w-16 font-ui text-[11.5px] text-text-muted">{local(row.label)}</p>
			<div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-2">
				<div
					style={{ width: `${row.percent ?? 0}%` }}
					className={clsx(
						"h-full rounded-pill",
						row.watched === row.total ? "bg-success" : "bg-accent",
					)}
				/>
			</div>
			<p className="w-14 text-right font-ui text-[11.5px] text-text-subtle tabular-nums">
				{text("coverage.ratio", { watched: row.watched, total: row.total ?? 0 })}
			</p>
		</div>
	);
}
