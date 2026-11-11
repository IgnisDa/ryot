import {
	BackupRunArtifactProvider,
	BackupRunFailure,
	BackupRunKind,
	BackupRunStatus,
} from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const run = table("backupRun", "run");
const selection = {
	id: selectedField(column(run, "id"), BackupRunId),
	kind: selectedField(column(run, "kind"), BackupRunKind),
	status: selectedField(column(run, "status"), BackupRunStatus),
	progress: selectedField(column(run, "progress"), Schema.Finite),
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

export const backupRunsRecipe = defineRecipe({
	map: ({ runs }) => Result.succeed(runs),
	queries: {
		runs: selectedRows(run, {
			selection,

			limit: 20,
			maxLimit: 1000,
			orderBy: [descending(column(run, "createdAt")), descending(column(run, "id"))],
		}),
	},
});

export const backupRunRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			id: {
				label: "id",
				type: "string",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ run: item }) => Result.succeed(item === undefined ? Option.none() : Option.some(item)),
		queries: {
			run: selectedOptionalRow(run, {
				selection,
				orderBy: [ascending(column(run, "id"))],
				where: eq(column(run, "id"), recipeParameters.value("id")),
			}),
		},
	});
})();

export type BackupRunItem = BackupRunsPage["items"][number];
export type BackupRunsPage = Recipe.Success<typeof backupRunsRecipe>;
export type BackupRunDetail = Recipe.Success<typeof backupRunRecipe>;
