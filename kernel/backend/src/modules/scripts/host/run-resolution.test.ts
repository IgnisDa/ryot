import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import { PluginId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { column, field, rows, table } from "@ryot-app/ryotql";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { makeRecordingTracer, recordedStatements } from "@ryot-app/testing/recording-tracer";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema, type Tracer } from "effect";

import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin, NormalizedPluginScript } from "#modules/plugins/packages/types";
import { makeRyotQLScriptHost } from "#modules/ryotql/script-host";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { SandboxExecutionAuthorityLive } from "../authorization/authority";
import { ScriptExecutionPrincipal } from "../authorization/principal";
import { SandboxRepository } from "../registry/repository";
import { ScriptHostImplementations } from "./host-implementations";
import { unusedSandboxHostImplementations } from "./host-implementations.test-support";
import { SandboxHostFunctionsLive } from "./sandbox-host-live";

const owner = UserId.make("owner");
const entity = table("entity", "entity");
const query = {
	source: {
		kind: "inline",
		document: { queries: { items: rows(entity, { fields: [field("id", column(entity, "id"))] }) } },
	},
};

const queryingPackage = (slug: string): NormalizedPlugin => {
	const normalized = revisionPackage(slug);
	return {
		...normalized,
		scripts: normalized.scripts.map((script): NormalizedPluginScript =>
			script.slug === `${slug}.task` && script.metadata.kind === "script"
				? Object.assign({}, script, {
						metadata: Object.assign({}, script.metadata, { capabilities: ["executeRyotql"] }),
					})
				: script,
		),
	};
};

const testLayer = Layer.mergeAll(
	SandboxExecutionAuthorityLive,
	SandboxHostFunctionsLive.pipe(
		Layer.provide(
			Layer.effect(
				ScriptHostImplementations,
				Effect.map(makeRyotQLScriptHost, (ryotql) => {
					const unused = unusedSandboxHostImplementations();
					return { ...unused, additional: { ...unused.additional, ...ryotql } };
				}),
			).pipe(Layer.provide(RyotQLService.layer)),
		),
	),
).pipe(Layer.provideMerge(revisionDatabaseLayer), Layer.provide(makeAppConfigLayer()));

const catalogStatements = (spans: ReadonlyArray<Tracer.Span>) =>
	recordedStatements(spans).filter((text) => text.includes("from plugin_installation i"));

const installQueryingScript = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	const sandbox = yield* SandboxRepository;
	const slug = `run-resolution-${yield* randomUuid}`;
	const installed = yield* installRevisionPackage(queryingPackage(slug), owner);
	const [script] = yield* session.run((db) =>
		db
			.select({ id: tables.sandboxScript.id })
			.from(tables.sandboxScript)
			.where(eq(tables.sandboxScript.slug, `${slug}.task`)),
	);
	assert(script);
	const pin = yield* sandbox.getScriptPin(SandboxScriptId.make(script.id));
	assert(pin);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
		...pin,
		subject: { type: "user", userId: owner },
	});
	return { installed, principal };
});

const startRun = Effect.fnUntraced(function* (principal: ScriptExecutionPrincipal) {
	yield* (yield* SandboxExecutionAuthority).resolve(principal);
	const bound = yield* (yield* SandboxHostFunctions).bind({
		principal,
		context: {},
		compiledCode: "",
		compiledFormat: 1,
		lane: "interactive",
		executionId: "execution-1",
		startedAt: "2026-01-01T00:00:00.000Z",
	});
	const execute = bound["executeRyotql"];
	assert(execute);
	return () => execute([query]);
});

layer(testLayer)("script run host resolution", (test) => {
	test.effect(
		"resolves the user plugin catalog once per run across RyotQL host calls",
		() =>
			Effect.gen(function* () {
				const { principal } = yield* installQueryingScript;
				const spans: Tracer.Span[] = [];
				const tracer = Effect.withTracer(makeRecordingTracer(spans));
				const executeRyotql = yield* startRun(principal);
				for (let call = 0; call < 3; call++) {
					yield* executeRyotql().pipe(tracer);
				}
				expect(catalogStatements(spans)).toHaveLength(1);
				expect(
					recordedStatements(spans).filter((text) => text.includes('"ryotqlRows"')),
				).toHaveLength(3);

				spans.length = 0;
				yield* (yield* startRun(principal))().pipe(tracer);
				expect(catalogStatements(spans)).toHaveLength(1);
			}),
		testTimeout,
	);

	test.effect(
		"keeps a run's plugin catalog snapshot across an uninstall",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const { installed, principal } = yield* installQueryingScript;
				const executeRyotql = yield* startRun(principal);
				yield* executeRyotql();
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ uninstalledAt: new Date() })
						.where(eq(tables.pluginInstallation.id, installed.installation.id)),
				);
				const spans: Tracer.Span[] = [];
				yield* executeRyotql().pipe(Effect.withTracer(makeRecordingTracer(spans)));
				expect(catalogStatements(spans)).toEqual([]);
				assertExitFails(
					yield* Effect.exit(startRun(principal)),
					new SandboxRunError({
						kind: "script-failure",
						message: "Sandbox installation is unavailable",
						data: {
							code: "installation-unavailable",
							installationId: installed.installation.id,
							pluginId: PluginId.make(installed.pluginId),
						},
					}),
				);
			}),
		testTimeout,
	);
});
