import { Encoding, Result, Schema } from "effect";

export const CanonicalBase64 = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => {
			if (
				value.length % 4 !== 0 ||
				!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)
			) {
				return "Expected canonical padded Base64";
			}
			const decoded = Encoding.decodeBase64(value);
			return Result.isSuccess(decoded) && Encoding.encodeBase64(decoded.success) === value
				? true
				: "Expected canonical padded Base64";
		}),
	),
);
