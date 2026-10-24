import { Effect, Schema } from "effect";

export class WebsiteFailure extends Schema.TaggedError<
	WebsiteFailure,
	{ readonly brand: unique symbol }
>()("WebsiteFailure", { cause: Schema.Unknown }) {}

export const fromPromise = <A>(run: () => PromiseLike<A>) =>
	Effect.tryPromise({
		try: () => Promise.resolve(run()),
		catch: (cause) => new WebsiteFailure({ cause }),
	});
