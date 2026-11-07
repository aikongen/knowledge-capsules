import { withWriteGuard } from "../../src/lease.ts";

const [vaultRoot, mode, waitMs] = process.argv.slice(2);
if (vaultRoot === undefined || (mode !== "hold" && mode !== "release")) {
  process.stderr.write("usage: lease-contender.ts <vault-root> <hold|release>\n");
  process.exitCode = 2;
} else {
  try {
    await withWriteGuard(vaultRoot, async () => {
      process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
      if (mode === "hold") await new Promise<void>(() => setInterval(() => undefined, 1_000));
    }, waitMs === undefined ? undefined : Number(waitMs));
  } catch (cause) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: (cause as { code?: string }).code })}\n`);
  }
}
