import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DEFAULT_AUTOMATION_RETRY_POLICY } from "../automations/lifecycle";
import { SANDBOX_HOST_CAPABILITIES, POLICY_SAFE_SANDBOX_CAPABILITIES } from "../sandbox/wire";
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
	automationType: "policy",
	name: "Validate progress",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeRyotql"],
	entry: "backend/policy.sandbox.ts",
	inputProjection: {
		event: { properties: [] },
		entity: { properties: [] },
		relationship: { properties: [] },
	},
} as const;
const afterInputProjection = {
	event: { properties: [], compareProperties: [] },
	entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
} as const;
const authored = {
	boot: [],
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
	metadata: { icon: "box", slug: "test", name: "Test", version: "1", description: "Test" },
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
	it("keeps authored identity independent of target, script, metadata, and ordering", () => {
		const decoded = Schema.decodeUnknownSync(PluginManifest)({
			...manifest,
			hooks: [
				{
					...hook,
					position: 25,
					metadata: { inheritedProperties: ["season"] },
					targets: [
						target,
						{ resource: "entity", operation: "update", entitySchemaSlug: "item" },
						{ operation: "delete", resource: "relationship", relationshipSchemaSlug: "contains" },
					],
				},
			],
		});
		expect(decoded.hooks[0]).toMatchObject({ position: 25, slug: "item.policy" });
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				hooks: [hook, { ...hook, position: 99, targets: [{ ...target, operation: "delete" }] }],
			}),
		).toThrow();
	});

	it("validates declared targets in both authored and archive manifests", () => {
		expect(Schema.decodeUnknownSync(AuthoredPluginManifest)(authored).hooks).toHaveLength(1);
		for (const targets of [
			[],
			[{ ...target, eventSchemaSlug: "absent" }],
			[{ ...target, entitySchemaSlug: "absent" }],
			[{ ...target, operation: "emit" }],
			[{ resource: "entity", operation: "create", entitySchemaSlug: "absent" }],
			[{ operation: "update", resource: "relationship", relationshipSchemaSlug: "absent" }],
		]) {
			expect(() =>
				Schema.decodeUnknownSync(AuthoredPluginManifest)({
					...authored,
					hooks: [{ ...hook, targets }],
				}),
			).toThrow();
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({ ...manifest, hooks: [{ ...hook, targets }] }),
			).toThrow();
		}
	});

	it("allows only policy-safe capabilities before a write", () => {
		for (const capability of SANDBOX_HOST_CAPABILITIES) {
			const candidate = { ...manifest, scripts: [{ ...script, capabilities: [capability] }] };
			if (POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability)) {
				expect(
					Schema.decodeUnknownSync(PluginManifest)(candidate).scripts[0]?.capabilities,
				).toEqual([capability]);
			} else {
				expect(() => Schema.decodeUnknownSync(PluginManifest)(candidate)).toThrow();
			}
		}
	});

	it("resolves kernel collection targets without plugin-owned collection declarations", () => {
		const targets = [
			{ resource: "entity", operation: "update", entitySchemaSlug: "collection" },
			{ ...target, eventSchemaSlug: "review", entitySchemaSlug: "collection" },
			{ operation: "create", resource: "relationship", relationshipSchemaSlug: "member-of" },
		];
		for (const [schema, base] of [
			[AuthoredPluginManifest, authored],
			[PluginManifest, manifest],
		] as const) {
			const candidate = { ...base, hooks: [{ ...hook, targets }] };
			expect(Schema.decodeUnknownSync(schema)(candidate).entitySchemas).toEqual(
				authored.entitySchemas,
			);
			for (const invalidTarget of [
				{ ...target, entitySchemaSlug: "collection" },
				{ ...target, eventSchemaSlug: "review" },
				{ ...target, eventSchemaSlug: "review", entitySchemaSlug: "absent" },
				{ operation: "create", resource: "relationship", relationshipSchemaSlug: "collection" },
			]) {
				expect(() =>
					Schema.decodeUnknownSync(schema)({
						...candidate,
						hooks: [{ ...hook, targets: [invalidTarget] }],
					}),
				).toThrow();
			}
		}
	});

	it("rejects missing, wrong-kind, and wrong-stage script definitions", () => {
		for (const scripts of [
			[],
			[{ ...script, automationType: "automation", inputProjection: afterInputProjection }],
			[{ ...script, automationType: undefined }],
			[{ ...script, kind: "script", automationType: undefined }],
		]) {
			expect(() => Schema.decodeUnknownSync(PluginManifest)({ ...manifest, scripts })).toThrow();
		}
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				hooks: [{ ...hook, stage: "after", delivery: "required" }],
			}),
		).toThrow();
	});

	it("requires hook resources to be covered by the matching script projection", () => {
		for (const inputProjection of [undefined, {}, { entity: undefined }]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					scripts: [{ ...script, inputProjection }],
				}),
			).toThrow();
		}
	});

	it("restricts before-only fields and disallows deferred policy retries", () => {
		for (const addition of [
			{ delivery: "async" },
			{ retry: DEFAULT_AUTOMATION_RETRY_POLICY },
			{ position: 1.5 },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					hooks: [{ ...hook, ...addition }],
				}),
			).toThrow();
		}
		const after = {
			...manifest,
			hooks: [{ ...hook, stage: "after", delivery: "async" }],
			scripts: [{ ...script, automationType: "automation", inputProjection: afterInputProjection }],
		};
		expect(Schema.decodeUnknownSync(PluginManifest)(after).hooks).toHaveLength(1);
		for (const addition of [
			{ position: 1 },
			{ batchFrequency: "item" },
			{ batchFrequency: "once-per-subject" },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...after,
					hooks: [{ ...after.hooks[0], ...addition }],
				}),
			).toThrow();
		}
	});

	it("permits subject batching only for before-event targets and validates source filters", () => {
		expect(
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				hooks: [
					{
						...hook,
						batchFrequency: "once-per-subject",
						causationSources: ["api", "provider-refresh"],
					},
				],
			}).hooks,
		).toHaveLength(1);
		for (const change of [
			{ targets: [{ resource: "entity", operation: "create", entitySchemaSlug: "item" }] },
			{ causationSources: [] },
			{ causationSources: ["provider_refresh"] },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					hooks: [{ ...hook, batchFrequency: "once-per-subject", ...change }],
				}),
			).toThrow();
		}
	});

	it("restricts batch frequency and execution scope to after hooks with mutation targets", () => {
		const after = {
			...manifest,
			hooks: [{ ...hook, stage: "after", delivery: "async" }],
			scripts: [{ ...script, automationType: "automation", inputProjection: afterInputProjection }],
		};
		for (const addition of [
			{ frequency: "item" },
			{ frequency: "batch" },
			{ executionScope: "user" },
			{ executionScope: "global" },
		]) {
			expect(
				Schema.decodeUnknownSync(PluginManifest)({
					...after,
					hooks: [{ ...after.hooks[0], ...addition }],
				}).hooks,
			).toHaveLength(1);
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					hooks: [{ ...hook, ...addition }],
				}),
			).toThrow();
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
				Schema.decodeUnknownSync(PluginManifest)({
					...candidate,
					hooks: [{ ...candidate.hooks[0], executionScope: "user" }],
				}).hooks,
			).toHaveLength(1);
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...candidate,
					hooks: [{ ...candidate.hooks[0], frequency: "batch" }],
				}),
			).toThrow();
		}
	});

	it("requires external idempotency opt-in for automatic HTTP and notification retries", () => {
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
			expect(Schema.decodeUnknownSync(PluginManifest)(after).hooks).toHaveLength(1);
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...after,
					hooks: [
						{ ...after.hooks[0], retry: { ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 3 } },
					],
				}),
			).toThrow();
			expect(
				Schema.decodeUnknownSync(PluginManifest)({
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
				}).hooks,
			).toHaveLength(1);
		}
	});

	it("binds signal notifications to an after hook targeting that signal", () => {
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
			Schema.decodeUnknownSync(PluginManifest)(candidate).signalSchemas[0]?.notificationHookSlug,
		).toBe("item.notify");
		for (const change of [
			{ hooks: [{ ...notification, targets: [target] }] },
			{ hooks: [{ ...notification, stage: "before", delivery: undefined }] },
			{ signalSchemas: [{ ...signal, notificationHookSlug: "policy" }] },
		]) {
			expect(() => Schema.decodeUnknownSync(PluginManifest)({ ...candidate, ...change })).toThrow();
		}
	});

	it("accepts provider completion only as an after fact for a declared entity schema", () => {
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
						{ operation: "complete", entitySchemaSlug: "item", resource: "provider-entity-import" },
					],
				},
			],
		};
		expect(Schema.decodeUnknownSync(PluginManifest)(after).hooks).toHaveLength(1);
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...after,
				hooks: [{ ...hook, targets: after.hooks[0]?.targets }],
			}),
		).toThrow();
	});
});
