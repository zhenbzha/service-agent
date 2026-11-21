// Runs the production build the same way the container does (see Dockerfile).
// The standalone server.js doesn't serve public/ or .next/static until they are copied next to it:
// https://nextjs.org/docs/app/api-reference/config/next-config-js/output#automatically-copying-traced-files
// Node's fs.cpSync stands in for the docs' `cp -r`, which Windows shells don't have.
import { cpSync } from "node:fs";

cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });

// Reads PORT and HOSTNAME from the environment, like in the container.
await import("../.next/standalone/server.js");
