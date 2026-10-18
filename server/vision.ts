import { GoogleGenerativeAI } from "@google/generative-ai";

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
// 1. ОПИС КАРТИНКИ (vision)
// ============================================================

export async function opysatyKartynku(
  base64: string,
  mime: string,
  zapyt?: string
): Promise<string> {
  const model = otrymatyGenAI().getGenerativeModel({
    model: "gemini-3.8-flash",
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  });

  const prompt =
    zapyt && zapyt.trim().length >= 3
      ? `${zapyt.trim()}\n(Відповідай українською мовою по суті запиту; якщо запит не стосується картинки — все одно коротко опиши, що на ній.)`
      : `Опиши цю картинку українською мовою. Бути конкретним:
- Що зображено (об'єкти, люди, місце)?
- Який колір/настрій?
- Цікаві деталі?
Відповідай стисло, 3-5 речень.`;

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: mime,
        data: base64,
      },
    },
    {
      text: prompt,
    },
  ]);

  return result.response.text();
}

// ============================================================
// 2. СТРІМІНГ ВІДПОВІДІ (текст з'являється поступово)
// ============================================================

/**
 * Генерує відповідь зі стрімінгом.
 * Викликає onChunk для кожного шматка тексту.
 */
export async function strimityVidpovid(
  zapyt: string,
  onChunk: (tekst: string) => void
): Promise<string> {
  const model = otrymatyGenAI().getGenerativeModel({
    model: "gemini-3.8-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  });

  const result = await model.generateContentStream(zapyt);

  let vsiaVidpovid = "";
  for await (const chunk of result.stream) {
    const tekst = chunk.text();
    if (tekst) {
      vsiaVidpovid += tekst;
      onChunk(tekst);
    }
  }

  return vsiaVidpovid;
}

// ============================================================
// 3. СТРІМІНГ З КАРТИНКОЮ
// ============================================================

export async function strimityZKartynkoyu(
  base64: string,
  mime: string,
  zapyt: string,
  onChunk: (tekst: string) => void
): Promise<string> {
  const model = otrymatyGenAI().getGenerativeModel({
    model: "gemini-3.8-flash",
    generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
  });

  const result = await model.generateContentStream([
    {
      inlineData: {
        mimeType: mime,
        data: base64,
      },
    },
    { text: zapyt },
  ]);

  let vsiaVidpovid = "";
  for await (const chunk of result.stream) {
    const tekst = chunk.text();
    if (tekst) {
      vsiaVidpovid += tekst;
      onChunk(tekst);
    }
  }

  return vsiaVidpovid;
}
