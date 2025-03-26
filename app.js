require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

const app = express();
const port = 3000;

// --- Daily Secret Answer Setup ---
// You can store a mapping of dates to words. For demonstration, we use an object.
const dailyWords = {
  "2025-03-26": "apple",
  "2025-03-27": "banana",
  // add more dates and words as needed
};

// Returns the secret word for today (format: YYYY-MM-DD)
function getDailyWord() {
  const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
  // Fallback to a default word if today's date isn’t in the mapping
  return dailyWords[today] || "default";
}

// Game state (for simplicity, a single session game per server start)
const secretAnswer = getDailyWord();
let questionsRemaining = 20;
let gameOver = false;

// --- Middleware ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper: Check if a question is yes/no ---
function isYesNoQuestion(question) {
  // Simple heuristic: must end with a '?' and start with a typical yes/no keyword.
  const yesNoStarters = [
    'is', 'are', 'do', 'does', 'did', 'was', 'were', 'can', 'could', 'would', 'will', 'have', 'has', 'had'
  ];
  if (!question.trim().endsWith('?')) {
    return false;
  }
  const firstWord = question.trim().split(' ')[0].toLowerCase();
  return yesNoStarters.includes(firstWord);
}

// --- Helper: Call Gemini API to generate a yes/no answer ---
// Adjust the endpoint, request structure, and parsing as needed per Gemini 2.0 Flash-Lite documentation.
async function getGeminiResponse(question, secretAnswer) {
  // Create a prompt for Gemini that instructs it to answer with a simple "Yes" or "No"
  const prompt = `You are playing a game of 20 Questions. The secret answer for today is hidden. 
Answer the following yes/no question based on the secret answer "${secretAnswer}" with only "Yes" or "No": 
Question: ${question}`;
  
  try {
    const response = await axios.post(
      'https://api.gemini.com/v2/flash-lite',
      { prompt },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    // Assume the API responds with a JSON object containing an "answer" property
    return response.data.answer;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    // Fallback answer in case of an error
    return "No";
  }
}

// --- API Endpoint: /ask ---
app.post('/ask', async (req, res) => {
  const { question } = req.body;
  let reply = '';

  if (gameOver) {
    return res.json({ reply: 'The game is over. Please refresh the page to play again.' });
  }

  // Check if it qualifies as a yes/no question
  if (!isYesNoQuestion(question)) {
    reply = "That wasn't a yes or no question. Please ask a yes or no question.";
    return res.json({ reply, questionsRemaining });
  }

  // Valid yes/no question so decrement the counter.
  questionsRemaining--;

  // Check if the user’s question is a guess (contains the secret answer)
  if (question.toLowerCase().includes(secretAnswer.toLowerCase())) {
    reply = `Yes, you guessed it! The answer is indeed "${secretAnswer}".`;
    gameOver = true;
    return res.json({ reply, questionsRemaining });
  }

  // Otherwise, use Gemini API to get an answer
  const geminiAnswer = await getGeminiResponse(question, secretAnswer);
  reply = geminiAnswer;

  // If the user is out of questions, end the game.
  if (questionsRemaining <= 0) {
    reply += ` You've run out of questions! Game over. The answer was "${secretAnswer}".`;
    gameOver = true;
  } else {
    reply += ` You have ${questionsRemaining} question${questionsRemaining === 1 ? '' : 's'} remaining.`;
  }

  res.json({ reply, questionsRemaining });
});

app.listen(port, () => {
  console.log(`20 Questions game listening at http://localhost:${port}`);
});