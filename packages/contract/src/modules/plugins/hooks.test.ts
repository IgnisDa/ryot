import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { DEFAULT_AUTOMATION_RETRY_POLICY } from "../automations/lifecycle";
import { POLICY_SAFE_SANDBOX_CAPABILITIES, SANDBOX_HOST_CAPABILITIES } from "../scripts/wire";
import { AuthoredPluginManifest, PluginManifest } from "./manifest";

const target = {
	resource: "event",
	operation: "create",
	entitySchemaSlug: "item",
	eventSchemaSlug: "progress",
} as const;
const hook = {
	stage: "before",
	targets: [target],
	slug: "item.policy",
	scriptSlug: "policy",
	name: "Validate progress",
} as const;
const script = {
	slug: "policy",
	kind: "automation",
	runtimeImports: [],
	automationType: "policy",
	name: "Validate progress",
	oauthConnectionFields: [],
	executableDependencies: [],
	requiredPluginConfigKeys: [],
	optionalPluginConfigKeys: [],
	capabilities: ["executeRyotql"],
	entry: "backend/policy.sandbox.ts",
	inputProjection: {
		event: { properties: [] },
		entity: { properties: [] },
		relationship: { properties: [] },
	},
} as const;
const registeredScript = (
	slug: string,
	capabilities: ReadonlyArray<string> = [],
	executableDependencies: ReadonlyArray<{
		readonly slug: string;
		readonly kind: "script" | "workflow";
	}> = [],
) => ({
	slug,
	name: slug,
	capabilities,
	runtimeImports: [],
	executableDependencies,
	kind: "script" as const,
	oauthConnectionFields: [],
	requiredPluginConfigKeys: [],
	optionalPluginConfigKeys: [],
	entry: `backend/${slug}.sandbox.ts`,
});
const afterInputProjection = {
	event: { properties: [], compareProperties: [] },
	entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
} as const;
const authored = {
	crons: [],
	hooks: [hook],
	workflows: [],
	providers: [],
	savedViews: [],
	operations: [],
	signalSchemas: [],
	importSources: [],
	userBootstrap: [],
	httpRateLimits: [],
	integrationProviders: [],
	configSchema: { fields: {}, unknownKeys: "strict" },
	metadata: {
		icon: "box",
		name: "Test",
		version: "1",
		description: "Test",
		packageId: "test/contract",
	},
	relationshipSchemas: [
		{
			slug: "contains",
			name: "Contains",
			sourceEntitySchemaSlug: "item",
			targetEntitySchemaSlug: "item",
			propertiesSchema: { fields: {} },
		},
	],
	entitySchemas: [
		{
			icon: "box",
			slug: "item",
			name: "Item",
			propertiesSchema: { fields: {} },
			eventSchemas: [{ slug: "progress", name: "Progress", propertiesSchema: { fields: {} } }],
		},
	],
} as const;
const manifest = { ...authored, scripts: [script] };

describe("lifecycle hook declarations", () => {
	it.effect("keeps authored identity independent of target, script, metadata, and ordering", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeEffect(PluginManifest)({
				...manifest,
				hooks: [
					{
						...hook,
						position: 25,
						metadata: { inheritedProperties: ["part"] },
						targets: [
							target,
							{ resource: "entity", operation: "update", entitySchemaSlug: "item" },
							{ operation: "delete", resource: "relationship", relationshipSchemaSlug: "contains" },
						],
					},
				],
			});
			expect(decoded.hooks[0]).toMatchObject({ position: 25, slug: "item.policy" });
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					hooks: [hook, { ...hook, position: 99, targets: [{ ...target, operation: "delete" }] }],
				}),
			);
		}),
	);

	it.effect("validates declared targets in both authored and archive manifests", () =>
		Effect.gen(function* () {
			expect((yield* Schema.decodeEffect(AuthoredPluginManifest)(authored)).hooks).toHaveLength(1);
			for (const targets of [
				[],
				[{ ...target, eventSchemaSlug: "absent" }],
				[{ ...target, entitySchemaSlug: "absent" }],
				[{ ...target, operation: "emit" }],
				[{ resource: "entity", operation: "create", entitySchemaSlug: "absent" }],
				[{ operation: "update", resource: "relationship", relationshipSchemaSlug: "absent" }],
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(AuthoredPluginManifest)({
						...authored,
						hooks: [{ ...hook, targets }],
					}),
				);
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({
						...manifest,
						hooks: [{ ...hook, targets }],
					}),
				);
			}
		}),
	);

	it.effect("allows only policy-safe capabilities before a write", () =>
		Effect.gen(function* () {
			for (const capability of SANDBOX_HOST_CAPABILITIES) {
				const candidate = { ...manifest, scripts: [{ ...script, capabilities: [capability] }] };
				if (POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability)) {
					expect(
						(yield* Schema.decodeUnknownEffect(PluginManifest)(candidate)).scripts[0]?.capabilities,
					).toEqual([capability]);
				} else {
					yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)(candidate));
				}
			}
		}),
	);

	it.effect("resolves plugin-owned collection targets", () =>
		Effect.gen(function* () {
			const targets = [
				{ resource: "entity", operation: "update", entitySchemaSlug: "collection" },
				{ ...target, eventSchemaSlug: "review", entitySchemaSlug: "collection" },
				{ operation: "create", resource: "relationship", relationshipSchemaSlug: "member-of" },
			];
			const collection = {
				icon: "box",
				slug: "collection",
				name: "Collection",
				propertiesSchema: { fields: {} },
				eventSchemas: [{ slug: "review", name: "Review", propertiesSchema: { fields: {} } }],
			};
			const membership = {
				slug: "member-of",
				name: "Member of",
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: "collection",
				targetEntitySchemaSlug: "collection",
			};
			for (const [schema, base] of [
				[AuthoredPluginManifest, authored],
				[PluginManifest, manifest],
			] as const) {
				const entitySchemas = [...base.entitySchemas, collection];
				const candidate = {
					...base,
					entitySchemas,
					hooks: [{ ...hook, targets }],
					relationshipSchemas: [...base.relationshipSchemas, membership],
				};
				expect((yield* Schema.decodeUnknownEffect(schema)(candidate)).entitySchemas).toEqual(
					entitySchemas,
				);
				for (const invalidTarget of [
					{ ...target, entitySchemaSlug: "absent" },
					{ ...target, eventSchemaSlug: "absent" },
					{ ...target, entitySchemaSlug: "item", eventSchemaSlug: "review" },
					{ operation: "create", resource: "relationship", relationshipSchemaSlug: "absent" },
				]) {
					yield* Effect.flip(
						Schema.decodeUnknownEffect(schema)({
							...candidate,
							hooks: [{ ...hook, targets: [invalidTarget] }],
						}),
					);
				}
			}
		}),
	);

	it.effect("rejects missing, wrong-kind, and wrong-stage script definitions", () =>
		Effect.gen(function* () {
			for (const scripts of [
				[],
				[{ ...script, automationType: "automation", inputProjection: afterInputProjection }],
				[{ ...script, automationType: undefined }],
				[{ ...script, kind: "script", automationType: undefined }],
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)({ ...manifest, scripts }));
			}
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					hooks: [{ ...hook, stage: "after", delivery: "required" }],
				}),
			);
		}),
	);

	it.effect("requires hook resources to be covered by the matching script projection", () =>
		Effect.gen(function* () {
			for (const inputProjection of [undefined, {}, { entity: undefined }]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({
						...manifest,
						scripts: [{ ...script, inputProjection }],
					}),
				);
			}
		}),
	);

	it.effect("restricts before-only fields and disallows deferred policy retries", () =>
		Effect.gen(function* () {
			for (const addition of [
				{ delivery: "async" },
				{ retry: DEFAULT_AUTOMATION_RETRY_POLICY },
				{ position: 1.5 },
				{ batchMaxItems: 50 },
			]) {
				yield* Effect.flip(
					Schema.decodeEffect(PluginManifest)({ ...manifest, hooks: [{ ...hook, ...addition }] }),
				);
			}
			const after = {
				...manifest,
				hooks: [{ ...hook, stage: "after", delivery: "async" }],
				scripts: [
					{ ...script, automationType: "automation", inputProjection: afterInputProjection },
				],
			};
			expect((yield* Schema.decodeUnknownEffect(PluginManifest)(after)).hooks).toHaveLength(1);
			for (const addition of [
				{ position: 1 },
				{ batchFrequency: "item" },
				{ batchFrequency: "once-per-subject" },
				{ batchMaxItems: 50 },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({
						...after,
						hooks: [{ ...after.hooks[0], ...addition }],
					}),
				);
			}
		}),
	);

	it.effect("allows a safe per-hook item cap only on after batch hooks", () =>
		Effect.gen(function* () {
			const after = {
				...manifest,
				hooks: [{ ...hook, stage: "after", delivery: "async", frequency: "batch" }],
				scripts: [
					{ ...script, automationType: "automation", inputProjection: afterInputProjection },
				],
			};
			for (const batchMaxItems of [1, 50, 1_000]) {
				const decoded = yield* Schema.decodeUnknownEffect(PluginManifest)({
					...after,
					hooks: [{ ...after.hooks[0], batchMaxItems }],
				});
				expect(decoded.hooks[0]).toMatchObject({ batchMaxItems, frequency: "batch" });
			}
			for (const invalidHook of [
				{ ...after.hooks[0], frequency: "item", batchMaxItems: 50 },
				{ ...after.hooks[0], batchMaxItems: 0 },
				{ ...after.hooks[0], batchMaxItems: 1.5 },
				{ ...after.hooks[0], batchMaxItems: 1_001 },
				{ ...after.hooks[0], batchMaxItems: Number.MAX_SAFE_INTEGER + 1 },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({ ...after, hooks: [invalidHook] }),
				);
			}
		}),
	);

	it.effect(
		"permits subject batching only for before-event targets and validates source filters",
		() =>
			Effect.gen(function* () {
				expect(
					(yield* Schema.decodeEffect(PluginManifest)({
						...manifest,
						hooks: [
							{
								...hook,
								batchFrequency: "once-per-subject",
								causationSources: ["api", "provider-refresh"],
							},
						],
					})).hooks,
				).toHaveLength(1);
				for (const change of [
					{ targets: [{ resource: "entity", operation: "create", entitySchemaSlug: "item" }] },
					{ causationSources: [] },
					{ causationSources: ["provider_refresh"] },
				]) {
					yield* Effect.flip(
						Schema.decodeUnknownEffect(PluginManifest)({
							...manifest,
							hooks: [{ ...hook, batchFrequency: "once-per-subject", ...change }],
						}),
					);
				}
			}),
	);

	it.effect(
		"restricts batch frequency and execution scope to after hooks with mutation targets",
		() =>
			Effect.gen(function* () {
				const after = {
					...manifest,
					hooks: [{ ...hook, stage: "after", delivery: "async" }],
					scripts: [
						{ ...script, automationType: "automation", inputProjection: afterInputProjection },
					],
				};
				for (const addition of [
					{ frequency: "item" },
					{ frequency: "batch" },
					{ executionScope: "user" },
					{ executionScope: "global" },
				]) {
					expect(
						(yield* Schema.decodeUnknownEffect(PluginManifest)({
							...after,
							hooks: [{ ...after.hooks[0], ...addition }],
						})).hooks,
					).toHaveLength(1);
					yield* Effect.flip(
						Schema.decodeEffect(PluginManifest)({ ...manifest, hooks: [{ ...hook, ...addition }] }),
					);
				}
				const nonBatchable = [
					{
						...after,
						hooks: [
							{
								...after.hooks[0],
								targets: [{ operation: "emit", resource: "signal", signalSchemaSlug: "changed" }],
							},
						],
						scripts: [
							{
								...script,
								automationType: "automation",
								capabilities: ["sendNotification"],
								inputProjection: { signal: { properties: [] } },
							},
						],
						signalSchemas: [
							{
								slug: "changed",
								name: "Changed",
								catalogState: "active",
								propertiesSchema: { fields: {} },
								audiencePolicy: { kind: "actor" },
								notificationHookSlug: "item.policy",
							},
						],
					},
					{
						...after,
						scripts: [
							{
								...script,
								automationType: "automation",
								inputProjection: { providerEntityImport: true },
							},
						],
						hooks: [
							{
								...after.hooks[0],
								targets: [
									{
										operation: "complete",
										entitySchemaSlug: "item",
										resource: "provider-entity-import",
									},
								],
							},
						],
					},
				];
				for (const candidate of nonBatchable) {
					expect(
						(yield* Schema.decodeUnknownEffect(PluginManifest)({
							...candidate,
							hooks: [{ ...candidate.hooks[0], executionScope: "user" }],
						})).hooks,
					).toHaveLength(1);
					yield* Effect.flip(
						Schema.decodeUnknownEffect(PluginManifest)({
							...candidate,
							hooks: [{ ...candidate.hooks[0], frequency: "batch" }],
						}),
					);
				}
			}),
	);

	it.effect(
		"requires external idempotency opt-in for automatic HTTP and notification retries",
		() =>
			Effect.gen(function* () {
				for (const capability of ["httpCall", "sendNotification"]) {
					const after = {
						...manifest,
						hooks: [{ ...hook, stage: "after", delivery: "required" }],
						scripts: [
							{
								...script,
								capabilities: [capability],
								automationType: "automation",
								inputProjection: afterInputProjection,
							},
						],
					};
					expect((yield* Schema.decodeUnknownEffect(PluginManifest)(after)).hooks).toHaveLength(1);
					yield* Effect.flip(
						Schema.decodeUnknownEffect(PluginManifest)({
							...after,
							hooks: [
								{
									...after.hooks[0],
									retry: { ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 3 },
								},
							],
						}),
					);
					expect(
						(yield* Schema.decodeUnknownEffect(PluginManifest)({
							...after,
							hooks: [
								{
									...after.hooks[0],
									retry: {
										...DEFAULT_AUTOMATION_RETRY_POLICY,
										maxAttempts: 3,
										externalIdempotency: "run-id",
									},
								},
							],
						})).hooks,
					).toHaveLength(1);
				}
			}),
	);

	it.effect("requires idempotency for external effects in any registered child alternative", () =>
		Effect.gen(function* () {
			for (const capability of ["httpCall", "sendNotification"] as const) {
				const retry = { ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 3 };
				const candidate = {
					...manifest,
					workflows: [{ slug: "nested", scriptSlug: "nested-workflow" }],
					hooks: [{ ...hook, retry, stage: "after", delivery: "required" }],
					scripts: [
						{
							...script,
							capabilities: [],
							automationType: "automation",
							inputProjection: afterInputProjection,
							executableDependencies: [
								{
									kind: "script",
									slug: "delegate",
									selection: { id: "path", key: "delegated", stage: "settings" },
								},
								{
									slug: "safe",
									kind: "script",
									selection: { id: "path", key: "local", stage: "settings" },
								},
							],
						},
						registeredScript("delegate", [], [{ slug: "nested", kind: "workflow" }]),
						registeredScript("safe"),
						{
							...registeredScript("nested-workflow", [], [{ kind: "script", slug: "effect" }]),
							kind: "workflow" as const,
						},
						registeredScript("effect", [capability]),
					],
				};
				yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)(candidate));
				const decoded = yield* Schema.decodeUnknownEffect(PluginManifest)({
					...candidate,
					hooks: [{ ...candidate.hooks[0], retry: { ...retry, externalIdempotency: "run-id" } }],
				});
				expect(decoded.scripts.find(({ slug }) => slug === "policy")?.capabilities).toEqual([]);
			}
		}),
	);

	it.effect("rejects unresolved delegated script and workflow targets", () =>
		Effect.gen(function* () {
			for (const dependency of [
				{ kind: "script", slug: "missing-script" },
				{ kind: "workflow", slug: "missing-workflow" },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({
						...manifest,
						scripts: [
							{
								...script,
								automationType: "automation",
								executableDependencies: [dependency],
								inputProjection: afterInputProjection,
							},
						],
						hooks: [
							{
								...hook,
								stage: "after",
								delivery: "required",
								retry: {
									...DEFAULT_AUTOMATION_RETRY_POLICY,
									maxAttempts: 3,
									externalIdempotency: "run-id",
								},
							},
						],
					}),
				);
			}
		}),
	);

	it.effect("binds signal notifications to an after hook targeting that signal", () =>
		Effect.gen(function* () {
			const signal = {
				slug: "changed",
				name: "Changed",
				catalogState: "active",
				propertiesSchema: { fields: {} },
				audiencePolicy: { kind: "actor" },
				notificationHookSlug: "item.notify",
			};
			const notification = {
				...hook,
				stage: "after",
				delivery: "async",
				slug: "item.notify",
				targets: [{ operation: "emit", resource: "signal", signalSchemaSlug: "changed" }],
			};
			const candidate = {
				...manifest,
				hooks: [notification],
				signalSchemas: [signal],
				scripts: [
					{
						...script,
						automationType: "automation",
						capabilities: ["sendNotification"],
						inputProjection: { signal: { properties: [] } },
					},
				],
			};
			expect(
				(yield* Schema.decodeUnknownEffect(PluginManifest)(candidate)).signalSchemas[0]
					?.notificationHookSlug,
			).toBe("item.notify");
			for (const change of [
				{ hooks: [{ ...notification, targets: [target] }] },
				{ hooks: [{ ...notification, stage: "before", delivery: undefined }] },
				{ signalSchemas: [{ ...signal, notificationHookSlug: "policy" }] },
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)({ ...candidate, ...change }));
			}
		}),
	);

	it.effect("accepts provider completion only as an after fact for a declared entity schema", () =>
		Effect.gen(function* () {
			const after = {
				...manifest,
				scripts: [
					{
						...script,
						automationType: "automation",
						inputProjection: { providerEntityImport: true },
					},
				],
				hooks: [
					{
						...hook,
						stage: "after",
						delivery: "required",
						targets: [
							{
								operation: "complete",
								entitySchemaSlug: "item",
								resource: "provider-entity-import",
							},
						],
					},
				],
			};
			expect((yield* Schema.decodeUnknownEffect(PluginManifest)(after)).hooks).toHaveLength(1);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...after,
					hooks: [{ ...hook, targets: after.hooks[0]?.targets }],
				}),
			);
		}),
	);
});
