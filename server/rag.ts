import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
// Документи у бандлі (на Vercel FS read-only — читаємо з JSON, згенерованого npm run baza)
import BAZA_DOCS from "./bazaDocs.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _genAI: GoogleGenerativeAI | null = null;
function otrymatyGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) throw new Error("LLM_API_KEY не задано");
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

// ============================================================
// ТИПИ
// ============================================================
export interface Shmatok {
  id: number;
  dokument: string;
  tekst: string;
  vektor: number[];
}

export interface VidpovidPoRag {
  vidpovid: string;
  dzherela: { dokument: string; tsytata: string }[];
  shmatkivZnaydeno: number;
}

// ============================================================
// 1. РОЗБИВКА ДОКУМЕНТІВ НА ШМАТКИ (chunks)
// ============================================================

/**
 * Читаємо документи: база — з bazaDocs.json (бандлиться куди завгодно),
 * документи користувача — з диска (локально), якщо FS дозволяє.
 * Дублікати (ті, що вже в JSON) прибираємо.
 */
export function zavantazhytyDokumenty(): { nazva: string; tekst: string }[] {
  const dokumenty: { nazva: string; tekst: string }[] = BAZA_DOCS.map((d) => ({
    nazva: d.nazva,
    tekst: d.tekst,
  }));
  const uzheYe = new Set(dokumenty.map((d) => d.nazva));

  // Локальні документи користувача (нові, яких ще немає в JSON)
  try {
    const papka = path.join(__dirname, "korystuvatskiDokumenty");
    if (fs.existsSync(papka)) {
      const fayly = fs.readdirSync(papka).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
      for (const f of fayly) {
        const nazva = `📄 ${f}`;
        if (uzheYe.has(nazva)) continue;
        dokumenty.push({ nazva, tekst: fs.readFileSync(path.join(papka, f), "utf-8") });
      }
    }
  } catch {
    // На Vercel диска немає — просто пропускаємо
  }

  return dokumenty;
}

/** Зберігаємо документ користувача на диск (на Vercel FS read-only → null) */
export function zberehtyDokumentKorystuvacha(nazva: string, tekst: string): string | null {
  try {
    const papka = path.join(__dirname, "korystuvatskiDokumenty");
    if (!fs.existsSync(papka)) fs.mkdirSync(papka, { recursive: true });

    // Безпечне ім'я файлу: прибираємо небезпечні символи
    const bezpechnaNazva = nazva.replace(/[^\p{L}\p{N}\w.-]/gu, "_").slice(0, 100);
    const fayl = path.join(papka, `${bezpechnaNazva}.md`);
    fs.writeFileSync(fayl, tekst, "utf-8");
    return fayl;
  } catch {
    // Read-only FS (Vercel) — документ живе лише в пам'яті цієї сесії
    return null;
  }
}

/**
 * Розбиваємо текст на шматки по ~400 символів.
 * Ріжемо по абзацах, щоб не рвати зміст.
 */
export function rozbityNaShmatky(tekst: string, maxDovzhyna = 400): string[] {
  const abzatsy = tekst.split(/\n\n+/).filter((a) => a.trim().length > 0);
  const shmatky: string[] = [];
  let potocnyy = "";

  for (const abzats of abzatsy) {
    if (potocnyy.length + abzats.length > maxDovzhyna && potocnyy.length > 0) {
      shmatky.push(potocnyy.trim());
      potocnyy = abzats;
    } else {
      potocnyy = potocnyy ? potocnyy + "\n\n" + abzats : abzats;
    }
  }
  if (potocnyy.trim()) shmatky.push(potocnyy.trim());
  return shmatky;
}

// ============================================================
// 2. ЕМБЕДДИНГИ (превращаємо текст у вектор чисел)
// ============================================================

/** Отримуємо вектор для одного тексту */
export async function otrymatyVektor(tekst: string): Promise<number[]> {
  const model = otrymatyGenAI().getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.embedContent(tekst);
  return result.embedding.values;
}

/** Отримуємо вектори для багатьох текстів (пакетно) */
export async function otrymatyVektory(teksty: string[]): Promise<number[][]> {
  const model = otrymatyGenAI().getGenerativeModel({ model: "gemini-embedding-001" });
  const result = await model.batchEmbedContents({
    requests: teksty.map((t) => ({ content: { role: "user", parts: [{ text: t }] } })),
  });
  return result.embeddings.map((e) => e.values);
}

// ============================================================
// 3. КОСИНУСНА СХОЖІСТЬ (подібність двох векторів)
// ============================================================

export function kosinusnaSzhizhnist(a: number[], b: number[]): number {
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ============================================================
// 4. ВЕКТОРНА БАЗА ДАНИХ (проста, в пам'яті)
// ============================================================
export class VektorBaza {
  private shmatky: Shmatok[] = [];
  private nastupnyyId = 0;

  /** Додаємо документ у базу: розбиваємо + рахуємо ембеддинги */
  async dodatyDokument(nazva: string, tekst: string): Promise<number> {
    const shmatkyTekstu = rozbityNaShmatky(tekst);
    const vektory = await otrymatyVektory(shmatkyTekstu);

    for (let i = 0; i < shmatkyTekstu.length; i++) {
      this.shmatky.push({
        id: this.nastupnyyId++,
        dokument: nazva,
        tekst: shmatkyTekstu[i],
        vektor: vektory[i],
      });
    }
    return shmatkyTekstu.length;
  }

  /** Шукаємо N найближчих шматків до запиту */
  async shukaty(zapyt: string, kilkist = 3): Promise<Shmatok[]> {
    const vektorZapytu = await otrymatyVektor(zapyt);

    return this.shmatky
      .map((s) => ({
        ...s,
        skhizhnist: kosinusnaSzhizhnist(vektorZapytu, s.vektor),
      }))
      .sort((a, b) => b.skhizhnist - a.skhizhnist)
      .slice(0, kilkist);
  }

  /** Очищаємо базу (щоб перезавантаження не дублювало шматки) */
  ochystyty(): void {
    this.shmatky = [];
    this.nastupnyyId = 0;
  }

  /** Скільки шматків у базі */
  get kilkistShmatkiv(): number {
    return this.shmatky.length;
  }

  /** Які документи є */
  get dokumenty(): string[] {
    return [...new Set(this.shmatky.map((s) => s.dokument))];
  }
}

// ============================================================
// 5. ГЕНЕРАЦІЯ ВІДПОВІДІ (підкладаємо знайдене моделі)
// ============================================================

const RAG_PROMPT = `Ти — асистент, який відповідає ТІЛЬКИ на основі наданих документів.

ПРАВИЛА:
1. Відповідай ВИКЛЮЧНО за інформацією з документів нижче.
2. Якщо відповіді немає в документах — скажи "Я не знайшов відповіді в документах".
3. НЕ вигадуй факти.
4. Цитуй документи: згадуй звідки взята інформація.
5. Відповідай українською мовою.

ДОКУМЕНТИ:
{DOKUMENTY}

---`;

export async function vidpovistyPoRag(
  zapyt: string,
  знaydeni: Shmatok[]
): Promise<VidpovidPoRag> {
  // Готуємо контекст зі знайдених шматків
  const kontekst = знaydeni
    .map((s, i) => `[Джерело ${i + 1}: ${s.dokument}]\n${s.tekst}`)
    .join("\n\n---\n\n");

  const model = otrymatyGenAI().getGenerativeModel({
    model: "gemini-3.8-flash",
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  });

  const prompt = RAG_PROMPT.replace("{DOKUMENTY}", kontekst) + `\n\nЗАПИТ: ${zapyt}`;
  const result = await model.generateContent(prompt);
  const vidpovid = result.response.text();

  return {
    vidpovid,
    dzherela: знaydeni.map((s) => ({
      dokument: s.dokument,
      tsytata: s.tekst.slice(0, 150) + "...",
    })),
    shmatkivZnaydeno: знaydeni.length,
  };
}

// ============================================================
// 6. СІНГЛТОН БАЗИ + ЛІНЕЙНЕ АВТОЗАВАНТАЖЕННЯ
// ============================================================

/** Спільна векторна база (живе в одному процесі) */
export const vektorBaza = new VektorBaza();

export interface PidklyuchennyaBazy {
  dokumentiv: number;
  shmatkiv: number;
  nazvy: string[];
}

let bazovePromise: Promise<PidklyuchennyaBazy> | null = null;

async function vnavchytyBazu(): Promise<PidklyuchennyaBazy> {
  vektorBaza.ochystyty();
  const dokumenty = zavantazhytyDokumenty();
  let vseShmatky = 0;
  for (const doc of dokumenty) {
    vseShmatky += await vektorBaza.dodatyDokument(doc.nazva, doc.tekst);
  }
  return {
    dokumentiv: dokumenty.length,
    shmatkiv: vseShmatky,
    nazvy: dokumenty.map((d) => d.nazva),
  };
}

/**
 * Перше завантаження бази (один раз на життя процесу).
 * prymusovo=true — перезавантажуємо (кнопка «Завантажити документи»),
 * чекаючи завершення попереднього завантаження, щоб не було дублікатів.
 * При помилці скидаємо проміс, щоб можна було повторити.
 */
export function pidklyuchytyBazu(prymusovo = false): Promise<PidklyuchennyaBazy> {
  if (prymusovo) {
    const poperednya = bazovePromise ?? Promise.resolve(null);
    const p: Promise<PidklyuchennyaBazy> = poperednya.catch(() => null).then(() => vnavchytyBazu());
    const zUmovoyu = p.catch((e) => {
      if (bazovePromise === zUmovoyu) bazovePromise = null;
      throw e;
    });
    bazovePromise = zUmovoyu;
    return zUmovoyu;
  }
  if (!bazovePromise) {
    const p: Promise<PidklyuchennyaBazy> = vnavchytyBazu().catch((e) => {
      if (bazovePromise === p) bazovePromise = null;
      throw e;
    });
    bazovePromise = p;
  }
  return bazovePromise;
}
