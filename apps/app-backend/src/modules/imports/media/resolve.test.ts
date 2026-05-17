import { describe, expect, it } from "bun:test";

import { createJob } from "~/lib/test-fixtures";

import type { ImportMediaEntityGroup } from "../jobs";
import { resolveMediaEntityRefs } from "./resolve";

type ResolveDeps = NonNullable<Parameters<typeof resolveMediaEntityRefs>[3]>;

const unresolvedGroup = (sourceLabel: string, identifierValue: string): ImportMediaEntityGroup => ({
	events: [],
	collectionMemberships: [],
	entityRef: {
		sourceLabel,
		identifierValue,
		kind: "unresolved",
		identifierType: "isbn",
		entitySchemaSlug: "book",
	},
});

const resolvedGroup = (externalId: string): ImportMediaEntityGroup => ({
	events: [],
	collectionMemberships: [],
	entityRef: {
		externalId,
		kind: "resolved",
		entitySchemaSlug: "book",
		scriptSlug: "book.hardcover",
		sourceLabel: "Already Resolved",
	},
});

const createResolveDeps = (overrides: Partial<ResolveDeps> = {}): ResolveDeps => ({
	createImportRunFailure: () => Promise.resolve(),
	resolveGlobalEntityExternalId: () => Promise.resolve({ externalId: null }),
	getResolutionCandidates: () => ["book.openlibrary", "book.hardcover", "book.google-book"],
	getBuiltinSandboxScriptBySlug: (slug: string) => Promise.resolve({ id: slug }),
	...overrides,
});

const runResolve = (entityGroups: ImportMediaEntityGroup[], deps: ResolveDeps) =>
	resolveMediaEntityRefs(
		createJob({}),
		undefined,
		{
			entityGroups,
			runId: "run_1",
			userId: "user_1",
			failedIndices: [],
			startEntityIndex: 0,
			adapterFailureCount: 0,
			startCandidateIndex: 0,
			currentSandboxJobId: undefined,
		},
		deps,
	);

describe("resolveMediaEntityRefs", () => {
	it("resolves via the first matching provider and stops trying the rest", async () => {
		const attempted: string[] = [];
		const result = await runResolve(
			[unresolvedGroup("Book One", "9780140328721")],
			createResolveDeps({
				resolveGlobalEntityExternalId: (_job, _token, input) => {
					attempted.push(input.scriptId);
					return input.scriptId === "book.hardcover"
						? Promise.resolve({ externalId: "hc1" })
						: Promise.resolve({ externalId: null });
				},
			}),
		);

		expect(attempted).toEqual(["book.openlibrary", "book.hardcover"]);
		expect(result.failedIndices).toEqual([]);
		expect(result.entityGroups[0]?.entityRef).toEqual({
			kind: "resolved",
			externalId: "hc1",
			sourceLabel: "Book One",
			entitySchemaSlug: "book",
			scriptSlug: "book.hardcover",
		});
	});

	it("continues past a provider error to the next candidate", async () => {
		const result = await runResolve(
			[unresolvedGroup("Book One", "9780140328721")],
			createResolveDeps({
				resolveGlobalEntityExternalId: (_job, _token, input) =>
					input.scriptId === "book.openlibrary"
						? Promise.resolve({ error: { message: "boom" } })
						: Promise.resolve({ externalId: "hc2" }),
			}),
		);

		expect(result.failedIndices).toEqual([]);
		expect(result.entityGroups[0]?.entityRef).toMatchObject({
			kind: "resolved",
			externalId: "hc2",
			scriptSlug: "book.hardcover",
		});
	});

	it("records a provider_resolution failure when nothing resolves", async () => {
		const failures: Array<Record<string, unknown>> = [];
		const result = await runResolve(
			[unresolvedGroup("Book One", "9780140328721")],
			createResolveDeps({
				createImportRunFailure: (input) => {
					failures.push(input);
					return Promise.resolve();
				},
			}),
		);

		expect(result.failedIndices).toEqual([0]);
		expect(result.entityGroups[0]?.entityRef.kind).toBe("unresolved");
		expect(failures[0]).toMatchObject({
			itemIndex: 0,
			stage: "provider_resolution",
			sourceIdentifier: "9780140328721",
			message: "Could not resolve isbn to a supported provider",
		});
	});

	it("fails the entity when no providers are configured", async () => {
		const failures: Array<Record<string, unknown>> = [];
		let attempted = false;
		const result = await runResolve(
			[unresolvedGroup("Book One", "9780140328721")],
			createResolveDeps({
				getResolutionCandidates: () => [],
				resolveGlobalEntityExternalId: () => {
					attempted = true;
					return Promise.resolve({ externalId: null });
				},
				createImportRunFailure: (input) => {
					failures.push(input);
					return Promise.resolve();
				},
			}),
		);

		expect(attempted).toBe(false);
		expect(result.failedIndices).toEqual([0]);
		expect(failures[0]).toMatchObject({
			stage: "provider_resolution",
			message: "No providers configured to resolve isbn",
		});
	});

	it("leaves already-resolved refs untouched", async () => {
		let attempted = false;
		const result = await runResolve(
			[resolvedGroup("hc9")],
			createResolveDeps({
				resolveGlobalEntityExternalId: () => {
					attempted = true;
					return Promise.resolve({ externalId: null });
				},
			}),
		);

		expect(attempted).toBe(false);
		expect(result.failedIndices).toEqual([]);
		expect(result.entityGroups[0]?.entityRef).toMatchObject({
			kind: "resolved",
			externalId: "hc9",
		});
	});
});
