<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>會員綁定 — EnamoR</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400&display=swap" rel="stylesheet">
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:       #FAFAF7;
      --bg-card:  #F5F0E8;
      --ink:      #1C1C1A;
      --ink-2:    #5C5C58;
      --ink-3:    #9C9A92;
      --gold:     #8B6F47;
      --gold-lt:  #C4A882;
      --line-grn: #06C755;
      --radius:   2px;
    }

    html, body {
      min-height: 100%;
      background: var(--bg);
      font-family: 'Noto Sans TC', 'PingFang TC', sans-serif;
      font-weight: 300;
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
    }

    /* ── layout ── */
    .page {
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px 64px;
    }

    .card {
      width: 100%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    /* ── wordmark ── */
    .wordmark {
      text-align: center;
    }
    .wordmark-en {
      font-size: 10px;
      letter-spacing: 6px;
      text-transform: uppercase;
      color: var(--gold);
    }
    .wordmark-zh {
      font-size: 22px;
      font-weight: 300;
      color: var(--ink);
      margin-top: 6px;
      letter-spacing: 0.05em;
    }
    .wordmark-sub {
      font-size: 13px;
      color: var(--ink-2);
      margin-top: 8px;
      line-height: 1.7;
    }

    /* ── benefit list ── */
    .benefits {
      background: var(--bg-card);
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .benefit-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .benefit-num {
      font-size: 10px;
      letter-spacing: 2px;
      color: var(--gold);
      padding-top: 2px;
      flex-shrink: 0;
      width: 20px;
    }
    .benefit-text {
      font-size: 14px;
      color: var(--ink-2);
      line-height: 1.6;
    }

    /* ── form ── */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .input-wrap {
      position: relative;
    }

    input[type="email"] {
      width: 100%;
      padding: 14px 16px;
      font-family: inherit;
      font-weight: 300;
      font-size: 14px;
      color: var(--ink);
      background: #fff;
      border: 0.5px solid rgba(139,111,71,0.3);
      border-radius: var(--radius);
      outline: none;
      transition: border-color 0.2s;
      -webkit-appearance: none;
    }
    input[type="email"]::placeholder {
      color: var(--ink-3);
    }
    input[type="email"]:focus {
      border-color: var(--gold);
    }

    .btn-bind {
      width: 100%;
      padding: 15px;
      background: var(--ink);
      color: var(--bg);
      font-family: inherit;
      font-weight: 300;
      font-size: 13px;
      letter-spacing: 4px;
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      transition: background 0.2s;
      -webkit-appearance: none;
    }
    .btn-bind:hover:not(:disabled) {
      background: var(--gold);
    }
    .btn-bind:disabled {
      opacity: 0.45;
      cursor: default;
    }

    /* ── status messages ── */
    .msg {
      font-size: 13px;
      line-height: 1.6;
      text-align: center;
      display: none;
    }
    .msg.visible { display: block; }
    .msg-error  { color: #B04040; }
    .msg-info   { color: var(--ink-2); }

    /* ── success state ── */
    .success-block {
      display: none;
      text-align: center;
      gap: 16px;
      flex-direction: column;
      align-items: center;
    }
    .success-block.visible { display: flex; }

    .success-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--bg-card);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      color: var(--gold);
    }
    .success-title {
      font-size: 18px;
      color: var(--ink);
      letter-spacing: 0.03em;
    }
    .success-sub {
      font-size: 13px;
      color: var(--ink-2);
      line-height: 1.7;
    }
    .btn-vip {
      display: inline-block;
      padding: 13px 36px;
      background: var(--gold);
      color: var(--bg);
      font-family: inherit;
      font-weight: 300;
      font-size: 12px;
      letter-spacing: 4px;
      text-decoration: none;
      border-radius: var(--radius);
      transition: background 0.2s;
    }
    .btn-vip:hover { background: var(--gold-lt); }

    /* ── divider ── */
    .divider {
      height: 0.5px;
      background: rgba(139,111,71,0.2);
    }

    /* ── loading overlay ── */
    #loading-overlay {
      position: fixed;
      inset: 0;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      transition: opacity 0.3s;
    }
    #loading-overlay.hide {
      opacity: 0;
      pointer-events: none;
    }
    .spinner {
      width: 28px;
      height: 28px;
      border: 1.5px solid rgba(139,111,71,0.2);
      border-top-color: var(--gold);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .spinner { animation: none; }
    }
  </style>
</head>
<body>

<div id="loading-overlay">
  <div class="spinner"></div>
</div>

<div class="page">
  <div class="card">

    <!-- Wordmark -->
    <div class="wordmark">
      <div class="wordmark-en">EnamoR Official</div>
      <div class="wordmark-zh">會員綁定</div>
      <div class="wordmark-sub">輸入 Email，將 LINE 帳號與會員資料連結</div>
    </div>

    <!-- Benefits -->
    <div class="benefits">
      <div class="benefit-item">
        <span class="benefit-num">01</span>
        <span class="benefit-text">每月發送專屬連結，領取月禮免費小褲</span>
      </div>
      <div class="benefit-item">
        <span class="benefit-num">02</span>
        <span class="benefit-text">不定時 LINE 專屬神秘優惠</span>
      </div>
      <div class="benefit-item">
        <span class="benefit-num">03</span>
        <span class="benefit-text">活動通知不漏接</span>
      </div>
    </div>

    <div class="divider"></div>

    <!-- Form -->
    <div id="bind-form">
      <div class="form-group">
        <div class="input-wrap">
          <input
            type="email"
            id="email-input"
            placeholder="your@email.com"
            autocomplete="email"
            inputmode="email"
          >
        </div>
        <div id="msg-error" class="msg msg-error"></div>
        <div id="msg-info"  class="msg msg-info"></div>
        <button class="btn-bind" id="btn-submit" disabled>確認綁定</button>
      </div>
    </div>

    <!-- Success -->
    <div class="success-block" id="success-block">
      <div class="success-icon">✓</div>
      <div class="success-title">綁定完成</div>
      <div class="success-sub">月禮連結已發送到您的 LINE<br>請保持好友狀態以繼續收到禮遇</div>
      <a href="https://enamorshop.com/collections/vip-secret" class="btn-vip">前往會員獨享專區</a>
    </div>

  </div>
</div>

<script>
  const LIFF_ID    = '1656208126-fpNe2w28';
  const BIND_API   = 'https://enamor-member.vercel.app/api/liff-bind';
  const VIP_URL    = 'https://enamorshop.com/collections/vip-secret';

  const overlay    = document.getElementById('loading-overlay');
  const emailInput = document.getElementById('email-input');
  const btnSubmit  = document.getElementById('btn-submit');
  const bindForm   = document.getElementById('bind-form');
  const successBlock = document.getElementById('success-block');
  const msgError   = document.getElementById('msg-error');
  const msgInfo    = document.getElementById('msg-info');

  let lineUID = null;

  function showError(text) {
    msgError.textContent = text;
    msgError.classList.add('visible');
    msgInfo.classList.remove('visible');
  }
  function showInfo(text) {
    msgInfo.textContent = text;
    msgInfo.classList.add('visible');
    msgError.classList.remove('visible');
  }
  function clearMsg() {
    msgError.classList.remove('visible');
    msgInfo.classList.remove('visible');
  }

  // ── LIFF init ──
  async function initLiff() {
    try {
      await liff.init({ liffId: LIFF_ID });

      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }

      const profile = await liff.getProfile();
      lineUID = profile.userId;

      // 已取得 UID，解鎖表單
      overlay.classList.add('hide');
      emailInput.disabled = false;
      validateEmail();

    } catch (err) {
      console.error('LIFF init error:', err);
      overlay.classList.add('hide');
      showError('LINE 授權失敗，請關閉後重新開啟連結');
    }
  }

  // ── email validation ──
  function validateEmail() {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim());
    btnSubmit.disabled = !ok || !lineUID;
    return ok;
  }

  emailInput.addEventListener('input', () => {
    clearMsg();
    validateEmail();
  });

  // ── submit ──
  btnSubmit.addEventListener('click', async () => {
    if (!validateEmail()) return;
    const email = emailInput.value.trim();

    btnSubmit.disabled = true;
    btnSubmit.textContent = '處理中';
    showInfo('綁定中，請稍候...');

    try {
      const res = await fetch(BIND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, lineUID })
      });
      const data = await res.json();

      if (data.success) {
        // Show success, hide form
        bindForm.style.display = 'none';
        successBlock.classList.add('visible');

        // 2.5s 後自動跳轉
        setTimeout(() => {
          window.location.href = VIP_URL;
        }, 2500);
      } else {
        showError(data.message || '綁定失敗，請稍後再試');
        btnSubmit.disabled = false;
        btnSubmit.textContent = '確認綁定';
      }
    } catch (err) {
      console.error('Bind error:', err);
      showError('連線異常，請稍後再試');
      btnSubmit.disabled = false;
      btnSubmit.textContent = '確認綁定';
    }
  });

  // ── init ──
  emailInput.disabled = true; // disable until LIFF ready
  initLiff();
</script>

</body>
</html>
