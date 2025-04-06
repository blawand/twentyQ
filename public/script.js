document.addEventListener("DOMContentLoaded", () => {
  const questionForm = document.getElementById("question-form");
  const questionInput = document.getElementById("question-input");
  const sendButton = questionForm.querySelector("button");
  const chat = document.getElementById("chat");
  const modeButtons = document.querySelectorAll(".mode-button");
  const questionCounter = document.getElementById("question-counter");
  const postGameSection = document.getElementById("post-game-section");
  const scoreSubmissionForm = document.getElementById("score-submission");
  const playerNameInput = document.getElementById("player-name");
  const submitScoreButton = document.getElementById("submit-score-button");
  const shareLinkContainer = document.getElementById("share-link-container");
  const shareLinkInput = document.getElementById("share-link-input");
  const copyLinkButton = document.getElementById("copy-link-button");
  const leaderboardDiv = document.getElementById("leaderboard");
  const leaderboardModeSpan = document.getElementById("leaderboard-mode");
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.innerHTML = "<span></span><span></span><span></span>";

  let gameStarted = false;
  let selectedMode = "medium";
  let isGameOver = false;
  let finalQuestionsUsed = null;
  let finalResult = null;
  let currentInteraction = false;

  function initializeGame() {
    // Ensure correct initial visibility states
    chat.style.display = "flex"; // Chat should be visible
    postGameSection.style.display = "none"; // Post-game hidden

    // Clear any previous game messages if re-initializing (e.g., after refresh)
    chat.innerHTML = "";
    leaderboardDiv.innerHTML = ""; // Clear old leaderboard

    appendMessage(
      "computer",
      "Welcome! Choose a difficulty, then I'll think of something. Ask me Yes/No questions. You have 20 tries!"
    );
    handleUrlParams();
    updateModeButtons();
    updateQuestionCounter(20); // Reset counter display
    setFormEnabled(true);
    setModeButtonsEnabled(true);
    isGameOver = false; // Explicitly reset game over state
    gameStarted = false; // Explicitly reset game started state

    // Reset post-game section elements (important if user refreshes after game over)
    scoreSubmissionForm.style.display = "block";
    shareLinkContainer.style.display = "none";
    submitScoreButton.disabled = false;
    submitScoreButton.textContent = "Submit Score";
    playerNameInput.value = ""; // Clear player name

    setTimeout(() => {
      if (chat) chat.scrollTop = chat.scrollHeight;
    }, 50);
  }

  function startGame() {
    gameStarted = true;
    isGameOver = false;
    finalQuestionsUsed = null;
    finalResult = null;
    currentInteraction = false;
    questionCounter.innerText = `20/20 remaining`;
    questionInput.value = "";

    // Ensure chat is visible and clear previous messages
    chat.style.display = "flex";
    chat.innerHTML = "";
    // Ensure post-game is hidden
    postGameSection.style.display = "none";

    appendMessage(
      "computer",
      `Okay, I'm thinking of something for the ${selectedMode} mode... Ask your first Yes/No question!`
    );
    setFormEnabled(true);
    setModeButtonsEnabled(false);

    // Reset post-game elements again just in case
    shareLinkContainer.style.display = "none";
    submitScoreButton.disabled = false;
    submitScoreButton.textContent = "Submit Score";
    scoreSubmissionForm.style.display = "block";
    leaderboardDiv.innerHTML = "";

    updateLeaderboardHeading();

    setTimeout(() => {
      if (chat) chat.scrollTop = chat.scrollHeight;
    }, 50);
  }

  function appendMessage(sender, text, type = "normal") {
    const div = document.createElement("div");
    div.classList.add("message", sender);
    if (type === "error") {
      div.classList.add("error");
    }
    // Use textContent for security, but render newlines if needed
    div.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");

    // Append message regardless of whether post-game is shown
    chat.appendChild(div);
    // Scroll chat area to bottom only if post-game is NOT visible
    // If post-game IS visible, let the user scroll manually
    if (postGameSection.style.display === "none") {
      chat.scrollTop = chat.scrollHeight;
    }
  }

  function showSpinner() {
    // Append spinner regardless of post-game visibility
    chat.appendChild(spinner);
    spinner.style.display = "flex"; // Use flex for spinner centering
    // Scroll to show spinner only if post-game is hidden
    if (postGameSection.style.display === "none") {
      chat.scrollTop = chat.scrollHeight;
    }
  }

  function hideSpinner() {
    if (spinner.parentNode === chat) {
      chat.removeChild(spinner);
    }
    spinner.style.display = "none";
  }

  function setFormEnabled(enabled) {
    questionInput.disabled = !enabled;
    sendButton.disabled = !enabled;
    currentInteraction = !enabled;
  }

  function setModeButtonsEnabled(enabled) {
    modeButtons.forEach((button) => {
      button.disabled = !enabled;
      button.classList.toggle("disabled-mode", !enabled); // Add/remove class based on state
      button.setAttribute(
        "aria-checked",
        button.classList.contains("active").toString()
      );
    });
  }

  function updateQuestionCounter(remaining) {
    const displayRemaining = Math.max(0, remaining); // Ensure counter doesn't go below 0
    questionCounter.innerText = `${displayRemaining}/20 remaining`;
  }

  function updateModeButtons() {
    modeButtons.forEach((button) => {
      const isActive = button.getAttribute("data-mode") === selectedMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-checked", isActive.toString());
    });
    // Mode buttons enabled only if game hasn't started AND isn't over
    setModeButtonsEnabled(!gameStarted && !isGameOver);
    updateLeaderboardHeading();
  }

  function updateLeaderboardHeading() {
    if (leaderboardModeSpan) {
      // Capitalize first letter of mode
      const modeText =
        selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1);
      leaderboardModeSpan.textContent = modeText;
    }
  }

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      // Only allow mode change if game not started and not over
      if (gameStarted || isGameOver) return;
      selectedMode = button.getAttribute("data-mode");
      updateModeButtons();
      console.log(`Mode selected: ${selectedMode}`);
      // Optional: Clear initial welcome message if mode changes before start?
      // chat.innerHTML = '';
      // appendMessage('computer', `Difficulty set to ${selectedMode}. Ask your first question when ready.`);
    });
  });

  questionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Prevent submission if waiting for response, game is over, or game hasn't started yet (wait for mode selection)
    if (currentInteraction || isGameOver) return;

    const question = questionInput.value.trim();
    if (!question) return;

    // --- Start Game Automatically on First Valid Question ---
    if (!gameStarted) {
      startGame(); // Initializes game state, shows chat, hides post-game, etc.
    }
    // --- End Auto-Start ---

    // Add user message immediately
    appendMessage("user", question);
    questionInput.value = ""; // Clear input after sending
    setFormEnabled(false); // Disable form while waiting
    showSpinner();

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode: selectedMode }),
      });

      hideSpinner(); // Hide spinner once response is received

      const data = await response.json();

      // Handle HTTP errors (like 500, 429, 400 from backend validation)
      if (!response.ok) {
        // Use error message from backend JSON if available
        throw new Error(
          data.error || `Server error (${response.status}). Please try again.`
        );
      }

      // Display AI reply (could be Yes/No or an error message handled gracefully by backend)
      appendMessage("computer", data.reply);
      updateQuestionCounter(data.questionsRemaining);

      // Check if the game ended with this response
      if (data.gameOver) {
        isGameOver = true; // Set game over flag
        finalQuestionsUsed = data.questionsUsed;
        finalResult = data.result;
        setFormEnabled(false); // Keep form disabled
        setModeButtonsEnabled(false); // Keep modes disabled
        revealPostGameSection(); // Show post-game options
      } else {
        // Re-enable form for next question if game is not over
        setFormEnabled(true);
        questionInput.focus(); // Auto-focus for convenience
      }
    } catch (error) {
      console.error("Ask endpoint error:", error);
      hideSpinner();
      // Display error message in chat
      appendMessage(
        "computer",
        `Error: ${error.message || "Could not get an answer."}`,
        "error"
      );
      // Re-enable form if game is not over, so user can retry or ask something else
      if (!isGameOver) {
        setFormEnabled(true);
      }
    }
  });

  questionInput.addEventListener("focus", () => {
    // Scroll chat down when input is focused, but only if post-game is hidden
    if (postGameSection.style.display === "none") {
      setTimeout(() => {
        // Check again in case state changed quickly
        if (chat && postGameSection.style.display === "none") {
          chat.scrollTop = chat.scrollHeight;
        }
      }, 150); // Small delay might help on some browsers
    }
  });

  submitScoreButton.addEventListener("click", async () => {
    // Ensure game is over and results are available
    if (!isGameOver || finalResult === null || finalQuestionsUsed === null) {
      console.error("Cannot submit score: Game result not finalized.");
      alert("Cannot submit score - game result missing."); // User feedback
      return;
    }
    const playerName = playerNameInput.value.trim() || "Anonymous";
    // Simple client-side validation for name length
    if (playerName.length > 30) {
      alert("Player name cannot exceed 30 characters.");
      return;
    }
    const today = new Date().toISOString().split("T")[0];

    submitScoreButton.disabled = true;
    submitScoreButton.textContent = "Submitting...";

    const scoreData = {
      name: playerName,
      date: today,
      mode: selectedMode,
      questionsUsed: finalQuestionsUsed,
      result: finalResult,
    };

    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scoreData),
      });
      const responseData = await res.json();

      if (res.ok && responseData.success) {
        console.log("Score submitted:", responseData.message);
        fetchAndRenderLeaderboard(today, selectedMode); // Refresh leaderboard
        showShareLink(scoreData); // Show share section
        scoreSubmissionForm.style.display = "none"; // Hide submission form after success
      } else {
        // Use error message from backend if available
        throw new Error(
          responseData.message || `Failed to submit score (${res.status})`
        );
      }
    } catch (err) {
      console.error("Score submission error:", err);
      alert(`Score submission failed: ${err.message}`); // Show error to user
      // Re-enable button on failure
      submitScoreButton.disabled = false;
      submitScoreButton.textContent = "Submit Score";
    }
  });

  copyLinkButton.addEventListener("click", () => {
    shareLinkInput.select();
    let message = "Could not copy. Please copy manually.";
    let success = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(shareLinkInput.value)
          .then(() => {
            success = true;
            copyLinkButton.textContent = "Copied!";
            setTimeout(
              () => (copyLinkButton.textContent = "Copy Share Message"),
              2000
            );
          })
          .catch((clipboardErr) => {
            console.warn("Async clipboard API failed:", clipboardErr);
            // Fallback attempt only if promise fails
            if (document.execCommand("copy")) {
              success = true;
              copyLinkButton.textContent = "Copied!";
              setTimeout(
                () => (copyLinkButton.textContent = "Copy Share Message"),
                2000
              );
            } else {
              throw new Error("Fallback copy failed");
            }
          });
      } else if (document.execCommand("copy")) {
        // Legacy fallback
        success = true;
        copyLinkButton.textContent = "Copied!";
        setTimeout(
          () => (copyLinkButton.textContent = "Copy Share Message"),
          2000
        );
      } else {
        throw new Error("Copy command not supported");
      }
    } catch (err) {
      console.error("Copy link failed:", err);
      if (!success) {
        // Only alert if copy failed
        alert(message);
      }
    }
  });

  function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const sharedMode = params.get("mode");
    const outcome = params.get("outcome");
    const questions = params.get("questionsUsed");
    const date = params.get("date");
    const allowedModes = ["easy", "medium", "difficult", "impossible"];
    const currentPath = window.location.pathname; // Get current path without query params

    if (
      sharedMode &&
      outcome &&
      questions &&
      date &&
      allowedModes.includes(sharedMode)
    ) {
      const outcomeText = outcome === "win" ? "won" : "lost";
      const message = `Looks like someone shared a result with you!\nThey played on ${date} (${sharedMode} mode) and ${outcomeText} using ${questions} questions.\nThink you can do better? The ${sharedMode} mode is selected for you. Good luck!`;

      // Clear existing chat before adding share message
      chat.innerHTML = "";
      appendMessage("computer", message);

      selectedMode = sharedMode;
      updateModeButtons(); // Update button appearance immediately

      // Clear URL params without reloading page
      window.history.replaceState({}, document.title, currentPath);
    } else if (params.toString().length > 0) {
      // Clear invalid params if any exist
      console.log("Clearing invalid URL parameters.");
      window.history.replaceState({}, document.title, currentPath);
    }
  }

  function revealPostGameSection() {
    // chat.style.display = 'none'; // REMOVED THIS LINE

    // Show the post-game section
    postGameSection.style.display = "flex"; // Use 'flex' as defined in CSS for layout
    postGameSection.style.flexDirection = "column"; // Ensure content stacks vertically

    const today = new Date().toISOString().split("T")[0];
    fetchAndRenderLeaderboard(today, selectedMode); // Load leaderboard for the completed game's mode
    updateLeaderboardHeading(); // Ensure heading matches the mode played

    setTimeout(() => {
      // Check if the element exists before trying to scroll/focus
      if (postGameSection) {
        postGameSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      // Focus the name input if the form is still visible
      if (
        scoreSubmissionForm &&
        scoreSubmissionForm.style.display !== "none" &&
        playerNameInput
      ) {
        playerNameInput.focus();
      }
    }, 100); // Delay allows DOM updates
  }

  async function fetchAndRenderLeaderboard(date, mode) {
    updateLeaderboardHeading(); // Ensure heading is correct
    leaderboardDiv.innerHTML = "<p>Loading leaderboard...</p>"; // Loading indicator
    try {
      const queryParams = new URLSearchParams({ date, mode }).toString();
      const res = await fetch(`/api/leaderboard?${queryParams}`);

      // Check for HTTP errors first
      if (!res.ok) {
        let errorText = `Failed to fetch leaderboard (${res.status})`;
        try {
          // Try parsing backend error message
          const errorJson = await res.json();
          errorText = errorJson.message || errorText;
        } catch (e) {
          // Ignore if response wasn't JSON
        }
        throw new Error(errorText);
      }

      const scores = await res.json(); // Parse successful response
      renderLeaderboard(scores);
    } catch (err) {
      console.error("Leaderboard fetch error:", err);
      // Display error in the leaderboard div
      leaderboardDiv.innerHTML = `<p class="error" style="color: red; text-align: center;">Could not load leaderboard: ${escapeHtml(
        err.message
      )}</p>`;
    }
  }

  function renderLeaderboard(scores) {
    leaderboardDiv.innerHTML = ""; // Clear previous content/loading message

    if (!scores || scores.length === 0) {
      leaderboardDiv.innerHTML =
        '<p id="leaderboard-placeholder">No scores recorded for this mode/date yet.</p>';
      return;
    }

    const table = document.createElement("table");
    table.id = "leaderboard-table";
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    // Use consistent header names
    headerRow.innerHTML =
      "<th>#</th><th>Name</th><th>Qs Used</th><th>Result</th>";
    const tbody = table.createTBody();

    scores.forEach((score, index) => {
      // Use safe defaults and escape HTML
      const qUsed = score.questionsUsed ?? "?";
      const name = score.name ?? "Anonymous";
      const result = score.result ?? "unknown";
      const resultText =
        result === "win" ? "Win" : result === "lose" ? "Loss" : "Unknown";

      const row = tbody.insertRow();
      row.innerHTML = `
                <td>${index + 1}</td>
                <td>${escapeHtml(name)}</td>
                <td>${qUsed}</td>
                <td class="${
                  result === "win" ? "result-win" : "result-lose"
                }">${resultText}</td>
            `;
    });
    leaderboardDiv.appendChild(table);
  }

  function showShareLink(scoreData) {
    const { mode, result, questionsUsed, date } = scoreData;
    const outcomeText = result === "win" ? "guessed" : "couldn't guess";
    const shareParams = new URLSearchParams({
      mode,
      outcome: result,
      questionsUsed: String(questionsUsed),
      date,
    });
    // Construct URL relative to current origin and path
    const shareUrl = `${window.location.origin}${
      window.location.pathname
    }?${shareParams.toString()}`;
    const shareMessage = `I played 20 Questions (${mode}, ${date}) and ${outcomeText} the answer using ${questionsUsed} questions! Can you beat my score? 🤔 Play here: ${shareUrl}`;

    shareLinkInput.value = shareMessage;
    shareLinkContainer.style.display = "block"; // Show the share container

    // Scroll share link into view smoothly if needed
    setTimeout(() => {
      if (shareLinkContainer) {
        shareLinkContainer.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }, 100);
  }

  function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  initializeGame();
});
