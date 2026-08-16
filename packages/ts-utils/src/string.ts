import { camelCase, startCase } from "./lodash";

/**
 * Change case to a presentable format.
 */
export const changeCase = (name: string) => startCase(camelCase(name.toLowerCase()));
