import { ProKeyVerification } from "@ryot-app/instance-contract/pro-key";
import { Effect, Schema } from "effect";

import { getProKeyVerifier } from "~/server/config.server";
import { fromPromise, WebsiteFailure } from "~/server/effect.server";
import { runPromise } from "~/server/runtime.server";

import type { Route } from "./+types/api.pro-key.verify";

const decodeVerification = Schema.decodeUnknownEffect(ProKeyVerification);
const encodeVerification = Schema.encodeEffect(ProKeyVerification);
const responseHeaders = { "Cache-Control": "no-store" };
const unavailable = () => new Response(null, { status: 503, headers: responseHeaders });

export const action = ({ request }: Route.ActionArgs) =>
	runPromise(
		Effect.gen(function* () {
			if (request.method !== "POST") {
				return new Response(null, { status: 405, headers: { Allow: "POST" } });
			}
			const key = request.headers.get("authorization")?.match(/^Bearer (\S{1,4096})$/i)?.[1];
			if (key === undefined) {
				return new Response(null, { status: 400, headers: responseHeaders });
			}
			const client = yield* Effect.try({
				try: getProKeyVerifier,
				catch: (cause) => new WebsiteFailure({ cause }),
			});
			if (client === undefined) {
				return unavailable();
			}
			const { data } = yield* fromPromise(() => client.keys.verifyKey({ key }));
			const expiry: unknown = data.meta?.["expiry"];
			const result = yield* decodeVerification(
				data.valid ? { expiry, valid: true } : { valid: false },
			);
			return Response.json(yield* encodeVerification(result), { headers: responseHeaders });
		}).pipe(Effect.orElseSucceed(unavailable)),
	);
