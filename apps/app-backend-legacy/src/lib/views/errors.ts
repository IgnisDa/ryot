export class QueryEngineNotFoundError extends Error {
	code = "NOT_FOUND" as const;
}

export class QueryEngineValidationError extends Error {
	code: string;
	constructor(input: string | { code: string; message: string }) {
		if (typeof input === "string") {
			super(input);
			this.code = "VALIDATION";
		} else {
			super(input.message);
			this.code = input.code;
		}
	}
}
