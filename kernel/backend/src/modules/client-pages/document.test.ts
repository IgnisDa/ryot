import { assert, expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { ClientArtifactGrantService } from "#modules/client-artifacts/grant-service";
import { ClientArtifactStore } from "#modules/client-artifacts/store";

import { composeClientPage } from "./composition";
import {
	generateClientDocument,
	planClientDocumentPreloads,
	renderClientDocument,
} from "./document";
import { descriptions, identity } from "./test-fixtures";

const manifest = () =>
	composeClientPage({
		identity: identity(),
		artifacts: descriptions(),
		runtimeEntries: { bootstrap: "bootstrap.js", "@ryot-app/client-sdk": "runtime.js" },
	});
const access = (privateHashes: readonly string[]) =>
	new Map(
		[...descriptions().keys()].map((hash) => [
			hash,
			privateHashes.includes(hash) ? "x".repeat(43) : "public",
		]),
	);

it("preloads all eager code and leaves public presentation-only artifacts unfetched", () => {
	const html = renderClientDocument(manifest(), descriptions(), access([]), "composition-hash");
	expect(html).toContain(`/api/client-assets/${"a".repeat(64)}/public/runtime.js`);
	expect(html).toContain('"hash":"composition-hash"');
	expect(html).toContain(
		`<link rel="modulepreload" href="/api/client-assets/${"b".repeat(64)}/public/module.js"`,
	);
	expect(html).not.toContain(
		`<link rel="modulepreload" href="/api/client-assets/${"c".repeat(64)}/public/module.js"`,
	);
	expect(html).not.toContain(
		`<link rel="stylesheet" href="/api/client-assets/${"c".repeat(64)}/public/module.css"`,
	);
	expect(html).toContain(
		`"stylesheets":["/api/client-assets/${"c".repeat(64)}/public/module.css"]`,
	);
	expect(renderClientDocument(manifest(), descriptions(), access([]), "composition-hash")).toBe(
		html,
	);
});

it("warms every supported file of an authorized lazy artifact without importing its module", () => {
	const plan = planClientDocumentPreloads(manifest(), descriptions(), access(["c".repeat(64)]));
	const prefix = `/api/client-assets/${"c".repeat(64)}/${"x".repeat(43)}/`;
	expect(plan.modulepreloads).toContain(`${prefix}module.js`);
	expect(plan.stylesheets).toContain(`${prefix}module.css`);
	expect(plan.lazyPresentationStylesheets).toContain(`${prefix}module.css`);
	expect(plan.preloads).toEqual(
		expect.arrayContaining([
			{ as: "font", type: "font/woff2", href: `${prefix}font.woff2` },
			{ as: "image", type: "image/svg+xml", href: `${prefix}icon.svg` },
			{ as: "fetch", type: "application/wasm", href: `${prefix}helper.wasm` },
		]),
	);
	const html = renderClientDocument(
		manifest(),
		descriptions(),
		access(["c".repeat(64)]),
		"composition-hash",
	);
	expect(html).toContain(`<link rel="modulepreload" href="${prefix}module.js"`);
	expect(html).not.toContain('import("@ryot-app/plugins/presentation/card")');
});

it("warms a private dependency of a public lazy presentation without preloading the public owner", () => {
	const dependencyHash = "d".repeat(64);
	const artifacts = descriptions();
	artifacts.set(dependencyHash, {
		files: [
			{ name: "module.js", contentType: "text/javascript" },
			{ name: "module.css", contentType: "text/css" },
		],
	});
	const original = identity();
	const registration = original.automaticRegistry[0];
	if (!registration) {
		throw new Error("Missing presentation registration");
	}
	const mixed = composeClientPage({
		artifacts,
		runtimeEntries: { sdk: "runtime.js", bootstrap: "bootstrap.js" },
		identity: {
			...original,
			automaticRegistry: [{ ...registration, artifactClosure: ["c".repeat(64), dependencyHash] }],
		},
	});
	const modes = access([dependencyHash]);
	modes.set(dependencyHash, "x".repeat(43));
	const plan = planClientDocumentPreloads(mixed, artifacts, modes);
	expect(plan.modulepreloads).toContain(
		`/api/client-assets/${dependencyHash}/${"x".repeat(43)}/module.js`,
	);
	expect(plan.stylesheets).toContain(
		`/api/client-assets/${dependencyHash}/${"x".repeat(43)}/module.css`,
	);
	expect(plan.modulepreloads).not.toContain(
		`/api/client-assets/${"c".repeat(64)}/public/module.js`,
	);
	expect(plan.stylesheets).not.toContain(`/api/client-assets/${"c".repeat(64)}/public/module.css`);
});

it("deduplicates eager and multi-presentation artifact preloads", () => {
	const original = identity();
	const registration = original.automaticRegistry[0];
	if (!registration) {
		throw new Error("Missing presentation registration");
	}
	const shared = composeClientPage({
		artifacts: descriptions(),
		runtimeEntries: { sdk: "runtime.js", bootstrap: "bootstrap.js" },
		identity: {
			...original,
			automaticRegistry: [
				{ ...registration, artifactClosure: ["b".repeat(64), "c".repeat(64)] },
				{
					...registration,
					entitySchemaSlug: "other",
					artifactClosure: ["b".repeat(64), "c".repeat(64)],
				},
			],
		},
	});
	const plan = planClientDocumentPreloads(
		shared,
		descriptions(),
		access(["b".repeat(64), "c".repeat(64)]),
	);
	expect(plan.modulepreloads.filter((url) => url.endsWith("/module.js"))).toHaveLength(2);
	expect(plan.stylesheets.filter((url) => url.endsWith("/module.css"))).toHaveLength(2);
	expect(plan.lazyPresentationStylesheets).toHaveLength(2);
});

it.effect(
	"issues one capability per distinct private artifact and reuses its URL across specifiers",
	() => {
		const issued: string[] = [];
		const description = descriptions();
		const base = manifest();
		const pageManifest = {
			...base,
			imports: {
				...base.imports,
				"@ryot-app/plugins/page/alias": { file: "module.js", artifactHash: "b".repeat(64) },
			},
		};
		const layered = Effect.gen(function* () {
			const html = yield* generateClientDocument(
				UserId.make("user-1"),
				"composition-hash",
				pageManifest,
			);
			expect(issued).toEqual(["b".repeat(64), "c".repeat(64)]);
			expect(html).toContain(`/api/client-assets/${"a".repeat(64)}/public/bootstrap.js`);
			expect(html).toContain(`/api/client-assets/${"b".repeat(64)}/${"x".repeat(43)}/module.js`);
			expect(html).toContain('"@ryot-app/plugins/page/alias"');
		});
		return layered.pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(Database, Database.of(Object.create(null))),
					Layer.succeed(
						ClientArtifactStore,
						ClientArtifactStore.of({
							findFile: () => Effect.succeed(null),
							isPublic: (hash) => hash === "a".repeat(64),
							exists: (hash) => Effect.succeed(description.has(hash)),
							describe: (hash) => {
								if (!description.has(hash)) {
									return Effect.succeed(null);
								}
								const artifactDescription = description.get(hash);
								assert(artifactDescription);
								return Effect.succeed({
									...artifactDescription,
									hash,
									format: 1,
									apiVersion: 1,
									bridgeVersion: 3,
									compilerVersion: 2,
								});
							},
						}),
					),
					Layer.succeed(
						ClientArtifactGrantService,
						ClientArtifactGrantService.of({
							resolve: () => Effect.succeed(null),
							issue: (_user, hash) =>
								Effect.sync(() => {
									issued.push(hash);
									return {
										grantId: "id",
										token: "x".repeat(43),
										expiresAt: "2026-01-01T00:00:00Z",
									};
								}),
						}),
					),
				),
			),
		);
	},
);
