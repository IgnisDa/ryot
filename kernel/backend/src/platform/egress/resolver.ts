import { Context, Effect, Layer, Schema } from "effect";

export class EgressResolutionError extends Schema.TaggedError<
	EgressResolutionError,
	{ readonly brand: unique symbol }
>()("EgressResolutionError", { hostname: Schema.String }) {}

export class EgressResolver extends Context.Service<
	EgressResolver,
	{
		readonly resolve: (
			hostname: string,
		) => Effect.Effect<ReadonlyArray<string>, EgressResolutionError>;
	}
>()("@ryot-app/kernel-backend/platform/egress/resolver/EgressResolver") {
	static readonly layer = Layer.succeed(this, {
		resolve: (hostname) =>
			Effect.tryPromise({
				try: () => Bun.dns.lookup(hostname),
				catch: () => new EgressResolutionError({ hostname }),
			}).pipe(Effect.map((entries) => entries.map((entry) => entry.address))),
	});
}
