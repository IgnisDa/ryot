import { type Either as FacadeEither } from "@ryot/sandbox-sdk/effect";
import type { Either } from "effect";

export type Value = Either.Either<number, string>;
export type FacadeValue = FacadeEither.Either<number, string>;
