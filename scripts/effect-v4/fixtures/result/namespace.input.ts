import { Either } from "effect";

declare const value: Either.Either<number, string>;

const attempted = Either.try(() => 1);
const failed = Either.left("failed");
const succeeded = Either.right(1);
const failure = Either.getLeft(value);
const success = Either.getRight(value);
const unwrapped = Either.getOrThrow(value);
const customized = Either.getOrThrowWith(value, () => new Error("failed"));

if (Either.isLeft(failed) || Either.isRight(succeeded)) {
	void [attempted, failure, success, unwrapped, customized];
}
