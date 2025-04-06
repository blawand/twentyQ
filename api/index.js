require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit"); // Import rate-limit
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// --- Rate Limiting Configuration ---
app.set("trust proxy", 1); // Adjust based on your proxy setup if needed

const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs for /api/ask
  message: {
    error:
      "Too many requests to the ask endpoint from this IP, please try again after 15 minutes.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const scoreLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 score submissions per hour
  message: {
    error: "Too many score submissions from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const leaderboardLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // Limit each IP to 50 leaderboard requests per 5 minutes
  message: {
    error: "Too many leaderboard requests, please try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- End Rate Limiting Configuration ---

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
      model: "gemini-2.0-flash-lite",
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
    const answer = (answersData[date] && answersData[date][mode]) || "default";
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
    return "No specific context available.";
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
            "Vercel20QuestionsGame/1.1 (contact: your-email@example.com)",
        },
      }
    );
    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Wikipedia page not found for "${term}".`);
        return "No specific context available.";
      }
      console.warn(
        `Wikipedia API non-OK response for "${term}": ${response.status}`
      );
      return "Context retrieval failed.";
    }
    const data = await response.json();
    const summary = data && data.extract ? data.extract : "";
    console.log(`Fetched summary length: ${summary.length}`);
    return summary || "No summary extract found in Wikipedia response.";
  } catch (err) {
    console.error(`Error fetching wiki summary for "${term}":`, err.message);
    return "Error retrieving context.";
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
      // Check for explicit block reason
      if (response?.promptFeedback?.blockReason) {
        console.warn(
          `Gemini prompt blocked: ${response.promptFeedback.blockReason}`
        );
        return "Blocked";
      }
      console.warn(
        "Gemini did not return expected text function. Response:",
        JSON.stringify(response, null, 2) // Log the full response structure
      );
      return "Error";
    }
    const text = response.text().trim();
    if (!text) {
      console.warn("Gemini returned empty text.");
      const finishReason = response?.candidates?.[0]?.finishReason;
      if (finishReason === "SAFETY") return "Blocked";
      // Log if prompt feedback indicates a block
      if (response?.promptFeedback?.blockReason) {
        console.warn(
          `Gemini prompt blocked (empty text): ${response.promptFeedback.blockReason}`
        );
        return "Blocked";
      }
      return "Error";
    }
    return text;
  } catch (err) {
    console.error("Gemini API error:", err);
    if (err.message && err.message.includes("429")) {
      return "RateLimited";
    }
    if (
      err.message &&
      (err.message.includes("API key not valid") ||
        err.message.includes("Billing account"))
    ) {
      console.error("Critical Gemini API Error (Key/Billing):", err.message);
      return "ConfigError";
    }
    // General catch-all for other errors
    return "Error";
  }
}

app.use(bodyParser.json());

// Apply askLimiter specifically to the /api/ask route
app.post("/api/ask", askLimiter, async (req, res) => {
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

  if (gameState.gameOver) {
    return res.json({
      reply: `The game is over for ${mode} mode today. The answer was "${gameState.secretAnswer}". Refresh or wait until tomorrow.`,
      questionsRemaining: gameState.questionsRemaining,
      gameOver: true,
      result: gameState.result,
      questionsUsed: gameState.questionsUsed,
    });
  }
  if (gameState.questionsRemaining <= 0) {
    gameState.gameOver = true;
    gameState.result = "lose";
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
    return res.json({
      reply:
        "That doesn't look like a standard Yes/No question (e.g., 'Is it blue?', 'Does it swim?'). Please start with a verb like Is, Are, Does, Can, etc. Question not counted.",
      questionsRemaining: gameState.questionsRemaining,
      gameOver: false,
    });
  }

  if (gameState.secretSummary === "") {
    console.log(`Fetching summary for ${gameState.secretAnswer}`);
    gameState.secretSummary = await getOrFetchWikiSummary(
      gameState.secretAnswer
    );
    console.log(
      `Context for "${
        gameState.secretAnswer
      }": ${gameState.secretSummary.substring(0, 100)}...`
    );
  }

  const factContext = gameState.secretSummary;

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
  let normalizedAnswer = "No";
  let aiErrorOccurred = false;

  if (rawAnswer === "Error" || rawAnswer === "ConfigError") {
    console.error(`Gemini processing error: ${rawAnswer}`);
    aiErrorOccurred = true;
    return res.status(500).json({
      error:
        "Sorry, I encountered an internal problem answering. Please try asking again. Your question count was not affected.",
    });
  } else if (rawAnswer === "RateLimited") {
    console.warn(`Gemini rate limited.`);
    aiErrorOccurred = true;
    return res.status(429).json({
      error:
        "Sorry, the AI is busy right now. Please try asking again in a moment. Your question count was not affected.",
    });
  } else if (rawAnswer === "Blocked") {
    console.warn(`Gemini response blocked due to safety settings or prompt.`);
    aiErrorOccurred = true;
    return res.status(400).json({
      error:
        "Sorry, I cannot answer that question due to content restrictions or the nature of the question. Please ask something different. Your question count was not affected.",
    });
  } else if (rawAnswer.trim().toLowerCase().startsWith("yes")) {
    normalizedAnswer = "Yes";
  } else {
    normalizedAnswer = "No";
  }

  gameState.questionsRemaining--;
  gameState.questionsUsed = 20 - gameState.questionsRemaining;

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
    console.log(`Game ${getGameKey(today, mode)} won by guessing.`);
  } else if (gameState.questionsRemaining <= 0) {
    replyText = `${normalizedAnswer}. You've run out of questions! Game over. The answer was "${gameState.secretAnswer}".`;
    shouldEndGame = true;
    gameState.result = "lose";
    console.log(`Game ${getGameKey(today, mode)} lost (out of questions).`);
  }

  if (shouldEndGame) {
    gameState.gameOver = true;
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

// Apply scoreLimiter specifically to the /api/score route
app.post("/api/score", scoreLimiter, async (req, res) => {
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

// Apply leaderboardLimiter specifically to the /api/leaderboard route
app.get("/api/leaderboard", leaderboardLimiter, async (req, res) => {
  if (!supabase) {
    console.error("Leaderboard request failed: Supabase client not available.");
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
    console.log(`Fetching leaderboard for date=${date}, mode=${mode}`);
    const { data, error, status } = await supabase
      .from("scores_20q")
      .select("name, questions_used, result")
      .eq("date", date)
      .eq("mode", mode)
      .order("result", { ascending: true })
      .order("questions_used", { ascending: true })
      .limit(10);

    if (error) {
      console.error(
        `Supabase leaderboard fetch error (Status: ${status}):`,
        error
      );
      throw error;
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
    res.status(500).json([]);
  }
});

// Cleanup interval
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000; // Check more frequently? 1 hour?
  let deletedCount = 0;
  for (const key in gameInstances) {
    // Clean up if older than 1 hour OR if game is over
    if (
      now - gameInstances[key].createdAt > oneHour ||
      gameInstances[key].gameOver
    ) {
      // More aggressive cleanup of completed games
      console.log(`Cleaning up game state for key: ${key}`);
      delete gameInstances[key];
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    console.log(`Cleaned up ${deletedCount} old or finished game states.`);
  }
}, 15 * 60 * 1000); // Run cleanup check every 15 minutes

module.exports = app;
