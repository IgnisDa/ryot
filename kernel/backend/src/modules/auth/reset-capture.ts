import { badRequest, type DbError, internalError } from "@ryot-app/contract/errors";
import { Deferred, Effect, Schema } from "effect";

const captureHeader = "x-ryot-reset-capture-id";

export type ResetCaptureTransport = {
	readonly reserve: (email: string, id: string) => Effect.Effect<boolean, DbError>;
	readonly release: (email: string, id: string) => Effect.Effect<unknown, DbError>;
	readonly deliver: (email: string, id: string, message: string) => Effect.Effect<unknown, DbError>;
	readonly subscriber: () => {
		readonly quit: () => Effect.Effect<unknown, DbError>;
		readonly subscribe: (id: string) => Effect.Effect<unknown, DbError>;
		readonly unsubscribe: (id: string) => Effect.Effect<unknown, DbError>;
		readonly onMessage: (listener: (id: string, message: string) => void) => void;
		readonly offMessage: (listener: (id: string, message: string) => void) => void;
	};
};

const ResetLinkMessage = Schema.fromJsonString(
	Schema.Struct({ email: Schema.String, resetUrl: Schema.String }),
);

export const deliverResetLink = (args: {
	readonly email: string;
	readonly token: string;
	readonly frontendUrl: string;
	readonly request: Request | undefined;
	readonly transport: ResetCaptureTransport;
}) =>
	Effect.gen(function* () {
		const id = args.request?.headers.get(captureHeader);
		if (!id) {
			return;
		}
		const resetUrl = `${args.frontendUrl}/reset-password?token=${args.token}`;
		const message = yield* Schema.encodeEffect(ResetLinkMessage)({
			resetUrl,
			email: args.email,
		}).pipe(Effect.orDie);
		yield* args.transport.deliver(args.email, id, message);
	});

export const captureResetLink = Effect.fn("AuthService.captureResetLink")(function* (args: {
	readonly email: string;
	readonly timeoutMs: number;
	readonly frontendUrl: string;
	readonly transport: ResetCaptureTransport;
	readonly initiate: (request: Request) => Promise<Response>;
}) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const runtime = yield* Effect.context();
			const id = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const reservationId = crypto.randomUUID();
					const reserved = yield* args.transport
						.reserve(args.email, reservationId)
						.pipe(Effect.mapError(() => internalError("Reset link reservation failed")));
					if (!reserved) {
						return yield* badRequest(
							"A password reset link is already being generated for this user. Please try again shortly.",
						);
					}
					return reservationId;
				}),
				(reservationId) => args.transport.release(args.email, reservationId).pipe(Effect.ignore),
			);
			const subscriber = yield* Effect.acquireRelease(
				Effect.sync(() => args.transport.subscriber()),
				(active) =>
					Effect.all(
						[active.unsubscribe(id).pipe(Effect.ignore), active.quit().pipe(Effect.ignore)],
						{ discard: true },
					),
			);
			const received = yield* Deferred.make<{ email: string; resetUrl: string }>();
			const listener = (channel: string, message: string) => {
				if (channel !== id) {
					return;
				}
				const decoded = Schema.decodeOption(ResetLinkMessage)(message);
				if (decoded._tag === "Some" && decoded.value.email === args.email) {
					Effect.runSyncWith(runtime)(Deferred.succeed(received, decoded.value));
				}
			};
			subscriber.onMessage(listener);
			yield* Effect.addFinalizer(() => Effect.sync(() => subscriber.offMessage(listener)));
			yield* subscriber
				.subscribe(id)
				.pipe(Effect.mapError(() => internalError("Reset link subscription failed")));
			const request = new Request(`${args.frontendUrl}/api/auth/request-password-reset`, {
				method: "POST",
				headers: { [captureHeader]: id, "content-type": "application/json" },
				body: yield* Schema.encodeEffect(
					Schema.fromJsonString(Schema.Struct({ email: Schema.String })),
				)({ email: args.email }).pipe(Effect.orDie),
			});
			return yield* Effect.tryPromise({
				try: () => args.initiate(request),
				catch: () => internalError("Reset link initiation failed"),
			}).pipe(
				Effect.flatMap((response) =>
					response.ok ? Effect.void : Effect.fail(internalError("Reset link initiation failed")),
				),
				Effect.andThen(Deferred.await(received)),
				Effect.timeoutOrElse({
					duration: args.timeoutMs,
					orElse: () =>
						Effect.fail(internalError("Reset link capture timed out - please try again")),
				}),
			);
		}),
	);
});
