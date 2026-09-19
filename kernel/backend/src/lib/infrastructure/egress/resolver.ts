import { type Cause, Context, Effect, Layer } from "effect";

export class EgressResolver extends Context.Service<
	EgressResolver,
	{
		readonly resolve: (
			hostname: string,
		) => Effect.Effect<ReadonlyArray<string>, Cause.UnknownError>;
	}
>()("EgressResolver") {
	static readonly layer = Layer.succeed(this, {
		resolve: (hostname) =>
			Effect.tryPromise(() => Bun.dns.lookup(hostname)).pipe(
				Effect.map((entries) => entries.map((entry) => entry.address)),
			),
	});
}
