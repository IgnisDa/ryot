import { AutomationHookSlug, UserId } from "@ryot-app/contract/schema/brands";
import {
	MediaHistoryCorrectionRetryInput,
	MediaHistoryCorrectionRetryOutput,
} from "@ryot-app/media-plugin/shared/history-correction-status";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import {
	ascending,
	column,
	defineRecipe,
	inArray,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { pollTerminalAutomationRuns } from "~/fixtures/kernel/automations";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { expect } from "~/support/effect-test";

export const historyCorrectionRetryRecipe = defineOperationRecipe({
	packageId: PLUGIN_PACKAGE_ID,
	input: MediaHistoryCorrectionRetryInput,
	output: MediaHistoryCorrectionRetryOutput,
	operationSlug: "media-history-correction-retry",
});

const workRecipe = defineRecipe((input: { statuses: readonly string[] }) => {
	const work = table("backgroundWork", "historyCorrectionWork");
	return {
		map: ({ work: rows }) => Result.succeed(rows.items),
		queries: {
			work: selectedRows(work, {
				limit: 100,
				orderBy: [ascending(column(work, "id"))],
				where: inArray(column(work, "status"), input.statuses.map(literal)),
				selection: {
					scope: selectedField(column(work, "scope"), Schema.String),
					status: selectedField(column(work, "status"), Schema.String),
					error: selectedField(column(work, "error"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	};
});

export const historyEventsFor = (client: Client, entityId: string) =>
	listEventsForEntity(client, entityId, undefined, 100);

export const settledHistoryCorrection = (client: Client, userId: string) =>
	pollTerminalAutomationRuns({
		executionUserId: UserId.make(userId),
		hookSlug: AutomationHookSlug.make("media.reconcile-history"),
	}).pipe(
		Effect.tap((runs) =>
			Effect.sync(() => expect(runs.map((run) => run.status)).toEqual(runs.map(() => "succeeded"))),
		),
		Effect.andThen(
			pollUntil(
				"history correction work",
				Effect.gen(function* () {
					expect(yield* executeRyotQLRecipe(client, workRecipe({ statuses: ["failed"] }))).toEqual(
						[],
					);
					const running = yield* executeRyotQLRecipe(client, workRecipe({ statuses: ["running"] }));
					const scopes = running.map((row) => row.scope);
					expect(new Set(scopes).size).toBe(scopes.length);
					const active = yield* executeRyotQLRecipe(
						client,
						workRecipe({ statuses: ["queued", "running"] }),
					);
					return active.length === 0 ? true : null;
				}),
			),
		),
	);
