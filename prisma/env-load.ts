import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

/** Debe ser el primer import de seed.ts para que .env pise variables del sistema (p. ej. prisma+). */
loadEnv({ path: resolve(process.cwd(), ".env"), override: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });
