import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import {
	applyProviderOptionsFailure,
	applyProviderOptionsResponse,
	createProviderOptionsState,
	isProviderOptionsRequestCurrent,
} from "./options-state";
import {
	mapProviderEntityLinks,
	mapProviderSummaries,
	providerAddError,
	type ProviderSearchSummary,
} from "./state";

const rows = <Item>(items: readonly Item[]) => ({
	items,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const providerRow = {
	searchOptionsSchema: null,
	providerSlug: "openlibrary",
	providerName: "Open Library",
	providerId: SandboxProviderId.make("provider-1"),
	rootEntitySchemaSlug: EntitySchemaSlug.make("book"),
};

const linkRow = { externalId: "ext-1" };

const providerWithOptions = {
	...providerRow,
	providerId: SandboxProviderId.make("provider-2"),
	searchOptionsSchema: {
		fields: {
			region: {
				type: "enum",
				label: "Region",
				description: "Region",
				choices: { kind: "static", values: [{ value: "us", label: "United States" }] },
			},
		},
	},
} satisfies ProviderSearchSummary;

describe("provider-add application state", () => {
	it("maps provider summaries through loading, transport failure, malformed, and ready", () => {
		expect(mapProviderSummaries(AsyncResult.initial())).toEqual({ status: "loading" });
		expect(mapProviderSummaries(AsyncResult.fail("offline")).status).toBe("transport-error");
		expect(
			mapProviderSummaries(AsyncResult.fail(new RyotQLMalformedResultError("invalid"))).status,
		).toBe("malformed");
		expect(mapProviderSummaries(AsyncResult.success(rows([providerRow])))).toMatchObject({
			status: "ready",
			providers: [{ providerSlug: "openlibrary", searchOptionsSchema: null }],
		});
	});

	it("maps provider entity links into an external-id set", () => {
		expect(mapProviderEntityLinks(AsyncResult.initial())).toEqual({ status: "loading" });
		expect(mapProviderEntityLinks(AsyncResult.fail("offline")).status).toBe("transport-error");
		expect(
			mapProviderEntityLinks(AsyncResult.fail(new RyotQLMalformedResultError("invalid"))).status,
		).toBe("malformed");

		const ready = mapProviderEntityLinks(AsyncResult.success([linkRow]));
		expect(ready).toMatchObject({ status: "ready" });
		expect(ready.status === "ready" ? ready.externalIds.has("ext-1") : false).toBe(true);
	});

	it("resets, loads, and ignores stale provider option responses", () => {
		const none = createProviderOptionsState(undefined);
		expect(none).toEqual({ providerId: undefined, status: "none" });

		const noOptionsResult = mapProviderSummaries(AsyncResult.success(rows([providerRow])));
		if (noOptionsResult.status !== "ready") {
			throw new Error("expected provider summaries");
		}
		const noOptions = createProviderOptionsState(noOptionsResult.providers[0]);
		expect(noOptions.status).toBe("none");

		const provider = mapProviderSummaries(AsyncResult.success(rows([providerWithOptions])));
		if (provider.status !== "ready") {
			throw new Error("expected provider summaries");
		}
		const selectedProvider = provider.providers[0];
		const loading = createProviderOptionsState(selectedProvider);
		expect(loading.status).toBe("loading");

		const ready = applyProviderOptionsResponse(loading, {
			schema: {
				fields: {
					region: {
						type: "enum",
						label: "Region",
						description: "Region",
						choices: { kind: "static", values: [{ value: "us", label: "United States" }] },
					},
				},
			},
		});
		expect(ready).toMatchObject({
			status: "ready",
			values: { region: undefined },
			providerId: selectedProvider.providerId,
		});

		const otherLoading = createProviderOptionsState({
			...selectedProvider,
			providerId: SandboxProviderId.make("provider-3"),
		});
		expect(applyProviderOptionsResponse(otherLoading, { schema: null })).toEqual({
			status: "none",
			providerId: "provider-3",
		});
		expect(applyProviderOptionsFailure(otherLoading, "offline")).toMatchObject({
			status: "failed",
			providerId: "provider-3",
		});
		expect(isProviderOptionsRequestCurrent(otherLoading, selectedProvider.providerId, 1, 2)).toBe(
			false,
		);
		expect(
			isProviderOptionsRequestCurrent(otherLoading, SandboxProviderId.make("provider-3"), 1, 1),
		).toBe(true);
	});

	it("keeps user-facing errors stable and free of internal causes", () => {
		const transport = providerAddError({ status: "transport-error" });
		const malformed = providerAddError({ status: "malformed" });

		expect(transport).toEqual(providerAddError({ status: "transport-error" }));
		expect(transport.title).not.toBe(malformed.title);
		expect(`${malformed.title}${malformed.detail}`).not.toContain("decode");
	});
});
