import {
	PublicationUnavailable,
	type PublicationUnavailableCode,
} from "@ryot-app/contract/modules/publications/schemas";
import { PublicationId } from "@ryot-app/contract/schema/brands";
import { Clock, Effect, Option, Schema } from "effect";

import type { ServerOrigin } from "#/api/origin";
import {
	PublicationVisitApiError,
	type PublicationVisitsApi,
	type PublicationVisitScope,
} from "#/api/publications";

const SESSION_RENEWAL_MARGIN_MS = 30_000;
const PREVIEW_FRAGMENT_PREFIX = "session=";

const VisitCredentials = Schema.Struct({
	secret: Schema.NullOr(Schema.String),
	session: Schema.NullOr(Schema.Struct({ token: Schema.String, expiresAt: Schema.Finite })),
});
export type VisitCredentials = typeof VisitCredentials.Type;

const VisitCredentialsJson = Schema.fromJsonString(VisitCredentials);

const storageKey = (publicationId: string) => `ryot.publication-visit.${publicationId}`;

const readStored = (publicationId: string): VisitCredentials => {
	try {
		const raw = window.sessionStorage.getItem(storageKey(publicationId));
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
			window.sessionStorage.setItem(storageKey(publicationId), raw),
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
	const credentials: VisitCredentials = value.startsWith(PREVIEW_FRAGMENT_PREFIX)
		? {
				secret: null,
				session: {
					expiresAt: Number.MAX_SAFE_INTEGER,
					token: value.slice(PREVIEW_FRAGMENT_PREFIX.length),
				},
			}
		: { secret: value, session: null };
	writeStored(publicationId, credentials);
	return credentials;
};

export const previewHash = (sessionToken: string) => `${PREVIEW_FRAGMENT_PREFIX}${sessionToken}`;

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
