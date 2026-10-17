import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });
import express from "express";
import cors from "cors";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";

const PORT = 3001;
const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("❌ LLM_API_KEY не задано у server/.env");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

// ============================================================
// 1. СХЕМА ВІДПОВІДІ — що ми очікуємо від моделі (Zod)
// ============================================================
const AnalizVidhuku = z.object({
  tonalnist: z.enum(["позитивна", "негативна", "нейтральна", "змішана"]),
  ocinka: z.number().min(1).max(5).describe("Оцінка від 1 до 5"),
  temy: z
    .array(z.string())
    .max(5)
    .describe("Ключові теми, максимум 5"),
  emocii: z.array(z.string()).max(5).describe("Емоції, які виражені"),
  rekomendatsiya: z
    .boolean()
    .describe("Чи рекомендує автор цей готель/місце"),
  korektna_mova: z
    .boolean()
    .describe("Чи написано коректною мовою без нецензурних слів"),
});

export type Analiz = z.infer<typeof AnalizVidhuku>;

// ============================================================
// 2. СИСТЕМНИЙ ПРОМПТ — роль і правила для моделі
// ============================================================
const SYSTEMNYI_PROMPT = `Ти — аналітик відгуків про подорожі. Твоя задача — аналізувати текст відгуку і повертати ТІЛЬКИ валідний JSON.

ПРАВИЛА:
1. Відповідай ВИКЛЮЧНО у форматі JSON. Жодних пояснень до або після JSON.
2. Оцінка (ocinka) — число від 1 до 5:
   - 1-2: негативний досвід
   - 3: нейтральний або змішаний
   - 4-5: позитивний досвід
3. Тональність визначай за загальним настроєм відгуку.
4. Якщо відгук містить і позитив, і негатив — tonalnist = "змішана".
5. Теми — це короткі слова або фрази (напр: "сніданок", "чистота", "персонал").
6. Емоції — слова як "радість", "розчарування", "спокій", "злість".
7. rekomendatsiya = true, якщо автор прямо або опосередковано рекомендує місце.
8. korektna_mova = false, якщо є нецензурні слова або образи.
9. Ніколи не вигадуй факти, яких немає у відгуку.`;

// ============================================================
// 3. ПРИКЛАДИ (few-shot) — показуємо моделі як відповідати
// ============================================================
const PRYKLADY: { vidhuk: string; vidpovid: Analiz }[] = [
  {
    vidhuk:
      "Готель просто чудовий! Номер чистий, сніданки смачні, персонал дуже уважний. Єдиний мінус — далеко від центру, але є безкоштовний шатл.",
    vidpovid: {
      tonalnist: "позитивна",
      ocinka: 5,
      temy: ["чистота", "сніданок", "персонал", "транспорт"],
      emocii: ["задоволення", "радість"],
      rekomendatsiya: true,
      korektna_mova: true,
    },
  },
  {
    vidhuk:
      "Жах. Номер брудний, кондиціонер не працював, на рецепції ніхто не допоміг. Більше сюди не приїду.",
    vidpovid: {
      tonalnist: "негативна",
      ocinka: 1,
      temy: ["чистота", "техніка", "сервіс"],
      emocii: ["злість", "розчарування"],
      rekomendatsiya: false,
      korektna_mova: true,
    },
  },
  {
    vidhuk:
      "Готель нормальний, але дорогувато за таку якість. Сніданки ок, але номер маленький. Щось середнє.",
    vidpovid: {
      tonalnist: "змішана",
      ocinka: 3,
      temy: ["ціна", "сніданок", "розмір номера"],
      emocii: ["нейтралітет"],
      rekomendatsiya: false,
      korektna_mova: true,
    },
  },
];

// ============================================================
// 4. ДОПОМІЖНІ ФУНКЦІЇ
// ============================================================

/** Парсимо JSON з відповіді моделі (іноді модель загортає в ```) */
function vydalytyJSON(text: string): string {
  // Прибираємо ```json ... ``` якщо є
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) return match[1];
  // Шукаємо перший { ... }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text;
}

/** Валідуємо відповідь моделі за схемою Zod */
function provalyuvaty(tekst: string): { ok: true; data: Analiz } | { ok: false; pomylka: string } {
  try {
    const json = JSON.parse(vydalytyJSON(tekst));
    const result = AnalizVidhuku.safeParse(json);
    if (!result.success) {
      return {
        ok: false,
        pomylka: `JSON не відповідає схемі: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      };
    }
    return { ok: true, data: result.data };
  } catch {
    return { ok: false, pomylka: "Відповідь моделі не є валідним JSON" };
  }
}

// ============================================================
// 5. EXPRESS-СЕРВЕР
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

/** POST /api/analiz — головний ендпоінт */
app.post("/api/analiz", async (req, res) => {
  const { vidhuk } = req.body as { vidhuk?: string };

  if (!vidhuk || vidhuk.trim().length < 10) {
    return res.status(400).json({
      pomylka: "Відгук має містити мінімум 10 символів",
    });
  }

  try {
    // Збираємо промпт: системний + приклади + запит користувача
    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash",
      systemInstruction: SYSTEMNYI_PROMPT,
      // 6. ТЕМПЕРАТУРА: 0 = точність (нам потрібен стабільний JSON), 1 = творчість
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    });

    // Few-shot: додаємо приклади прямо в запит
    const prykldyTekst = PRYKLADY.map(
      (p, i) =>
        `Приклад ${i + 1}:\nВідгук: "${p.vidhuk}"\nВідповідь: ${JSON.stringify(p.vidpovid, null, 2)}`
    ).join("\n\n");

    const prompt = `${prykldyTekst}\n\n---\nТепер проаналізуй ЦЕЙ відгук і поверни ТІЛЬКИ JSON:\n\n"${vidhuk}"`;

    const result = await model.generateContent(prompt);
    const tekst = result.response.text();

    // Перевіряємо чи відповідь за схемою
    const perevirka = provalyuvaty(tekst);

    if (!perevirka.ok) {
      // Якщо не за форматом — пробуємо ще раз (retry)
      const retry = await model.generateContent(
        `Попередня відповідь була не у форматі JSON. Ось що повернуто:\n"${tekst}"\n\nПоверни ТІЛЬКИ валідний JSON за схемою. Без пояснень.`
      );
      const retryTekst = retry.response.text();
      const retryPerevirka = provalyuvaty(retryTekst);

      if (!retryPerevirka.ok) {
        return res.status(500).json({
          pomylka: "Модель не змогла повернути валідний JSON",
          syryyTekst: tekst.slice(0, 200),
        });
      }
      return res.json({ ...retryPerevirka.data, retry: true });
    }

    return res.json(perevirka.data);
  } catch (e) {
    console.error("Помилка:", e);
    return res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Невідома помилка",
    });
  }
});

/** GET /api/zdorovya — перевірка що сервер працює */
app.get("/api/zdorovya", (_req, res) => {
  res.json({ ok: true, chas: new Date().toISOString() });
});

// ============================================================
// RAG: завантаження документів + пошук + відповідь
// ============================================================
import { zavantazhytyDokumenty, VektorBaza, vidpovistyPoRag } from "./rag.js";

const vektorBaza = new VektorBaza();

/** POST /api/rag/zavantazhyty — завантажуємо документи та рахуємо ембеддинги */
app.post("/api/rag/zavantazhyty", async (_req, res) => {
  try {
    const dokumenty = zavantazhytyDokumenty();
    let vseShmatky = 0;

    for (const doc of dokumenty) {
      const kilkist = await vektorBaza.dodatyDokument(doc.nazva, doc.tekst);
      vseShmatky += kilkist;
    }

    res.json({
      dokumentiv: dokumenty.length,
      shmatkiv: vseShmatky,
      nazvy: dokumenty.map((d) => d.nazva),
    });
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка завантаження",
    });
  }
});

/** POST /api/rag/zapyt — ставимо запит, AI відповідає по документах */
app.post("/api/rag/zapyt", async (req, res) => {
  const { zapyt } = req.body as { zapyt?: string };

  if (!zapyt || zapyt.trim().length < 5) {
    return res.status(400).json({ pomylka: "Запит має містити мінімум 5 символів" });
  }

  if (vektorBaza.kilkistShmatkiv === 0) {
    return res.status(400).json({
      pomylka: "Документи ще не завантажені. Натисни «Завантажити документи».",
    });
  }

  try {
    // Крок 1: шукаємо схожі шматки
    const знaydeni = await vektorBaza.shukaty(zapyt, 3);

    // Крок 2: генеруємо відповідь по знайденому
    const vidpovid = await vidpovistyPoRag(zapyt, знaydeni);

    res.json(vidpovid);
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка RAG",
    });
  }
});

/** GET /api/rag/status — скільки документів у базі */
app.get("/api/rag/status", (_req, res) => {
  res.json({
    shmatkiv: vektorBaza.kilkistShmatkiv,
    dokumenty: vektorBaza.dokumenty,
  });
});

// ============================================================
// АГЕНТ: інструменти + ланцюжок міркувань
// ============================================================
import { zapytDoAgenta } from "./agent.js";

/** POST /api/agent — запит до агента з інструментами */
app.post("/api/agent", async (req, res) => {
  const { zapyt } = req.body as { zapyt?: string };

  if (!zapyt || zapyt.trim().length < 5) {
    return res.status(400).json({ pomylka: "Запит має містити мінімум 5 символів" });
  }

  try {
    const vidpovid = await zapytDoAgenta(zapyt);
    res.json(vidpovid);
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка агента",
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Сервер працює на http://localhost:${PORT}`);
});
