import { Schema } from "effect";

export const decodeOAuthTokenClaims = <A>(token: string, schema: Schema.Codec<A>) => {
	const payload = token.split(".")[1];
	if (!payload) {
		throw new Error("OAuth token payload is missing");
	}
	const base64 = payload
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(payload.length / 4) * 4, "=");
	return Schema.decodeSync(Schema.fromJsonString(schema))(atob(base64));
};
