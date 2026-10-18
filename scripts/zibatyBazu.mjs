// Генерує server/bazaDocs.json з папок dokumenty + korystuvatskiDokumenty
// (на Vercel файлова система read-only, тож документи їдуть у бандл як JSON)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const korinok = path.join(__dirname, "..");

const PAPKY = [
  { nazva: "dokumenty", prefiks: "" },
  { nazva: "korystuvatskiDokumenty", prefiks: "\u{1F4C4} " },
];

const dokumenty = [];
for (const p of PAPKY) {
  const dir = path.join(korinok, "server", p.nazva);
  if (!fs.existsSync(dir)) continue;
  const fayly = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
    .sort();
  for (const f of fayly) {
    dokumenty.push({
      nazva: p.prefiks + f,
      tekst: fs.readFileSync(path.join(dir, f), "utf-8"),
    });
  }
}

const vyhid = path.join(korinok, "server", "bazaDocs.json");
fs.writeFileSync(vyhid, JSON.stringify(dokumenty, null, 1), "utf-8");
console.log(`✅ bazaDocs.json: ${dokumenty.length} документів (${fs.statSync(vyhid).size} байт)`);
