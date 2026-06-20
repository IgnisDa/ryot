import { expect, it } from "@effect/vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import { automationRule, subscriptionRun } from "#lib/infrastructure/db/schema/tables/automations";

const dialect = new PgDialect();

it("defines rule target, compatibility, and position checks", () => {
	const config = getTableConfig(automationRule);
	const checks = new Map(
		config.checks.map((entry) => [entry.name, dialect.sqlToQuery(entry.value).sql]),
	);
	expect([...checks.keys()]).toEqual([
		"automation_rule_kind_check",
		"automation_rule_operation_check",
		"automation_rule_one_target_check",
		"automation_rule_target_operation_check",
		"automation_rule_position_check",
	]);
	expect(checks.get("automation_rule_one_target_check")).toContain("num_nonnulls");
	expect(checks.get("automation_rule_target_operation_check")).toContain("subscription");
	expect(checks.get("automation_rule_target_operation_check")).toContain("signal");
});

it("defines user and global partial unique indexes for every target", () => {
	const config = getTableConfig(automationRule);
	const uniqueIndexes = config.indexes.filter((entry) => entry.config.unique);
	expect(uniqueIndexes.map((entry) => entry.config.name)).toEqual([
		"automation_rule_user_entity_schema_unique",
		"automation_rule_global_entity_schema_unique",
		"automation_rule_user_event_schema_unique",
		"automation_rule_global_event_schema_unique",
		"automation_rule_user_relationship_schema_unique",
		"automation_rule_global_relationship_schema_unique",
		"automation_rule_user_signal_schema_unique",
		"automation_rule_global_signal_schema_unique",
	]);
	for (const entry of uniqueIndexes) {
		expect(entry.config.where).toBeDefined();
	}
});

it("retains subscription runs when their rule is deleted", () => {
	const config = getTableConfig(subscriptionRun);
	const ruleForeignKey = config.foreignKeys.find((entry) =>
		entry.getName().startsWith("subscription_run_ruleId_"),
	);
	expect(ruleForeignKey?.onDelete).toBe("set null");
	expect(config.indexes.map((entry) => entry.config.name)).toContain(
		"subscription_run_original_rule_id_idx",
	);
});

it("constrains run status and lifecycle-versus-signal references", () => {
	const config = getTableConfig(subscriptionRun);
	const checks = new Map(
		config.checks.map((entry) => [entry.name, dialect.sqlToQuery(entry.value).sql]),
	);
	expect(checks.get("subscription_run_status_check")).toContain("queued");
	expect(checks.get("subscription_run_status_check")).toContain("skipped");
	expect(checks.get("subscription_run_source_check")).toContain("recordId");
	expect(checks.get("subscription_run_source_check")).toContain("signalId");
});
