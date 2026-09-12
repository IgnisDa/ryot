import { expect, it } from "@effect/vitest";
import {
	aggregate,
	and,
	ascending,
	castDate,
	castNumber,
	column,
	concat,
	contains,
	conditional,
	count,
	currentDate,
	dateBucket,
	document,
	eq,
	exists,
	field,
	floor,
	first,
	groupDescending,
	gt,
	include,
	integer,
	isNotNull,
	join,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	kebabCase,
	literal,
	maximum,
	measure,
	measureDescending,
	minimum,
	rows,
	round,
	star,
	sum,
	table,
	timeSeries,
	titleCase,
} from "@ryot-app/ryotql";

import { getCatalogTable } from "./catalog";
import { validateRyotQLDocument } from "./validator";

const userAccess = { type: "user", audience: "kernel", accessClass: "standard" } as const;

const nested = (depth: number): ReturnType<typeof include> => {
	const child = table("entity", `child${depth}`);
	return include(child, {
		limit: 10,
		fields: [],
		key: `child${depth}`,
		...(depth < 4 ? { include: [nested(depth + 1)] } : {}),
		orderBy: [{ direction: "asc", expr: column(child, "id") }],
	});
};

const nestedExists = (depth: number, maximumDepth: number): ReturnType<typeof exists> => {
	const child = table("entity", `correlated${depth}`);
	return exists(child, {
		where: depth < maximumDepth ? nestedExists(depth + 1, maximumDepth) : undefined,
	});
};

it("exposes only approved entity fields", () => {
	expect(new Set(Object.keys(getCatalogTable("entity")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"name",
			"userId",
			"createdAt",
			"updatedAt",
			"properties",
			"externalId",
			"providerId",
			"populatedAt",
			"populationStatus",
			"translationStatus",
			"entitySchemaSlug",
			"entitySchemaPluginId",
		]),
	);
});

it("exposes only approved event fields", () => {
	expect(new Set(Object.keys(getCatalogTable("event")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"userId",
			"entityId",
			"createdAt",
			"updatedAt",
			"properties",
			"occurredAt",
			"eventSchemaSlug",
			"sessionEntityId",
		]),
	);
});

it("exposes only approved relationship fields", () => {
	expect(new Set(Object.keys(getCatalogTable("relationship")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"userId",
			"createdAt",
			"properties",
			"sourceEntityId",
			"targetEntityId",
			"relationshipSchemaSlug",
		]),
	);
});

it("exposes only approved application-table fields", () => {
	expect(new Set(Object.keys(getCatalogTable("plugin")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"icon",
			"name",
			"slug",
			"scope",
			"status",
			"version",
			"sourceHash",
			"ingestedAt",
			"description",
			"configSchema",
			"activeRevisionId",
			"clientApiVersion",
			"environmentConfigRevisionId",
		]),
	);
	expect(new Set(Object.keys(getCatalogTable("pluginInstallation")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"health",
			"pluginId",
			"homeSavedViewSlug",
			"sortOrder",
			"isDisabled",
			"healthReason",
			"config",
			"configuredSecrets",
			"createdAt",
			"updatedAt",
		]),
	);
	expect(new Set(Object.keys(getCatalogTable("sandboxProvider")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"slug",
			"name",
			"pluginId",
			"rootEntitySchemaSlug",
			"information",
			"createdAt",
			"updatedAt",
		]),
	);
	expect(getCatalogTable("sandboxProvider")?.name).toBe("user_sandbox_provider");
	expect(getCatalogTable("sandboxProvider")?.primaryKey).toEqual(["id"]);
	expect(getCatalogTable("sandboxProvider")?.visibility).toEqual({
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	});
	expect(new Set(Object.keys(getCatalogTable("sandboxProviderOperation")?.fields ?? {}))).toEqual(
		new Set(["id", "providerId", "operation", "optionsSchema", "createdAt", "updatedAt"]),
	);
	expect(getCatalogTable("sandboxProviderOperation")?.name).toBe("sandbox_provider_operation");
	expect(getCatalogTable("sandboxProviderOperation")?.primaryKey).toEqual(["id"]);
	expect(getCatalogTable("sandboxProviderOperation")?.visibility).toEqual({
		user: {
			parentColumn: "id",
			type: "parentOwned",
			pluginReadable: true,
			column: "provider_id",
			parentOwnerColumn: "user_id",
			parentTable: "user_sandbox_provider",
		},
	});
	expect(new Set(Object.keys(getCatalogTable("savedView")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"slug",
			"name",
			"icon",
			"sortOrder",
			"isBuiltin",
			"isDisabled",
			"pluginSlug",
			"renderer",
			"settings",
			"dataSources",
			"createdAt",
			"updatedAt",
		]),
	);
	expect(new Set(Object.keys(getCatalogTable("notificationChannel")?.fields ?? {}))).toEqual(
		new Set(["id", "channel", "description", "isDisabled", "createdAt", "updatedAt"]),
	);
	const notificationChannel = getCatalogTable("notificationChannel");
	expect(notificationChannel?.name).toBe("notification_channel");
	expect(notificationChannel?.primaryKey).toEqual(["id"]);
	expect(notificationChannel?.visibility).toEqual({
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	});
	expect(notificationChannel && "plugin" in notificationChannel.visibility).toBe(false);
	const notificationSubscription = getCatalogTable("notificationSubscription");
	expect(
		Object.fromEntries(
			Object.entries(notificationSubscription?.fields ?? {}).map(([name, catalogField]) => [
				name,
				catalogField.kind,
			]),
		),
	).toEqual({
		id: "text",
		userId: "text",
		createdAt: "date",
		updatedAt: "date",
		isActive: "boolean",
		signalSchemaSlug: "text",
	});
	expect(notificationSubscription?.name).toBe("notification_subscription");
	expect(notificationSubscription?.primaryKey).toEqual(["id"]);
	expect(notificationSubscription?.visibility).toEqual({
		admin: { type: "all" },
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	});
	expect(notificationSubscription && "plugin" in notificationSubscription.visibility).toBe(false);
	expect(new Set(Object.keys(getCatalogTable("integration")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"lot",
			"name",
			"provider",
			"pluginSlug",
			"isDisabled",
			"syncOwnership",
			"minimumProgress",
			"maximumProgress",
			"extraSettings",
			"lastFinishedAt",
			"webhookToken",
			"providerSpecifics",
			"createdAt",
			"updatedAt",
		]),
	);
	const integration = getCatalogTable("integration");
	expect(integration?.name).toBe("integration");
	expect(integration?.primaryKey).toEqual(["id"]);
	expect(integration?.visibility).toEqual({
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	});
	expect(integration && "plugin" in integration.visibility).toBe(false);
	expect(new Set(Object.keys(getCatalogTable("importRun")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"source",
			"status",
			"progress",
			"totalItems",
			"failedItems",
			"importedItems",
			"processedItems",
			"failureReason",
			"inputSummary",
			"integrationId",
			"startedAt",
			"finishedAt",
			"createdAt",
			"updatedAt",
		]),
	);
	expect(new Set(Object.keys(getCatalogTable("importRunFailure")?.fields ?? {}))).toEqual(
		new Set([
			"id",
			"runId",
			"stage",
			"reason",
			"itemIndex",
			"sourceLabel",
			"sourceIdentifier",
			"eventSchemaSlug",
			"entitySchemaSlug",
			"createdAt",
		]),
	);
	const importRun = getCatalogTable("importRun");
	const importRunFailure = getCatalogTable("importRunFailure");
	expect(importRun?.name).toBe("import_run");
	expect(importRun?.visibility).toEqual({
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: true },
	});
	expect(importRunFailure?.name).toBe("import_run_failure");
	expect(importRunFailure?.visibility).toEqual({
		user: {
			column: "run_id",
			parentColumn: "id",
			type: "parentOwned",
			pluginReadable: true,
			parentTable: "import_run",
			parentOwnerColumn: "user_id",
		},
	});
	expect(importRun && "plugin" in importRun.visibility).toBe(false);
	expect(importRunFailure && "plugin" in importRunFailure.visibility).toBe(false);
});

it("rejects hidden application-table fields", () => {
	for (const [tableName, fieldName] of [
		["plugin", "ownerId"],
		["plugin", "compiledHashes"],
		["plugin", "clientArtifact"],
		["pluginInstallation", "userId"],
		["pluginInstallation", "clientConfig"],
		["pluginInstallation", "activeConfigRevisionId"],
		["sandboxProviderOperation", "scriptId"],
		["savedView", "userId"],
		["notificationChannel", "userId"],
		["notificationChannel", "channelSpecifics"],
		["notificationChannel", "platform_specifics"],
		["notificationSubscription", "userId"],
		["notificationSubscription", "metadata"],
		["integration", "userId"],
		["integration", "webhookUrl"],
		["integration", "clientProviderSpecifics"],
		["importRun", "userId"],
		["backupRun", "userId"],
		["backupRun", "artifactKey"],
		["importSource", "userId"],
		["importSource", "workflowScriptId"],
		["importSource", "configRevisionId"],
		["integrationProvider", "scriptId"],
		["integrationProvider", "scriptSlug"],
		["integrationProvider", "configRevisionId"],
		["entitySchema", "isEffective"],
		["automationRunAttempt", "returnedValue"],
	] as const) {
		const source = table(tableName, "source");
		expect(
			validateRyotQLDocument(
				document({ rows: rows(source, { fields: [field("value", column(source, fieldName))] }) }),
				userAccess,
			),
		).toBe(`Query 'rows': Unknown field '${fieldName}' on table '${tableName}'`);
		expect(
			validateRyotQLDocument(
				document({
					rows: rows(source, {
						fields: [],
						where: eq(column(source, fieldName), literal("hidden")),
					}),
				}),
				userAccess,
			),
		).toBe(`Query 'rows': Unknown field '${fieldName}' on table '${tableName}'`);
	}
});

it("denies user-only catalog tables to plugin execution", () => {
	for (const tableName of ["importRun", "importRunFailure"] as const) {
		const source = table(tableName, "source");
		expect(
			validateRyotQLDocument(document({ rows: rows(source, { fields: [] }) }), { type: "plugin" }),
		).toBe(`Query 'rows': Table '${tableName}' is not available to plugin execution`);
	}
});

it("denies sandbox catalog tables in every plugin query occurrence", () => {
	for (const tableName of ["sandboxProvider", "sandboxProviderOperation"] as const) {
		const root = table("entity", "root");
		const joined = table(tableName, "joined");
		const included = table(tableName, "included");
		const correlated = table(tableName, "correlated");
		const pluginScope = { type: "plugin" } as const;

		expect(
			validateRyotQLDocument(document({ root: rows(joined, { fields: [] }) }), pluginScope),
		).toContain(`Table '${tableName}' is not available to plugin execution`);
		expect(
			validateRyotQLDocument(
				document({
					root: rows(root, {
						fields: [],
						joins: [join("inner", joined, eq(column(root, "id"), column(joined, "id")))],
					}),
				}),
				pluginScope,
			),
		).toContain(`Table '${tableName}' is not available to plugin execution`);
		expect(
			validateRyotQLDocument(
				document({
					root: rows(root, {
						fields: [],
						include: [
							include(included, {
								limit: 1,
								fields: [],
								key: "providers",
								orderBy: [ascending(column(included, "id"))],
							}),
						],
					}),
				}),
				pluginScope,
			),
		).toContain(`Table '${tableName}' is not available to plugin execution`);
		expect(
			validateRyotQLDocument(
				document({ root: rows(root, { fields: [field("hasProvider", exists(correlated))] }) }),
				pluginScope,
			),
		).toContain(`Table '${tableName}' is not available to plugin execution`);
	}
});

it("limits admin execution to tables with an admin policy", () => {
	const admin = { type: "admin" } as const;
	for (const tableName of [
		"user",
		"plugin",
		"relationship",
		"automationRun",
		"sandboxScript",
		"migrationReport",
		"automationTrigger",
		"entityTranslation",
		"pluginInstallation",
		"automationRunAttempt",
		"migrationReportDetail",
		"userLifecycleOperation",
		"notificationSubscription",
		"automationTriggerRecipient",
	] as const) {
		const source = table(tableName, "source");
		expect(
			validateRyotQLDocument(
				document({ rows: rows(source, { orderBy: [], fields: [star(source)] }) }),
				admin,
			),
		).toBeNull();
	}
	for (const tableName of [
		"event",
		"entity",
		"backupRun",
		"importRun",
		"savedView",
		"eventSchema",
		"integration",
		"entitySchema",
		"importSource",
		"signalSchema",
		"sandboxProvider",
		"importRunFailure",
		"relationshipSchema",
		"integrationProvider",
		"notificationChannel",
		"sandboxProviderOperation",
	] as const) {
		const source = table(tableName, "source");
		expect(validateRyotQLDocument(document({ rows: rows(source, { fields: [] }) }), admin)).toBe(
			`Query 'rows': Table '${tableName}' is not available to admin execution`,
		);
	}
	const root = table("plugin", "root");
	const correlated = table("entity", "correlated");
	expect(
		validateRyotQLDocument(
			document({ root: rows(root, { fields: [field("hasEntity", exists(correlated))] }) }),
			admin,
		),
	).toBe("Query 'root': Table 'entity' is not available to admin execution");
});

it("denies admin-only tables to every user audience", () => {
	for (const audience of ["kernel", "plugin"] as const) {
		for (const tableName of [
			"sandboxScript",
			"migrationReport",
			"entityTranslation",
			"migrationReportDetail",
			"userLifecycleOperation",
			"automationTriggerRecipient",
		] as const) {
			const source = table(tableName, "source");
			expect(
				validateRyotQLDocument(document({ rows: rows(source, { fields: [], orderBy: [] }) }), {
					audience,
					type: "user",
					accessClass: "standard",
				}),
			).toBe(`Query 'rows': Table '${tableName}' is not available to the ${audience} audience`);
		}
	}
});

it("denies kernel-only tables to the plugin audience", () => {
	for (const tableName of [
		"user",
		"backupRun",
		"importSource",
		"automationRun",
		"automationTrigger",
		"integrationProvider",
		"automationRunAttempt",
	] as const) {
		const source = table(tableName, "source");
		const query = document({ rows: rows(source, { fields: [star(source)] }) });
		expect(validateRyotQLDocument(query, userAccess)).toBeNull();
		expect(
			validateRyotQLDocument(query, { type: "user", audience: "plugin", accessClass: "standard" }),
		).toBe(`Query 'rows': Table '${tableName}' is not available to the plugin audience`);
	}
	for (const tableName of ["entitySchema", "eventSchema", "relationshipSchema", "signalSchema"]) {
		const source = table(tableName, "source");
		expect(
			validateRyotQLDocument(document({ rows: rows(source, { fields: [star(source)] }) }), {
				type: "user",
				audience: "plugin",
				accessClass: "standard",
			}),
		).toBeNull();
	}
});

it("hides kernel-only fields from the plugin audience", () => {
	for (const [tableName, fieldName] of [
		["pluginInstallation", "config"],
		["pluginInstallation", "configuredSecrets"],
		["integration", "webhookToken"],
		["integration", "providerSpecifics"],
	] as const) {
		const source = table(tableName, "source");
		const query = document({
			rows: rows(source, { fields: [field("value", column(source, fieldName))] }),
		});
		expect(validateRyotQLDocument(query, userAccess)).toBeNull();
		expect(
			validateRyotQLDocument(query, { type: "user", audience: "plugin", accessClass: "standard" }),
		).toBe(`Query 'rows': Unknown field '${fieldName}' on table '${tableName}'`);
	}
});

it("denies demo access to backup runs in root, join, include, and correlated queries", () => {
	const demo = { ...userAccess, accessClass: "demo" } as const;
	const root = table("integration", "root");
	const backup = table("backupRun", "backup");
	const candidates = [
		document({ runs: rows(backup, { fields: [field("id", column(backup, "id"))] }) }),
		document({
			runs: rows(root, {
				fields: [],
				joins: [join("inner", backup, eq(column(root, "id"), column(backup, "id")))],
			}),
		}),
		document({
			runs: rows(root, {
				fields: [],
				include: [
					include(backup, {
						limit: 1,
						fields: [],
						key: "backups",
						orderBy: [ascending(column(backup, "id"))],
					}),
				],
			}),
		}),
		document({ runs: rows(root, { fields: [], where: exists(backup) }) }),
	];
	for (const candidate of candidates) {
		expect(validateRyotQLDocument(candidate, userAccess)).toBeNull();
		expect(validateRyotQLDocument(candidate, demo)).toContain(
			"Table 'backupRun' is not available to the kernel audience",
		);
		expect(validateRyotQLDocument(candidate, { ...demo, audience: "plugin" })).toContain(
			"Table 'backupRun' is not available to the plugin audience",
		);
	}
});

it("denies demo reads of integration secrets without hiding safe fields or wildcards", () => {
	const demo = { ...userAccess, accessClass: "demo" } as const;
	const integration = table("integration", "integration");
	for (const sensitive of ["webhookToken", "providerSpecifics"] as const) {
		for (const candidate of [
			document({
				integrations: rows(integration, {
					fields: [field("value", column(integration, sensitive))],
				}),
			}),
			document({
				integrations: rows(integration, {
					fields: [],
					where: isNotNull(column(integration, sensitive)),
				}),
			}),
		]) {
			expect(validateRyotQLDocument(candidate, userAccess)).toBeNull();
			expect(validateRyotQLDocument(candidate, demo)).toBe(
				`Query 'integrations': Unknown field '${sensitive}' on table 'integration'`,
			);
			expect(validateRyotQLDocument(candidate, { ...demo, audience: "plugin" })).toBe(
				`Query 'integrations': Unknown field '${sensitive}' on table 'integration'`,
			);
		}
	}
	const ordered = document({
		integrations: rows(integration, {
			fields: [],
			orderBy: [ascending(column(integration, "webhookToken"))],
		}),
	});
	expect(validateRyotQLDocument(ordered, userAccess)).toBeNull();
	expect(validateRyotQLDocument(ordered, demo)).toContain("Unknown field 'webhookToken'");
	expect(
		validateRyotQLDocument(
			document({ integrations: rows(integration, { fields: [star(integration)] }) }),
			demo,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				integrations: rows(integration, { fields: [field("name", column(integration, "name"))] }),
			}),
			demo,
		),
	).toBeNull();
});

it("hides admin-only fields of user-visible tables from every user audience", () => {
	for (const [tableName, fieldName] of [
		["user", "authState"],
		["user", "disabledAt"],
		["user", "twoFactorEnabled"],
		["plugin", "environmentConfigRevisionId"],
		["automationTrigger", "payload"],
		["automationTrigger", "createdAt"],
		["automationTrigger", "rootExecutionId"],
		["automationRun", "scriptSlug"],
		["automationRun", "retryPolicy"],
		["automationRun", "sandboxScriptId"],
		["automationRunAttempt", "logs"],
		["automationRunAttempt", "error"],
		["automationRunAttempt", "workflowExecutionId"],
	] as const) {
		const source = table(tableName, "source");
		const query = document({
			rows: rows(source, { fields: [field("value", column(source, fieldName))] }),
		});
		expect(validateRyotQLDocument(query, userAccess)).toBe(
			`Query 'rows': Unknown field '${fieldName}' on table '${tableName}'`,
		);
		expect(
			validateRyotQLDocument(query, { type: "user", audience: "plugin", accessClass: "standard" }),
		).not.toBeNull();
		expect(validateRyotQLDocument(query, { type: "admin" })).toBeNull();
	}
});

it("never exposes script bodies or artifact keys, even to admins", () => {
	for (const [tableName, fieldName, access] of [
		["sandboxScript", "source", { type: "admin" }],
		["sandboxScript", "compiledCode", { type: "admin" }],
		["sandboxScript", "compiled_code", { type: "admin" }],
		["backupRun", "artifactKey", userAccess],
		["backupRun", "artifact_key", userAccess],
	] as const) {
		const source = table(tableName, "source");
		expect(
			validateRyotQLDocument(
				document({ rows: rows(source, { fields: [field("value", column(source, fieldName))] }) }),
				access,
			),
		).toBe(`Query 'rows': Unknown field '${fieldName}' on table '${tableName}'`);
	}
});

it("hides admin-only fields outside admin execution", () => {
	const subscription = table("notificationSubscription", "subscription");
	const selected = document({
		rows: rows(subscription, { fields: [field("userId", column(subscription, "userId"))] }),
	});
	const filtered = document({
		rows: rows(subscription, {
			fields: [],
			where: eq(column(subscription, "userId"), literal("other-user")),
		}),
	});
	for (const audience of ["kernel", "plugin"] as const) {
		for (const candidate of [selected, filtered]) {
			expect(
				validateRyotQLDocument(candidate, { audience, type: "user", accessClass: "standard" }),
			).toBe("Query 'rows': Unknown field 'userId' on table 'notificationSubscription'");
		}
	}
	expect(validateRyotQLDocument(selected, { type: "admin" })).toBeNull();
	expect(validateRyotQLDocument(filtered, { type: "admin" })).toBeNull();
});

it("accepts notification channel descriptions as text fields", () => {
	const channel = table("notificationChannel", "channel");
	expect(
		validateRyotQLDocument(
			document({
				channels: rows(channel, {
					fields: [field("description", column(channel, "description"))],
					where: contains(column(channel, "description"), literal("configured")),
				}),
			}),
			userAccess,
		),
	).toBeNull();
});

it("rejects unknown fields and tables", () => {
	const entity = table("entity", "entity");
	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { fields: [field("secret", column(entity, "secret"))] }) }),
			userAccess,
		),
	).toBe("Query 'entities': Unknown field 'secret' on table 'entity'");

	const auth = table("account", "account");
	expect(
		validateRyotQLDocument(
			document({ accounts: rows(auth, { fields: [field("id", column(auth, "id"))] }) }),
			userAccess,
		),
	).toBe("Query 'accounts': Unknown table 'account'");
});

it("validates join aliases in lexical order", () => {
	const root = table("entity", "root");
	const child = table("entity", "child");
	const future = table("entity", "future");
	const query = rows(root, {
		fields: [],
		joins: [
			join("left", child, {
				operator: "eq",
				type: "comparison",
				left: column(root, "id"),
				right: column(future, "id"),
			}),
		],
	});

	expect(validateRyotQLDocument(document({ entities: query }), userAccess)).toBe(
		"Query 'entities': Unknown table alias 'future'",
	);
});

it("accepts empty fields and rejects retained limits", () => {
	const entity = table("entity", "entity");
	expect(
		validateRyotQLDocument(document({ entities: rows(entity, { fields: [] }) }), userAccess),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { limit: 101, fields: [] }) }),
			userAccess,
		),
	).toBe("Query 'entities': Rows limit must not exceed 100");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [],
					where: { type: "in", values: [], expr: column(entity, "id") },
				}),
			}),
			userAccess,
		),
	).toBeNull();
	expect(literal("unused")).toEqual({ type: "literal", value: "unused" });
});

it("expands qualified wildcards and validates their output keys", () => {
	const entity = table("entity", "entity");
	const joined = table("event", "joined");

	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { fields: [star(entity)] }) }),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, { fields: [star(entity), field("id", column(entity, "id"))] }),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Duplicate output field key 'id'");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [star(joined)],
					joins: [join("inner", joined, eq(column(entity, "id"), column(joined, "entityId")))],
				}),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { fields: [star(joined)] }) }),
			userAccess,
		),
	).toBe("Query 'entities': Unknown table alias 'joined'");
});

it("validates aggregate keys, grouped requirements, ordering, and limits", () => {
	const entity = table("entity", "entity");
	const countMeasure = measure("count", { function: "count" });
	const group = field("name", column(entity, "name"));

	expect(
		validateRyotQLDocument(
			document({ entities: aggregate(entity, { measures: [countMeasure] }) }),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					groupBy: [group],
					measures: [countMeasure],
					orderBy: [measureDescending("count")],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Grouped aggregate outputs require a limit");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, { limit: 10, groupBy: [group], measures: [countMeasure] }),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Grouped aggregate outputs require non-empty orderBy");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 1001,
					groupBy: [group],
					measures: [countMeasure],
					orderBy: [measureDescending("count")],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Grouped aggregate limit must not exceed 1000");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 10,
					groupBy: [group],
					measures: [countMeasure],
					orderBy: [measureDescending("missing")],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Unknown aggregate order key 'missing'");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 10,
					groupBy: [group],
					measures: [countMeasure],
					orderBy: [groupDescending("name")],
				}),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 10,
					measures: [countMeasure],
					orderBy: [groupDescending("metadata")],
					groupBy: [field("metadata", jsonPath(column(entity, "properties"), "metadata"))],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Aggregate group order key 'metadata' must resolve to a scalar value");
	expect(
		validateRyotQLDocument(
			document({
				entities: aggregate(entity, {
					limit: 10,
					measures: [countMeasure],
					orderBy: [measureDescending("count")],
					groupBy: [field("count", column(entity, "name"))],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Duplicate aggregate output key 'count'");
});

it("validates timezone-aware date bucket expressions", () => {
	const entity = table("entity", "entity");
	const query = (expr: Parameters<typeof dateBucket>[0], timeZone = "America/New_York") =>
		document({
			entities: rows(entity, {
				fields: [field("day", dateBucket(expr, { timeZone, bucket: "day" }))],
			}),
		});

	expect(validateRyotQLDocument(query(column(entity, "createdAt")), userAccess)).toBeNull();
	expect(validateRyotQLDocument(query(currentDate()), userAccess)).toBeNull();
	expect(validateRyotQLDocument(query(column(entity, "name")), userAccess)).toBe(
		"Query 'entities': Date buckets require a date expression",
	);
	expect(
		validateRyotQLDocument(query(column(entity, "createdAt"), "Invalid/Zone"), userAccess),
	).toBe("Query 'entities': Invalid date bucket time zone 'Invalid/Zone'");
	expect(validateRyotQLDocument(query(column(entity, "createdAt"), "+05:30"), userAccess)).toBe(
		"Query 'entities': Invalid date bucket time zone '+05:30'",
	);
});

it("types currentDate as a date operand", () => {
	const entity = table("entity", "entity");
	const query = (where: Parameters<typeof rows>[1]["where"]) =>
		document({ entities: rows(entity, { where, fields: [field("today", currentDate())] }) });

	expect(
		validateRyotQLDocument(
			query(eq(castDate(jsonPath(column(entity, "properties"), "date")), currentDate())),
			userAccess,
		),
	).toBeNull();
	expect(validateRyotQLDocument(query(eq(column(entity, "name"), currentDate())), userAccess)).toBe(
		"Query 'entities': Comparison operands must have compatible types",
	);
});

it("validates time-series ranges, expressions, measures, and bucket limits", () => {
	const entity = table("entity", "entity");
	const input = {
		bucket: "day" as const,
		endAt: "2026-01-03T00:00:00.000Z",
		time: column(entity, "createdAt"),
		startAt: "2026-01-01T00:00:00.000Z",
		measure: { function: "count" } as const,
	};

	expect(
		validateRyotQLDocument(document({ entities: timeSeries(entity, input) }), userAccess),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: timeSeries(entity, {
					...input,
					time: castDate(jsonPath(column(entity, "properties"), "publishedAt")),
					measure: {
						function: "sum",
						expr: castNumber(jsonPath(column(entity, "properties"), "duration")),
					},
				}),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({ entities: timeSeries(entity, { ...input, time: column(entity, "name") }) }),
			userAccess,
		),
	).toBe(
		"Query 'entities': Time-series time expressions require a date field or explicit date cast",
	);
	expect(
		validateRyotQLDocument(
			document({ entities: timeSeries(entity, { ...input, endAt: "2026-01-01T00:00:00.000Z" }) }),
			userAccess,
		),
	).toBe("Query 'entities': Time-series range startAt must be before endAt");
	expect(
		validateRyotQLDocument(
			document({ entities: timeSeries(entity, { ...input, endAt: "not-a-date" }) }),
			userAccess,
		),
	).toBe("Query 'entities': Time-series range startAt and endAt must be valid dates");
	expect(
		validateRyotQLDocument(
			document({ entities: timeSeries(entity, { ...input, endAt: "2028-10-01T00:00:00.000Z" }) }),
			userAccess,
		),
	).toBe("Query 'entities': Time-series bucket count exceeds maximum of 1000");
	expect(
		validateRyotQLDocument(
			document({
				entities: timeSeries(entity, {
					...input,
					endAt: "2022-09-27T00:00:00.000500Z",
					startAt: "2020-01-01T01:00:00.000+01:00",
				}),
			}),
			userAccess,
		),
	).toBeNull();
});

it("rejects document and join counts above the retained limits", () => {
	const entity = table("entity", "entity");
	const query = rows(entity, { fields: [] });
	const queries = Object.fromEntries(
		Array.from({ length: 11 }, (_, index) => [`query${index}`, query]),
	);
	expect(validateRyotQLDocument(document(queries), userAccess)).toBe(
		"A RyotQL document may contain at most 10 named queries",
	);

	const joins = Array.from({ length: 9 }, (_, index) => {
		const joined = table("entity", `joined${index}`);
		return join("inner", joined, {
			operator: "eq",
			type: "comparison",
			left: column(entity, "id"),
			right: column(joined, "id"),
		});
	});
	expect(
		validateRyotQLDocument(document({ entities: rows(entity, { joins, fields: [] }) }), userAccess),
	).toBe("Query 'entities': A query may contain at most 8 joins");
});

it("validates nested expression aliases, fields, JSON paths, and scalar kinds", () => {
	const entity = table("entity", "entity");
	const missing = table("entity", "missing");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [
						field("value", castNumber(jsonPath(column(missing, "properties"), "nested", "score"))),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Unknown table alias 'missing'");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [field("value", jsonPath(column(entity, "name"), "nested"))],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': JSON paths require a JSON expression");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [field("constant", literal(true))],
					where: and(
						eq(
							castDate(jsonPath(column(entity, "properties"), "date")),
							castDate(literal("2026-08-07")),
						),
						contains(column(entity, "name"), literal("RyotQL")),
					),
				}),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [],
					where: eq(column(entity, "createdAt"), literal("2026-08-07T12:00:00.000Z")),
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Comparison operands must have compatible types");
});

it("validates scalar operations, recursive predicates, and operand kinds", () => {
	const entity = table("entity", "entity");
	const valid = rows(entity, {
		fields: [
			field("concat", concat(column(entity, "name"), literal(" suffix"))),
			field(
				"conditional",
				conditional(eq(column(entity, "name"), literal("Ryot")), literal("yes"), literal(null)),
			),
			field("title", titleCase(column(entity, "name"))),
			field("kebab", kebabCase(column(entity, "name"))),
			field("round", round(literal(1.5))),
			field("floor", floor(literal(1.5))),
			field("integer", integer(literal(-1.5))),
			field("notNull", isNotNull(column(entity, "name"))),
		],
	});
	expect(validateRyotQLDocument(document({ entities: valid }), userAccess)).toBeNull();

	const missing = table("entity", "missing");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [
						field(
							"value",
							conditional(eq(column(missing, "id"), literal("id")), literal("yes"), literal("no")),
						),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Unknown table alias 'missing'");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, { fields: [field("value", round(column(entity, "name")))] }),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Numeric operands must be numeric: text");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [field("value", titleCase(column(entity, "createdAt")))],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Text operands must be text: date");
});

it("validates include correlation, lexical scopes, keys, limits, and depth", () => {
	const course = table("entity", "course");
	const relationship = table("relationship", "courseModule");
	const module = table("entity", "module");
	const modules = include(relationship, {
		limit: 10,
		key: "modules",
		fields: [field("name", column(module, "name"))],
		orderBy: [{ direction: "asc", expr: column(module, "name") }],
		where: eq(column(relationship, "sourceEntityId"), column(course, "id")),
		joins: [
			join("inner", module, eq(column(relationship, "targetEntityId"), column(module, "id"))),
		],
	});
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, { include: [modules], fields: [field("id", column(course, "id"))] }),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					include: [modules],
					fields: [field("modules", column(course, "id"))],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Duplicate output key 'modules'");

	const unknown = table("entity", "siblingAlias");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						modules,
						include(module, {
							limit: 10,
							fields: [],
							key: "lessons",
							where: eq(column(module, "id"), column(unknown, "id")),
							orderBy: [{ direction: "asc", expr: column(module, "id") }],
						}),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Include 'lessons': Unknown table alias 'siblingAlias'");

	const shadowed = table("entity", "course");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						include(shadowed, {
							limit: 10,
							fields: [],
							key: "shadowed",
							orderBy: [{ direction: "asc", expr: column(shadowed, "id") }],
						}),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Include 'shadowed': Duplicate table alias 'course'");

	const joinedRoot = table("entity", "joinedRoot");
	const tooManyJoins = Array.from({ length: 9 }, (_, index) => {
		const joined = table("entity", `includeJoin${index}`);
		return join("inner", joined, eq(column(joinedRoot, "id"), column(joined, "id")));
	});
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						include(joinedRoot, {
							limit: 10,
							fields: [],
							key: "joined",
							joins: tooManyJoins,
							orderBy: [{ direction: "asc", expr: column(joinedRoot, "id") }],
						}),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Include 'joined': A query may contain at most 8 joins");

	const limited = table("entity", "limited");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [],
					include: [
						include(limited, {
							limit: 101,
							fields: [],
							key: "limited",
							orderBy: [{ direction: "asc", expr: column(limited, "id") }],
						}),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Include limit must not exceed 100");
	expect(
		validateRyotQLDocument(
			document({ courses: rows(course, { fields: [], include: [nested(1)] }) }),
			userAccess,
		),
	).toBe(
		"Query 'courses': Include 'child1': Include 'child2': Include 'child3': Include depth must not exceed 3",
	);
});

it("validates correlated expression scopes and ordering", () => {
	const course = table("entity", "course");
	const event = table("event", "event");
	const relationship = table("relationship", "relationship");
	const related = { where: eq(column(event, "entityId"), column(course, "id")) };
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					where: exists(event, related),
					fields: [
						field("count", count(event, related)),
						field("total", sum(event, jsonPath(column(event, "properties"), "score"), related)),
						field(
							"first",
							first(event, {
								...related,
								select: column(event, "occurredAt"),
								orderBy: [ascending(column(event, "occurredAt"))],
							}),
						),
					],
				}),
			}),
			userAccess,
		),
	).toBeNull();

	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, { fields: [field("duplicate", count(table("event", "course")))] }),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Duplicate table alias 'course'");

	const future = table("event", "future");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [
						field(
							"forward",
							count(event, {
								joins: [
									join("inner", relationship, eq(column(relationship, "id"), column(future, "id"))),
									join("inner", future, eq(column(event, "id"), column(future, "id"))),
								],
							}),
						),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Unknown table alias 'future'");

	const sibling = table("event", "sibling");
	expect(
		validateRyotQLDocument(
			document({
				courses: rows(course, {
					fields: [
						field(
							"unknown",
							count(event, { where: eq(column(event, "id"), column(sibling, "id")) }),
						),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'courses': Unknown table alias 'sibling'");
});

it("types minimum and maximum by their operand kind", () => {
	const event = table("event", "event");
	const latest = table("event", "latest");
	const occurredAt = column(event, "occurredAt");
	const latestOccurredAt = column(latest, "occurredAt");
	const latestName = column(latest, "id");

	expect(
		validateRyotQLDocument(
			document({
				events: rows(event, {
					fields: [],
					where: eq(occurredAt, maximum(latest, latestOccurredAt)),
				}),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				events: rows(event, { fields: [field("earliest", minimum(latest, latestOccurredAt))] }),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				events: rows(event, { fields: [], where: eq(occurredAt, maximum(latest, latestName)) }),
			}),
			userAccess,
		),
	).toBe("Query 'events': Comparison operands must have compatible types");
	expect(
		validateRyotQLDocument(
			document({
				events: rows(event, {
					fields: [],
					where: eq(literal(4), maximum(latest, latestOccurredAt)),
				}),
			}),
			userAccess,
		),
	).toBe("Query 'events': Comparison operands must have compatible types");
});

it("enforces the correlated expression depth limit", () => {
	const root = table("entity", "root");

	expect(
		validateRyotQLDocument(
			document({ root: rows(root, { fields: [], where: nestedExists(1, 3) }) }),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({ root: rows(root, { fields: [], where: nestedExists(1, 4) }) }),
			userAccess,
		),
	).toBe("Query 'root': Correlated query depth must not exceed 3");
});

it("validates JSON array operators, element scope, and outer references", () => {
	const entity = table("entity", "entity");
	const schedule = jsonPath(column(entity, "properties"), "airingSchedule");
	const airingAt = castDate(jsonPath(jsonElement(), "airingAt"));
	const upcoming = gt(airingAt, castDate(literal("2026-09-01T00:00:00.000Z")));
	const nextAiringAt = jsonArrayFirst(schedule, {
		where: upcoming,
		select: airingAt,
		orderBy: [ascending(airingAt)],
	});
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					orderBy: [ascending(nextAiringAt)],
					where: and(
						eq(column(entity, "entitySchemaSlug"), literal("anime")),
						jsonArrayExists(schedule, upcoming),
					),
					fields: [
						field("name", column(entity, "name")),
						field("nextAiringAt", nextAiringAt),
						field("upcomingCount", jsonArrayCount(schedule, upcoming)),
					],
				}),
			}),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, { fields: [field("element", jsonPath(jsonElement(), "airingAt"))] }),
			}),
			userAccess,
		),
	).toBe("Query 'entities': JSON element expressions require a JSON array operator");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [],
					where: jsonArrayExists(column(entity, "name"), upcoming),
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': JSON array operators require a JSON expression");
	expect(
		validateRyotQLDocument(
			document({
				entities: rows(entity, {
					fields: [
						field(
							"next",
							jsonArrayFirst(schedule, {
								where: upcoming,
								select: airingAt,
								orderBy: [ascending(jsonPath(jsonElement(), "airingAt"))],
							}),
						),
					],
				}),
			}),
			userAccess,
		),
	).toBe("Query 'entities': Ordering expressions must resolve to scalar values");
	const nestedJsonArray = (depth: number): ReturnType<typeof jsonArrayExists> =>
		jsonArrayExists(
			jsonArrayFirst(schedule, {
				select: jsonElement(),
				orderBy: [ascending(jsonArrayCount(schedule))],
				...(depth > 0 ? { where: nestedJsonArray(depth - 1) } : {}),
			}),
		);
	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { fields: [], where: nestedJsonArray(1) }) }),
			userAccess,
		),
	).toBeNull();
	expect(
		validateRyotQLDocument(
			document({ entities: rows(entity, { fields: [], where: nestedJsonArray(3) }) }),
			userAccess,
		),
	).toBe("Query 'entities': JSON array depth must not exceed 3");
});
