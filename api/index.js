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
      model: "gemini-1.5-flash-latest",
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
  if (!gameInstances[key]) {
    const answer = (answersData[date] && answersData[date][mode]) || "default";
    gameInstances[key] = {
      secretAnswer: answer,
      secretSummary: "",
      questionsRemaining: 20,
      gameOver: false,
      mode: mode,
      date: date,
      createdAt: Date.now(),
    };
    console.log(`Initialized game state for ${key}: Answer is ${answer}`);
  }
  return gameInstances[key];
}

async function getOrFetchWikiSummary(term) {
  try {
    const response = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        term
      )}`,
      {
        headers: {
          "User-Agent":
            "Vercel20QuestionsGame/1.0 (contact: your-email@example.com)",
        },
      }
    );
    if (!response.ok) {
      console.warn(
        `Wikipedia API non-OK response for "${term}": ${response.status}`
      );
      return "";
    }
    const data = await response.json();
    return data && data.extract ? data.extract : "";
  } catch (err) {
    console.error(`Error fetching wiki summary for "${term}":`, err.message);
    return "";
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
      return "Error";
    }
    return text;
  } catch (err) {
    console.error("Gemini API error:", err);
    if (err.message && err.message.includes("429")) {
      return "RateLimited";
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
    return res
      .status(503)
      .json({
        error: "AI service is currently unavailable. Please try again later.",
      });
  }

  const gameState = initializeGameState(today, mode);

  if (gameState.gameOver) {
    return res.json({
      reply: `Game over for ${mode} mode today! The answer was "${gameState.secretAnswer}". Refresh to play a different mode or wait until tomorrow.`,
      questionsRemaining: gameState.questionsRemaining,
      gameOver: true,
    });
  }

  const yesNoRegex =
    /^(is|are|am|do|does|did|can|could|should|would|will|have|has|had|may|might|shall|must)\s+.*\??\s*$/i;
  const trimmedQuestion = question.trim();

  if (!yesNoRegex.test(trimmedQuestion)) {
    return res.json({
      reply:
        "That doesn't look like a standard Yes/No question (e.g., 'Is it blue?', 'Does it swim?'). Please start with a verb like Is, Are, Does, Can, etc.",
      questionsRemaining: gameState.questionsRemaining,
      gameOver: false,
    });
  }

  if (!gameState.secretSummary) {
    console.log(`Fetching summary for ${gameState.secretAnswer}`);
    gameState.secretSummary = await getOrFetchWikiSummary(
      gameState.secretAnswer
    );
    if (!gameState.secretSummary) {
      console.warn(
        `Could not get summary for ${gameState.secretAnswer}. Proceeding without it.`
      );
    }
  }

  const factContext =
    gameState.secretSummary || "No specific factual context is available.";

  const prompt = `
You are an AI for a 20 Questions game. The secret answer is "${
    gameState.secretAnswer
  }".
Here is some factual context about the secret answer: ${factContext}

The user will ask a Yes/No question. Analyze the question based *only* on the secret answer and the provided context.
Respond with *exactly* "Yes" or *exactly* "No". Do not add any other words, explanations, or punctuation.

User Question: ${question.trim()}

Your Answer (Yes or No):`.trim();

  const rawAnswer = await getGeminiResponse(prompt);
  let normalizedAnswer = "No";

  if (
    rawAnswer === "Error" ||
    rawAnswer === "RateLimited" ||
    rawAnswer === "Blocked"
  ) {
    console.error(`Gemini issue: ${rawAnswer}`);
    const userMessage =
      rawAnswer === "RateLimited"
        ? "Sorry, I'm a bit overloaded right now. Please try again in a moment."
        : "Sorry, I encountered a problem processing that. Please try a different question.";
    return res.status(500).json({ error: userMessage });
  } else if (rawAnswer.trim().toLowerCase().startsWith("yes")) {
    normalizedAnswer = "Yes";
  }

  gameState.questionsRemaining--;
  let replyText = normalizedAnswer;
  let shouldEndGame = false;

  const guessRegex = new RegExp(
    `\\b${gameState.secretAnswer.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`,
    "i"
  );
  if (guessRegex.test(question)) {
    replyText = `Yes! You guessed it! The answer is "${gameState.secretAnswer}".`;
    shouldEndGame = true;
    gameState.result = "win";
  } else if (gameState.questionsRemaining <= 0) {
    replyText = `${normalizedAnswer}. You've run out of questions! Game over. The answer was "${gameState.secretAnswer}".`;
    shouldEndGame = true;
    gameState.result = "lose";
  }

  if (shouldEndGame) {
    gameState.gameOver = true;
    gameState.questionsUsed = 20 - gameState.questionsRemaining;
  }

  res.json({
    reply: replyText,
    questionsRemaining: gameState.questionsRemaining,
    gameOver: gameState.gameOver,
    result: gameState.result,
    questionsUsed: gameState.questionsUsed,
  });
});

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
    return res
      .status(400)
      .json({
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
  if (
    typeof questionsUsed !== "number" ||
    questionsUsed < 1 ||
    questionsUsed > 20
  ) {
    console.warn("Score submission rejected: Invalid questionsUsed", req.body);
    return res
      .status(400)
      .json({ success: false, message: "Invalid number of questions used." });
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
    const { error } = await supabase.from("scores_20q").insert([scoreData]);

    if (error) {
      console.error("Supabase insert error:", error);
      throw error;
    }

    console.log("Score saved to Supabase:", scoreData);
    res.json({ success: true, message: "Score saved successfully!" });
  } catch (err) {
    console.error("Error saving score to Supabase:", err);
    // Check for specific Supabase errors if needed, e.g., unique constraint violation
    if (err.code === "23505") {
      // Example for unique constraint
      return res
        .status(409)
        .json({
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
    return res.status(503).json([]);
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
    const { data, error } = await supabase
      .from("scores_20q")
      .select("name, questions_used, result")
      .eq("date", date)
      .eq("mode", mode)
      .order("result", { ascending: true }) // 'win' comes before 'lose'
      .order("questions_used", { ascending: true })
      .limit(10);

    if (error) {
      console.error("Supabase leaderboard fetch error:", error);
      throw error;
    }

    // Map Supabase column names to frontend expected names if needed
    const formattedScores = data.map((score) => ({
      name: score.name,
      questionsUsed: score.questions_used, // Adjust field name
      result: score.result,
    }));

    res.json(formattedScores);
  } catch (err) {
    console.error("Error fetching leaderboard from Supabase:", err);
    res.status(500).json([]);
  }
});

setInterval(() => {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  for (const key in gameInstances) {
    if (now - gameInstances[key].createdAt > oneDay) {
      delete gameInstances[key];
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    console.log(`Cleaned up ${deletedCount} old game states.`);
  }
}, 6 * 60 * 60 * 1000);

module.exports = app;
