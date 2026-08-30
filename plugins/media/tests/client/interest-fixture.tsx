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

const Probe = <Data,>({
	query,
	entityId,
}: {
	readonly entityId: string;
	readonly query: RyotQuery<{ readonly entityId: string }, Data>;
}) => <p>{classifyRyotQueryResult(useRyotQuery(query, { entityId })).status}</p>;

export const declaresEntityInterest =
	(entityId: string) =>
	<Data,>(
		name: string,
		query: RyotQuery<{ readonly entityId: string }, Data>,
		response: unknown,
		visible: readonly string[],
	) => {
		it(`${name} watches every entity it renders`, () => {
			const recording = recordingAdapter();
			const view = mountRyotClient(recording.adapter, <Probe query={query} entityId={entityId} />);
			return Promise.resolve(flushRyotClient())
				.then(() =>
					act(() => {
						recording.requests[0]?.resolve(response);
						return Promise.resolve().then(() => undefined);
					}),
				)
				.then(() => waitFor(() => expect(view.container.textContent).toContain("ready")))
				.then(() => {
					expect(recording.interests.at(-1)).toEqual({
						foreground: [entityId],
						visible: [...visible].sort(),
					});
					view.unmount();
					return undefined;
				});
		});
	};
