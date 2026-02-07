import { Result } from "effect";

declare const value: Result.Result<number, string>;

const attempted = Result.try(() => 1);
const failed = Result.fail("failed");
const succeeded = Result.succeed(1);
const failure = Result.getFailure(value);
const success = Result.getSuccess(value);
const unwrapped = Result.getOrThrow(value);
const customized = Result.getOrThrowWith(value, () => new Error("failed"));

if (Result.isFailure(failed) || Result.isSuccess(succeeded)) {
	void [attempted, failure, success, unwrapped, customized];
}
