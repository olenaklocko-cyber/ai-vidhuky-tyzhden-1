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

interface KrokAgenta {
  krok: number;
  typ: "mirkuvannya" | "vyklykTool" | "rezultatTool" | "vdpovisd";
  opys: string;
  tool?: string;
  argy?: Record<string, unknown>;
  rezultat?: string;
}

interface VidpovidAgenta {
  vdpovisd: string;
  kroky: KrokAgenta[];
  toolVykorystano: string[];
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

const PRYKLADY_ZAPYTIV_AGENT = [
  "Скільки буде 1500 доларів у євро?",
  "Знайди подорожі в Італії до 1300 доларів",
  "Обчисли (25 * 4 + 100) / 3 і поясни що вийшло",
];

const PRYKLADY_ZAPYTIV_STRIM = [
  "Розкажи цікавий факт про космос",
  "Що таке штучний інтелект?",
  "Як працює нейромережа?",
];

const TONALNIST_KOLIR: Record<string, string> = {
  позитивна: "#52c41a",
  негативна: "#ff4d4f",
  нейтральна: "#1677ff",
  змішана: "#faad14",
};

function App() {
  const [vkladka, setVkladka] = useState<"analiz" | "rag" | "agent" | "vision">("analiz");

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

  // === Стан для Агента ===
  const [agentZapyt, setAgentZapyt] = useState("");
  const [agentVidpovid, setAgentVidpovid] = useState<VidpovidAgenta | null>(null);
  const [agentPomylka, setAgentPomylka] = useState("");
  const [agentPratsyuye, setAgentPratsyuye] = useState(false);

  // === Стан для Vision + Стріму ===
  const [kartynka, setKartynka] = useState<string | null>(null);
  const [kartynkaMime, setKartynkaMime] = useState("");
  const [visionOpys, setVisionOpys] = useState("");
  const [visionPomylka, setVisionPomylka] = useState("");
  const [visionOpysuye, setVisionOpysuye] = useState(false);

  const [strimZapyt, setStrimZapyt] = useState("");
  const [strimTekst, setStrimTekst] = useState("");
  const [strimPratsyuye, setStrimPratsyuye] = useState(false);
  const [strimPomylka, setStrimPomylka] = useState("");

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

  // === Агент: запит ===
  const zapitytyAgenta = async () => {
    if (agentZapyt.trim().length < 5) return;
    setAgentPratsyuye(true);
    setAgentVidpovid(null);
    setAgentPomylka("");
    try {
      const res = await fetch("http://localhost:3001/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zapyt: agentZapyt }),
      });
      const data = await res.json();
      if (!res.ok) { setAgentPomylka(data.pomylka || "Помилка"); return; }
      setAgentVidpovid(data);
    } catch {
      setAgentPomylka("Сервер не відповідає");
    } finally { setAgentPratsyuye(false); }
  };

  // === Vision: завантажити картинку ===
  const zavantazhytyKartynku = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fayl = e.target.files?.[0];
    if (!fayl) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setKartynka(reader.result as string);
      setKartynkaMime(fayl.type);
      setVisionOpys("");
      setVisionPomylka("");
    };
    reader.readAsDataURL(fayl);
  };

  // === Vision: описати картинку ===
  const opysatyKartynkuFn = async () => {
    if (!kartynka || !kartynkaMime) return;
    setVisionOpysuye(true);
    setVisionOpys("");
    setVisionPomylka("");
    try {
      const base64 = kartynka.split(",")[1];
      const res = await fetch("http://localhost:3001/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mime: kartynkaMime }),
      });
      const data = await res.json();
      if (!res.ok) { setVisionPomylka(data.pomylka || "Помилка"); return; }
      setVisionOpys(data.opys);
    } catch {
      setVisionPomylka("Сервер не відповідає");
    } finally { setVisionOpysuye(false); }
  };

  // === Стрімінг ===
  const strimyty = async () => {
    if (strimZapyt.trim().length < 3) return;
    setStrimPratsyuye(true);
    setStrimTekst("");
    setStrimPomylka("");

    try {
      const res = await fetch("http://localhost:3001/api/strim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zapyt: strimZapyt }),
      });

      if (!res.ok) {
        const data = await res.json();
        setStrimPomylka(data.pomylka || "Помилка");
        return;
      }

      // Читаємо SSE потік
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));
              if (data.chunk) {
                setStrimTekst((prev) => prev + data.chunk);
              }
              if (data.pomylka) {
                setStrimPomylka(data.pomylka);
              }
            }
          }
        }
      }
    } catch {
      setStrimPomylka("Помилка з'єднання");
    } finally {
      setStrimPratsyuye(false);
    }
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
          <button
            className={`vkladka ${vkladka === "agent" ? "aktyvna" : ""}`}
            onClick={() => setVkladka("agent")}
          >
            🛠 Агент
          </button>
          <button
            className={`vkladka ${vkladka === "vision" ? "aktyvna" : ""}`}
            onClick={() => setVkladka("vision")}
          >
            🎨 Картинки + Стрім
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

        {/* ============ ВКЛАДКА 3: АГЕНТ ============ */}
        {vkladka === "agent" && (
          <>
            {/* Запит до агента */}
            <section className="blok agent-zapyt">
              <h2>🛠 Запит до агента</h2>
              <p className="agent-info">
                Агент має 3 інструменти: 🔢 калькулятор, 🔎 пошук подорожей, 💱 конвертер валют.
                Він сам вирішує який викликати.
              </p>
              <div className="rag-polye">
                <input
                  type="text"
                  value={agentZapyt}
                  onChange={(e) => setAgentZapyt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && zapitytyAgenta()}
                  placeholder="Наприклад: Скільки 1000 доларів у євро?"
                />
                <button
                  className="btn-analyz"
                  onClick={zapitytyAgenta}
                  disabled={agentPratsyuye || agentZapyt.trim().length < 5}
                >
                  {agentPratsyuye ? "⏳ Працюю..." : "🚀 Запустити"}
                </button>
              </div>
              <div className="prykaldy">
                <span>Приклади:</span>
                {PRYKLADY_ZAPYTIV_AGENT.map((p, i) => (
                  <button key={i} onClick={() => setAgentZapyt(p)} className="btn-pryklad">#{i + 1}</button>
                ))}
              </div>
            </section>

            {/* Помилка */}
            {agentPomylka && (
              <section className="blok pomylka">
                <h2>❌ Помилка</h2>
                <p>{agentPomylka}</p>
              </section>
            )}

            {/* Ланцюжок міркувань + відповідь */}
            {agentVidpovid && (
              <>
                {/* Ланцюжок кроків */}
                <section className="blok agent-lanzyuzhok">
                  <h2>🧩 Ланцюжок міркувань агента</h2>
                  <div className="kroky">
                    {agentVidpovid.kroky.map((k, i) => (
                      <div key={i} className={`krok krok-${k.typ}`}>
                        <span className="krok-nomer">Крок {k.krok}</span>
                        <span className="krok-typ">
                          {k.typ === "mirkuvannya" && "🧠 Думаю"}
                          {k.typ === "vyklykTool" && `🔧 Виклик: ${k.tool}`}
                          {k.typ === "rezultatTool" && `📥 Результат: ${k.tool}`}
                          {k.typ === "vdpovisd" && "💬 Відповідь"}
                        </span>
                        <div className="krok-opys">
                          {k.typ === "vyklykTool" && k.argy && (
                            <pre className="krok-argy">{JSON.stringify(k.argy, null, 2)}</pre>
                          )}
                          {k.typ === "rezultatTool" && (
                            <pre className="krok-rezultat">{k.rezultat}</pre>
                          )}
                          {k.typ !== "vyklykTool" && k.typ !== "rezultatTool" && (
                            <p>{k.opys}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Фінальна відповідь */}
                <section className="blok resultat agent-vdpovisd">
                  <h2>✅ Готова відповідь</h2>
                  <div className="rag-tekst">{agentVidpovid.vdpovisd}</div>
                  <div className="agent-tools">
                    <span className="label">Використані інструменти:</span>
                    <div className="spysok-tegiv">
                      {agentVidpovid.toolVykorystano.map((t, i) => (
                        <span key={i} className="teg">{t}</span>
                      ))}
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        )}

        {/* ============ ВКЛАДКА 4: КАРТИНКИ + СТРІМ ============ */}
        {vkladka === "vision" && (
          <>
            {/* Завантаження картинки */}
            <section className="blok vision-blok">
              <h2>🎨 Завантажте картинку</h2>
              <p className="agent-info">AI опише що на ній зображено (vision / мультимодальність)</p>

              <label className="zavantazhennya-kartynky">
                <input type="file" accept="image/*" onChange={zavantazhytyKartynku} />
                {kartynka ? (
                  <img src={kartynka} alt="Завантажена" className="preview-kartynky" />
                ) : (
                  <div className="pole-zavantazhennya">📁 Натисніть або перетягніть картинку</div>
                )}
              </label>

              {kartynka && (
                <button
                  className="btn-analyz"
                  onClick={opysatyKartynkuFn}
                  disabled={visionOpysuye}
                >
                  {visionOpysuye ? "👁 Описую..." : "👁 Описати картинку"}
                </button>
              )}

              {visionPomylka && (
                <div className="pomylka-inline">❌ {visionPomylka}</div>
              )}

              {visionOpys && (
                <div className="vision-opys">
                  <h3>📖 Опис:</h3>
                  <p>{visionOpys}</p>
                </div>
              )}
            </section>

            {/* Стрімінг */}
            <section className="blok strim-blok">
              <h2>⚡ Стрімінг відповіді</h2>
              <p className="agent-info">Відповідь з'являється поступово, слово за словом (SSE)</p>

              <div className="rag-polye">
                <input
                  type="text"
                  value={strimZapyt}
                  onChange={(e) => setStrimZapyt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && strimyty()}
                  placeholder="Наприклад: Розкажи цікавий факт про космос"
                />
                <button
                  className="btn-analyz"
                  onClick={strimyty}
                  disabled={strimPratsyuye || strimZapyt.trim().length < 3}
                >
                  {strimPratsyuye ? "⚡ Друкується..." : "⚡ Запустити стрім"}
                </button>
              </div>

              <div className="prykaldy">
                <span>Приклади:</span>
                {PRYKLADY_ZAPYTIV_STRIM.map((p, i) => (
                  <button key={i} onClick={() => setStrimZapyt(p)} className="btn-pryklad">#{i + 1}</button>
                ))}
              </div>

              {strimPomylka && (
                <div className="pomylka-inline">❌ {strimPomylka}</div>
              )}

              {strimTekst && (
                <div className="strim-tekst">
                  {strimTekst}
                  {strimPratsyuye && <span className="kurсор">▊</span>}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
