require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const answersData = require('./answers.json');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
const port = 3000;

let secretAnswer, selectedMode, questionsRemaining = 20, gameOver = false;

function getDailyWord(mode) {
  const today = new Date().toISOString().split('T')[0];
  return (answersData[today] && answersData[today][mode]) || "default";
}

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  if (gameOver) return res.json({ reply: 'Game over — refresh to play again.' });

  if (!selectedMode) {
    selectedMode = mode || 'medium';
    secretAnswer = getDailyWord(selectedMode);
  }

  const prompt = `
You are playing 20 Questions. The secret answer is "${secretAnswer}" (hidden from user).
If the input is NOT a yes/no question, respond exactly with INVALID. Otherwise respond with "Yes" or "No".
Question: ${question}`.trim();

  const answer = (await getGeminiResponse(prompt)).toUpperCase();
  if (answer === 'INVALID') {
    return res.json({ reply: "That wasn't a yes/no question.", questionsRemaining });
  }

  questionsRemaining--;
  if (question.toLowerCase().includes(secretAnswer.toLowerCase())) {
    gameOver = true;
    return res.json({ reply: `Yes — you guessed it! The answer is "${secretAnswer}".`, questionsRemaining });
  }

  let reply = answer;
  if (questionsRemaining <= 0) {
    gameOver = true;
    reply += ` You've run out of questions! Game over. The answer was "${secretAnswer}".`;
  } else {
    reply += ` You have ${questionsRemaining} question${questionsRemaining === 1 ? '' : 's'} remaining.`;
  }

  res.json({ reply, questionsRemaining });
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));