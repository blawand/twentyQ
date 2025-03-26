const questionForm = document.getElementById('question-form');
const questionInput = document.getElementById('question-input');
const chat = document.getElementById('chat');
const modeButtons = document.querySelectorAll('.mode-button');
const questionCounter = document.getElementById('question-counter');

let gameStarted = false;
let selectedMode = 'medium';

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