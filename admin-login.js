const loginFormEl = document.getElementById("login-form");
const usernameEl = document.getElementById("login-username");
const passwordEl = document.getElementById("login-password");
const loginBtnEl = document.getElementById("login-btn");
const statusEl = document.getElementById("login-status");

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ffb3b3" : "#9ff3c5";
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

async function checkExistingSession() {
  try {
    const payload = await requestJson("/api/session", { cache: "no-store" });
    if (payload.authenticated) {
      window.location.replace("/admin.html");
    }
  } catch {
    // Keep login form visible.
  }
}

loginFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = String(usernameEl.value || "").trim();
  const password = String(passwordEl.value || "");

  if (!username || !password) {
    showStatus("Enter username and password.", true);
    return;
  }

  loginBtnEl.disabled = true;
  showStatus("Signing in...");

  try {
    await requestJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    showStatus("Login successful.");
    window.location.replace("/admin.html");
  } catch (error) {
    showStatus(error.message || "Login failed.", true);
  } finally {
    loginBtnEl.disabled = false;
  }
});

checkExistingSession();
