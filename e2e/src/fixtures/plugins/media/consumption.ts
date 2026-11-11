import type { ReportingSelection } from "@ryot-app/contract/modules/analytics/reporting";
import type { TimeZone } from "@ryot-app/contract/schema/time-zone";
import { mediaAnalyticsSummaryRecipe } from "@ryot-app/media-plugin/shared/analytics-recipes";
import type { Recipe } from "@ryot-app/ryotql";
import { reportingArguments } from "@ryot-app/ryotql-recipes/reporting-parameters";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { requirePresent } from "~/support/assertions";

export type MediaConsumptionReportInput = { readonly entityId?: string } & Omit<
	Parameters<typeof mediaAnalyticsSummaryRecipe>[0],
	never
> & { readonly now: number; readonly timeZone: TimeZone; readonly selection: ReportingSelection };

export const mediaAnalyticsInput = <Input extends MediaConsumptionReportInput>({
	now: _now,
	selection,
	timeZone: _timeZone,
	reference: _reference,
	...input
}: Input) => ({ ...input, ...reportingArguments(selection) });
type MediaConsumptionReport = Recipe.Success<ReturnType<typeof mediaAnalyticsSummaryRecipe>>;

export const waitForMediaConsumptionReport = (client: Client, input: MediaConsumptionReportInput) =>
	pollUntil(
		"canonical media consumption report ready",
		executeRyotQLRecipe(
			client,
			mediaAnalyticsSummaryRecipe({ reference: input.reference }),
			mediaAnalyticsInput(input),
		).pipe(Effect.map((report) => (report.processing === "ready" ? report : null))),
	);

export const requireMediaConsumptionGroup = (report: MediaConsumptionReport, mediaType: string) =>
	requirePresent(
		report.current.types.find((row) => row.mediaType === mediaType),
		`Consumption report group '${mediaType}' missing`,
	);

const decodeMeasureAmount = (value: unknown) =>
	value === null ? Effect.succeed(0) : Schema.decodeUnknownEffect(Schema.Finite)(value);

export const mediaConsumptionMeasure = (
	row: ReturnType<typeof requireMediaConsumptionGroup>,
	unit: "pages" | "minutes" | "chapters",
) =>
	Effect.gen(function* () {
		const recorded = yield* decodeMeasureAmount(Reflect.get(row, `${unit}Recorded`));
		const estimated = yield* decodeMeasureAmount(Reflect.get(row, `${unit}Estimated`));
		return { recorded, estimated, total: recorded + estimated };
	});
