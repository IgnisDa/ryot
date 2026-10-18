import { afterEach, describe, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import { getByRole, getByText, waitFor } from "@testing-library/dom";
import { Deferred } from "effect";

import { activityLogQuery, contextTarget } from "../../../tests/client/activity-log/fixtures";
import { clickRyotElement, mountRyotClient } from "../../../tests/client/test-support";
import { activityLogContextQuery } from "./queries";
import { useQuickLog } from "./quick-log";

function Probe() {
	const quick = useQuickLog("entity-1");
	const context = useRyotQuery(activityLogContextQuery, { entityId: "entity-1" });
	return (
		<div>
			<p>{quick.context?.name ?? "No context"}</p>
			<button type="button" onClick={context.refetch}>
				Reload
			</button>
			<button
				type="button"
				disabled={quick.locked}
				onClick={() =>
					quick.log.submit({
						label: "Marked as dropped.",
						entry: { kind: "status", status: "dropped", entityId: "entity-1" },
					})
				}
			>
				Log
			</button>
		</div>
	);
}

const named = (name: string) => activityLogQuery({ target: contextTarget({ name }) });

const mountProbe = (
	answers: readonly ((document: unknown) => Effect.Effect<unknown, RyotClientError>)[],
) => {
	const background = createTestBackgroundSubmissions();
	let contexts = 0;
	const view = mountRyotClient(
		{
			...background.adapter,
			watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
			query: (document) => {
				const answer = answers[contexts] ?? answers[answers.length - 1];
				contexts += 1;
				return answer === undefined ? named("Heat")(document) : answer(document);
			},
		},
		<Probe />,
	);
	const log = () => getByRole(view.container, "button", { name: "Log" });
	return {
		log,
		view,
		requests: background.requests,
		saved: () => background.settle("submission-1", { status: "succeeded" }),
	};
};

let unmount: undefined | (() => void);

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe("useQuickLog", () => {
	it.live("unlocks only after a refetch that starts after the save, not an earlier one", () =>
		Effect.gen(function* () {
			const stale = yield* Deferred.make<void>();
			const fresh = yield* Deferred.make<void>();
			const mounted = mountProbe([
				(document) => named("Heat")(document),
				(document) => Deferred.await(stale).pipe(Effect.andThen(named("Stale")(document))),
				(document) => Deferred.await(fresh).pipe(Effect.andThen(named("Fresh")(document))),
			]);
			unmount = mounted.view.unmount;
			yield* Effect.promise(() =>
				waitFor(() => expect(getByText(mounted.view.container, "Heat")).toBeDefined()),
			);
			clickRyotElement(getByRole(mounted.view.container, "button", { name: "Reload" }));
			clickRyotElement(mounted.log());
			yield* Effect.promise(() => waitFor(() => expect(mounted.requests).toHaveLength(1)));
			yield* Effect.promise(() =>
				waitFor(() => expect(mounted.log().hasAttribute("disabled")).toBe(true)),
			);
			mounted.saved();
			yield* Deferred.succeed(stale, undefined);
			expect(mounted.log().hasAttribute("disabled")).toBe(true);
			yield* Deferred.succeed(fresh, undefined);
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(getByText(mounted.view.container, "Fresh")).toBeDefined();
					expect(mounted.log().hasAttribute("disabled")).toBe(false);
				}),
			);
		}),
	);

	for (const [label, refresh, shown] of [
		[
			"a successful refresh shows the refreshed context",
			(document: unknown) => named("Fresh")(document),
			"Fresh",
		],
		[
			"a failed refresh keeps the previous context",
			(_document: unknown) => Effect.fail(new RyotClientError("operation-failed")),
			"Heat",
		],
	] as const) {
		it.live(`unlocks after ${label}`, () =>
			Effect.gen(function* () {
				const release = yield* Deferred.make<void>();
				const mounted = mountProbe([
					(document) => named("Heat")(document),
					(document) => Deferred.await(release).pipe(Effect.andThen(refresh(document))),
				]);
				unmount = mounted.view.unmount;
				yield* Effect.promise(() =>
					waitFor(() => expect(getByText(mounted.view.container, "Heat")).toBeDefined()),
				);
				clickRyotElement(mounted.log());
				yield* Effect.promise(() =>
					waitFor(() => expect(mounted.log().hasAttribute("disabled")).toBe(true)),
				);
				mounted.saved();
				yield* Deferred.succeed(release, undefined);
				yield* Effect.promise(() =>
					waitFor(() => {
						expect(getByText(mounted.view.container, shown)).toBeDefined();
						expect(mounted.log().hasAttribute("disabled")).toBe(false);
					}),
				);
			}),
		);
	}
});
