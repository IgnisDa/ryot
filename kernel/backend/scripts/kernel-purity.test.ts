import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { assert, describe, expect, it } from "vitest";

import { fixtureManifest } from "../src/modules/plugins/test-support";
import {
	deriveDomainVocabulary,
	formatPurityFinding,
	isProductionSourcePath,
	scanPuritySources,
} from "./kernel-purity";

describe("kernel purity", () => {
	it("reports boundary-aware forbidden terms with exact diagnostics", () => {
		const findings = scanPuritySources(
			[
				{
					path: "kernel/backend/src/example.ts",
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
				source: "const slug = 'show';",
				path: "kernel/backend/src/example.ts",
			},
			{
				line: 3,
				term: "show",
				source: "const showProvider = true;",
				path: "kernel/backend/src/example.ts",
			},
			{
				line: 4,
				term: "in-library",
				path: "kernel/backend/src/example.ts",
				source: "const relationship = 'in-library';",
			},
		]);
		const [finding] = findings;
		assert(finding);
		expect(formatPurityFinding(finding)).toBe(
			"kernel/backend/src/example.ts:2: forbidden term \"show\": const slug = 'show';",
		);
	});

	it("excludes only explicit non-production source shapes", () => {
		for (const path of [
			"kernel/backend/src/example.test.ts",
			"kernel/backend/src/example.spec.ts",
			"kernel/backend/src/example.test-support.ts",
			"kernel/backend/src/example.test-fixture.ts",
			"kernel/backend/src/example.typecheck.ts",
			"kernel/backend/src/modules/plugins/test-fixtures/example.ts",
			"kernel/backend/src/lib/runner.generated.ts",
		]) {
			expect(isProductionSourcePath(path)).toBe(false);
		}
		expect(isProductionSourcePath("kernel/backend/src/modules/test-support/service.ts")).toBe(true);
	});

	it("derives newly declared ownership vocabulary without banning generic values", () => {
		const synthetic = {
			...fixtureManifest(),
			userBootstrap: [
				{
					slug: "new-domain-bootstrap",
					scriptSlug: "bootstrap.new-domain",
					description: "Generic bootstrap description",
				},
			],
			operations: [
				...fixtureManifest().operations,
				{
					auth: "user",
					slug: "new-domain-operation",
					scriptSlug: "operation.new-domain-operation",
					description: "Generic description must not become vocabulary",
				},
			],
		} as PluginManifest;
		const vocabulary = deriveDomainVocabulary([synthetic]);

		expect(vocabulary).toContain("new-domain-operation");
		expect(vocabulary).toContain("operation.new-domain-operation");
		expect(vocabulary).toContain("new-domain-bootstrap");
		expect(vocabulary).toContain("bootstrap.new-domain");
		expect(vocabulary).toContain("fixture-entity");
		expect(vocabulary).not.toContain("Generic description must not become vocabulary");
		expect(vocabulary).not.toContain("import");
		expect(vocabulary).not.toContain("user");
	});
});
