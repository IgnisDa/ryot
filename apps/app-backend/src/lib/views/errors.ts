export class QueryEngineNotFoundError extends Error {
	readonly code = "NOT_FOUND";
	constructor(message: string) {
		super(message);
		this.name = "QueryEngineNotFoundError";
	}
}

export class QueryEngineValidationError extends Error {
	readonly code: string;
	constructor(messageOrOptions: string | { code: string; message: string }) {
		const message =
			typeof messageOrOptions === "string" ? messageOrOptions : messageOrOptions.message;
		super(message);
		this.name = "QueryEngineValidationError";
		this.code = typeof messageOrOptions === "string" ? "VALIDATION" : messageOrOptions.code;
	}
}
