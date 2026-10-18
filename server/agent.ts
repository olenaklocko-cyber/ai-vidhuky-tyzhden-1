import { GoogleGenerativeAI, type GenerationConfig, type Content, type FunctionDeclaration } from "@google/generative-ai";

/** Модель агента/асистента (капстоун: вона ж у чаті) */
export const MODEL_AGENTA = "gemini-3.8-flash";

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
// 1. ТИПИ
// ============================================================

/** Крок агента: що він зробив на цьому кроці */
export interface KrokAgenta {
  krok: number;
  typ: "mirkuvannya" | "vyklykTool" | "rezultatTool" | "vdpovisd";
  opys: string;
  tool?: string;
  argy?: Record<string, unknown>;
  rezultat?: string;
}

export interface VidpovidAgenta {
  vdpovisd: string;
  kroky: KrokAgenta[];
  toolVykorystano: string[];
  /** Живі URL з інтернет-пошуку (webSearch) */
  webDzherela: WebDzherelo[];
  /** Агрегована вартість усього ланцюжка викликів (тиждень 8) */
  usage: { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount: number };
  model: string;
  ms: number;
}

// ============================================================
// 2. ІНСТРУМЕНТИ (tools) — що вміє агент
// ============================================================

/**
 * База даних подорожей (імітація).
 * У реальному проєкті — це би був запит до Supabase.
 */
const BAZA_PODOROZEY = [
  { krajyna: "Італія", misto: "Рим", serednyaCina: 1200, sezon: "весна-осінь" },
  { krajyna: "Франція", misto: "Париж", serednyaCina: 1500, sezon: "цілий рік" },
  { krajyna: "Японія", misto: "Токіо", serednyaCina: 2500, sezon: "весна-осінь" },
  { krajyna: "Єгипет", misto: "Хургада", serednyaCina: 800, sezon: "жовтень-березень" },
  { krajyna: "Туреччина", misto: "Анталья", serednyaCina: 700, sezon: "квітень-жовтень" },
  { krajyna: "Іспанія", misto: "Барселона", serednyaCina: 1100, sezon: "цілий рік" },
  { krajyna: "Греція", misto: "Санторіні", serednyaCina: 1400, sezon: "травень-вересень" },
  { krajyna: "Таїланд", misto: "Пхукет", serednyaCina: 1800, sezon: "листопад-березень" },
];

/** Калькулятор — безпечний обчислювач */
export function kalkulyator(vyraz: string): string {
  // Дозволяємо тільки цифри, операції, дужки, крапки
  if (!/^[\d\s+\-*/().,%^]+$/.test(vyraz)) {
    return "Помилка: дозволені лише цифри та операції + - * / ( )";
  }
  try {
    // Заміняємо ^ на ** (степінь), % на /100
    const bezpechnyy = vyraz.replace(/\^/g, "**").replace(/(\d)%/g, "($1/100)");
    // eslint-disable-next-line no-new-func
    const rezultat = Function(`"use strict"; return (${bezpechnyy})`)();
    return String(rezultat);
  } catch {
    return "Помилка: некоректний вираз";
  }
}

/** Пошук у базі подорожей */
export function shukatyVPodorozhah(param: {
  krajyna?: string;
  misto?: string;
  maxCina?: number;
}): string {
  let rezultat = BAZA_PODOROZEY;

  if (param.krajyna) {
    rezultat = rezultat.filter((p) =>
      p.krajyna.toLowerCase().includes(param.krajyna!.toLowerCase())
    );
  }
  if (param.misto) {
    rezultat = rezultat.filter((p) =>
      p.misto.toLowerCase().includes(param.misto!.toLowerCase())
    );
  }
  if (param.maxCina) {
    rezultat = rezultat.filter((p) => p.serednyaCina <= param.maxCina!);
  }

  if (rezultat.length === 0) return "Нічого не знайдено за цими умовами";

  return JSON.stringify(rezultat, null, 2);
}

/** Конвертер валют (курси — приклад, у реальності API) */
const KURSY: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  UAH: 41.5,
  GBP: 0.79,
  JPY: 149.5,
};

export function konverter(valyutaZ: string, valyutaDo: string, suma: number): string {
  const z = KURSY[valyutaZ.toUpperCase()];
  const doVal = KURSY[valyutaDo.toUpperCase()];
  if (!z || !doVal) {
    return `Невідома валюта. Доступні: ${Object.keys(KURSY).join(", ")}`;
  }
  const rezultat = (suma / z) * doVal;
  return `${suma} ${valyutaZ.toUpperCase()} = ${rezultat.toFixed(2)} ${valyutaDo.toUpperCase()}`;
}

// ============================================================
// 2b. ІНТЕРНЕТ-ПОШУК (Google Search grounding у Gemini)
// ============================================================

export interface WebDzherelo {
  url: string;
  title: string;
}

interface UsageVyklyku {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
}

/**
 * Інструмент webSearch: актуальна інформація з реальних сайтів.
 * Викликає окрему генерацію Gemini з Google Search grounding
 * (без окремого API-ключа — працює наявний LLM_API_KEY).
 */
export async function pooshukVInterneti(
  zapit: string
): Promise<{ tekst: string; dzherela: WebDzherelo[]; usage: UsageVyklyku }> {
  const model = otrymatyGenAI().getGenerativeModel({ model: MODEL_AGENTA });

  const usage: UsageVyklyku = { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0 };
  let tekst = "";
  let dzherela: WebDzherelo[] = [];

  for (let sproba = 0; sproba < 2 && dzherela.length === 0; sproba++) {
    const res = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `Ти — інструмент інтернет-пошуку. Знайди актуальну інформацію за запитом і поверни стислий ` +
                `виклад ключових фактів українською (3-6 речень). Після кожної тези додай URL джерела ` +
                `у квадратних дужках.` +
                (sproba > 0 ? ` ПОВТОРЮЙ: скористайся пошуком Google, відповідай тільки за його результатами.` : "") +
                `\n\nЗапит: ${zapit}`,
            },
          ],
        },
      ],
      tools: [{ googleSearch: {} }] as never,
      generationConfig: { temperature: 0.2 },
    } as never);

    const parts = res.response.candidates?.[0]?.content?.parts ?? [];
    tekst = parts.map((p) => p.text ?? "").join("\n").trim();
    const um = res.response.usageMetadata;
    usage.promptTokenCount += um?.promptTokenCount ?? 0;
    usage.candidatesTokenCount += um?.candidatesTokenCount ?? 0;
    usage.thoughtsTokenCount +=
      (um as { thoughtsTokenCount?: number } | undefined)?.thoughtsTokenCount ?? 0;

    type Gm = { groundingChunks?: { web?: { uri?: string; title?: string } }[] } | undefined;
    const cand = res.response.candidates?.[0] as unknown as { groundingMetadata?: Gm } | undefined;
    const gm: Gm =
      cand?.groundingMetadata ??
      (res.response as unknown as { groundingMetadata?: Gm }).groundingMetadata;
    dzherela = (gm?.groundingChunks ?? [])
      .map((c) => ({ url: c.web?.uri ?? "", title: c.web?.title ?? c.web?.uri ?? "" }))
      .filter((d) => d.url.startsWith("http"));
  }

  return {
    tekst: tekst || "Інтернет-пошук не повернув результату. Спробуй перефразувати запит.",
    dzherela,
    usage,
  };
}

// ============================================================
// 3. СХЕМА ІНСТРУМЕНТІВ (для Gemini function calling)
// ============================================================

export const TOOLS = [
  {
    name: "kalkulyator",
    description: "Обчислює математичний вираз. Приклад: '2+2*3', '(10+5)/3', '2^10'",
    parameters: {
      type: "object",
      properties: {
        vyraz: { type: "string", description: "Математичний вираз для обчислення" },
      },
      required: ["vyraz"],
    },
  },
  {
    name: "shukatyVPodorozhah",
    description: "Шукає подорожі у базі за країною, містом або максимальною ціною",
    parameters: {
      type: "object",
      properties: {
        krajyna: { type: "string", description: "Назва країни (напр: Італія)" },
        misto: { type: "string", description: "Назва міста (напр: Рим)" },
        maxCina: { type: "number", description: "Максимальна ціна в USD" },
      },
    },
  },
  {
    name: "webSearch",
    description:
      "Пошук в інтернеті (Google Search): актуальні правила в'їзду, погода, курси валют, ціни, новини. ВИКОРИСТОВУЙ, коли відповіді немає в документах користувача або потрібні актуальні дані на сьогодні.",
    parameters: {
      type: "object",
      properties: {
        zapit: { type: "string", description: "Конкретний пошуковий запит" },
      },
      required: ["zapit"],
    },
  },
  {
    name: "konverterValyut",
    description: "Конвертує суму з однієї валюти в іншу. Курси: USD, EUR, UAH, GBP, JPY",
    parameters: {
      type: "object",
      properties: {
        valyutaZ: { type: "string", description: "Валюта з якої конвертуємо (напр: USD)" },
        valyutaDo: { type: "string", description: "Валюта в яку конвертуємо (напр: EUR)" },
        suma: { type: "number", description: "Сума для конвертації" },
      },
      required: ["valyutaZ", "valyutaDo", "suma"],
    },
  },
];

// ============================================================
// 4. СИСТЕМНИЙ ПРОМПТ АГЕНТА
// ============================================================

const AGENT_PROMPT = `Ти — розумний агент-помічник з інструментами.

ПРАВИЛА:
1. Якщо потрібен розрахунок, пошук чи конвертація — ВИКОРИСТОВУЙ інструменти.
2. Думай по кроках: спочатку визнач що потрібно, потім виклич інструмент.
3. Після отримання результату — дай зрозумілу відповідь користувачу.
4. Якщо інструмент не потрібен — просто відповідай.
5. НЕ вигадуй результати інструментів — тільки реальні відповіді.
6. Відповідай українською.
7. Поясни свій ланцюжок міркувань: що думав, що викликав, що отримав.
8. Якщо в документах користувача немає відповіді або потрібні АКТУАЛЬНІ дані
   (правила в'їзду, погода, курси, ціни, новини на сьогодні) — виклич webSearch
   і відповідай по результатах інтернет-пошуку, зазначаючи сайти-джерела.`;

// ============================================================
// 5. ЦИКЛ АГЕНТА (think → call → result → respond)
// ============================================================

export async function zapytDoAgenta(
  zapyt: string,
  systemnyiPrompt: string = AGENT_PROMPT
): Promise<VidpovidAgenta> {
  const ts1 = Date.now();
  const model = otrymatyGenAI().getGenerativeModel({
    model: MODEL_AGENTA,
    systemInstruction: systemnyiPrompt,
    tools: [{ functionDeclarations: TOOLS as unknown as FunctionDeclaration[] }],
    generationConfig: {
      temperature: 0.2,
      // Низький рівень мислення: дешевше і швидше; типи SDK ще не знають про поле
      thinkingConfig: { thinkingLevel: "low" },
    } as unknown as GenerationConfig,
  });

  const kroky: KrokAgenta[] = [];
  let potocnyyKrok = 0;
  const toolVykorystano: string[] = [];
  const webDzherela: WebDzherelo[] = [];
  const usage = { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0 };

  const istoriya: Content[] = [
    { role: "user", parts: [{ text: zapyt }] },
  ];

  let vseredine = true;
  let finalText = "";

  while (vseredine && potocnyyKrok < 5) {
    const vidpovid = await model.generateContent({ contents: istoriya });
    const parts = vidpovid.response.candidates?.[0]?.content?.parts || [];

    // Накопичуємо вартість усіх викликів у ланцюжку (кожен виклик тарифікується окремо)
    const um = vidpovid.response.usageMetadata;
    if (um) {
      usage.promptTokenCount += um.promptTokenCount ?? 0;
      usage.candidatesTokenCount += um.candidatesTokenCount ?? 0;
      usage.thoughtsTokenCount +=
        (um as { thoughtsTokenCount?: number }).thoughtsTokenCount ?? 0;
    }

    const tekstParts = parts.filter((p) => p.text);
    const fcParts = parts.filter((p) => p.functionCall);

    if (fcParts.length > 0) {
      for (const tp of tekstParts) {
        if (tp.text) {
          potocnyyKrok++;
          kroky.push({ krok: potocnyyKrok, typ: "mirkuvannya", opys: tp.text });
        }
      }

      istoriya.push({ role: "model", parts });

      const functionResponses = [];
      for (const fp of fcParts) {
        const fc = fp.functionCall!;
        const { name, args } = fc;
        potocnyyKrok++;

        kroky.push({
          krok: potocnyyKrok,
          typ: "vyklykTool",
          opys: `Викликую інструмент: ${name}`,
          tool: name,
          argy: args as Record<string, unknown>,
        });

        let rezultat: string;
        switch (name) {
          case "kalkulyator":
            rezultat = kalkulyator((args as { vyraz: string }).vyraz);
            break;
          case "shukatyVPodorozhah":
            rezultat = shukatyVPodorozhah(args as { krajyna?: string; misto?: string; maxCina?: number });
            break;
          case "konverterValyut":
            rezultat = konverter(
              (args as { valyutaZ: string }).valyutaZ,
              (args as { valyutaDo: string }).valyutaDo,
              (args as { suma: number }).suma
            );
            break;
          case "webSearch": {
            const poshuk = await pooshukVInterneti((args as { zapit: string }).zapit);
            rezultat = poshuk.tekst;
            webDzherela.push(...poshuk.dzherela);
            usage.promptTokenCount += poshuk.usage.promptTokenCount;
            usage.candidatesTokenCount += poshuk.usage.candidatesTokenCount;
            usage.thoughtsTokenCount += poshuk.usage.thoughtsTokenCount;
            break;
          }
          default:
            rezultat = `Невідомий інструмент: ${name}`;
        }

        toolVykorystano.push(name);
        kroky.push({
          krok: potocnyyKrok,
          typ: "rezultatTool",
          opys: `Отримав результат від ${name}`,
          tool: name,
          rezultat,
        });

        functionResponses.push({
          functionResponse: { name, response: { result: rezultat } },
        });
      }

      istoriya.push({ role: "user", parts: functionResponses });
    } else {
      finalText = tekstParts.map((p) => p.text).join("\n");
      potocnyyKrok++;
      kroky.push({ krok: potocnyyKrok, typ: "vdpovisd", opys: finalText });
      vseredine = false;
    }
  }

  return {
    vdpovisd: finalText,
    kroky,
    toolVykorystano,
    webDzherela,
    usage,
    model: MODEL_AGENTA,
    ms: Date.now() - ts1,
  };
}
