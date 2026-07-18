import { Either as FacadeEither } from "@ryot/sandbox-sdk/effect";
import { Either, Result, type Either as EitherType } from "effect";

export { Either, Result } from "@ryot/sandbox-sdk/effect";
export type { Either as LegacyEither } from "effect";

const failure = Either.left("no");
const facadeFailure = FacadeEither.left("facade");
const typed: EitherType.Either<number, string> = failure;

void [Result, facadeFailure, typed];
