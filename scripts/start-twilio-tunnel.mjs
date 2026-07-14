import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const windowsInstall = "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
const executable =
  process.env.CLOUDFLARED_PATH ||
  (process.platform === "win32" && existsSync(windowsInstall)
    ? windowsInstall
    : "cloudflared");

console.log(
  "Opening a temporary public tunnel to the Twilio-only gateway at 127.0.0.1:4001."
);
console.log("Keep this process running and press Ctrl+C to close the tunnel.");

const tunnel = spawn(
  executable,
  ["tunnel", "--url", "http://127.0.0.1:4001"],
  { stdio: "inherit" }
);

tunnel.on("error", (error) => {
  console.error(`Unable to start cloudflared: ${error.message}`);
  console.error(
    "Install Cloudflare Tunnel or set CLOUDFLARED_PATH to cloudflared.exe."
  );
  process.exitCode = 1;
});

tunnel.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
