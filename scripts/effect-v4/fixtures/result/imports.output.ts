import { Result as FacadeEither } from "@ryot/sandbox-sdk/effect";
import { Result, type Result as EitherType } from "effect";

export { Result } from "@ryot/sandbox-sdk/effect";
export type { Result as LegacyEither } from "effect";

const failure = Result.fail("no");
const facadeFailure = FacadeEither.fail("facade");
const typed: EitherType.Result<number, string> = failure;

void [Result, facadeFailure, typed];
