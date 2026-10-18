import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });
import express from "express";
import cors from "cors";
import { z } from "zod";

const PORT = 3001;
const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  // Не вбиваємо процес: на Vercel ключ приходить з env у рантаймі,
  // а помилка з'явиться у відповідях конкретних ендпоінтів.
  console.error("⚠️ LLM_API_KEY не задано (server/.env або Vercel env)");
}

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
// 5. EXPRESS-СЕРВЕР
// ============================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

/** POST /api/analiz — головний ендпоінт.
 *  rezhym: "ekonom" (за замовчуванням) — lite-модель + компактний промпт + кеш;
 *          "zvych" — базовий шлях (3.8-flash + повний промпт + thinking).
 *  ТИЖДЕНЬ 7: виклик проходить конвеєр безпеки:
 *  маскування PII → модерація вводу → детектор інʼєкцій → модель → чистка виходу.
 *  У відповіді: meta (токени/$/мс), bezpeka (що виявлено й зроблено).
 */
app.post("/api/analiz", async (req, res) => {
  const { vidhuk, rezhym } = req.body as { vidhuk?: string; rezhym?: string };

  if (!vidhuk || vidhuk.trim().length < 10) {
    return res.status(400).json({
      pomylka: "Відгук має містити мінімум 10 символів",
    });
  }

  const r: RezhymAnalizu = rezhym === "zvych" ? "zvych" : "ekonom";

  try {
    const rez = await analizZOkhoronoyu(vidhuk, r);

    // Модерація: небезпечний вхід не доходить до моделі
    if (rez.blok) {
      return res.status(400).json({
        pomylka: `🚫 Заблоковано модерацією: ${rez.prychyna}`,
        moderatsiia: { kategoriia: rez.kategoriia, prychyna: rez.prychyna },
        bezpeka: { pii: rez.pii, moderovano: true },
      });
    }

    if (!rez.ok) {
      const chyLimit = (rez.pomylka || "").startsWith("⛔");
      return res.status(chyLimit ? 429 : 500).json({
        pomylka: rez.pomylka || "Невідома помилка",
        meta: rez.meta,
      });
    }

    return res.json({
      ...rez.data,
      meta: rez.meta,
      keshHit: rez.keshHit,
      retry: rez.retry,
      bezpeka: rez.bezpeka,
    });
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
import { vektorBaza, pidklyuchytyBazu, vidpovistyPoRag, zberehtyDokumentKorystuvacha } from "./rag.js";

// Підіймаємо базу документів одразу (ліне́йно, один раз на процес)
void pidklyuchytyBazu().catch((e) => console.error("⚠️ RAG-база не завантажилась:", e));

/** POST /api/rag/zavantazhyty — перезавантажуємо документи та ембеддинги */
app.post("/api/rag/zavantazhyty", async (_req, res) => {
  try {
    const rezultat = await pidklyuchytyBazu(true);
    res.json(rezultat);
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка завантаження",
    });
  }
});

/** POST /api/rag/dodaty — додаємо документ користувача (текст + назва) */
app.post("/api/rag/dodaty", async (req, res) => {
  const { nazva, tekst } = req.body as { nazva?: string; tekst?: string };

  if (!nazva || nazva.trim().length < 2) {
    return res.status(400).json({ pomylka: "Вкажіть назву документа (мінімум 2 символи)" });
  }
  if (!tekst || tekst.trim().length < 20) {
    return res.status(400).json({ pomylka: "Документ має містити мінімум 20 символів" });
  }

  try {
    // 1. Зберігаємо файл на диск (локально); на Vercel FS read-only → null
    const fayl = zberehtyDokumentKorystuvacha(nazva.trim(), tekst);

    // 2. Додаємо у векторну базу (рядок "📄 назва.md" — щоб відрізняти свої від базових)
    const nazvaVDokumentakh = `📄 ${nazva.trim()}.md`;
    const kilkist = await vektorBaza.dodatyDokument(nazvaVDokumentakh, tekst);

    res.json({
      ok: true,
      shmatkivDodano: kilkist,
      vseShmatkiv: vektorBaza.kilkistShmatkiv,
      nazva: nazvaVDokumentakh,
      zberezhenoNaDysku: fayl !== null,
    });
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка додавання документа",
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
    try {
      await pidklyuchytyBazu();
    } catch {
      // якщо ембединги недоступні — нижче повернеться помилка
    }
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

// ============================================================
// ТИЖДЕНЬ 4: КАРТИНКИ (vision) + СТРІМІНГ
// ============================================================
import { opysatyKartynku, strimityVidpovid, strimityZKartynkoyu } from "./vision.js";

/** POST /api/vision — описати картинку */
app.post("/api/vision", async (req, res) => {
  const { base64, mime, zapyt } = req.body as {
    base64?: string;
    mime?: string;
    zapyt?: string;
  };

  if (!base64 || !mime) {
    return res.status(400).json({ pomylka: "Потрібна картинка (base64 + mime)" });
  }

  try {
    // zapyt — питання користувача до картинки (без нього — стандартний опис)
    const opys = await opysatyKartynku(base64, mime, zapyt);
    res.json({ opys });
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка vision",
    });
  }
});

/** POST /api/strim — стримінг відповіді (SSE) */
app.post("/api/strim", async (req, res) => {
  const { zapyt, base64, mime } = req.body as {
    zapyt?: string;
    base64?: string;
    mime?: string;
  };

  if (!zapyt || zapyt.trim().length < 3) {
    return res.status(400).json({ pomylka: "Потрібен запит" });
  }

  // Налаштовуємо SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let vsiaVidpovid: string;

    if (base64 && mime) {
      // Стримінг з картинкою
      vsiaVidpovid = await strimityZKartynkoyu(base64, mime, zapyt, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
    } else {
      // Звичайний стримінг
      vsiaVidpovid = await strimityVidpovid(zapyt, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });
    }

    // Кінець стріму
    res.write(`data: ${JSON.stringify({ done: true, vsiaVidpovid })}\n\n`);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ pomylka: e instanceof Error ? e.message : "Помилка" })}\n\n`);
    res.end();
  }
});

// ============================================================
// ТИЖДЕНЬ 5: EVALS (оцінка якості відповідей моделі)
// ============================================================
import { zapustytyEvals, sudyyaLLM, type ZvitEvals } from "./evals.js";

/** Останні звіти evals у пам'яті (щоб суддя мав доступ) */
const ostanniZvity: Record<string, ZvitEvals> = {};
const ostanniVerdykty: Record<string, string> = {};

/** GET /api/evals/zvity — останні звіти + вердикти (для показу в UI) */
app.get("/api/evals/zvity", (_req, res) => {
  res.json({ A: ostanniZvity.A || null, B: ostanniZvity.B || null, verdykty: ostanniVerdykty });
});

/** POST /api/evals/zapustyty — запускає 10 перевірок (versiya: "A" | "B") */
app.post("/api/evals/zapustyty", async (req, res) => {
  const { versiya } = req.body as { versiya?: string };
  if (versiya !== "A" && versiya !== "B") {
    return res.status(400).json({ pomylka: 'Вкажіть versiya: "A" (поточний) або "B" (покращений)' });
  }

  try {
    const zvit = await zapustytyEvals(versiya);
    ostanniZvity[versiya] = zvit;
    res.json(zvit);
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка запуску evals",
    });
  }
});

/** POST /api/evals/sudyya — LLM-суддя аналізує вже готовий звіт */
app.post("/api/evals/sudyya", async (req, res) => {
  const { versiya } = req.body as { versiya?: string };
  if (versiya !== "A" && versiya !== "B") {
    return res.status(400).json({ pomylka: 'Вкажіть versiya: "A" або "B"' });
  }
  const zvit = ostanniZvity[versiya];
  if (!zvit) {
    return res.status(400).json({ pomylka: `Спершу запусти evals для версії ${versiya}` });
  }

  try {
    const verdikt = await sudyyaLLM(versiya as "A" | "B", zvit.pryypady);
    ostanniVerdykty[versiya] = verdikt;
    res.json({ verdikt });
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка судді",
    });
  }
});

// ============================================================
// ТИЖДЕНЬ 6: ВАРТІСТЬ І ШВИДКІСТЬ (токени, кеш, ліміт, експеримент)
// ============================================================
import { zapustytyEksperyment, otrymatyOstanniyZvit, type RezhymAnalizu } from "./eksperyment.js";
import { otrymatyStats, vstanovytyLimit, sklasty, ochystytyKesh } from "./vymiruvach.js";
import { analizZOkhoronoyu, zapustytyAtyaky, otrymatyOstanniAtyaky } from "./bezpeka.js";

/** GET /api/vymiruvach/stats — скільки витрачено: токени, $, час, кеш */
app.get("/api/vymiruvach/stats", (_req, res) => {
  res.json(otrymatyStats());
});

/** POST /api/vymiruvach/limit — встановити ліміт витрат у USD (null = без ліміту) */
app.post("/api/vymiruvach/limit", (req, res) => {
  const { limitUsd } = req.body as { limitUsd?: number | null };
  if (limitUsd !== null && (typeof limitUsd !== "number" || limitUsd < 0)) {
    return res.status(400).json({ pomylka: "limitUsd має бути числом ≥ 0 або null" });
  }
  vstanovytyLimit(limitUsd ?? null);
  res.json({ ok: true, limitUsd: limitUsd ?? null });
});

/** POST /api/vymiruvach/sklasty — обнулити лічильники (також чистить кеш) */
app.post("/api/vymiruvach/sklasty", (_req, res) => {
  sklasty();
  ochystytyKesh();
  res.json({ ok: true });
});

/** POST /api/eksperyment — до/після на 10 evals-кейсах (≈1-2 хв) */
app.post("/api/eksperyment", async (_req, res) => {
  try {
    const zvit = await zapustytyEksperyment();
    res.json(zvit);
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка експерименту",
    });
  }
});

/** GET /api/eksperyment/ostanniy — останній звіт (щоб не втрачати після перезавантаження) */
app.get("/api/eksperyment/ostanniy", (_req, res) => {
  res.json(otrymatyOstanniyZvit());
});

// ============================================================
// ТИЖДЕНЬ 7: БЕЗПЕКА (тести атак)
// ============================================================

/** POST /api/bezpeka/atyaky — проганяємо 10 атак через реальний конвеєр */
app.post("/api/bezpeka/atyaky", async (_req, res) => {
  try {
    const zvit = await zapustytyAtyaky();
    res.json(zvit);
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка тестів атак",
    });
  }
});

/** GET /api/bezpeka/ostanniy — останній звіт атак (після перезавантаження) */
app.get("/api/bezpeka/ostanniy", (_req, res) => {
  res.json(otrymatyOstanniAtyaky());
});

// ============================================================
// ТИЖДЕНЬ 8: КАПСТОУН — єдиний асистент + фідбек + evals
// ============================================================
import { zapytDoAsystenta } from "./chat.js";
import {
  otrymatyChatEvals,
  dodatyChatEval,
  vydalytyChatEval,
  zapustytyChatEvals,
} from "./chatEvals.js";
import { randomUUID } from "crypto";

/** POST /api/chat — один запит через увесь конвеєр:
 *  приватність → модерація → інʼєкція → RAG → агент з інструментами →
 *  чистка виходу → ціна. У відповіді: джерела, кроки, meta, bezpeka. */
app.post("/api/chat", async (req, res) => {
  const { zapyt } = req.body as { zapyt?: string };

  if (!zapyt || zapyt.trim().length < 5) {
    return res.status(400).json({ pomylka: "Повідомлення має містити мінімум 5 символів" });
  }
  if (zapyt.length > 4000) {
    return res.status(400).json({ pomylka: "Повідомлення завелике (максимум 4000 символів)" });
  }

  try {
    const rez = await zapytDoAsystenta(zapyt);
    if (rez.blok) {
      return res.status(400).json({
        pomylka: `🚫 Заблоковано модерацією: ${rez.prychyna}`,
        moderatsiia: { kategoriia: rez.kategoriia, prychyna: rez.prychyna },
      });
    }
    return res.json(rez);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Помилка асистента";
    const chyLimit = msg.startsWith("⛔");
    return res.status(chyLimit ? 429 : 500).json({ pomylka: msg });
  }
});

// --- Зворотний зв'язок: 👍/👎 на відповіді живого продукту ---

interface ZapisFeedback {
  chys: string;
  napryam: "dobre" | "girne";
  zapit: string;
  vidpovid: string;
  komentar?: string;
  chas: string;
}

const zapisyFeedback: ZapisFeedback[] = [];

/** POST /api/feedback — збір зворотного зв'язку з живого продукту */
app.post("/api/feedback", (req, res) => {
  const { napryam, zapit, vidpovid, komentar } = req.body as {
    napryam?: string;
    zapit?: string;
    vidpovid?: string;
    komentar?: string;
  };

  if (napryam !== "dobre" && napryam !== "girne") {
    return res.status(400).json({ pomylka: 'napryam має бути "dobre" або "girne"' });
  }
  if (!zapit || !vidpovid) {
    return res.status(400).json({ pomylka: "Потрібні zapit і vidpovid" });
  }

  const zapis: ZapisFeedback = {
    chys: randomUUID(),
    napryam,
    zapit: String(zapit).slice(0, 2000),
    vidpovid: String(vidpovid).slice(0, 4000),
    komentar: komentar ? String(komentar).slice(0, 1000) : undefined,
    chas: new Date().toISOString(),
  };
  zapisyFeedback.unshift(zapis);
  if (zapisyFeedback.length > 200) zapisyFeedback.pop();

  res.json({ ok: true, vsiogo: zapisyFeedback.length, zapis });
});

/** GET /api/feedback — останні записи */
app.get("/api/feedback", (_req, res) => {
  res.json({ zapisy: zapisyFeedback });
});

// --- Evals асистента: базові + кейси зі зворотного зв'язку ---

/** GET /api/evals/chat — усі кейси (базові + додані) */
app.get("/api/evals/chat", (_req, res) => {
  res.json({ pryypady: otrymatyChatEvals() });
});

/** POST /api/evals/chat/dodaty — поганий відгук 👎 → eval-кейс */
app.post("/api/evals/chat/dodaty", (req, res) => {
  const { opys, zapit, ochikuvannya, zaboroneniSlova } = req.body as {
    opys?: string;
    zapit?: string;
    ochikuvannya?: string[];
    zaboroneniSlova?: string[];
  };

  if (!zapit || zapit.trim().length < 5) {
    return res.status(400).json({ pomylka: "Потрібен запит (мінімум 5 символів)" });
  }
  if (!Array.isArray(ochikuvannya) || ochikuvannya.filter((s) => typeof s === "string" && s.trim()).length === 0) {
    return res.status(400).json({ pomylka: "Вкажіть очікувані ключові слова (через кому)" });
  }

  const slova = (ochikuvannya as unknown[]).filter((s): s is string => typeof s === "string");
  const klyuchi = slova
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

  const novyy = dodatyChatEval({
    opys: (opys || `Зі зворотного зв'язку: ${zapit.slice(0, 80)}`).slice(0, 120),
    zapit: zapit.trim(),
    ochikuvannya: klyuchi,
    zaboroneniSlova: Array.isArray(zaboroneniSlova) ? (zaboroneniSlova as unknown[]).filter((s): s is string => typeof s === "string") : [],
  });

  res.json({ ok: true, pryypad: novyy, pryypady: otrymatyChatEvals() });
});

/** DELETE /api/evals/chat/:id — прибрати кейс (доданий) */
app.delete("/api/evals/chat/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ pomylka: "Некоректний id" });
  }
  res.json({ ok: vydalytyChatEval(id), pryypady: otrymatyChatEvals() });
});

/** POST /api/evals/chat/zapustyty — прогін усіх кейсів асистента */
app.post("/api/evals/chat/zapustyty", async (_req, res) => {
  try {
    const zvit = await zapustytyChatEvals();
    res.json(zvit);
  } catch (e) {
    res.status(500).json({
      pomylka: e instanceof Error ? e.message : "Помилка прогону evals асистента",
    });
  }
});

// ============================================================
// ЗАПУСК: локально — звичайний сервер; на Vercel — експорт
// як Node.js-функції (див. api/index.ts), без listen.
// ============================================================
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅ Сервер працює на http://localhost:${PORT}`);
  });
}

export default app;
