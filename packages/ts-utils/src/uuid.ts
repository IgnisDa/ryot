import { uuidV4Unsafe } from "effect/crypto/SecureRandom";

export const createUuid = () => uuidV4Unsafe();
