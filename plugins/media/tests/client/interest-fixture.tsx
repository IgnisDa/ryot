import type { EntityInterest, RyotClientAdapter } from "@ryot-app/client-sdk";
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
		query: () => new Promise((resolve) => requests.push({ resolve })),
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
		it(`${name} watches every entity it renders`, async () => {
			const recording = recordingAdapter();
			function Probe() {
				return <p>{classifyRyotQueryResult(useRyotQuery(query, { entityId })).status}</p>;
			}
			const view = mountRyotClient(recording.adapter, <Probe />);
			await flushRyotClient();
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
