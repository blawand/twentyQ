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
    chat.style.display = "flex";
    postGameSection.style.display = "none";

    chat.innerHTML = "";
    leaderboardDiv.innerHTML = "";

    appendMessage(
      "computer",
      "Welcome! Choose a difficulty, then I'll think of something. Ask me Yes/No questions. You have 20 tries!"
    );
    handleUrlParams();
    updateModeButtons();
    updateQuestionCounter(20);
    setFormEnabled(true);
    setModeButtonsEnabled(true);
    isGameOver = false;
    gameStarted = false;

    scoreSubmissionForm.style.display = "block";
    shareLinkContainer.style.display = "none";
    submitScoreButton.disabled = false;
    submitScoreButton.textContent = "Submit Score";
    playerNameInput.value = "";

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

    chat.style.display = "flex";
    chat.innerHTML = "";
    postGameSection.style.display = "none";

    appendMessage(
      "computer",
      `Okay, I'm thinking of something for the ${selectedMode} mode... Ask your first Yes/No question!`
    );
    setFormEnabled(true);
    setModeButtonsEnabled(false);

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
    div.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function showSpinner() {
    chat.appendChild(spinner);
    spinner.style.display = "flex";
    chat.scrollTop = chat.scrollHeight;
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
      button.classList.toggle("disabled-mode", !enabled);
      button.setAttribute(
        "aria-checked",
        button.classList.contains("active").toString()
      );
    });
  }

  function updateQuestionCounter(remaining) {
    const displayRemaining = Math.max(0, remaining);
    questionCounter.innerText = `${displayRemaining}/20 remaining`;
  }

  function updateModeButtons() {
    modeButtons.forEach((button) => {
      const isActive = button.getAttribute("data-mode") === selectedMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-checked", isActive.toString());
    });
    setModeButtonsEnabled(!gameStarted && !isGameOver);
    updateLeaderboardHeading();
  }

  function updateLeaderboardHeading() {
    if (leaderboardModeSpan) {
      const modeText =
        selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1);
      leaderboardModeSpan.textContent = modeText;
    }
  }

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (gameStarted || isGameOver) return;
      selectedMode = button.getAttribute("data-mode");
      updateModeButtons();
      console.log(`Mode selected: ${selectedMode}`);
    });
  });

  questionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (currentInteraction || isGameOver) return;

    const question = questionInput.value.trim();
    if (!question) return;

    if (!gameStarted) {
      startGame();
    }

    appendMessage("user", question);
    questionInput.value = "";
    setFormEnabled(false);
    showSpinner();

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode: selectedMode }),
      });

      hideSpinner();

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || `Server error (${response.status}). Please try again.`
        );
      }

      appendMessage("computer", data.reply);
      updateQuestionCounter(data.questionsRemaining);

      if (data.gameOver) {
        isGameOver = true;
        finalQuestionsUsed = data.questionsUsed;
        finalResult = data.result;
        setFormEnabled(false);
        setModeButtonsEnabled(false);
        revealPostGameSection();
      } else {
        setFormEnabled(true);
        questionInput.focus();
      }
    } catch (error) {
      console.error("Ask endpoint error:", error);
      hideSpinner();
      appendMessage(
        "computer",
        `Error: ${error.message || "Could not get an answer."}`,
        "error"
      );
      if (!isGameOver) {
        setFormEnabled(true);
      }
    }
  });

  submitScoreButton.addEventListener("click", async () => {
    if (!isGameOver || finalResult === null || finalQuestionsUsed === null) {
      console.error("Cannot submit score: Game result not finalized.");
      alert("Cannot submit score - game result missing.");
      return;
    }
    const playerName = playerNameInput.value.trim() || "Anonymous";
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
        fetchAndRenderLeaderboard(today, selectedMode);
        showShareLink(scoreData);
        scoreSubmissionForm.style.display = "none";
      } else {
        throw new Error(
          responseData.message || `Failed to submit score (${res.status})`
        );
      }
    } catch (err) {
      console.error("Score submission error:", err);
      alert(`Score submission failed: ${err.message}`);
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
    const currentPath = window.location.pathname;

    if (
      sharedMode &&
      outcome &&
      questions &&
      date &&
      allowedModes.includes(sharedMode)
    ) {
      const outcomeText = outcome === "win" ? "won" : "lost";
      const message = `Looks like someone shared a result with you!\nThey played on ${date} (${sharedMode} mode) and ${outcomeText} using ${questions} questions.\nThink you can do better? The ${sharedMode} mode is selected for you. Good luck!`;

      chat.innerHTML = "";
      appendMessage("computer", message);

      selectedMode = sharedMode;
      updateModeButtons();

      window.history.replaceState({}, document.title, currentPath);
    } else if (params.toString().length > 0) {
      console.log("Clearing invalid URL parameters.");
      window.history.replaceState({}, document.title, currentPath);
    }
  }

  function revealPostGameSection() {
    postGameSection.style.display = "block";

    const today = new Date().toISOString().split("T")[0];
    fetchAndRenderLeaderboard(today, selectedMode);
    updateLeaderboardHeading();

    setTimeout(() => {
      if (postGameSection) {
        postGameSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (
        scoreSubmissionForm &&
        scoreSubmissionForm.style.display !== "none" &&
        playerNameInput
      ) {
        playerNameInput.focus();
      }
    }, 100);
  }

  async function fetchAndRenderLeaderboard(date, mode) {
    updateLeaderboardHeading();
    leaderboardDiv.innerHTML = "<p>Loading leaderboard...</p>";
    try {
      const queryParams = new URLSearchParams({ date, mode }).toString();
      const res = await fetch(`/api/leaderboard?${queryParams}`);

      if (!res.ok) {
        let errorText = `Failed to fetch leaderboard (${res.status})`;
        try {
          const errorJson = await res.json();
          errorText = errorJson.message || errorText;
        } catch (e) {}
        throw new Error(errorText);
      }

      let scores = await res.json();

      // Sort scores: questions ascending, then wins before losses
      scores.sort((a, b) => {
        // Primary sort: questions used (ascending)
        if (a.questionsUsed !== b.questionsUsed) {
          return (a.questionsUsed ?? Infinity) - (b.questionsUsed ?? Infinity);
        }
        // Secondary sort: result ('win' comes first)
        const scoreA = a.result === "win" ? -1 : 1;
        const scoreB = b.result === "win" ? -1 : 1;
        return scoreA - scoreB;
      });

      renderLeaderboard(scores);
    } catch (err) {
      console.error("Leaderboard fetch error:", err);
      leaderboardDiv.innerHTML = `<p class="error" style="color: red; text-align: center;">Could not load leaderboard: ${escapeHtml(
        err.message
      )}</p>`;
    }
  }

  function renderLeaderboard(scores) {
    leaderboardDiv.innerHTML = "";

    if (!scores || scores.length === 0) {
      leaderboardDiv.innerHTML =
        '<p id="leaderboard-placeholder">No scores recorded for this mode/date yet.</p>';
      return;
    }

    const table = document.createElement("table");
    table.id = "leaderboard-table";
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    headerRow.innerHTML =
      "<th>#</th><th>Name</th><th>Qs Used</th><th>Result</th>";
    const tbody = table.createTBody();

    scores.forEach((score, index) => {
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
    const shareUrl = `${window.location.origin}${
      window.location.pathname
    }?${shareParams.toString()}`;
    const shareMessage = `I played 20 Questions (${mode}, ${date}) and ${outcomeText} the answer using ${questionsUsed} questions! Can you beat my score? 🤔 Play here: ${shareUrl}`;

    shareLinkInput.value = shareMessage;
    shareLinkContainer.style.display = "block";

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
