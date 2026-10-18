// ============================================================
// ТИЖДЕНЬ 6: ВИМІРЮВАЧ ВАРТОСТІ ТА ШВИДКОСТІ
// Рахує токени, гроші, час; кеш повторів; ліміт витрат.
// Ціни: ai.google.dev/gemini-api/docs/pricing (Paid Tier, до 31.12.2026)
// ============================================================

/** Ціни за 1M токенів у USD */
export const TSINY: Record<string, { vkhid: number; vykhid: number; keshVkhid: number }> = {
  "gemini-3.8-flash": { vkhid: 0.75, vykhid: 3.75, keshVkhid: 0.075 },
  "gemini-3.5-flash-lite": { vkhid: 0.3, vykhid: 2.5, keshVkhid: 0.03 },
  "gemini-3.1-flash-lite": { vkhid: 0.25, vykhid: 1.5, keshVkhid: 0.025 },
};

export const ZAMOVCHUVALNYI_MODEL = "gemini-3.8-flash";

/** Метадані одного виклику моделі */
export interface MetaVykyku {
  model: string;
  tokensIn: number; // вхідні токени (промпт)
  thoughts: number; // «думки» моделі (теж тарифікуються як вихід)
  tokensOut: number; // вихідні + думки
  keshovano: number; // токени, які взято з контекстного кешу Google
  usd: number; // скільки коштував виклик
  ms: number; // тривалість
  keshHit: boolean; // чи відповідь взято з нашого кешу (0 $)
}

/** Стан фічі (агрегат по групі викликів) */
interface StanFichy {
  vykykiv: number;
  keshHitiv: number;
  tokensIn: number;
  thoughts: number;
  tokensOut: number;
  usd: number;
  ms: number;
}

function porozhniiStan(): StanFichy {
  return { vykykiv: 0, keshHitiv: 0, tokensIn: 0, thoughts: 0, tokensOut: 0, usd: 0, ms: 0 };
}

const stany: Record<string, StanFichy> = {};
let limitUsd: number | null = null;

// ============================================================
// КЕШ ПОВТОРНИХ ЗАПИТІВ (0 токенів, 0 $, ~0 мс)
// ============================================================
interface Kesyany {
  dani: unknown;
  chas: number;
}
const kesh = new Map<string, Kesyany>();
const KESH_TTL_MS = 10 * 60 * 1000; // 10 хвилин
const KESH_MAX = 100;

export function shukatyVKesi<T>(klyuch: string): T | null {
  const ye = kesh.get(klyuch);
  if (!ye) return null;
  if (Date.now() - ye.chas > KESH_TTL_MS) {
    kesh.delete(klyuch);
    return null;
  }
  return ye.dani as T;
}

export function zberehtyVKes(klyuch: string, dani: unknown): void {
  // LRU: якщо переповнено — видаляємо найстаріший
  if (kesh.size >= KESH_MAX) {
    const pershyi = kesh.keys().next().value;
    if (pershyi !== undefined) kesh.delete(pershyi);
  }
  kesh.set(klyuch, { dani, chas: Date.now() });
}

export function ochystytyKesh(): void {
  kesh.clear();
}

// ============================================================
// РОЗРАХУНОК ЦІНИ
// ============================================================

/** Отримує usageMetadata відповіді SDK і рахує вартість виклику */
export function rozrahuvatyVykyk(
  model: string,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number },
  ms: number
): MetaVykyku {
  const tsina = TSINY[model] || TSINY[ZAMOVCHUVALNYI_MODEL];

  const tokensIn = usage.promptTokenCount ?? 0;
  const keshovano = usage.cachedContentTokenCount ?? 0;
  // thoughtsTokenCount не оголошено у типах SDK, але є у реальній відповіді
  const thoughts = (usage as { thoughtsTokenCount?: number }).thoughtsTokenCount ?? 0;
  const candidates = usage.candidatesTokenCount ?? 0;
  const tokensOut = candidates + thoughts; // думки тарифікуються як вихід

  const sviyVkhid = Math.max(0, tokensIn - keshovano);
  const usd =
    (sviyVkhid * tsina.vkhid + keshovano * tsina.keshVkhid + tokensOut * tsina.vykhid) / 1e6;

  return { model, tokensIn, thoughts, tokensOut, keshovano, usd, ms, keshHit: false };
}

// ============================================================
// ЛІМІТ ВИТРАТ (захист від перевитрати)
// ============================================================
export function vstanovytyLimit(usd: number | null): void {
  limitUsd = usd;
}

export function otrymatyLimit(): number | null {
  return limitUsd;
}

/** Викликати ПЕРЕД запитом до моделі — кидає помилку якщо ліміт перевищено */
export function perevirytyLimit(prychynnykUsd: number): void {
  const vydatrano = otrymatyStats().zaVse.usd;
  if (limitUsd !== null && vydatrano + prychynnykUsd > limitUsd) {
    throw new Error(
      `⛔ Ліміт витрат: витрачено $${vydatrano.toFixed(4)} з ліміту $${limitUsd.toFixed(4)}. Новий виклик заблоковано.`
    );
  }
}

// ============================================================
// АГРЕГАЦІЯ СТАТИСТИКИ
// ============================================================

/** Записує один виклик у статистику фічі ("analiz/ekonom", "eksperyment/do" тощо) */
export function zarakhuvaty(fecha: string, meta: MetaVykyku): void {
  if (!stany[fecha]) stany[fecha] = porozhniiStan();
  const s = stany[fecha];
  s.vykykiv += 1;
  if (meta.keshHit) s.keshHitiv += 1;
  s.tokensIn += meta.tokensIn;
  s.thoughts += meta.thoughts;
  s.tokensOut += meta.tokensOut;
  s.usd += meta.usd;
  s.ms += meta.ms;
}

/** Повна статистика для UI */
export function otrymatyStats(): {
  zaVse: StanFichy & { usdSer: number; msSer: number; keshEkonomiyaUsd: number };
  zaFicharamy: { nayva: string; vykykiv: number; keshHitiv: number; tokensIn: number; thoughts: number; tokensOut: number; usd: number; ms: number }[];
  limitUsd: number | null;
  tsiny: typeof TSINY;
} {
  const zaVse = porozhniiStan();
  for (const s of Object.values(stany)) {
    zaVse.vykykiv += s.vykykiv;
    zaVse.keshHitiv += s.keshHitiv;
    zaVse.tokensIn += s.tokensIn;
    zaVse.thoughts += s.thoughts;
    zaVse.tokensOut += s.tokensOut;
    zaVse.usd += s.usd;
    zaVse.ms += s.ms;
  }
  const realni = zaVse.vykykiv - zaVse.keshHitiv; // виклики, де реально були токени
  const keshEkonomiyaUsd =
    zaVse.keshHitiv > 0
      ? zaVse.keshHitiv * (zaVse.usd / Math.max(1, realni))
      : 0;

  return {
    zaVse: {
      ...zaVse,
      usdSer: zaVse.vykykiv > 0 ? zaVse.usd / zaVse.vykykiv : 0,
      msSer: zaVse.vykykiv > 0 ? zaVse.ms / zaVse.vykykiv : 0,
      keshEkonomiyaUsd,
    },
    zaFicharamy: Object.entries(stany).map(([nayva, s]) => ({ nayva, ...s })),
    limitUsd,
    tsiny: TSINY,
  };
}

/** Обнуляємо лічильники (для чистого експерименту «до/після») */
export function sklasty(): void {
  for (const k of Object.keys(stany)) delete stany[k];
}
