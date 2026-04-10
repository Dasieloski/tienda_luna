/**
 * Arranca Postgres solo si el daemon de Docker responde.
 */
const { spawnSync, execSync } = require("child_process");
const { resolve } = require("path");

const root = resolve(__dirname, "..");

function dockerOk() {
  try {
    execSync("docker info", { stdio: "pipe", cwd: root });
    return true;
  } catch {
    return false;
  }
}

if (!dockerOk()) {
  console.error(`
[tienda-luna] Docker no responde (Docker Desktop apagado o no instalado).

En Windows:
  1) Instala "Docker Desktop" desde https://www.docker.com/products/docker-desktop/
  2) Abre Docker Desktop y espera hasta que ponga "Engine running" / icono verde.
  3) Vuelve a ejecutar: npm run db:up

Sin Docker: instala PostgreSQL en Windows y pon en .env, por ejemplo:
  DATABASE_URL="postgresql://USUARIO:CLAVE@127.0.0.1:5432/postgres"
`);
  process.exit(1);
}

const r = spawnSync("docker", ["compose", "up", "-d"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(r.status ?? 1);
