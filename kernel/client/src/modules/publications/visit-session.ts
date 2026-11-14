import {
	PublicationUnavailable,
	type PublicationUnavailableCode,
} from "@ryot-app/contract/modules/publications/schemas";
import { PublicationId } from "@ryot-app/contract/schema/brands";
import type { PluginRyotQLOutcome, PluginRyotQLRequest } from "@ryot-app/plugin-client-contract";
import { Clock, Effect, Option, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import {
	isPublicationVisitFailure,
	PublicationVisitApiError,
	type PublicationVisitsApi,
	type PublicationVisitScope,
} from "#/api/publications";
import { classifyRyotQLCause } from "#/api/ryotql";
import { publicationVisitKey } from "#/persistence/storage";

const SESSION_RENEWAL_MARGIN_MS = 30_000;
const PREVIEW_SESSION_KEY = "session";
const PREVIEW_EXPIRES_KEY = "expires";

const VisitCredentials = Schema.Struct({
	secret: Schema.NullOr(Schema.String),
	session: Schema.NullOr(Schema.Struct({ token: Schema.String, expiresAt: Schema.Finite })),
});
export type VisitCredentials = typeof VisitCredentials.Type;

const VisitCredentialsJson = Schema.fromJsonString(VisitCredentials);

const readStored = (publicationId: string): VisitCredentials => {
	try {
		const raw = window.sessionStorage.getItem(publicationVisitKey(publicationId));
		return raw === null
			? { secret: null, session: null }
			: Option.getOrElse(Schema.decodeOption(VisitCredentialsJson)(raw), () => ({
					secret: null,
					session: null,
				}));
	} catch {
		return { secret: null, session: null };
	}
};

const writeStored = (publicationId: string, credentials: VisitCredentials) => {
	try {
		Option.map(Schema.encodeOption(VisitCredentialsJson)(credentials), (raw) =>
			window.sessionStorage.setItem(publicationVisitKey(publicationId), raw),
		);
	} catch {
		// Without session storage the visit still works until the page is reloaded.
	}
};

/**
 * Takes the link secret (or an owner preview session) out of the URL fragment, which never reaches
 * the server or referrers, and keeps it for this tab only.
 */
export const takeVisitCredentials = (publicationId: string, fragment: string): VisitCredentials => {
	const stored = readStored(publicationId);
	const value = fragment.replace(/^#/, "");
	if (value === "") {
		return stored;
	}
	const preview = new URLSearchParams(value);
	const previewToken = preview.get(PREVIEW_SESSION_KEY);
	const previewExpiresAt = Date.parse(preview.get(PREVIEW_EXPIRES_KEY) ?? "");
	const credentials: VisitCredentials =
		previewToken === null
			? { secret: value, session: null }
			: {
					secret: null,
					session: {
						token: previewToken,
						expiresAt: Number.isNaN(previewExpiresAt) ? 0 : previewExpiresAt,
					},
				};
	writeStored(publicationId, credentials);
	return credentials;
};

export const previewHash = (session: {
	readonly expiresAt: string;
	readonly sessionToken: string;
}) =>
	new URLSearchParams({
		[PREVIEW_EXPIRES_KEY]: session.expiresAt,
		[PREVIEW_SESSION_KEY]: session.sessionToken,
	}).toString();

export const unavailableCode = (error: unknown): null | PublicationUnavailableCode =>
	error instanceof PublicationVisitApiError && Schema.is(PublicationUnavailable)(error.cause)
		? error.cause.reason.code
		: null;

const sessionExpired = () =>
	new PublicationVisitApiError({
		cause: new PublicationUnavailable({ reason: { code: "session-expired" } }),
	});

export const makeVisitSession = (input: {
	readonly origin: ServerOrigin;
	readonly publicationId: string;
	readonly credentials: VisitCredentials;
	readonly api: PublicationVisitsApi["Service"];
}) => {
	let credentials = input.credentials;
	const update = (next: VisitCredentials) => {
		credentials = next;
		writeStored(input.publicationId, next);
	};
	const current = Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis;
		const { secret, session } = credentials;
		if (session !== null && session.expiresAt - SESSION_RENEWAL_MARGIN_MS > now) {
			return session.token;
		}
		if (secret === null) {
			return yield* sessionExpired();
		}
		const exchanged = yield* input.api.exchange(input.origin, {
			payload: { secret, publicationId: PublicationId.make(input.publicationId) },
		});
		update({
			secret,
			session: { token: exchanged.sessionToken, expiresAt: Date.parse(exchanged.expiresAt) },
		});
		return exchanged.sessionToken;
	});
	const once = <A>(
		request: (scope: PublicationVisitScope) => Effect.Effect<A, PublicationVisitApiError>,
	) => Effect.flatMap(current, (sessionToken) => request({ sessionToken, origin: input.origin }));
	const run = <A>(
		request: (scope: PublicationVisitScope) => Effect.Effect<A, PublicationVisitApiError>,
	) =>
		once(request).pipe(
			Effect.catchIf(
				(error) => unavailableCode(error) === "session-expired" && credentials.secret !== null,
				() =>
					Effect.suspend(() => {
						update({ ...credentials, session: null });
						return once(request);
					}),
			),
		);
	return { run, origin: input.origin };
};

export type VisitSession = ReturnType<typeof makeVisitSession>;

export const queryPublication = Effect.fn("queryPublication")(function* (
	session: VisitSession,
	api: PublicationVisitsApi["Service"],
	request: PluginRyotQLRequest,
) {
	if (request.action !== "page-execute" && request.action !== "page-describe") {
		return { outcome: "failure", reason: "query-failed" } as const;
	}
	const program = (
		scope: PublicationVisitScope,
	): Effect.Effect<
		Extract<PluginRyotQLOutcome, { readonly outcome: "success" }>["response"],
		PublicationVisitApiError
	> =>
		request.action === "page-describe"
			? api.describe(scope, { payload: request.request })
			: api.ryotql(scope, { payload: request.request });
	return yield* session
		.run(program)
		.pipe(
			Effect.match({
				onSuccess: (response) => ({ response, outcome: "success" }) as const,
				onFailure: (error) =>
					({
						outcome: "failure",
						reason: classifyRyotQLCause(error.cause, isPublicationVisitFailure),
					}) as const,
			}),
		);
});
