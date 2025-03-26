document.getElementById('question-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('question-input');
    const question = input.value.trim();
    if (!question) return;
    
    appendMessage('user', question);
    input.value = '';
    
    try {
      const res = await fetch('/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question })
      });
      const data = await res.json();
      appendMessage('computer', data.reply);
    } catch (err) {
      appendMessage('computer', 'Error contacting server.');
    }
  });
  
  function appendMessage(sender, text) {
    const chat = document.getElementById('chat');
    const div = document.createElement('div');
    div.classList.add('message', sender);
    div.innerText = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }  