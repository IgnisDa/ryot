import { expect, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";

import {
	createSavedViewControllerState,
	savedViewControllerReducer,
	type SavedViewControllerState,
	type SavedViewOperationToken,
} from "./controller";
import { createSavedViewRefreshEvents } from "./refresh-events";
import { SavedViewStructuralRefresh, type SavedViewStructuralRequest } from "./structural-refresh";

const settle = Effect.gen(function* () {
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
	yield* Effect.yieldNow;
});

it.effect("coalesces refresh events blocked by initial, pagination, and structural work", () =>
	Effect.gen(function* () {
		let attempts = 0;
		let controller = createSavedViewControllerState("scope:record", "grid");
		let pendingCommit: SavedViewControllerState | undefined;
		const data = {
			itemsById: new Map(),
			pages: [
				{
					entityIds: [],
					queryDocument: { queries: {} },
					pageInfo: { limit: 1, hasMore: false, nextCursor: null },
				},
			],
		};
		const startOperation = (phase: "initial" | "load-more" | "structural") => {
			const token: SavedViewOperationToken = {
				layout: "grid",
				identity: controller.identity,
				generation: controller.generation + 1,
			};
			controller = savedViewControllerReducer(controller, {
				token,
				phase,
				type: "request-started",
			});
			return token;
		};
		const queueCompletion = (token: SavedViewOperationToken) => {
			pendingCommit = savedViewControllerReducer(controller, {
				data,
				token,
				type: "request-succeeded",
			});
		};
		const commit = () => {
			if (!pendingCommit) {
				throw new Error("Missing controller completion");
			}
			controller = pendingCommit;
			pendingCommit = undefined;
		};
		const first = yield* Deferred.make<void>();
		const second = yield* Deferred.make<void>();
		const third = yield* Deferred.make<void>();
		const completions = [first, second, third];
		const service = yield* SavedViewStructuralRefresh.make;
		const work: SavedViewStructuralRequest = {
			key: "view:grid",
			canStart: () => {
				const current = controller.layouts.grid;
				return !!current && current.data.pages.length > 0 && !current.operation;
			},
			onEnd: Effect.void,
			onStart: () => Effect.void,
			run: Effect.suspend(() => {
				const completion = completions.at(attempts);
				attempts += 1;
				const token = startOperation("structural");
				return completion
					? Deferred.await(completion).pipe(
							Effect.tap(() => Effect.sync(() => queueCompletion(token))),
							Effect.as(true),
						)
					: Effect.die("extra request");
			}),
		};
		const events = createSavedViewRefreshEvents(() => {
			Effect.runFork(service.refresh(work, false));
		});
		const triggerAll = Effect.gen(function* () {
			events.onAppStateChange("active");
			events.onNetworkStateChange({ isConnected: false });
			events.onNetworkStateChange({ isConnected: true });
			yield* service.refresh(work, true);
			yield* settle;
		});

		// Initial loading blocks all three trigger sources. The post-commit activation starts one.
		const initial = startOperation("initial");
		yield* triggerAll;
		expect(attempts).toBe(0);
		queueCompletion(initial);
		commit();
		yield* service.activate(work);
		yield* settle;
		expect(attempts).toBe(1);

		// Triggers during that structural request retain one trailing refresh until state commits.
		yield* triggerAll;
		expect(attempts).toBe(1);
		yield* Deferred.succeed(first, undefined);
		yield* settle;
		expect(attempts).toBe(1);
		commit();
		yield* service.activate(work);
		yield* settle;
		expect(attempts).toBe(2);
		yield* Deferred.succeed(second, undefined);
		yield* settle;
		commit();

		// Pagination has the same blocked-controller boundary and starts no discarded requests.
		const pagination = startOperation("load-more");
		yield* triggerAll;
		expect(attempts).toBe(2);
		queueCompletion(pagination);
		commit();
		yield* service.activate(work);
		yield* settle;
		expect(attempts).toBe(3);
		yield* Deferred.succeed(third, undefined);
		yield* settle;
		commit();
		expect(attempts).toBe(3);
	}),
);
