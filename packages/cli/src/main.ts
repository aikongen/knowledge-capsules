import { homedir } from "node:os";

import { selfCommand } from "./connect.ts";
import { run } from "./cli.ts";

const argv = process.argv.slice(2);
const code = await run(argv, {
  cwd: process.cwd(),
  env: process.env,
  home: process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir(),
  self: selfCommand(process.execPath, Bun.main),
  onPath: (name) => Bun.which(name) ?? undefined,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
// `kc mcp` keeps the process alive on stdin; every other command ends here.
if (argv[0] !== "mcp" || code !== 0) process.exit(code);
