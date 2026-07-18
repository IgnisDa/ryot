import { Either } from "effect";

const { ["left"]: failure } = Either.left("failed");

void failure;
