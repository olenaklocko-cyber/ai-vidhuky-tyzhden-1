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

const PRYKLADY_VIDHUKIV = [
  "Готель просто чудовий! Номер чистий, сніданки смачні, персонал дуже уважний. Єдиний мінус — далеко від центру, але є безкоштовний шатл.",
  "Жах. Номер брудний, кондиціонер не працював, на рецепції ніхто не допоміг. Більше сюди не приїду.",
  "Готель нормальний, але дорогувато за таку якість. Сніданки ок, але номер маленький. Щось середнє.",
];

const TONALNIST_KOLIR: Record<string, string> = {
  позитивна: "#52c41a",
  негативна: "#ff4d4f",
  нейтральна: "#1677ff",
  змішана: "#faad14",
};

function App() {
  const [vidhuk, setVidhuk] = useState("");
  const [analiz, setAnaliz] = useState<Analiz | null>(null);
  const [pomylka, setPomylka] = useState<Pomylka | null>(null);
  const [zavantazhennya, setZavantazhennya] = useState(false);

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

      if (!response.ok) {
        setPomylka(data);
        return;
      }

      setAnaliz(data);
    } catch {
      setPomylka({ pomylka: "Не вдалося з'єднатися з сервером" });
    } finally {
      setZavantazhennya(false);
    }
  };

  return (
    <div className="app">
      <header className="shapka">
        <h1>🧠 AI-аналітик відгуків</h1>
        <p>Тиждень 1: промпт-інженерія + строгий JSON</p>
      </header>

      <main className="vmist">
        {/* Поле введення */}
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
              <button key={i} onClick={() => setVidhuk(p)} className="btn-pryklad">
                #{i + 1}
              </button>
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

        {/* Помилка */}
        {pomylka && (
          <section className="blok pomylka">
            <h2>❌ Помилка</h2>
            <p>{pomylka.pomylka}</p>
            {pomylka.syryyTekst && (
              <details>
                <summary>Сирий текст від моделі</summary>
                <pre>{pomylka.syryyTekst}</pre>
              </details>
            )}
          </section>
        )}

        {/* Результат */}
        {analiz && (
          <section className="blok resultat">
            <h2>
              📊 Результат аналізу
              {analiz.retry && <span className="badge-retry"> (retry)</span>}
            </h2>

            {/* Візуалізація */}
            <div className="vizualizatsiya">
              <div className="kartka">
                <span className="label">Тональність</span>
                <span
                  className="znachennya"
                  style={{ color: TONALNIST_KOLIR[analiz.tonalnist] }}
                >
                  {analiz.tonalnist}
                </span>
              </div>
              <div className="kartka">
                <span className="label">Оцінка</span>
                <span className="znachennya ocinka">
                  {"⭐".repeat(analiz.ocinka)}
                  <span className="chyslo"> {analiz.ocinka}/5</span>
                </span>
              </div>
              <div className="kartka">
                <span className="label">Рекомендує</span>
                <span className="znachennya">
                  {analiz.rekomendatsiya ? "✅ Так" : "❌ Ні"}
                </span>
              </div>
              <div className="kartka">
                <span className="label">Коректна мова</span>
                <span className="znachennya">
                  {analiz.korektna_mova ? "✅ Так" : "❌ Ні"}
                </span>
              </div>
            </div>

            {/* Теми та емоції */}
            <div className="tegi">
              <div>
                <span className="label">Теми:</span>
                <div className="spysok-tegiv">
                  {analiz.temy.map((t, i) => (
                    <span key={i} className="teg">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <span className="label">Емоції:</span>
                <div className="spysok-tegiv">
                  {analiz.emocii.map((e, i) => (
                    <span key={i} className="teg emotsiya">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Сирий JSON */}
            <details className="syryy-json">
              <summary>🔍 Показати сирий JSON</summary>
              <pre>{JSON.stringify(analiz, null, 2)}</pre>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
