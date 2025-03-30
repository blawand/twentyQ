document.addEventListener('DOMContentLoaded', () => { // Ensure DOM is loaded

    // --- DOM Elements ---
    const questionForm = document.getElementById('question-form');
    const questionInput = document.getElementById('question-input');
    const sendButton = questionForm.querySelector('button');
    const chat = document.getElementById('chat'); // This is the main message container
    const modeButtons = document.querySelectorAll('.mode-button');
    const questionCounter = document.getElementById('question-counter');
    const postGameSection = document.getElementById('post-game-section'); // Container for post-game content
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
        // Ensure chat is visible and post-game is hidden initially
        chat.style.display = 'flex'; // Use 'flex' as defined in CSS
        postGameSection.style.display = 'none';
  
        appendMessage('computer', "Welcome! Choose a difficulty, then I'll think of something. Ask me Yes/No questions. You have 20 tries!");
        handleUrlParams(); // Check for shared link parameters
        updateModeButtons(); // Set initial active button and heading
        setFormEnabled(true); // Ensure form is enabled initially
        setModeButtonsEnabled(true); // Enable mode buttons initially
        // Scroll chat down initially in case of welcome messages/shared links
        setTimeout(() => { if (chat) chat.scrollTop = chat.scrollHeight; }, 50);
    }
  
    // *** MODIFIED startGame Function ***
    function startGame() {
        gameStarted = true;
        isGameOver = false;
        finalQuestionsUsed = null;
        finalResult = null;
        currentInteraction = false;
        questionCounter.innerText = `20/20 remaining`;
        questionInput.value = '';
  
        // *** Hide post-game section and ensure chat message area is visible ***
        postGameSection.style.display = 'none';
        chat.style.display = 'flex'; // Make sure chat area is displayed as flex container
        chat.innerHTML = ''; // Clear previous messages from the chat area
  
        appendMessage('computer', `Okay, I'm thinking of something for the ${selectedMode} mode... Ask your first Yes/No question!`);
        setFormEnabled(true);
        setModeButtonsEnabled(false); // Disable mode selection once game starts
  
        // Reset post-game elements visibility within its container (if needed)
        shareLinkContainer.style.display = 'none'; // Hide share section until score is submitted
        submitScoreButton.disabled = false; // Re-enable submit button
        submitScoreButton.textContent = 'Submit Score'; // Reset button text
        scoreSubmissionForm.style.display = 'block'; // Show score submission form within post-game section
        leaderboardDiv.innerHTML = ''; // Clear leaderboard content
  
        updateLeaderboardHeading(); // Update heading for the selected mode
  
        // Scroll chat to bottom after adding the initial game message
        setTimeout(() => { if (chat) chat.scrollTop = chat.scrollHeight; }, 50);
    }
  
  
    // --- UI Update Functions ---
    function appendMessage(sender, text, type = 'normal') {
        const div = document.createElement('div');
        div.classList.add('message', sender);
        if(type === 'error') {
            div.classList.add('error');
        }
        div.textContent = text; // Use textContent to prevent XSS
        // Only append if chat is the currently active view
        if (chat.style.display !== 'none') {
            chat.appendChild(div);
            // Scroll chat area to bottom
            chat.scrollTop = chat.scrollHeight;
        } else {
            // Handle edge case? Maybe log if trying to append while chat is hidden
            console.warn("Attempted to append message while chat view is hidden.");
        }
    }
  
    function showSpinner() {
       // Only show if chat is visible
        if (chat.style.display !== 'none') {
          chat.appendChild(spinner);
          spinner.style.display = 'block'; // Use 'block' or 'flex' depending on spinner styling
          chat.scrollTop = chat.scrollHeight;
        }
    }
  
    function hideSpinner() {
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
                 button.classList.add('disabled-mode');
             } else {
                 button.classList.remove('disabled-mode');
             }
             button.setAttribute('aria-checked', button.classList.contains('active').toString());
        });
    }
  
    function updateQuestionCounter(remaining) {
        const displayRemaining = Math.max(0, remaining);
        questionCounter.innerText = `${displayRemaining}/20 remaining`;
    }
  
    function updateModeButtons() {
        modeButtons.forEach(button => {
            const isActive = button.getAttribute('data-mode') === selectedMode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-checked', isActive.toString());
        });
        setModeButtonsEnabled(!gameStarted && !isGameOver);
        updateLeaderboardHeading();
    }
  
    function updateLeaderboardHeading() {
        if (leaderboardModeSpan) {
            const modeText = selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1);
            leaderboardModeSpan.textContent = modeText;
        }
    }
  
    // --- Event Handlers ---
  
    modeButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (gameStarted || isGameOver) return;
            selectedMode = button.getAttribute('data-mode');
            updateModeButtons();
            console.log(`Mode selected: ${selectedMode}`);
        });
    });
  
    questionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (currentInteraction || isGameOver) return;
        const question = questionInput.value.trim();
        if (!question) return;
  
        if (!gameStarted) {
            startGame(); // Initializes game state, shows chat, hides post-game, etc.
        }
  
        appendMessage('user', question);
        questionInput.value = '';
        setFormEnabled(false);
        showSpinner();
  
        try {
            const response = await fetch('/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, mode: selectedMode })
            });
  
            hideSpinner();
  
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ error: 'Unknown server error.' }));
                 throw new Error(errorData.error || `Server communication error (${response.status})`);
            }
            const data = await response.json();
             if (data.error) {
                throw new Error(data.error);
             }
  
            appendMessage('computer', data.reply);
            updateQuestionCounter(data.questionsRemaining);
  
            if (data.gameOver) {
                isGameOver = true;
                finalQuestionsUsed = data.questionsUsed;
                finalResult = data.result;
                setFormEnabled(false); // Keep form disabled
                setModeButtonsEnabled(false); // Keep modes disabled
                revealPostGameSection(); // Switch view to post-game
            } else {
                 setFormEnabled(true);
                 questionInput.focus(); // Auto-focus for next question
            }
  
        } catch (error) {
            console.error("Ask endpoint error:", error);
            hideSpinner();
            appendMessage('computer', `Error: ${error.message || 'Could not get an answer.'}`, 'error');
            if (!isGameOver) {
                setFormEnabled(true);
            }
        }
    });
  
    // Mobile Usability: Scroll chat down when input is focused
    questionInput.addEventListener('focus', () => {
        // Only scroll if the chat view is currently active
        if (chat.style.display !== 'none') {
            setTimeout(() => {
                chat.scrollTop = chat.scrollHeight;
            }, 150);
        }
    });
  
    submitScoreButton.addEventListener('click', async () => {
        if (!isGameOver || finalResult === null || finalQuestionsUsed === null) {
            console.error("Cannot submit score: Game result not finalized.");
            return;
        }
        const playerName = playerNameInput.value.trim() || "Anonymous";
        const today = new Date().toISOString().split('T')[0];
  
        submitScoreButton.disabled = true;
        submitScoreButton.textContent = 'Submitting...';
  
        const scoreData = { name: playerName, date: today, mode: selectedMode, questionsUsed: finalQuestionsUsed, result: finalResult };
  
        try {
            const res = await fetch('/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scoreData)
            });
            const responseData = await res.json();
  
            if (res.ok && responseData.success) {
                console.log("Score submitted:", responseData.message);
                fetchAndRenderLeaderboard(today, selectedMode); // Refresh leaderboard *within* post-game view
                showShareLink(scoreData); // Show share section
                scoreSubmissionForm.style.display = 'none'; // Hide submission form
            } else {
                throw new Error(responseData.message || "Failed to submit score.");
            }
        } catch (err) {
            console.error("Score submission error:", err);
            alert(`Score submission failed: ${err.message}`);
            submitScoreButton.disabled = false;
            submitScoreButton.textContent = 'Submit Score';
        }
    });
  
    copyLinkButton.addEventListener('click', () => {
        shareLinkInput.select();
        let message = "Could not copy. Please copy manually.";
        try {
             if (navigator.clipboard && navigator.clipboard.writeText) {
                 navigator.clipboard.writeText(shareLinkInput.value).then(() => {
                     copyLinkButton.textContent = 'Copied!';
                     setTimeout(() => copyLinkButton.textContent = 'Copy Share Message', 2000);
                 }).catch(clipboardErr => {
                     console.warn("Async clipboard API failed:", clipboardErr);
                     if (!document.execCommand('copy')) throw new Error("Fallback copy failed");
                     copyLinkButton.textContent = 'Copied!';
                     setTimeout(() => copyLinkButton.textContent = 'Copy Share Message', 2000);
                 });
             } else if (document.execCommand('copy')) {
                copyLinkButton.textContent = 'Copied!';
                setTimeout(() => copyLinkButton.textContent = 'Copy Share Message', 2000);
             } else {
                 throw new Error("Copy command not supported");
             }
        } catch (err) {
            console.error('Copy link failed:', err);
            alert(message);
        }
    });
  
    // --- Helper Functions ---
  
    function handleUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const sharedMode = params.get('mode');
        const outcome = params.get('outcome');
        const questions = params.get('questionsUsed');
        const date = params.get('date');
  
        if (sharedMode && outcome && questions && date) {
            const outcomeText = outcome === 'win' ? 'won' : 'lost';
            const message = `Looks like someone shared a result with you!\nThey played on ${date} (${sharedMode} mode) and ${outcomeText} using ${questions} questions.\nThink you can do better? The ${sharedMode} mode is selected for you. Good luck!`;
            appendMessage('computer', message); // Appends to chat view
  
            if (['easy', 'medium', 'difficult', 'impossible'].includes(sharedMode)) {
                 selectedMode = sharedMode;
                 // updateModeButtons() called in initializeGame
            }
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
  
    // *** MODIFIED revealPostGameSection Function ***
    function revealPostGameSection() {
        // *** Hide the main chat message area ***
        chat.style.display = 'none';
  
        // *** Show the post-game section and ensure correct flex properties ***
        postGameSection.style.display = 'flex'; // Use 'flex' as defined in CSS for layout
        postGameSection.style.flexDirection = 'column'; // Ensure content stacks vertically
  
        const today = new Date().toISOString().split('T')[0];
        fetchAndRenderLeaderboard(today, selectedMode); // Load leaderboard for the completed game's mode
        updateLeaderboardHeading(); // Ensure heading matches the mode played
  
        // Scroll the post-game section itself into view smoothly
        // Use setTimeout to allow the DOM to update before scrolling/focusing
        setTimeout(() => {
            // Scrolling the section itself might not be necessary if it fills the view
            // postGameSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
            // Focus the name input if the form is still visible
             if (scoreSubmissionForm.style.display !== 'none') {
                playerNameInput.focus();
             }
        }, 100);
    }
  
    async function fetchAndRenderLeaderboard(date, mode) {
        updateLeaderboardHeading();
        leaderboardDiv.innerHTML = '<p>Loading leaderboard...</p>';
        try {
            const queryParams = new URLSearchParams({ date, mode }).toString();
            const res = await fetch(`/leaderboard?${queryParams}`);
            if (!res.ok) {
                 const errorText = await res.text();
                throw new Error(`Failed to fetch leaderboard (${res.status}): ${errorText || res.statusText}`);
            }
            const scores = await res.json();
            renderLeaderboard(scores);
  
        } catch (err) {
            console.error("Leaderboard fetch error:", err);
            leaderboardDiv.innerHTML = `<p class="error" style="color: red; text-align: center;">Could not load leaderboard.</p>`;
        }
    }
  
    function renderLeaderboard(scores) {
        leaderboardDiv.innerHTML = ""; // Clear loading/previous
  
        if (!scores || scores.length === 0) {
            leaderboardDiv.innerHTML = '<p id="leaderboard-placeholder">No scores recorded for this mode/date yet.</p>';
            return;
        }
  
        const table = document.createElement('table');
        table.id = 'leaderboard-table';
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headerRow.innerHTML = "<th>#</th><th>Name</th><th>Qs</th><th>Result</th>";
        const tbody = table.createTBody();
        scores.forEach((score, index) => {
            const row = tbody.insertRow();
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${score.name}</td>
                <td>${score.questionsUsed}</td>
                <td class="${score.result === 'win' ? 'result-win' : 'result-lose'}">${score.result === 'win' ? 'Win' : 'Loss'}</td>
            `;
        });
        leaderboardDiv.appendChild(table);
    }
  
    function showShareLink(scoreData) {
        const { mode, result, questionsUsed, date } = scoreData;
        const outcomeText = result === 'win' ? 'guessed' : 'couldn\'t guess';
         const shareParams = new URLSearchParams({ mode, outcome: result, questionsUsed, date });
        const shareUrl = `${window.location.origin}${window.location.pathname}?${shareParams.toString()}`;
        const shareMessage = `I played 20 Questions (${mode}, ${date}) and ${outcomeText} the answer using ${questionsUsed} questions! Can you beat my score? 🤔 Play here: ${shareUrl}`;
  
        shareLinkInput.value = shareMessage;
        shareLinkContainer.style.display = 'block'; // Show the share container *within* the post-game section
  
        // Optionally scroll the post-game section to ensure share is visible
        setTimeout(() => {
             shareLinkContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }
  
    // --- Run Initialization ---
    initializeGame(); // Set up the game when the DOM is ready
  
  });