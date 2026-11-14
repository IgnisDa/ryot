import { SelectionBar } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { EntityIdsResult } from "@ryot-app/ryotql-recipes/browse";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import type { RyotClient } from "../client/client";
import type { RyotClientError } from "../client/errors";
import type { ViewFilter } from "../filters";
import { useRyot, useRyotSchedule } from "../queries/provider";
import {
	type EntitySelection,
	resolveSelection,
	selectedCount,
	type useEntitySelection,
} from "./selection";

export type BrowserSelectionInput = {
	readonly searchText: string;
	readonly filter: null | ViewFilter;
};

export type BrowserBulkAction = {
	readonly icon: string;
	readonly label: string;
	readonly danger?: boolean | undefined;
	readonly run: (
		entityIds: readonly [string, ...string[]],
	) => Effect.Effect<boolean, RyotClientError>;
};

export type BrowserSelectionSource = {
	readonly actions: readonly BrowserBulkAction[];
	readonly readIds: (
		client: RyotClient,
		input: BrowserSelectionInput & { readonly after: string | undefined },
	) => Effect.Effect<EntityIdsResult, Error>;
};

const extendAction = (input: {
	readonly hasMore: boolean;
	readonly selection: EntitySelection;
	readonly loadedIds: readonly string[];
	readonly onSelectMatching: () => void;
	readonly knownMatching: number | undefined;
	readonly selecting: ReturnType<typeof useEntitySelection>;
}) => {
	const { hasMore, selecting, loadedIds, knownMatching } = input;
	const allLoadedSelected = loadedIds.length > 0 && loadedIds.every(selecting.isSelected);
	if (input.selection.kind === "matching" || (allLoadedSelected && !hasMore)) {
		return { label: "Clear", run: selecting.clear };
	}
	if (hasMore) {
		return {
			run: () => {
				input.onSelectMatching();
				selecting.selectMatching();
			},
			label:
				knownMatching === undefined
					? "Select all matching"
					: `Select all ${knownMatching.toLocaleString()}`,
		};
	}
	return loadedIds.length === 0
		? undefined
		: {
				run: () => selecting.selectIds(loadedIds),
				label: `Select all ${loadedIds.length.toLocaleString()}`,
			};
};

export function BrowserSelectionBar({
	source,
	hasMore,
	controls,
	selection,
	selecting,
	loadedIds,
	knownMatching,
	safeAreaBottom,
	onSelectMatching,
}: {
	readonly hasMore: boolean;
	readonly safeAreaBottom: number;
	readonly selection: EntitySelection;
	readonly onSelectMatching: () => void;
	readonly loadedIds: readonly string[];
	readonly source: BrowserSelectionSource;
	readonly controls: BrowserSelectionInput;
	readonly knownMatching: number | undefined;
	readonly selecting: ReturnType<typeof useEntitySelection>;
}) {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const [status, setStatus] = useState<"failed" | "preparing">();
	const cancelRun = useRef<undefined | (() => void)>(undefined);
	useEffect(() => () => cancelRun.current?.(), []);
	const run = (action: BrowserBulkAction) => {
		setStatus("preparing");
		cancelRun.current = schedule.run(
			resolveSelection(selection, (after) => source.readIds(ryot, { ...controls, after })).pipe(
				Effect.tap(() => Effect.sync(() => setStatus(undefined))),
				Effect.flatMap(([first, ...rest]) =>
					first === undefined ? Effect.succeed(false) : action.run([first, ...rest]),
				),
				Effect.match({
					onFailure: () => setStatus("failed"),
					onSuccess: (completed) => {
						if (completed) {
							selecting.exit();
						}
					},
				}),
			),
			() => {
				cancelRun.current = undefined;
			},
		);
	};
	const chosen = selectedCount(selection, hasMore ? knownMatching : loadedIds.length);
	let label =
		chosen === undefined ? "All matching selected" : `${chosen.toLocaleString()} selected`;
	if (status === "failed") {
		label = "The selection could not be prepared.";
	}
	return (
		<SelectionBar
			label={label}
			disabled={chosen === 0}
			onExit={selecting.exit}
			safeAreaBottom={safeAreaBottom}
			busy={status === "preparing" ? "Preparing selection..." : undefined}
			extend={extendAction({
				hasMore,
				selection,
				selecting,
				loadedIds,
				knownMatching,
				onSelectMatching,
			})}
			actions={source.actions.map((action) => ({
				label: action.label,
				danger: action.danger,
				run: () => run(action),
				icon: <AppIcon size={15} name={action.icon} />,
			}))}
		/>
	);
}
