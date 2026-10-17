import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

/** Читаємо всі .md файли з папки dokumenty */
export function zavantazhytyDokumenty(): { nazva: string; tekst: string }[] {
  const papka = path.join(__dirname, "dokumenty");
  const fayly = fs.readdirSync(papka).filter((f) => f.endsWith(".md"));
  return fayly.map((f) => ({
    nazva: f,
    tekst: fs.readFileSync(path.join(papka, f), "utf-8"),
  }));
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
    requests: teksty.map((t) => ({ content: { parts: [{ text: t }] } })),
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
