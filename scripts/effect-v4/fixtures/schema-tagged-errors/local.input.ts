import { Schema as S } from "./effect";

class Local extends S.TaggedError<Local>()("Local", { cause: S.Unknown }) {}
