import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Pisa variables de entorno del sistema (p. ej. DATABASE_URL=prisma+… viejo) con el .env del repo.
const root = process.cwd();
loadEnv({ path: resolve(root, ".env"), override: true });
loadEnv({ path: resolve(root, ".env.local"), override: true });

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;
