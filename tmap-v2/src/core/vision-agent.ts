// Vision Agent — image analysis, OCR, object recognition, scene understanding.
// When no actual image is provided, provides expert guidance on image-related tasks.

import type { LLMCall } from '../types.js';

export interface VisionAnalysis {
  description: string;
  subjects: string[];
  environment: string;
  lighting: string;
  cameraAngle: string;
  colorPalette: string[];
  mood: string;
  composition: string;
  technicalDetails: string;
  suggestedPrompt?: string; // for image generation follow-up
}

export interface ImagePromptSpec {
  subject: string;
  style: string;
  lighting: string;
  composition: string;
  colorGrading: string;
  resolution: string;
  qualityModifiers: string[];
  negativePrompt: string;
  fullPrompt: string;
}

const VISION_ANALYSIS_SYS = `You are the Vision Agent in Co.AI — an expert image analyst and visual director.

When analyzing images or generating image specifications:
1. Extract: subject, environment, lighting, camera angle, color palette, mood, composition
2. Identify technical photography/art details
3. Generate professional internal prompts for AI image generation

When creating image generation prompts, build structured specifications:
- Subject with precise details (age, appearance, clothing, pose)
- Environment and setting
- Lighting type (golden hour, studio, natural, cinematic)
- Camera simulation (85mm lens, f/1.8, shallow depth of field)
- Photography/art style (hyperrealistic, oil painting, anime, etc.)
- Color grading and mood
- Resolution and quality (8K, photorealistic, ultra-detailed)
- Negative elements to exclude

Output structured JSON when asked for image specs.`;

const IMAGE_PROMPT_SYS = `You are an expert AI image prompt engineer.
Create a professional, detailed image generation prompt from the user's description.

Output a JSON object with these fields:
{
  "subject": "detailed subject description",
  "style": "photorealistic|oil painting|anime|digital art|watercolor|etc",
  "lighting": "lighting description",
  "composition": "composition and framing",
  "colorGrading": "color treatment and mood",
  "resolution": "resolution spec",
  "qualityModifiers": ["array", "of", "quality", "tags"],
  "negativePrompt": "elements to avoid",
  "fullPrompt": "complete ready-to-use prompt string"
}`;

export async function analyzeImageContext(
  call: LLMCall,
  description: string,
): Promise<VisionAnalysis> {
  const raw = await call([
    { role: 'system', content: VISION_ANALYSIS_SYS },
    {
      role: 'user',
      content: `Analyze this image/scene and extract visual elements:\n${description}`,
    },
  ], { temperature: 0.3, maxTokens: 1500 });

  return {
    description: raw,
    subjects: extractList(raw, /subject[s]?[:：]\s*([^\n]+)/i),
    environment: extractField(raw, /environment[:：]\s*([^\n]+)/i),
    lighting: extractField(raw, /lighting[:：]\s*([^\n]+)/i),
    cameraAngle: extractField(raw, /camera\s*angle[:：]\s*([^\n]+)/i),
    colorPalette: extractList(raw, /color\s*palette[:：]\s*([^\n]+)/i),
    mood: extractField(raw, /mood[:：]\s*([^\n]+)/i),
    composition: extractField(raw, /composition[:：]\s*([^\n]+)/i),
    technicalDetails: extractField(raw, /technical[:：]\s*([^\n]+)/i),
  };
}

export async function generateImagePrompt(
  call: LLMCall,
  description: string,
): Promise<ImagePromptSpec> {
  const raw = await call([
    { role: 'system', content: IMAGE_PROMPT_SYS },
    { role: 'user', content: `Create an image generation prompt for:\n${description}` },
  ], { temperature: 0.4, maxTokens: 1000 });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<ImagePromptSpec>;
      return {
        subject: parsed.subject ?? description,
        style: parsed.style ?? 'photorealistic',
        lighting: parsed.lighting ?? 'natural light',
        composition: parsed.composition ?? 'centered',
        colorGrading: parsed.colorGrading ?? 'neutral',
        resolution: parsed.resolution ?? '8K, ultra-detailed',
        qualityModifiers: Array.isArray(parsed.qualityModifiers) ? parsed.qualityModifiers : ['high quality', 'detailed'],
        negativePrompt: parsed.negativePrompt ?? 'blurry, low quality, distorted',
        fullPrompt: parsed.fullPrompt ?? raw,
      };
    }
  } catch { /* fall through */ }

  return {
    subject: description,
    style: 'photorealistic',
    lighting: 'natural light',
    composition: 'rule of thirds',
    colorGrading: 'cinematic',
    resolution: '8K ultra-detailed',
    qualityModifiers: ['photorealistic', 'professional', 'high detail'],
    negativePrompt: 'blurry, low quality, distorted, watermark',
    fullPrompt: raw.trim(),
  };
}

function extractField(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[1]?.trim() ?? '';
}

function extractList(text: string, pattern: RegExp): string[] {
  const match = text.match(pattern)?.[1];
  if (!match) return [];
  return match.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}
