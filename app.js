const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3000;

// Game state variables (for a single-session game)
let secretAnswer = "apple";
let questionsRemaining = 20;
let gameOver = false;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to check if a question is yes/no
function isYesNoQuestion(question) {
  // A simple heuristic:
  // Must end with a question mark and start with one of these keywords.
  const yesNoStarters = ['is', 'are', 'do', 'does', 'did', 'was', 'were', 'can', 'could', 'would', 'will', 'have', 'has', 'had'];
  if (!question.trim().endsWith('?')) {
    return false;
  }
  const firstWord = question.trim().split(' ')[0].toLowerCase();
  return yesNoStarters.includes(firstWord);
}

app.post('/ask', (req, res) => {
  const { question } = req.body;
  let reply = '';

  if (gameOver) {
    return res.json({ reply: 'The game is over. Please refresh the page to play again.' });
  }

  // Check if it's a yes/no question
  if (!isYesNoQuestion(question)) {
    reply = "That wasn't a yes or no question. Please ask a yes or no question.";
    return res.json({ reply, questionsRemaining });
  }

  // It’s a valid yes/no question so decrement the count.
  questionsRemaining--;

  // Check if the question appears to be a guess (simple check: does the question contain the secret answer?)
  if (question.toLowerCase().includes(secretAnswer.toLowerCase())) {
    reply = `Yes, you guessed it! The answer is indeed "${secretAnswer}".`;
    gameOver = true;
    return res.json({ reply, questionsRemaining });
  }

  // For any other yes/no question, we can simply reply "No" (for example)
  reply = "No.";

  // Check if user has run out of questions
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