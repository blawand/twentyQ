const questionForm = document.getElementById('question-form');
const questionInput = document.getElementById('question-input');
const chat = document.getElementById('chat');
const modeButtons = document.querySelectorAll('.mode-button');
const questionCounter = document.getElementById('question-counter');

let gameStarted = false;
let selectedMode = 'medium';
let finalQuestionsUsed = null;
let finalResult = null;

// Handle shared links on page load
window.onload = function() {
  const params = new URLSearchParams(window.location.search);
  const sharedMode = params.get('mode');
  const outcome = params.get('outcome');
  const questionsUsed = params.get('questionsUsed');
  const date = params.get('date');
  if (sharedMode && outcome && questionsUsed && date) {
    alert(`Your friend guessed the ${sharedMode} puzzle in ${questionsUsed} questions on ${date}. Can you do better?`);
    selectedMode = sharedMode;
    modeButtons.forEach(button => {
      button.classList.remove('active');
      if (button.getAttribute('data-mode') === sharedMode) {
         button.classList.add('active');
      }
    });
  }
};

modeButtons.forEach(button => {
  button.addEventListener('click', () => {
    if (gameStarted) return;
    modeButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    selectedMode = button.getAttribute('data-mode');
  });
});

questionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;

  appendMessage('user', question);
  questionInput.value = '';

  if (!gameStarted) {
    gameStarted = true;
    modeButtons.forEach(button => {
      button.disabled = true;
      button.classList.add('disabled-mode');
    });
  }

  try {
    const res = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, mode: selectedMode })
    });
    const data = await res.json();
    appendMessage('computer', data.reply);
    questionCounter.innerText = `${data.questionsRemaining}/20 remaining`;

    // Check if game is over
    if (data.reply.includes("guessed it") || data.reply.includes("Game over")) {
      finalQuestionsUsed = 20 - data.questionsRemaining;
      finalResult = data.reply.includes("guessed it") ? "win" : "lose";
      // Reveal the score submission section
      document.getElementById('score-section').style.display = "block";
    }
  } catch {
    appendMessage('computer', 'Error contacting server.');
  }
});

function appendMessage(sender, text) {
  const div = document.createElement('div');
  div.classList.add('message', sender);
  div.innerText = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// Event listener for score submission
document.getElementById('submit-score').addEventListener('click', async () => {
  const playerName = document.getElementById('player-name').value.trim() || "Anonymous";
  const today = new Date().toISOString().split('T')[0];
  const scoreData = {
    name: playerName,
    date: today,
    mode: selectedMode,
    questionsUsed: finalQuestionsUsed,
    result: finalResult
  };

  try {
    const res = await fetch('/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scoreData)
    });
    const response = await res.json();
    if (response.success) {
      fetchLeaderboard();
      showShareLink(scoreData);
    }
  } catch (err) {
    console.error(err);
  }
});

async function fetchLeaderboard() {
  const today = new Date().toISOString().split('T')[0];
  try {
    const res = await fetch(`/leaderboard?date=${today}&mode=${selectedMode}`);
    const data = await res.json();
    renderLeaderboard(data);
  } catch (err) {
    console.error(err);
  }
}

function renderLeaderboard(data) {
  const leaderboardDiv = document.getElementById('leaderboard');
  leaderboardDiv.innerHTML = "";
  if (data.length === 0) {
    leaderboardDiv.innerHTML = "<p>No scores yet.</p>";
    return;
  }
  const table = document.createElement('table');
  const header = document.createElement('tr');
  header.innerHTML = "<th>Rank</th><th>Name</th><th>Questions Used</th><th>Result</th><th>Date</th>";
  table.appendChild(header);
  data.forEach((score, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${index + 1}</td><td>${score.name}</td><td>${score.questionsUsed}</td><td>${score.result}</td><td>${score.date}</td>`;
    table.appendChild(row);
  });
  leaderboardDiv.appendChild(table);
}

function showShareLink(scoreData) {
    const shareLink = `${window.location.origin}${window.location.pathname}?mode=${scoreData.mode}&outcome=${scoreData.result}&questionsUsed=${scoreData.questionsUsed}&date=${scoreData.date}`;
    const message = `I guessed the ${scoreData.mode} puzzle in ${scoreData.questionsUsed} questions on ${scoreData.date}. Can you beat me? 👉 ${shareLink}`;
    document.getElementById('share-link').value = message;
    document.getElementById('share-link-container').style.display = "block";
  }

document.getElementById('copy-link').addEventListener('click', () => {
  const shareInput = document.getElementById('share-link');
  shareInput.select();
  document.execCommand('copy');
  alert("Link copied to clipboard!");
});