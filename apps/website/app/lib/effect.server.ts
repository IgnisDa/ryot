import { Data, Effect } from "effect";

export class WebsiteFailure extends Data.TaggedError("WebsiteFailure")<{ cause: unknown }> {}

export const fromPromise = <A>(run: () => PromiseLike<A>) =>
	Effect.tryPromise({
		try: () => Promise.resolve(run()),
		catch: (cause) => new WebsiteFailure({ cause }),
	});
