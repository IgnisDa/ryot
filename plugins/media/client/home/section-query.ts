import type { RyotClient, RyotClientError } from "@ryot-app/plugin-client-sdk";
import type { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";

export const createHomeSectionQuery = <Input, Data>(
	read: (input: Input, client: RyotClient) => Effect.Effect<Data, RyotClientError>,
	visible: (data: Data) => readonly string[],
) =>
	createRyotQuery<Input, Data>(({ input, client }) => read(input, client), {
		entityWatch: ({ data }) => ({
			foreground: [],
			visible: data === undefined ? [] : visible(data),
		}),
	});
