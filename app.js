require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const answersData = require('./answers.json');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
const port = 3000;

let secretAnswer, selectedMode, questionsRemaining = 20, gameOver = false;
let secretSummary = '';

function getDailyWord(mode) {
  const today = new Date().toISOString().split('T')[0];
  return (answersData[today] && answersData[today][mode]) || "default";
}

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure scores.json exists
const scoresFile = path.join(__dirname, 'scores.json');
if (!fs.existsSync(scoresFile)) {
  fs.writeFileSync(scoresFile, JSON.stringify([]));
}

// Retrieve Wikipedia summary for a given term.
async function getWikiSummary(term) {
  try {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`);
    if (!response.ok) {
      return '';
    }
    const data = await response.json();
    return data.extract || '';
  } catch (err) {
    console.error(`Error fetching wiki summary for "${term}":`, err.message);
    return '';
  }
}

async function getGeminiResponse(prompt) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      contents: prompt
    });
    return response.text.trim();
  } catch (err) {
    console.error('Gemini error:', err.message);
    return "No";
  }
}

app.post('/ask', async (req, res) => {
  const { question, mode } = req.body;
  if (gameOver) return res.json({ reply: 'Game over — refresh to play again.', questionsRemaining });

  // Regex check for yes/no question format
  const yesNoRegex = /^(is|are|am|do|does|did|can|could|should|would|will|have|has|had|may|might|shall|must)\b.*\?*$/i;
  if (!yesNoRegex.test(question.trim())) {
    return res.json({ reply: "That wasn't a yes/no question.", questionsRemaining });
  }

  if (!selectedMode) {
    selectedMode = mode || 'medium';
    secretAnswer = getDailyWord(selectedMode);
    secretSummary = await getWikiSummary(secretAnswer);
  }

  const factContext = secretSummary || "No additional factual context is available.";
  const prompt = `
You are playing 20 Questions. The secret answer is "${secretAnswer}".
Factual description: ${factContext}
When asked a yes/no question about the answer, think through the facts in your head and answer with exactly "Yes" or "No" only.
Question: ${question.trim()}
  `.trim();

  const raw = await getGeminiResponse(prompt);
  const normalized = raw.trim().toLowerCase();
  const answer = normalized === 'yes' ? 'Yes' : 'No';

  questionsRemaining--;
  if (question.toLowerCase().includes(secretAnswer.toLowerCase())) {
    gameOver = true;
    return res.json({ reply: `Yes — you guessed it! The answer is "${secretAnswer}".`, questionsRemaining });
  }

  let reply = answer;
  if (questionsRemaining <= 0) {
    gameOver = true;
    reply += ` You've run out of questions! Game over. The answer was "${secretAnswer}".`;
  }

  res.json({ reply, questionsRemaining });
});

app.post('/score', (req, res) => {
  const { name, date, mode, questionsUsed, result } = req.body;
  if (!name || !date || !mode || questionsUsed == null || !result) {
    return res.status(400).json({ success: false, message: 'Invalid data.' });
  }
  let scores = JSON.parse(fs.readFileSync(scoresFile));
  const scoreData = { name, date, mode, questionsUsed, result, timestamp: new Date().toISOString() };
  scores.push(scoreData);
  fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 2));
  res.json({ success: true });
});

app.get('/leaderboard', (req, res) => {
  let scores = JSON.parse(fs.readFileSync(scoresFile));
  const { date, mode } = req.query;
  if (date) {
    scores = scores.filter(score => score.date === date);
  }
  if (mode) {
    scores = scores.filter(score => score.mode === mode);
  }
  // Sort by questionsUsed ascending (fewer questions is better)
  scores.sort((a, b) => a.questionsUsed - b.questionsUsed);
  scores = scores.slice(0, 10);
  res.json(scores);
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));