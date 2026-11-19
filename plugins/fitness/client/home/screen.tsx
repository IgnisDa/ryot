import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	PluginLink,
	type ReportingCalendar,
	usePageRefresh,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	PreferencesGate,
	useFormatters,
	useRyot,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { fitnessRoute } from "../../shared/workout-editor-routes";
import { useActiveEditorDraft } from "../exercise/active-draft";
import { useFitnessMessageBuilder, useFitnessMessages } from "../messages";
import { workoutEditorContextQuery } from "../workout-editor/context-query";
import { WorkoutProcessing } from "../workout-processing";
import { buildWorkoutCards } from "../workouts/model";
import { FirstRun } from "./first-run";
import { MusclesSection, PersonalBestsSection } from "./insights";
import { LastWorkoutCard, ResumeBanner, WeekGoalSection } from "./launchpad";
import { MeasurementsCard } from "./measurements-card";
import { draftBanner, formatHomeDate, lastWorkoutPhrase } from "./model";
import { latestWorkoutQuery } from "./queries";
import { QueryBody, secondaryLinkClass } from "./section";
import { TemplatesSection } from "./templates";

export default function FitnessHomePage() {
	return (
		<PreferencesGate>
			{({ timeZone, weekStart }) => <FitnessHomeBody timeZone={timeZone} weekStart={weekStart} />}
		</PreferencesGate>
	);
}

function FitnessHomeBody({ timeZone, weekStart }: ReportingCalendar) {
	const text = useFitnessMessages();
	const message = useFitnessMessageBuilder();
	const formatters = useFormatters();
	const client = useRyot();
	const { compact } = useRyotViewport();
	const draft = useActiveEditorDraft();
	const latest = useRyotQuery(latestWorkoutQuery);
	const context = useRyotQuery(workoutEditorContextQuery);
	const [now, setNow] = useState(() => new Date());
	usePageRefresh(() =>
		DateTime.now.pipe(
			Effect.flatMap((currentTime) => Effect.sync(() => setNow(DateTime.toDate(currentTime)))),
		),
	);
	const imperial = context.data?.settings.unitSystem === "imperial";
	const cards = useMemo(
		() =>
			latest.data === undefined
				? undefined
				: buildWorkoutCards(formatters, { ...latest.data, now, imperial, timeZone, weekStart }),
		[formatters, latest.data, now, imperial, timeZone, weekStart],
	);
	const phrase = lastWorkoutPhrase(
		formatters,
		text,
		latest.data?.items[0]?.startedAt ?? null,
		now,
		timeZone,
	);
	const controls = (
		<div className={clsx("flex flex-wrap items-center gap-2.5", compact && "pb-4")}>
			{draft === undefined ? (
				<Button onClick={() => client.navigation.push(fitnessRoute("/workouts/new"))}>
					<AppIcon size={15} name="plus" />
					{text("client.home.start-empty")}
				</Button>
			) : (
				<Button onClick={() => client.navigation.push(fitnessRoute("/workout-editor"))}>
					<AppIcon size={15} name="play" />
					{draftBanner(formatters, text, draft, now, timeZone).resumeLabel}
				</Button>
			)}
			<PluginLink
				className={secondaryLinkClass}
				to={{ kind: "saved-view", reference: { kind: "kernel", slug: "analytics" } }}
			>
				{text("client.home.analytics")}
			</PluginLink>
		</div>
	);
	return (
		<WorkoutProcessing>
			<PluginScreenFrame
				title={message("client.home.title")}
				actions={compact ? undefined : controls}
				titleIcon={<AppIcon size={20} name="home" className="shrink-0 text-text-muted" />}
				meta={
					<p className="pb-2 text-[13px] text-text-muted">
						{[formatHomeDate(formatters, now, timeZone), phrase]
							.filter((part) => part !== null)
							.join(" · ")}
					</p>
				}
			>
				{compact ? controls : null}
				<div className="flex min-w-0 flex-col gap-6 font-ui">
					{draft === undefined ? null : (
						<ResumeBanner now={now} draft={draft} timeZone={timeZone} />
					)}
					<QueryBody result={latest} noun="your_workouts">
						{() =>
							cards?.[0] === undefined ? (
								<FirstRun goalSet={(context.data?.settings.weeklyWorkoutGoal ?? null) !== null} />
							) : (
								<>
									<div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-4">
										<WeekGoalSection
											now={now}
											timeZone={timeZone}
											weekStart={weekStart}
											hasLiveDraft={draft?.mode.kind === "live"}
										/>
										<LastWorkoutCard card={cards[0]} />
										<MeasurementsCard now={now} timeZone={timeZone} />
									</div>
									<TemplatesSection now={now} timeZone={timeZone} />
									<div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-6">
										<MusclesSection now={now} timeZone={timeZone} />
										<PersonalBestsSection now={now} timeZone={timeZone} imperial={imperial} />
									</div>
								</>
							)
						}
					</QueryBody>
				</div>
			</PluginScreenFrame>
		</WorkoutProcessing>
	);
}
