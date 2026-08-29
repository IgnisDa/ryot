import {
	BackupRunArtifactProvider,
	BackupRunFailure,
	BackupRunKind,
} from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId } from "@ryot-app/contract/schema/brands";
import { RunStatus } from "@ryot-app/contract/schema/run-status";
import {
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	literal,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const run = table("backupRun", "run");
const selection = {
	id: selectedField(column(run, "id"), BackupRunId),
	kind: selectedField(column(run, "kind"), BackupRunKind),
	status: selectedField(column(run, "status"), RunStatus),
	progress: selectedField(column(run, "progress"), Schema.Number),
	createdAt: selectedField(column(run, "createdAt"), IsoDateString),
	failure: selectedField(column(run, "failure"), Schema.NullOr(BackupRunFailure)),
	startedAt: selectedField(column(run, "startedAt"), Schema.NullOr(IsoDateString)),
	expiresAt: selectedField(column(run, "expiresAt"), Schema.NullOr(IsoDateString)),
	finishedAt: selectedField(column(run, "finishedAt"), Schema.NullOr(IsoDateString)),
	artifactProvider: selectedField(
		column(run, "artifactProvider"),
		Schema.NullOr(BackupRunArtifactProvider),
	),
};

export const backupRunsRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ runs }) => Result.succeed(runs),
		queries: {
			runs: selectedRows(run, {
				selection,
				after: input.after,
				limit: input.limit,
				orderBy: [descending(column(run, "createdAt")), descending(column(run, "id"))],
			}),
		},
	}),
);

export const backupRunRecipe = defineRecipe((input: { readonly id: string }) => ({
	map: ({ run: item }) => Result.succeed(item === undefined ? Option.none() : Option.some(item)),
	queries: {
		run: selectedOptionalRow(run, {
			selection,
			orderBy: [ascending(column(run, "id"))],
			where: eq(column(run, "id"), literal(input.id)),
		}),
	},
}));

export type BackupRunsPage = Recipe.Success<typeof backupRunsRecipe>;
export type BackupRunDetail = Recipe.Success<typeof backupRunRecipe>;
export type BackupRunItem = BackupRunsPage["items"][number];
