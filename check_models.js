const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const models = await genAI.listModels();
    console.log("Available Models:");
    models.models.forEach(m => console.log(`- ${m.name}`));
  } catch (err) {
    console.error("Error listing models:", err.message);
  }
}

listModels();
