import { Result, Schema } from "effect";
import { Base64 } from "effect/encoding";

export const CanonicalBase64 = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) => {
			if (
				value.length % 4 !== 0 ||
				!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)
			) {
				return "Expected canonical padded Base64";
			}
			const decoded = Base64.decode(value);
			return Result.isSuccess(decoded) && Base64.encode(decoded.success) === value
				? true
				: "Expected canonical padded Base64";
		}),
	),
);
