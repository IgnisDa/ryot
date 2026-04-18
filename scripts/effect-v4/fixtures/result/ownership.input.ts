import { Cron, Either, Schema } from "effect";

declare const condition: boolean;
declare const input: unknown;

const decode = Schema.decodeUnknownEither(Schema.String);
const decoded = decode(input);
const cron = Cron.parse("0 0 * * *");
const candidates = [Either.left("first"), Either.right("ok")];
const found = candidates.find(Either.isLeft);

let propagated = decoded;
propagated = condition ? Either.left("bad") : Either.right("good");

const read = (outcome: Either.Either<string, string>) => {
	if (outcome._tag === "Left") {
		return outcome.left;
	}
	const { right: value } = outcome;
	return value;
};

if (Either.isRight(decoded)) {
	void decoded.right;
}
if (Either.isLeft(cron)) {
	void cron.left;
}
if (found) {
	void found.left;
}
if (propagated._tag === "Left") {
	const { left: message } = propagated;
	void message;
} else {
	const { right } = propagated;
	void right;
}

const direct = Either.try(() => 1).right;
const nested = (condition ? Either.right("a") : Either.right("b")).right;
const { left: directFailure } = Either.left("direct");
const {
	right: { value },
} = Either.right({ value: 1 });

for (const item of [input]) {
	const repeated = Either.try(() => item);
	if (Either.isLeft(repeated)) {
		void repeated.left;
	}
}
for (const item of [input]) {
	const repeated = Either.right(item);
	if (Either.isRight(repeated)) {
		void repeated.right;
	}
}

void [read, direct, nested, directFailure, value];
