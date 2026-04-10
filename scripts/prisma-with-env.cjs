/**
 * Ejecuta Prisma con .env del repo pisando variables del sistema (p. ej. DATABASE_URL=prisma+…).
 * Uso: node scripts/prisma-with-env.cjs db push
 */
const { config } = require("dotenv");
const { resolve } = require("path");
const { spawnSync } = require("child_process");

const root = resolve(__dirname, "..");
config({ path: resolve(root, ".env"), override: true });
config({ path: resolve(root, ".env.local"), override: true });

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Uso: node scripts/prisma-with-env.cjs <comando prisma> [...]");
  process.exit(1);
}

const r = spawnSync("npx", ["prisma", ...args], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(r.status ?? 1);
