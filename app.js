require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai'); // Updated import
const answersData = require('./answers.json');

// --- Gemini AI Setup ---
// Ensure you have GEMINI_API_KEY in your .env file
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY not found in .env file.");
  process.exit(1); // Exit if the key is missing
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest", // Use the latest flash model
    // --- Safety Settings ---
    // Adjust these as needed, but blocking harmful content is generally good.
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
});
// --- End Gemini AI Setup ---


const app = express();
const port = process.env.PORT || 3000; // Use environment port or default to 3000

// --- Game State (Consider session management for multi-user scenarios later) ---
let gameInstances = {}; // Simple in-memory store for game states per "session" (using date+mode for now)

function getGameKey(date, mode) {
    return `${date}-${mode}`;
}

function initializeGameState(date, mode) {
    const key = getGameKey(date, mode);
    if (!gameInstances[key]) {
        const answer = (answersData[date] && answersData[date][mode]) || "default";
        gameInstances[key] = {
            secretAnswer: answer,
            secretSummary: '', // Will be fetched on first relevant request
            questionsRemaining: 20,
            gameOver: false,
            mode: mode,
            date: date,
            // Add a timestamp for potential cleanup of old states later
            createdAt: Date.now(),
        };
        console.log(`Initialized game state for ${key}: Answer is ${answer}`);
    }
    return gameInstances[key];
}

async function getOrFetchWikiSummary(term) {
    // Basic caching could be added here if needed, but summaries are fetched per game instance now
    try {
        // Add a User-Agent as required by Wikimedia API guidelines
        const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`, {
            headers: {
                'User-Agent': '20QuestionsGame/1.0 (https://your-game-url.com; your-email@example.com)' // Replace with your info
            }
        });
        if (!response.ok) {
            console.warn(`Wikipedia API non-OK response for "${term}": ${response.status}`);
            return ''; // Return empty string on failure
        }
        const data = await response.json();
        // Ensure we only return the extract text
        return (data && data.extract) ? data.extract : '';
    } catch (err) {
        console.error(`Error fetching wiki summary for "${term}":`, err.message);
        return ''; // Return empty string on error
    }
}

async function getGeminiResponse(prompt) {
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        // Check for blocked content due to safety settings
        if (!response || !response.text) {
             // Check if the finishReason indicates safety blocking
            const finishReason = response?.candidates?.[0]?.finishReason;
             if (finishReason === 'SAFETY') {
                console.warn('Gemini response blocked due to safety settings.');
                return "Blocked"; // Specific indicator for blocked content
             }
             // Handle other potential issues like no text returned
             console.warn('Gemini did not return text. Response:', response);
             return "Error"; // Generic error if no text for other reasons
        }
        return response.text().trim(); // Use text() method for v1.5+
    } catch (err) {
        // Log the specific error from the Gemini API
        console.error('Gemini API error:', err.message);
        if (err.message.includes('429')) {
             return "RateLimited"; // Specific indicator for rate limiting
        }
        // Add more specific error handling if needed (e.g., authentication issues)
        return "Error"; // Generic error for other exceptions
    }
}

// --- Middleware ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public'

// --- File Setup ---
const scoresFile = path.join(__dirname, 'scores.json');
if (!fs.existsSync(scoresFile)) {
    fs.writeFileSync(scoresFile, JSON.stringify([]));
    console.log(`Created scores file at ${scoresFile}`);
}

// --- Routes ---

app.post('/ask', async (req, res) => {
    const { question, mode } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (!question || !mode) {
        return res.status(400).json({ error: "Missing question or mode." });
    }

    // --- Get or Initialize Game State ---
    const gameState = initializeGameState(today, mode);

    if (gameState.gameOver) {
        return res.json({
            reply: `Game over for ${mode} mode today! The answer was "${gameState.secretAnswer}". Refresh to play a different mode or wait until tomorrow.`,
            questionsRemaining: gameState.questionsRemaining,
            gameOver: true
        });
    }

    // --- Basic Yes/No Question Validation ---
    // Slightly improved regex: requires a verb at the start, ends with '?', allows spaces before '?'
    const yesNoRegex = /^(is|are|am|do|does|did|can|could|should|would|will|have|has|had|may|might|shall|must)\s+.*\??\s*$/i;
    const trimmedQuestion = question.trim(); // Trim the question once

    if (!yesNoRegex.test(trimmedQuestion)) {
        return res.json({
            // Optional: Slightly adjust error message example if needed, though current one is still good practice.
            reply: "That doesn't look like a standard Yes/No question (e.g., 'Is it blue?', 'Does it swim?'). Please start with a verb like Is, Are, Does, Can, etc.",
            questionsRemaining: gameState.questionsRemaining,
            gameOver: false
        });
    }

    // --- Fetch Summary if not already fetched ---
    if (!gameState.secretSummary) {
        console.log(`Fetching summary for ${gameState.secretAnswer}`);
        gameState.secretSummary = await getOrFetchWikiSummary(gameState.secretAnswer);
        if (!gameState.secretSummary) {
            console.warn(`Could not get summary for ${gameState.secretAnswer}. Proceeding without it.`);
        }
    }

    const factContext = gameState.secretSummary || "No specific factual context is available.";

    // --- Refined Prompt ---
    const prompt = `
You are an AI for a 20 Questions game. The secret answer is "${gameState.secretAnswer}".
Here is some factual context about the secret answer: ${factContext}

The user will ask a Yes/No question. Analyze the question based *only* on the secret answer and the provided context.
Respond with *exactly* "Yes" or *exactly* "No". Do not add any other words, explanations, or punctuation.

User Question: ${question.trim()}

Your Answer (Yes or No):`.trim();

    const rawAnswer = await getGeminiResponse(prompt);
    let normalizedAnswer = "No"; // Default to No

    // --- Handle Gemini Response ---
    if (rawAnswer === "Error" || rawAnswer === "RateLimited" || rawAnswer === "Blocked") {
        // Send a generic error to the user, but log specifics on the server
        console.error(`Gemini issue: ${rawAnswer}`);
         return res.status(500).json({ error: "Sorry, I encountered a problem answering. Please try again." });
        // Or provide a specific non-committal answer:
        // return res.json({ reply: "I'm having trouble processing that right now.", questionsRemaining: gameState.questionsRemaining, gameOver: false });
    } else if (rawAnswer.trim().toLowerCase().startsWith('yes')) {
        normalizedAnswer = 'Yes';
    }
    // No need for an else if for "No", as it's the default unless explicitly "Yes"

    gameState.questionsRemaining--;
    let replyText = normalizedAnswer;
    let shouldEndGame = false;

    // --- Check for Guess in Question ---
    // Simple check if the secret answer appears as a whole word in the question (case-insensitive)
    const guessRegex = new RegExp(`\\b${gameState.secretAnswer.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i'); // Escape special chars
    if (guessRegex.test(question)) {
        replyText = `Yes! You guessed it! The answer is "${gameState.secretAnswer}".`;
        shouldEndGame = true;
        gameState.result = "win"; // Store result in state
    } else if (gameState.questionsRemaining <= 0) {
        replyText = `${normalizedAnswer}. You've run out of questions! Game over. The answer was "${gameState.secretAnswer}".`;
        shouldEndGame = true;
        gameState.result = "lose"; // Store result in state
    }

    if (shouldEndGame) {
        gameState.gameOver = true;
        gameState.questionsUsed = 20 - gameState.questionsRemaining; // Record questions used
    }

    res.json({
        reply: replyText,
        questionsRemaining: gameState.questionsRemaining,
        gameOver: gameState.gameOver,
        result: gameState.result, // Send result if game is over
        questionsUsed: gameState.questionsUsed // Send questions used if game is over
    });
});

app.post('/score', (req, res) => {
    const { name, date, mode, questionsUsed, result } = req.body;

    // --- Validate Input ---
    if (!name || !date || !mode || questionsUsed == null || !result) {
        console.warn("Score submission rejected: Invalid data", req.body);
        return res.status(400).json({ success: false, message: 'Invalid score data provided.' });
    }
    if (typeof questionsUsed !== 'number' || questionsUsed < 1 || questionsUsed > 20) {
        console.warn("Score submission rejected: Invalid questionsUsed", req.body);
        return res.status(400).json({ success: false, message: 'Invalid number of questions used.' });
    }
    if (result !== 'win' && result !== 'lose') {
        console.warn("Score submission rejected: Invalid result", req.body);
        return res.status(400).json({ success: false, message: 'Invalid result status.' });
    }
     // Optional: Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.warn("Score submission rejected: Invalid date format", req.body);
        return res.status(400).json({ success: false, message: 'Invalid date format.' });
    }

    let scores = [];
    try {
        scores = JSON.parse(fs.readFileSync(scoresFile));
        if (!Array.isArray(scores)) { // Ensure it's an array
             console.error("scores.json is not an array. Resetting.");
             scores = [];
         }
    } catch (err) {
        console.error("Error reading or parsing scores.json:", err);
        // Decide action: either return error or reset scores
        return res.status(500).json({ success: false, message: 'Error accessing score data.' });
        // Or reset: scores = []; console.log("scores.json was corrupted, resetting.");
    }

    const scoreData = {
        name: name.substring(0, 30), // Limit name length
        date,
        mode,
        questionsUsed,
        result,
        timestamp: new Date().toISOString()
    };

    scores.push(scoreData);

    try {
        fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 2)); // Pretty print JSON
        console.log("Score saved:", scoreData);
        res.json({ success: true, message: "Score saved successfully!" });
    } catch (err) {
        console.error("Error writing scores.json:", err);
        res.status(500).json({ success: false, message: 'Error saving score data.' });
    }
});

app.get('/leaderboard', (req, res) => {
    let scores = [];
    try {
        scores = JSON.parse(fs.readFileSync(scoresFile));
         if (!Array.isArray(scores)) { // Ensure it's an array
             console.error("scores.json is not an array. Sending empty leaderboard.");
             scores = [];
         }
    } catch (err) {
        console.error("Error reading or parsing scores.json for leaderboard:", err);
        // Send empty array on error, or could send 500 status
        return res.json([]);
    }

    const { date, mode } = req.query;

    // --- Filtering ---
    let filteredScores = scores;
    if (date) {
        // Basic validation for date format query param
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            filteredScores = filteredScores.filter(score => score.date === date);
        } else {
            console.warn(`Invalid date format in leaderboard query: ${date}`);
            // Optionally return an error or just ignore the filter
        }
    }
    if (mode) {
        // Optional: Validate mode if needed
        filteredScores = filteredScores.filter(score => score.mode === mode);
    }

    // --- Sorting ---
    // Sort primarily by result ('win' comes first), then by questionsUsed (ascending)
    filteredScores.sort((a, b) => {
        // Wins are better than losses
        if (a.result === 'win' && b.result === 'lose') return -1;
        if (a.result === 'lose' && b.result === 'win') return 1;
        // If results are the same, fewer questions are better
        return a.questionsUsed - b.questionsUsed;
    });

    // --- Limit Results ---
    const topScores = filteredScores.slice(0, 10); // Get top 10

    res.json(topScores);
});

// --- Basic root route ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start Server ---
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

// --- Add a simple cleanup mechanism for old game instances (optional) ---
setInterval(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    for (const key in gameInstances) {
        if (now - gameInstances[key].createdAt > oneDay) { // Clean up states older than 1 day
            delete gameInstances[key];
            deletedCount++;
        }
    }
    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} old game states.`);
    }
}, 6 * 60 * 60 * 1000); // Run cleanup every 6 hours