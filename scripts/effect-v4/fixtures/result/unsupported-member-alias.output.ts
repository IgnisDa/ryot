import { Either } from "effect";

const direct = Either.left("direct");
const fail = Either.left;
const value = fail("aliased");

void [direct, value.left];
