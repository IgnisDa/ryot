import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { providerRateLimit as table } from "#schema/tables/provider-rate-limits";

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isNonEmpty()));
const PositiveSafeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
const SafeInterval = PositiveSafeInteger.pipe(
	Schema.check(Schema.isLessThanOrEqualTo(Math.floor(Number.MAX_SAFE_INTEGER / 10))),
);

/** The longest a provider's `Retry-After` can hold back its host. */
export const PROVIDER_HTTP_RETRY_AFTER_LIMIT_MS = 3_600_000;

export const ProviderHttpAdmissionDeclaration = Schema.Struct({
	key: NonEmptyString,
	intervalMs: SafeInterval,
	requests: PositiveSafeInteger,
});
export type ProviderHttpAdmissionDeclaration = typeof ProviderHttpAdmissionDeclaration.Type;

export class ProviderHttpAdmissionUnavailable extends Schema.TaggedError<
	ProviderHttpAdmissionUnavailable,
	{ readonly brand: unique symbol }
>()("ProviderHttpAdmissionUnavailable", { message: Schema.String }) {}

const spacingMs = ({ requests, intervalMs }: ProviderHttpAdmissionDeclaration) =>
	Math.ceil(intervalMs / requests);

/** Spaces requests to one provider across every process with one row, whose time is the next free slot. */
export class ProviderHttpAdmissionService extends Context.Service<ProviderHttpAdmissionService>()(
	"@ryot-app/kernel-backend/modules/scripts/host/http-admission/ProviderHttpAdmissionService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const unavailable = Effect.mapError(
				(error: { readonly message: string }) =>
					new ProviderHttpAdmissionUnavailable({ message: error.message }),
			);
			return {
				/** Spaces the next slot from when a request actually leaves, which is later than its slot under load. */
				sending: (declaration: ProviderHttpAdmissionDeclaration) =>
					session
						.detached(
							session.run((db) =>
								db.execute(
									sql`update ${table} set next_allowed_at =
										greatest(${table.nextAllowedAt}, now() + ${spacingMs(declaration)} * interval '1 millisecond')
									where key = ${declaration.key}`,
								),
							),
						)
						.pipe(Effect.asVoid, unavailable),
				block: (declaration: ProviderHttpAdmissionDeclaration, delayMs: number) =>
					session
						.detached(
							session.run((db) =>
								db.execute(
									sql`insert into ${table} (key, next_allowed_at)
									values (${declaration.key}, now() + ${delayMs} * interval '1 millisecond')
									on conflict (key) do update set next_allowed_at =
										greatest(${table.nextAllowedAt}, now() + ${delayMs} * interval '1 millisecond')`,
								),
							),
						)
						.pipe(Effect.asVoid, unavailable),
				reserve: (declaration: ProviderHttpAdmissionDeclaration) =>
					session
						.detached(
							session.run((db) =>
								db.execute<{ wait_ms: number }>(
									sql`insert into ${table} (key, next_allowed_at)
									values (${declaration.key}, now() + ${spacingMs(declaration)} * interval '1 millisecond')
									on conflict (key) do update set next_allowed_at =
										greatest(${table.nextAllowedAt}, now()) + ${spacingMs(declaration)} * interval '1 millisecond'
									returning greatest(0, extract(epoch from next_allowed_at - now()) * 1000 - ${spacingMs(declaration)})::float8 as wait_ms`,
									"objects",
								),
							),
						)
						.pipe(
							Effect.map(([row]) => Math.ceil(row?.wait_ms ?? 0)),
							unavailable,
						),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
