import { afterEach, describe, expect, it } from "@effect/vitest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { waitFor } from "@testing-library/dom";
import { Deferred, Effect, Schema } from "effect";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { RyotClientError } from "../client/errors";
import { createTestBackgroundSubmissions, createTestRyotClock } from "../testing";
import {
	createRyotBackgroundSubmission,
	useBackgroundSubmission,
} from "./background-submission-hook";
import { RyotProvider } from "./provider";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	return Effect.runPromise(
		Effect.forEach(clocks.splice(0), (clock) => Effect.promise(() => clock.dispose()), {
			discard: true,
		}),
	);
});

const logReading = createRyotBackgroundSubmission({
	slug: "log-reading",
	packageId: PluginPackageId.make("test/fixture"),
	label: (input: { readonly values: number[] }) => `Logged\n${input.values.join(", ")}`,
	inputSchema: Schema.Struct({
		at: Schema.String,
		key: Schema.String,
		values: Schema.Array(Schema.Finite),
	}),
	input: ({ input, submittedAt, submissionId }) => ({
		at: submittedAt,
		key: submissionId,
		values: input.values,
	}),
});

type Hook = ReturnType<
	typeof useBackgroundSubmission<{ readonly values: number[] }, typeof logReading.inputSchema>
>;

const mount = (background: ReturnType<typeof createTestBackgroundSubmissions>) => {
	const clock = createTestRyotClock(background.adapter);
	clocks.push(clock);
	let ids = 0;
	const current: { hook?: Hook } = {};
	function Probe() {
		const hook = useBackgroundSubmission(logReading, { createId: () => `key-${++ids}` });
		useLayoutEffect(() => {
			current.hook = hook;
		});
		return null;
	}
	const root = createRoot(document.createElement("div"));
	roots.push(root);
	act(() =>
		root.render(
			<RyotProvider runtime={clock.runtime}>
				<Probe />
			</RyotProvider>,
		),
	);
	const hook = () => {
		if (current.hook === undefined) {
			throw new Error("Hook did not render");
		}
		return current.hook;
	};
	return { hook, clock };
};

describe("useBackgroundSubmission", () => {
	it.live("snapshots the input, keys the write, and reports acceptance then settlement", () =>
		Effect.gen(function* () {
			const background = createTestBackgroundSubmissions();
			const { hook, clock } = mount(background);
			yield* Effect.promise(() => clock.setTime(Date.parse("2026-10-25T08:00:00Z")));
			const accepted: string[] = [];
			const values = [72.5];
			act(() => {
				hook().submit({ values }, { onAccepted: () => accepted.push("accepted") });
			});
			values.push(99);
			yield* Effect.promise(() => waitFor(() => expect(hook().state.status).toBe("accepted")));

			expect(accepted).toEqual(["accepted"]);
			expect(background.requests).toEqual([
				{
					slug: "log-reading",
					label: "Logged 72.5",
					idempotencyKey: "key-1",
					packageId: "test/fixture",
					input: { key: "key-1", values: [72.5], at: "2026-10-25T08:00:00.000Z" },
				},
			]);
			expect(hook().last).toBeNull();

			background.settle("submission-2", { status: "succeeded" });
			expect(hook().last).toBeNull();
			background.settle("submission-1", { status: "failed", reason: "transport" });
			expect(hook().last).toEqual({ status: "failed", reason: "transport" });
		}),
	);

	it.live("keeps a settlement that arrives before its acceptance resolves", () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const background = createTestBackgroundSubmissions(() =>
				Deferred.await(release).pipe(Effect.as("submission-early")),
			);
			const { hook } = mount(background);
			act(() => {
				hook().submit({ values: [1] });
			});
			expect(hook().isSending).toBe(true);
			background.settle("submission-early", { status: "succeeded" });
			yield* Deferred.succeed(release, undefined);
			yield* Effect.promise(() => waitFor(() => expect(hook().state.status).toBe("settled")));
			expect(hook().last).toEqual({ status: "succeeded" });
		}),
	);

	it.live("reports a refused acceptance and tracks only the latest submission", () =>
		Effect.gen(function* () {
			const background = createTestBackgroundSubmissions((request) =>
				request.idempotencyKey === "key-1"
					? Effect.fail(new RyotClientError("operation-failed"))
					: Effect.succeed(`submission-${request.idempotencyKey}`),
			);
			const { hook } = mount(background);
			const rejections: string[] = [];
			act(() => {
				hook().submit({ values: [1] }, { onRejected: (error) => rejections.push(error.reason) });
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(hook().error?.reason).toBe("operation-failed")),
			);
			expect(rejections).toEqual(["operation-failed"]);

			act(() => {
				hook().submit({ values: [2] });
			});
			yield* Effect.promise(() => waitFor(() => expect(hook().state.status).toBe("accepted")));
			expect(hook().error).toBeNull();
			background.settle("submission-key-2", {
				status: "failed",
				message: "Unknown metric",
				reason: "operation-rejected",
			});
			expect(hook().last).toEqual({
				status: "failed",
				message: "Unknown metric",
				reason: "operation-rejected",
			});
		}),
	);
});
