import {
	MigrationReportAnomalyCode,
	MigrationReportDetail,
	MigrationReportLevel,
} from "@ryot-app/contract/modules/god-mode/migration-report";
import { UserLifecycleOperation } from "@ryot-app/contract/modules/god-mode/user-lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	conditional,
	contains,
	defineRecipe,
	descending,
	eq,
	literal,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const user = table("user", "user");
const report = table("migrationReport", "report");
const detail = table("migrationReportDetail", "detail");
const operation = table("userLifecycleOperation", "operation");

export const godModeUsersRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number; readonly search?: string }) => {
		const where = input.search?.trim()
			? contains(column(user, "email"), literal(input.search.trim()))
			: undefined;
		return {
			map: ({ users, total }) => Result.succeed({ ...users, total: total.count }),
			queries: {
				total: selectedAggregate(user, {
					where,
					measures: { count: selectedMeasure({ function: "count" }, Schema.Number) },
				}),
				users: selectedRows(user, {
					where,
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(column(user, "createdAt")), ascending(column(user, "id"))],
					selection: {
						id: selectedField(column(user, "id"), UserId),
						name: selectedField(column(user, "name"), Schema.String),
						email: selectedField(column(user, "email"), Schema.String),
						createdAt: selectedField(column(user, "createdAt"), IsoDateString),
						disabledAt: selectedField(column(user, "disabledAt"), Schema.NullOr(IsoDateString)),
						twoFactorEnabled: selectedField(
							column(user, "twoFactorEnabled"),
							Schema.NullOr(Schema.Boolean),
						),
						authState: selectedField(
							column(user, "authState"),
							Schema.Literals(["credential", "oidc", "none", "mixed"]),
						),
					},
				}),
			},
		};
	},
);

export const migrationReportRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ entries }) => Result.succeed(entries),
		queries: {
			entries: selectedRows(report, {
				after: input.after,
				limit: input.limit,
				orderBy: [
					descending(
						conditional(eq(column(report, "level"), literal("warning")), literal(1), literal(0)),
					),
					descending(column(report, "createdAt")),
					descending(column(report, "seq")),
				],
				include: {
					details: selectedInclude(detail, {
						limit: 100,
						orderBy: [ascending(column(detail, "seq"))],
						where: eq(column(detail, "reportSeq"), column(report, "seq")),
						selection: {
							seq: selectedField(column(detail, "seq"), Schema.Number),
							detail: selectedField(column(detail, "detail"), MigrationReportDetail),
						},
					}),
				},
				selection: {
					seq: selectedField(column(report, "seq"), Schema.Number),
					phase: selectedField(column(report, "phase"), Schema.String),
					message: selectedField(column(report, "message"), Schema.String),
					level: selectedField(column(report, "level"), MigrationReportLevel),
					createdAt: selectedField(column(report, "createdAt"), IsoDateString),
					count: selectedField(column(report, "count"), Schema.NullOr(Schema.Number)),
					code: selectedField(column(report, "code"), Schema.NullOr(MigrationReportAnomalyCode)),
					totalDetails: selectedField(column(report, "totalDetails"), Schema.NullOr(Schema.Number)),
					elapsedSeconds: selectedField(
						column(report, "elapsedSeconds"),
						Schema.NullOr(Schema.Number),
					),
				},
			}),
		},
	}),
);

export const userLifecycleOperationRecipe = defineRecipe((input: { readonly id: string }) => ({
	map: ({ operation: item }) =>
		Result.succeed(item === undefined ? Option.none() : Option.some(item)),
	queries: {
		operation: selectedOptionalRow(operation, {
			orderBy: [ascending(column(operation, "id"))],
			where: eq(column(operation, "id"), literal(input.id)),
			selection: {
				createdAt: selectedField(column(operation, "createdAt"), IsoDateString),
				id: selectedField(column(operation, "id"), UserLifecycleOperation.fields.id),
				kind: selectedField(column(operation, "kind"), UserLifecycleOperation.fields.kind),
				startedAt: selectedField(column(operation, "startedAt"), Schema.NullOr(IsoDateString)),
				userId: selectedField(column(operation, "userId"), UserLifecycleOperation.fields.userId),
				status: selectedField(column(operation, "status"), UserLifecycleOperation.fields.status),
				finishedAt: selectedField(column(operation, "finishedAt"), Schema.NullOr(IsoDateString)),
				failure: selectedField(column(operation, "failure"), UserLifecycleOperation.fields.failure),
				resetResult: selectedField(
					column(operation, "resetResult"),
					UserLifecycleOperation.fields.resetResult,
				),
			},
		}),
	},
}));

export type GodModeUsersPage = Recipe.Success<typeof godModeUsersRecipe>;
export type MigrationReportPage = Recipe.Success<typeof migrationReportRecipe>;
export type UserLifecycleOperationDetail = Recipe.Success<typeof userLifecycleOperationRecipe>;
