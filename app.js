/**
 * Jesus Youth Campus Meet - Registration & Attendance System
 * Theme: Cyber Violet & Deep Cosmic Blue
 * Core Application Engine & Advanced QR Scanner
 */

const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1GzdwRe-xsHEH1O_Dhu5qju4m3BPZvaAs8yqn4wOmwtQ/export?format=csv';
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'campusmeet2026'
};

// Bump this version whenever database.js is re-generated from Google Sheets
// This forces localStorage to clear and reload fresh data automatically
const DB_VERSION = 'v5-147-confirmed-yes-only';

// Shared rule: only "yes" (case-insensitive) counts as confirmed
const isConfirmedYes = val => (val || '').trim().toLowerCase() === 'yes';

function onlyConfirmedYes(list) {
  return (list || []).filter(p => isConfirmedYes(p.confirmed));
}

function sortParticipantsByCollege() {
  state.participants.sort((a, b) => {
    const collegeCompare = (a.college || '').trim().localeCompare((b.college || '').trim(), undefined, { sensitivity: 'base' });
    if (collegeCompare !== 0) return collegeCompare;
    return (a.name || '').trim().localeCompare((b.name || '').trim(), undefined, { sensitivity: 'base' });
  });
}

// App State
const state = {
  participants: [],
  recentScans: [],
  activeTab: 'scanner-view',
  lastScannedId: null,
  html5QrCode: null,
  currentTrack: null,
  isScanning: false,
  isTorchOn: false,
  isProcessingScan: false,
  cameras: [],
  currentCameraId: null,
  filters: {
    search: '',
    college: '',
    parish: '',
    status: '',
    sortBy: 'id-asc'
  },
  googleScriptUrl: localStorage.getItem('JY_SCRIPT_URL') || '',
  isAuthenticated: false
};

// ==========================================================================
// Audio & Haptic Feedback Engine
// ==========================================================================

const AudioFeedback = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
  },
  play(type) {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const now = this.ctx.currentTime;

      if (type === 'success') {
        // Futuristic cyber synth arpeggio: C5 -> E5 -> G5 -> C6
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.06);
          gain.gain.setValueAtTime(0.2, now + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.22);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now + idx * 0.06);
          osc.stop(now + idx * 0.06 + 0.22);
        });
      } else if (type === 'warning') {
        // Double electronic pulse (already checked-in)
        [587.33, 587.33].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);
          gain.gain.setValueAtTime(0.25, now + idx * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.1);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.1);
        });
      } else if (type === 'error') {
        // Low sci-fi buzz
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.32);
      }
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }
};

// ==========================================================================
// Database & Storage Operations
// ==========================================================================

function loadParticipants() {
  const storedVersion = localStorage.getItem('JY_DB_VERSION');
  const storedData    = localStorage.getItem('JY_REAL_DATABASE_V3');

  if (storedVersion === DB_VERSION && storedData) {
    // Version matches — use cached data (preserves check-in marks)
    try {
      state.participants = onlyConfirmedYes(JSON.parse(storedData));
      sortParticipantsByCollege();
      console.log('Loaded', state.participants.length, 'confirmed Yes participants from localStorage');
      if (state.participants.length === 0 && window.PRELOADED_PARTICIPANTS && window.PRELOADED_PARTICIPANTS.length > 0) {
        forceReloadFromPreloaded();
      }
    } catch (e) {
      console.warn('localStorage parse error, reloading from database.js');
      forceReloadFromPreloaded();
    }
  } else {
    // Version mismatch or first run — load fresh from database.js
    console.log('DB version mismatch or first run. Loading fresh from database.js...');
    forceReloadFromPreloaded();
  }

  // Load recent scans from present participants
  state.recentScans = state.participants
    .filter(p => p.status === 'Present' && p.checkInTime)
    .slice(-15)
    .reverse();
}

function forceReloadFromPreloaded() {
  const existingCheckins = {};
  (state.participants || []).forEach(p => {
    if (p.status === 'Present') {
      const key = (p.name + '|' + p.phone).toLowerCase().trim();
      existingCheckins[key] = p.checkInTime || 'Present';
    }
  });

  if (window.PRELOADED_PARTICIPANTS && Array.isArray(window.PRELOADED_PARTICIPANTS) && window.PRELOADED_PARTICIPANTS.length > 0) {
    const confirmed = onlyConfirmedYes(JSON.parse(JSON.stringify(window.PRELOADED_PARTICIPANTS)));
    state.participants = confirmed.map((p, index) => {
      const key = (p.name + '|' + p.phone).toLowerCase().trim();
      const priorCheckInTime = existingCheckins[key] || null;
      return {
        ...p,
        id: 'JY-' + String(index + 1).padStart(3, '0'),
        status: priorCheckInTime ? 'Present' : (p.status || 'Absent'),
        checkInTime: priorCheckInTime || p.checkInTime || null
      };
    });
    sortParticipantsByCollege();
    console.log('Loaded', state.participants.length, 'confirmed Yes participants from database.js');
  } else {
    state.participants = [];
    console.warn('No PRELOADED_PARTICIPANTS found in database.js');
  }
  saveParticipants();
}

// Keep backward compat alias
function fallbackToPreloaded() {
  forceReloadFromPreloaded();
}

function saveParticipants() {
  sortParticipantsByCollege();
  localStorage.setItem('JY_REAL_DATABASE_V3', JSON.stringify(state.participants));
  localStorage.setItem('JY_DB_VERSION', DB_VERSION);
  updateAllViews();
}

// ==========================================================================
// Fetch & Re-sync Direct from Google Sheet
// ==========================================================================

async function fetchGoogleSheetDirect() {
  const btn = document.getElementById('btnSyncFromGoogleSheet');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '⏳ Syncing...';
    btn.disabled = true;
  }

  try {
    const response = await fetch(GOOGLE_SHEET_CSV_URL + '&t=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error("HTTP error " + response.status);
    const text = await response.text();

    const lines = text.split(/\r\n|\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error("Google Sheet returned empty data");

    const headers = parseCSVRow(lines[0]).map(h => (h || '').trim().toLowerCase());
    const col = (names, fallback) => {
      const exact = headers.findIndex(h => names.includes(h));
      if (exact >= 0) return exact;
      const partial = headers.findIndex(h => names.some(n => n.length >= 4 && h.includes(n)));
      return partial >= 0 ? partial : fallback;
    };
    const nameIdx      = col(['name', 'full name', 'student name'], 0);
    const genderIdx    = col(['gender', 'sex'], 1);
    const collegeIdx   = col(['college', 'institution'], 2);
    const courseIdx    = col(['course', 'department'], 3);
    const yearIdx      = col(['year', 'year of study'], 4);
    const parishIdx    = col(['parish'], 5);
    const dobIdx       = col(['dob', 'date of birth', 'birthday'], 6);
    const phone1Idx    = col(['phone', 'mobile', 'whatsapp no', 'whatsapp'], 7);
    const phone2Idx    = col(['phone 2', 'whatsapp', 'whatsapp number'], 8);
    const confirmedIdx = col(['confirmed', 'confirmation', 'confirm'], 9);
    const paymentIdx   = col(['payment', 'paid'], 10);
    const paymentByIdx = col(['payment by', 'paid by'], 11);

    // Preserve existing check-ins by name+phone key (IDs can shift on re-sync)
    const existingCheckins = {};
    state.participants.forEach(p => {
      if (p.status === 'Present') {
        const key = (p.name + '|' + p.phone).toLowerCase().trim();
        existingCheckins[key] = p.checkInTime || 'Present';
      }
    });

    const newParticipants = [];
    let regNum = 0; // Only increments for CONFIRMED Yes rows

    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVRow(lines[i]);
      if (!row || row.length === 0) continue;

      const name = row[nameIdx] ? row[nameIdx].trim() : '';
      if (!name) continue;

      const confirmed = row[confirmedIdx] ? row[confirmedIdx].trim() : '';

      // Only include rows where Confirmed is "Yes" (case-insensitive)
      if (!isConfirmedYes(confirmed)) continue;

      regNum++;
      const regId = 'JY-' + String(regNum).padStart(3, '0');

      const cell = (idx) => (idx >= 0 && row[idx] ? row[idx].trim() : '');
      const gender    = cell(genderIdx);
      const college   = cell(collegeIdx) || 'Unspecified';
      const course    = cell(courseIdx);
      const year      = cell(yearIdx);
      const parish    = cell(parishIdx) || 'Unspecified';
      const dob       = cell(dobIdx);
      const phone1    = cell(phone1Idx);
      const phone2    = cell(phone2Idx);
      const phone     = phone2 || phone1;
      const payment   = cell(paymentIdx);
      const paymentBy = cell(paymentByIdx);

      // Restore prior check-in status using name+phone fingerprint
      const checkinKey = (name + '|' + phone).toLowerCase().trim();
      const priorCheckInTime = existingCheckins[checkinKey] || null;
      const isPresent = Boolean(priorCheckInTime);

      newParticipants.push({
        id: regId,
        name,
        gender,
        college: college || 'Unspecified',
        course,
        year,
        parish: parish || 'Unspecified',
        dob,
        phone,
        confirmed,
        payment,
        paymentBy,
        status: isPresent ? 'Present' : 'Absent',
        checkInTime: isPresent ? priorCheckInTime : null
      });
    }

    state.participants = newParticipants;
    saveParticipants();
    alert(`✅ Synced ${newParticipants.length} confirmed Yes participants from Google Sheet!\n(Only rows with Confirmed = "Yes" are included.)`);
  } catch (err) {
    console.error("Failed to fetch Google Sheet:", err);
    alert("Could not directly fetch Google Sheet via browser (CORS restriction). Using local database. You can also export your Sheet as CSV and import it using the 'Import CSV' button.");
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
}

function parseCSVRow(line) {
  const result = [];
  let inQuotes = false;
  let curVal = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(curVal);
      curVal = '';
    } else {
      curVal += c;
    }
  }
  result.push(curVal);
  return result;
}

// ==========================================================================
// View Updates & Metrics
// ==========================================================================

function updateAllViews() {
  updateMetrics();
  populateDropdownFilters();
  renderParticipantsTable();
  renderRecentScansList();
  renderAnalytics();
  renderBadgeGrid();
}

function updateMetrics() {
  const total = state.participants.length;
  const present = state.participants.filter(p => p.status === 'Present').length;
  const pending = total - present;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPresent').textContent = present;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('navCountTotal').textContent = total;
  const totalFilterCount = document.getElementById('filterTotalCount');
  if (totalFilterCount) totalFilterCount.textContent = total;
}

// ==========================================================================
// Filter & Sort Operations
// ==========================================================================

function populateDropdownFilters() {
  const collegeSelect = document.getElementById('collegeFilter');
  const parishSelect = document.getElementById('parishFilter');
  const collegeDataList = document.getElementById('knownCollegesList');
  const parishDataList = document.getElementById('knownParishesList');

  const selectedCollege = collegeSelect.value;
  const selectedParish = parishSelect.value;

  // Extract unique sorted colleges & parishes
  const colleges = [...new Set(state.participants.map(p => p.college).filter(Boolean))].sort();
  const parishes = [...new Set(state.participants.map(p => p.parish).filter(Boolean))].sort();

  // Populate College Dropdown
  collegeSelect.innerHTML = '<option value="">All Colleges (Show All)</option>';
  colleges.forEach(col => {
    const count = state.participants.filter(p => p.college === col).length;
    const opt = document.createElement('option');
    opt.value = col;
    opt.textContent = `${col} (${count})`;
    if (col === selectedCollege) opt.selected = true;
    collegeSelect.appendChild(opt);
  });

  // Populate Parish Dropdown
  parishSelect.innerHTML = '<option value="">All Parishes (Show All)</option>';
  parishes.forEach(par => {
    const count = state.participants.filter(p => p.parish === par).length;
    const opt = document.createElement('option');
    opt.value = par;
    opt.textContent = `${par} (${count})`;
    if (par === selectedParish) opt.selected = true;
    parishSelect.appendChild(opt);
  });

  if (collegeDataList) {
    collegeDataList.innerHTML = colleges.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }
  if (parishDataList) {
    parishDataList.innerHTML = parishes.map(p => `<option value="${escapeHtml(p)}">`).join('');
  }
}

function getFilteredAndSortedParticipants() {
  const { search, college, parish, status, sortBy } = state.filters;
  const searchLower = search.trim().toLowerCase();
  const searchDigits = search.replace(/\D/g, '');

  let list = state.participants.filter(p => {
    // Search query match
    if (searchLower) {
      const matchSearch =
        (p.name && p.name.toLowerCase().includes(searchLower)) ||
        (p.id && p.id.toLowerCase().includes(searchLower)) ||
        (p.college && p.college.toLowerCase().includes(searchLower)) ||
        (p.parish && p.parish.toLowerCase().includes(searchLower)) ||
        (p.course && p.course.toLowerCase().includes(searchLower)) ||
        (searchDigits && p.phone && p.phone.replace(/\D/g, '').includes(searchDigits));
      if (!matchSearch) return false;
    }

    // College filter
    if (college && p.college !== college) {
      return false;
    }

    // Parish filter
    if (parish && p.parish !== parish) {
      return false;
    }

    // Status filter
    if (status && p.status !== status) {
      return false;
    }

    return true;
  });

  // Sorting
  list.sort((a, b) => {
    switch (sortBy) {
      case 'id-asc':
        return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'college-asc':
        return (a.college || '').localeCompare(b.college || '') || a.name.localeCompare(b.name);
      case 'parish-asc':
        return (a.parish || '').localeCompare(b.parish || '') || a.name.localeCompare(b.name);
      case 'checkin-desc':
        if (a.status === 'Present' && b.status !== 'Present') return -1;
        if (b.status === 'Present' && a.status !== 'Present') return 1;
        return (b.checkInTime || '').localeCompare(a.checkInTime || '');
      default:
        return 0;
    }
  });

  return list;
}

function renderParticipantsTable() {
  const tbody = document.getElementById('participantsTableBody');
  const countEl = document.getElementById('filterResultCount');
  const list = getFilteredAndSortedParticipants();

  countEl.textContent = list.length;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          No participants match the selected filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const isPresent = p.status === 'Present';
    return `
      <tr class="${isPresent ? 'row-present' : ''}">
        <td>
          <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--electric-blue);">${escapeHtml(p.id)}</span>
        </td>
        <td>
          <div class="student-name-cell">
            <span class="student-name">${escapeHtml(p.name)}</span>
            <span class="student-contact">📱 ${escapeHtml(p.phone || 'No phone')} ${p.gender ? `• ${escapeHtml(p.gender)}` : ''}</span>
          </div>
        </td>
        <td>
          <span class="college-badge" title="${escapeHtml(p.college)}">${escapeHtml(p.college || '—')}</span>
        </td>
        <td>
          <span class="parish-badge" title="${escapeHtml(p.parish)}">${escapeHtml(p.parish || '—')}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(p.course || '—')} ${p.year ? `(${escapeHtml(p.year)})` : ''}</span>
        </td>
        <td>
          <span class="status-pill ${isPresent ? 'present' : 'absent'}">
            ${isPresent ? '● Present' : '○ Pending'}
          </span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--electric-blue); font-family: 'JetBrains Mono', monospace;">
            ${p.checkInTime || '—'}
          </span>
        </td>
        <td style="text-align: right;">
          <div class="actions-cell" style="justify-content: flex-end;">
            ${isPresent 
              ? `<button class="btn btn-sm btn-secondary" onclick="toggleAttendance('${p.id}')" title="Revert to Absent">↩️ Undo</button>` 
              : `<button class="btn btn-sm btn-success" onclick="toggleAttendance('${p.id}')" title="Mark Present">✅ Check-in</button>`
            }
            <button class="btn btn-sm btn-secondary" onclick="openBadgeModal('${p.id}')" title="View QR Badge">🪪 Badge</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// SMART QR RECOGNITION & ATTENDANCE CHECK-IN ENGINE
// Solves "the qr is not scanning properly"
// ==========================================================================

function smartFindParticipant(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.trim();
  const lower = cleaned.toLowerCase();

  // 1. Direct ID match (e.g. JY-015, JY-15, 15)
  let directId = cleaned;
  if (/^jy-?\d+$/i.test(cleaned)) {
    const num = parseInt(cleaned.replace(/\D/g, ''), 10);
    directId = `JY-${String(num).padStart(3, '0')}`;
  }
  let match = state.participants.find(p => p.id.toLowerCase() === directId.toLowerCase() || p.id.toLowerCase() === cleaned.toLowerCase());
  if (match) return match;

  // 2. JSON check: {"id":"JY-015"} or {"phone":"..."} or {"name":"..."}
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      const parsedId = parsed.id || parsed.regId || parsed.reg_id;
      if (parsedId) {
        match = smartFindParticipant(String(parsedId));
        if (match) return match;
      }
      const parsedPhone = parsed.phone || parsed.whatsapp;
      if (parsedPhone) {
        match = smartFindParticipant(String(parsedPhone));
        if (match) return match;
      }
      const parsedName = parsed.name || parsed.studentName;
      if (parsedName) {
        match = smartFindParticipant(String(parsedName));
        if (match) return match;
      }
    } catch(e) {}
  }

  // 3. URL match: extract data parameter or path
  if (cleaned.includes('http://') || cleaned.includes('https://')) {
    try {
      const url = new URL(cleaned);
      const dataParam = url.searchParams.get('data') || url.searchParams.get('id') || url.searchParams.get('text');
      if (dataParam) {
        match = smartFindParticipant(dataParam);
        if (match) return match;
      }
      // Check last pathname segment
      const lastSeg = url.pathname.split('/').filter(Boolean).pop();
      if (lastSeg) {
        match = smartFindParticipant(lastSeg);
        if (match) return match;
      }
    } catch (e) {}
  }

  // 4. WhatsApp / Phone matching: extract digits
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 7) {
    // Check against last 10 digits
    const last10 = digits.slice(-10);
    match = state.participants.find(p => {
      if (!p.phone) return false;
      const pDigits = p.phone.replace(/\D/g, '');
      return pDigits.endsWith(last10) || last10.endsWith(pDigits);
    });
    if (match) return match;
  }

  // 5. Exact Name or Substring Name match
  match = state.participants.find(p => p.name.toLowerCase() === lower);
  if (match) return match;

  // 6. Embedded ID pattern search: e.g. "JY-045" inside text
  const idMatch = cleaned.match(/JY[-_]?\d+/i);
  if (idMatch) {
    const num = parseInt(idMatch[0].replace(/\D/g, ''), 10);
    const targetId = `JY-${String(num).padStart(3, '0')}`;
    match = state.participants.find(p => p.id.toLowerCase() === targetId.toLowerCase());
    if (match) return match;
  }

  return null;
}

function handleScanResult(decodedText) {
  if (state.isProcessingScan) return;
  state.isProcessingScan = true;

  console.log("Raw QR Decoded:", decodedText);
  const participant = smartFindParticipant(decodedText);

  const banner = document.getElementById('scanStatusBanner');
  const icon = document.getElementById('scanStatusIcon');
  const title = document.getElementById('scanStatusTitle');
  const sub = document.getElementById('scanStatusSub');
  const card = document.getElementById('scannedParticipantCard');

  if (!participant) {
    AudioFeedback.play('error');
    if (navigator.vibrate) navigator.vibrate(200);

    banner.className = 'status-banner error';
    icon.textContent = '❌';
    title.textContent = 'Participant Not Found';
    sub.textContent = `Scanned code "${decodedText.slice(0, 45)}" does not match any student record.`;
    card.style.display = 'none';

    setTimeout(() => { state.isProcessingScan = false; }, 1400);
    return;
  }

  state.lastScannedId = participant.id;

  if (participant.status === 'Present') {
    // Already Checked In
    AudioFeedback.play('warning');
    if (navigator.vibrate) navigator.vibrate([100, 80, 100]);

    banner.className = 'status-banner warning';
    icon.textContent = '⚠️';
    title.textContent = 'Already Checked In';
    sub.textContent = `${participant.name} was already verified at ${participant.checkInTime || 'earlier'}.`;
  } else {
    const confirmedMark = window.confirm(`Mark ${participant.name} as present for attendance?`);
    if (!confirmedMark) {
      banner.className = 'status-banner idle';
      icon.textContent = '⏸️';
      title.textContent = 'Attendance Not Marked';
      sub.textContent = `${participant.name} is still pending.`;
      card.style.display = 'block';
      document.getElementById('scannedName').textContent = participant.name;
      document.getElementById('scannedId').textContent = participant.id;
      document.getElementById('scannedCollege').textContent = participant.college || '—';
      document.getElementById('scannedCourse').textContent = `${participant.course || '—'} ${participant.year ? `(${participant.year})` : ''}`;
      document.getElementById('scannedParish').textContent = participant.parish || '—';
      document.getElementById('scannedPhone').textContent = participant.phone || '—';
      document.getElementById('scannedTime').textContent = '—';
      document.getElementById('scannedStatusBadge').className = 'status-pill absent';
      document.getElementById('scannedStatusBadge').textContent = 'Absent';
      state.isProcessingScan = false;
      return;
    }

    // New Verified Check-in
    participant.status = 'Present';
    participant.checkInTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Add to recent stream
    state.recentScans.unshift({ ...participant });
    if (state.recentScans.length > 20) state.recentScans.pop();

    AudioFeedback.play('success');
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);

    // Confetti celebration
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 70,
        spread: 80,
        origin: { y: 0.6 }
      });
    }

    banner.className = 'status-banner success';
    icon.textContent = '⚡';
    title.textContent = 'Attendance Verified!';
    sub.textContent = `${participant.name} (${participant.college}) marked Present!`;

    saveParticipants();
    syncToGoogleSheet(participant);
  }

  // Populate active scanned card
  document.getElementById('scannedName').textContent = participant.name;
  document.getElementById('scannedId').textContent = participant.id;
  document.getElementById('scannedCollege').textContent = participant.college || '—';
  document.getElementById('scannedCourse').textContent = `${participant.course || '—'} ${participant.year ? `(${participant.year})` : ''}`;
  document.getElementById('scannedParish').textContent = participant.parish || '—';
  document.getElementById('scannedPhone').textContent = participant.phone || '—';
  document.getElementById('scannedTime').textContent = participant.checkInTime || 'Just now';
  document.getElementById('scannedStatusBadge').className = 'status-pill ' + (participant.status === 'Present' ? 'present' : 'absent');
  document.getElementById('scannedStatusBadge').textContent = participant.status;
  card.style.display = 'block';

  renderRecentScansList();

  setTimeout(() => {
    state.isProcessingScan = false;
  }, 1600);
}

function toggleAttendance(id) {
  const p = state.participants.find(item => item.id === id);
  if (!p) return;

  if (p.status === 'Present') {
    p.status = 'Absent';
    p.checkInTime = null;
    AudioFeedback.play('warning');
  } else {
    const confirmedMark = window.confirm(`Mark ${p.name} as present for attendance?`);
    if (!confirmedMark) return;

    p.status = 'Present';
    p.checkInTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    AudioFeedback.play('success');
    state.recentScans.unshift({ ...p });
    syncToGoogleSheet(p);
  }

  saveParticipants();
}

function renderRecentScansList() {
  const listEl = document.getElementById('recentScansList');
  const countBadge = document.getElementById('recentCountBadge');

  const presentList = state.participants.filter(p => p.status === 'Present' && p.checkInTime);
  countBadge.textContent = `${presentList.length} total`;

  if (state.recentScans.length === 0) {
    listEl.innerHTML = `
      <li style="padding: 1.25rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No check-ins yet. Scanned students will stream here in real-time.
      </li>
    `;
    return;
  }

  listEl.innerHTML = state.recentScans.slice(0, 10).map(scan => `
    <li class="recent-scan-item">
      <div>
        <div class="recent-name">${escapeHtml(scan.name)} <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--electric-blue);">(${escapeHtml(scan.id)})</span></div>
        <div class="recent-meta">${escapeHtml(scan.college)} • ${escapeHtml(scan.parish)}</div>
      </div>
      <span class="recent-time">${escapeHtml(scan.checkInTime || 'Just now')}</span>
    </li>
  `).join('');
}

// ==========================================================================
// Advanced Hardware Camera Controller
// Solves low resolution & narrow scan-box camera issues
// ==========================================================================

async function initCameraList() {
  const cameraSelect = document.getElementById('cameraSelect');
  try {
    const devices = await Html5Qrcode.getCameras();
    state.cameras = devices;
    if (devices && devices.length > 0) {
      cameraSelect.innerHTML = devices.map((d, idx) => `
        <option value="${d.id}">${d.label || `Camera ${idx + 1}`}</option>
      `).join('');
      cameraSelect.style.display = 'inline-block';
      document.getElementById('btnSwitchCamera').style.display = 'inline-block';
      state.currentCameraId = devices[0].id;
    }
  } catch (err) {
    console.warn("Could not list cameras:", err);
  }
}

async function startCameraScanner() {
  const overlay = document.getElementById('scannerOverlay');
  const toggleBtn = document.getElementById('btnToggleCamera');
  const torchBtn = document.getElementById('btnToggleTorch');
  const liveStatus = document.getElementById('headerLiveStatus');

  if (state.isScanning) {
    stopCameraScanner();
    return;
  }

  try {
    if (!state.html5QrCode) {
      state.html5QrCode = new Html5Qrcode("reader", {
        formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ],
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true // Native hardware acceleration
        }
      });
    }

    toggleBtn.textContent = 'Initializing...';
    toggleBtn.disabled = true;

    // Responsive 85% dynamic scan area so users don't need to align precisely
    const qrboxFunction = function(viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const edgeSize = Math.max(220, Math.floor(minEdge * 0.85));
      return { width: edgeSize, height: edgeSize };
    };

    const config = {
      fps: 20, // 20 FPS for instant fast response
      qrbox: qrboxFunction,
      aspectRatio: 1.0,
      disableFlip: false
    };

    const cameraConfig = state.currentCameraId 
      ? { deviceId: { exact: state.currentCameraId } }
      : { facingMode: "environment" };

    await state.html5QrCode.start(
      cameraConfig,
      config,
      (decodedText) => handleScanResult(decodedText),
      () => {} // silent on normal scan misses
    );

    state.isScanning = true;
    overlay.style.display = 'flex';
    toggleBtn.textContent = '⏹️ Stop Camera';
    toggleBtn.className = 'btn btn-sm btn-danger';
    toggleBtn.disabled = false;
    liveStatus.textContent = 'Camera Active';

    // Check torch / flashlight support
    checkTorchSupport();
    initCameraList();
  } catch (err) {
    console.error("Camera start error:", err);
    state.isScanning = false;
    overlay.style.display = 'none';
    toggleBtn.textContent = 'Start Camera';
    toggleBtn.className = 'btn btn-sm btn-primary';
    toggleBtn.disabled = false;
    liveStatus.textContent = 'Ready to Scan';
    alert("Camera permission denied or camera not found. You can also search participants above or scan a QR image.");
  }
}

async function stopCameraScanner() {
  const overlay = document.getElementById('scannerOverlay');
  const toggleBtn = document.getElementById('btnToggleCamera');
  const torchBtn = document.getElementById('btnToggleTorch');
  const liveStatus = document.getElementById('headerLiveStatus');

  if (state.html5QrCode && state.isScanning) {
    try {
      await state.html5QrCode.stop();
    } catch (e) {
      console.warn(e);
    }
  }

  state.isScanning = false;
  state.isTorchOn = false;
  state.currentTrack = null;
  if (torchBtn) torchBtn.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  if (toggleBtn) {
    toggleBtn.textContent = 'Start Camera';
    toggleBtn.className = 'btn btn-sm btn-primary';
    toggleBtn.disabled = false;
  }
  if (liveStatus) liveStatus.textContent = 'Ready to Scan';
}

function checkTorchSupport() {
  const torchBtn = document.getElementById('btnToggleTorch');
  try {
    const video = document.querySelector('#reader video');
    if (video && video.srcObject) {
      const track = video.srcObject.getVideoTracks()[0];
      if (track) {
        state.currentTrack = track;
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.torch) {
          torchBtn.style.display = 'inline-flex';
          return;
        }
      }
    }
  } catch (e) {}
  torchBtn.style.display = 'none';
}

async function toggleTorch() {
  if (!state.currentTrack) return;
  const torchBtn = document.getElementById('btnToggleTorch');
  try {
    state.isTorchOn = !state.isTorchOn;
    await state.currentTrack.applyConstraints({
      advanced: [{ torch: state.isTorchOn }]
    });
    torchBtn.textContent = state.isTorchOn ? '🔦 Off' : '🔦 Flash';
    torchBtn.className = state.isTorchOn ? 'btn btn-sm btn-warning' : 'btn btn-sm btn-secondary';
  } catch (err) {
    console.warn("Torch toggle failed:", err);
  }
}

// ==========================================================================
// College & Parish Analytics View
// ==========================================================================

function renderAnalytics() {
  const collegeList = document.getElementById('collegeAnalyticsList');
  const parishList = document.getElementById('parishAnalyticsList');

  // Aggregation by College
  const collegeMap = {};
  state.participants.forEach(p => {
    const col = p.college || 'Unspecified';
    if (!collegeMap[col]) collegeMap[col] = { total: 0, present: 0 };
    collegeMap[col].total++;
    if (p.status === 'Present') collegeMap[col].present++;
  });

  const collegesSorted = Object.entries(collegeMap)
    .map(([name, data]) => ({ name, ...data, rate: Math.round((data.present / data.total) * 100) }))
    .sort((a, b) => b.total - a.total);

  document.getElementById('collegeTotalBadge').textContent = `${collegesSorted.length} Colleges`;

  collegeList.innerHTML = collegesSorted.map(c => `
    <div class="progress-item">
      <div class="progress-header">
        <span style="font-weight: 700; color: var(--text-pure);">${escapeHtml(c.name)}</span>
        <span style="color: var(--text-muted); font-size: 0.8rem;">
          <strong style="color: var(--neon-emerald);">${c.present}</strong> / ${c.total} (${c.rate}%)
        </span>
      </div>
      <div class="progress-track">
        <div class="progress-bar-fill" style="width: ${c.rate}%;"></div>
      </div>
    </div>
  `).join('') || '<p style="color: var(--text-muted);">No college data available.</p>';

  // Aggregation by Parish
  const parishMap = {};
  state.participants.forEach(p => {
    const par = p.parish || 'Unspecified';
    if (!parishMap[par]) parishMap[par] = { total: 0, present: 0 };
    parishMap[par].total++;
    if (p.status === 'Present') parishMap[par].present++;
  });

  const parishesSorted = Object.entries(parishMap)
    .map(([name, data]) => ({ name, ...data, rate: Math.round((data.present / data.total) * 100) }))
    .sort((a, b) => b.total - a.total);

  document.getElementById('parishTotalBadge').textContent = `${parishesSorted.length} Parishes`;

  parishList.innerHTML = parishesSorted.map(p => `
    <div class="progress-item">
      <div class="progress-header">
        <span style="font-weight: 700; color: var(--text-pure);">${escapeHtml(p.name)}</span>
        <span style="color: var(--text-muted); font-size: 0.8rem;">
          <strong style="color: #c084fc;">${p.present}</strong> / ${p.total} (${p.rate}%)
        </span>
      </div>
      <div class="progress-track">
        <div class="progress-bar-fill accent-parish" style="width: ${p.rate}%;"></div>
      </div>
    </div>
  `).join('') || '<p style="color: var(--text-muted);">No parish data available.</p>';
}

// ==========================================================================
// QR Badges Maker
// ==========================================================================

function renderBadgeGrid() {
  const container = document.getElementById('badgeGridContainer');
  const filterSelect = document.getElementById('badgeFilterSelect');
  const filterVal = filterSelect.value;

  let list = [...state.participants];
  if (filterVal === 'present') list = list.filter(p => p.status === 'Present');
  if (filterVal === 'absent') list = list.filter(p => p.status !== 'Present');

  // Update option labels with live counts
  const allOpt = filterSelect.querySelector('option[value="all"]');
  const presOpt = filterSelect.querySelector('option[value="present"]');
  const absOpt  = filterSelect.querySelector('option[value="absent"]');
  if (allOpt) allOpt.textContent = `All Participants (${state.participants.length})`;
  if (presOpt) presOpt.textContent = `Present Only (${state.participants.filter(p => p.status === 'Present').length})`;
  if (absOpt)  absOpt.textContent  = `Not Checked In (${state.participants.filter(p => p.status !== 'Present').length})`;

  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; width: 100%; padding: 2rem;">No badges match the selected filter.</p>';
    return;
  }

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const badge = document.createElement('div');
    badge.className = 'student-badge-card';
    const qrDivId = `qr-badge-${p.id.replace(/\W/g, '')}`;

    badge.innerHTML = `
      <div class="badge-top-ribbon"></div>
      <div class="badge-org">Jesus Youth</div>
      <div class="badge-event">Campus Meet Pass</div>
      <div class="badge-qr-wrapper" id="${qrDivId}"></div>
      <div class="badge-student-name">${escapeHtml(p.name)}</div>
      <div class="badge-college">🎓 ${escapeHtml(p.college)}</div>
      <div class="badge-parish">⛪ ${escapeHtml(p.parish)}</div>
      <div class="badge-course">${escapeHtml(p.course || '')} ${p.year ? `• ${escapeHtml(p.year)}` : ''}</div>
      <div class="badge-id">${escapeHtml(p.id)}</div>
    `;

    container.appendChild(badge);

    setTimeout(() => {
      const qrElement = document.getElementById(qrDivId);
      if (qrElement && typeof QRCode !== 'undefined') {
        new QRCode(qrElement, {
          text: p.id,
          width: 140,
          height: 140,
          colorDark: "#07091e",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }, 0);
  }

  if (list.length > 0) {
    const notice = document.createElement('div');
    notice.style.gridColumn = '1 / -1';
    notice.style.textAlign = 'center';
    notice.style.padding = '1rem';
    notice.style.color = 'var(--text-cyan)';
    notice.textContent = `${list.length} badges generated successfully.`;
    container.appendChild(notice);
  }
}

function openBadgeModal(id) {
  const p = state.participants.find(item => item.id === id);
  if (!p) return;

  const content = document.getElementById('singleBadgeModalContent');
  const qrDivId = `modal-qr-${p.id.replace(/\W/g, '')}`;

  content.innerHTML = `
    <div class="student-badge-card" style="width: 100%;">
      <div class="badge-top-ribbon"></div>
      <div class="badge-org">Jesus Youth</div>
      <div class="badge-event">Campus Meet Pass</div>
      <div class="badge-qr-wrapper" id="${qrDivId}"></div>
      <div class="badge-student-name">${escapeHtml(p.name)}</div>
      <div class="badge-college">🎓 ${escapeHtml(p.college)}</div>
      <div class="badge-parish">⛪ ${escapeHtml(p.parish)}</div>
      <div class="badge-course">${escapeHtml(p.course || '')} ${p.year ? `• ${escapeHtml(p.year)}` : ''}</div>
      <div class="badge-id">${escapeHtml(p.id)}</div>
    </div>
  `;

  setTimeout(() => {
    const qrElement = document.getElementById(qrDivId);
    if (qrElement && typeof QRCode !== 'undefined') {
      new QRCode(qrElement, {
        text: p.id,
        width: 150,
        height: 150,
        colorDark: "#07091e",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    }
  }, 0);

  openModal('viewBadgeModal');
}

// ==========================================================================
// Google Sheets Synchronization Webhook
// ==========================================================================

async function syncToGoogleSheet(participant) {
  if (!state.googleScriptUrl) return;

  try {
    const payload = {
      action: "markPresent",
      id: participant.id,
      name: participant.name,
      college: participant.college,
      parish: participant.parish,
      phone: participant.phone,
      checkInTime: participant.checkInTime,
      timestamp: new Date().toISOString()
    };

    await fetch(state.googleScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log("Synced to Google Sheet successfully");
  } catch (err) {
    console.warn("Failed to sync to Google Sheet:", err);
  }
}

// ==========================================================================
// CSV Export & Import
// ==========================================================================

function exportToCSV() {
  const headers = ["Reg ID", "Name", "Gender", "College", "Course", "Year", "Parish", "WhatsApp No", "Confirmed", "Payment", "Status", "Check-in Time"];
  const rows = state.participants.map(p => [
    `"${(p.id || '').replace(/"/g, '""')}"`,
    `"${(p.name || '').replace(/"/g, '""')}"`,
    `"${(p.gender || '').replace(/"/g, '""')}"`,
    `"${(p.college || '').replace(/"/g, '""')}"`,
    `"${(p.course || '').replace(/"/g, '""')}"`,
    `"${(p.year || '').replace(/"/g, '""')}"`,
    `"${(p.parish || '').replace(/"/g, '""')}"`,
    `"${(p.phone || '').replace(/"/g, '""')}"`,
    `"${(p.confirmed || '').replace(/"/g, '""')}"`,
    `"${(p.payment || '').replace(/"/g, '""')}"`,
    `"${p.status}"`,
    `"${p.checkInTime || ''}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `JY_Campus_Meet_Attendance_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================================================
// Modal Utilities & Helpers
// ==========================================================================

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const GOOGLE_APPS_SCRIPT_SAMPLE = `function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    if (data.action === "markPresent") {
      var rows = sheet.getDataRange().getValues();
      var nameCol = 0; // Col A
      var phoneCol = 8; // Col I (WhatsApp)
      
      // Look for Status column or write to last column
      for (var i = 1; i < rows.length; i++) {
        var rowPhone = rows[i][phoneCol] ? rows[i][phoneCol].toString().replace(/\\D/g,'') : '';
        var dataPhone = data.phone ? data.phone.toString().replace(/\\D/g,'') : '';
        var rowName = rows[i][nameCol] ? rows[i][nameCol].toString().trim().toLowerCase() : '';
        var dataName = data.name ? data.name.toString().trim().toLowerCase() : '';

        if ((dataPhone && rowPhone.endsWith(dataPhone.slice(-10))) || (dataName && rowName === dataName)) {
          sheet.getRange(i + 1, 13).setValue("Present");
          sheet.getRange(i + 1, 14).setValue(data.checkInTime || new Date().toLocaleTimeString());
          return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({status: "not_found"})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", error: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}`;

function initializeAdminAccess() {
  const loginOverlay = document.getElementById('adminLoginOverlay');
  const loginForm = document.getElementById('adminLoginForm');
  const usernameInput = document.getElementById('adminUsername');
  const passwordInput = document.getElementById('adminPassword');
  const logoutButton = document.getElementById('btnAdminLogout');

  const isLoggedIn = localStorage.getItem('JY_ADMIN_AUTH') === 'true';
  state.isAuthenticated = isLoggedIn;

  if (loginOverlay) {
    loginOverlay.classList.toggle('hidden', isLoggedIn);
  }

  if (logoutButton) {
    logoutButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const enteredUsername = (usernameInput?.value || '').trim();
      const enteredPassword = (passwordInput?.value || '').trim();

      if (enteredUsername === ADMIN_CREDENTIALS.username && enteredPassword === ADMIN_CREDENTIALS.password) {
        localStorage.setItem('JY_ADMIN_AUTH', 'true');
        state.isAuthenticated = true;
        loginOverlay?.classList.add('hidden');
        logoutButton && (logoutButton.style.display = 'inline-flex');
        loginForm.reset();
        return;
      }

      alert('Incorrect admin username or password.');
      passwordInput?.focus();
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      localStorage.removeItem('JY_ADMIN_AUTH');
      state.isAuthenticated = false;
      loginOverlay?.classList.remove('hidden');
      logoutButton.style.display = 'none';
      usernameInput?.focus();
    });
  }
}

// ==========================================================================
// Event Listeners Setup
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initializeAdminAccess();
  loadParticipants();
  updateAllViews();

  // Navigation Tabs Switching
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetViewId = tab.dataset.tab;
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      const targetView = document.getElementById(targetViewId);
      if (targetView) targetView.classList.add('active');
      state.activeTab = targetViewId;

      if (targetViewId === 'badges-view') {
        renderBadgeGrid();
      }
    });
  });

  // Scanner Controls
  document.getElementById('btnToggleCamera').addEventListener('click', startCameraScanner);
  document.getElementById('btnToggleTorch').addEventListener('click', toggleTorch);

  document.getElementById('btnSwitchCamera').addEventListener('click', () => {
    if (state.cameras.length > 1) {
      const currentIdx = state.cameras.findIndex(c => c.id === state.currentCameraId);
      const nextIdx = (currentIdx + 1) % state.cameras.length;
      state.currentCameraId = state.cameras[nextIdx].id;
      document.getElementById('cameraSelect').value = state.currentCameraId;
      if (state.isScanning) {
        stopCameraScanner().then(() => startCameraScanner());
      }
    }
  });

  document.getElementById('cameraSelect').addEventListener('change', (e) => {
    state.currentCameraId = e.target.value;
    if (state.isScanning) {
      stopCameraScanner().then(() => startCameraScanner());
    }
  });

  // Manual Check-in Form
  document.getElementById('manualCheckinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('manualIdInput');
    if (input.value.trim()) {
      handleScanResult(input.value);
      input.value = '';
    }
  });

  // Enhanced Image QR Scanning with jsQR Fallback
  document.getElementById('qrFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!state.html5QrCode) {
      state.html5QrCode = new Html5Qrcode("reader");
    }

    state.html5QrCode.scanFile(file, true)
      .then(decodedText => handleScanResult(decodedText))
      .catch(() => {
        // Secondary fallback using jsQR via an Image & Canvas
        const reader = new FileReader();
        reader.onload = function(evt) {
          const img = new Image();
          img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (typeof jsQR !== 'undefined') {
              const code = jsQR(imgData.data, imgData.width, imgData.height);
              if (code && code.data) {
                handleScanResult(code.data);
                return;
              }
            }
            alert("Could not detect a QR code in this image. Please ensure the QR code is in focus and well-lit.");
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      });
  });

  // Undo Check-in Button in Participant Card
  document.getElementById('btnUndoCheckin').addEventListener('click', () => {
    if (state.lastScannedId) {
      toggleAttendance(state.lastScannedId);
      const participant = state.participants.find(p => p.id === state.lastScannedId);
      if (participant) {
        document.getElementById('scannedStatusBadge').className = 'status-pill absent';
        document.getElementById('scannedStatusBadge').textContent = 'Absent';
        document.getElementById('scannedTime').textContent = '—';
        document.getElementById('scanStatusBanner').className = 'status-banner idle';
        document.getElementById('scanStatusIcon').textContent = '↩️';
        document.getElementById('scanStatusTitle').textContent = 'Check-in Reverted';
        document.getElementById('scanStatusSub').textContent = `${participant.name} is now marked as Pending.`;
      }
    }
  });

  // View Badge Direct from Card
  document.getElementById('btnViewBadgeDirect').addEventListener('click', () => {
    if (state.lastScannedId) {
      openBadgeModal(state.lastScannedId);
    }
  });

  // Filters
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    renderParticipantsTable();
  });

  document.getElementById('collegeFilter').addEventListener('change', (e) => {
    state.filters.college = e.target.value;
    renderParticipantsTable();
  });

  document.getElementById('parishFilter').addEventListener('change', (e) => {
    state.filters.parish = e.target.value;
    renderParticipantsTable();
  });

  document.getElementById('statusFilter').addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    renderParticipantsTable();
  });

  document.getElementById('sortBySelect').addEventListener('change', (e) => {
    state.filters.sortBy = e.target.value;
    renderParticipantsTable();
  });

  document.getElementById('btnResetFilters').addEventListener('click', () => {
    state.filters.search = '';
    state.filters.college = '';
    state.filters.parish = '';
    state.filters.status = '';
    state.filters.sortBy = 'id-asc';

    document.getElementById('searchInput').value = '';
    document.getElementById('collegeFilter').value = '';
    document.getElementById('parishFilter').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('sortBySelect').value = 'id-asc';

    renderParticipantsTable();
  });

  // Sorting Table Headers
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const sortType = th.dataset.sort;
      if (sortType === 'name') state.filters.sortBy = state.filters.sortBy === 'name-asc' ? 'name-desc' : 'name-asc';
      if (sortType === 'college') state.filters.sortBy = 'college-asc';
      if (sortType === 'parish') state.filters.sortBy = 'parish-asc';
      if (sortType === 'id') state.filters.sortBy = 'id-asc';
      if (sortType === 'time') state.filters.sortBy = 'checkin-desc';
      document.getElementById('sortBySelect').value = state.filters.sortBy;
      renderParticipantsTable();
    });
  });

  // Badges Filter
  document.getElementById('badgeFilterSelect').addEventListener('change', renderBadgeGrid);

  // Export CSV
  document.getElementById('btnExportCSV').addEventListener('click', exportToCSV);

  // Sync / Reload Google Sheet
  document.getElementById('btnSyncFromGoogleSheet').addEventListener('click', fetchGoogleSheetDirect);
  document.getElementById('btnFetchGoogleSheetDirect').addEventListener('click', fetchGoogleSheetDirect);

  document.getElementById('btnReloadRealDatabase').addEventListener('click', () => {
    const total = onlyConfirmedYes(window.PRELOADED_PARTICIPANTS).length;
    if (confirm(`Reload ${total} confirmed Yes participants from the local database? Check-in marks for matching names will be kept.`)) {
      forceReloadFromPreloaded();
      alert(`Reloaded ${state.participants.length} confirmed Yes participants.`);
    }
  });

  document.getElementById('btnClearAttendanceOnly').addEventListener('click', () => {
    if (confirm("Reset all check-in marks back to Absent?")) {
      state.participants.forEach(p => {
        p.status = 'Absent';
        p.checkInTime = null;
      });
      state.recentScans = [];
      saveParticipants();
      alert("Attendance status reset to Absent for all participants.");
    }
  });

  document.getElementById('btnClearData').addEventListener('click', () => {
    if (confirm("Are you sure you want to clear all data?")) {
      state.participants = [];
      state.recentScans = [];
      saveParticipants();
    }
  });

  // Add Participant Form & Modals
  document.getElementById('btnOpenAddModal').addEventListener('click', () => openModal('addParticipantModal'));
  document.getElementById('btnQuickAdd').addEventListener('click', () => openModal('addParticipantModal'));

  document.getElementById('addParticipantForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newStudentName').value.trim();
    const college = document.getElementById('newStudentCollege').value.trim();
    const parish = document.getElementById('newStudentParish').value.trim();
    const course = document.getElementById('newStudentCourse').value.trim();
    const phone = document.getElementById('newStudentPhone').value.trim();
    const markPresent = document.getElementById('newStudentMarkPresent').checked;

    const newId = `JY-${String(state.participants.length + 1).padStart(3, '0')}`;
    const newParticipant = {
      id: newId,
      name,
      college: college || 'Unspecified',
      parish: parish || 'Unspecified',
      course,
      phone,
      status: markPresent ? 'Present' : 'Absent',
      checkInTime: markPresent ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
    };

    state.participants.unshift(newParticipant);
    if (markPresent) {
      state.recentScans.unshift({ ...newParticipant });
      syncToGoogleSheet(newParticipant);
    }

    saveParticipants();
    closeModal('addParticipantModal');
    document.getElementById('addParticipantForm').reset();
    openBadgeModal(newId);
  });

  // Print Single Badge
  document.getElementById('btnPrintSingleBadge').addEventListener('click', () => window.print());

  // Google Script Setup Modal
  document.getElementById('btnOpenScriptHelp').addEventListener('click', () => {
    document.getElementById('appsScriptCodeBlock').value = GOOGLE_APPS_SCRIPT_SAMPLE;
    openModal('googleScriptModal');
  });

  document.getElementById('btnCopyScriptCode').addEventListener('click', () => {
    navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_SAMPLE).then(() => {
      alert("Google Apps Script code copied to clipboard!");
    });
  });

  // Google Script Webhook config
  const scriptInput = document.getElementById('googleScriptUrlInput');
  if (state.googleScriptUrl) scriptInput.value = state.googleScriptUrl;

  document.getElementById('btnSaveScriptUrl').addEventListener('click', () => {
    const url = scriptInput.value.trim();
    state.googleScriptUrl = url;
    localStorage.setItem('JY_SCRIPT_URL', url);
    alert("Webhook URL saved successfully!");
  });
});
