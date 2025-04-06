require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const answersFilePath = path.join(__dirname, "..", "answers.json");
let answersData = {};
try {
  const rawData = fs.readFileSync(answersFilePath, "utf8");
  answersData = JSON.parse(rawData);
  console.log("Successfully loaded answers.json");
} catch (err) {
  console.error("FATAL ERROR: Could not read or parse answers.json:", err);
  answersData = {};
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase URL or Key missing from environment variables.");
  supabase = null;
} else {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Supabase client initialized successfully.");
  } catch (initError) {
    console.error("Failed to initialize Supabase client:", initError);
    supabase = null;
  }
}

let geminiModel;
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not found in environment variables.");
  geminiModel = null;
} else {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });
    console.log("Gemini AI client initialized successfully.");
  } catch (geminiError) {
    console.error("Failed to initialize Gemini AI client:", geminiError);
    geminiModel = null;
  }
}

let gameInstances = {};

function getGameKey(date, mode) {
  return `${date}-${mode}`;
}

function initializeGameState(date, mode) {
  const key = getGameKey(date, mode);
  if (!gameInstances[key] || gameInstances[key].gameOver) {
    // Re-initialize if game was over
    const answer = (answersData[date] && answersData[date][mode]) || "default";
    // Reset game state completely if game over or not found
    gameInstances[key] = {
      secretAnswer: answer,
      secretSummary: "",
      questionsRemaining: 20,
      gameOver: false,
      mode: mode,
      date: date,
      createdAt: Date.now(),
      result: null,
      questionsUsed: 0,
    };
    console.log(`Initialized/Reset game state for ${key}: Answer is ${answer}`);
  }
  return gameInstances[key];
}

async function getOrFetchWikiSummary(term) {
  if (!term || term.toLowerCase() === "default") {
    return "No specific context available."; // Handle default case explicitly
  }
  try {
    console.log(`Fetching Wikipedia summary for: ${term}`);
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        term
      )}`,
      {
        headers: {
          "User-Agent":
            "Vercel20QuestionsGame/1.1 (contact: your-email@example.com)", // Updated version
        },
      }
    );
    if (!response.ok) {
      // Handle specific errors like 404 Not Found
      if (response.status === 404) {
        console.warn(`Wikipedia page not found for "${term}".`);
        return "No specific context available.";
      }
      console.warn(
        `Wikipedia API non-OK response for "${term}": ${response.status}`
      );
      return "Context retrieval failed."; // Indicate failure
    }
    const data = await response.json();
    const summary = data && data.extract ? data.extract : "";
    console.log(`Fetched summary length: ${summary.length}`);
    return summary || "No summary extract found in Wikipedia response.";
  } catch (err) {
    console.error(`Error fetching wiki summary for "${term}":`, err.message);
    return "Error retrieving context."; // Indicate error
  }
}

async function getGeminiResponse(prompt) {
  if (!geminiModel) {
    console.error("Gemini model not initialized.");
    return "Error";
  }
  try {
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;

    if (!response || typeof response.text !== "function") {
      const finishReason = response?.candidates?.[0]?.finishReason;
      if (finishReason === "SAFETY") {
        console.warn("Gemini response blocked due to safety settings.");
        return "Blocked";
      }
      console.warn(
        "Gemini did not return expected text function. Response:",
        response
      );
      return "Error";
    }
    const text = response.text().trim();
    if (!text) {
      console.warn("Gemini returned empty text.");
      const finishReason = response?.candidates?.[0]?.finishReason;
      if (finishReason === "SAFETY") return "Blocked";
      // Sometimes empty text might mean "I don't know" based on prompt, treat as No? Or Error? Let's return Error for now.
      return "Error";
    }
    return text;
  } catch (err) {
    console.error("Gemini API error:", err);
    if (err.message && err.message.includes("429")) {
      return "RateLimited";
    }
    // Catch other potential API errors (e.g., billing issues, API key invalid)
    if (
      err.message &&
      (err.message.includes("API key not valid") ||
        err.message.includes("Billing account"))
    ) {
      console.error("Critical Gemini API Error (Key/Billing):", err.message);
      // Potentially disable Gemini for a while or return a specific error
      return "ConfigError";
    }
    return "Error";
  }
}

app.use(bodyParser.json());

app.post("/api/ask", async (req, res) => {
  const { question, mode } = req.body;
  const today = new Date().toISOString().split("T")[0];

  if (
    !question ||
    !mode ||
    !["easy", "medium", "difficult", "impossible"].includes(mode)
  ) {
    return res
      .status(400)
      .json({ error: "Missing or invalid question or mode." });
  }
  if (!geminiModel) {
    return res.status(503).json({
      error: "AI service is currently unavailable. Please try again later.",
    });
  }

  const gameState = initializeGameState(today, mode);

  // Check if game is already over *before* processing the question
  if (gameState.gameOver) {
    return res.json({
      reply: `The game is over for ${mode} mode today. The answer was "${gameState.secretAnswer}". Refresh or wait until tomorrow.`,
      questionsRemaining: gameState.questionsRemaining, // Should be 0 or less if over
      gameOver: true,
      result: gameState.result,
      questionsUsed: gameState.questionsUsed,
    });
  }
  // Double-check question limit before asking AI (belt and suspenders)
  if (gameState.questionsRemaining <= 0) {
    gameState.gameOver = true; // Ensure state is consistent
    gameState.result = "lose"; // Assume loss if somehow got here with 0 Qs
    gameState.questionsUsed = 20;
    console.warn(
      `Attempted to ask question with ${gameState.questionsRemaining} questions remaining. Force ending game.`
    );
    return res.json({
      reply: `You've run out of questions! Game over. The answer was "${gameState.secretAnswer}".`,
      questionsRemaining: 0,
      gameOver: true,
      result: "lose",
      questionsUsed: 20,
    });
  }

  const yesNoRegex =
    /^(is|are|am|do|does|did|can|could|should|would|will|have|has|had|may|might|shall|must)\s+.*\??\s*$/i;
  const trimmedQuestion = question.trim();

  if (!yesNoRegex.test(trimmedQuestion)) {
    // Don't decrement question count for invalid question format
    return res.json({
      reply:
        "That doesn't look like a standard Yes/No question (e.g., 'Is it blue?', 'Does it swim?'). Please start with a verb like Is, Are, Does, Can, etc. Question not counted.",
      questionsRemaining: gameState.questionsRemaining,
      gameOver: false,
    });
  }

  // Fetch summary only if it hasn't been fetched yet for this game instance
  if (gameState.secretSummary === "") {
    // Check if empty string (initial state)
    console.log(`Fetching summary for ${gameState.secretAnswer}`);
    gameState.secretSummary = await getOrFetchWikiSummary(
      gameState.secretAnswer
    );
    // Log the fetched summary (or lack thereof)
    console.log(
      `Context for "${
        gameState.secretAnswer
      }": ${gameState.secretSummary.substring(0, 100)}...`
    );
  }

  const factContext = gameState.secretSummary; // Use fetched summary directly

  // --- Improved Prompt ---
  const prompt = `
You are an AI assistant for a 20 Questions game.
The secret answer is: "${gameState.secretAnswer}"

Here is some context about the secret answer: ${factContext}

The user asks a Yes/No question. Follow these rules STRICTLY:
1. Prioritize answering based on the well-known, common understanding of the secret answer "${gameState.secretAnswer}".
2. Use the provided context *only* to supplement or clarify common knowledge, especially for specific details. Do not rely on context if it contradicts common knowledge about the item.
3. If you are uncertain based on common knowledge AND the context, lean towards "No". Do *not* guess or make assumptions.
4. Respond with *exactly* "Yes" or *exactly* "No". Do not add any explanations, apologies, or extra text.

User Question: ${trimmedQuestion}

Your Answer (Yes or No):`.trim();

  const rawAnswer = await getGeminiResponse(prompt);
  let normalizedAnswer = "No"; // Default to No, especially if AI is unsure or context is weak
  let aiErrorOccurred = false;

  // --- Handle Gemini Response ---
  if (rawAnswer === "Error" || rawAnswer === "ConfigError") {
    console.error(`Gemini processing error: ${rawAnswer}`);
    aiErrorOccurred = true;
    // Let user retry without penalty
    return res.status(500).json({
      error:
        "Sorry, I encountered an internal problem answering. Please try asking again. Your question count was not affected.",
    });
  } else if (rawAnswer === "RateLimited") {
    console.warn(`Gemini rate limited.`);
    aiErrorOccurred = true;
    // Let user retry without penalty
    return res.status(429).json({
      error:
        "Sorry, the AI is busy right now. Please try asking again in a moment. Your question count was not affected.",
    });
  } else if (rawAnswer === "Blocked") {
    console.warn(`Gemini response blocked due to safety settings.`);
    aiErrorOccurred = true;
    // Let user retry without penalty, maybe rephrase
    return res.status(400).json({
      error:
        "Sorry, I cannot answer that question due to content restrictions. Please ask something different. Your question count was not affected.",
    });
  } else if (rawAnswer.trim().toLowerCase().startsWith("yes")) {
    normalizedAnswer = "Yes";
  } else {
    normalizedAnswer = "No"; // Explicitly set to No if not Yes (catches slight variations if model adds punctuation)
  }

  // --- Decrement Count and Check Game Over ONLY if AI call was successful ---
  gameState.questionsRemaining--; // Decrement only after a valid Yes/No response
  gameState.questionsUsed = 20 - gameState.questionsRemaining; // Update questions used

  let replyText = normalizedAnswer;
  let shouldEndGame = false;

  // Check for Guess AFTER decrementing (so guess uses a question)
  const guessRegex = new RegExp(
    `\\b${gameState.secretAnswer.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`,
    "i"
  );
  if (guessRegex.test(question)) {
    replyText = `Yes! You guessed it! The answer is "${gameState.secretAnswer}".`;
    shouldEndGame = true;
    gameState.result = "win";
    console.log(`Game ${getGameKey(today, mode)} won by guessing.`);
  } else if (gameState.questionsRemaining <= 0) {
    // This condition is now met *after* the 20th question yields its Yes/No answer
    replyText = `${normalizedAnswer}. You've run out of questions! Game over. The answer was "${gameState.secretAnswer}".`;
    shouldEndGame = true;
    gameState.result = "lose";
    console.log(`Game ${getGameKey(today, mode)} lost (out of questions).`);
  }

  if (shouldEndGame) {
    gameState.gameOver = true;
    // questionsUsed already updated
  }

  console.log(
    `Q:${gameState.questionsUsed}/20 | User: "${trimmedQuestion}" | AI: ${normalizedAnswer} | Answer: "${gameState.secretAnswer}" | Remaining: ${gameState.questionsRemaining}`
  );

  res.json({
    reply: replyText,
    questionsRemaining: gameState.questionsRemaining,
    gameOver: gameState.gameOver,
    result: gameState.result,
    questionsUsed: gameState.questionsUsed,
  });
});

// --- Score and Leaderboard routes remain largely the same ---
// (Ensure they handle potential Supabase client unavailability)

app.post("/api/score", async (req, res) => {
  const { name, date, mode, questionsUsed, result } = req.body;
  const MAX_NAME_LENGTH = 30;
  const ALLOWED_MODES = ["easy", "medium", "difficult", "impossible"];
  const ALLOWED_RESULTS = ["win", "lose"];

  if (!supabase) {
    return res
      .status(503)
      .json({ success: false, message: "Database service unavailable." });
  }

  // --- Validation remains the same ---
  if (!name || !date || !mode || questionsUsed == null || !result) {
    console.warn("Score submission rejected: Invalid data", req.body);
    return res
      .status(400)
      .json({ success: false, message: "Invalid score data provided." });
  }
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > MAX_NAME_LENGTH
  ) {
    console.warn("Score submission rejected: Invalid name", req.body);
    return res.status(400).json({
      success: false,
      message: `Name must be between 1 and ${MAX_NAME_LENGTH} characters.`,
    });
  }
  if (!ALLOWED_MODES.includes(mode)) {
    console.warn("Score submission rejected: Invalid mode", req.body);
    return res
      .status(400)
      .json({ success: false, message: "Invalid game mode." });
  }
  // Allow questionsUsed to be 20 for losses, 1 to 20 for wins
  if (
    typeof questionsUsed !== "number" ||
    questionsUsed < 1 ||
    questionsUsed > 20
  ) {
    console.warn("Score submission rejected: Invalid questionsUsed", req.body);
    return res.status(400).json({
      success: false,
      message: "Invalid number of questions used (1-20).",
    });
  }
  if (!ALLOWED_RESULTS.includes(result)) {
    console.warn("Score submission rejected: Invalid result", req.body);
    return res
      .status(400)
      .json({ success: false, message: "Invalid result status." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.warn("Score submission rejected: Invalid date format", req.body);
    return res
      .status(400)
      .json({ success: false, message: "Invalid date format." });
  }

  const scoreData = {
    name: name.trim().substring(0, MAX_NAME_LENGTH),
    date,
    mode,
    questions_used: questionsUsed,
    result,
  };

  try {
    console.log("Attempting to insert score into Supabase:", scoreData);
    const { error } = await supabase.from("scores_20q").insert([scoreData]);

    if (error) {
      console.error("Supabase insert error:", error);
      throw error;
    }

    console.log("Score saved to Supabase successfully.");
    res.json({ success: true, message: "Score saved successfully!" });
  } catch (err) {
    console.error("Error saving score to Supabase:", err);
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Score conflict. Perhaps already submitted?",
      });
    }
    res
      .status(500)
      .json({ success: false, message: "Error saving score data." });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  if (!supabase) {
    console.error("Leaderboard request failed: Supabase client not available.");
    return res.status(503).json([]); // Return empty array and 503 status
  }

  const { date, mode } = req.query;
  const ALLOWED_MODES = ["easy", "medium", "difficult", "impossible"];

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.warn(
      `Leaderboard request rejected: Invalid or missing date format: ${date}`
    );
    return res.status(400).json([]);
  }
  if (!mode || !ALLOWED_MODES.includes(mode)) {
    console.warn(
      `Leaderboard request rejected: Invalid or missing mode: ${mode}`
    );
    return res.status(400).json([]);
  }

  try {
    console.log(`Fetching leaderboard for date=${date}, mode=${mode}`);
    const { data, error, status } = await supabase
      .from("scores_20q")
      .select("name, questions_used, result")
      .eq("date", date)
      .eq("mode", mode)
      .order("result", { ascending: true }) // 'win' comes before 'lose'
      .order("questions_used", { ascending: true })
      .limit(10); // Limit to top 10

    if (error) {
      console.error(
        `Supabase leaderboard fetch error (Status: ${status}):`,
        error
      );
      throw error; // Throw error to be caught by catch block
    }

    console.log(
      `Successfully fetched ${data ? data.length : 0} scores for leaderboard.`
    );

    const formattedScores = data.map((score) => ({
      name: score.name,
      questionsUsed: score.questions_used,
      result: score.result,
    }));

    res.json(formattedScores);
  } catch (err) {
    console.error("Error fetching leaderboard from Supabase:", err.message);
    // Return 500 for server-side errors during fetch
    res.status(500).json([]);
  }
});

// --- Cleanup interval remains the same ---
setInterval(() => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  for (const key in gameInstances) {
    // Also cleanup instances where the game ended but wasn't cleared for some reason
    if (
      now - gameInstances[key].createdAt > oneDay ||
      gameInstances[key].gameOver
    ) {
      console.log(`Cleaning up game state for key: ${key}`);
      delete gameInstances[key];
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    console.log(`Cleaned up ${deletedCount} old or finished game states.`);
  }
}, 6 * 60 * 60 * 1000); // Run every 6 hours

module.exports = app; // Export the app for Vercel
