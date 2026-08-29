import { expect, it } from "@effect/vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import {
	automationOccurrence,
	notificationSubscriptionState,
	subscriptionRun,
} from "#lib/infrastructure/db/schema/tables/automations";

const dialect = new PgDialect();

it("defines generated, user-owned notification subscription state", () => {
	const config = getTableConfig(notificationSubscriptionState);
	const id = config.columns.find((column) => column.name === "id");
	const userId = config.columns.find((column) => column.name === "user_id");
	expect(id).toMatchObject({ notNull: true, primary: true });
	expect(id?.defaultFn).toBeTypeOf("function");
	expect(userId?.notNull).toBe(true);
	expect(config.foreignKeys.some(({ onDelete }) => onDelete === "cascade")).toBe(true);
	expect(config.foreignKeys.some(({ onDelete }) => onDelete === "restrict")).toBe(true);
});

it("uniquely identifies notification state by user and signal schema", () => {
	const config = getTableConfig(notificationSubscriptionState);
	expect(config.uniqueConstraints).toHaveLength(1);
	expect(config.uniqueConstraints[0]?.getName()).toBe(
		"notification_subscription_state_user_signal_unique",
	);
	expect(config.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
		"user_id",
		"signal_schema_slug",
		"signal_schema_plugin_id",
	]);
	expect(config.uniqueConstraints[0]?.nullsNotDistinct).toBe(true);
});

it("defines automation occurrence columns and indexes", () => {
	const config = getTableConfig(automationOccurrence);
	expect(config.columns.map(({ name, notNull }) => [name, notNull])).toEqual([
		["record_id", false],
		["origin", true],
		["occurred_at", true],
		["operation", true],
		["population", false],
		["source", true],
		["id", true],
		["user_id", false],
		["created_at", true],
		["source_kind", true],
		["signal_id", false],
	]);
	expect(config.indexes.map((entry) => entry.config.name)).toEqual([
		"automation_occurrence_user_id_idx",
		"automation_occurrence_signal_id_idx",
	]);
});

it("constrains automation occurrence source references", () => {
	const config = getTableConfig(automationOccurrence);
	const checks = new Map(
		config.checks.map((entry) => [entry.name, dialect.sqlToQuery(entry.value).sql]),
	);
	expect(checks.get("automation_occurrence_source_check")).toContain("signal_id");
	expect(checks.get("automation_occurrence_source_check")).toContain("record_id");
	expect(checks.get("automation_occurrence_source_kind_check")).toContain("provider-entity-import");
});

it("references its signal and user with cascading foreign keys", () => {
	const config = getTableConfig(automationOccurrence);
	const signalForeignKey = config.foreignKeys.find(
		(entry) => entry.getName() === "automation_occurrence_signal_id_signal_id_fk",
	);
	const userForeignKey = config.foreignKeys.find(
		(entry) => entry.getName() === "automation_occurrence_user_id_user_id_fk",
	);
	expect(signalForeignKey?.reference().columns.map((column) => column.name)).toEqual(["signal_id"]);
	expect(signalForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual(["id"]);
	expect(signalForeignKey?.onDelete).toBe("cascade");
	expect(userForeignKey?.reference().columns.map((column) => column.name)).toEqual(["user_id"]);
	expect(userForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual(["id"]);
	expect(userForeignKey?.onDelete).toBe("cascade");
});

it("stores one non-null durable rule attribution without a foreign key", () => {
	const config = getTableConfig(subscriptionRun);
	const ruleIdColumns = config.columns.filter((column) => column.name === "rule_id");
	expect(ruleIdColumns).toHaveLength(1);
	expect(ruleIdColumns[0]?.notNull).toBe(true);
	expect(config.foreignKeys.some((entry) => entry.getName().includes("ruleId"))).toBe(false);
	expect(config.indexes.map((entry) => entry.config.name)).toContain(
		"subscription_run_rule_id_idx",
	);
});

it("indexes and references the source automation occurrence", () => {
	const config = getTableConfig(subscriptionRun);
	expect(config.indexes.map((entry) => entry.config.name)).toContain(
		"subscription_run_occurrence_id_idx",
	);
	const occurrenceForeignKey = config.foreignKeys.find(
		(entry) => entry.getName() === "subscription_run_occurrence_id_automation_occurrence_id_fk",
	);
	expect(occurrenceForeignKey?.reference().columns.map((column) => column.name)).toEqual([
		"occurrence_id",
	]);
	expect(occurrenceForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual([
		"id",
	]);
	expect(occurrenceForeignKey?.onDelete).toBe("cascade");
});

it("constrains run status and lifecycle-versus-signal references", () => {
	const config = getTableConfig(subscriptionRun);
	const checks = new Map(
		config.checks.map((entry) => [entry.name, dialect.sqlToQuery(entry.value).sql]),
	);
	expect(checks.get("subscription_run_status_check")).toContain("queued");
	expect(checks.get("subscription_run_status_check")).toContain("skipped");
	expect(checks.get("subscription_run_source_check")).toContain("record_id");
	expect(checks.get("subscription_run_source_check")).toContain("signal_id");
});
