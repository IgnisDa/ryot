import { FileSystem } from "@effect/platform";
import { isPlatformError } from "@effect/platform/Error";

export const predicate = isPlatformError;
export const fileSystem = FileSystem;
