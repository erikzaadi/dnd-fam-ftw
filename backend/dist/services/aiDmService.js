import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
export class AiDmService {
    static SYSTEM_PROMPT = `
You are a thrilling and slightly edgy fantasy DM.
The game has real stakes. Failure should feel dangerous and narration should reflect the HP loss.
Keep narration short (2–4 sentences).
Always return exactly 3 suggested actions.
Each action MUST include:
- label: Short text of the choice
- difficulty: one of ["easy", "normal", "hard"]
- stat: one of ["might", "magic", "mischief"]

Tone: Thrilling, adventurous, slightly dark but still accessible.
Do NOT invent or modify game state (HP, stats).
Respect backend-provided outcomes.

Image Strategy:
- Suggest image (imageSuggested: true) ONLY for:
  - new scenes
  - major events
  - very funny/dramatic moments
- Otherwise set imageSuggested: false

Inventory:
- If players find an item, provide a structured object for suggestedInventoryAdd:
  { "name": "string", "description": "string" }
- Otherwise set suggestedInventoryAdd: null.
- Descriptions should be flavorful but brief.

Return your response in STRICT JSON format:
{
  "narration": "string",
  "choices": [
    { "label": "string", "difficulty": "string", "stat": "string" },
    { "label": "string", "difficulty": "string", "stat": "string" },
    { "label": "string", "difficulty": "string", "stat": "string" }
  ],
  "imagePrompt": "string | null",
  "imageSuggested": boolean,
  "suggestedInventoryAdd": { "name": "string", "description": "string" } | null
}
`;
    static async generateTurnResult(input) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: this.SYSTEM_PROMPT },
                    { role: "user", content: JSON.stringify(input) },
                ],
                response_format: { type: "json_object" },
            });
            const content = response.choices[0].message.content;
            if (!content) {
                throw new Error("AI returned empty content");
            }
            return JSON.parse(content);
        }
        catch (error) {
            console.error("Error calling AI service:", error);
            return {
                narration: "The magic in the air flickers, and for a moment, the world feels uncertain. But you must press on!",
                choices: [
                    { label: "Try that again", difficulty: 'normal', stat: 'mischief' },
                    { label: "Try something else", difficulty: 'normal', stat: 'magic' },
                    { label: "Look around", difficulty: 'easy', stat: 'might' }
                ],
                imagePrompt: null,
                imageSuggested: false,
                suggestedInventoryAdd: null
            };
        }
    }
}
