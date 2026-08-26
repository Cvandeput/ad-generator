// Page de connexion (login only, pas d'inscription).
const form = document.getElementById('auth-form');
const submitBtn = document.getElementById('submit-btn');
const errorEl = document.getElementById('error');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erreur');
    window.location.href = '/app.html';
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
  }
});

// Déjà connecté → dashboard.
fetch('/api/auth/me').then((r) => {
  if (r.ok) window.location.href = '/app.html';
});
