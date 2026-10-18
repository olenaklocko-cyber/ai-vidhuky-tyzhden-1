// ============================================================
// ТИЖДЕНЬ 8: EVALS АСИСТЕНТА (якість живого продукту)
// Детерміновані перевірки ключових слів: відповідь чесна,
// по документах, з реальним результатом інструмента.
// Кейси: 3 базові + будь-які, додані зі зворотного зв'язку 👎.
// ============================================================
import { zapytDoAsystenta } from "./chat.js";

export interface ChatEvalPrypad {
  id: number;
  opys: string;
  zapit: string;
  /** Кожна група — має збігтися щонайменше одне слово (lowercase) */
  ochikuvannya: string[][];
  /** Цих слів бути НЕ має (галюцинація / вигадка) */
  zaboroneniSlova: string[];
  dzherelo: "базовий" | "зі зворотного зв'язку";
}

export interface RezultatChatEvalu {
  id: number;
  opys: string;
  dzherelo: ChatEvalPrypad["dzherelo"];
  zapit: string;
  projshov: boolean;
  brakSlov: string[];
  zaboroneniZnaydeni: string[];
  vidpovidSkorocheno: string;
  pomylka?: string;
}

export interface ZvitChatEvals {
  vsiogo: number;
  prOjshlo: number;
  tryvalistSek: number;
  pryypady: RezultatChatEvalu[];
}

// ============================================================
// 1. БАЗОВІ КЕЙСИ (по реальних документах і інструментах)
// ============================================================
const BAZOVI_CHAT_EVALS: ChatEvalPrypad[] = [
  {
    id: 1,
    opys: "RAG: відповідь ТІЛЬКИ з документа (нотатки про Рим)",
    zapit: "Скільки коштує гостел за ніч у Римі і який бюджет на день?",
    ochikuvannya: [["30"], ["50"], ["80"]],
    zaboroneniSlova: [],
    dzherelo: "базовий",
  },
  {
    id: 2,
    opys: "Інструмент: конвертер валют (реальний результат)",
    zapit: "Конвертуй 100 доларів в євро.",
    ochikuvannya: [["92"]],
    zaboroneniSlova: ["невідома валюта"],
    dzherelo: "базовий",
  },
  {
    id: 3,
    opys: "Чесність: немає в документах → не вигадувати",
    zapit: "Який контактний телефон готелю в моїх нотатках про Рим?",
    ochikuvannya: [["не знай", "нема", "не містить", "відсутн", "нічого не знайдено", "не вказано"]],
    zaboroneniSlova: ["+39"],
    dzherelo: "базовий",
  },
];

// ============================================================
// 2. СХОВИЩЕ: базові + додані зі зворотного зв'язку
// ============================================================
let dodatkovi: ChatEvalPrypad[] = [];
let nastupnyyId = 100;

export function otrymatyChatEvals(): ChatEvalPrypad[] {
  return [...BAZOVI_CHAT_EVALS, ...dodatkovi];
}

/** Додаємо кейс із незадоволеного зворотного зв'язку (дедуплікація за запитом) */
export function dodatyChatEval(p: {
  opys: string;
  zapit: string;
  ochikuvannya: string[];
  zaboroneniSlova?: string[];
}): ChatEvalPrypad {
  const naydenyj = [...BAZOVI_CHAT_EVALS, ...dodatkovi].find(
    (e) => e.zapit.trim().toLowerCase() === p.zapit.trim().toLowerCase()
  );
  if (naydenyj) return naydenyj;

  const novyy: ChatEvalPrypad = {
    id: nastupnyyId++,
    opys: p.opys.slice(0, 120),
    zapit: p.zapit,
    // кожне слово з списку — обов'язкове; через "|" — альтернативи в групі
    ochikuvannya: p.ochikuvannya
      .map((s) => s.toLowerCase().split("|").map((x) => x.trim()).filter(Boolean))
      .filter((g) => g.length > 0),
    zaboroneniSlova: (p.zaboroneniSlova ?? []).map((s) => s.toLowerCase()),
    dzherelo: "зі зворотного зв'язку",
  };
  dodatkovi.push(novyy);
  return novyy;
}

export function vydalytyChatEval(id: number): boolean {
  const dovyhy = dodatkovi.length;
  dodatkovi = dodatkovi.filter((e) => e.id !== id);
  return dodatkovi.length < dovyhy;
}

/** Скид (для локальних тестів) */
export function ochystytyChatEvals(): void {
  dodatkovi = [];
}

// ============================================================
// 3. ПРОГІН: один запит → перевірка ключових слів
// ============================================================
export async function zapustytyChatEvals(): Promise<ZvitChatEvals> {
  const ts1 = Date.now();
  const pryypady: RezultatChatEvalu[] = [];

  for (const prypad of otrymatyChatEvals()) {
    const rez: RezultatChatEvalu = {
      id: prypad.id,
      opys: prypad.opys,
      dzherelo: prypad.dzherelo,
      zapit: prypad.zapit,
      projshov: false,
      brakSlov: [],
      zaboroneniZnaydeni: [],
      vidpovidSkorocheno: "",
    };

    try {
      const rezultat = await zapytDoAsystenta(prypad.zapit, { feature: "chatEvals" });
      if (rezultat.blok) {
        rez.pomylka = `заблоковано модерацією: ${rezultat.prychyna}`;
        pryypady.push(rez);
        continue;
      }
      const nyzhna = rezultat.vidpovid.toLowerCase();
      rez.vidpovidSkorocheno = rezultat.vidpovid.slice(0, 220);

      for (const hrupa of prypad.ochikuvannya) {
        if (!hrupa.some((s) => nyzhna.includes(s))) {
          rez.brakSlov.push(hrupa.join(" / "));
        }
      }
      for (const slovo of prypad.zaboroneniSlova) {
        if (nyzhna.includes(slovo)) rez.zaboroneniZnaydeni.push(slovo);
      }
      rez.projshov = rez.brakSlov.length === 0 && rez.zaboroneniZnaydeni.length === 0;
    } catch (e) {
      rez.pomylka = e instanceof Error ? e.message : "Невідома помилка";
    }

    pryypady.push(rez);
  }

  return {
    vsiogo: pryypady.length,
    prOjshlo: pryypady.filter((p) => p.projshov).length,
    tryvalistSek: Math.round((Date.now() - ts1) / 100) / 10,
    pryypady,
  };
}
