// Lance un script Python du dossier scripts/ sans installer Python, grâce à Pyodide.
// Usage : node scripts/lancer_python.mjs decoupe_sprites.py
// Si Python + Pillow sont installés, on peut aussi faire : python scripts/<script>.py
import { loadPyodide } from "pyodide";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const script = process.argv[2] ?? "decoupe_sprites.py";
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const py = await loadPyodide();
await py.loadPackage(["numpy", "pillow"]);
py.FS.mkdirTree("/projet");
py.FS.mount(py.FS.filesystems.NODEFS, { root: racine }, "/projet");
const code = fs.readFileSync(path.join(racine, "scripts", script), "utf8");
py.globals.set("__file__", `/projet/scripts/${script}`);
await py.runPythonAsync(code.replace('if __name__ == "__main__":', "if True:"));
