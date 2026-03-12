/* ══════════════════════════════════════════════════════════════
   THE VOID — Secret Chat Client
   ══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── DOM Elements ──────────────────────────────────────────
  const loginView = document.getElementById('login-view');
  const chatView = document.getElementById('chat-view');
  const secretCodeInput = document.getElementById('secret-code');
  const enterBtn = document.getElementById('enter-btn');
  const errorMsg = document.getElementById('error-msg');
  const messagesArea = document.getElementById('messages-area');
  const messagesContainer = document.getElementById('messages-container');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const onlineCount = document.getElementById('online-count');
  const userAlias = document.getElementById('user-alias');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingAlias = typingIndicator.querySelector('.typing-alias');
  const leaveBtn = document.getElementById('leave-btn');
  const shieldOverlay = document.getElementById('shield-overlay');

  // ── State ─────────────────────────────────────────────────
  let socket = null;
  let myAlias = '';
  let typingTimeout = null;
  let isTyping = false;
  let seenMessages = new Set();

  // ══════════════════════════════════════════════════════════
  // PARTICLES BACKGROUND
  // ══════════════════════════════════════════════════════════
  function initParticles() {
    const canvas = document.getElementById('particles');
    const ctx = canvas.getContext('2d');
    let particles = [];
    let heartParticles = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create particles
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 0.5,
        color: Math.random() > 0.5
          ? `rgba(255, 45, 117, ${Math.random() * 0.4 + 0.1})`
          : `rgba(0, 240, 255, ${Math.random() * 0.3 + 0.05})`,
        pulse: Math.random() * Math.PI * 2
      });
    }

    // Floating hearts
    for (let i = 0; i < 8; i++) {
      heartParticles.push({
        x: Math.random() * canvas.width,
        y: canvas.height + Math.random() * 200,
        vy: -(Math.random() * 0.3 + 0.15),
        vx: (Math.random() - 0.5) * 0.2,
        size: Math.random() * 8 + 4,
        opacity: Math.random() * 0.15 + 0.05,
        wobble: Math.random() * Math.PI * 2
      });
    }

    function drawHeart(x, y, size, opacity) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size / 20, size / 20);
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.bezierCurveTo(-10, -15, -20, -5, 0, 10);
      ctx.moveTo(0, -5);
      ctx.bezierCurveTo(10, -15, 20, -5, 0, 10);
      ctx.fillStyle = `rgba(255, 45, 117, ${opacity})`;
      ctx.fill();
      ctx.restore();
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw & update particles
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.pulse += 0.02;

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        const pulseSize = p.size + Math.sin(p.pulse) * 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulseSize, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      });

      // Draw connecting lines between close particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(180, 77, 255, ${0.08 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw & update hearts
      heartParticles.forEach(h => {
        h.y += h.vy;
        h.wobble += 0.015;
        h.x += Math.sin(h.wobble) * 0.3 + h.vx;

        if (h.y < -20) {
          h.y = canvas.height + 20;
          h.x = Math.random() * canvas.width;
        }

        drawHeart(h.x, h.y, h.size, h.opacity);
      });

      requestAnimationFrame(animate);
    }

    animate();
  }

  // ══════════════════════════════════════════════════════════
  // ANTI-SCREENSHOT PROTECTION
  // ══════════════════════════════════════════════════════════
  function initProtection() {
    // Disable right-click
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Block keyboard shortcuts
    document.addEventListener('keydown', e => {
      // PrintScreen
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        showShield();
      }
      // Ctrl+Shift+S, Ctrl+S (save)
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
      }
      // Ctrl+Shift+I (DevTools)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
        e.preventDefault();
      }
      // Ctrl+U (View Source)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
      }
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
      }
      // Ctrl+P (Print)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
      }
    });

    // Visibility change — hide content when tab loses focus
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        showShield();
      } else {
        hideShield();
      }
    });

    // Window blur — additional protection
    window.addEventListener('blur', () => {
      showShield();
    });

    window.addEventListener('focus', () => {
      hideShield();
    });

    // Disable drag
    document.addEventListener('dragstart', e => e.preventDefault());

    // Print protection
    window.addEventListener('beforeprint', () => {
      showShield();
    });

    window.addEventListener('afterprint', () => {
      hideShield();
    });
  }

  function showShield() {
    shieldOverlay.classList.add('active');
  }

  function hideShield() {
    shieldOverlay.classList.remove('active');
  }

  // ══════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ══════════════════════════════════════════════════════════
  function initLogin() {
    enterBtn.addEventListener('click', attemptLogin);
    secretCodeInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') attemptLogin();
    });
  }

  function attemptLogin() {
    const code = secretCodeInput.value.trim();
    if (!code) {
      showError('Enter a code to proceed');
      return;
    }

    enterBtn.disabled = true;
    enterBtn.querySelector('.btn-text').textContent = 'ACCESSING...';

    socket = io();

    socket.emit('authenticate', code, (response) => {
      if (response.success) {
        myAlias = response.alias;
        userAlias.textContent = myAlias;
        onlineCount.textContent = response.onlineCount;

        // Transition to chat
        loginView.classList.remove('active');
        chatView.classList.add('active');

        addSystemMessage(`You entered the void as <span class="highlight-pink">${myAlias}</span>`);
        initChat();
      } else {
        showError(response.message);
        enterBtn.disabled = false;
        enterBtn.querySelector('.btn-text').textContent = 'ENTER THE VOID';
        socket.disconnect();
        socket = null;
      }
    });

    socket.on('connect_error', () => {
      showError('CONNECTION FAILED — The void is unreachable');
      enterBtn.disabled = false;
      enterBtn.querySelector('.btn-text').textContent = 'ENTER THE VOID';
    });
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('shake');
    void errorMsg.offsetWidth; // Force reflow
    errorMsg.classList.add('shake');
  }

  // ══════════════════════════════════════════════════════════
  // CHAT
  // ══════════════════════════════════════════════════════════
  function initChat() {
    // Send message
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') sendMessage();
    });

    // Typing indicator
    messageInput.addEventListener('input', () => {
      if (!isTyping) {
        isTyping = true;
        socket.emit('typing', true);
      }
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        isTyping = false;
        socket.emit('typing', false);
      }, 1500);
    });

    // Leave button
    leaveBtn.addEventListener('click', leaveVoid);

    // Socket events
    socket.on('new-message', handleNewMessage);
    socket.on('destroy-message', handleDestroyMessage);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('user-typing', handleTyping);

    messageInput.focus();
  }

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket) return;

    socket.emit('send-message', { text });
    messageInput.value = '';
    isTyping = false;
    socket.emit('typing', false);
  }

  function handleNewMessage(msg) {
    const isSelf = msg.alias === myAlias;
    const el = createMessageElement(msg, isSelf);
    messagesContainer.appendChild(el);
    scrollToBottom();

    // If the message is from other user, mark as seen after a delay
    if (!isSelf) {
      setTimeout(() => {
        if (!seenMessages.has(msg.id)) {
          seenMessages.add(msg.id);
          socket.emit('message-seen', msg.id);
        }
      }, 3000); // 3-second window before self-destruct
    }
  }

  function handleDestroyMessage(messageId) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) {
      el.classList.add('destroying');
      setTimeout(() => {
        el.remove();
      }, 1200);
    }
  }

  function handleUserJoined(data) {
    onlineCount.textContent = data.onlineCount;
    addSystemMessage(`<span class="highlight-cyan">${data.alias}</span> entered the void`);
  }

  function handleUserLeft(data) {
    onlineCount.textContent = data.onlineCount;
    addSystemMessage(`<span class="highlight-pink">${data.alias}</span> vanished from the void`);
  }

  function handleTyping(data) {
    if (data.isTyping) {
      typingAlias.textContent = data.alias;
      typingIndicator.classList.remove('hidden');
    } else {
      typingIndicator.classList.add('hidden');
    }
  }

  function createMessageElement(msg, isSelf) {
    const div = document.createElement('div');
    div.className = `message ${isSelf ? 'self' : 'other'}`;
    div.setAttribute('data-msg-id', msg.id);

    const time = new Date(msg.timestamp);
    const timeStr = time.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    div.innerHTML = `
      <div class="message-alias">${escapeHtml(msg.alias)}</div>
      <div class="message-text">${escapeHtml(msg.text)}</div>
      <div class="message-time">
        ${timeStr}
        ${isSelf ? '<span class="message-status">💀</span>' : ''}
      </div>
    `;

    return div;
  }

  function addSystemMessage(html) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.innerHTML = `<div class="message-text">${html}</div>`;
    messagesContainer.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
  }

  function leaveVoid() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    // Clear all messages
    messagesContainer.innerHTML = '';
    seenMessages.clear();
    myAlias = '';

    // Return to login
    chatView.classList.remove('active');
    loginView.classList.add('active');
    secretCodeInput.value = '';
    errorMsg.textContent = '';
    enterBtn.disabled = false;
    enterBtn.querySelector('.btn-text').textContent = 'ENTER THE VOID';
  }

  // ══════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ══════════════════════════════════════════════════════════
  // INITIALIZE
  // ══════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initProtection();
    initLogin();
  });

})();
