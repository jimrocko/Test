// Sticker recognition: sends the cut-out to Claude and gets back a
// Pokédex-style entry. The API key is entered by the user and only stored
// in this browser (localStorage).
import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 (beste Qualität)",
  "claude-haiku-5-5": "Claude Haiku 5.5 (schneller & günstiger)",
};

export const RARITIES = ["gewöhnlich", "selten", "episch", "legendär"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "beschreibung", "kategorie", "seltenheit", "fun_fact"],
  properties: {
    name: { type: "string", description: "Kurzer, griffiger Name des Stickers (max. 4 Wörter)" },
    beschreibung: {
      type: "string",
      description: "2–3 Sätze im Stil eines Pokédex-Eintrags: was zu sehen ist, verspielt formuliert",
    },
    kategorie: {
      type: "string",
      description: "z. B. Marke, Band, Verein, Figur, Tier, Spruch, Stadt, Kunst, Sonstiges",
    },
    seltenheit: {
      type: "string",
      enum: RARITIES,
      description: "Geschätzt: Massenware/Werbung = gewöhnlich, Limitiert/ungewöhnlich = selten oder höher",
    },
    fun_fact: { type: "string", description: "Ein kurzer, wahrer Fun Fact zum Motiv oder zur Marke" },
  },
};

const SYSTEM = `Du bist der Stickerdex – wie ein Pokédex, aber für echte Sticker, die jemand mit der Handykamera gesammelt hat.
Du bekommst ein freigestelltes Foto eines Stickers. Erkenne Motiv, Text, Logo, Marke, Band oder Figur, falls möglich.
Antworte auf Deutsch, kurz, freundlich und ein bisschen verspielt. Erfinde keine Fakten: wenn du etwas nicht sicher erkennst, beschreibe einfach, was zu sehen ist.`;

export const settings = {
  get apiKey() {
    return localStorage.getItem("stickerdex.apiKey") ?? "";
  },
  set apiKey(v) {
    v ? localStorage.setItem("stickerdex.apiKey", v) : localStorage.removeItem("stickerdex.apiKey");
  },
  get model() {
    const m = localStorage.getItem("stickerdex.model");
    return m && m in MODELS ? m : "claude-opus-5-5";
  },
  set model(v) {
    localStorage.setItem("stickerdex.model", v);
  },
};

/** Downscales the cut-out and returns base64 PNG data (without data: prefix). */
function toBase64Png(canvas, max = 768) {
  const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}

export async function describeSticker(canvas) {
  const apiKey = settings.apiKey;
  if (!apiKey) throw new Error("Kein API-Schlüssel hinterlegt (⚙︎ im Dex).");

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const model = settings.model;
  // Server-side refusal fallback is available on Opus, not on Haiku.
  const fallback = model === "claude-opus-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};

  const response = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    ...fallback,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: toBase64Png(canvas) } },
          { type: "text", text: "Erstelle den Stickerdex-Eintrag für diesen Sticker." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Die KI wollte diesen Sticker nicht beschreiben.");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Keine Antwort von der KI erhalten.");
  const entry = JSON.parse(text);
  if (!RARITIES.includes(entry.seltenheit)) entry.seltenheit = "gewöhnlich";
  return entry;
}

export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API-Schlüssel ungültig – bitte im Dex unter ⚙︎ prüfen.";
  if (err instanceof Anthropic.RateLimitError) return "Zu viele Anfragen – gleich nochmal versuchen.";
  if (err instanceof Anthropic.APIConnectionError) return "Keine Verbindung – Beschreibung später nachladen.";
  if (err instanceof Anthropic.APIError) return `KI-Fehler (${err.status ?? "?"}): ${err.message}`;
  return err?.message ?? String(err);
}
