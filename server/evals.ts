import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

// ============================================================
// ТИПИ
// ============================================================
export interface Ochikuvannya {
  tonalnist?: "позитивна" | "негативна" | "нейтральна" | "змішана";
  ocinkaMin?: number;
  ocinkaMax?: number;
  rekomendatsiya?: boolean;
  korektna_mova?: boolean;
}

export interface EvalPrypad {
  id: number;
  opys: string; // що перевіряємо (слово для таблиці)
  skladna: boolean; // складний випадок (де очікуємо що базовий промпт помилиться)
  vidhuk: string;
  ochikuvannya: Ochikuvannya;
}

export interface RezultatPrypadu {
  id: number;
  opys: string;
  skladna: boolean;
  projshov: boolean;
  pomylky: string[]; // що саме не зійшлося
  ochikuvannya: Ochikuvannya;
  otzymano: {
    tonalnist?: string;
    ocinka?: number;
    rekomendatsiya?: boolean;
    korektna_mova?: boolean;
  } | null;
  syraPomylka?: string;
}

export interface ZvitEvals {
  versiya: string; // "A" | "B"
  skilkyPrOjshlo: number;
  vsiogo: number;
  tryvalistSek: number;
  pryypady: RezultatPrypadu[];
  sudyaVerdykt?: string; // підсумок LLM-судді
}

// ============================================================
// 1. ДАТАСЕТ: 10 evals
// ============================================================
export const PRYPADY_EVALS: EvalPrypad[] = [
  {
    id: 1,
    opys: "Сарказм (позитивні слова = негатив)",
    skladna: true,
    vidhuk:
      "Чудово! Просто чудово! Черга на рецепції 2 години, номер не прибрали, а сніданок закінчився о 8:00. Дякую за незабутній відпочинок!",
    ochikuvannya: { tonalnist: "негативна", ocinkaMin: 1, ocinkaMax: 2, rekomendatsiya: false },
  },
  {
    id: 2,
    opys: "Контроль: чіткий позитив",
    skladna: false,
    vidhuk:
      "Готель чудовий! Номер чистий, сніданки смачні, персонал уважний. Раджу всім, обов'язково повернемось!",
    ochikuvannya: { tonalnist: "позитивна", ocinkaMin: 4, ocinkaMax: 5, rekomendatsiya: true },
  },
  {
    id: 3,
    opys: "Контроль: чіткий негатив",
    skladna: false,
    vidhuk:
      "Жах і кошмар! Номер брудний, кондиціонер не працював, персонал грубий. Нікому не раджу, більше сюди не приїду.",
    ochikuvannya: { tonalnist: "негативна", ocinkaMin: 1, ocinkaMax: 2, rekomendatsiya: false },
  },
  {
    id: 4,
    opys: "Нецензурщина в лапках (цитата)",
    skladna: true,
    vidhuk:
      'Прийшли на ресепшн, а нам кажуть: "Ваш номер ще не готовий, ідіть на***". Такого ставлення я ще не бачив.',
    ochikuvannya: { korektna_mova: false, tonalnist: "негативна" },
  },
  {
    id: 5,
    opys: "Два готелі: чужий позитив ≠ наш досвід",
    skladna: true,
    vidhuk:
      "Про «Мрію» відгуки хороші, але ми жили в «Промені» — і це була помилка поїздки. Не раджу «Промінь».",
    ochikuvannya: { tonalnist: "негативна", ocinkaMin: 1, ocinkaMax: 2, rekomendatsiya: false },
  },
  {
    id: 6,
    opys: "Страх у минулому, позитив зараз",
    skladna: true,
    vidhuk:
      "Я очікувала жаху після читання відгуків, але нас зустріли чистим номером і усмішками. Навіть не віриться!",
    ochikuvannya: { tonalnist: "позитивна", ocinkaMin: 4, ocinkaMax: 5, rekomendatsiya: true },
  },
  {
    id: 7,
    opys: "Сарказм через перелік «якщо не рахувати»",
    skladna: true,
    vidhuk: "Все чудово, якщо не рахувати паркінг, сніданок, Wi-Fi і персонал.",
    ochikuvannya: { tonalnist: "негативна", ocinkaMin: 1, ocinkaMax: 2, rekomendatsiya: false },
  },
  {
    id: 8,
    opys: "Подвійне заперечення (litotes)",
    skladna: true,
    vidhuk: "Не можу сказати, що ми не задоволені персоналом.",
    ochikuvannya: { tonalnist: "позитивна", ocinkaMin: 4, ocinkaMax: 5, rekomendatsiya: true },
  },
  {
    id: 9,
    opys: "Тільки факти, без жодної оцінки",
    skladna: true,
    vidhuk:
      "Номер 304, балкон на південь, сніданок з 8:00 до 10:00, умивальник біля вікна, телевізор 43 дюйми.",
    ochikuvannya: { tonalnist: "нейтральна", ocinkaMin: 3, ocinkaMax: 3, rekomendatsiya: false },
  },
  {
    id: 10,
    opys: "Іронія: «тепер не знайомий»",
    skladna: true,
    vidhuk:
      "Знайомий порадив забронювати цей готель. Тепер він мені вже не знайомий.",
    ochikuvannya: { tonalnist: "негативна", ocinkaMin: 1, ocinkaMax: 2, rekomendatsiya: false },
  },
];

// ============================================================
// 2. ДВІ ВЕРСІЇ ПРОМПТУ
// ============================================================

/** A: поточний промпт (тиждень 1) */
export const PROMPT_A = `Ти — аналітик відгуків про подорожі. Твоя задача — аналізувати текст відгуку і повертати ТІЛЬКИ валідний JSON.

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

/** B: покращений промпт (додаємо правила для складних випадків) */
export const PROMPT_B = `Ти — аналітик відгуків про подорожі. Твоя задача — аналізувати текст відгуку і повертати ТІЛЬКИ валідний JSON.

ПРАВИЛА:
1. Відповідай ВИКЛЮЧНО у форматі JSON. Жодних пояснень до або після JSON.
2. Оцінка (ocinka) — число від 1 до 5:
   - 1-2: негативний досвід
   - 3: нейтральний або змішаний
   - 4-5: позитивний досвід
3. Тональність визначай за ЗАГАЛЬНИМ ЗМІСТОМ, а не за окремими словами.
   ВАЖЛИВО про сарказм: якщо позитивні слова ("чудово", "дякую", "все добре") вжито
   з приводу негативних фактів або супроводжуються переліком недоліків
   ("все чудово, якщо не рахувати...) — це САРКАЗМ, tonalnist = "негативна".
4. ОЦІНЮЙ ДОСВІД АВТОРА, а не чужі слова. Якщо автор пише "про X відгуки хороші",
   але його власний досвід у Y був поганим — tonalnist = "негативна".
   Чужі згадки не змінюють оцінку автора.
5. Подвійне заперечення перекладай уважно:
   "не можу сказати, що ми не задоволені" = ми ЗАДОВОЛЕНІ → tonalnist = "позитивна".
6. Текст без жодного оцінного слова (тільки факти: номер, час, розмір) →
   tonalnist = "нейтральна", ocinka = 3, rekomendatsiya = false.
7. Якщо відгук містить і позитив, і негатив БЕЗ переваги одного з них — tonalnist = "змішана".
   Якщо є явний домінантний настрій — вибирай його.
8. Дуже короткі відгуки (до 5 слів) без чіткої оцінки: tonalnist = "нейтральна", ocinka = 3.
9. rekomendatsiya:
   - true: автор прямо рекомендує, радить, каже "повернусь", "всім раджу".
   - true: автор пише позитивно і не висловлює наміру уникати місце надалі.
   - false: автор каже "не раджу", "не повернусь", "шукатиму інше", "не моє",
     навіть якщо загалом відгук помірно позитивний.
   - false: іронічний висновок із шкодою/жалем (напр: "тепер він мені не знайомий").
10. korektna_mova = false, якщо в тексті Є нецензурні слова (навіть у лапках/цитаті).
11. Теми — це короткі слова або фрази (напр: "сніданок", "чистота", "персонал").
12. Емоції — слова як "радість", "розчарування", "спокій", "злість".
13. Ніколи не вигадуй факти, яких немає у відгуку.

ПРИКЛАДИ СКЛАДНИХ ВИПАДКІВ:
- "Чудово! Черга 2 години і брудний номер. Дякую!" → сарказм: tonalnist="негативна", ocinka=1, rekomendatsiya=false
- "Все чудово, якщо не рахувати сніданок і персонал." → сарказм: tonalnist="негативна", ocinka=1, rekomendatsiya=false
- "Про X відгуки хороші, але ми жили в Y — помилка." → досвід автора: tonalnist="негативна", ocinka=1, rekomendatsiya=false
- "Не можу сказати, що ми не задоволені." → подвійне заперечення: tonalnist="позитивна", ocinka=4, rekomendatsiya=true
- "Номер 304, балкон на південь, сніданок о 8:00." → тільки факти: tonalnist="нейтральна", ocinka=3, rekomendatsiya=false
- "Знайомий порадив. Тепер він мені не знайомий." → іронія: tonalnist="негативна", ocinka=1, rekomendatsiya=false`;
export const PRYKLADY_A = [
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

const PRYKLADY_B = [
  ...PRYKLADY_A,
  {
    vidhuk: "Чудово! Просто чудово! Знову черга, знову бруд. Дякую!",
    vidpovid: {
      tonalnist: "негативна",
      ocinka: 1,
      temy: ["черга", "чистота"],
      emocii: ["сарказм", "роздратування"],
      rekomendatsiya: false,
      korektna_mova: true,
    },
  },
  {
    vidhuk: "Все чудово, якщо не рахувати паркінг, сніданок і персонал.",
    vidpovid: {
      tonalnist: "негативна",
      ocinka: 1,
      temy: ["паркінг", "сніданок", "персонал"],
      emocii: ["сарказм", "розчарування"],
      rekomendatsiya: false,
      korektna_mova: true,
    },
  },
  {
    vidhuk:
      "Про «Мрію» відгуки хороші, але ми жили в «Промені» — і це була помилка поїздки.",
    vidpovid: {
      tonalnist: "негативна",
      ocinka: 1,
      temy: ["вибір готелю", "досвід"],
      emocii: ["жаль", "розчарування"],
      rekomendatsiya: false,
      korektna_mova: true,
    },
  },
  {
    vidhuk: "Не можу сказати, що ми не задоволені персоналом.",
    vidpovid: {
      tonalnist: "позитивна",
      ocinka: 4,
      temy: ["персонал"],
      emocii: ["задоволення"],
      rekomendatsiya: true,
      korektna_mova: true,
    },
  },
  {
    vidhuk: "Номер 304, балкон на південь, сніданок з 8:00 до 10:00.",
    vidpovid: {
      tonalnist: "нейтральна",
      ocinka: 3,
      temy: ["номер", "балкон", "сніданок"],
      emocii: ["нейтралітет"],
      rekomendatsiya: false,
      korektna_mova: true,
    },
  },
  {
    vidhuk: "Знайомий порадив цей готель. Тепер він мені не знайомий.",
    vidpovid: {
      tonalnist: "негативна",
      ocinka: 1,
      temy: ["рекомендація", "досвід"],
      emocii: ["жаль", "розчарування"],
      rekomendatsiya: false,
      korektna_mova: true,
    },
  },
];

// ============================================================
// 3. СХЕМА (як у server.ts)
// ============================================================
const AnalizVidhuku = z.object({
  tonalnist: z.enum(["позитивна", "негативна", "нейтральна", "змішана"]),
  ocinka: z.number().min(1).max(5),
  temy: z.array(z.string()).max(5),
  emocii: z.array(z.string()).max(5),
  rekomendatsiya: z.boolean(),
  korektna_mova: z.boolean(),
});
type Analiz = z.infer<typeof AnalizVidhuku>;

// ============================================================
// 4. ВИКЛИК МОДЕЛІ З ВКАЗАНИМ ПРОМПТОМ
// ============================================================
async function analyzuvatyZPromptom(
  vidhuk: string,
  systemPrompt: string,
  prykldy: typeof PRYKLADY_A
): Promise<{ ok: true; data: Analiz } | { ok: false; pomylka: string }> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return { ok: false, pomylka: "LLM_API_KEY не задано" };
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.8-flash",
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  const prykldyTekst = prykldy
    .map(
      (p, i) =>
        `Приклад ${i + 1}:\nВідгук: "${p.vidhuk}"\nВідповідь: ${JSON.stringify(p.vidpovid, null, 2)}`
    )
    .join("\n\n");

  const prompt = `${prykldyTekst}\n\n---\nТепер проаналізуй ЦЕЙ відгук і поверни ТІЛЬКИ JSON:\n\n"${vidhuk}"`;

  // Виклик з retry: якщо модель повернула зламаний JSON — пробуємо ще раз
  for (const krokov of [0, 1]) {
    try {
      const zapytTekst =
        krokov === 0
          ? prompt
          : `Попередня відповідь була невалідним JSON. Поверни ТІЛЬКИ валідний JSON за схемою, без пояснень.\n\n${prompt}`;
      const result = await model.generateContent(zapytTekst);
      const tekst = result.response.text();
      const jsonTekst = vydyalutyJSON(tekst);
      const parsed = AnalizVidhuku.safeParse(JSON.parse(jsonTekst));
      if (parsed.success) return { ok: true, data: parsed.data };
      // JSON валідний, але не за схемою — теж пробуємо ще раз
      if (krokov === 0) continue;
      return { ok: false, pomylka: "JSON не за схемою" };
    } catch (e) {
      if (krokov === 0) continue;
      return { ok: false, pomylka: e instanceof Error ? e.message : "Помилка моделі" };
    }
  }
  return { ok: false, pomylka: "Невідома помилка" };
}

function vydyalutyJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) return match[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return text;
}

// ============================================================
// 5. АВТОМАТИЧНИЙ СУДДЯ (точно/мимо)
// ============================================================
export function ocinytyPrypad(
  prypad: EvalPrypad,
  otzymano: Analiz | null,
  syraPomylka?: string
): RezultatPrypadu {
  if (!otzymano) {
    return {
      id: prypad.id,
      opys: prypad.opys,
      skladna: prypad.skladna,
      projshov: false,
      pomylky: [`Модель не повернула JSON: ${syraPomylka || "невідома помилка"}`],
      ochikuvannya: prypad.ochikuvannya,
      otzymano: null,
      syraPomylka,
    };
  }

  const pomylky: string[] = [];
  const och = prypad.ochikuvannya;

  if (och.tonalnist && otzymano.tonalnist !== och.tonalnist) {
    pomylky.push(`tonalnist: очікували "${och.tonalnist}", отримали "${otzymano.tonalnist}"`);
  }
  if (och.ocinkaMin !== undefined && otzymano.ocinka < och.ocinkaMin) {
    pomylky.push(`ocinka: очікували ≥${och.ocinkaMin}, отримали ${otzymano.ocinka}`);
  }
  if (och.ocinkaMax !== undefined && otzymano.ocinka > och.ocinkaMax) {
    pomylky.push(`ocinka: очікували ≤${och.ocinkaMax}, отримали ${otzymano.ocinka}`);
  }
  if (och.rekomendatsiya !== undefined && otzymano.rekomendatsiya !== och.rekomendatsiya) {
    pomylky.push(
      `rekomendatsiya: очікували ${och.rekomendatsiya}, отримали ${otzymano.rekomendatsiya}`
    );
  }
  if (och.korektna_mova !== undefined && otzymano.korektna_mova !== och.korektna_mova) {
    pomylky.push(
      `korektna_mova: очікували ${och.korektna_mova}, отримали ${otzymano.korektna_mova}`
    );
  }

  return {
    id: prypad.id,
    opys: prypad.opys,
    skladna: prypad.skladna,
    projshov: pomylky.length === 0,
    pomylky,
    ochikuvannya: prypad.ochikuvannya,
    otzymano: {
      tonalnist: otzymano.tonalnist,
      ocinka: otzymano.ocinka,
      rekomendatsiya: otzymano.rekomendatsiya,
      korektna_mova: otzymano.korektna_mova,
    },
  };
}

// ============================================================
// 6. ЗАПУСК EVALS (10 випадків, послідовно щоб не ловити 429)
// ============================================================
export async function zapustytyEvals(versiya: "A" | "B"): Promise<ZvitEvals> {
  const systemPrompt = versiya === "A" ? PROMPT_A : PROMPT_B;
  const prykldy = versiya === "A" ? PRYKLADY_A : PRYKLADY_B;

  const pochatok = Date.now();
  const rezultaty: RezultatPrypadu[] = [];

  for (const prypad of PRYPADY_EVALS) {
    const vidpovid = await analyzuvatyZPromptom(prypad.vidhuk, systemPrompt, prykldy);
    if (vidpovid.ok) {
      rezultaty.push(ocinytyPrypad(prypad, vidpovid.data));
    } else {
      rezultaty.push(ocinytyPrypad(prypad, null, vidpovid.pomylka));
    }
  }

  const skilkyPrOjshlo = rezultaty.filter((r) => r.projshov).length;

  return {
    versiya,
    skilkyPrOjshlo,
    vsiogo: PRYPADY_EVALS.length,
    tryvalistSek: Math.round((Date.now() - pochatok) / 100) / 10,
    pryypady: rezultaty,
  };
}

// ============================================================
// 7. LLM-СУДДЯ (модель перевіряє модель)
// ============================================================
export async function sudyyaLLM(
  versiya: "A" | "B",
  pryypady: RezultatPrypadu[]
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return "LLM_API_KEY не задано";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.8-flash",
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  const opys = pryypady
    .map(
      (r) =>
        `Випадок ${r.id} (${r.opys}):\n  Очікування: ${JSON.stringify(r.ochikuvannya)}\n  Отримано: ${JSON.stringify(r.otzymano || r.syraPomylka)}\n  Вердикт автомата: ${r.projshov ? "✅ пройшов" : "❌ мимо: " + r.pomylky.join("; ")}`
    )
    .join("\n\n");

  const prompt = `Ти — суддя якості роботи AI-аналітика відгуків. Ось результати перевірки версіїї промпту ${versiya}:

${opys}

Дай СТИСЛИЙ підсумок українською (3-5 речень):
1. Які типи помилок найчастіші?
2. Що вдалося добре?
3. Які 1-2 зміни в промпті дали б найбільший приріст?
Пиши по суті, без води.`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e) {
    return `Помилка LLM-судді: ${e instanceof Error ? e.message : "невідома"}`;
  }
}
