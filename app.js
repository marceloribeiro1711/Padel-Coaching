(function () {
    // ── Polyfill TextEncoder/TextDecoder para Android 8 WebView ──────────────
    if (typeof TextEncoder === 'undefined') {
        window.TextEncoder = function() {};
        window.TextEncoder.prototype.encode = function(str) {
            var out = [];
            for (var i = 0; i < str.length; i++) {
                var c = str.charCodeAt(i);
                if (c < 128) { out.push(c); }
                else if (c < 2048) { out.push((c >> 6) | 192, (c & 63) | 128); }
                else { out.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128); }
            }
            return new Uint8Array(out);
        };
    }
    // ============================================================
    // LICENSE SYSTEM — Voucher-based activation
    // ============================================================
    const LIC_KEY       = 'padel_license';
    const LIC_USED_KEY  = 'padel_used_vouchers';
    const APP_VERSION   = '1.1.88';

    // ---- Algoritmo HMAC — idêntico ao Vouchers.html ----
    const SECRET_KEY   = 'PadelCoaching-Voucher-Secret-2026-ChangeThisInProd';
    const B32_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const EPOCH        = new Date('2026-01-01T00:00:00Z').getTime();
    const TRIAL_HOURS  = 24;

    async function hmacSha256(keyStr, dataBytes) {
        if (!window.crypto || !window.crypto.subtle) {
            throw new Error('Web Crypto API not available. Please use Chrome on HTTPS.');
        }
        try {
            const enc = new TextEncoder();
            const key = await crypto.subtle.importKey(
                'raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
            );
            const sig = await crypto.subtle.sign('HMAC', key, dataBytes);
            return new Uint8Array(sig);
        } catch(e) {
            throw new Error('Crypto error: ' + e.message);
        }
    }

    function base32ToBytes(str) {
        let bits = '';
        for (const c of str) {
            const idx = B32_ALPHABET.indexOf(c);
            if (idx < 0) throw new Error('bad char');
            bits += idx.toString(2).padStart(5, '0');
        }
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8)
            bytes.push(parseInt(bits.slice(i, i + 8), 2));
        return new Uint8Array(bytes);
    }

    function readUintBE(bytes, off, len) {
        let v = 0;
        for (let i = 0; i < len; i++) v = v * 256 + bytes[off + i];
        return v;
    }

    function concatU8(...arrays) {
        const total = arrays.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const a of arrays) { out.set(a, off); off += a.length; }
        return out;
    }

    function hexToU8(hex) {
        const b = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) b[i/2] = parseInt(hex.substr(i, 2), 16);
        return b;
    }

    async function parseVoucher(voucherStr) {
        const clean = voucherStr.replace(/-/g, '').toUpperCase();
        let bytes;
        try { bytes = base32ToBytes(clean); } catch(e) { return null; }
        if (bytes.length < 13) return null;

        const deviceIdBytes = bytes.slice(0, 5);
        const durationByte  = bytes.slice(5, 6);
        const issuedAtBytes = bytes.slice(6, 9);
        const sig           = bytes.slice(9, 13);

        const payload = concatU8(deviceIdBytes, durationByte, issuedAtBytes);
        const hmac    = await hmacSha256(SECRET_KEY, payload);
        const expSig  = hmac.slice(0, 4);

        if (!sig.every((b, i) => b === expSig[i])) return null; // assinatura inválida

        const deviceId     = Array.from(deviceIdBytes).map(b => b.toString(16).padStart(2,'0')).join('');
        const durationHours = durationByte[0];
        const issuedAt     = EPOCH + readUintBE(issuedAtBytes, 0, 3) * 60000;
        return { deviceId, durationHours, issuedAt };
    }

    // ---- Device fingerprint ----
    async function sha256hex(str) {
        if (window.crypto && window.crypto.subtle) {
            try {
                const data = new TextEncoder().encode(str);
                const hash = await crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
            } catch(e) {}
        }
        // Fallback: simple deterministic hash for older browsers
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h * 0x01000193) >>> 0;
        }
        // Extend to 10 hex chars using multiple passes
        let result = '';
        let seed = h;
        while (result.length < 10) {
            seed = (seed * 0x6b43a9b5 + 0x1) >>> 0;
            result += seed.toString(16).padStart(8, '0');
        }
        return result.slice(0, 10);
    }

    async function getCanvasFP() {
        try {
            const c = document.createElement('canvas');
            c.width = 200; c.height = 40;
            const ctx = c.getContext('2d');
            if (!ctx) return 'no-canvas';
            ctx.textBaseline = 'alphabetic';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#c8e030';
            ctx.fillText('PadelCoaching2026', 10, 28); // sem emoji — Android 8 pode falhar
            ctx.fillStyle = 'rgba(11,26,53,0.5)';
            ctx.fillRect(30, 5, 80, 20);
            return c.toDataURL().slice(-32);
        } catch(e) { return 'no-canvas'; }
    }

    async function computeDeviceId() {
        try {
            const canvasFP = await getCanvasFP();
            const fp = [
                navigator.userAgent || '',
                navigator.language || '',
                ((navigator.languages || []).join ? navigator.languages.join(',') : ''),
                navigator.platform || '',
                String(navigator.hardwareConcurrency || 0),
                String(navigator.deviceMemory || 0),
                String(screen.width || 0),
                String(screen.height || 0),
                String(screen.colorDepth || 0),
                String(window.devicePixelRatio || 1),
                (Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : '') || '',
                String(navigator.maxTouchPoints || 0),
                canvasFP,
            ].join('|');
            const hash = await sha256hex(fp);
            return hash.slice(0, 10).toUpperCase();
        } catch(e) {
            // Fallback robusto para Android 8 — usar apenas userAgent + screen
            const simple = (navigator.userAgent || '') + '|' + screen.width + 'x' + screen.height;
            return await sha256hex(simple).then(h => h.slice(0, 10).toUpperCase()).catch(() => 'FALLBACK001');
        }
    }

    // ---- License storage ----
    function saveLicenseCookie(obj) {
        try {
            const val = encodeURIComponent(JSON.stringify(obj));
            // Cookie com duração de 2 anos — por vezes sobrevive a desinstalação no Android
            const expires = new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000).toUTCString();
            document.cookie = `padel_lic=${val}; expires=${expires}; path=/; SameSite=Strict`;
        } catch(e) {}
    }

    function loadLicenseCookie() {
        try {
            const match = document.cookie.match(/(?:^|;\s*)padel_lic=([^;]*)/);
            if (match) return JSON.parse(decodeURIComponent(match[1]));
        } catch(e) {}
        return null;
    }

    function loadLicense() {
        // Tentar localStorage primeiro
        try {
            const ls = JSON.parse(localStorage.getItem(LIC_KEY));
            if (ls) return ls;
        } catch(e) {}
        // Fallback: cookie (sobrevive a reinstalações)
        const cookie = loadLicenseCookie();
        if (cookie) {
            // Migrar para localStorage
            try { localStorage.setItem(LIC_KEY, JSON.stringify(cookie)); } catch(e) {}
            return cookie;
        }
        return {};
    }

    function saveLicense(obj) {
        try { localStorage.setItem(LIC_KEY, JSON.stringify(obj)); } catch(e) {}
        saveLicenseCookie(obj); // guardar também em cookie
    }
    function loadUsedVouchers() {
        try { return JSON.parse(localStorage.getItem(LIC_USED_KEY)) || []; } catch(e) { return []; }
    }
    function markVoucherUsed(voucherClean) {
        const list = loadUsedVouchers();
        if (!list.includes(voucherClean)) {
            list.push(voucherClean);
            try { localStorage.setItem(LIC_USED_KEY, JSON.stringify(list.slice(-100))); } catch(e) {}
        }
    }

    // ---- Anti-clock-rollback: record max timestamp seen ----
    function updateMaxTimestamp() {
        const lic = loadLicense();
        const now = Date.now();
        if (!lic.maxTs || now > lic.maxTs) {
            lic.maxTs = now;
            saveLicense(lic);
        }
        return Math.max(now, lic.maxTs || now);
    }

    function trustedNow() {
        const lic = loadLicense();
        const now = Date.now();
        return Math.max(now, lic.maxTs || now);
    }

    // ---- License bar update ----
    function updateLicenseBar() {
        const bar = document.getElementById('license-bar');
        const textEl = document.getElementById('license-bar-text');
        const verEl  = document.getElementById('license-bar-version');
        if (!bar || !textEl) return;
        const lic = loadLicense();
        const now = trustedNow();

        if (verEl) verEl.textContent = `V ${APP_VERSION}`;
        var cfgVerEl = document.getElementById('config-version-label');
        if (cfgVerEl) cfgVerEl.textContent = `V ${APP_VERSION}`;

        if (!lic.activationTs) {
            const durLabel = lic.durationHours
                ? `${lic.durationHours}h available`
                : `${TRIAL_HOURS}h trial available`;
            textEl.textContent = `${durLabel} — starts on first game`;
            bar.className = 'license-bar pending';
        } else {
            const expiresAt = lic.activationTs + (lic.durationHours || TRIAL_HOURS) * 3600000;
            if (now >= expiresAt) {
                textEl.textContent = 'License expired — new game blocked';
                bar.className = 'license-bar expired';
            } else {
                const d = new Date(expiresAt);
                const pad = n => String(n).padStart(2, '0');
                textEl.textContent = `Active until ${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                bar.className = 'license-bar active';
            }
        }
    }

    // ---- License overlay ----
    let _deviceId = null;

    function showLicenseOverlay(message, showVoucherField) {
        const el = document.getElementById('license-overlay');
        el.classList.add('show');
        document.getElementById('license-version').textContent = `V ${APP_VERSION}`;
        document.getElementById('license-device-id').textContent = _deviceId || '…';
        document.getElementById('license-message').textContent = message;
        document.getElementById('license-voucher-area').style.display = showVoucherField ? 'flex' : 'none';
        document.getElementById('license-error').textContent = '';
        document.getElementById('license-voucher-input').value = '';
    }

    function copyDeviceId() {
        if (!_deviceId) return;
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = _deviceId;
            ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); showToast('📋 Device ID copiado'); }
            catch(e) { showToast('Selecciona o ID manualmente'); }
            document.body.removeChild(ta);
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(_deviceId).then(() => showToast('📋 Device ID copiado')).catch(fallback);
        } else { fallback(); }
    }

    function hideLicenseOverlay() {
        document.getElementById('license-overlay').classList.remove('show');
    }

    async function activateVoucher() {
        const raw = document.getElementById('license-voucher-input').value.trim();
        const errorEl = document.getElementById('license-error');
        errorEl.textContent = '';

        if (!raw) { errorEl.textContent = 'Enter a voucher code.'; return; }

        const clean = raw.replace(/-/g, '').toUpperCase();

        // Verificar se já foi usado neste dispositivo
        if (loadUsedVouchers().includes(clean)) {
            errorEl.textContent = 'This voucher has already been used.';
            return;
        }

        const parsed = await parseVoucher(raw);
        if (!parsed) {
            errorEl.textContent = 'Invalid voucher — signature does not match.';
            return;
        }
        if (parsed.deviceId !== _deviceId.toLowerCase()) {
            errorEl.textContent = `This voucher is for a different device. This device ID: ${(_deviceId || '?').toUpperCase()}`;
            return;
        }

        // Válido — gravar licença (activationTs a null até ao primeiro jogo)
        const lic = loadLicense();
        lic.durationHours = parsed.durationHours;
        lic.activationTs  = null; // começa no primeiro askResetMatch
        lic.issuedAt      = parsed.issuedAt;
        lic.voucherClean  = clean;
        saveLicense(lic);
        markVoucherUsed(clean);

        hideLicenseOverlay();
        updateLicenseBar();
        showToast(`✅ Voucher activated — ${parsed.durationHours}h licence`);
    }

    // Formatar input do voucher
    document.addEventListener('DOMContentLoaded', () => {});
    const vInput = document.getElementById('license-voucher-input');
    if (vInput) {
        vInput.addEventListener('input', function() {
            this.value = this.value.toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ-]/g, '');
        });
    }

    // ---- Verificação de licença (chamada por askResetMatch) ----
    function checkLicenseForNewGame() {
        const lic   = loadLicense();
        const now   = trustedNow();

        // Sem nenhuma concessão — mostrar tela de trial/voucher
        if (!lic.durationHours && !lic.trialGranted) {
            // Primeira vez absoluta — conceder trial
            lic.trialGranted  = true;
            lic.durationHours = TRIAL_HOURS;
            lic.activationTs  = null;
            saveLicense(lic);
        }

        // activationTs ainda não definido — primeiro jogo desta concessão
        if (!lic.activationTs) {
            lic.activationTs = now;
            lic.maxTs = now;
            saveLicense(lic);
            updateLicenseBar();
            return true; // permitir o jogo
        }

        // Verificar expiração
        const expiresAt = lic.activationTs + (lic.durationHours || TRIAL_HOURS) * 3600000;
        updateMaxTimestamp();

        if (now < expiresAt) {
            return true; // dentro do prazo
        }

        // Expirado — bloquear e mostrar overlay
        const msg = lic.trialGranted && !lic.voucherClean
            ? `Your ${TRIAL_HOURS}h free trial has expired. Enter a voucher to continue.`
            : 'Your licence has expired. Enter a voucher to continue.';
        showLicenseOverlay(msg, true);
        return false;
    }

    // ---- Init: calcular device ID e verificar licença ao arrancar ----
    computeDeviceId().then(id => {
        _deviceId = id;
        const el = document.getElementById('license-device-id');
        if (el) el.textContent = id;
        updateMaxTimestamp();

        // Verificar licença ao arrancar — se expirada, mostrar overlay imediatamente
        const lic = loadLicense();
        const now = trustedNow();
        if (lic.activationTs) {
            const expiresAt = lic.activationTs + (lic.durationHours || TRIAL_HOURS) * 3600000;
            if (now >= expiresAt) {
                const msg = lic.trialGranted && !lic.voucherClean
                    ? 'Your ' + TRIAL_HOURS + 'h free trial has expired. Enter a voucher to continue.'
                    : 'Your licence has expired. Enter a voucher to continue.';
                showLicenseOverlay(msg, true);
                return;
            }
        }
        updateLicenseBar();
    }).catch(function(e) {
        // Garantir que a app nunca fica bloqueada por falha no fingerprint
        _deviceId = 'ERRORID001';
        console.warn('[License] Device ID failed:', e);
        updateLicenseBar();
    });

    // ============================================================
    // SERVE INDICATOR SYSTEM
    // ============================================================
    // Players: 0=t1-p1, 1=t1-p2, 2=t2-p1, 3=t2-p2
    // Teams:   0=dupla1 (players 0,1), 1=dupla2 (players 2,3)
    const SERVE = {
        current: null,
        gamesPlayed: 0,
        gamesThisSet: 0,     // games jogados neste set (reset em cada novo set)
        phase: 'pick-any',
        firstTeam: 0,
        tbPoints: 0,
        tbFirst: null,
        t1FirstServer: null,
        t2FirstServer: null,
    };

    const SERVE_IDS = ['t1-p1', 't1-p2', 't2-p1', 't2-p2'];

    function serveBall(playerIdx) {
        return document.getElementById('serve-ball-' + SERVE_IDS[playerIdx]);
    }

    function renderServeBalls() {
        SERVE_IDS.forEach((id, i) => {
            const ball = document.getElementById('serve-ball-' + id);
            const lsBall = document.getElementById('ls-serve-ball-' + id);
            [ball, lsBall].forEach(function(b) {
                if (!b) return;
                b.classList.remove('active', 'pending');
            });

            if (SERVE.phase === 'pick-any') {
                if (ball) ball.classList.add('pending'); // todas piscam
                if (lsBall) lsBall.classList.add('pending');
            } else if (SERVE.phase === 'pick-t2') {
                if (i === 2 || i === 3) {
                    if (ball) ball.classList.add('pending'); // dupla 2 pisca
                    if (lsBall) lsBall.classList.add('pending');
                }
            } else if (SERVE.phase === 'pick-t1') {
                if (i === 0 || i === 1) {
                    if (ball) ball.classList.add('pending'); // dupla 1 pisca
                    if (lsBall) lsBall.classList.add('pending');
                }
            } else if (SERVE.phase === 'auto' || SERVE.phase === 'tb') {
                if (SERVE.current === i) {
                    if (ball) ball.classList.add('active');
                    if (lsBall) lsBall.classList.add('active');
                }
            }
        });
    }

    function serveTeamOf(playerIdx) {
        return playerIdx < 2 ? 0 : 1;
    }

    // Calcular próximo servidor automático após um game
    // Usa gamesThisSet para alternância correcta dentro de cada set
    function calcNextServer(gamesAfterInSet) {
        const ft = SERVE.firstTeam || 0;
        // Alterna a cada game: ft serve games ímpares, 1-ft serve games pares
        const team = ((gamesAfterInSet - 1) % 2 === 0) ? ft : (1 - ft);
        // Quantas vezes esta dupla já serviu antes deste game neste set
        const timesServed = Math.floor((gamesAfterInSet - 1) / 2);

        if (team === 0) {
            const first = SERVE.t1FirstServer !== null ? SERVE.t1FirstServer : 0;
            return (timesServed % 2 === 0) ? first : (first === 0 ? 1 : 0);
        } else {
            const first = SERVE.t2FirstServer !== null ? SERVE.t2FirstServer : 0;
            return (timesServed % 2 === 0) ? (2 + first) : (2 + (first === 0 ? 1 : 0));
        }
    }

    // Chamado quando um game termina (winGame)
    function onGameEnd() {
        if (SERVE.phase === 'off') return;
        SERVE.gamesPlayed++;
        SERVE.gamesThisSet++;
        SERVE.tbPoints = 0;

        if (state.isTieBreakMode || state.isSuperTieBreak) {
            SERVE.phase = 'tb';
            const nextNormal = calcNextServer(SERVE.gamesThisSet);
            SERVE.current = nextNormal;
            SERVE.tbFirst = nextNormal;
            SERVE.tbPoints = 0;
            renderServeBalls();
            return;
        }

        // Game 2 de cada set: dupla adversária escolhe livremente quem serve
        if (SERVE.gamesThisSet === 1) {
            if (SERVE.firstTeam === 0 && SERVE.t2FirstServer === null) {
                SERVE.phase = 'pick-t2';
                renderServeBalls();
                return;
            }
            if (SERVE.firstTeam === 1 && SERVE.t1FirstServer === null) {
                SERVE.phase = 'pick-t1';
                renderServeBalls();
                return;
            }
        }

        SERVE.phase = 'auto';
        SERVE.current = calcNextServer(SERVE.gamesThisSet + 1);
        renderServeBalls();
    }

    // Servidor para o ponto N do tiebreak (0-indexed)
    // Padrão: ponto 0 → tbFirst (1 ponto), depois 2 a 2 alternando duplas
    // seguindo a sequência normal de jogadores
    function tbServerAtPoint(pointIdx) {
        const first = SERVE.tbFirst;
        const firstTeam = first < 2 ? 0 : 1;

        if (pointIdx === 0) return first;

        // A partir do ponto 1: blocos de 2, começando pela dupla adversária
        // ponto 1-2 → adversário, ponto 3-4 → first team, ponto 5-6 → adversário, ...
        const blockIdx = Math.floor((pointIdx - 1) / 2); // 0, 0, 1, 1, 2, 2, ...
        const teamThisBlock = blockIdx % 2 === 0 ? (1 - firstTeam) : firstTeam;

        // Quantas vezes cada equipa já serviu ANTES deste bloco (incluindo o ponto 0)
        // firstTeam: 1 vez (ponto 0) + Math.floor((blockIdx+1)/2) vezes de blocos
        // adversário: Math.ceil(blockIdx/2) + (blockIdx%2===0?1:0) ...
        // Mais simples: contar directamente
        let firstTeamServes = 1; // o ponto 0
        let advTeamServes = 0;
        for (let b = 0; b < blockIdx; b++) {
            if (b % 2 === 0) advTeamServes++;
            else firstTeamServes++;
        }

        if (teamThisBlock === firstTeam) {
            // Quantas vezes o firstTeam serviu antes → determina qual jogador
            const timesServed = firstTeamServes;
            if (firstTeam === 0) {
                const f = SERVE.t1FirstServer !== null ? SERVE.t1FirstServer : 0;
                return timesServed % 2 === 0 ? f : (f === 0 ? 1 : 0);
            } else {
                const f = SERVE.t2FirstServer !== null ? SERVE.t2FirstServer : 0;
                return timesServed % 2 === 0 ? (2 + f) : (2 + (f === 0 ? 1 : 0));
            }
        } else {
            const timesServed = advTeamServes;
            if ((1 - firstTeam) === 0) {
                const f = SERVE.t1FirstServer !== null ? SERVE.t1FirstServer : 0;
                return timesServed % 2 === 0 ? f : (f === 0 ? 1 : 0);
            } else {
                const f = SERVE.t2FirstServer !== null ? SERVE.t2FirstServer : 0;
                return timesServed % 2 === 0 ? (2 + f) : (2 + (f === 0 ? 1 : 0));
            }
        }
    }

    function onTbPoint() {
        if (SERVE.phase !== 'tb') return;
        // tbPoints já foi incrementado antes desta chamada (no addPoint)
        SERVE.current = tbServerAtPoint(SERVE.tbPoints);
        renderServeBalls();
    }

    // Tocar numa bola para seleccionar/corrigir servidor
    function onServeBallTap(playerIdx) {
        if (SERVE.phase === 'off') return;

        if (SERVE.phase === 'pick-any') {
            SERVE.current = playerIdx;
            SERVE.firstTeam = playerIdx < 2 ? 0 : 1;
            if (playerIdx < 2) {
                SERVE.t1FirstServer = playerIdx;
            } else {
                SERVE.t2FirstServer = playerIdx - 2;
            }
            if (state.isSuperTieBreak) {
                SERVE.phase = 'tb';
                SERVE.tbFirst = playerIdx;
            } else {
                SERVE.phase = 'auto';
            }
            renderServeBalls();
            return;
        }

        if (SERVE.phase === 'pick-t2') {
            if (playerIdx < 2) return;
            SERVE.t2FirstServer = playerIdx - 2;
            SERVE.current = playerIdx;
            if (state.isSuperTieBreak) {
                SERVE.phase = 'tb';
                SERVE.tbFirst = playerIdx;
            } else {
                SERVE.phase = 'auto';
            }
            renderServeBalls();
            return;
        }

        if (SERVE.phase === 'pick-t1') {
            if (playerIdx >= 2) return;
            SERVE.t1FirstServer = playerIdx;
            SERVE.current = playerIdx;
            if (state.isSuperTieBreak) {
                SERVE.phase = 'tb';
                SERVE.tbFirst = playerIdx;
            } else {
                SERVE.phase = 'auto';
            }
            renderServeBalls();
            return;
        }

        // 'auto' ou 'tb' — correcção manual
        SERVE.current = playerIdx;
        if (state.isSuperTieBreak) {
            // No supertie, correcção manual actualiza tbFirst
            SERVE.tbFirst = playerIdx;
            SERVE.tbPoints = 0; // reiniciar sequência a partir do novo servidor
        }
        if (playerIdx < 2) {
            SERVE.t1FirstServer = playerIdx;
        } else {
            SERVE.t2FirstServer = playerIdx - 2;
        }
        renderServeBalls();
    }

    // Iniciar/reiniciar o sistema de serviço (início de jogo ou novo set)
    function initServe() {
        SERVE.phase = 'pick-any';
        SERVE.current = null;
        SERVE.gamesPlayed = 0;
        SERVE.gamesThisSet = 0;
        SERVE.firstTeam = 0;
        SERVE.tbPoints = 0;
        SERVE.tbFirst = null;
        SERVE.t1FirstServer = null;
        SERVE.t2FirstServer = null;
        _serveStatCounted = false;
        renderServeBalls();
    }

    function initServeNewSet(lastServerBeforeSet) {
        // A dupla que serve o 1º game do novo set é a oposta à que serviu o último game
        const lastTeam = (lastServerBeforeSet !== null && lastServerBeforeSet !== undefined)
            ? serveTeamOf(lastServerBeforeSet)
            : SERVE.firstTeam;
        const nextTeam = 1 - lastTeam;

        SERVE.phase = nextTeam === 0 ? 'pick-t1' : 'pick-t2';
        SERVE.current = null;
        SERVE.gamesThisSet = 0;
        SERVE.firstTeam = nextTeam;
        SERVE.tbPoints = 0;
        SERVE.tbFirst = null;
        SERVE.t1FirstServer = nextTeam === 0 ? null : SERVE.t1FirstServer;
        SERVE.t2FirstServer = nextTeam === 1 ? null : SERVE.t2FirstServer;
        _serveStatCounted = false;
        renderServeBalls();
    }

    // Registar listeners de toque nas bolas — portrait e landscape
    SERVE_IDS.forEach((id, i) => {
        const ball = document.getElementById('serve-ball-' + id);
        if (ball) {
            ball.addEventListener('click', () => onServeBallTap(i));
            ball.addEventListener('touchend', (e) => {
                e.preventDefault();
                onServeBallTap(i);
            });
        }
        const lsBall = document.getElementById('ls-serve-ball-' + id);
        if (lsBall) {
            lsBall.addEventListener('click', () => onServeBallTap(i));
            lsBall.addEventListener('touchend', (e) => {
                e.preventDefault();
                onServeBallTap(i);
            });
        }
    });

    // ============================================================
    // LAYOUT — exclusivamente Portrait
    // ============================================================
    document.getElementById('layout-portrait').style.display = 'flex';

    // ============================================================
    // UPLOAD FOTOS + LOGOS
    // Abordagem: cada foto/logo tem o seu próprio <input> dentro de um <label>.
    // O utilizador toca diretamente no label → browser abre o picker nativamente
    // sem nenhum .click() programático — funciona em Chrome Android PWA.
    // ============================================================

    // Toast de feedback visual
    function showToast(msg, color) {
        let t = document.getElementById('_upload_toast');
        if (!t) {
            t = document.createElement('div');
            t.id = '_upload_toast';
            Object.assign(t.style, {
                position:'fixed', bottom:'12vh', left:'50%', transform:'translateX(-50%)',
                background:'#1e3a6e', color:'#fff', padding:'1.2dvh 4vw',
                borderRadius:'8px', fontSize:'1.5dvh', fontWeight:'700',
                zIndex:'99999', pointerEvents:'none', transition:'opacity .4s',
                boxShadow:'0 4px 16px rgba(0,0,0,.5)', whiteSpace:'nowrap'
            });
            document.body.appendChild(t);
        }
        t.style.background = color || '#1e3a6e';
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
    }

    // ── IndexedDB para fotos e logos (evita quota localStorage com base64 grande) ──
    const IDB_NAME    = 'padel_assets';
    const IDB_STORE   = 'blobs';
    const IDB_VERSION = 1;
    let _idb = null;

    function openIDB() {
        if (_idb) return Promise.resolve(_idb);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
            req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
            req.onerror   = () => reject(req.error);
        });
    }

    function idbSet(key, value) {
        return openIDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(value, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        }));
    }

    function idbGet(key) {
        return openIDB().then(db => new Promise((resolve, reject) => {
            const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }));
    }

    // ── Foto placeholder — usada quando o utilizador não escolheu foto ──────
    // Mesma imagem que está no src inicial das <img> no HTML (logo NiceShot)
    const DEFAULT_PHOTO_IDS = ['t1-img1', 't1-img2', 't2-img1', 't2-img2'];

    function applyPhoto(baseId, dataUrl) {
        const isDefault = (dataUrl === null || dataUrl === undefined);
        const p = document.getElementById(baseId);
        if (p) {
            p.src = isDefault
                ? p.dataset.default || p.src  // mantém o src já no HTML
                : dataUrl;
            p.style.objectFit = isDefault ? 'contain' : 'cover';
        }
        if (!isDefault) {
            // Guardar em IndexedDB; fallback para localStorage se IDB indisponível
            idbSet('photo_' + baseId, dataUrl).catch(() => {
                try { localStorage.setItem('padel_photo_' + baseId, dataUrl); } catch(e) {}
            });
        }
    }

    function restorePhotos() {
        DEFAULT_PHOTO_IDS.forEach(id => {
            // Garantir que a foto default tem object-fit: contain
            const imgEl = document.getElementById(id);
            if (imgEl) imgEl.style.objectFit = 'contain';

            idbGet('photo_' + id).then(val => {
                if (val) {
                    const p = document.getElementById(id);
                    if (p) { p.src = val; p.style.objectFit = 'cover'; }
                }
            }).catch(() => {
                try {
                    const saved = localStorage.getItem('padel_photo_' + id);
                    if (saved) applyPhoto(id, saved);
                } catch(e) {}
            });
        });
    }

    function _processImageFile(file, maxSize, onDone) {
        if (!file) return;
        showToast('⏳ A processar...');
        const reader = new FileReader();
        reader.onload = function(ev) {
            const dataUrl = ev.target.result;
            try {
                const img = new Image();
                img.onload = function() {
                    try {
                        const scale = Math.min(1, maxSize / Math.max(img.width || 1, img.height || 1));
                        const w = Math.round((img.width  || maxSize) * scale);
                        const h = Math.round((img.height || maxSize) * scale);
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        onDone(canvas.toDataURL('image/jpeg', 0.82));
                    } catch(e) { onDone(dataUrl); }
                };
                img.onerror = function() { onDone(dataUrl); };
                img.src = dataUrl;
            } catch(e) { onDone(dataUrl); }
        };
        reader.onerror = function() { showToast('❌ Erro ao ler ficheiro', '#991b1b'); };
        reader.readAsDataURL(file);
    }

    // Registar listeners em cada input individual
    ['t1-img1','t1-img2','t2-img1','t2-img2'].forEach(function(id) {
        const input = document.getElementById('fi-' + id);
        if (!input) return;
        input.addEventListener('change', function() {
            const file = this.files && this.files[0];
            if (!file) return;
            _processImageFile(file, 480, function(dataUrl) {
                applyPhoto(id, dataUrl);
                showToast('✅ Foto atualizada', '#166534');
            });
            try { input.value = ''; } catch(e) {}
        });
    });

    ['left','right'].forEach(function(side) {
        const input = document.getElementById('fi-logo-' + side);
        if (!input) return;
        input.addEventListener('change', function() {
            const file = this.files && this.files[0];
            if (!file) return;
            _processImageFile(file, 300, function(dataUrl) {
                applyLogo(side, dataUrl);
                showToast('✅ Logo atualizado', '#166534');
            });
            try { input.value = ''; } catch(e) {}
        });
    });

    // Nota: changePhoto / changePhotoById / changeLogo foram removidas.
    // O upload é agora feito exclusivamente via <input type="file"> com listeners
    // registados acima — sem .click() programático, compatível com Android PWA.


    // Normaliza qualquer imagem para 320×106px (proporção do carrossel) antes de exibir
    function normalizeLogoImage(dataUrl, callback) {
        const LOGO_W = 320, LOGO_H = 106;
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = LOGO_W; canvas.height = LOGO_H;
            const ctx = canvas.getContext('2d');
            // Escalar proporcionalmente para caber em 320×106
            const scale = Math.min(LOGO_W / img.width, LOGO_H / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (LOGO_W - w) / 2;
            const y = (LOGO_H - h) / 2;
            ctx.clearRect(0, 0, LOGO_W, LOGO_H);
            ctx.drawImage(img, x, y, w, h);
            callback(canvas.toDataURL('image/png'));
        };
        img.src = dataUrl;
    }

    function applyLogo(side, dataUrl) {
        // Normalizar para 320×106 antes de exibir (só para o logo esquerdo)
        if (side === 'left') {
            normalizeLogoImage(dataUrl, normalizedUrl => applyLogoRaw(side, normalizedUrl));
        } else {
            applyLogoRaw(side, dataUrl);
        }
    }

    function applyLogoRaw(side, dataUrl) {
        const slot = document.getElementById(`logo-${side}-slot`);
        if (slot) {
            const ph = document.getElementById(`logo-${side}-placeholder`);
            if (ph) ph.style.display = 'none';
            const existing = slot.querySelector('img');
            if (existing) existing.remove();
            const img = document.createElement('img');
            img.src = dataUrl;
            slot.appendChild(img);
        }
        const cfgSlot = document.getElementById(`cfg-logo-${side}`);
        if (cfgSlot) {
            const ph = cfgSlot.querySelector('.cfg-logo-placeholder');
            if (ph) ph.style.display = 'none';
            const existing = cfgSlot.querySelector('img');
            if (existing) existing.remove();
            const img = document.createElement('img');
            img.src = dataUrl;
            cfgSlot.appendChild(img);
        }
        idbSet('logo_' + side, dataUrl).catch(() => {
            try { localStorage.setItem('padel_logo_' + side, dataUrl); } catch(e) {}
        });
    }

    // Recuperar logos guardados ao iniciar
    function restoreLogos() {
        ['left', 'right'].forEach(side => {
            idbGet('logo_' + side).then(val => {
                if (val) applyLogo(side, val);
            }).catch(() => {
                // Fallback: tentar localStorage (dados guardados antes da migração IDB)
                try {
                    const saved = localStorage.getItem('padel_logo_' + side);
                    if (saved) applyLogo(side, saved); // também migra para IDB
                } catch(e) {}
            });
        });
    }

    // Nomes editáveis + sincronização
    const defaultNames = ['Player 1','Player 2','Player 3','Player 4'];
    const defaultMap = {
        't1-p1':'Player 1','t1-p2':'Player 2',
        't2-p1':'Player 3','t2-p2':'Player 4'
    };
    // IDs portrait apenas — são a fonte de verdade
    const playerIds = ['t1-p1','t1-p2','t2-p1','t2-p2'];

    function savePlayerNames() {
        playerIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) try { localStorage.setItem(`padel_name_${id}`, el.innerText.trim()); } catch(e) {}
        });
    }

    function restoreNames() {
        playerIds.forEach(id => {
            try {
                const saved = localStorage.getItem(`padel_name_${id}`);
                if (saved && saved !== '') {
                    const el = document.getElementById(id);
                    if (el) el.innerText = saved;
                }
            } catch(e) {}
        });
    }

    document.querySelectorAll('[contenteditable]').forEach(el => {
        el.addEventListener('focus', function() {
            if (defaultNames.includes(this.innerText.trim())) this.innerText = '';
        });
        el.addEventListener('blur', function() {
            if (this.innerText.trim() === '') this.innerText = defaultMap[this.id] || '';
            savePlayerNames();
        });
        el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
        });
    });

    // ============================================================
    // ESTADO DO JOGO — declarado antes de qualquer função que o use
    // ============================================================
    let state = {
        sets: [[0,0],[0,0],[0,0]], currentSet: 0, pts: [0,0],
        isSuperTieBreak: false, isTieBreakMode: false, matchOver: false,
        tiebreakPts: [null, null, null],
        deuceCount: 0
    };

    // ============================================================
    // MODO DE JOGO
    // ============================================================
    // superTieMode = true → 3º set é Super Tie-Break
    // superTieMode = false → 3º set normal até 6 com tie-break em 6x6
    let superTieMode = true;
    // prosetMode = true → jogo único até 9, sem sets 1 e 2
    let prosetMode = false;

    // pointMode: 'golden' | 'star'
    let pointMode = 'golden';

    function cyclePointMode() {
        pointMode = pointMode === 'golden' ? 'star' : 'golden';
        updateConfig();
        state.deuceCount = 0;
    }

    function updatePointModeButton() { updateConfig(); }

    function updateSet3Labels() {
        const label = prosetMode ? 'PROSET' : (superTieMode ? 'SUPERTIE' : 'SET 3');
        const isRed = superTieMode && !prosetMode;
        const isProset = prosetMode;
        document.querySelectorAll('.s3-label').forEach(el => {
            el.textContent = label;
            el.classList.toggle('supertie-label', isRed);
            el.classList.toggle('proset-label', isProset);
        });
        document.querySelectorAll('.ls3-label').forEach(el => {
            el.textContent = label;
            el.classList.toggle('supertie-label', isRed);
            el.classList.toggle('proset-label', isProset);
        });
    }

    function toggleGameMode() {
        if (state.currentSet < 1) {
            superTieMode = !superTieMode;
            if (superTieMode) prosetMode = false;
            updateSet3Labels();
            updateConfig();
        }
    }

    function updateModeButton() { updateConfig(); }

    let statsEnabled = true;

    function setStatsMode(val) {
        statsEnabled = val;
        applyStatsVisibility();
        updateConfig();
    }

    function applyStatsVisibility() {
        document.querySelectorAll('.p-team-panel').forEach(el => {
            el.classList.toggle('stats-hidden', !statsEnabled);
        });
    }

    function openConfig() {
        updateConfig();
        document.getElementById('config-overlay').classList.add('show');
    }
    function closeConfig() {
        document.getElementById('config-overlay').classList.remove('show');
    }
    function closeConfigOnBg(e) {
        if (e.target === document.getElementById('config-overlay')) closeConfig();
    }

    function setSetMode(val) {
        if (state.currentSet >= 1 || state.matchOver) return;
        prosetMode = false;
        superTieMode = val;
        updateSet3Labels();
        updateConfig();
    }

    function setProsetMode(val) {
        if (state.currentSet >= 1 || state.matchOver) return;
        prosetMode = val;
        if (val) superTieMode = false;
        updateSet3Labels();
        updateConfig();
    }

    function setPointMode(val) {
        if (state.matchOver) return;
        pointMode = val;
        state.deuceCount = 0;
        updateConfig();
        updateScreen();
    }

    function updateConfig() {
        const setLocked = state.currentSet >= 1 || state.matchOver;
        const ptLocked  = state.matchOver;
        // Set mode: superTieMode=true → Supertie active; superTieMode=false → 3 Sets active
        // Set mode buttons
        document.getElementById('cfg-3sets').classList.toggle('active', !superTieMode && !prosetMode);
        document.getElementById('cfg-supertie').classList.toggle('active', superTieMode && !prosetMode);
        document.getElementById('cfg-proset').classList.toggle('active', prosetMode);
        document.getElementById('cfg-set-toggle').classList.toggle('disabled', setLocked);
        document.getElementById('cfg-set-hint').textContent = state.matchOver
            ? 'Match finished — start a new game to change'
            : setLocked ? '1st set has started — set mode locked' : '';
        // Point mode toggle
        document.getElementById('cfg-gp').classList.toggle('active', pointMode === 'golden');
        document.getElementById('cfg-sp').classList.toggle('active', pointMode === 'star');
        document.getElementById('cfg-point-toggle').classList.toggle('disabled', ptLocked);
        // Stats toggle
        document.getElementById('cfg-stats-on').classList.toggle('active', statsEnabled);
        document.getElementById('cfg-stats-off').classList.toggle('active', !statsEnabled);
    }

    // ============================================================
    // JOGO
    // ============================================================
    const PADEL_SCORES = [0, 15, 30, 40];

    // ============================================================
    // TRACKING DE PONTOS POR SET
    // setStats[i] = estatísticas acumuladas do set i (0,1,2)
    // ============================================================
    function emptySetStat() {
        return {
            // pontos ganhos/perdidos por equipa
            ptsWon:   [0, 0],   // pontos marcados (inclui TB/STB)
            ptsLost:  [0, 0],   // pontos sofridos
            // situações especiais (por game normal)
            deuces:   0,        // nº de deuces (40-40) neste set
            goldenPts:[0, 0],   // quem ganhou cada Golden Point
            starPts:  [0, 0],   // quem ganhou cada Star Point (DC2)
            // tie-break / supertie
            tbPtsWon: [0, 0],   // pontos ganhos no TB/STB deste set
        };
    }
    let setStats = [emptySetStat(), emptySetStat(), emptySetStat()];

    // estado do game atual para tracking (reset a cada winGame)
    let gameTrack = {
        inDeuce: false,         // já houve deuce neste game
        deuceCountGame: 0,      // deuces dentro deste game
    };

    function resetSetStats() {
        setStats = [emptySetStat(), emptySetStat(), emptySetStat()];
        gameTrack = { inDeuce: false, deuceCountGame: 0 };
    }

    function updateScreen() {
        saveGameState(); // persistir estado a cada alteração
        for (let i = 0; i < 3; i++) {
            const [s1id, s2id, c1id, c2id, tb1id, tb2id] =
                [`t1-s${i+1}`, `t2-s${i+1}`, `t1-s${i+1}-cell`, `t2-s${i+1}-cell`, `t1-s${i+1}-tb`, `t2-s${i+1}-tb`];
            const s1 = document.getElementById(s1id), s2 = document.getElementById(s2id);
            const c1 = document.getElementById(c1id), c2 = document.getElementById(c2id);
            const tb1 = document.getElementById(tb1id), tb2 = document.getElementById(tb2id);
            if (s1) s1.innerText = (prosetMode && i < 2) ? '-' : state.sets[i][0];
            if (s2) s2.innerText = (prosetMode && i < 2) ? '-' : state.sets[i][1];
            if (c1) c1.className = 'score-cell';
            if (c2) c2.className = 'score-cell';
            if (tb1) tb1.textContent = '';
            if (tb2) tb2.textContent = '';
            if (i < state.currentSet) {
                const w1 = state.sets[i][0] > state.sets[i][1];
                const w2 = state.sets[i][1] > state.sets[i][0];
                if (c1) c1.classList.add(w1 ? 'won' : 'dim');
                if (c2) c2.classList.add(w2 ? 'won' : 'dim');
                const tbPts = state.tiebreakPts[i];
                if (tbPts !== null) {
                    if (!w1 && tb1) tb1.textContent = tbPts;
                    if (!w2 && tb2) tb2.textContent = tbPts;
                }
            } else if (i > state.currentSet) {
                if (c1) c1.classList.add('dim');
                if (c2) c2.classList.add('dim');
            }
        }

        const t = state.isSuperTieBreak || state.isTieBreakMode;
        let p1disp, p2disp;
        if (t) {
            p1disp = state.pts[0];
            p2disp = state.pts[1];
        } else if (pointMode === 'star' && state.pts[0] >= 3 && state.pts[1] >= 3) {
            const isAdv = (state.pts[0] === 4 && state.pts[1] === 3) || (state.pts[0] === 3 && state.pts[1] === 4);
            if (isAdv) {
                // ADV1 após o 40-40 inicial, ADV2 após o DC1
                const advLabel = state.deuceCount === 0 ? 'ADV1' : 'ADV2';
                p1disp = state.pts[0] === 4 ? advLabel : 40;
                p2disp = state.pts[1] === 4 ? advLabel : 40;
            } else {
                // 40-40: mostrar DC1 ou DC2 conforme deuceCount
                const dcLabel = state.deuceCount === 0 ? 40 : (state.deuceCount === 1 ? 'DC1' : 'DC2');
                p1disp = dcLabel;
                p2disp = dcLabel;
            }
        } else {
            p1disp = PADEL_SCORES[state.pts[0]] !== undefined ? PADEL_SCORES[state.pts[0]] : state.pts[0];
            p2disp = PADEL_SCORES[state.pts[1]] !== undefined ? PADEL_SCORES[state.pts[1]] : state.pts[1];
        }
        const t1pts = document.getElementById('t1-pts');
        const t2pts = document.getElementById('t2-pts');
        if (t1pts) { t1pts.innerText = p1disp; t1pts.classList.toggle('label-lg', isNaN(p1disp)); }
        if (t2pts) { t2pts.innerText = p2disp; t2pts.classList.toggle('label-lg', isNaN(p2disp)); }

        updateModeButton();

        // Label do modo de ponto junto ao label Points
        const modeLabel = pointMode === 'star' ? '(SP)' : '(GP)';
        ['pts-icon-t1','pts-icon-t2'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = modeLabel;
        });

        // Banner GOLDEN POINT / STAR POINT
        const atDeuce = !state.isSuperTieBreak && !state.isTieBreakMode
            && state.pts[0] === 3 && state.pts[1] === 3 && !state.matchOver;
        const showGP = atDeuce && (
            pointMode === 'golden' ||
            (pointMode === 'star' && state.deuceCount >= 2)
        );
        const gpEl = document.getElementById('golden-point-p');
        if (gpEl) {
            const isStar = pointMode === 'star' && state.deuceCount >= 2;
            gpEl.textContent = isStar ? 'STAR POINT' : 'GOLDEN POINT';
            gpEl.style.background = isStar ? '#f5c518' : '#e03030';
            gpEl.style.color = isStar ? '#0b1a35' : '#fff';
            gpEl.classList.toggle('show', showGP);
        }

        // Banner BREAK POINT
        // Golden Point: recvPts===3 && serverPts<=3 (inclui 40-40)
        // Star Point: recvPts===3 && serverPts<3 (0-40,15-40,30-40)
        //          OU recvPts===4 && serverPts===3 (ADV do adversário)
        let showBP = false;
        let bpRecvTeam = null;
        if (!state.isSuperTieBreak && !state.isTieBreakMode && !state.matchOver
            && (SERVE.phase === 'auto' || SERVE.phase === 'tb') && SERVE.current !== null) {
            const serverTeam = serveTeamOf(SERVE.current);
            const recvTeam   = 1 - serverTeam;
            const serverPts  = state.pts[serverTeam];
            const recvPts    = state.pts[recvTeam];
            if (pointMode === 'golden' || prosetMode) {
                // Golden Point: BP desde 0-40 até 40-40
                showBP = recvPts === 3 && serverPts <= 3;
            } else {
                // Star Point: BP em 0-40, 15-40, 30-40, ADV adversário, ou DC2 (Star Point)
                const isStarPoint = state.deuceCount >= 2 && recvPts === 3 && serverPts === 3;
                showBP = (recvPts === 3 && serverPts < 3)
                      || (recvPts === 4 && serverPts === 3)
                      || isStarPoint;
            }
            if (showBP) bpRecvTeam = recvTeam;
        }
        document.getElementById('break-point-p').classList.toggle('show', showBP);

        // Sincronizar layout landscape
        syncLandscape(showBP, showGP, gpEl ? gpEl.textContent : 'GOLDEN POINT', bpRecvTeam);
    }

    // ── Landscape sync ──────────────────────────────────────────
    function syncLandscape(showBP, showGP, gpLabel, bpRecvTeam) {
        // Sets
        for (var _i = 0; _i < 3; _i++) {
            var s1el = document.getElementById('ls-t1-s' + (_i+1));
            var s2el = document.getElementById('ls-t2-s' + (_i+1));
            var c1el = document.getElementById('ls-t1-s' + (_i+1) + '-cell');
            var c2el = document.getElementById('ls-t2-s' + (_i+1) + '-cell');
            var tb1el = document.getElementById('ls-t1-s' + (_i+1) + '-tb');
            var tb2el = document.getElementById('ls-t2-s' + (_i+1) + '-tb');

            // copiar texto dos elements portrait originais
            var pS1 = document.getElementById('t1-s' + (_i+1));
            var pS2 = document.getElementById('t2-s' + (_i+1));
            var pTb1 = document.getElementById('t1-s' + (_i+1) + '-tb');
            var pTb2 = document.getElementById('t2-s' + (_i+1) + '-tb');
            var pC1 = document.getElementById('t1-s' + (_i+1) + '-cell');
            var pC2 = document.getElementById('t2-s' + (_i+1) + '-cell');

            if (s1el && pS1) s1el.innerText = pS1.innerText;
            if (s2el && pS2) s2el.innerText = pS2.innerText;
            if (tb1el && pTb1) tb1el.textContent = pTb1.textContent;
            if (tb2el && pTb2) tb2el.textContent = pTb2.textContent;

            // copiar classes won/dim
            if (c1el && pC1) {
                c1el.className = 'ls-set-cell';
                if (pC1.classList.contains('won')) c1el.classList.add('won');
                if (pC1.classList.contains('dim')) c1el.classList.add('dim');
            }
            if (c2el && pC2) {
                c2el.className = 'ls-set-cell';
                if (pC2.classList.contains('won')) c2el.classList.add('won');
                if (pC2.classList.contains('dim')) c2el.classList.add('dim');
            }
        }

        // Pontos parciais
        var pPts1 = document.getElementById('t1-pts');
        var pPts2 = document.getElementById('t2-pts');
        var lsPts1 = document.getElementById('ls-t1-pts');
        var lsPts2 = document.getElementById('ls-t2-pts');
        if (lsPts1 && pPts1) {
            lsPts1.innerText = pPts1.innerText;
            lsPts1.className = 'ls-pts-val' + (pPts1.classList.contains('label-lg') ? ' label-lg' : '');
        }
        if (lsPts2 && pPts2) {
            lsPts2.innerText = pPts2.innerText;
            lsPts2.className = 'ls-pts-val' + (pPts2.classList.contains('label-lg') ? ' label-lg' : '');
        }

        // Ícone de modo de ponto (único, no título unificado de scores)
        var pIcon1 = document.getElementById('pts-icon-t1');
        var lsIconHeader = document.getElementById('ls-pts-icon-header');
        if (lsIconHeader && pIcon1) lsIconHeader.innerHTML = pIcon1.innerHTML;

        // Badges
        var lsBP = document.getElementById('ls-break-point');
        var lsGP = document.getElementById('ls-golden-point');
        var lsEO = document.getElementById('ls-end-of-match');
        var pEO  = document.getElementById('game-over-p');

        if (lsBP) lsBP.classList.toggle('show', showBP);
        if (lsGP) {
            lsGP.classList.toggle('show', showGP);
            lsGP.textContent = gpLabel || 'GOLDEN POINT';
            lsGP.classList.toggle('star', gpLabel === 'STAR POINT');
        }
        if (lsEO && pEO) lsEO.classList.toggle('show', pEO.classList.contains('show'));

        // Timer
        var pTimerDisp = document.getElementById('timer-display-p');
        var lsTimerDisp = document.getElementById('ls-timer-display');
        if (lsTimerDisp && pTimerDisp) lsTimerDisp.textContent = pTimerDisp.textContent;

        // Nomes
        var nameMap = [
            ['t1-p1','ls-t1-p1'], ['t1-p2','ls-t1-p2'],
            ['t2-p1','ls-t2-p1'], ['t2-p2','ls-t2-p2']
        ];
        for (var _n = 0; _n < nameMap.length; _n++) {
            var pNEl = document.getElementById(nameMap[_n][0]);
            var lsNEl = document.getElementById(nameMap[_n][1]);
            if (pNEl && lsNEl) lsNEl.textContent = pNEl.innerText || pNEl.textContent;
        }

        // Fotos
        var photoMap = [
            ['t1-img1','ls-t1-img1'], ['t1-img2','ls-t1-img2'],
            ['t2-img1','ls-t2-img1'], ['t2-img2','ls-t2-img2']
        ];
        for (var _p = 0; _p < photoMap.length; _p++) {
            var pImgEl = document.getElementById(photoMap[_p][0]);
            var lsImgEl = document.getElementById(photoMap[_p][1]);
            if (pImgEl && lsImgEl && pImgEl.src && lsImgEl.src !== pImgEl.src) {
                lsImgEl.src = pImgEl.src;
            }
        }

        // Logo
        var pLogoImg = document.getElementById('logo-left-slot') && document.getElementById('logo-left-slot').querySelector('img');
        var lsLogoImg = document.getElementById('ls-logo-img');
        var lsLogoPlaceholder = document.getElementById('ls-logo-placeholder');
        if (pLogoImg && lsLogoImg) {
            if (pLogoImg.src && pLogoImg.style.display !== 'none') {
                lsLogoImg.src = pLogoImg.src;
                lsLogoImg.style.display = 'block';
                if (lsLogoPlaceholder) lsLogoPlaceholder.style.display = 'none';
            }
        }

        // Sponsor
        var pSponsor = document.getElementById('sponsor-slide');
        var lsSponsor = document.getElementById('ls-sponsor-img');
        if (pSponsor && lsSponsor && pSponsor.src) {
            if (lsSponsor.src !== pSponsor.src) lsSponsor.src = pSponsor.src;
            lsSponsor.style.display = pSponsor.style.display !== 'none' ? 'block' : 'none';
        }
    }
    // ── Fim Landscape sync ──────────────────────────────────────

    // Timer landscape: actualiza display landscape quando o timer corre
    var _lsTimerInterval = null;
    function _startLsTimerSync() {
        if (_lsTimerInterval) return;
        _lsTimerInterval = setInterval(function() {
            var pDisp = document.getElementById('timer-display-p');
            var lsDisp = document.getElementById('ls-timer-display');
            if (pDisp && lsDisp) lsDisp.textContent = pDisp.textContent;
        }, 500);
    }
    _startLsTimerSync();

    // Logo + Sponsor landscape: sync contínuo independente do updateScreen
    var _lsHeaderInterval = null;
    function _syncLsHeader() {
        // Logo
        var logoSlot = document.getElementById('logo-left-slot');
        var pLogoImg = logoSlot ? logoSlot.querySelector('img') : null;
        var lsLogoImg = document.getElementById('ls-logo-img');
        var lsLogoPlaceholder = document.getElementById('ls-logo-placeholder');
        if (lsLogoImg) {
            if (pLogoImg && pLogoImg.src) {
                if (lsLogoImg.src !== pLogoImg.src) lsLogoImg.src = pLogoImg.src;
                lsLogoImg.style.display = 'block';
                if (lsLogoPlaceholder) lsLogoPlaceholder.style.display = 'none';
            } else {
                lsLogoImg.style.display = 'none';
                if (lsLogoPlaceholder) lsLogoPlaceholder.style.display = 'flex';
            }
        }

        // Sponsor carousel
        var pSponsor = document.getElementById('sponsor-slide');
        var lsSponsor = document.getElementById('ls-sponsor-img');
        if (pSponsor && lsSponsor) {
            if (pSponsor.src && pSponsor.src !== lsSponsor.src) {
                lsSponsor.src = pSponsor.src;
            }
            lsSponsor.style.display = pSponsor.src ? 'block' : 'none';
            lsSponsor.style.opacity = pSponsor.style.opacity || '1';
        }
    }
    function _startLsHeaderSync() {
        if (_lsHeaderInterval) return;
        _syncLsHeader();
        _lsHeaderInterval = setInterval(_syncLsHeader, 500);
    }
    _startLsHeaderSync();

    // Menu hambúrguer landscape: abre/fecha dropdown, fecha ao clicar fora ou ao escolher item
    (function initLsMenu() {
        // Menu hambúrguer landscape
        var btn = document.getElementById('ls-menu-btn');
        var dropdown = document.getElementById('ls-menu-dropdown');
        if (btn && dropdown) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                dropdown.classList.toggle('show');
            });
            dropdown.addEventListener('click', function(e) {
                if (e.target.classList.contains('ls-menu-item')) {
                    dropdown.classList.remove('show');
                }
            });
            document.addEventListener('click', function(e) {
                if (!dropdown.classList.contains('show')) return;
                if (dropdown.contains(e.target) || btn.contains(e.target)) return;
                dropdown.classList.remove('show');
            });
        }

        // Menu hambúrguer portrait (FAB canto inferior direito)
        var pBtn = document.getElementById('p-fab-btn');
        var pDropdown = document.getElementById('p-fab-dropdown');
        if (pBtn && pDropdown) {
            pBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                pDropdown.classList.toggle('show');
            });
            pDropdown.addEventListener('click', function(e) {
                if (e.target.classList.contains('p-fab-item')) {
                    pDropdown.classList.remove('show');
                }
            });
            document.addEventListener('click', function(e) {
                if (!pDropdown.classList.contains('show')) return;
                if (pDropdown.contains(e.target) || pBtn.contains(e.target)) return;
                pDropdown.classList.remove('show');
            });
        }
    })();

    // Refresh forçado ao rodar o dispositivo: garante que labels, nomes e fotos
    // ficam imediatamente atualizados ao alternar entre portrait e landscape,
    // sem esperar pelo próximo evento de jogo ou pelo intervalo periódico.
    function _forceFullRefresh() {
        updateScreen();
        _syncLsHeader();
    }
    if (window.matchMedia) {
        var _lsOrientationMq = window.matchMedia('(orientation: landscape)');
        var _onOrientationChange = function() {
            // Pequeno atraso para garantir que o layout já trocou de display antes do refresh
            setTimeout(_forceFullRefresh, 50);
        };
        if (_lsOrientationMq.addEventListener) {
            _lsOrientationMq.addEventListener('change', _onOrientationChange);
        } else if (_lsOrientationMq.addListener) {
            // Fallback Android 8 / browsers antigos
            _lsOrientationMq.addListener(_onOrientationChange);
        }
    }
    window.addEventListener('orientationchange', function() {
        setTimeout(_forceFullRefresh, 50);
    });

    function checkGameLogic() {
        let p1 = state.pts[0], p2 = state.pts[1];
        if (state.isSuperTieBreak || state.isTieBreakMode) {
            let target = state.isSuperTieBreak ? 10 : 7;
            if ((p1 >= target || p2 >= target) && Math.abs(p1 - p2) >= 2) winGame(p1 > p2 ? 0 : 1);
        }
        // golden e star resolvem no addPoint, não chegam aqui com pts>3
    }

    function winGame(ti) {
        // Esconder banners imediatamente para evitar flash visual
        const gpEl = document.getElementById('golden-point-p');
        const bpEl = document.getElementById('break-point-p');
        if (gpEl) gpEl.classList.remove('show');
        if (bpEl) bpEl.classList.remove('show');
        // Serve Won / Broken Serve — contado quando o game é ganho
        // ti=0 dupla1 ganhou, ti=1 dupla2 ganhou; teamIndex = ti+1
        autoCountServe(ti + 1);
        state.deuceCount = 0;
        gameTrack = { inDeuce: false, deuceCountGame: 0 };
        _serveStatCounted = false;
        let setEnded = false;
        if (state.isSuperTieBreak) {
            state.sets[2][0] = state.pts[0];
            state.sets[2][1] = state.pts[1];
            state.pts = [0, 0];
            winSet();
            setEnded = true;
        } else {
            if (state.isTieBreakMode) {
                const loserPts = Math.min(state.pts[0], state.pts[1]);
                state.tiebreakPts[state.currentSet] = loserPts;
            }
            state.sets[state.currentSet][ti]++;
            state.pts = [0,0];
            const g1 = state.sets[state.currentSet][0], g2 = state.sets[state.currentSet][1];
            if (state.isTieBreakMode) { winSet(); setEnded = true; }
            else if (prosetMode) {
                // PROSET: tiebreak a 8-8, vitória a 9 com diferença de 2
                if (g1 === 8 && g2 === 8) { state.isTieBreakMode = true; }
                else if ((g1 >= 9 || g2 >= 9) && Math.abs(g1-g2) >= 2) { winSet(); setEnded = true; }
            } else {
                if (g1 === 6 && g2 === 6) { state.isTieBreakMode = true; }
                else if ((g1 >= 6 || g2 >= 6) && Math.abs(g1-g2) >= 2) { winSet(); setEnded = true; }
            }
        }
        // onGameEnd só corre se o set NÃO terminou — se terminou, initServeNewSet já tratou o serve
        if (!setEnded) onGameEnd();
    }

    function winSet() {
        state.isTieBreakMode = false;
        const lastServer = SERVE.current;
        state.currentSet++;
        if (prosetMode) {
            // PROSET: o match termina quando o único set (índice 2) termina
            endMatch();
            return;
        }
        if (state.currentSet === 2) {
            const s1won = (state.sets[0][0]>state.sets[0][1]?1:0)+(state.sets[1][0]>state.sets[1][1]?1:0);
            if (s1won === 1) {
                state.isSuperTieBreak = superTieMode;
                initServeNewSet(lastServer);
            } else {
                endMatch();
            }
        } else if (state.currentSet >= 3) {
            endMatch();
        } else {
            initServeNewSet(lastServer);
        }
    }

    function endMatch() {
        state.matchOver = true;
        state.isSuperTieBreak = false;
        state.isTieBreakMode = false;
        SERVE.phase = 'off'; // apagar todas as bolas de serviço
        renderServeBalls();
        // Parar o cronómetro automaticamente
        if (timerRunning) {
            clearInterval(timerInterval);
            timerRunning = false;
            updateTimerDisplay();
        }

        // --- Gerar resumo de pontos por set em formato de tabela ---
        const n1a = ((function(){var _e=document.getElementById('t1-p1');return _e&&_e.innerText?_e.innerText.trim():'Player 1'})()).substring(0, 9);
        const n1b = ((function(){var _e=document.getElementById('t1-p2');return _e&&_e.innerText?_e.innerText.trim():'Player 2'})()).substring(0, 9);
        const n2a = ((function(){var _e=document.getElementById('t2-p1');return _e&&_e.innerText?_e.innerText.trim():'Player 3'})()).substring(0, 9);
        const n2b = ((function(){var _e=document.getElementById('t2-p2');return _e&&_e.innerText?_e.innerText.trim():'Player 4'})()).substring(0, 9);
        const hdr1 = `${n1a} | ${n1b}`;
        const hdr2 = `${n2a} | ${n2b}`;
        const COL = Math.max(hdr1.length, hdr2.length, 13) + 2;

        // Adicionar Match Time ao início das notas
        const dur = formatDuration(timerSeconds);
        const timeNote = dur ? `⏱ Match Time: ${dur}` : '';

        // Montar nota final: apenas tempo + notas do utilizador (sem stats)
        const userNotes = currentNotes.trim();
        currentNotes = [timeNote, userNotes].filter(Boolean).join('\n\n');

        // Guardar ANTES de alterar pts e currentSet
        saveMatchHistory();
        state.pts = [0, 0];
        state.currentSet = 3;
        document.getElementById('game-over-p').classList.add('show');
        updateScreen();
    }

    // Contagem automática de Serve Won / Broken Serve para o servidor actual
    function autoCountServe(teamIndex) {
        if ((SERVE.phase !== 'auto' && SERVE.phase !== 'tb') || SERVE.current === null) return;
        const pSuffix = ['p1','p2','p3','p4'];
        const suffix = pSuffix[SERVE.current];
        const serverTeam = serveTeamOf(SERVE.current); // 0=dupla1, 1=dupla2
        const winnerTeam = teamIndex - 1;              // 0=dupla1, 1=dupla2
        const key = (winnerTeam === serverTeam) ? `s_1srv_${suffix}` : `s_2srv_${suffix}`;
        if (statsState[key] !== undefined) {
            statsState[key]++;
            const el = document.getElementById(key);
            if (el) el.textContent = statsState[key];
            updateServePct(suffix);
        }
    }

    function addPoint(teamIndex) {
        if (state.matchOver) return;
        // No modo PROSET, saltar directamente para o 3º set (índice 2)
        if (prosetMode && state.currentSet < 2) {
            state.currentSet = 2;
        }
        // Bloquear pontos enquanto o servidor não estiver definido
        if (SERVE.phase === 'pick-any' || SERVE.phase === 'pick-t1' || SERVE.phase === 'pick-t2') {
            showToast('⚠️ Choose who serves first');
            return;
        }
        if (!timerRunning && timerSeconds === 0) toggleTimer();

        const idx = teamIndex - 1;
        const opp = 1 - idx;
        const si  = state.currentSet;

        if (state.isSuperTieBreak || state.isTieBreakMode) {
            state.pts[idx]++;
            setStats[si].tbPtsWon[idx]++;
            SERVE.tbPoints++;   // incrementar antes para onTbPoint calcular o servidor correcto
            onTbPoint();
        } else {
            const p0 = state.pts[0], p1 = state.pts[1];
            const isDeuce = p0 === 3 && p1 === 3;
            const isAdv   = (p0 === 4 && p1 === 3) || (p0 === 3 && p1 === 4);
            const hasAdv  = isAdv && state.pts[idx] === 4;

            if (pointMode === 'golden' || prosetMode) {
                if (isDeuce) {
                    // Golden Point decisivo — registar
                    setStats[si].goldenPts[idx]++;
                    // ponto ganho/perdido contado em winGame via flush
                    trackPointWon(si, idx);
                    winGame(idx);
                } else {
                    state.pts[idx]++;
                    // Verificar se chegou a deuce agora (40-40)
                    if (state.pts[0] === 3 && state.pts[1] === 3) {
                        setStats[si].deuces++;
                        gameTrack.inDeuce = true;
                    }
                    if (state.pts[idx] >= 4 && state.pts[idx] > state.pts[opp]) {
                        trackPointWon(si, idx);
                        winGame(idx);
                    } else {
                        trackPointWon(si, idx);
                    }
                }
            } else {
                // --- Star Point ---
                if (isAdv) {
                    if (hasAdv) {
                        // ADV marca → ganha
                        trackPointWon(si, idx);
                        winGame(idx);
                    } else {
                        // Sem ADV marca → volta a 40-40, conta DC
                        trackPointWon(si, idx);
                        state.pts = [3, 3];
                        state.deuceCount++;
                        setStats[si].deuces++;
                    }
                } else if (isDeuce) {
                    if (state.deuceCount >= 2) {
                        // DC2 → Star Point decisivo
                        setStats[si].starPts[idx]++;
                        trackPointWon(si, idx);
                        winGame(idx);
                    } else {
                        // 40-40 inicial ou DC1 → vantagem
                        state.pts[idx]++;
                        trackPointWon(si, idx);
                    }
                } else {
                    state.pts[idx]++;
                    // Verificar se chegou a deuce
                    if (state.pts[0] === 3 && state.pts[1] === 3) {
                        setStats[si].deuces++;
                        gameTrack.inDeuce = true;
                    }
                    if (state.pts[idx] >= 4 && state.pts[idx] > state.pts[opp]) {
                        trackPointWon(si, idx);
                        winGame(idx);
                    } else {
                        trackPointWon(si, idx);
                    }
                }
            }
        }
        checkGameLogic(); updateScreen();
    }

    // Regista ponto ganho pelo idx e ponto perdido pelo oponente
    function trackPointWon(si, idx) {
        setStats[si].ptsWon[idx]++;
        setStats[si].ptsLost[1 - idx]++;
    }

    function removePoint(event, teamIndex) {
        event.preventDefault();
        const idx = teamIndex - 1;
        const inDC = pointMode === 'star'
            && state.deuceCount > 0
            && state.pts[0] === 3 && state.pts[1] === 3;
        if (inDC) return;
        if (state.pts[idx] > 0) {
            state.pts[idx]--;
        }
        updateScreen();
    }

    function removeSetPoint(teamIndex, setIndex) {
        if (setIndex > state.currentSet) return;
        if (state.matchOver) return;
        if (prosetMode && setIndex < 2) return; // sets 1 e 2 desactivados no PROSET
        const idx = teamIndex - 1;
        if (state.sets[setIndex][idx] > 0) {
            state.sets[setIndex][idx]--;
            updateScreen();
        }
    }

    function addSetPoint(teamIndex, setIndex) {
        if (setIndex >= state.currentSet) return;
        if (state.matchOver) return;
        if (prosetMode && setIndex < 2) return; // sets 1 e 2 desactivados no PROSET
        const idx = teamIndex - 1;
        const isThirdSetSuperTie = (setIndex === 2 && superTieMode);
        const limit = isThirdSetSuperTie ? Infinity : 7;
        if (state.sets[setIndex][idx] < limit) {
            state.sets[setIndex][idx]++;
            updateScreen();
        }
    }

    function setupSetLongPress(elId, teamIndex, setIndex) {
        const el = document.getElementById(elId);
        if (!el) return;

        let timer = null, isLong = false, hasTouched = false;

        // ── Touch (mobile) ────────────────────────────────────────────────
        el.addEventListener('touchstart', e => {
            hasTouched = true;
            isLong = false;
            timer = setTimeout(() => {
                isLong = true;
                removeSetPoint(teamIndex, setIndex); // decrementa sempre (set fechado OU em andamento)
            }, 600);
        }, { passive: true });

        el.addEventListener('touchend', () => {
            clearTimeout(timer);
            if (!isLong) {
                // Toque curto: só incrementa em sets FECHADOS; set em andamento não faz nada
                if (setIndex < state.currentSet) addSetPoint(teamIndex, setIndex);
            }
            // Reset após um frame para não bloquear o click sintético do browser
            setTimeout(() => { hasTouched = false; }, 300);
        });

        el.addEventListener('touchmove', () => { clearTimeout(timer); isLong = true; });

        // ── Mouse / desktop (ignorar se veio de touch) ───────────────────
        el.addEventListener('click', e => {
            if (hasTouched) return;
            // Toque curto: só incrementa em sets FECHADOS
            if (setIndex < state.currentSet) addSetPoint(teamIndex, setIndex);
        });
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (hasTouched) return;
            removeSetPoint(teamIndex, setIndex); // decrementa sempre (set fechado OU em andamento)
        });
    }

    // Portrait
    setupSetLongPress('t1-s1-cell', 1, 0); setupSetLongPress('t1-s2-cell', 1, 1); setupSetLongPress('t1-s3-cell', 1, 2);
    setupSetLongPress('t2-s1-cell', 2, 0); setupSetLongPress('t2-s2-cell', 2, 1); setupSetLongPress('t2-s3-cell', 2, 2);

    // ============================================================
    // PERSISTÊNCIA DO ESTADO DO JOGO EM CURSO
    // ============================================================
    const GAME_STATE_KEY = 'padel_game_state';

    function saveGameState() {
        // Recolher nomes dos jogadores
        const players = ['t1-p1','t1-p2','t2-p1','t2-p2'].map(id => {
            const el = document.getElementById(id);
            return el ? el.innerText.trim() : '';
        });
        const snapshot = {
            state,
            superTieMode,
            prosetMode,
            pointMode,
            statsEnabled,
            statsState: { ...statsState },
            setStats,
            gameTrack,
            currentNotes,
            timerSeconds,
            players,
            serve: {
                current:       SERVE.current,
                gamesPlayed:   SERVE.gamesPlayed,
                gamesThisSet:  SERVE.gamesThisSet,
                phase:         SERVE.phase,
                firstTeam:     SERVE.firstTeam,
                tbPoints:      SERVE.tbPoints,
                tbFirst:       SERVE.tbFirst,
                t1FirstServer: SERVE.t1FirstServer,
                t2FirstServer: SERVE.t2FirstServer,
            }
        };
        try { localStorage.setItem(GAME_STATE_KEY, JSON.stringify(snapshot)); } catch(e) {}
    }

    function restoreGameState() {
        let snap;
        try { snap = JSON.parse(localStorage.getItem(GAME_STATE_KEY)); } catch(e) {}
        if (!snap) return false;

        // Restaurar estado do jogo
        state = snap.state;
        superTieMode  = snap.superTieMode;
        prosetMode    = snap.prosetMode || false;
        pointMode     = snap.pointMode;
        statsEnabled  = snap.statsEnabled;
        setStats      = snap.setStats;
        gameTrack     = snap.gameTrack;
        currentNotes  = snap.currentNotes || '';
        timerSeconds  = snap.timerSeconds || 0;
        // Retomar o timer se o jogo estava em curso e não tinha terminado
        if (!state.matchOver && timerSeconds > 0) {
            updateTimerDisplay();
            // Reiniciar o intervalo do timer
            setTimeout(() => {
                if (!timerRunning && !state.matchOver) toggleTimer();
            }, 500);
        } else {
            updateTimerDisplay();
        }

        // Restaurar estatísticas
        if (snap.statsState) {
            Object.assign(statsState, snap.statsState);
            statIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = statsState[id] || 0;
            });
            ['p1','p2','p3','p4'].forEach(p => updateServePct(p));
        }

        // Restaurar nomes dos jogadores
        if (snap.players) {
            ['t1-p1','t1-p2','t2-p1','t2-p2'].forEach((id, i) => {
                const el = document.getElementById(id);
                if (el && snap.players[i]) el.innerText = snap.players[i];
            });
        }

        // Restaurar serve indicator
        if (snap.serve) {
            Object.assign(SERVE, snap.serve);
        }

        return true;
    }

    function clearGameState() {
        try { localStorage.removeItem(GAME_STATE_KEY); } catch(e) {}
    }

    // ============================================================
    // ESTATÍSTICAS
    // ============================================================
    const statsState = {};
    const statIds = [
        's_1srv_p1','s_2srv_p1','s_df_p1','s_ufe_p1','s_fe_p1','s_win_p1',
        's_1srv_p2','s_2srv_p2','s_df_p2','s_ufe_p2','s_fe_p2','s_win_p2',
        's_1srv_p3','s_2srv_p3','s_df_p3','s_ufe_p3','s_fe_p3','s_win_p3',
        's_1srv_p4','s_2srv_p4','s_df_p4','s_ufe_p4','s_fe_p4','s_win_p4'
    ];
    statIds.forEach(id => { statsState[id] = 0; });

    // Actualizar percentuais de 1st/2nd Serve em tempo real
    function updateServePct(playerSuffix) {
        const s1 = statsState[`s_1srv_${playerSuffix}`] || 0;
        const s2 = statsState[`s_2srv_${playerSuffix}`] || 0;
        const total = s1 + s2;
        const pct1 = total > 0 ? Math.round(s1 / total * 100) + '%' : '';
        const pct2 = total > 0 ? Math.round(s2 / total * 100) + '%' : '';
        const el1 = document.getElementById(`pct_1srv_${playerSuffix}`);
        const el2 = document.getElementById(`pct_2srv_${playerSuffix}`);
        if (el1) el1.textContent = pct1;
        if (el2) el2.textContent = pct2;
    }

    function incStat(id) {
        if (state.matchOver) return;
        statsState[id]++;
        document.getElementById(id).textContent = statsState[id];
        if (id.startsWith('s_1srv_') || id.startsWith('s_2srv_')) {
            updateServePct(id.slice(-2));
        }
    }

    function decStatById(id) {
        if (state.matchOver) return;
        if (statsState[id] > 0) {
            statsState[id]--;
            document.getElementById(id).textContent = statsState[id];
        }
        if (id.startsWith('s_1srv_') || id.startsWith('s_2srv_')) {
            updateServePct(id.slice(-2));
        }
    }
    function resetStats() {
        statIds.forEach(id => {
            statsState[id] = 0;
            const el = document.getElementById(id);
            if (el) el.textContent = 0;
        });
        // Limpar percentuais
        ['p1','p2','p3','p4'].forEach(p => {
            ['pct_1srv_','pct_2srv_'].forEach(prefix => {
                const el = document.getElementById(prefix + p);
                if (el) el.textContent = '';
            });
        });
    }

    // Long-press (600ms) para decrementar; toque curto incrementa
    document.querySelectorAll('.stat-box').forEach(box => {
        const id = box.dataset.stat;
        let timer = null, isLong = false, hasTouched = false;

        box.addEventListener('touchstart', e => {
            hasTouched = true;
            isLong = false;
            timer = setTimeout(() => {
                isLong = true;
                decStatById(id);
            }, 600);
        }, { passive: true });

        box.addEventListener('touchend', e => {
            clearTimeout(timer);
            if (!isLong) incStat(id);
        });

        box.addEventListener('touchmove', () => clearTimeout(timer));

        // Desktop: click incrementa, contextmenu decrementa
        box.addEventListener('click', e => {
            if (hasTouched) { hasTouched = false; return; }
            incStat(id);
        });
        box.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (hasTouched) { hasTouched = false; return; }
            decStatById(id);
        });
    });

    // ============================================================
    // EXPORTAR EXCEL
    // ============================================================
    // exportToExcel (jogo em curso) removida — export agora é exclusivo do histórico
    // via exportHistoryGameToExcel, acessível pelo botão Email/Export no footer.

    // ============================================================
    // HISTORY — últimos 10 jogos em localStorage
    // ============================================================
    const HISTORY_KEY = 'padel_history';
    const HISTORY_MAX = 10;

    function saveMatchHistory() {
        const p1 = (function(){var _e=document.getElementById('t1-p1');return _e&&_e.innerText?_e.innerText.trim():'Player 1'})();
        const p2 = (function(){var _e=document.getElementById('t1-p2');return _e&&_e.innerText?_e.innerText.trim():'Player 2'})();
        const p3 = (function(){var _e=document.getElementById('t2-p1');return _e&&_e.innerText?_e.innerText.trim():'Player 3'})();
        const p4 = (function(){var _e=document.getElementById('t2-p2');return _e&&_e.innerText?_e.innerText.trim():'Player 4'})();

        // Determinar dupla vencedora
        const s = state.sets;
        const w1 = (s[0][0]>s[0][1]?1:0)+(s[1][0]>s[1][1]?1:0)+(s[2][0]>s[2][1]?1:0);
        const winner = w1 >= 2 ? 0 : 1; // 0 = pair1, 1 = pair2

        const entry = {
            date: new Date().toISOString(),
            players: [p1, p2, p3, p4],
            winner,
            sets: JSON.parse(JSON.stringify(state.sets)),
            stats: Object.assign({}, statsState),
            setMode: prosetMode ? 'proset' : (superTieMode ? 'supertie' : '3sets'),
            pointMode: pointMode,
            notes: currentNotes
        };

        let history = [];
        try { history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch(e) {}
        history.unshift(entry);
        if (history.length > HISTORY_MAX) history = history.slice(0, HISTORY_MAX);
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        } catch(e) {
            // Quota excedida — tentar sem stats (mais leve)
            try {
                history[0] = { ...entry, stats: {} };
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
            } catch(e2) {
                console.warn('localStorage quota exceeded — history not saved:', e2);
            }
        }
    }

    function loadHistory() {
        try {
            const history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
            // Migração: corrigir entradas antigas com setMode invertido
            let needsSave = false;
            history.forEach(entry => {
                if (!entry._migrated && entry.setMode) {
                    const notes = entry.notes || '';
                    const hasSupertieLabel = notes.includes('Supertie');
                    const has3setLabel = notes.includes('Set 3');
                    if (hasSupertieLabel && entry.setMode === '3sets') entry.setMode = 'supertie';
                    if (has3setLabel && entry.setMode === 'supertie') entry.setMode = '3sets';
                    entry._migrated = true;
                    needsSave = true;
                }
            });
            // Persistir apenas se houve migração efectiva
            if (needsSave) {
                try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch(e) {}
            }
            return history;
        } catch(e) { return []; }
    }

    function formatDate(iso) {
        const d = new Date(iso);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        return `${mm}/${dd}/${yy}`;
    }

    function formatScore(entry) {
        const s = entry.sets;
        if (entry.setMode === 'proset') {
            // PROSET: só mostra o 3º set, sets 1 e 2 ficam a —
            const tb = entry.tiebreakPts && entry.tiebreakPts[2] !== null ? `(${entry.tiebreakPts[2]})` : '';
            return `— / — / ${s[2][0]}-${s[2][1]}${tb}`;
        }
        const parts = [];
        for (let i = 0; i < 3; i++) {
            if (s[i][0] > 0 || s[i][1] > 0) parts.push(`${s[i][0]}-${s[i][1]}`);
        }
        return parts.join('  ·  ');
    }

    const STAT_LABELS = ['Serve Won','Broken Serve','Unforced Errors','Forced Errors','Double Fault','Winners'];
    const STAT_KEYS   = ['1srv','2srv','ufe','fe','df','win'];

    function formatServeStat(value, total) {
        if (total <= 0) return `${value}`; // sem base para % — não calcula nem mostra 0%
        const pct = Math.round((value / total) * 100);
        return `${value} (${pct}%)`;
    }

    function buildPairBlock(entry, pairIdx, isWinner) {
        const offset = pairIdx * 2;
        const pSuffix = ['p1','p2','p3','p4'];
        const n1 = escHtml(entry.players[offset] || '');
        const n2 = escHtml(entry.players[offset + 1] || '');

        const winnerRight = isWinner ? `
            <div class="h-winner-right">
                <span class="h-winner-badge">Winners</span>
                <span class="h-winner-score">${formatScore(entry)}</span>
            </div>` : '';

        // Totais de serviço (1st + 2nd) por jogador — base individual para os percentuais
        const tot1 = ((entry.stats ? entry.stats[`s_1srv_${pSuffix[offset]}`] : undefined) || 0) + ((entry.stats ? entry.stats[`s_2srv_${pSuffix[offset]}`] : undefined) || 0);
        const tot2 = ((entry.stats ? entry.stats[`s_1srv_${pSuffix[offset+1]}`] : undefined) || 0) + ((entry.stats ? entry.stats[`s_2srv_${pSuffix[offset+1]}`] : undefined) || 0);

        const rows = STAT_LABELS.map((label, i) => {
            const key = STAT_KEYS[i];
            const v1 = (entry.stats ? entry.stats[`s_${key}_${pSuffix[offset]}`] : undefined) || 0;
            const v2 = (entry.stats ? entry.stats[`s_${key}_${pSuffix[offset+1]}`] : undefined) || 0;
            const isServe = (key === '1srv' || key === '2srv');
            const c1 = isServe ? formatServeStat(v1, tot1) : v1;
            const c2 = isServe ? formatServeStat(v2, tot2) : v2;
            return `<tr><td>${label}</td><td>${c1}</td><td>${c2}</td></tr>`;
        }).join('');

        return `
            <div class="h-pair${isWinner ? ' winner' : ''}">
                <div class="h-pair-header">
                    <div class="h-pair-names">
                        <div class="h-pair-name-row">${n1}<span class="h-pair-name-sep">/</span>${n2}</div>
                    </div>
                    ${winnerRight}
                </div>
                <table class="h-stats-table">
                    <thead>
                        <tr>
                            <th>Statistic</th>
                            <th>${n1}</th>
                            <th>${n2}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    // ============================================================
    // CAROUSEL STATE
    // ============================================================
    let carouselIdx = 0;
    let carouselTotal = 0;
    let touchStartX = 0;

    function formatDuration(secs) {
        if (!secs) return null;
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const rm = m % 60;
            return `${h}h ${String(rm).padStart(2,'0')}m`;
        }
        return `${m}m ${String(s).padStart(2,'0')}s`;
    }

    function escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // Separa as notas geradas automaticamente das notas do utilizador
    // As notas geradas começam com "⏱" ou "📊"
    function getUserNotes(notes) {
        if (!notes) return '';
        // Encontrar início das notas do utilizador (após o bloco de stats)
        const lines = notes.split('\n');
        // Procurar última linha divisória após TOTAL
        let afterStats = false;
        let userStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('TOTAL')) afterStats = true;
            if (afterStats && lines[i].startsWith('─') && i > 0) { userStart = i + 1; }
        }
        if (userStart >= 0) {
            return lines.slice(userStart).join('\n').trim();
        }
        // Fallback: se não tem stats, mostrar tudo
        if (!notes.includes('📊')) return notes.trim();
        return '';
    }

    function buildMatchStatsTable(entry) {
        const notes = entry.notes || '';
        if (!notes.includes('📊')) return ''; // jogo antigo sem stats

        const p = entry.players || ['P1','P2','P3','P4'];
        const hdr1 = `${p[0]} | ${p[1]}`;
        const hdr2 = `${p[2]} | ${p[3]}`;

        // Parse das linhas de stats geradas
        const lines = notes.split('\n');
        let sections = [];
        let cur = null;
        let inStats = false;

        for (const line of lines) {
            if (line.startsWith('📊')) { inStats = true; continue; }
            if (!inStats) continue;
            if (line.startsWith('▸')) {
                if (cur) sections.push(cur);
                cur = { label: line.replace('▸','').trim(), rows: [] };
                continue;
            }
            if (line.startsWith('TOTAL')) {
                if (cur) sections.push(cur);
                cur = { label: 'TOTAL', rows: [], isTotal: true };
                continue;
            }
            if (!cur) continue;
            if (line.startsWith('─') || line.trim() === '') continue;
            // Parse "Label    val1    val2"
            const m = line.match(/^(.+?)\s{2,}(\S+)\s+(\S+)\s*$/);
            const m1 = line.match(/^(.+?)\s{2,}(\S+)\s*$/); // linha com 1 valor (deuces)
            if (m) {
                cur.rows.push({ label: m[1].trim(), v1: m[2], v2: m[3] });
            } else if (m1 && !line.startsWith('─')) {
                cur.rows.push({ label: m1[1].trim(), v1: m1[2], v2: m1[2] });
            }
        }
        if (cur) sections.push(cur);
        if (!sections.length) return '';

        const valClass = (label) => {
            if (label.includes('Golden')) return 'val-gp';
            if (label.includes('Star'))   return 'val-sp';
            if (label.includes('Won'))    return 'val-win';
            return '';
        };

        let html = `
        <div class="h-match-stats-wrap">
            <div class="h-match-stats-header">
                <span class="h-match-stats-title">📊 Match Stats</span>
            </div>
            <table class="h-stats-html-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>${escHtml(hdr1)}</th>
                        <th>${escHtml(hdr2)}</th>
                    </tr>
                </thead>
                <tbody>`;

        for (const sec of sections) {
            const headClass = sec.isTotal ? 'total-head' : 'section-head';
            html += `<tr class="${headClass}"><td colspan="3">${escHtml(sec.label)}</td></tr>`;
            for (const r of sec.rows) {
                const vc = valClass(r.label);
                html += `<tr>
                    <td>${escHtml(r.label)}</td>
                    <td class="${vc}">${escHtml(r.v1)}</td>
                    <td class="${vc}">${escHtml(r.v2)}</td>
                </tr>`;
            }
        }

        html += `</tbody></table></div>`;
        return html;
    }

    // ============================================================
    // FULLSCREEN NOTES EDITOR
    // ============================================================
    let _notesFsIdx = null; // índice do jogo no histórico (-1 = jogo activo)

    function openNotesFs(idx) {
        _notesFsIdx = idx;
        const history = loadHistory();
        const entry = history[idx];
        if (!entry) return;
        const userTxt = getUserNotes(entry.notes || '');
        const ta = document.getElementById('notes-fs-textarea');
        ta.value = userTxt;
        updateNotesFsCounter();
        document.getElementById('notes-fs-overlay').classList.add('show');
        setTimeout(() => ta.focus(), 120);
    }

    function closeNotesFs() {
        document.getElementById('notes-fs-overlay').classList.remove('show');
        _notesFsIdx = null;
    }

    function updateNotesFsCounter() {
        const len = document.getElementById('notes-fs-textarea').value.length;
        document.getElementById('notes-fs-counter').textContent = `${len} / 2000`;
    }

    function saveNotesFs() {
        const newUserNotes = document.getElementById('notes-fs-textarea').value.trim();
        const history = loadHistory();
        if (_notesFsIdx === null || !history[_notesFsIdx]) { closeNotesFs(); return; }

        const entry = history[_notesFsIdx];
        const existingNotes = entry.notes || '';

        // Reconstruir: manter bloco ⏱ + 📊, substituir parte do utilizador
        let statsBlock = '';
        if (existingNotes.includes('📊')) {
            const lines = existingNotes.split('\n');
            let capturing = false;
            let statLines = [];
            let afterLastDivider = false;
            // Capturar tudo até ao fim da última linha divisória após TOTAL
            let lastDividerIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('⏱') || lines[i].startsWith('📊')) capturing = true;
                if (capturing) {
                    statLines.push(lines[i]);
                    if (lines[i].startsWith('TOTAL')) afterLastDivider = true;
                    if (afterLastDivider && lines[i].startsWith('─')) lastDividerIdx = statLines.length - 1;
                }
            }
            statsBlock = statLines.slice(0, lastDividerIdx + 1).join('\n');
        } else if (existingNotes.startsWith('⏱')) {
            statsBlock = existingNotes.split('\n\n')[0];
        }

        const newFull = newUserNotes
            ? (statsBlock ? statsBlock + '\n\n' + newUserNotes : newUserNotes)
            : statsBlock;

        history[_notesFsIdx].notes = newFull;
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch(e) {}

        // Actualizar preview no carousel sem re-render completo
        const preview = document.getElementById(`h-notes-${_notesFsIdx}`);
        if (preview) preview.value = newUserNotes;

        closeNotesFs();
    }

    function buildGameSlide(entry, idx) {
        const sMode = entry.setMode === 'proset' ? 'ProSet'
            : entry.setMode === 'supertie' ? 'Supertie' : '3 Sets';
        const pMode = entry.pointMode === 'star' ? 'SP' : 'GP';
        const modeLabel = `${sMode} · ${pMode}`;
        const notes = entry.notes || '';
        const timeLine = notes.split('\n').find(l => l.startsWith('⏱'));
        const duration = timeLine ? timeLine.replace('⏱ Match Time:', '').trim() : null;
        return `
            <div class="h-game">
                <div class="h-game-meta">
                    <div class="h-game-meta-left">
                        <span class="h-game-date">${formatDate(entry.date)}</span>
                        <span class="h-game-modebadge">${modeLabel}</span>
                        ${duration ? `<span class="h-game-duration">MATCH TIME: ${duration}</span>` : ''}
                    </div>
                    <button class="h-delete-btn" onclick="deleteMatch(${idx})" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                    </button>
                </div>
                ${buildPairBlock(entry, 0, entry.winner === 0)}
                ${buildPairBlock(entry, 1, entry.winner === 1)}
                ${buildMatchStatsTable(entry)}
                <div class="h-notes-box">
                    <div class="h-notes-label">
                        <span>Notes</span>
                        <button class="h-notes-expand-btn" onclick="openNotesFs(${idx})">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                            </svg>
                            Edit
                        </button>
                    </div>
                    <textarea class="h-notes-preview" readonly id="h-notes-${idx}">${escHtml(getUserNotes(entry.notes || ''))}</textarea>
                </div>
            </div>`;
    }

    // ============================================================
    // EXPORT POR JOGO DO HISTÓRICO — Email (mailto) + Excel
    // Botões diretos no footer do histórico; usam sempre o jogo
    // actualmente visível no carousel (carouselIdx).
    // ============================================================
    const EMAIL_LAST_KEY = 'padel_last_email';

    // Alinha texto à direita dentro de uma largura fixa (para colunas monoespaçadas)
    function padLeft(str, width) {
        str = String(str);
        return str.length >= width ? str : ' '.repeat(width - str.length) + str;
    }
    function padRight(str, width) {
        str = String(str);
        return str.length >= width ? str : str + ' '.repeat(width - str.length);
    }

    function buildPairEmailBlock(entry, pairIdx) {
        const offset = pairIdx * 2;
        const pSuffix = ['p1','p2','p3','p4'];
        const n1 = entry.players[offset] || '';
        const n2 = entry.players[offset + 1] || '';
        const tot1 = ((entry.stats ? entry.stats[`s_1srv_${pSuffix[offset]}`] : undefined) || 0) + ((entry.stats ? entry.stats[`s_2srv_${pSuffix[offset]}`] : undefined) || 0);
        const tot2 = ((entry.stats ? entry.stats[`s_1srv_${pSuffix[offset+1]}`] : undefined) || 0) + ((entry.stats ? entry.stats[`s_2srv_${pSuffix[offset+1]}`] : undefined) || 0);

        // Largura das colunas — baseada no maior valor entre label/nomes/dados
        const labelW = Math.max(...STAT_LABELS.map(l => l.length)) + 2;
        const rows = STAT_LABELS.map((label, i) => {
            const key = STAT_KEYS[i];
            const v1 = (entry.stats ? entry.stats[`s_${key}_${pSuffix[offset]}`] : undefined) || 0;
            const v2 = (entry.stats ? entry.stats[`s_${key}_${pSuffix[offset+1]}`] : undefined) || 0;
            const isServe = (key === '1srv' || key === '2srv');
            const c1 = isServe ? formatServeStat(v1, tot1) : String(v1);
            const c2 = isServe ? formatServeStat(v2, tot2) : String(v2);
            return { label, c1, c2 };
        });
        const colW = Math.max(n1.length, n2.length, ...rows.map(r => r.c1.length), ...rows.map(r => r.c2.length)) + 2;

        const lines = [];
        lines.push(`${n1} / ${n2}`);
        lines.push('-'.repeat(Math.max(n1.length + n2.length + 3, 24)));
        lines.push(`${padRight('', labelW)}${padLeft(n1, colW)}${padLeft(n2, colW)}`);
        rows.forEach(r => {
            lines.push(`${padRight(r.label, labelW)}${padLeft(r.c1, colW)}${padLeft(r.c2, colW)}`);
        });
        return lines.join('\n');
    }

    // Versão em texto plano do Match Stats (duração, deuces, golden point, etc.)
    // — reaproveita o mesmo parsing de buildMatchStatsTable, mas devolve texto alinhado
    function buildMatchStatsEmailText(entry) {
        const notes = entry.notes || '';
        if (!notes.includes('📊')) return '';

        const p = entry.players || ['P1','P2','P3','P4'];
        const hdr1 = `${p[0]} | ${p[1]}`;
        const hdr2 = `${p[2]} | ${p[3]}`;

        const lines = notes.split('\n');
        let sections = [];
        let cur = null;
        let inStats = false;

        for (const line of lines) {
            if (line.startsWith('📊')) { inStats = true; continue; }
            if (!inStats) continue;
            if (line.startsWith('▸')) {
                if (cur) sections.push(cur);
                cur = { label: line.replace('▸','').trim(), rows: [] };
                continue;
            }
            if (line.startsWith('TOTAL')) {
                if (cur) sections.push(cur);
                cur = { label: 'TOTAL', rows: [], isTotal: true };
                continue;
            }
            if (!cur) continue;
            if (line.startsWith('─') || line.trim() === '') continue;
            const m = line.match(/^(.+?)\s{2,}(\S+)\s+(\S+)\s*$/);
            const m1 = line.match(/^(.+?)\s{2,}(\S+)\s*$/);
            if (m) {
                cur.rows.push({ label: m[1].trim(), v1: m[2], v2: m[3] });
            } else if (m1 && !line.startsWith('─')) {
                cur.rows.push({ label: m1[1].trim(), v1: m1[2], v2: m1[2] });
            }
        }
        if (cur) sections.push(cur);
        if (!sections.length) return '';

        var allLabels = sections.reduce(function(acc, s) { return acc.concat(s.rows.map(function(r) { return r.label; })); }, []);
        const labelW = Math.max(hdr1.length === 0 ? 0 : 0, ...allLabels.map(l => l.length), 0) + 2;
        var allVals = sections.reduce(function(acc, s) { return acc.concat(s.rows.reduce(function(a2, r) { return a2.concat([r.v1, r.v2]); }, [])); }, []);
        const colW = Math.max(hdr1.length, hdr2.length, ...allVals.map(v => String(v).length), 0) + 2;

        const out = [];
        out.push('MATCH STATS');
        out.push('-'.repeat(24));
        out.push(`${padRight('', labelW)}${padLeft(hdr1, colW)}${padLeft(hdr2, colW)}`);
        for (const sec of sections) {
            out.push(sec.label + ':');
            for (const r of sec.rows) {
                out.push(`${padRight('  ' + r.label, labelW)}${padLeft(r.v1, colW)}${padLeft(r.v2, colW)}`);
            }
        }
        return out.join('\n');
    }

    function buildGameEmailText(entry) {
        const sMode = entry.setMode === 'proset' ? 'ProSet'
            : entry.setMode === 'supertie' ? 'Supertie' : '3 Sets';
        const pMode = entry.pointMode === 'star' ? 'Star Point' : 'Golden Point';
        const [p1, p2, p3, p4] = entry.players;
        const winnerNames = entry.winner === 0 ? `${p1} / ${p2}` : `${p3} / ${p4}`;
        const lines = [];
        lines.push(`PADEL COACHING — MATCH REPORT`);
        lines.push('='.repeat(32));
        lines.push(`Date: ${formatDate(entry.date)}`);
        lines.push(`Mode: ${sMode} · ${pMode}`);
        lines.push('');
        lines.push(`${p1} / ${p2}  vs  ${p3} / ${p4}`);
        lines.push(`Score: ${formatScore(entry)}`);
        lines.push(`Winners: ${winnerNames}`);
        lines.push('');
        lines.push(buildPairEmailBlock(entry, 0));
        lines.push('');
        lines.push(buildPairEmailBlock(entry, 1));
        const matchStatsText = buildMatchStatsEmailText(entry);
        if (matchStatsText) {
            lines.push('');
            lines.push(matchStatsText);
        }
        const userNotes = getUserNotes(entry.notes || '');
        if (userNotes) {
            lines.push('');
            lines.push('Notes:');
            lines.push(userNotes);
        }
        return lines.join('\n');
    }

    function sendGameByEmail() {
        const input = document.getElementById('email-recipient-input');
        let lastEmail = '';
        try { lastEmail = localStorage.getItem(EMAIL_LAST_KEY) || ''; } catch(e) {}
        input.value = lastEmail;
        document.getElementById('email-prompt-overlay').classList.add('show');
        setTimeout(() => input.focus(), 100);
    }

    function closeEmailPrompt(e) {
        if (e && e.target.id !== 'email-prompt-overlay') return;
        document.getElementById('email-prompt-overlay').classList.remove('show');
    }

    function confirmSendEmail() {
        const input = document.getElementById('email-recipient-input');
        const email = input.value.trim();
        if (!email || !email.includes('@')) {
            showToast('⚠️ Enter a valid email', '#b45309');
            return;
        }
        try { localStorage.setItem(EMAIL_LAST_KEY, email); } catch(e) {}

        const history = loadHistory();
        const entry = history[carouselIdx];
        if (!entry) { closeEmailPrompt(); return; }

        const subject = `Padel Match Report — ${formatDate(entry.date)}`;
        const body = buildGameEmailText(entry);
        const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        document.getElementById('email-prompt-overlay').classList.remove('show');
        window.location.href = mailtoUrl;
    }

    function exportHistoryGameToExcel() {
        const history = loadHistory();
        const entry = history[carouselIdx];
        if (!entry) return;

        const [p1, p2, p3, p4] = entry.players;
        const isProset = entry.setMode === 'proset';
        const scoreRows = [
            ['', isProset ? '—' : 'Set 1', isProset ? '—' : 'Set 2', isProset ? 'ProSet' : entry.setMode === 'supertie' ? 'Supertie' : 'Set 3'],
            [p1 + ' / ' + p2, isProset ? '—' : entry.sets[0][0], isProset ? '—' : entry.sets[1][0], entry.sets[2][0]],
            [p3 + ' / ' + p4, isProset ? '—' : entry.sets[0][1], isProset ? '—' : entry.sets[1][1], entry.sets[2][1]],
        ];
        const pair1Rows = [['Statistic', p1, p2]];
        const pair2Rows = [['Statistic', p3, p4]];
        STAT_LABELS.forEach((label, i) => {
            const key = STAT_KEYS[i];
            pair1Rows.push([label, (entry.stats ? entry.stats[`s_${key}_p1`] : undefined) || 0, (entry.stats ? entry.stats[`s_${key}_p2`] : undefined) || 0]);
            pair2Rows.push([label, (entry.stats ? entry.stats[`s_${key}_p3`] : undefined) || 0, (entry.stats ? entry.stats[`s_${key}_p4`] : undefined) || 0]);
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scoreRows), 'Result');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pair1Rows), 'Pair 1');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pair2Rows), 'Pair 2');

        const d = new Date(entry.date);
        const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
        XLSX.writeFile(wb, `padel_${stamp}.xlsx`);
    }

    function renderCarousel() {
        const history = loadHistory();
        const track = document.getElementById('h-track');
        const dots = document.getElementById('h-dots');
        const counter = document.getElementById('h-counter');
        track.innerHTML = '';
        dots.innerHTML = '';
        carouselTotal = history.length;

        if (carouselTotal === 0) {
            const slide = document.createElement('div');
            slide.className = 'history-carousel-slide';
            slide.innerHTML = '<div class="history-empty">No games recorded yet.</div>';
            track.appendChild(slide);
            counter.textContent = '';
            dots.innerHTML = '';
        } else {
            history.forEach((entry, idx) => {
                const slide = document.createElement('div');
                slide.className = 'history-carousel-slide';
                slide.innerHTML = buildGameSlide(entry, idx);
                track.appendChild(slide);
                const dot = document.createElement('div');
                dot.className = 'h-dot' + (idx === carouselIdx ? ' active' : '');
                dot.onclick = () => goToSlide(idx);
                dots.appendChild(dot);
            });
            counter.textContent = `${carouselIdx + 1} / ${carouselTotal}`;
        }
        updateCarouselPos(false);
        updateNavBtns();
    }

    function updateCarouselPos(animate) {
        const track = document.getElementById('h-track');
        if (!animate) track.style.transition = 'none';
        else track.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1)';
        track.style.transform = `translateX(-${carouselIdx * 100}vw)`;
        if (!animate) track.offsetHeight; // force reflow
    }

    function updateNavBtns() {
        // Navegação por swipe mantida; botões Prev/Next removidos
        // update dots
        document.querySelectorAll('.h-dot').forEach((d, i) => d.classList.toggle('active', i === carouselIdx));
        const counter = document.getElementById('h-counter');
        if (carouselTotal > 0) counter.textContent = `${carouselIdx + 1} / ${carouselTotal}`;
    }

    function goToSlide(idx) {
        carouselIdx = Math.max(0, Math.min(idx, carouselTotal - 1));
        updateCarouselPos(true);
        updateNavBtns();
    }

    function carouselNav(dir) { goToSlide(carouselIdx + dir); }

    function openHistory() {
        carouselIdx = 0;
        renderCarousel();
        document.getElementById('history-overlay').classList.add('show');

        // Swipe support
        const wrap = document.getElementById('h-track-wrap');
        wrap.ontouchstart = e => { touchStartX = e.touches[0].clientX; };
        wrap.ontouchend = e => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(dx) > 40) carouselNav(dx < 0 ? 1 : -1);
        };
    }

    function closeHistory() {
        document.getElementById('history-overlay').classList.remove('show');
    }

    function deleteMatch(idx) {
        if (!confirm('Delete this game from history?')) return;
        let history = loadHistory();
        history.splice(idx, 1);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch(e) {}
        carouselIdx = Math.max(0, Math.min(carouselIdx, history.length - 1));
        renderCarousel();
    }

    // ============================================================
    // NOTES
    // ============================================================
    let currentNotes = '';

    function openNotes() {
        document.getElementById('notes-textarea').value = currentNotes;
        updateNotesCounter();
        document.getElementById('notes-overlay').classList.add('show');
        setTimeout(() => document.getElementById('notes-textarea').focus(), 100);
    }
    function closeNotes() {
        document.getElementById('notes-overlay').classList.remove('show');
    }
    function closeNotesOnBg(e) {
        if (e.target === document.getElementById('notes-overlay')) closeNotes();
    }
    function updateNotesCounter() {
        const len = document.getElementById('notes-textarea').value.length;
        document.getElementById('notes-counter').textContent = `${len} / 500`;
    }
    function saveNotes() {
        currentNotes = document.getElementById('notes-textarea').value.trim();
        closeNotes();
    }

    // saveHistoryNote substituída por openNotesFs / saveNotesFs

    // ============================================================
    // MATCH TIMER
    // ============================================================
    let timerSeconds = 0;
    let timerRunning = false;
    let timerInterval = null;

    function toggleTimer() {
        if (timerRunning) {
            clearInterval(timerInterval);
            timerRunning = false;
        } else {
            timerInterval = setInterval(() => {
                timerSeconds++;
                updateTimerDisplay();
            }, 1000);
            timerRunning = true;
        }
        updateTimerDisplay();
    }

    function updateTimerDisplay() {
        const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
        const s = String(timerSeconds % 60).padStart(2, '0');
        const el = document.getElementById('timer-display-p');
        if (el) el.textContent = `${m}:${s}`;
        const timer = document.getElementById('timer-p');
        if (timer) timer.classList.toggle('running', timerRunning);
    }

    function resetTimer() {
        clearInterval(timerInterval);
        timerRunning = false;
        timerSeconds = 0;
        updateTimerDisplay();
    }

    function forceClear() {
        clearGameState();
        state = { sets:[[0,0],[0,0],[0,0]], currentSet:0, pts:[0,0], isSuperTieBreak:false, isTieBreakMode:false, matchOver:false, tiebreakPts:[null,null,null], deuceCount:0 };
        currentNotes = '';
        resetSetStats();
        resetTimer();
        document.getElementById('game-over-p').classList.remove('show');
        document.getElementById('golden-point-p').classList.remove('show');
        document.getElementById('break-point-p').classList.remove('show');
        resetStats();
        _serveStatCounted = false;
        updateSet3Labels();
        updateConfig();
        updateScreen();
        initServe(); // reiniciar indicador de serviço
    }

    function checkForUpdates() {
        if (!('serviceWorker' in navigator)) {
            showToast('Service Worker not available');
            return;
        }
        showToast('🔄 Checking for updates...');
        navigator.serviceWorker.getRegistration().then(reg => {
            if (!reg) { showToast('No SW registered'); return; }
            reg.update().then(() => {
                if (reg.waiting) {
                    // Novo SW já está à espera — activar e recarregar
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                    // controllerchange vai disparar o reload automático
                } else if (reg.installing) {
                    // A instalar agora — esperar
                    reg.installing.addEventListener('statechange', e => {
                        if (e.target.state === 'installed') {
                            e.target.postMessage({ type: 'SKIP_WAITING' });
                        }
                    });
                } else {
                    // Já está na versão mais recente
                    showToast('✅ Already up to date');
                }
            });
        });
    }

    function askResetMatch() {
        if (!checkLicenseForNewGame()) return;
        document.getElementById('ng-overlay').classList.add('show');
    }

    function ngConfirm() {
        document.getElementById('ng-overlay').classList.remove('show');
        forceClear();
    }

    function ngCancel() {
        document.getElementById('ng-overlay').classList.remove('show');
    }



    // ============================================================
    // SPLASH SCREEN — 2s ao arrancar
    // ============================================================
    const APP_ICON_B64 = 'data:image/png;base64,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';

    function initSplash() {
        const splash = document.getElementById('splash-screen');
        const icon   = document.getElementById('splash-icon');
        if (!splash || !icon) return;
        icon.src = APP_ICON_B64;
        var verEl = document.getElementById('splash-version');
        if (verEl) verEl.textContent = 'V ' + APP_VERSION;
        // Fechar após 2s com fade de 0.5s
        setTimeout(function() {
            splash.classList.add('fade-out');
            setTimeout(function() {
                splash.classList.add('hidden');
            }, 500);
        }, 2000);
    }

    // ============================================================
    // SPONSOR CAROUSEL
    // ============================================================
    const SPONSOR_IMAGES = [
        'data:image/png;base64,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',
        'data:image/jpeg;base64,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',
        'data:image/png;base64,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VFZWRoWFheRyueiHP/whPf3007R27Vo6//zzyev1UmFhod2+0tJScrlcdN5559nEcu+99xIAysnJoZKSEiooKKBwOExZWVk0ZMgQWr58OVVUVND1119PbrebcnJyqLCwkPLz8ykUClF+fj4VFxcTY4zuvPNOIiK68847Sdd1uz+tsczJyaHc3FyaNWsWrVu3jp5++mkaOXKkXaf1bmvcV69eTUIIampqoiFDhpDH40kbn3A4TB6Ph4YNG2aTZV+jBOQql/jSBGiFjdTW1tJRRx1F2dnZttSRKv2NHDmSNmzYQC+++CK9+OKL9NJLL9GLL75IS5YsoWOPPZYcDgeFw2HKz8+3iURVVWKM0fTp06mlpYWIiLZs2UJut9smndQFqGkaTZ06lYQQtmTz4x//mDjnVFxcnEbK+fn55Pf76a233iIiovnz59vlrIVtESDnnJ555hkiInrjjTfI5/OlSYihUIhKSkoIAP3sZz+zpTRFUXqVVnRdp6lTp6ZJKjNnziRVVTMkZ03T6I477iAiorVr19rhNg6Hww4dssJA7r333rSxmTp1qt2vVp0WsVjS0u9//3sCYG8k1jf7/X4qLy+nffv22fVVVFSQpmkZfVlcXEwul4tOPPFEIiJaunSpXaf17oKCAgoEApSbm0sVFRVp7Rw2bFiatJqfn09FRUXkdDrpb3/7GxERzZgxw950UsfHmivr168/7HAbucqlF/hLeYFTbTM///nPsWzZsgybmKIodmBqS0tLmsfVMtR7vV5kZWWlefSGDx+Oo48+GieeeCKmTZtmG+fPOussvPnmm8jJybHtT5xzRKNRuFwubN68GSUlJWCMYd26dTj33HPh9/vtegFA13VUVVXh1ltvxdy5c7F161acccYZtre5ZzjHRRddhD//+c/o6OjAhAkT8O677yInJ8dur6Io6OzsRCgUwmuvvYZoNIoTTjgBkUgETqfTtjkqioKuri6EQiG88cYbdrsqKirw/e9/H9nZ2WntZIyhra0Nr7/+OoYOHYpFixbhgw8+sENOrNAhXdcxfPhwu58AYOnSpZgxY0aaJzu1n9555x3U19dj1KhRdviRVU5VVdTW1mLlypW45JJL0N3dje7ubowfPx47d+5EVlaWXdYaz9bWVrz++usQQmDs2LHw+/3gnKd9e11dHZ544ok0m+Ytt9yCu+66Ky3cSFEU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/vz5vS7gYDBIubm59O67737m5Lv99tttwugZ9Mw5p0svvTQt/KG3xeXz+WjdunV2nZs2bbKDgnuSmqIodPHFFxMRUV1dXa8hO+FwmNxuN33ve9+jjo4OEkLQ9OnTM0I/LNU7Ozubtm/fTl1dXTRixAjyeDwZKnowGKS8vDzatm2b3c4PPvigV9XOWtwPPvggvfHGG6Rpmk32qeSjqqod62jhzjvvJMZYhopumSJ2795NHR0dNHDgwLSQk1SSnj17dlqdl112WUZojtUeRVFozZo11NLSQuFwmHJzczO+hTFmB693dnbawcyWOcCKyywsLKTS0lLyer105513UmtrK4XD4YxNLxwOk9PppAkTJtjq+ZfJDCRXucRhEaC1227fvp0CgQAFg8E0orFit6666iqqr6+njz/+mKqqqqimpoaqq6tp586d9MQTT9CECRPI4XCkBRAXFRXZsXQjR46klpYWqquro7Kysl4lEJ/PR4MGDaK2tjYSQtDatWuprKysV/ubJUF98sknRER09dVXk6IoGWQVCoXI6/XSa6+9RkREa9asOaQUwhijefPmERHRLbfcYm8GqTFqJSUlpKqqHRto2R1Hjx5Nbrc7Le7R+vYf/ehHZJomDR48mLKysno9bWERWkNDAz333HN0wQUXkM/nS/uOVKn37rvvJiKi5557jhwOR0ad1obx/vvvExFRe3s7LViwgBwOR692Qk3TaNq0aUREtHLlyow4S0tKHTBgANXX19vfvm/fPjr66KPJ5XLZpz7y8vKoqKiIANCYMWMoFovRlVdemUHmqfZea3P9sim25CqXNsDD8vpaiQl+8YtfoLOzM8MjahgGsrOz8fTTT+OPf/yjbe+x7H+RSATRaBS6riMYDNq/i8ViaG9vR2dnJ04//XSsWLECfr8fFRUVaGpqgsfjSbMPCiHgcrnQ0NCAKVOmwDRNvP7669B1HR6Px7axWTan2tpaLF68GGVlZVi/fj0effTRXr25+/fvx6xZszBmzBg0Nzdjzpw59uH/VLufFUZz44034r333sN9991nhwBZ7+WcIxKJwOPxYN26dZg4cSJUVcU777yDtrY2ZGdn27ZQIkJVVRXOPfdcLFu2DE899ZTtwe7pTbXi4CZPnozm5mZUVVX16vVVFAWNjY0YN24crrrqKhARqqurEY1G7XCS1LPFpmli+vTpKC4u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',
        'data:image/png;base64,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',
    ];
    let _sponsorIdx = 0;
    let _sponsorTimer = null;

    function initSponsorCarousel() {
        const img = document.getElementById('sponsor-slide');
        if (!img) return;
        img.src = SPONSOR_IMAGES[0];
        img.style.opacity = '1';
        _sponsorIdx = 0;
        if (_sponsorTimer) clearInterval(_sponsorTimer);
        _sponsorTimer = setInterval(advanceSponsor, 5000);
    }

    function advanceSponsor() {
        const img = document.getElementById('sponsor-slide');
        if (!img) return;
        img.style.opacity = '0';
        setTimeout(() => {
            _sponsorIdx = (_sponsorIdx + 1) % SPONSOR_IMAGES.length;
            img.src = SPONSOR_IMAGES[_sponsorIdx];
            img.style.opacity = '1';
        }, 600);
    }

    updateSet3Labels();
    updateConfig();

    // Restaurar jogo em curso se existir, caso contrário arrancar do zero
    const hadSavedGame = restoreGameState();

    updateScreen();
    applyStatsVisibility();
    restoreLogos();
    restorePhotos();
    if (!hadSavedGame) restoreNames();
    if (!hadSavedGame) initServe();
    else renderServeBalls();
    initSplash();
    initSponsorCarousel();

    // ── Expor funções públicas no window (chamadas por onclick no HTML) ──────
    Object.assign(window, {
        addPoint, removePoint,
        askResetMatch, carouselNav,
        activateVoucher, copyDeviceId, checkForUpdates,
        ngConfirm, ngCancel,
        closeConfig, closeConfigOnBg,
        closeHistory, closeNotes, closeNotesFs, closeNotesOnBg,
        openConfig, openHistory, openNotes,
        saveNotes, saveNotesFs,
        setPointMode, setSetMode, setStatsMode, setProsetMode,
        toggleTimer,
        updateNotesCounter, updateNotesFsCounter,
        // Histórico (chamadas dinâmicas em buildGameSlide)
        deleteMatch, openNotesFs,
        sendGameByEmail, closeEmailPrompt, confirmSendEmail,
        exportHistoryGameToExcel,
        // Estatísticas — não têm onclick mas expostas por segurança
        incStat, decStatById,
    });

})();
