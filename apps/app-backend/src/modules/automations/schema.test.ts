import { expect, it } from "@effect/vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import {
	notificationSubscriptionState,
	subscriptionRun,
} from "#lib/infrastructure/db/schema/tables/automations";

const dialect = new PgDialect();

it("defines generated, user-owned notification subscription state", () => {
	const config = getTableConfig(notificationSubscriptionState);
	const id = config.columns.find((column) => column.name === "id");
	const userId = config.columns.find((column) => column.name === "userId");
	expect(id).toMatchObject({ notNull: true, primary: true });
	expect(id?.defaultFn).toBeTypeOf("function");
	expect(userId?.notNull).toBe(true);
	expect(config.foreignKeys).toHaveLength(1);
	expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
});

it("uniquely identifies notification state by user, signal schema, and script", () => {
	const config = getTableConfig(notificationSubscriptionState);
	const uniqueIndexes = config.indexes.filter((entry) => entry.config.unique);
	expect(uniqueIndexes).toHaveLength(1);
	expect(uniqueIndexes[0]?.config.name).toBe(
		"notification_subscription_state_user_signal_script_unique",
	);
	expect(
		uniqueIndexes[0]?.config.columns.map((column) => ("name" in column ? column.name : null)),
	).toEqual(["userId", "signalSchemaSlug", "scriptSlug"]);
});

it("stores one non-null durable rule attribution without a foreign key", () => {
	const config = getTableConfig(subscriptionRun);
	const ruleIdColumns = config.columns.filter((column) => column.name === "ruleId");
	expect(ruleIdColumns).toHaveLength(1);
	expect(ruleIdColumns[0]?.notNull).toBe(true);
	expect(config.foreignKeys).toHaveLength(2);
	expect(config.foreignKeys.some((entry) => entry.getName().includes("ruleId"))).toBe(false);
	expect(config.indexes.map((entry) => entry.config.name)).toContain(
		"subscription_run_rule_id_idx",
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
