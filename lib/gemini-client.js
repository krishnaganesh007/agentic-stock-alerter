// Simple Gemini API client for the extension
class GeminiClient {
    constructor(apiKey) {
      this.apiKey = apiKey;
      this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }
  
    async generateContent(prompt) {
      const response = await fetch(`${this.baseUrl}/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      });
  
      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }
  
      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    }
  }
  