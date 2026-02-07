import { Schema as S } from "./effect";

class Local extends S.TaggedErrorClass<Local>()("Local", { cause: S.Unknown }) {}
