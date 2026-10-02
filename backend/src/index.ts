import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), "../.env") });
dotenv.config();

const { startServer } = await import("./server.js");

void startServer().catch((error: unknown) => {
  console.error("AeroGuard server startup failed", error);
  process.exitCode = 1;
});
