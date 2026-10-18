// ============================================================
// ТИЖДЕНЬ 6: ЕКСПЕРИМЕНТ «ДО / ПІСЛЯ»
// «До» — базовий шлях: gemini-3.8-flash + повний промпт A + 3 приклади
//        + типовий thinking (думки моделі, які теж тарифікуються).
// «Після» — економний: gemini-3.1-flash-lite + компактний промпт
//        + 0 прикладів + кеш повторів.
// Якість міряємо тими самими 10 evals-кейсами (ocinytyPrypad).
// ============================================================
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { PROMPT_A, PRYKLADY_A, PRYPADY_EVALS, ocinytyPrypad } from "./evals.js";
import {
  rozrahuvatyVykyk,
  zarakhuvaty,
  shukatyVKesi,
  zberehtyVKes,
  perevirytyLimit,
  type MetaVykyku,
} from "./vymiruvach.js";

// ============================================================
// СХЕМА (як у server.ts / evals.ts)
// ============================================================
const AnalizVidhuku = z.object({
  tonalnist: z.enum(["позитивна", "негативна", "нейтральна", "змішана"]),
  ocinka: z.number().min(1).max(5),
  temy: z.array(z.string()).max(5),
  emocii: z.array(z.string()).max(5),
  rekomendatsiya: z.boolean(),
  korektna_mova: z.boolean(),
});
export type Analiz = z.infer<typeof AnalizVidhuku>;

// ============================================================
// ЕКОНОМНИЙ ПРОМПТ (перевірено: 10/10 на evals, lite ~0.9с)
// ============================================================
export const EKONOM_PROMPT = `Ти — аналітик відгуків. Відповідай ТІЛЬКИ валідним JSON-об'єктом (без тексту навколо):
{"tonalnist":"позитивна|негативна|нейтральна|змішана","ocinka":1-5,"temy":["до 5 слів"],"emocii":["до 5"],"rekomendatsiya":true|false,"korektna_mova":true|false}

Правила:
1. ocinka: 1-2 негативний досвід, 3 нейтральний/змішаний, 4-5 позитивний.
2. Сарказм: позитивні слова про негативні факти ("Чудово! Черга 2 години"), "все чудово, якщо не рахувати..." → негативна, ocinka 1-2, rekomendatsiya false.
3. Оцінюй ДОСВІД АВТОРА: "про X відгуки хороші, але ми жили в Y — помилка" → негативна.
4. Подвійне заперечення: "не можу сказати, що ми не задоволені" = задоволені → позитивна, ocinka 4-5, rekomendatsiya true.
5. Тільки факти (номер, час, розмір) без оцінок → нейтральна, ocinka 3, rekomendatsiya false.
6. Іронія зі шкодою ("Тепер він мені не знайомий") → негативна, rekomendatsiya false.
7. І позитив, і негатив без переваги → змішана; з явним домінантом — його тональність.
8. Нецензурні слова у лапках/цитаті → korektna_mova false.
9. rekomendatsiya: true — прямо радить/повернеться/позитив без наміру уникати; false — "не раджу", "не повернусь", іронічний висновок.
10. Нічого не вигадуй. Теми/емоції — короткі українські слова.`;

const MODEL_DO = "gemini-3.8-flash";
const MODEL_PISLYA = "gemini-3.1-flash-lite";

// ============================================================
// ДОПОМІЖНІ
// ============================================================
function vydalytyJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) return match[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text;
}

export type RezhymAnalizu = "zvych" | "ekonom";

export interface RezultatAnalizu {
  ok: boolean;
  data?: Analiz;
  pomylka?: string;
  meta: MetaVykyku; // агреговано по всіх викликах (включно з retry)
  keshHit: boolean;
  retry?: boolean; // чи знадобився другий виклик (зламаний JSON)
}

function poshytynySumuMetas(metas: MetaVykyku[]): MetaVykyku {
  const ostanniy = metas[metas.length - 1];
  return {
    model: ostanniy.model,
    tokensIn: metas.reduce((s, m) => s + m.tokensIn, 0),
    thoughts: metas.reduce((s, m) => s + m.thoughts, 0),
    tokensOut: metas.reduce((s, m) => s + m.tokensOut, 0),
    keshovano: metas.reduce((s, m) => s + m.keshovano, 0),
    usd: metas.reduce((s, m) => s + m.usd, 0),
    ms: metas.reduce((s, m) => s + m.ms, 0),
    keshHit: false,
  };
}

// ============================================================
// ОДИН АНАЛІЗ (модель → JSON → валідація → retry), з вимірювачем
// ============================================================
export async function analyzuvaty(
  vidhuk: string,
  rezhym: RezhymAnalizu,
  opsii: { feature: string; bezKesha?: boolean } = { feature: `analiz/${rezhym}` }
): Promise<RezultatAnalizu> {
  const ts1 = Date.now();

  // --- 1. КЕШ: однаковий відгук + однаковий режим → готова відповідь за 0 $ ---
  const klyuch = crypto.createHash("sha1").update(`${rezhym}:${vidhuk.trim()}`).digest("hex");
  if (!opsii.bezKesha) {
    const uKesi = shukatyVKesi<{ data: Analiz }>(klyuch);
    if (uKesi) {
      const meta: MetaVykyku = {
        model: rezhym === "ekonom" ? MODEL_PISLYA : MODEL_DO,
        tokensIn: 0,
        thoughts: 0,
        tokensOut: 0,
        keshovano: 0,
        usd: 0,
        ms: Date.now() - ts1,
        keshHit: true,
      };
      zarakhuvaty(opsii.feature, meta);
      return { ok: true, data: uKesi.data, meta, keshHit: true };
    }
  }

  // --- 2. ЛІМІТ ВИТРАТ: блокуємо якщо бюджет вичерпано ---
  const okyokovyyUsd = rezhym === "ekonom" ? 0.001 : 0.01; // оцінка однієї спроби
  try {
    perevirytyLimit(okyokovyyUsd);
  } catch (e) {
    const meta: MetaVykyku = { model: "-", tokensIn: 0, thoughts: 0, tokensOut: 0, keshovano: 0, usd: 0, ms: 0, keshHit: false };
    return { ok: false, pomylka: e instanceof Error ? e.message : "Ліміт витрат", meta, keshHit: false };
  }

  // --- 3. Готуємо промпт за режимом ---
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    const meta: MetaVykyku = { model: "-", tokensIn: 0, thoughts: 0, tokensOut: 0, keshovano: 0, usd: 0, ms: 0, keshHit: false };
    return { ok: false, pomylka: "LLM_API_KEY не задано", meta, keshHit: false };
  }
  const genAI = new GoogleGenerativeAI(apiKey);

  const modelNazva = rezhym === "ekonom" ? MODEL_PISLYA : MODEL_DO;
  const systemPrompt = rezhym === "ekonom" ? EKONOM_PROMPT : PROMPT_A;
  const prykldy = rezhym === "ekonom" ? [] : PRYKLADY_A;

  const model = genAI.getGenerativeModel({
    model: modelNazva,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: rezhym === "ekonom" ? 512 : 1024,
    },
  });

  const prykldyTekst = prykldy
    .map(
      (p, i) =>
        `Приклад ${i + 1}:\nВідгук: "${p.vidhuk}"\nВідповідь: ${JSON.stringify(p.vidpovid, null, 2)}`
    )
    .join("\n\n");
  const bazovyyPrompt = `${prykldyTekst}${prykldyTekst ? "\n\n---\n" : ""}Тепер проаналізуй ЦЕЙ відгук і поверни ТІЛЬКИ JSON:\n\n"${vidhuk}"`;

  // --- 4. Виклик з retry; кожен виклик рахуємо окремо ---
  const metas: MetaVykyku[] = [];
  for (const krok of [0, 1]) {
    const promptTekst =
      krok === 0
        ? bazovyyPrompt
        : `Попередня відповідь була не у форматі JSON. Поверни ТІЛЬКИ валідний JSON за схемою, без пояснень.\n\n${bazovyyPrompt}`;

    const t0 = Date.now();
    try {
      const result = await model.generateContent(promptTekst);
      const ms = Date.now() - t0;
      const meta = rozrahuvatyVykyk(modelNazva, result.response.usageMetadata || {}, ms);
      metas.push(meta);
      zarakhuvaty(opsii.feature, meta);

      const pars = AnalizVidhuku.safeParse(JSON.parse(vydalytyJSON(result.response.text())));
      if (pars.success) {
        zberehtyVKes(klyuch, { data: pars.data });
        return { ok: true, data: pars.data, meta: poshytynySumuMetas(metas), keshHit: false, retry: metas.length > 1 };
      }
      if (krok === 0) continue;
      return { ok: false, pomylka: "JSON не за схемою", meta: poshytynySumuMetas(metas), keshHit: false, retry: metas.length > 1 };
    } catch (e) {
      // Якщо помилка сталася ДО отримання відповіді — токени не списано, рахуємо окремо
      if (metas.length === krok) {
        const ms = Date.now() - t0;
        const meta: MetaVykyku = { model: modelNazva, tokensIn: 0, thoughts: 0, tokensOut: 0, keshovano: 0, usd: 0, ms, keshHit: false };
        metas.push(meta);
        zarakhuvaty(opsii.feature, meta);
      }
      if (krok === 0) continue;
      return { ok: false, pomylka: e instanceof Error ? e.message : "Помилка моделі", meta: poshytynySumuMetas(metas), keshHit: false, retry: metas.length > 1 };
    }
  }
  const metaErr: MetaVykyku = { model: modelNazva, tokensIn: 0, thoughts: 0, tokensOut: 0, keshovano: 0, usd: 0, ms: Date.now() - ts1, keshHit: false };
  return { ok: false, pomylka: "Невідома помилка", meta: metaErr, keshHit: false };
}

// ============================================================
// ЗВІТ ЕКСПЕРИМЕНТУ
// ============================================================
export interface KlyuchoviChysla {
  model: string;
  vykykiv: number;
  yakistPrOjshlo: number;
  vsiogo: number;
  tokVkhid: number;
  tokDumky: number;
  tokVykhid: number;
  usdSum: number;
  usdSer: number;
  msSer: number;
}

export interface PrypadEksperymentu {
  id: number;
  opys: string;
  doProjshov: boolean;
  pislyaProjshov: boolean;
  doPomylky: string[];
  pislyaPomylky: string[];
}

export interface ZvitEksperymentu {
  chas: string;
  doK: KlyuchoviChysla;
  pislyaK: KlyuchoviChysla;
  kesh: { usd: number; ms: number; keshHit: boolean; prykldVykykiv: number };
  pryypady: PrypadEksperymentu[];
  mnozhnyky: { dorozhzheDo: number; povilnishaDo: number };
}

let ostanniyZvit: ZvitEksperymentu | null = null;

export function otrymatyOstanniyZvit(): ZvitEksperymentu | null {
  return ostanniyZvit;
}

interface Nakopychene {
  vykykiv: number;
  tokVkhid: number;
  tokDumky: number;
  tokVykhid: number;
  usd: number;
  ms: number;
}
function porozhnye(): Nakopychene {
  return { vykykiv: 0, tokVkhid: 0, tokDumky: 0, tokVykhid: 0, usd: 0, ms: 0 };
}
function dodaty(n: Nakopychene, m: MetaVykyku): void {
  n.vykykiv += 1;
  n.tokVkhid += m.tokensIn;
  n.tokDumky += m.thoughts;
  n.tokVykhid += m.tokensOut;
  n.usd += m.usd;
  n.ms += m.ms;
}
function doKlyuchovyh(
  n: Nakopychene,
  model: string,
  yakistPrOjshlo: number,
  vsiogo: number
): KlyuchoviChysla {
  return {
    model,
    vykykiv: n.vykykiv,
    yakistPrOjshlo,
    vsiogo,
    tokVkhid: n.tokVkhid,
    tokDumky: n.tokDumky,
    tokVykhid: n.tokVykhid,
    usdSum: n.usd,
    usdSer: n.vykykiv > 0 ? n.usd / n.vykykiv : 0,
    msSer: n.vykykiv > 0 ? n.ms / n.vykykiv : 0,
  };
}

/** Головний прогін: 10 кейсів «до» + 10 «після» + вимірювання кешу */
export async function zapustytyEksperyment(): Promise<ZvitEksperymentu> {
  const nDo = porozhnye();
  const nPislya = porozhnye();
  const pryypady: PrypadEksperymentu[] = [];

  for (const prypad of PRYPADY_EVALS) {
    // «До»: базовий шлях, без кешу (чесне перше місце)
    const doRes = await analyzuvaty(prypad.vidhuk, "zvych", {
      feature: "eksperyment/do",
      bezKesha: true,
    });
    dodaty(nDo, doRes.meta);
    const doOcinka = doRes.ok && doRes.data ? ocinytyPrypad(prypad, doRes.data) : ocinytyPrypad(prypad, null, doRes.pomylka);

    // «Після»: економний, без кешу (кеш виміряємо окремо нижче)
    const piRes = await analyzuvaty(prypad.vidhuk, "ekonom", {
      feature: "eksperyment/pislya",
      bezKesha: true,
    });
    dodaty(nPislya, piRes.meta);
    const piOcinka = piRes.ok && piRes.data ? ocinytyPrypad(prypad, piRes.data) : ocinytyPrypad(prypad, null, piRes.pomylka);

    pryypady.push({
      id: prypad.id,
      opys: prypad.opys,
      doProjshov: doOcinka.projshov,
      pislyaProjshov: piOcinka.projshov,
      doPomylky: doOcinka.pomylky,
      pislyaPomylky: piOcinka.pomylky,
    });
  }

  // --- Вимірюємо кеш: повтор економного виклику першого кейсу ---
  const pershyiVidhuk = PRYPADY_EVALS[0].vidhuk;
  const keshRes = await analyzuvaty(pershyiVidhuk, "ekonom", { feature: "eksperyment/kesh" });

  const doK = doKlyuchovyh(nDo, MODEL_DO, pryypady.filter((p) => p.doProjshov).length, PRYPADY_EVALS.length);
  const pislyaK = doKlyuchovyh(nPislya, MODEL_PISLYA, pryypady.filter((p) => p.pislyaProjshov).length, PRYPADY_EVALS.length);

  const zvit: ZvitEksperymentu = {
    chas: new Date().toISOString(),
    doK,
    pislyaK,
    kesh: { usd: keshRes.meta.usd, ms: keshRes.meta.ms, keshHit: keshRes.keshHit, prykldVykykiv: 1 },
    pryypady,
    mnozhnyky: {
      dorozhzheDo: pislyaK.usdSer > 0 ? doK.usdSer / pislyaK.usdSer : 0,
      povilnishaDo: pislyaK.msSer > 0 ? doK.msSer / pislyaK.msSer : 0,
    },
  };
  ostanniyZvit = zvit;
  return zvit;
}
