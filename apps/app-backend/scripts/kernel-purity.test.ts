import fitnessPlugin from "@ryot/plugin-fitness";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { assert, describe, expect, it } from "vitest";

import {
	applyPurityAllowlist,
	deriveDomainVocabulary,
	formatPurityFinding,
	isProductionSourcePath,
	scanPuritySources,
	type PurityAllowlistEntry,
} from "./kernel-purity";

describe("kernel purity", () => {
	it("reports boundary-aware forbidden terms with exact diagnostics", () => {
		const findings = scanPuritySources(
			[
				{
					path: "apps/app-backend/src/example.ts",
					source:
						"const showing = true;\nconst slug = 'show';\nconst showProvider = true;\nconst relationship = 'in-library';",
				},
			],
			["in-library", "show"],
		);

		expect(findings).toEqual([
			{
				line: 2,
				term: "show",
				path: "apps/app-backend/src/example.ts",
				source: "const slug = 'show';",
			},
			{
				line: 3,
				term: "show",
				path: "apps/app-backend/src/example.ts",
				source: "const showProvider = true;",
			},
			{
				line: 4,
				term: "in-library",
				path: "apps/app-backend/src/example.ts",
				source: "const relationship = 'in-library';",
			},
		]);
		const [finding] = findings;
		assert(finding);
		expect(formatPurityFinding(finding)).toBe(
			"apps/app-backend/src/example.ts:2: forbidden term \"show\": const slug = 'show';",
		);
	});

	it("excludes only explicit non-production source shapes", () => {
		for (const path of [
			"apps/app-backend/src/example.test.ts",
			"apps/app-backend/src/example.spec.ts",
			"apps/app-backend/src/example.test-support.ts",
			"apps/app-backend/src/example.test-fixture.ts",
			"apps/app-backend/src/example.typecheck.ts",
			"apps/app-backend/src/modules/plugins/test-fixtures/example.ts",
			"apps/app-backend/src/lib/generated-sandbox/registry.ts",
			"apps/app-backend/src/lib/runner.generated.ts",
		]) {
			expect(isProductionSourcePath(path)).toBe(false);
		}
		expect(isProductionSourcePath("apps/app-backend/src/modules/test-support/service.ts")).toBe(
			true,
		);
	});

	it("derives newly declared ownership vocabulary without banning generic values", () => {
		const synthetic = {
			...fitnessPlugin,
			operations: [
				...fitnessPlugin.operations,
				{
					auth: "user",
					slug: "new-domain-operation",
					description: "Generic description must not become vocabulary",
					scriptSlug: "operation.new-domain-operation",
				},
			],
		} as PluginManifest;
		const vocabulary = deriveDomainVocabulary([synthetic]);

		expect(vocabulary).toContain("new-domain-operation");
		expect(vocabulary).toContain("operation.new-domain-operation");
		expect(vocabulary).toContain("exercise");
		expect(vocabulary).not.toContain("Generic description must not become vocabulary");
		expect(vocabulary).not.toContain("import");
		expect(vocabulary).not.toContain("user");
	});

	it("accepts narrow allowlist matches and rejects stale or invalid metadata", () => {
		const [finding] = scanPuritySources(
			[{ path: "apps/app-backend/src/example.ts", source: "const value = 'library';" }],
			["library"],
		);
		assert(finding);
		const allowed: PurityAllowlistEntry = {
			term: "library",
			kind: "temporary",
			removalTask: 4,
			path: "apps/app-backend/src/example.ts",
			reason: "Phase 4 collection policy residue",
		};

		expect(applyPurityAllowlist([finding], [allowed])).toEqual({ errors: [], violations: [] });
		expect(applyPurityAllowlist([finding], [{ ...allowed, term: "movie" }]).errors).toEqual([
			"Allowlist entry 1 is stale and matches no finding",
		]);
		expect(applyPurityAllowlist([finding], [{ ...allowed, reason: "" }]).errors).toEqual([
			"Allowlist entry 1 requires non-empty path, term, and reason",
		]);
		expect(
			applyPurityAllowlist(
				[finding],
				[
					{
						term: "library",
						kind: "permanent",
						reason: "Too broad",
						category: "boot-wiring",
						path: "apps/app-backend/src/modules/plugins/**",
					},
				],
			),
		).toEqual({
			errors: ["Allowlist entry 1 exceeds the boot-wiring permanent scope"],
			violations: [finding],
		});
	});
});
