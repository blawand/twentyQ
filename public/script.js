const questionForm = document.getElementById('question-form');
const questionInput = document.getElementById('question-input');
const chat = document.getElementById('chat');
const modeSelector = document.getElementById('mode-selector');

let gameStarted = false;

questionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;

  // Append user's question to chat
  appendMessage('user', question);
  questionInput.value = '';

  // On the first question, capture and then lock the mode selection.
  let mode = modeSelector.value;
  if (!gameStarted) {
    gameStarted = true;
    modeSelector.disabled = true;
  }

  try {
    // Send question (and mode) to server
    const res = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, mode })
    });
    const data = await res.json();
    // Append the computer's reply
    appendMessage('computer', data.reply);
  } catch (err) {
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