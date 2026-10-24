import { mediaConsumptionReportRecipe } from "@ryot-app/media-plugin/shared/consumption-recipes";
import type { Recipe } from "@ryot-app/ryotql";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { requirePresent } from "~/support/assertions";
import { expect } from "~/support/effect-test";

export type MediaConsumptionReportInput = Parameters<typeof mediaConsumptionReportRecipe>[0];
type MediaConsumptionReport = Recipe.Success<typeof mediaConsumptionReportRecipe>;

export const waitForMediaConsumptionReport = (client: Client, input: MediaConsumptionReportInput) =>
	pollUntil(
		"canonical media consumption report ready",
		executeRyotQLRecipe(client, mediaConsumptionReportRecipe(input)).pipe(
			Effect.map((report) => (report.processing === "ready" ? report : null)),
		),
	);

export const requireMediaConsumptionGroup = (report: MediaConsumptionReport, mediaType: string) => {
	const pageInfo = requirePresent(report.current.pageInfo, "Consumption report page info missing");
	expect(pageInfo.hasMore).toBe(false);
	return requirePresent(
		report.current.items.find((row) => row.mediaType === mediaType),
		`Consumption report group '${mediaType}' missing`,
	);
};

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
