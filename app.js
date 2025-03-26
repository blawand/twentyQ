require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const answersData = require('./answers.json');

const app = express();
const port = 3000;

function getDailyWord() {
  return answersData[new Date().toISOString().split('T')[0]] || "default";
}

let secretAnswer = getDailyWord();
let questionsRemaining = 20;
let gameOver = false;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

async function getGeminiResponse(prompt) {
  try {
    const { data } = await axios.post(
      'https://api.gemini.com/v2/flash-lite',
      { prompt },
      { headers: { Authorization: `Bearer ${process.env.GEMINI_API_KEY}` } }
    );
    return (data.answer || "").trim();
  } catch (err) {
    console.error('Gemini error:', err.message);
    return "No";
  }
}

app.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (gameOver) {
    return res.json({ reply: 'The game is over. Refresh to play again.' });
  }

  const prompt = `
You are playing 20 Questions. The secret answer (hidden from the user) is "${secretAnswer}".
If the user's input is NOT a yes/no question, respond exactly with INVALID.
Otherwise respond exactly with "Yes" or "No".
Question: ${question}`.trim();

  const geminiOutput = (await getGeminiResponse(prompt)).toUpperCase();

  if (geminiOutput === 'INVALID') {
    return res.json({ reply: "That wasn't a yes or no question. Please ask a yes or no question.", questionsRemaining });
  }

  questionsRemaining--;

  if (question.toLowerCase().includes(secretAnswer.toLowerCase())) {
    gameOver = true;
    return res.json({ reply: `Yes — you guessed it! The answer is "${secretAnswer}".`, questionsRemaining });
  }

  let reply = geminiOutput;
  if (questionsRemaining <= 0) {
    gameOver = true;
    reply += ` You've run out of questions! Game over. The answer was "${secretAnswer}".`;
  } else {
    reply += ` You have ${questionsRemaining} question${questionsRemaining === 1 ? '' : 's'} remaining.`;
  }

  res.json({ reply, questionsRemaining });
});

app.listen(port, () => {
  console.log(`20 Questions running at http://localhost:${port}`);
});