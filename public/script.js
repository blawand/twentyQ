document.addEventListener('DOMContentLoaded', () => { // Ensure DOM is loaded

  // --- DOM Elements ---
  const questionForm = document.getElementById('question-form');
  const questionInput = document.getElementById('question-input');
  const sendButton = questionForm.querySelector('button');
  const chat = document.getElementById('chat');
  const modeButtons = document.querySelectorAll('.mode-button');
  const questionCounter = document.getElementById('question-counter');
  const postGameSection = document.getElementById('post-game-section');
  const scoreSubmissionForm = document.getElementById('score-submission');
  const playerNameInput = document.getElementById('player-name');
  const submitScoreButton = document.getElementById('submit-score-button');
  const shareLinkContainer = document.getElementById('share-link-container');
  const shareLinkInput = document.getElementById('share-link-input');
  const copyLinkButton = document.getElementById('copy-link-button');
  const leaderboardDiv = document.getElementById('leaderboard');
  const leaderboardModeSpan = document.getElementById('leaderboard-mode'); // Reference to the span in the h2
  const spinner = document.createElement('div'); // Create spinner element
  spinner.className = 'spinner';
  spinner.innerHTML = '<span></span><span></span><span></span>';

  // --- Game State ---
  let gameStarted = false;
  let selectedMode = 'medium'; // Default mode
  let isGameOver = false;
  let finalQuestionsUsed = null;
  let finalResult = null; // 'win' or 'lose'
  let currentInteraction = false; // Flag to prevent multiple submissions

  // --- Initial Setup ---
  function initializeGame() {
      appendMessage('computer', "Welcome! Choose a difficulty, then I'll think of something. Ask me Yes/No questions. You have 20 tries!");
      handleUrlParams(); // Check for shared link parameters
      updateModeButtons(); // Set initial active button and heading
      // Don't reset game state here, let mode selection or first question handle it
      setFormEnabled(true); // Ensure form is enabled initially
      setModeButtonsEnabled(true); // Enable mode buttons initially
  }

  function startGame() {
      gameStarted = true;
      isGameOver = false;
      finalQuestionsUsed = null;
      finalResult = null;
      currentInteraction = false;
      questionCounter.innerText = `20/20 remaining`;
      questionInput.value = '';
      chat.innerHTML = ''; // Clear previous messages only when starting
      appendMessage('computer', `Okay, I'm thinking of something for the ${selectedMode} mode... Ask your first Yes/No question!`);
      setFormEnabled(true);
      setModeButtonsEnabled(false); // Disable mode selection once game starts
      postGameSection.style.display = 'none';
      shareLinkContainer.style.display = 'none';
      submitScoreButton.disabled = false; // Re-enable submit button if previously disabled
      submitScoreButton.textContent = 'Submit Score'; // Ensure button text is reset
      scoreSubmissionForm.style.display = 'block';
      leaderboardDiv.innerHTML = ''; // Clear leaderboard
      updateLeaderboardHeading(); // Update heading for the selected mode
  }


  // --- UI Update Functions ---
  function appendMessage(sender, text, type = 'normal') {
      const div = document.createElement('div');
      div.classList.add('message', sender);
      if(type === 'error') {
          div.classList.add('error');
      }
      div.textContent = text; // Use textContent to prevent XSS
      chat.appendChild(div);
      // Scroll to bottom
      chat.scrollTop = chat.scrollHeight;
  }

  function showSpinner() {
      chat.appendChild(spinner);
      spinner.style.display = 'block';
      chat.scrollTop = chat.scrollHeight;
  }

  function hideSpinner() {
      // Check if spinner is still a child before removing (prevents errors if removed quickly)
      if (spinner.parentNode === chat) {
          chat.removeChild(spinner);
      }
      spinner.style.display = 'none';
  }

  function setFormEnabled(enabled) {
      questionInput.disabled = !enabled;
      sendButton.disabled = !enabled;
      currentInteraction = !enabled; // Track if we are waiting for a response
  }

   function setModeButtonsEnabled(enabled) {
      modeButtons.forEach(button => {
          button.disabled = !enabled;
          if (!enabled) {
               button.classList.add('disabled-mode'); // Optional class for styling disabled state during game
           } else {
               button.classList.remove('disabled-mode');
           }
           // Ensure ARIA checked state reflects visual state
           button.setAttribute('aria-checked', button.classList.contains('active').toString());
      });
  }

  function updateQuestionCounter(remaining) {
      // Ensure remaining doesn't go below 0 in display
      const displayRemaining = Math.max(0, remaining);
      questionCounter.innerText = `${displayRemaining}/20 remaining`;
  }

  function updateModeButtons() {
      modeButtons.forEach(button => {
          const isActive = button.getAttribute('data-mode') === selectedMode;
          button.classList.toggle('active', isActive);
          button.setAttribute('aria-checked', isActive.toString());
      });
      // Enable/disable based on game state
      setModeButtonsEnabled(!gameStarted && !isGameOver);
      updateLeaderboardHeading(); // Update heading whenever mode changes pre-game or loads
  }

  // Update the text content of the leaderboard mode span
  function updateLeaderboardHeading() {
      if (leaderboardModeSpan) {
           // Capitalize first letter for display
          const modeText = selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1);
          leaderboardModeSpan.textContent = modeText;
      }
  }

  // --- Event Handlers ---

  // Mode Selection
  modeButtons.forEach(button => {
      button.addEventListener('click', () => {
          // Only allow mode change if the game hasn't started and isn't over
          if (gameStarted || isGameOver) return;
          selectedMode = button.getAttribute('data-mode');
          updateModeButtons(); // Updates visual state and ARIA attributes
          console.log(`Mode selected: ${selectedMode}`);
          // Game start is triggered by the first question submission, not mode selection itself
      });
  });

  // Question Submission
  questionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Prevent submission if waiting for response or game is over
      if (currentInteraction || isGameOver) return;

      const question = questionInput.value.trim();
      if (!question) return; // Ignore empty input

      // Start the game on the *first* valid question submission for the current session/page load
      if (!gameStarted) {
          startGame(); // Initializes game state, clears chat for the new game, disables modes etc.
      }

      appendMessage('user', question);
      questionInput.value = '';
      setFormEnabled(false); // Disable form while processing
      showSpinner();

      try {
          const response = await fetch('/ask', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ question, mode: selectedMode })
          });

          hideSpinner(); // Hide spinner regardless of outcome

          if (!response.ok) {
              // Try to parse error JSON from server, provide fallback message
               const errorData = await response.json().catch(() => ({ error: 'Unknown server error. Please check server logs.' }));
               throw new Error(errorData.error || `Server communication error (${response.status})`);
          }

          const data = await response.json();

          // Check for server-side error property in the response JSON itself
           if (data.error) {
              throw new Error(data.error);
           }

          appendMessage('computer', data.reply);
          updateQuestionCounter(data.questionsRemaining);

          if (data.gameOver) {
              isGameOver = true;
              finalQuestionsUsed = data.questionsUsed;
              finalResult = data.result; // Should be 'win' or 'lose' from server
              setFormEnabled(false); // Keep form disabled after game ends
              setModeButtonsEnabled(false); // Keep modes disabled
              revealPostGameSection();
          } else {
               setFormEnabled(true); // Re-enable form for next question
               questionInput.focus(); // Focus input for convenience
          }

      } catch (error) {
          console.error("Ask endpoint error:", error);
          hideSpinner(); // Ensure spinner is hidden on error too
          appendMessage('computer', `Error: ${error.message || 'Could not get an answer. Please try again.'}`, 'error');
          // Only re-enable the form if the game isn't over.
          // If an error occurs on the last question, the game might be over implicitly.
          if (!isGameOver) {
              setFormEnabled(true);
          }
      }
  });

  questionInput.addEventListener('focus', () => {
      setTimeout(() => {
          // Ensure chat element exists and scrollHeight is accessible
          if (chat) {
             chat.scrollTop = chat.scrollHeight;
          }
      }, 150); // Increased delay slightly for potentially slower mobile rendering
  });

  // Score Submission
  submitScoreButton.addEventListener('click', async () => {
      // Ensure game is over and results are available
      if (!isGameOver || finalResult === null || finalQuestionsUsed === null) {
          console.error("Cannot submit score: Game result not finalized or missing data.");
          // Optionally provide user feedback here
          // appendMessage('computer', 'Cannot submit score yet.', 'error');
          return;
      }

      const playerName = playerNameInput.value.trim() || "Anonymous"; // Default to Anonymous
      const today = new Date().toISOString().split('T')[0]; // Get date in YYYY-MM-DD format

      submitScoreButton.disabled = true; // Prevent double submission
      submitScoreButton.textContent = 'Submitting...'; // Provide feedback

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
          const responseData = await res.json(); // Assume server sends back JSON

          if (res.ok && responseData.success) {
              console.log("Score submitted successfully:", responseData.message);
              fetchAndRenderLeaderboard(today, selectedMode); // Refresh leaderboard for current view
              showShareLink(scoreData); // Show the share section
              scoreSubmissionForm.style.display = 'none'; // Hide the submission form on success
              // No alert needed, hiding form and showing share is enough feedback
              // Optionally change button text permanently on success? (Button is hidden anyway now)
              // submitScoreButton.textContent = 'Score Submitted!';
          } else {
              // Handle server-side validation errors or other issues
              throw new Error(responseData.message || "Failed to submit score. Please try again.");
          }
      } catch (err) {
          console.error("Score submission error:", err);
          alert(`Score submission failed: ${err.message}`); // Show specific error to user
          submitScoreButton.disabled = false; // Re-enable button on failure
          submitScoreButton.textContent = 'Submit Score'; // Reset button text
      }
  });

  // Copy Share Link
  copyLinkButton.addEventListener('click', () => {
      shareLinkInput.select(); // Select the text field's content
      let message = "Could not copy. Please copy manually."; // Default error message
      let success = false;

      try {
          // Use modern Clipboard API first
           if (navigator.clipboard && navigator.clipboard.writeText) {
               navigator.clipboard.writeText(shareLinkInput.value).then(() => {
                   copyLinkButton.textContent = 'Copied!'; // Provide visual feedback
                   setTimeout(() => copyLinkButton.textContent = 'Copy Share Message', 2000); // Reset after 2 seconds
               }).catch(clipboardErr => {
                   console.warn("Async clipboard API failed:", clipboardErr);
                   // Fallback to execCommand if async fails
                   if (!document.execCommand('copy')) {
                      throw new Error("Fallback copy command failed");
                   }
                   copyLinkButton.textContent = 'Copied!';
                   setTimeout(() => copyLinkButton.textContent = 'Copy Share Message', 2000);
               });
           } else if (document.execCommand('copy')) { // Fallback for older browsers or non-secure contexts
              success = true;
              message = "Share message copied to clipboard!";
              copyLinkButton.textContent = 'Copied!';
              setTimeout(() => copyLinkButton.textContent = 'Copy Share Message', 2000);
           } else {
               throw new Error("Copy command not supported or failed");
           }
      } catch (err) {
          console.error('Copy link failed:', err);
          alert(message); // Show error message using alert as a fallback notification
      }
  });


  // --- Helper Functions ---

  // Handle URL parameters on page load
  function handleUrlParams() {
      const params = new URLSearchParams(window.location.search);
      const sharedMode = params.get('mode');
      const outcome = params.get('outcome'); // 'win' or 'lose'
      const questions = params.get('questionsUsed');
      const date = params.get('date');

      if (sharedMode && outcome && questions && date) {
          const outcomeText = outcome === 'win' ? 'won' : 'lost';
          // Use template literal for cleaner message construction
          const message = `Looks like someone shared a result with you!\nThey played on ${date} (${sharedMode} mode) and ${outcomeText} using ${questions} questions.\nThink you can do better? The ${sharedMode} mode is selected for you. Good luck!`;

          // Display the message in the chat area for less disruption than an alert
          appendMessage('computer', message);

          // Validate and set the game mode based on the shared link
          if (['easy', 'medium', 'difficult', 'impossible'].includes(sharedMode)) {
               selectedMode = sharedMode;
               // updateModeButtons(); // Called in initializeGame which runs after this
          }

           // Clean the URL to prevent the message reappearing on refresh
          window.history.replaceState({}, document.title, window.location.pathname);
      }
  }

  function revealPostGameSection() {
      postGameSection.style.display = 'block'; // Make the section visible
      const today = new Date().toISOString().split('T')[0];
      fetchAndRenderLeaderboard(today, selectedMode); // Load leaderboard for the completed game's mode
      updateLeaderboardHeading(); // Ensure heading matches the mode played

      // Scroll smoothly to the revealed section and focus the name input
      // Use setTimeout to allow the DOM to update before scrolling/focusing
      setTimeout(() => {
          postGameSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Only focus if the input is visible (i.e., score hasn't been submitted yet)
           if (scoreSubmissionForm.style.display !== 'none') {
              playerNameInput.focus();
           }
      }, 100); // Small delay seems to help reliability
  }

  async function fetchAndRenderLeaderboard(date, mode) {
      updateLeaderboardHeading(); // Ensure heading is up-to-date
      leaderboardDiv.innerHTML = '<p>Loading leaderboard...</p>'; // Show loading state
      try {
          // Construct query parameters safely
          const queryParams = new URLSearchParams({ date, mode }).toString();
          const res = await fetch(`/leaderboard?${queryParams}`);

          if (!res.ok) {
              // Provide more context in error message if possible
               const errorText = await res.text(); // Try to get error text from response body
              throw new Error(`Failed to fetch leaderboard (${res.status}): ${errorText || res.statusText}`);
          }

          const scores = await res.json(); // Parse the JSON response
          renderLeaderboard(scores); // Render the fetched scores

      } catch (err) {
          console.error("Leaderboard fetch error:", err);
          leaderboardDiv.innerHTML = `<p class="error" style="color: red; text-align: center;">Could not load leaderboard. Please try again later.</p>`; // Display error within leaderboard div
      }
  }

  function renderLeaderboard(scores) {
      leaderboardDiv.innerHTML = ""; // Clear previous content (like loading message or old table)

      if (!scores || scores.length === 0) {
          // Display a placeholder message if no scores are available
          leaderboardDiv.innerHTML = '<p id="leaderboard-placeholder">No scores recorded for this mode/date yet.</p>';
          return;
      }

      // Create table elements dynamically
      const table = document.createElement('table');
      table.id = 'leaderboard-table'; // Assign ID for styling
      const thead = table.createTHead();
      const headerRow = thead.insertRow();
      // Define table headers (use abbreviations for space saving if needed)
      headerRow.innerHTML = "<th>#</th><th>Name</th><th>Qs</th><th>Result</th>";

      const tbody = table.createTBody();
      // Iterate over scores and create table rows
      scores.forEach((score, index) => {
          const row = tbody.insertRow();
          // Use textContent for security and template literals for readability
          row.innerHTML = `
              <td>${index + 1}</td>
              <td>${score.name}</td>
              <td>${score.questionsUsed}</td>
              <td class="${score.result === 'win' ? 'result-win' : 'result-lose'}">${score.result === 'win' ? 'Win' : 'Loss'}</td>
          `;
          // Note: CSS classes .result-win and .result-lose add the icons
      });

      leaderboardDiv.appendChild(table); // Add the completed table to the DOM
  }

  function showShareLink(scoreData) {
      const { mode, result, questionsUsed, date } = scoreData;
      const outcomeText = result === 'win' ? 'guessed' : 'couldn\'t guess';
      // Construct the share URL with URLSearchParams for proper encoding
       const shareParams = new URLSearchParams({ mode, outcome: result, questionsUsed, date });
      const shareUrl = `${window.location.origin}${window.location.pathname}?${shareParams.toString()}`;

      // Craft the share message
      const shareMessage = `I played 20 Questions (${mode}, ${date}) and ${outcomeText} the answer using ${questionsUsed} questions! Can you beat my score? 🤔 Play here: ${shareUrl}`;

      shareLinkInput.value = shareMessage; // Set the input value
      shareLinkContainer.style.display = 'block'; // Show the share container

      // Scroll the share container into view smoothly after a short delay
      setTimeout(() => {
           shareLinkContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
  }

  // --- Run Initialization ---
  initializeGame(); // Set up the game when the DOM is ready

});