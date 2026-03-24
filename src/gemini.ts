import { GoogleGenAI, Modality, Type, ThinkingLevel } from "@google/genai";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function askMiniGPT(prompt: string, model: string = "gemini-3-flash-preview", config: any = {}) {
  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        systemInstruction: `You are MiniGPT, a friendly AI assistant. 
- Provide clear and helpful answers.
- You can provide code snippets in any programming language when requested.
- You support multiple languages and can translate or answer in different languages.
- Use simple language that anyone can understand, except when providing technical code.
- If asked about complex topics, give a good summary. 
- Never provide harmful, offensive, or unsafe content. 
- When unsure, say "I don’t know" instead of guessing.`,
        ...config
      },
    });

    if (response.candidates?.[0]?.finishReason === 'SAFETY') {
      return "I'm sorry, but I can't fulfill this request because it was flagged by safety filters. Please try asking something else.";
    }

    if (!response.text) {
      return "I'm sorry, I couldn't generate a response. The model returned an empty result.";
    }

    return response.text;
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message?.includes("401")) return "Authentication error: The API key is invalid or missing.";
    if (error.message?.includes("429")) return "Rate limit exceeded: Please wait a moment.";
    if (error.message?.includes("500") || error.message?.includes("503")) return "Service error: The AI service is currently unavailable.";
    return `An unexpected error occurred: ${error.message || "Please try again later."}`;
  }
}

export async function generateImage(prompt: string, config: { aspectRatio?: string, imageSize?: string } = {}) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: { parts: [{ text: prompt }] },
      config: {
        imageConfig: {
          aspectRatio: config.aspectRatio || "1:1",
          imageSize: config.imageSize || "1K"
        }
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image Generation Error:", error);
    throw error;
  }
}

export async function generateVideo(prompt: string, config: { aspectRatio?: string, resolution?: string } = {}) {
  try {
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      config: {
        numberOfVideos: 1,
        resolution: (config.resolution as any) || '720p',
        aspectRatio: (config.aspectRatio as any) || '16:9'
      }
    });

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) return null;

    const response = await fetch(downloadLink, {
      method: 'GET',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    });
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("Video Generation Error:", error);
    throw error;
  }
}

export async function textToSpeech(text: string, voice: string = 'Kore') {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say cheerfully: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return `data:audio/pcm;base64,${base64Audio}`;
    }
    return null;
  } catch (error) {
    console.error("TTS Error:", error);
    throw error;
  }
}

export async function analyzeMultimodal(prompt: string, fileData: { data: string, mimeType: string }) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [
          { inlineData: fileData },
          { text: prompt }
        ]
      },
    });
    return response.text;
  } catch (error) {
    console.error("Multimodal Analysis Error:", error);
    throw error;
  }
}

export async function generateChatTitle(userMessage: string, botResponse: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: `Generate a very short, descriptive title (max 5 words) for a chat conversation that started with:
User: "${userMessage}"
AI: "${botResponse}"
Return only the title text, no quotes or extra words.`,
    });
    return response.text?.trim() || userMessage.slice(0, 30);
  } catch (error) {
    console.error("Title Generation Error:", error);
    return userMessage.slice(0, 30);
  }
}
