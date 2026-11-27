import { Option, Schema } from "effect";

export const decodeOAuthTokenClaims = <A>(
	token: string,
	schema: Schema.Codec<A>,
): Option.Option<A> => {
	const payload = token.split(".")[1];
	if (!payload) {
		return Option.none();
	}
	const base64 = payload
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(Math.ceil(payload.length / 4) * 4, "=");
	let json: string;
	try {
		json = atob(base64);
	} catch {
		return Option.none();
	}
	return Schema.decodeOption(Schema.fromJsonString(schema))(json);
};
