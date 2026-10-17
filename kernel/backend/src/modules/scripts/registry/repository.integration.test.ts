import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxExecutionSubject } from "@ryot-app/contract/modules/scripts/schemas";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { assert, describe } from "vitest";

import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import { SandboxExecutionAuthorityLive } from "../authorization/authority";
import {
	ScriptExecutionPrincipal,
	type ScriptInstallationInitialization,
	type ScriptPluginRevision,
} from "../authorization/principal";
import { SandboxRepository } from "./repository";

type ScriptPin = NonNullable<
	Effect.Success<ReturnType<SandboxRepository["Service"]["getScriptPin"]>>
>;

type ExpectedRevision = Pick<ScriptPluginRevision, "id" | "revisionId" | "configRevisionId">;

type Scope = "system" | "user";

type World = {
	readonly userId: UserId;
	readonly pluginId: string;
	readonly slug: string;
	readonly installationId: string;
	readonly revisionId: string;
	readonly activationId: string;
	readonly packageId: PluginPackageId;
	readonly scope: Scope;
	readonly scripts: { readonly task: SandboxScriptId; readonly details: SandboxScriptId };
};

const bootstrapPackage = (slug: string, version: string, packageId: PluginPackageId) => {
	const value = revisionPackage(slug, version, `${slug}-entity`, packageId);
	return {
		...value,
		manifest: {
			...value.manifest,
			userBootstrap: [
				{ description: "Bootstrap", slug: `${slug}-bootstrap`, scriptSlug: `${slug}.task` },
			],
		},
	};
};

const persistPackage = Effect.fn(function* (
	scope: Scope,
	userId: UserId,
	slug: string,
	version: string,
	packageId: PluginPackageId,
	pluginId?: string,
) {
	const session = yield* DatabaseSession;
	const plugins = yield* PluginRepository;
	const installations = yield* PluginInstallationRepository;
	return yield* session
		.transaction(
			Effect.gen(function* () {
				yield* plugins.lockIngestion();
				const persistedId = yield* plugins.persist(bootstrapPackage(slug, version, packageId), {
					...(pluginId === undefined ? {} : { pluginId }),
					...(scope === "user"
						? { scope: "user", ownerId: userId }
						: { ownerId: null, scope: "system" }),
				});
				if (scope === "system") {
					yield* plugins.resolveEnvironmentConfigs();
				}
				const installation = yield* installations.upsertState({
					userId,
					config: {},
					sortOrder: 0,
					health: "ready",
					isHidden: false,
					pluginId: persistedId,
				});
				assert(installation);
				return { pluginId: persistedId, installationId: installation.id };
			}),
		)
		.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
});

const createWorld = Effect.fn(function* (scope: Scope) {
	const session = yield* DatabaseSession;
	const slug = `pin-${crypto.randomUUID()}`;
	const userId = UserId.make(`user-${slug}`);
	yield* session.run((db) =>
		db
			.insert(schema.user)
			.values({
				id: userId,
				name: userId,
				email: `${userId}@example.test`,
				accountGeneration: `generation-${userId}`,
			}),
	);
	const packageId = PluginPackageId.make(`test/${crypto.randomUUID()}`);
	const { pluginId, installationId } = yield* persistPackage(scope, userId, slug, "v1", packageId);
	const [plugin] = yield* session.run((db) =>
		db.select().from(schema.plugin).where(eq(schema.plugin.id, pluginId)),
	);
	assert(plugin?.activeRevisionId);
	const revisionId = plugin.activeRevisionId;
	const rows = yield* session.run((db) =>
		db
			.select({ id: schema.sandboxScript.id, slug: schema.sandboxScript.slug })
			.from(schema.sandboxScript)
			.where(eq(schema.sandboxScript.pluginRevisionId, revisionId)),
	);
	const scriptId = (scriptSlug: string) => {
		const row = rows.find((candidate) => candidate.slug === scriptSlug);
		assert(row);
		return SandboxScriptId.make(row.id);
	};
	return {
		slug,
		scope,
		userId,
		pluginId,
		packageId,
		revisionId,
		installationId,
		activationId: plugin.activationId,
		scripts: { task: scriptId(`${slug}.task`), details: scriptId(`${slug}.details`) },
	} satisfies World;
});

const userSubject = (userId: UserId, token = `generation-${userId}`) =>
	({ userId, type: "user", accountGeneration: { token, userId } }) as const;

const automationSubject = (executionUserId: UserId | null) =>
	Schema.decodeSync(SandboxExecutionSubject)({
		stage: "after",
		pluginId: null,
		executionUserId,
		runId: "pin-run",
		delivery: "async",
		pluginRevisionId: null,
		type: "automation-run",
		triggerId: "pin-trigger",
		pluginConfigRevisionId: null,
		accountGeneration:
			executionUserId === null
				? null
				: { userId: executionUserId, token: `generation-${executionUserId}` },
		causation: {
			depth: 0,
			source: "api",
			parentRunId: null,
			lane: "background",
			parentTriggerId: null,
			executionId: "pin-execution",
			rootExecutionId: "pin-execution",
			initiator: { id: null, kind: "system" },
		},
	});

const subjectsFor = (world: World): ReadonlyArray<SandboxExecutionSubject | undefined> => [
	undefined,
	{ type: "system" },
	userSubject(world.userId),
	automationSubject(world.userId),
	automationSubject(null),
	userSubject(UserId.make("recipient"), "test-account-generation"),
];

const modes = [
	{ exact: "current", initialized: false },
	{ exact: "current", initialized: true },
	{ exact: "pinned", initialized: false },
	{ exact: "pinned", initialized: true },
	{ exact: "foreign", initialized: false },
	{ exact: "foreign", initialized: true },
] as const;

type Mode = (typeof modes)[number];

const outcomeCode = (exit: Exit.Exit<ScriptPin | null, unknown>) => {
	if (Exit.isSuccess(exit)) {
		return exit.value === null ? "-" : "P";
	}
	const error = Option.getOrUndefined(Exit.findErrorOption(exit));
	assert(error instanceof SandboxRunError);
	return error.data?.["code"] === "package-identity-conflict" ? "C" : "U";
};

const expectedFor = (
	mode: Mode,
	expected: ExpectedRevision,
	foreignConfigRevisionId: PluginConfigRevisionId,
) => {
	if (mode.exact === "current") {
		return undefined;
	}
	return mode.exact === "pinned"
		? expected
		: { ...expected, configRevisionId: foreignConfigRevisionId };
};

const outcomesFor = Effect.fn(function* (input: {
	readonly scripts: Readonly<Record<string, SandboxScriptId>>;
	readonly subjects: ReadonlyArray<SandboxExecutionSubject | undefined>;
	readonly expected: ExpectedRevision;
	readonly binding: ScriptInstallationInitialization;
	readonly foreignConfigRevisionId: PluginConfigRevisionId;
	readonly verifyPin: (pin: ScriptPin, scriptName: string, mode: Mode) => void;
}) {
	const repository = yield* SandboxRepository;
	const outcomes: Record<string, string> = {};
	for (const [scriptName, scriptId] of Object.entries(input.scripts)) {
		const groups: Array<string> = [];
		for (const subject of input.subjects) {
			let group = "";
			for (const mode of modes) {
				const initialization = mode.initialized ? input.binding : undefined;
				const exit = yield* Effect.exit(
					repository.getScriptPin(
						scriptId,
						expectedFor(mode, input.expected, input.foreignConfigRevisionId),
						subject,
						initialization,
					),
				);
				if (Exit.isSuccess(exit) && exit.value !== null) {
					expect(exit.value.scriptId).toBe(scriptId);
					if (initialization) {
						expect(exit.value).toMatchObject({ initialization });
					} else {
						expect(exit.value).not.toHaveProperty("initialization");
					}
					input.verifyPin(exit.value, scriptName, mode);
				}
				group += outcomeCode(exit);
			}
			groups.push(group);
		}
		outcomes[scriptName] = groups.join(" ");
	}
	return outcomes;
});

type Database = Parameters<Parameters<DatabaseSession["Service"]["run"]>[0]>[0];

const run = <A, E, R>(operation: (db: Database) => Effect.Effect<A, E, R>) =>
	Effect.flatMap(DatabaseSession, (session) => session.run(operation));

const setInstallation = (
	world: World,
	values: PgUpdateSetSource<typeof schema.pluginInstallation>,
) =>
	run((db) =>
		db
			.update(schema.pluginInstallation)
			.set(values)
			.where(eq(schema.pluginInstallation.id, world.installationId)),
	);

const setPlugin = (world: World, values: PgUpdateSetSource<typeof schema.plugin>) =>
	run((db) => db.update(schema.plugin).set(values).where(eq(schema.plugin.id, world.pluginId)));

const setUser = (world: World, values: PgUpdateSetSource<typeof schema.user>) =>
	run((db) => db.update(schema.user).set(values).where(eq(schema.user.id, world.userId)));

const currentConfigId = Effect.fn(function* (world: World) {
	const [row] = yield* run((db) =>
		db
			.select({
				environment: schema.plugin.environmentConfigRevisionId,
				installation: schema.pluginInstallation.activeConfigRevisionId,
			})
			.from(schema.plugin)
			.leftJoin(schema.pluginInstallation, eq(schema.pluginInstallation.id, world.installationId))
			.where(eq(schema.plugin.id, world.pluginId)),
	);
	return world.scope === "user" ? row?.installation : row?.environment;
});

const activeConfigId = Effect.fn(function* (world: World) {
	const id = yield* currentConfigId(world);
	assert(id);
	return id;
});

const initializing = { isHidden: true, health: "installing", isInitialized: false } as const;

const deleteScripts = (world: World, slugs: ReadonlyArray<string>) =>
	Effect.forEach(slugs, (slug) =>
		run((db) =>
			db
				.delete(schema.sandboxScript)
				.where(
					and(
						eq(schema.sandboxScript.pluginRevisionId, world.revisionId),
						eq(schema.sandboxScript.slug, `${world.slug}.${slug}`),
					),
				),
		),
	);

const packageMutations = new Set(["updated", "scriptDeleted", "siblingsDeleted"]);

const supersede = (world: World) =>
	persistPackage(world.scope, world.userId, world.slug, "v2", world.packageId, world.pluginId);

const mutations = {
	ready: () => Effect.void,
	updated: (world: World) => supersede(world),
	initializing: (world: World) => setInstallation(world, initializing),
	hidden: (world: World) => setInstallation(world, { isHidden: true }),
	accountDisabled: (world: World) => setUser(world, { disabledAt: new Date(0) }),
	incompatible: (world: World) => setInstallation(world, { health: "incompatible" }),
	generationChanged: (world: World) => setUser(world, { accountGeneration: "rotated" }),
	initialized: (world: World) => setInstallation(world, { ...initializing, isInitialized: true }),
	needsConfiguration: (world: World) => setInstallation(world, { health: "needs-configuration" }),
	scriptDeleted: (world: World) =>
		Effect.andThen(supersede(world), deleteScripts(world, ["details"])),
	userDeleted: (world: World) =>
		run((db) => db.delete(schema.user).where(eq(schema.user.id, world.userId))),
	inactive: (world: World) =>
		Effect.flatMap(PluginRepository, (plugins) => plugins.deactivate(world.pluginId)),
	pluginDeleted: (world: World) =>
		run((db) => db.delete(schema.plugin).where(eq(schema.plugin.id, world.pluginId))),
	siblingsDeleted: (world: World) =>
		Effect.andThen(supersede(world), deleteScripts(world, ["automation", "search", "workflow"])),
	uninstalled: (world: World) =>
		Effect.flatMap(PluginInstallationRepository, (installations) =>
			installations.remove(world.installationId),
		),
	identityConflict: (world: World) =>
		setInstallation(world, {
			health: "incompatible",
			incompatibilityReason: "package-identity-conflict",
		}),
	disabledInitializing: (world: World) =>
		Effect.andThen(
			setUser(world, { disabledAt: new Date(0) }),
			setInstallation(world, initializing),
		),
	activationRotated: (world: World) =>
		Effect.andThen(
			setInstallation(world, initializing),
			setPlugin(world, { activationId: sql`gen_random_uuid()::text` }),
		),
	generationChangedUninstalled: (world: World) =>
		Effect.andThen(
			setUser(world, { accountGeneration: "rotated" }),
			setInstallation(world, { uninstalledAt: new Date(0) }),
		),
	disabledHiddenUninstalled: (world: World) =>
		Effect.andThen(
			setUser(world, { disabledAt: new Date(0) }),
			setInstallation(world, { isHidden: true, uninstalledAt: new Date(0) }),
		),
	inactiveConflict: (world: World) =>
		Effect.andThen(
			setPlugin(world, { status: "inactive" }),
			setInstallation(world, {
				health: "incompatible",
				incompatibilityReason: "package-identity-conflict",
			}),
		),
	configPruned: (world: World) =>
		Effect.flatMap(activeConfigId(world), (id) =>
			run((db) =>
				db
					.update(schema.pluginConfigRevision)
					.set({ encryptedPayload: null, payloadPrunedAt: new Date(0) })
					.where(eq(schema.pluginConfigRevision.id, id)),
			),
		),
	configChanged: (world: World) =>
		Effect.gen(function* () {
			const previous = yield* activeConfigId(world);
			if (world.scope === "user") {
				const installations = yield* PluginInstallationRepository;
				yield* installations.updateState({
					sortOrder: 0,
					isHidden: false,
					id: world.installationId,
					config: { token: "changed" },
				});
				return;
			}
			const next = `${previous}-next`;
			yield* run((db) =>
				db.execute(
					sql`insert into plugin_config_revision (id, nonce, encrypted_payload, encryption_key_id, payload_fingerprint, configured_keys, plugin_revision_id) select ${next}, nonce, encrypted_payload, encryption_key_id, payload_fingerprint, configured_keys, plugin_revision_id from plugin_config_revision where id = ${previous}`,
				),
			);
			yield* setPlugin(world, { environmentConfigRevisionId: next });
		}),
} satisfies Record<string, (world: World) => Effect.Effect<unknown, unknown, unknown>>;

const revisionHashes = Effect.fn(function* (revisionId: string) {
	const rows = yield* run((db) =>
		db
			.select({ slug: schema.sandboxScript.slug, contentHash: schema.sandboxScript.contentHash })
			.from(schema.sandboxScript)
			.where(eq(schema.sandboxScript.pluginRevisionId, revisionId)),
	);
	return Object.fromEntries(rows.map(({ slug, contentHash }) => [slug, contentHash]));
});

const principalFor = (pin: ScriptPin, subject: SandboxExecutionSubject) =>
	Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });

const invalidPin = () =>
	new SandboxRunError({
		kind: "missing-artifact",
		message: "Sandbox execution pin does not match its stored authority",
	});

const expectedOutcomes = {
	ready: {
		user: {
			task: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
			details: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
		},
		system: {
			task: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
			details: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
		},
	},
	hidden: {
		user: {
			task: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
			details: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
		},
	},
	updated: {
		user: {
			task: "--P--- --P--- --PU-U --P--- --P--- ------",
			details: "--P--- --P--- --PU-U --P--- --P--- ------",
		},
		system: {
			task: "--P--- --P--- --PU-U --P--- --P--- ------",
			details: "--P--- --P--- --PU-U --P--- --P--- ------",
		},
	},
	inactive: {
		user: {
			task: "--U-U- --U-U- --UUUU --U-U- --U-U- ------",
			details: "--U-U- --U-U- --UUUU --U-U- --U-U- ------",
		},
		system: {
			task: "--P--- --P--- --PU-U --P--- --P--- ------",
			details: "--P--- --P--- --PU-U --P--- --P--- ------",
		},
	},
	initialized: {
		user: {
			task: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
			details: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
		},
	},
	uninstalled: {
		user: {
			task: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
			details: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
		},
	},
	userDeleted: {
		user: {
			task: "------ ------ ------ ------ ------ ------",
			details: "------ ------ ------ ------ ------ ------",
		},
		system: {
			task: "P-P--- P-P--- ------ ------ P-P--- ------",
			details: "P-P--- P-P--- ------ ------ P-P--- ------",
		},
	},
	initializing: {
		user: {
			task: "U-U-U- U-U-U- UPUPU- U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UPUPU- U-U-U- P-P--- ------",
			details: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
		},
	},
	incompatible: {
		user: {
			task: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
			details: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
		},
	},
	configPruned: {
		user: {
			task: "------ ------ -U-U-U ------ ------ ------",
			details: "------ ------ -U-U-U ------ ------ ------",
		},
		system: {
			task: "------ ------ -U-U-U ------ ------ ------",
			details: "------ ------ -U-U-U ------ ------ ------",
		},
	},
	configChanged: {
		user: {
			task: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
			details: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
		},
		system: {
			task: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
			details: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
		},
	},
	scriptDeleted: {
		user: {
			task: "--P--- --P--- --PU-U --P--- --P--- ------",
			details: "------ ------ ------ ------ ------ ------",
		},
		system: {
			task: "--P--- --P--- --PU-U --P--- --P--- ------",
			details: "------ ------ ------ ------ ------ ------",
		},
	},
	pluginDeleted: {
		user: {
			task: "------ ------ ------ ------ ------ ------",
			details: "------ ------ ------ ------ ------ ------",
		},
		system: {
			task: "------ ------ ------ ------ ------ ------",
			details: "------ ------ ------ ------ ------ ------",
		},
	},
	accountDisabled: {
		user: {
			task: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
			details: "U-U-U- U-U-U- ------ ------ U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- PUPU-U P-P--- P-P--- ------",
			details: "P-P--- P-P--- ------ ------ P-P--- ------",
		},
	},
	siblingsDeleted: {
		user: {
			task: "--P--- --P--- --PU-U --P--- --P--- ------",
			details: "--P--- --P--- --PU-U --P--- --P--- ------",
		},
		system: {
			task: "--P--- --P--- --PU-U --P--- --P--- ------",
			details: "--P--- --P--- --PU-U --P--- --P--- ------",
		},
	},
	identityConflict: {
		user: {
			task: "C-C-C- C-C-C- CCCCCC C-C-C- C-C-C- ------",
			details: "C-C-C- C-C-C- CCCCCC C-C-C- C-C-C- ------",
		},
		system: {
			task: "P-P--- P-P--- CCCCCC C-C-C- P-P--- ------",
			details: "P-P--- P-P--- CCCCCC C-C-C- P-P--- ------",
		},
	},
	inactiveConflict: {
		user: {
			task: "--C-C- --C-C- --CCCC --C-C- --C-C- ------",
			details: "--C-C- --C-C- --CCCC --C-C- --C-C- ------",
		},
		system: {
			task: "--P--- --P--- --CCCC --C-C- --P--- ------",
			details: "--P--- --P--- --CCCC --C-C- --P--- ------",
		},
	},
	activationRotated: {
		user: {
			task: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
			details: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
		},
	},
	generationChanged: {
		user: {
			task: "P-P--- P-P--- ------ ------ P-P--- ------",
			details: "P-P--- P-P--- ------ ------ P-P--- ------",
		},
		system: {
			task: "P-P--- P-P--- ------ ------ P-P--- ------",
			details: "P-P--- P-P--- ------ ------ P-P--- ------",
		},
	},
	needsConfiguration: {
		user: {
			task: "U-P--- U-P--- UUPU-U U-P--- U-P--- ------",
			details: "U-P--- U-P--- UUPU-U U-P--- U-P--- ------",
		},
		system: {
			task: "P-P--- P-P--- UUPU-U U-P--- P-P--- ------",
			details: "P-P--- P-P--- UUPU-U U-P--- P-P--- ------",
		},
	},
	disabledInitializing: {
		user: {
			task: "U-U-U- U-U-U- UPUPU- U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- ------ ------ U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UPUPU- U-U-U- P-P--- ------",
			details: "P-P--- P-P--- ------ ------ P-P--- ------",
		},
	},
	disabledHiddenUninstalled: {
		user: {
			task: "U-U-U- U-U-U- UUUUUU U-U-U- U-U-U- ------",
			details: "U-U-U- U-U-U- ------ ------ U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- UUUUUU U-U-U- P-P--- ------",
			details: "P-P--- P-P--- ------ ------ P-P--- ------",
		},
	},
	generationChangedUninstalled: {
		user: {
			task: "U-U-U- U-U-U- ------ ------ U-U-U- ------",
			details: "U-U-U- U-U-U- ------ ------ U-U-U- ------",
		},
		system: {
			task: "P-P--- P-P--- ------ ------ P-P--- ------",
			details: "P-P--- P-P--- ------ ------ P-P--- ------",
		},
	},
} satisfies Record<keyof typeof mutations, Record<Scope, Record<keyof World["scripts"], string>>>;

const persistKernel = Effect.fn(function* (slug: string, compiledCode: string) {
	const plugins = yield* PluginRepository;
	const [compiled] = revisionPackage(slug).scripts;
	assert(compiled);
	const { entry: _entry, ...script } = compiled;
	const kernel = {
		...script,
		compiledCode,
		source: "kernel pin source",
		contentHash: `${script.contentHash}-${compiledCode}`,
	};
	yield* plugins.persistKernelScript(kernel);
	const [row] = yield* run((db) =>
		db
			.select({ id: schema.kernelScript.scriptId })
			.from(schema.kernelScript)
			.where(eq(schema.kernelScript.slug, kernel.slug)),
	);
	assert(row);
	return { kernel, scriptId: SandboxScriptId.make(row.id) };
});

describe("single-statement script pin resolution", () => {
	layer(SandboxExecutionAuthorityLive.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect("resolves every subject, pin and initialization from current persisted rows", () =>
			Effect.gen(function* () {
				const repository = yield* SandboxRepository;
				const worlds = [];
				for (const [name, mutate] of Object.entries(mutations)) {
					for (const scope of ["user", "system"] as const) {
						const world = yield* createWorld(scope);
						const baseline = yield* repository.getScriptPin(
							world.scripts.details,
							undefined,
							scope === "user" ? userSubject(world.userId) : undefined,
						);
						assert(baseline?.pluginRevision);
						worlds.push({ name, world, mutate, expected: baseline.pluginRevision });
					}
				}
				for (const persisting of [true, false]) {
					for (const { name, world, mutate } of worlds) {
						if (packageMutations.has(name) === persisting) {
							yield* mutate(world);
						}
					}
				}
				const outcomes: Record<string, Record<string, Record<string, string>>> = {};
				for (const [index, { name, world, expected }] of worlds.entries()) {
					const foreign = worlds[(index + 1) % worlds.length];
					assert(foreign);
					const configRevisionId = yield* currentConfigId(world);
					const hashes = yield* revisionHashes(world.revisionId);
					outcomes[name] = {
						...outcomes[name],
						[world.scope]: yield* outcomesFor({
							expected,
							scripts: world.scripts,
							subjects: subjectsFor(world),
							foreignConfigRevisionId: foreign.expected.configRevisionId,
							binding: { activationId: world.activationId, installationId: world.installationId },
							verifyPin: (pin, _scriptName, mode) => {
								expect(pin.pluginRevision).toMatchObject({
									scope: world.scope,
									revisionId: world.revisionId,
									configRevisionId:
										mode.exact === "pinned" ? expected.configRevisionId : configRevisionId,
								});
								expect(pin.pluginRevision?.compiledHashes).toEqual(hashes);
							},
						}),
					};
				}
				expect(outcomes).toEqual(expectedOutcomes);
			}),
		);

		test.effect("resolves kernel and unpinned scripts from current persisted rows", () =>
			Effect.gen(function* () {
				const outcomes: Record<string, Record<string, string>> = {};
				for (const account of ["enabled", "disabled"] as const) {
					const world = yield* createWorld("user");
					const slug = `kernel-${world.slug}`;
					const original = yield* persistKernel(slug, "original");
					const current = yield* persistKernel(slug, "repointed");
					const [unpinned] = yield* run((db) =>
						db
							.insert(schema.sandboxScript)
							.values({
								...original.kernel,
								pluginRevisionId: null,
								slug: `${original.kernel.slug}-unpinned`,
							})
							.returning({ id: schema.sandboxScript.id }),
					);
					assert(unpinned);
					if (account === "disabled") {
						yield* mutations.accountDisabled(world);
					}
					outcomes[account] = yield* outcomesFor({
						subjects: subjectsFor(world),
						foreignConfigRevisionId: PluginConfigRevisionId.make("foreign-config"),
						binding: { activationId: world.activationId, installationId: world.installationId },
						scripts: {
							current: current.scriptId,
							repointed: original.scriptId,
							unpinned: SandboxScriptId.make(unpinned.id),
						},
						expected: {
							id: PluginId.make(world.pluginId),
							revisionId: PluginRevisionId.make(world.revisionId),
							configRevisionId: PluginConfigRevisionId.make("kernel-config"),
						},
						verifyPin: (pin, scriptName) => {
							expect(pin.pluginRevision).toBeNull();
							if (scriptName === "current") {
								expect(pin).toMatchObject({ kernelScript: true });
							} else {
								expect(pin).not.toHaveProperty("kernelScript");
							}
						},
					});
				}
				expect(outcomes).toEqual({
					enabled: {
						current: "P----- P----- P----- P----- P----- P-----",
						unpinned: "P----- P----- P----- P----- P----- P-----",
						repointed: "P----- P----- P----- P----- P----- P-----",
					},
					disabled: {
						current: "P----- P----- ------ ------ P----- P-----",
						unpinned: "P----- P----- ------ ------ P----- P-----",
						repointed: "P----- P----- ------ ------ P----- P-----",
					},
				});
			}),
		);

		test.effect("rejects a kernel principal once its slug is repointed to new content", () =>
			Effect.gen(function* () {
				const authority = yield* SandboxExecutionAuthority;
				const repository = yield* SandboxRepository;
				const slug = `kernel-repoint-${crypto.randomUUID()}`;
				const original = yield* persistKernel(slug, "original");
				const originalPin = yield* repository.getScriptPin(original.scriptId);
				assert(originalPin);
				const principal = yield* principalFor(originalPin, { type: "system" });
				expect(yield* authority.resolve(principal)).toBe("system");
				const current = yield* persistKernel(slug, "repointed");
				assertExitFails(yield* Effect.exit(authority.resolve(principal)), invalidPin());
				const currentPin = yield* repository.getScriptPin(current.scriptId);
				assert(currentPin);
				expect(yield* authority.resolve(yield* principalFor(currentPin, { type: "system" }))).toBe(
					"system",
				);
			}),
		);

		test.effect("rejects a principal whose live revision lost scripts to garbage collection", () =>
			Effect.gen(function* () {
				const authority = yield* SandboxExecutionAuthority;
				const repository = yield* SandboxRepository;
				const world = yield* createWorld("user");
				const subject = userSubject(world.userId);
				const pin = yield* repository.getScriptPin(world.scripts.task, undefined, subject);
				assert(pin?.pluginRevision);
				expect(Object.keys(pin.pluginRevision.compiledHashes)).toHaveLength(5);
				const principal = yield* principalFor(pin, subject);
				expect(yield* authority.resolve(principal)).toBe("user");
				yield* mutations.siblingsDeleted(world);
				assertExitFails(yield* Effect.exit(authority.resolve(principal)), invalidPin());
				const shrunk = yield* repository.getScriptPin(
					world.scripts.task,
					pin.pluginRevision,
					subject,
				);
				expect(shrunk?.pluginRevision?.compiledHashes).toEqual({
					[`${world.slug}.task`]: `${world.slug}.task-v1`,
					[`${world.slug}.details`]: `${world.slug}.details-v1`,
				});
				yield* deleteScripts(world, ["details"]);
				expect(
					yield* repository.getScriptPin(world.scripts.details, pin.pluginRevision, subject),
				).toBeNull();
			}),
		);

		test.effect("resolves a changed environment configuration for current system pins", () =>
			Effect.gen(function* () {
				const repository = yield* SandboxRepository;
				const world = yield* createWorld("system");
				const pin = yield* repository.getScriptPin(world.scripts.details);
				assert(pin?.pluginRevision);
				yield* mutations.configChanged(world);
				const changed = yield* repository.getScriptPin(world.scripts.details);
				expect(changed?.pluginRevision?.configRevisionId).toBe(
					`${pin.pluginRevision.configRevisionId}-next`,
				);
				expect(
					yield* repository.getScriptPin(world.scripts.details, pin.pluginRevision),
				).toMatchObject({
					pluginRevision: { configRevisionId: pin.pluginRevision.configRevisionId },
				});
			}),
		);
	});
});
