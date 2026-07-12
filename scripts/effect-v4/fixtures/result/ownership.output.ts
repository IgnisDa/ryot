import { Cron, Result, Schema } from "effect";

declare const condition: boolean;
declare const input: unknown;

const decode = Schema.decodeUnknownEither(Schema.String);
const decoded = decode(input);
const cron = Cron.parse("0 0 * * *");
const candidates = [Result.fail("first"), Result.succeed("ok")];
const found = candidates.find(Result.isFailure);

let propagated = decoded;
propagated = condition ? Result.fail("bad") : Result.succeed("good");

const read = (outcome: Result.Result<string, string>) => {
	if (outcome._tag === "Failure") {
		return outcome.failure;
	}
	const { success: value } = outcome;
	return value;
};

if (Result.isSuccess(decoded)) {
	void decoded.success;
}
if (Result.isFailure(cron)) {
	void cron.failure;
}
if (found) {
	void found.failure;
}
if (propagated._tag === "Failure") {
	const { failure: message } = propagated;
	void message;
} else {
	const { success: right } = propagated;
	void right;
}

const direct = Result.try(() => 1).success;
const nested = (condition ? Result.succeed("a") : Result.succeed("b")).success;
const { failure: directFailure } = Result.fail("direct");
const {
	success: { value },
} = Result.succeed({ value: 1 });

for (const item of [input]) {
	const repeated = Result.try(() => item);
	if (Result.isFailure(repeated)) {
		void repeated.failure;
	}
}
for (const item of [input]) {
	const repeated = Result.succeed(item);
	if (Result.isSuccess(repeated)) {
		void repeated.success;
	}
}

void [read, direct, nested, directFailure, value];
