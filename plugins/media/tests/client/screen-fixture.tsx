import type { EntitySettleReason } from "@ryot-app/client-sdk";
import type { ReactNode } from "react";

import type { MediaOverviewState } from "../../client/media/overview-state";
import { mapMediaOverview } from "../../client/media/overview-state";
import type { MediaSummaryState } from "../../client/media/summary-state";
import { readyQueryResult } from "./query-result-fixture";
import { mountRyotClient } from "./test-support";

const noopAdapter = { query: () => Promise.resolve({}) };

type MediaScreenBody<Summary, Overview> = (props: {
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly activity: ReactNode;
	readonly refresh: () => void;
	readonly refreshOverview: () => void;
	readonly state: MediaSummaryState<Summary>;
	readonly overview: MediaOverviewState<Overview>;
	readonly settled: EntitySettleReason | undefined;
}) => ReactNode;

export const renderMediaScreenBody = <Summary, Overview>(
	schema: { readonly ScreenBody: MediaScreenBody<Summary, Overview> },
	summary: Summary,
	overview: Overview,
) =>
	mountRyotClient(
		noopAdapter,
		<schema.ScreenBody
			compact
			activity={null}
			safeAreaTop={0}
			settled={undefined}
			refresh={() => undefined}
			refreshOverview={() => undefined}
			state={{ summary, status: "ready" }}
			overview={mapMediaOverview(readyQueryResult(overview))}
		/>,
	);
