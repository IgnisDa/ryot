import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castText,
	column,
	defineRecipe,
	descending,
	eq,
	inArray,
	jsonPath,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

export const MediaHistoryCorrectionStatus = Schema.Struct({
	status: Schema.Literals(["pending", "failed", "settled"]),
});
export type MediaHistoryCorrectionStatus = typeof MediaHistoryCorrectionStatus.Type;

export const MediaHistoryCorrectionRetryInput = Schema.Struct({
	entityId: Schema.NonEmptyString,
	submissionId: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(96))),
});
export type MediaHistoryCorrectionRetryInput = typeof MediaHistoryCorrectionRetryInput.Type;

export const MediaHistoryCorrectionRetryOutput = Schema.Struct({ workId: Schema.String });
export type MediaHistoryCorrectionRetryOutput = typeof MediaHistoryCorrectionRetryOutput.Type;

export const mediaHistoryCorrectionStatusRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly reference: PluginIdentityReference }) => {
		const work = table("userWork", "historyCorrectionWork");
		const active = table("userWork", "activeHistoryCorrectionWork");
		const checkpoint = table("event", "historyCorrectionCheckpoint");
		return {
			map: ({ active: pending, work: latestWork, checkpoint: latestCheckpoint }) => {
				let status: MediaHistoryCorrectionStatus["status"] = "settled";
				if (
					latestWork.items[0]?.status === "failed" ||
					(latestCheckpoint !== undefined && latestCheckpoint.phase !== "done")
				) {
					status = "failed";
				}
				if (pending.items.length > 0) {
					status = "pending";
				}
				return Result.succeed({ status } satisfies MediaHistoryCorrectionStatus);
			},
			queries: {
				work: selectedRows(work, {
					limit: 1,
					orderBy: [descending(column(work, "createdAt")), descending(column(work, "id"))],
					where: and(
						eq(column(work, "scope"), literal(input.entityId)),
						schemaOwnerPredicate(work, "pluginId", input.reference),
					),
					selection: {
						status: selectedField(
							column(work, "status"),
							Schema.Literals(["queued", "running", "succeeded", "failed"]),
						),
					},
				}),
				active: selectedRows(active, {
					limit: 1,
					selection: { id: selectedField(column(active, "id"), Schema.String) },
					orderBy: [descending(column(active, "createdAt")), descending(column(active, "id"))],
					where: and(
						eq(column(active, "scope"), literal(input.entityId)),
						schemaOwnerPredicate(active, "pluginId", input.reference),
						inArray(column(active, "status"), [literal("queued"), literal("running")]),
					),
				}),
				checkpoint: selectedOptionalRow(checkpoint, {
					orderBy: [
						descending(column(checkpoint, "createdAt")),
						descending(column(checkpoint, "id")),
					],
					selection: {
						phase: selectedField(
							castText(jsonPath(column(checkpoint, "properties"), "phase")),
							Schema.NullOr(Schema.String),
						),
					},
					where: and(
						eq(column(checkpoint, "eventSchemaSlug"), literal("history-correction")),
						eq(
							castText(jsonPath(column(checkpoint, "properties"), "subjectEntityId")),
							literal(input.entityId),
						),
						schemaOwnerPredicate(checkpoint, "eventSchemaPluginId", input.reference),
					),
				}),
			},
		};
	},
);
