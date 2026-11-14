import { Result } from "effect";

export const parseHttpBaseUrl = (value: string) =>
	Result.try(() => {
		const url = new URL(value);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username !== "" ||
			url.password !== "" ||
			url.search !== "" ||
			url.hash !== ""
		) {
			throw new Error("Invalid HTTP base URL");
		}
		return value.replace(/\/+$/, "");
	});
