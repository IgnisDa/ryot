import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";

import { ComputedResults } from "../workout-processing";
import {
	buildMuscleTiles,
	buildPersonalBests,
	type MuscleBand,
	muscleBands,
	RECENT_DAYS,
} from "./model";
import { muscleActivityQuery, recentPersonalBestsQuery } from "./queries";
import { HomeSection, QueryBody } from "./section";

const bandClasses: Readonly<Record<MuscleBand, string>> = {
	cold: "bg-surface-2 text-text",
	fresh: "bg-chart-seq-3 text-text",
	stale: "bg-chart-seq-2 text-text",
	recent: "bg-chart-seq-5 text-accent-ink",
};

export function MusclesSection(props: { readonly now: Date; readonly timeZone: string }) {
	const { now, timeZone } = props;
	const result = useRyotQuery(muscleActivityQuery);
	return (
		<HomeSection
			title="Muscles"
			id="muscles-heading"
			hint="Days since last trained · sets in the last 7 days"
			link={
				<span
					aria-hidden="true"
					className="flex items-center gap-1.5 text-[11.5px] text-text-subtle"
				>
					Longer ago
					{muscleBands.map((band) => (
						<span key={band} className={clsx("size-3 rounded-xs", bandClasses[band])} />
					))}
					Recent
				</span>
			}
		>
			<QueryBody result={result} noun="muscle activity">
				{(activity) => (
					<>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
							{buildMuscleTiles(activity, now, timeZone).map((tile) => (
								<div
									key={tile.id}
									className={clsx(
										"flex flex-col gap-0.5 rounded-lg px-3 py-2",
										bandClasses[tile.band],
									)}
								>
									<span className="truncate text-[12.5px] font-medium">{tile.name}</span>
									<span className="text-[18px] leading-tight font-semibold tabular-nums">
										{tile.days}
									</span>
									<span className="text-[11.5px] opacity-80">{tile.sets}</span>
								</div>
							))}
						</div>
						<p className="text-[12px] text-text-subtle">
							From logged sets. A set counts 1 toward primary targets and ½ toward secondary;
							stabilizers excluded.
						</p>
					</>
				)}
			</QueryBody>
		</HomeSection>
	);
}

export function PersonalBestsSection(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly imperial: boolean;
}) {
	const { now, imperial, timeZone } = props;
	const result = useRyotQuery(recentPersonalBestsQuery);
	return (
		<ComputedResults>
			<HomeSection
				id="prs-heading"
				title="Recent personal bests"
				hint={
					result.data === undefined
						? undefined
						: `${result.data.recentCount} in the last ${RECENT_DAYS} days`
				}
			>
				<QueryBody result={result} noun="personal bests">
					{(data) =>
						data.items.length === 0 ? (
							<p className="text-[13px] text-text-muted">
								Personal bests appear here as soon as you set one.
							</p>
						) : (
							<div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
								{buildPersonalBests({ now, imperial, timeZone, items: data.items }).map((row) => (
									<PluginLink
										key={row.id}
										to={{ kind: "entity", entityId: row.exerciseId }}
										className="flex items-center justify-between gap-3 px-4 py-3"
									>
										<span className="flex min-w-0 items-center gap-3">
											<span
												aria-hidden="true"
												className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text"
											>
												<AppIcon size={14} name="star" />
											</span>
											<span className="flex min-w-0 flex-col">
												<span className="truncate text-[14px] font-medium text-text">
													{row.name}
												</span>
												<span className="text-[12px] text-text-muted">
													{row.badge} · {row.when}
												</span>
											</span>
										</span>
										<span className="shrink-0 text-[14px] font-semibold text-text tabular-nums">
											{row.value}
										</span>
									</PluginLink>
								))}
							</div>
						)
					}
				</QueryBody>
			</HomeSection>
		</ComputedResults>
	);
}
