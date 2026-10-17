import { useState } from "react";
import "./App.css";

interface Analiz {
  tonalnist: "позитивна" | "негативна" | "нейтральна" | "змішана";
  ocinka: number;
  temy: string[];
  emocii: string[];
  rekomendatsiya: boolean;
  korektna_mova: boolean;
  retry?: boolean;
}

interface Pomylka {
  pomylka: string;
  syryyTekst?: string;
}

interface RagVidpovid {
  vidpovid: string;
  dzherela: { dokument: string; tsytata: string }[];
  shmatkivZnaydeno: number;
}

const PRYKLADY_VIDHUKIV = [
  "Готель просто чудовий! Номер чистий, сніданки смачні, персонал дуже уважний. Єдиний мінус — далеко від центру, але є безкоштовний шатл.",
  "Жах. Номер брудний, кондиціонер не працював, на рецепції ніхто не допоміг. Більше сюди не приїду.",
  "Готель нормальний, але дорогувато за таку якість. Сніданки ок, але номер маленький. Щось середнє.",
];

const PRYKLADY_ZAPYTIV_RAG = [
  "Що таке RAG і навіщо він потрібен?",
  "Як працюють ембеддинги?",
  "Які техніки промпт-інженерії ти знаєш?",
];

const TONALNIST_KOLIR: Record<string, string> = {
  позитивна: "#52c41a",
  негативна: "#ff4d4f",
  нейтральна: "#1677ff",
  змішана: "#faad14",
};

function App() {
  const [vkladka, setVkladka] = useState<"analiz" | "rag">("analiz");

  // === Стан для аналізу відгуків ===
  const [vidhuk, setVidhuk] = useState("");
  const [analiz, setAnaliz] = useState<Analiz | null>(null);
  const [pomylka, setPomylka] = useState<Pomylka | null>(null);
  const [zavantazhennya, setZavantazhennya] = useState(false);

  // === Стан для RAG ===
  const [ragZapyt, setRagZapyt] = useState("");
  const [ragVidpovid, setRagVidpovid] = useState<RagVidpovid | null>(null);
  const [ragPomylka, setRagPomylka] = useState("");
  const [ragStatus, setRagStatus] = useState<{ shmatkiv: number; dokumenty: string[] } | null>(null);
  const [ragZavantazhennya, setRagZavantazhennya] = useState(false);
  const [ragShukayemo, setRagShukayemo] = useState(false);

  const analyzuvaty = async () => {
    if (vidhuk.trim().length < 10) {
      setPomylka({ pomylka: "Відгук має містити мінімум 10 символів" });
      return;
    }
    setZavantazhennya(true);
    setAnaliz(null);
    setPomylka(null);
    try {
      const response = await fetch("http://localhost:3001/api/analiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vidhuk }),
      });
      const data = await response.json();
      if (!response.ok) { setPomylka(data); return; }
      setAnaliz(data);
    } catch {
      setPomylka({ pomylka: "Не вдалося з'єднатися з сервером" });
    } finally { setZavantazhennya(false); }
  };

  // === RAG: завантажити документи ===
  const zavantazhytyDokumenty = async () => {
    setRagZavantazhennya(true);
    setRagPomylka("");
    try {
      const res = await fetch("http://localhost:3001/api/rag/zavantazhyty", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setRagPomylka(data.pomylka || "Помилка"); return; }
      const status = await fetch("http://localhost:3001/api/rag/status").then((r) => r.json());
      setRagStatus(status);
    } catch {
      setRagPomylka("Сервер не відповідає");
    } finally { setRagZavantazhennya(false); }
  };

  // === RAG: запитання ===
  const postavytyZapyt = async () => {
    if (ragZapyt.trim().length < 5) return;
    setRagShukayemo(true);
    setRagVidpovid(null);
    setRagPomylka("");
    try {
      const res = await fetch("http://localhost:3001/api/rag/zapyt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zapyt: ragZapyt }),
      });
      const data = await res.json();
      if (!res.ok) { setRagPomylka(data.pomylka || "Помилка"); return; }
      setRagVidpovid(data);
    } catch {
      setRagPomylka("Сервер не відповідає");
    } finally { setRagShukayemo(false); }
  };

  return (
    <div className="app">
      <header className="shapka">
        <h1>🧠 AI-асистент</h1>
        <p>Рівень 6: промпт-інженерія + RAG</p>

        {/* Вкладки */}
        <div className="vkladky">
          <button
            className={`vkladka ${vkladka === "analiz" ? "aktyvna" : ""}`}
            onClick={() => setVkladka("analiz")}
          >
            📝 Аналіз відгуків
          </button>
          <button
            className={`vkladka ${vkladka === "rag" ? "aktyvna" : ""}`}
            onClick={() => setVkladka("rag")}
          >
            📚 RAG-асистент
          </button>
        </div>
      </header>

      <main className="vmist">
        {/* ============ ВКЛАДКА 1: АНАЛІЗ ВІДГУКІВ ============ */}
        {vkladka === "analiz" && (
          <>
            <section className="blok">
              <h2>📝 Відгук користувача</h2>
              <textarea
                value={vidhuk}
                onChange={(e) => setVidhuk(e.target.value)}
                placeholder="Вставте текст відгуку про готель, подорож, ресторан..."
                rows={5}
              />
              <div className="prykaldy">
                <span>Приклади:</span>
                {PRYKLADY_VIDHUKIV.map((p, i) => (
                  <button key={i} onClick={() => setVidhuk(p)} className="btn-pryklad">#{i + 1}</button>
                ))}
              </div>
              <button
                className="btn-analyz"
                onClick={analyzuvaty}
                disabled={zavantazhennya || vidhuk.trim().length < 10}
              >
                {zavantazhennya ? "⏳ Аналізую..." : "🔍 Проаналізувати"}
              </button>
            </section>

            {pomylka && (
              <section className="blok pomylka">
                <h2>❌ Помилка</h2>
                <p>{pomylka.pomylka}</p>
                {pomylka.syryyTekst && (
                  <details><summary>Сирий текст</summary><pre>{pomylka.syryyTekst}</pre></details>
                )}
              </section>
            )}

            {analiz && (
              <section className="blok resultat">
                <h2>📊 Результат аналізу{analiz.retry && <span className="badge-retry"> (retry)</span>}</h2>
                <div className="vizualizatsiya">
                  <div className="kartka">
                    <span className="label">Тональність</span>
                    <span className="znachennya" style={{ color: TONALNIST_KOLIR[analiz.tonalnist] }}>{analiz.tonalnist}</span>
                  </div>
                  <div className="kartka">
                    <span className="label">Оцінка</span>
                    <span className="znachennya ocinka">{"⭐".repeat(analiz.ocinka)}<span className="chyslo"> {analiz.ocinka}/5</span></span>
                  </div>
                  <div className="kartka">
                    <span className="label">Рекомендує</span>
                    <span className="znachennya">{analiz.rekomendatsiya ? "✅ Так" : "❌ Ні"}</span>
                  </div>
                  <div className="kartka">
                    <span className="label">Коректна мова</span>
                    <span className="znachennya">{analiz.korektna_mova ? "✅ Так" : "❌ Ні"}</span>
                  </div>
                </div>
                <div className="tegi">
                  <div>
                    <span className="label">Теми:</span>
                    <div className="spysok-tegiv">{analiz.temy.map((t, i) => <span key={i} className="teg">{t}</span>)}</div>
                  </div>
                  <div>
                    <span className="label">Емоції:</span>
                    <div className="spysok-tegiv">{analiz.emocii.map((e, i) => <span key={i} className="teg emotsiya">{e}</span>)}</div>
                  </div>
                </div>
                <details className="syryy-json"><summary>🔍 Сирий JSON</summary><pre>{JSON.stringify(analiz, null, 2)}</pre></details>
              </section>
            )}
          </>
        )}

        {/* ============ ВКЛАДКА 2: RAG ============ */}
        {vkladka === "rag" && (
          <>
            {/* Статус бази */}
            <section className="blok rag-status">
              <h2>📚 База знань</h2>
              {ragStatus ? (
                <div className="rag-info">
                  <span>✅ Завантажено: <strong>{ragStatus.shmatkiv}</strong> шматків з {ragStatus.dokumenty.length} документів</span>
                  <div className="spysok-tegiv">{ragStatus.dokumenty.map((d, i) => <span key={i} className="teg">{d}</span>)}</div>
                </div>
              ) : (
                <p>Документи ще не завантажені</p>
              )}
              <button className="btn-analyz" onClick={zavantazhytyDokumenty} disabled={ragZavantazhennya}>
                {ragZavantazhennya ? "⏳ Обчислюю ембеддинги..." : ragStatus ? "🔄 Перезавантажити документи" : "📦 Завантажити документи"}
              </button>
            </section>

            {/* Запитання */}
            <section className="blok">
              <h2>❓ Запитання до документів</h2>
              <div className="rag-polye">
                <input
                  type="text"
                  value={ragZapyt}
                  onChange={(e) => setRagZapyt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && postavytyZapyt()}
                  placeholder="Наприклад: Що таке RAG?"
                />
                <button
                  className="btn-analyz"
                  onClick={postavytyZapyt}
                  disabled={ragShukayemo || ragZapyt.trim().length < 5}
                >
                  {ragShukayemo ? "⏳ Шукаю..." : "🔍 Запитати"}
                </button>
              </div>
              <div className="prykaldy">
                <span>Приклади:</span>
                {PRYKLADY_ZAPYTIV_RAG.map((p, i) => (
                  <button key={i} onClick={() => setRagZapyt(p)} className="btn-pryklad">#{i + 1}</button>
                ))}
              </div>
            </section>

            {/* Помилка */}
            {ragPomylka && (
              <section className="blok pomylka">
                <h2>❌ Помилка</h2>
                <p>{ragPomylka}</p>
              </section>
            )}

            {/* Відповідь */}
            {ragVidpovid && (
              <section className="blok resultat rag-vidpovid">
                <h2>💬 Відповідь</h2>
                <div className="rag-tekst">{ragVidpovid.vidpovid}</div>

                <h3>📖 Джерела ({ragVidpovid.shmatkivZnaydeno} шматків):</h3>
                {ragVidpovid.dzherela.map((d, i) => (
                  <div key={i} className="dzherelo">
                    <strong>{d.dokument}</strong>
                    <p>«{d.tsytata}»</p>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
