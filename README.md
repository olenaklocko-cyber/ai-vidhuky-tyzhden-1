# 🧠 AI-аналітик відгуків — Тиждень 1

**Рівень 6: Вайбкодинг — промпт-інженерія та формат відповіді**

## Що робить

Вставляєш текст відгуку про подорож/готель → AI повертає **строгий JSON**:
- тональність (позитивна/негативна/нейтральна/змішана)
- оцінка від 1 до 5
- теми та емоції
- чи рекомендує автор
- чи коректна мова

Приклад відповіді:
```json
{
  "tonalnist": "позитивна",
  "ocinka": 5,
  "temy": ["чистота", "сніданок", "персонал"],
  "emocii": ["задоволення", "радість"],
  "rekomendatsiya": true,
  "korektna_mova": true
}
```

## Що вивчаємо (Тиждень 1)

| Концепція | Де в коді |
|---|---|
| **Системний промпт** (роль + правила) | `server/server.ts` → `SYSTEMNYI_PROMPT` |
| **Few-shot приклади** | `server/server.ts` → `PRYKLADY` |
| **JSON-схема** (Zod) | `server/server.ts` → `AnalizVidhuku` |
| **Температура** (точність vs творчість) | `generationConfig.temperature: 0.1` |
| **Обробка помилок** (невалідний JSON) | `server/server.ts` → `provalyuvaty()` + retry |

## Запуск

```bash
# Встановити залежності
npm install

# Потрібен server/.env з LLM_API_KEY (Google Gemini)

# Запустити все (сервер + фронтенд)
npm run dev:all

# Або окремо:
npm run server   # http://localhost:3001
npm run dev      # http://localhost:5173
```

## Стек

- **Frontend:** React + Vite + TypeScript
- **Backend:** Express + Zod
- **AI:** Google Gemini 2.0 Flash
- **Temperature:** 0.1 (мінімум творчості — нам потрібен стабільний JSON)
