<script>
  const LIFF_ID  = '1656208126-fpNe2w28';
  const BIND_API = 'https://enamor-member.vercel.app/api/liff-bind';
  const VIP_URL  = 'https://enamorshop.com/collections/vip-secret';

  const track = new URLSearchParams(window.location.search).get('track') || 'lycra_free';

  const overlay      = document.getElementById('loading-overlay');
  const emailInput   = document.getElementById('email-input');
  const btnSubmit    = document.getElementById('btn-submit');
  const bindForm     = document.getElementById('bind-form');
  const successBlock = document.getElementById('success-block');
  const msgError     = document.getElementById('msg-error');
  const msgInfo      = document.getElementById('msg-info');

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

  async function writeCoolTag(uid) {
    try {
      await fetch(BIND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUID: uid, track: track, stage: 'cool' })
      });
    } catch (err) {
      console.error('Cool tag error:', err);
    }
  }

  async function initLiff() {
    try {
      await liff.init({ liffId: LIFF_ID });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile = await liff.getProfile();
      lineUID = profile.userId;

      writeCoolTag(lineUID);

      overlay.classList.add('hide');
      emailInput.disabled = false;
      validateEmail();

    } catch (err) {
      console.error('LIFF init error:', err);
      overlay.classList.add('hide');
      showError('LINE 授權失敗，請關閉後重新開啟連結');
    }
  }

  function validateEmail() {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim());
    btnSubmit.disabled = !ok || !lineUID;
    return ok;
  }

  emailInput.addEventListener('input', function() {
    clearMsg();
    validateEmail();
  });

  btnSubmit.addEventListener('click', async function() {
    if (!validateEmail()) return;
    const email = emailInput.value.trim();

    btnSubmit.disabled = true;
    btnSubmit.textContent = '處理中';
    showInfo('綁定中，請稍候...');

    try {
      const res = await fetch(BIND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          lineUID: lineUID,
          track: track,
          stage: 'join'
        })
      });
      const data = await res.json();

      if (data.success) {
        bindForm.style.display = 'none';
        successBlock.classList.add('visible');
        setTimeout(function() { window.location.href = VIP_URL; }, 2500);
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

  emailInput.disabled = true;
  initLiff();
</script>
