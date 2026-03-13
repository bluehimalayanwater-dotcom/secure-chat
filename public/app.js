/* ══════════════════════════════════════════════════════════════
   THE VOID — Secret Chat Client
   ══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── DOM Elements ──────────────────────────────────────────
  const loginView = document.getElementById('login-view');
  const chatView = document.getElementById('chat-view');
  
  // Auth DOM
  const landingSection = document.getElementById('landing-section');
  const joinSection = document.getElementById('join-section');
  const inviteBox = document.getElementById('invite-box');
  const generateRoomBtn = document.getElementById('generate-room-btn');
  const aliasInput = document.getElementById('alias-input');
  const enterBtn = document.getElementById('enter-btn');
  const errorMsg = document.getElementById('error-msg');
  const inviteLinkInput = document.getElementById('invite-link');
  const copyBtn = document.getElementById('copy-btn');
  const messagesArea = document.getElementById('messages-area');
  const messagesContainer = document.getElementById('messages-container');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const onlineCount = document.getElementById('online-count');
  const userAlias = document.getElementById('user-alias');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingAlias = typingIndicator ? typingIndicator.querySelector('.typing-alias') : null;
  const leaveBtn = document.getElementById('leave-btn');
  const shieldOverlay = document.getElementById('shield-overlay');
  const burnNoticeBtn = document.getElementById('burn-notice-btn');

  // Animation DOM
  const hackingOverlay = document.getElementById('hacking-overlay');
  const hackCode = document.getElementById('hack-code');
  const hackProgressFill = document.querySelector('.hack-progress-fill');
  const inviteModal = document.getElementById('invite-modal');

  // ── State ─────────────────────────────────────────────────
  let socket = null;
  let myAlias = '';
  let typingTimeout = null;
  let isTyping = false;
  let seenMessages = new Set();
  
  // ── Crypto State (E2EE) ───────────────────────────────────
  let sharedCryptoKey = null;
  
  // ── Dead Man's Switch ─────────────────────────────────────
  let inactivityTimer = null;
  const INACTIVITY_LIMIT = 120000; // 2 minutes in ms

  // ── Audio System (Web Audio API) ──────────────────────────
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let audioCtx;

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
  }

  function playSound(type) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'beep') {
      // Keystroke / Typing
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
      gainNode.gain.setValueAtTime(0.05, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'error') {
      // Error buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(100, now + 0.3);
      gainNode.gain.setValueAtTime(0.1, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'chime') {
      // Message received
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
      gainNode.gain.setValueAtTime(0.1, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  }

  // ── Text Scramble Effect ──────────────────────────────────
  class TextScramble {
    constructor(el) {
      this.el = el;
      this.chars = '!<>-_\\\\/[]{}—=+*^?#________';
      this.update = this.update.bind(this);
    }
    setText(newText) {
      const oldText = this.el.innerText;
      const length = Math.max(oldText.length, newText.length);
      const promise = new Promise((resolve) => this.resolve = resolve);
      this.queue = [];
      for (let i = 0; i < length; i++) {
        const from = oldText[i] || '';
        const to = newText[i] || '';
        const start = Math.floor(Math.random() * 40);
        const end = start + Math.floor(Math.random() * 40);
        this.queue.push({ from, to, start, end });
      }
      cancelAnimationFrame(this.frameRequest);
      this.frame = 0;
      this.update();
      return promise;
    }
    update() {
      let output = '';
      let complete = 0;
      for (let i = 0, n = this.queue.length; i < n; i++) {
        let { from, to, start, end, char } = this.queue[i];
        if (this.frame >= end) {
          complete++;
          output += to;
        } else if (this.frame >= start) {
          if (!char || Math.random() < 0.28) {
            char = this.randomChar();
            this.queue[i].char = char;
          }
          output += `<span class="glitch-char">${char}</span>`;
        } else {
          output += from;
        }
      }
      this.el.innerHTML = output;
      if (complete === this.queue.length) {
        this.resolve();
      } else {
        this.frameRequest = requestAnimationFrame(this.update);
        this.frame++;
      }
    }
    randomChar() {
      return this.chars[Math.floor(Math.random() * this.chars.length)];
    }
  }

  // ══════════════════════════════════════════════════════════
  // END-TO-END ENCRYPTION (Web Crypto API)
  // ══════════════════════════════════════════════════════════
  
  async function initCryptoKey(secretString, saltBase64) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(secretString),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    
    // Decode salt from Base64
    const binarySalt = atob(saltBase64);
    const saltBytes = new Uint8Array(binarySalt.length);
    for (let i = 0; i < binarySalt.length; i++) {
      saltBytes[i] = binarySalt.charCodeAt(i);
    }

    // Use PBKDF2 to derive a strong AES-GCM 256-bit key from the string and dynamic salt
    sharedCryptoKey = await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptMessage(text) {
    if (!sharedCryptoKey) return text;
    try {
      const enc = new TextEncoder();
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        sharedCryptoKey,
        enc.encode(text)
      );
      
      // Combine IV and Ciphertext into one Base64 string for easy Socket.io transport
      const cipherBytes = new Uint8Array(ciphertext);
      const payload = new Uint8Array(iv.length + cipherBytes.length);
      payload.set(iv, 0);
      payload.set(cipherBytes, iv.length);
      
      // Convert to Base64 (using browser btoa)
      return btoa(String.fromCharCode(...payload));
    } catch (e) {
      console.error("Encryption failed:", e);
      return "[ENCRYPTION ERROR]";
    }
  }

  async function decryptMessage(encryptedBase64Text) {
    if (!sharedCryptoKey) return "[KEY MISSING]";
    try {
      // Decode Base64
      const binaryStr = atob(encryptedBase64Text);
      const payload = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        payload[i] = binaryStr.charCodeAt(i);
      }
      
      // Extract IV (first 12 bytes) and Ciphertext
      const iv = payload.slice(0, 12);
      const ciphertext = payload.slice(12);
      
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        sharedCryptoKey,
        ciphertext
      );
      
      const dec = new TextDecoder();
      return dec.decode(decrypted);
    } catch (e) {
      console.error("Decryption failed:", e);
      return "▒▒▒▒▒▒ [DECRYPTION FAILED] ▒▒▒";
    }
  }

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
      
      // Panic Button (Escape)
      if (e.key === 'Escape') {
        e.preventDefault();
        triggerPanicMode();
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
  // PANIC MODE & BURN NOTICE
  // ══════════════════════════════════════════════════════════
  function triggerPanicMode(isBurnNotice = false) {
    // 1. Alert others before disconnecting (if I initiated the panic)
    if (socket && !isBurnNotice) {
      socket.emit('burn-notice');
    }

    // 2. Immediately disconnect socket
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    
    // 3. Nuke the Audio context
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }

    // 4. Decoy UI (Google / Wikipedia style iframe)
    document.body.className = ''; // Remove all classes (e.g. panic-mode, glitches)
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    
    // Inject benign Wikipedia iframe
    document.body.innerHTML = `
      <iframe src="https://en.wikipedia.org/wiki/Special:Random" 
              style="width:100vw; height:100vh; border:none; margin:0; padding:0;">
      </iframe>
    `;
    
    // 5. Change document title & favicon
    document.title = "Wikipedia, the free encyclopedia";
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = 'https://en.wikipedia.org/favicon.ico';

    // Unrecoverable state
  }

  // ══════════════════════════════════════════════════════════
  // DEAD MAN'S SWITCH (INACTIVITY AUTO-NUKE)
  // ══════════════════════════════════════════════════════════
  function initDeadMansSwitch() {
    function resetTimer() {
      // If already panicked, do nothing
      if (document.title === "Wikipedia, the free encyclopedia") return;

      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        // Auto-nuke after 2 minutes of no movement
        triggerPanicMode();
      }, INACTIVITY_LIMIT);
    }

    // Listen for activity across the whole document
    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keydown', resetTimer);
    document.addEventListener('scroll', resetTimer);
    document.addEventListener('touchstart', resetTimer);
    
    // Start initial countdown
    resetTimer();
  }

  // ══════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ══════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════
  // AUTHENTICATION & ROOM GENERATION
  // ══════════════════════════════════════════════════════════
  
  // URL Params parsing
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get('room');
  
  // Extract key and salt from hash: #key:salt
  let e2eeKeyFromHash = null;
  let saltFromHash = null;
  if (window.location.hash) {
    const hashContent = window.location.hash.substring(1);
    if (hashContent.includes(':')) {
      [e2eeKeyFromHash, saltFromHash] = hashContent.split(':');
    }
  }

  function initLogin() {
    if (roomIdFromUrl && e2eeKeyFromHash && saltFromHash) {
      // Joining mode
      landingSection.classList.remove('active-section');
      landingSection.classList.add('hidden-section');
      joinSection.classList.remove('hidden-section');
      joinSection.classList.add('active-section');
      
      enterBtn.addEventListener('click', attemptLogin);
      aliasInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') attemptLogin();
      });
      aliasInput.focus();
    } else {
      // Generating mode
      generateRoomBtn.addEventListener('click', generateDynamicRoom);
    }
    
    copyBtn.addEventListener('click', copyInviteLink);
  }

  async function generateDynamicRoom() {
    initAudio();
    generateRoomBtn.disabled = true;
    const btnText = generateRoomBtn.querySelector('.btn-text');
    const scrambler = new TextScramble(btnText);
    scrambler.setText('ALLOCATING...');
    
    try {
      const res = await fetch('/api/create-room', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        // Generate E2EE key locally
        const newSecret = window.crypto.getRandomValues(new Uint8Array(32));
        const newSecretHex = Array.from(newSecret).map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Generate random dynamic salt
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const saltBase64 = btoa(String.fromCharCode(...salt));
        
        // Construct invite link: /?room=ID#secret:salt
        const inviteUrl = `${window.location.origin}/?room=${data.room}#${newSecretHex}:${saltBase64}`;
        inviteLinkInput.value = inviteUrl;
        
        // --- SCIFI HACKING SEQUENCE ---
        
        // 1. Hide auth section
        landingSection.classList.add('hidden-section');
        landingSection.classList.remove('active-section');
        
        // 2. Show hacking overlay
        hackingOverlay.classList.remove('hidden-section');
        hackingOverlay.classList.add('active-section');
        playSound('beep'); // Initiate sequence

        // 3. Run the crypto-decoding visual effect
        let decodeInterval = setInterval(() => {
          // Generate random hex-like chunk
          hackCode.textContent = '0x' + Math.random().toString(16).substr(2, 8).toUpperCase();
          playSound('beep');
        }, 80);

        // 4. Animate progress bar
        setTimeout(() => { hackProgressFill.style.width = '30%'; }, 100);
        setTimeout(() => { hackProgressFill.style.width = '70%'; }, 800);
        setTimeout(() => { hackProgressFill.style.width = '100%'; }, 1500);

        // 5. Complete animation and show modal
        setTimeout(() => {
          clearInterval(decodeInterval);
          hackCode.textContent = "DECRYPTED";
          playSound('chime');
          
          setTimeout(() => {
            // Hide overlay
            hackingOverlay.classList.remove('active-section');
            hackingOverlay.classList.add('hidden-section');
            hackProgressFill.style.width = '0%'; // reset
            
            // Show sleek modal
            inviteModal.classList.remove('hidden-section');
            inviteModal.classList.add('active-section');
          }, 400); // Wait a moment on "DECRYPTED"
        }, 1800);

      } else {
        throw new Error(data.message || 'Server rejected creation');
      }
    } catch (e) {
      showError(e.message || 'Failed to generate room. Server unreachable.');
      generateRoomBtn.disabled = false;
      scrambler.setText('GENERATE A SECURE ROOM');
      playSound('error');
    }
  }

  function copyInviteLink() {
    inviteLinkInput.select();
    document.execCommand('copy');
    copyBtn.querySelector('span').textContent = 'COPIED';
    setTimeout(() => copyBtn.querySelector('span').textContent = 'COPY', 2000);
  }

  async function attemptLogin() {
    const alias = aliasInput.value.trim();
    if (!alias) {
      showError('Choose an alias to proceed');
      playSound('error');
      return;
    }
    if (!roomIdFromUrl || !e2eeKeyFromHash || !saltFromHash) {
      showError('Invalid or corrupted invite link');
      playSound('error');
      return;
    }

    // Initialize audio on first user gesture
    initAudio();
    // Initialize Crypto Key from the URL Hash and Salt
    await initCryptoKey(e2eeKeyFromHash, saltFromHash);

    enterBtn.disabled = true;
    const btnText = enterBtn.querySelector('.btn-text');
    
    // Terminal scramble effect
    const scrambler = new TextScramble(btnText);
    scrambler.setText('ACCESSING...');
    
    // Play accessing sound
    let beepInterval = setInterval(() => playSound('beep'), 150);

    socket = io();

    socket.emit('authenticate', { room: roomIdFromUrl, alias: alias }, (response) => {
      clearInterval(beepInterval);

      if (response.success) {
        myAlias = response.alias;
        userAlias.textContent = myAlias;
        onlineCount.textContent = response.onlineCount;

        // Transition to chat
        loginView.classList.remove('active');
        chatView.classList.add('active');

        playSound('chime');
        addSystemMessage(`You entered the void as <span class="highlight-pink">${myAlias}</span>`);
        initChat();
        initDeadMansSwitch();
        
        // Reset button
        btnText.textContent = 'ENTER THE VOID';
      } else {
        playSound('error');
        showError(response.message);
        enterBtn.disabled = false;
        scrambler.setText('ENTER THE VOID');
        socket.disconnect();
        socket = null;
      }
    });

    socket.on('connect_error', () => {
      showError('CONNECTION FAILED — The void is unreachable');
      enterBtn.disabled = false;
      enterBtn.querySelector('.btn-text').textContent = 'ENTER THE VOID';
      clearInterval(beepInterval);
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
      playSound('beep');
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

    // Burn Room button
    if (burnNoticeBtn) {
      burnNoticeBtn.addEventListener('click', () => {
        if (confirm("🚨 ARE YOU SURE? This will permanently incinerate this room and all its logs for everyone.")) {
          triggerPanicMode();
        }
      });
    }

    // Socket events
    socket.on('new-message', handleNewMessage);
    socket.on('destroy-message', handleDestroyMessage);
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('user-typing', handleTyping);
    
    // Burn Notice event from server
    socket.on('execute-burn', () => {
      triggerPanicMode(true); // pass true so we don't rebroadcast an infinite loop
    });

    messageInput.focus();
  }

  async function sendMessage() {
    const rawText = messageInput.value.trim();
    if (!rawText || !socket) return;
    
    // Reset typing immediately
    messageInput.value = '';
    isTyping = false;
    socket.emit('typing', false);

    // E2EE: Encrypt before emitting
    const encryptedPayload = await encryptMessage(rawText);
    socket.emit('send-message', { text: encryptedPayload });
  }

  async function handleNewMessage(msg) {
    const isSelf = msg.alias === myAlias;
    
    // E2EE: Decrypt payload
    const decryptedText = await decryptMessage(msg.text);
    msg.text = decryptedText;
    
    const el = createMessageElement(msg, isSelf);
    messagesContainer.appendChild(el);
    scrollToBottom();

    // If the message is from other user, mark as seen after a delay and play chime
    if (!isSelf) {
      playSound('chime');
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
    aliasInput.value = '';
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
