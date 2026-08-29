import type { EntityInterest, RyotClientAdapter } from "@ryot-app/client-sdk";
import { Effect } from "@ryot-app/client-sdk/effect";
import { useRyotQuery, type RyotQuery } from "@ryot-app/client-sdk/react";
import { waitFor } from "@testing-library/dom";
import { act } from "react";
import { expect, it } from "vitest";

import { classifyRyotQueryResult } from "../../client/media/query-state";
import { flushRyotClient, mountRyotClient } from "./test-support";

const recordingAdapter = () => {
	const interests: EntityInterest[] = [];
	const requests: Array<{ resolve: (data: unknown) => void }> = [];
	const adapter: Partial<RyotClientAdapter> = {
		query: () =>
			Effect.callback<unknown>((resume) => {
				requests.push({ resolve: (data) => resume(Effect.succeed(data)) });
			}),
		watchEntities: (interest) => {
			interests.push(interest);
			return { dispose: () => undefined, update: (next) => interests.push(next) };
		},
	};
	return { adapter, requests, interests };
};

export const declaresEntityInterest =
	(entityId: string) =>
	<Data,>(
		name: string,
		query: RyotQuery<{ readonly entityId: string }, Data>,
		response: unknown,
		visible: readonly string[],
	) => {
		// oxlint-disable-next-line effecttsgo/async-function -- Vitest awaits the client test harness's Promise callbacks.
		it(`${name} watches every entity it renders`, async () => {
			const recording = recordingAdapter();
			function Probe() {
				return <p>{classifyRyotQueryResult(useRyotQuery(query, { entityId })).status}</p>;
			}
			const view = mountRyotClient(recording.adapter, <Probe />);
			await flushRyotClient();
			// oxlint-disable-next-line effecttsgo/async-function -- React act awaits the asynchronous request completion.
			await act(async () => {
				recording.requests[0]?.resolve(response);
				await Promise.resolve();
			});
			await waitFor(() => expect(view.container.textContent).toContain("ready"));

			expect(recording.interests.at(-1)).toEqual({
				foreground: [entityId],
				visible: [...visible].sort(),
			});
			view.unmount();
		});
	};
