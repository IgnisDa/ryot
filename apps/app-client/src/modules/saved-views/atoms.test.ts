import { Layer } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { expect, it, vi } from "vitest";

import type { appQueryClient } from "@/api/query-client";
import { AppQueryClient } from "@/api/query-client-service";
import { canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

import { savedViewRecordRequestKey } from "./atom-requests";
import { makeSavedViewRecordAtom } from "./saved-view-record-atom";

it("uses the request-key server as the saved-view service destination", () => {
	const request = {
		slug: "favorites",
		userId: "user-1",
		serverUrl: " https://one.test/// ",
	};
	const scope = canonicalApiScope(request);
	const key = savedViewRecordRequestKey(request);
	const queryMock = vi.fn(() => Atom.make(AsyncResult.initial()));
	const appQueryClientMock = vi.fn(() => ({ query: queryMock }));
	const savedViewRecordAtom = makeSavedViewRecordAtom(
		Layer.succeed(AppQueryClient, {
			// The test service only exercises query construction.
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			get: appQueryClientMock as unknown as typeof appQueryClient,
		}),
	);

	savedViewRecordAtom(request);

	expect(savedViewRecordRequestKey({ ...scope, slug: request.slug })).toBe(key);
	expect(appQueryClientMock).toHaveBeenCalledWith(scope.serverUrl);
	expect(queryMock).toHaveBeenCalledWith(
		"ryotql",
		"execute",
		expect.objectContaining({
			reactivityKeys: scopedReactivityKey("saved-view-record", scope),
		}),
	);
});
