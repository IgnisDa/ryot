import { expect, it } from "@effect/vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import {
	automationRun,
	automationRunAttempt,
	automationTrigger,
	automationTriggerRecipient,
	notificationSubscription,
} from "#lib/infrastructure/db/schema/tables/automations";

const dialect = new PgDialect();

it("defines generated, user-owned notification subscription", () => {
	const config = getTableConfig(notificationSubscription);
	const id = config.columns.find((column) => column.name === "id");
	const userId = config.columns.find((column) => column.name === "user_id");
	expect(id).toMatchObject({ notNull: true, primary: true });
	expect(id?.defaultFn).toBeTypeOf("function");
	expect(userId?.notNull).toBe(true);
	expect(config.foreignKeys.some(({ onDelete }) => onDelete === "cascade")).toBe(true);
	expect(config.foreignKeys.some(({ onDelete }) => onDelete === "restrict")).toBe(true);
});

it("uniquely identifies notification subscription by user and signal schema", () => {
	const config = getTableConfig(notificationSubscription);
	expect(config.uniqueConstraints).toHaveLength(1);
	expect(config.uniqueConstraints[0]?.getName()).toBe(
		"notification_subscription_user_signal_unique",
	);
	expect(config.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
		"user_id",
		"signal_schema_slug",
		"signal_schema_plugin_id",
	]);
	expect(config.uniqueConstraints[0]?.nullsNotDistinct).toBe(true);
});

it("defines automation trigger columns and indexes", () => {
	const config = getTableConfig(automationTrigger);
	expect(config.columns.map(({ name, notNull }) => [name, notNull])).toEqual([
		["initiator_id", false],
		["parent_run_id", false],
		["import_run_id", false],
		["integration_id", false],
		["parent_trigger_id", false],
		["id", true],
		["depth", true],
		["provider_execution_id", false],
		["execution_id", true],
		["root_execution_id", true],
		["payload_pruned_at", false],
		["payload", false],
		["occurred_at", true],
		["blocked_reason", false],
		["created_at", true],
		["scope_user_id", false],
		["category", true],
		["source", true],
		["operation", true],
		["resource_kind", true],
		["initiator_kind", true],
	]);
	expect(config.indexes.map((entry) => entry.config.name)).toEqual([
		"automation_trigger_root_idx",
		"automation_trigger_parent_run_idx",
		"automation_trigger_parent_trigger_idx",
		"automation_trigger_scope_idx",
		"automation_trigger_retention_idx",
	]);
});

it("constrains automation trigger kind and causation", () => {
	const config = getTableConfig(automationTrigger);
	const checks = new Map(
		config.checks.map((entry) => [entry.name, dialect.sqlToQuery(entry.value).sql]),
	);
	expect(checks.get("automation_trigger_kind_check")).toContain("provider-entity-import");
	expect(checks.get("automation_trigger_causation_check")).toContain("parent_run_id");
	expect(checks.get("automation_trigger_causation_check")).toContain("parent_trigger_id");
	expect(checks.get("automation_trigger_payload_check")).toContain("payload_pruned_at");
});

it("keeps trigger scope when its user is deleted", () => {
	const config = getTableConfig(automationTrigger);
	const userForeignKey = config.foreignKeys.find(
		(entry) => entry.reference().columns[0]?.name === "scope_user_id",
	);
	expect(userForeignKey?.reference().columns.map((column) => column.name)).toEqual([
		"scope_user_id",
	]);
	expect(userForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual(["id"]);
	expect(userForeignKey?.onDelete).toBe("set null");
});

it("defines trigger recipients with a user-trigger key", () => {
	const config = getTableConfig(automationTriggerRecipient);
	expect(config.columns.map(({ name, notNull }) => [name, notNull])).toEqual([
		["user_id", true],
		["trigger_id", true],
	]);
	expect(config.indexes.map((entry) => entry.config.name)).toEqual([
		"automation_trigger_recipient_user_idx",
	]);
	expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
		"trigger_id",
		"user_id",
	]);
	expect(config.foreignKeys.map((entry) => entry.onDelete)).toEqual(["cascade", "cascade"]);
});

it("defines pinned automation runs and their trigger index", () => {
	const config = getTableConfig(automationRun);
	expect(config.columns.find((column) => column.name === "id")).toMatchObject({
		notNull: true,
		primary: true,
	});
	expect(config.columns.find((column) => column.name === "trigger_id")).toMatchObject({
		notNull: true,
	});
	expect(config.indexes.map((entry) => entry.config.name)).toContain("automation_run_trigger_idx");
	expect(config.indexes.map((entry) => entry.config.name)).toContain(
		"automation_run_history_retention_idx",
	);
});

it("references the source automation trigger and pins package revisions", () => {
	const config = getTableConfig(automationRun);
	const triggerForeignKey = config.foreignKeys.find(
		(entry) => entry.reference().columns[0]?.name === "trigger_id",
	);
	expect(triggerForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual([
		"id",
	]);
	expect(triggerForeignKey?.onDelete).toBe("cascade");
	expect(config.foreignKeys.map((entry) => entry.getName())).toContain(
		"automation_run_revision_owner_fk",
	);
	expect(config.foreignKeys.map((entry) => entry.getName())).toContain(
		"automation_run_config_revision_fk",
	);
	expect(config.foreignKeys.map((entry) => entry.getName())).toContain(
		"automation_run_script_revision_fk",
	);
});

it("constrains automation run stage and status", () => {
	const config = getTableConfig(automationRun);
	const checks = new Map(
		config.checks.map((entry) => [entry.name, dialect.sqlToQuery(entry.value).sql]),
	);
	expect(checks.get("automation_run_stage_check")).toContain("policy");
	expect(checks.get("automation_run_status_check")).toContain("queued");
	expect(checks.get("automation_run_status_check")).toContain("rejected");
});

it("defines automation run attempts with unique execution identities", () => {
	const config = getTableConfig(automationRunAttempt);
	expect(config.columns.find((column) => column.name === "id")).toMatchObject({
		notNull: true,
		primary: true,
	});
	expect(config.columns.find((column) => column.name === "run_id")).toMatchObject({
		notNull: true,
	});
	expect(config.uniqueConstraints.map((entry) => entry.getName())).toEqual([
		"automation_run_attempt_number_unique",
		"automation_run_attempt_workflow_unique",
	]);
	expect(config.indexes.map((entry) => entry.config.name)).toContain(
		"automation_run_attempt_one_running",
	);
	expect(config.indexes.map((entry) => entry.config.name)).toContain(
		"automation_run_attempt_retention_idx",
	);
});

it("references the source automation run and constrains attempt state", () => {
	const config = getTableConfig(automationRunAttempt);
	const runForeignKey = config.foreignKeys.find(
		(entry) => entry.reference().columns[0]?.name === "run_id",
	);
	expect(runForeignKey?.reference().foreignColumns.map((column) => column.name)).toEqual(["id"]);
	expect(runForeignKey?.onDelete).toBe("cascade");
	const checks = new Map(
		config.checks.map((entry) => [entry.name, dialect.sqlToQuery(entry.value).sql]),
	);
	expect(checks.get("automation_run_attempt_state_check")).toContain("finished_at");
});
