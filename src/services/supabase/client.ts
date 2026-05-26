import type { Db } from "../../db/client.js";
import { getPool } from "../../db/client.js";

export type VelioraDb = Db;

export function getVelioraDb(): VelioraDb {
  return getPool();
}
