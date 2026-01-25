import { type Result as FacadeEither } from "@ryot/sandbox-sdk/effect";
import type { Result } from "effect";

export type Value = Result.Result<number, string>;
export type FacadeValue = FacadeEither.Result<number, string>;
