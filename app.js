// ─── Forest Ranks ─────────────────────────────────────────────────────────────
const RANKS = [
  { name:"Seedling",        icon:"🌱", bugsNeeded:0,  chaptersNeeded:0  },
  { name:"Sapling",         icon:"🌿", bugsNeeded:3,  chaptersNeeded:3  },
  { name:"Young Tree",      icon:"🌳", bugsNeeded:6,  chaptersNeeded:6  },
  { name:"Forest Guardian", icon:"🦉", bugsNeeded:10, chaptersNeeded:10 },
  { name:"Elder Tree",      icon:"🌲", bugsNeeded:15, chaptersNeeded:14 },
  { name:"Ancient Tree",    icon:"🏔️", bugsNeeded:20, chaptersNeeded:18 }
];

// Tree SVGs for each rank (progressively larger/more complex)
const TREE_SVGS = [
  // Seedling
  `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="56" y="100" width="8" height="30" rx="3" fill="#78350f"/>
    <ellipse cx="60" cy="90" rx="25" ry="22" fill="#22c55e" opacity="0.9"/>
    <ellipse cx="60" cy="75" rx="16" ry="15" fill="#4ade80"/>
    <circle cx="60" cy="63" r="10" fill="#22c55e"/>
    <circle cx="50" cy="82" r="3" fill="#052e16" opacity="0.6"/>
    <circle cx="70" cy="82" r="3" fill="#052e16" opacity="0.6"/>
    <path d="M52 92 Q60 97 68 92" stroke="#052e16" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`,
  // Sapling
  `<svg viewBox="0 0 140 160" xmlns="http://www.w3.org/2000/svg">
    <rect x="63" y="115" width="14" height="38" rx="5" fill="#78350f"/>
    <path d="M63 148 Q50 155 42 162" stroke="#78350f" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M77 148 Q90 155 98 162" stroke="#78350f" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="70" cy="108" rx="38" ry="28" fill="#16a34a" opacity="0.85"/>
    <ellipse cx="70" cy="88" rx="30" ry="25" fill="#22c55e"/>
    <ellipse cx="70" cy="70" rx="22" ry="20" fill="#4ade80"/>
    <circle cx="70" cy="57" r="13" fill="#22c55e"/>
    <circle cx="58" cy="88" r="4" fill="#052e16" opacity="0.7"/>
    <circle cx="82" cy="88" r="4" fill="#052e16" opacity="0.7"/>
    <path d="M60 100 Q70 106 80 100" stroke="#052e16" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`,
  // Young Tree
  `<svg viewBox="0 0 160 190" xmlns="http://www.w3.org/2000/svg">
    <rect x="72" y="145" width="16" height="42" rx="6" fill="#78350f"/>
    <path d="M72 178 Q55 188 44 196" stroke="#78350f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M88 178 Q105 188 116 196" stroke="#78350f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M80 182 Q80 192 80 200" stroke="#78350f" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="80" cy="136" rx="52" ry="34" fill="#166534" opacity="0.8"/>
    <ellipse cx="80" cy="112" rx="44" ry="32" fill="#16a34a"/>
    <ellipse cx="80" cy="90" rx="36" ry="28" fill="#22c55e"/>
    <ellipse cx="80" cy="70" rx="26" ry="22" fill="#4ade80"/>
    <circle cx="80" cy="54" r="16" fill="#22c55e"/>
    <circle cx="66" cy="100" r="5" fill="#052e16" opacity="0.7"/>
    <circle cx="94" cy="100" r="5" fill="#052e16" opacity="0.7"/>
    <path d="M68 114 Q80 120 92 114" stroke="#052e16" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <circle cx="42" cy="98" r="3" fill="#fbbf24" opacity="0.8"/>
    <circle cx="118" cy="88" r="2.5" fill="#fbbf24" opacity="0.7"/>
  </svg>`,
  // Forest Guardian
  `<svg viewBox="0 0 180 220" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="tg3" cx="50%" cy="40%" r="55%">
        <stop offset="0%" style="stop-color:#4ade80"/>
        <stop offset="100%" style="stop-color:#052e16"/>
      </radialGradient>
    </defs>
    <rect x="82" y="170" width="16" height="48" rx="6" fill="#78350f"/>
    <path d="M82 205 Q62 215 50 225" stroke="#78350f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M98 205 Q118 215 130 225" stroke="#78350f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M90 210 Q90 220 90 230" stroke="#78350f" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="90" cy="158" rx="62" ry="38" fill="#14532d" opacity="0.85"/>
    <ellipse cx="90" cy="130" rx="52" ry="36" fill="#166534"/>
    <ellipse cx="90" cy="106" rx="44" ry="32" fill="#16a34a"/>
    <ellipse cx="90" cy="84" rx="34" ry="28" fill="url(#tg3)"/>
    <ellipse cx="90" cy="62" rx="25" ry="22" fill="#22c55e"/>
    <circle cx="90" cy="44" r="16" fill="#4ade80"/>
    <circle cx="76" cy="112" r="6" fill="#052e16" opacity="0.8"/>
    <circle cx="104" cy="112" r="6" fill="#052e16" opacity="0.8"/>
    <path d="M76 128 Q90 136 104 128" stroke="#052e16" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="38" cy="110" r="3.5" fill="#fbbf24" opacity="0.9"/>
    <circle cx="142" cy="100" r="3" fill="#fbbf24" opacity="0.8"/>
    <circle cx="55" cy="80" r="2.5" fill="#86efac" opacity="0.9"/>
    <circle cx="128" cy="130" r="2.5" fill="#86efac" opacity="0.8"/>
  </svg>`,
  // Elder Tree
  `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="tg4" cx="50%" cy="35%" r="55%">
        <stop offset="0%" style="stop-color:#86efac"/>
        <stop offset="60%" style="stop-color:#22c55e"/>
        <stop offset="100%" style="stop-color:#052e16"/>
      </radialGradient>
      <filter id="eglow"><feGaussianBlur stdDeviation="4" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect x="90" y="195" width="20" height="52" rx="8" fill="#78350f"/>
    <path d="M90 230 Q68 242 55 252" stroke="#78350f" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M110 230 Q132 242 145 252" stroke="#78350f" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M100 235 Q100 247 100 258" stroke="#78350f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <ellipse cx="100" cy="180" rx="72" ry="42" fill="#14532d" opacity="0.85" filter="url(#eglow)"/>
    <ellipse cx="100" cy="150" rx="60" ry="40" fill="#166534" filter="url(#eglow)"/>
    <ellipse cx="100" cy="122" rx="50" ry="36" fill="#16a34a" filter="url(#eglow)"/>
    <ellipse cx="100" cy="96" rx="40" ry="32" fill="url(#tg4)" filter="url(#eglow)"/>
    <ellipse cx="100" cy="72" rx="30" ry="26" fill="#22c55e" filter="url(#eglow)"/>
    <ellipse cx="100" cy="50" rx="20" ry="18" fill="#4ade80"/>
    <circle cx="100" cy="35" r="14" fill="#86efac"/>
    <circle cx="84" cy="128" r="6" fill="#052e16" opacity="0.8"/>
    <circle cx="116" cy="128" r="6" fill="#052e16" opacity="0.8"/>
    <path d="M84 144 Q100 152 116 144" stroke="#052e16" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="30" cy="130" r="4" fill="#fbbf24" opacity="0.9"/>
    <circle cx="168" cy="118" r="3.5" fill="#fbbf24" opacity="0.9"/>
    <circle cx="50" cy="95" r="3" fill="#86efac" opacity="0.9"/>
    <circle cx="152" cy="150" r="3" fill="#86efac" opacity="0.8"/>
    <circle cx="42" cy="160" r="2.5" fill="#fbbf24" opacity="0.7"/>
    <circle cx="162" cy="85" r="2.5" fill="#86efac" opacity="0.7"/>
  </svg>`,
  // Ancient Tree
  `<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="tg5" cx="50%" cy="35%" r="55%">
        <stop offset="0%" style="stop-color:#bbf7d0"/>
        <stop offset="50%" style="stop-color:#4ade80"/>
        <stop offset="100%" style="stop-color:#052e16"/>
      </radialGradient>
      <filter id="aglow"><feGaussianBlur stdDeviation="6" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect x="88" y="198" width="24" height="58" rx="10" fill="#78350f"/>
    <path d="M88 235 Q65 248 50 260" stroke="#78350f" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M112 235 Q135 248 150 260" stroke="#78350f" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M100 242 Q100 254 100 265" stroke="#78350f" stroke-width="5" fill="none" stroke-linecap="round"/>
    <ellipse cx="100" cy="182" rx="80" ry="46" fill="#14532d" opacity="0.9" filter="url(#aglow)"/>
    <ellipse cx="100" cy="150" rx="68" ry="44" fill="#166534" filter="url(#aglow)"/>
    <ellipse cx="100" cy="120" rx="56" ry="40" fill="#16a34a" filter="url(#aglow)"/>
    <ellipse cx="100" cy="92" rx="44" ry="36" fill="url(#tg5)" filter="url(#aglow)"/>
    <ellipse cx="100" cy="65" rx="34" ry="28" fill="#22c55e" filter="url(#aglow)"/>
    <ellipse cx="100" cy="42" rx="22" ry="20" fill="#4ade80" filter="url(#aglow)"/>
    <circle cx="100" cy="24" r="16" fill="#bbf7d0" filter="url(#aglow)"/>
    <!-- Crown -->
    <circle cx="100" cy="12" r="10" fill="#fbbf24" opacity="0.9" filter="url(#aglow)"/>
    <circle cx="84" cy="126" r="7" fill="#052e16" opacity="0.8"/>
    <circle cx="116" cy="126" r="7" fill="#052e16" opacity="0.8"/>
    <path d="M82 144 Q100 153 118 144" stroke="#052e16" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <!-- Many sparkles for ancient tree -->
    <circle cx="22" cy="138" r="4" fill="#fbbf24" opacity="0.9"/>
    <circle cx="175" cy="122" r="3.5" fill="#fbbf24" opacity="0.9"/>
    <circle cx="38" cy="100" r="3" fill="#86efac" opacity="0.9"/>
    <circle cx="162" cy="158" r="3" fill="#86efac" opacity="0.9"/>
    <circle cx="30" cy="170" r="3" fill="#fbbf24" opacity="0.8"/>
    <circle cx="172" cy="90" r="3" fill="#86efac" opacity="0.8"/>
    <circle cx="58" cy="68" r="2.5" fill="#fbbf24" opacity="0.7"/>
    <circle cx="148" cy="72" r="2.5" fill="#86efac" opacity="0.7"/>
  </svg>`
];

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  currentCourse:  0,
  currentChapter: 0,
  completed:      {},
  bugsFound:      0,
  hintShown:      false,
};

function loadState() {
  const saved = localStorage.getItem("damlforest_state");
  if (saved) state = { ...state, ...JSON.parse(saved) };
}
function saveState() {
  localStorage.setItem("damlforest_state", JSON.stringify(state));
}
function getRank() {
  const done = Object.keys(state.completed).length;
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (state.bugsFound >= r.bugsNeeded && done >= r.chaptersNeeded) rank = r;
  }
  return rank;
}
function getRankIdx() { return RANKS.indexOf(getRank()); }
function getTotalChapters() { return COURSES.reduce((s,c) => s + c.chapters.length, 0); }
function getDoneCount()     { return Object.keys(state.completed).length; }

// ─── Navigation ───────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  if (name === "courses") renderCoursesPage();
  if (name === "home")    renderHome();
  updateNavbar();
}

function openLesson(courseIdx, chapterIdx) {
  state.currentCourse  = courseIdx;
  state.currentChapter = chapterIdx;
  state.hintShown      = false;
  saveState();
  showPage("lesson");
  renderLesson();
}

// ─── Render Home ──────────────────────────────────────────────────────────────
function renderHome() {
  const grid = document.getElementById("curriculum-preview");
  if (!grid) return;
  grid.innerHTML = COURSES.map((c,i) => `
    <div class="curriculum-card" onclick="openLesson(${i},0)">
      <div class="curr-num">Trail ${c.id}</div>
      <div class="curr-title">${c.icon} ${c.title}</div>
      <span class="curr-level level-${c.level}">${c.level}</span>
    </div>`).join("");
}

// ─── Render Courses Page ──────────────────────────────────────────────────────
function renderCoursesPage() {
  const total = getTotalChapters();
  const done  = getDoneCount();
  const pct   = total ? Math.round((done/total)*100) : 0;

  document.getElementById("progress-pct").textContent       = pct + "%";
  document.getElementById("chapters-done").textContent      = done;
  document.getElementById("chapters-total").textContent     = total;
  document.getElementById("sidebar-rank").textContent       = getRank().name;
  document.getElementById("sidebar-bugs").textContent       = state.bugsFound;

  const circle = document.getElementById("progress-ring-circle");
  if (circle) circle.style.strokeDashoffset = 201 - (201 * pct / 100);

  const list = document.getElementById("courses-list");
  list.innerHTML = COURSES.map((course,ci) => {
    const courseDone = course.chapters.filter(ch => state.completed[ch.id]).length;
    const pctC = Math.round((courseDone/course.chapters.length)*100);
    return `
    <div class="course-card" onclick="openLesson(${ci},0)">
      <div class="course-card-top">
        <div class="course-icon">${course.icon}</div>
        <div class="course-info">
          <div class="course-num">Trail ${course.id}</div>
          <div class="course-title">${course.title}</div>
          <div class="course-meta">
            <span class="curr-level level-${course.level}">${course.level}</span>
            <span style="font-size:.75rem;color:var(--text3)">${course.chapters.length} chapters</span>
          </div>
        </div>
        <div style="font-size:1.4rem">${courseDone===course.chapters.length?"🌲":""}</div>
      </div>
      <div class="course-progress-bar"><div class="course-progress-fill" style="width:${pctC}%"></div></div>
      <div class="course-pct">${courseDone}/${course.chapters.length} chapters • ${pctC}%</div>
    </div>`;
  }).join("");
}

// ─── Render Lesson ────────────────────────────────────────────────────────────
function renderLesson() {
  const course  = COURSES[state.currentCourse];
  const chapter = course.chapters[state.currentChapter];
  if (!course || !chapter) return;

  document.getElementById("lesson-breadcrumb").textContent = `${course.title} › Ch ${state.currentChapter+1}`;
  document.getElementById("lesson-content").innerHTML      = chapter.theory;
  document.getElementById("lesson-task-box").innerHTML     = `
    <div class="task-label">🌿 Your Challenge</div>
    <div class="task-text">${chapter.task}</div>`;
  document.getElementById("hint-area").innerHTML = "";
  state.hintShown = false;

  if (window.damlEditor) {
    window.damlEditor.setValue(chapter.initialCode);
    window.damlEditor.setScrollPosition({ scrollTop: 0 });
  }

  document.getElementById("editor-feedback").innerHTML =
    `<span class="feedback-info">Write your solution above, then click Check Answer 🌱</span>`;

  renderChapterList(course);

  document.getElementById("stat-bugs").textContent    = state.bugsFound;
  document.getElementById("stat-chapter").textContent = state.currentChapter + 1;
  document.getElementById("stat-course").textContent  = state.currentCourse + 1;
  document.getElementById("chapter-indicator").textContent =
    `Chapter ${state.currentChapter+1} of ${course.chapters.length}`;

  const pct = Math.round(((state.currentChapter+1)/course.chapters.length)*100);
  document.getElementById("bottom-progress-fill").style.width = pct + "%";
  document.getElementById("btn-prev").style.display =
    (state.currentCourse===0 && state.currentChapter===0) ? "none" : "inline-block";
  document.getElementById("btn-next").style.display  = "none";
  document.getElementById("btn-check").style.display = "inline-block";

  renderCharacter();
  updateNavbar();
}

function renderChapterList(course) {
  document.getElementById("chapter-list").innerHTML = course.chapters.map((ch,i) => {
    const done   = !!state.completed[ch.id];
    const active = i === state.currentChapter;
    return `<div class="chapter-item ${active?"active":""} ${done?"done":""}"
      onclick="openLesson(${state.currentCourse},${i})">
      <div class="chapter-dot ${active?"active":""} ${done?"done":""}">${done?"🌱":""}</div>
      ${ch.title}
    </div>`;
  }).join("");
}

// ─── Tree Character ───────────────────────────────────────────────────────────
function renderCharacter() {
  const rank    = getRank();
  const rankIdx = getRankIdx();
  const el      = document.getElementById("char-tree");
  if (el) el.innerHTML = TREE_SVGS[rankIdx] || TREE_SVGS[0];

  const rn = document.getElementById("char-rank");
  if (rn) rn.textContent = rank.icon + " " + rank.name;

  // Growth bar: progress toward next rank
  const nextRank  = RANKS[Math.min(rankIdx+1, RANKS.length-1)];
  const done      = getDoneCount();
  const progress  = rankIdx === RANKS.length-1 ? 100 :
    Math.min(100, Math.round(
      (done / nextRank.chaptersNeeded) * 100
    ));
  const gb = document.getElementById("growth-bar");
  if (gb) gb.style.width = progress + "%";
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function updateNavbar() {
  const rank = getRank();
  const nr = document.getElementById("nav-rank");
  if (nr) nr.textContent = rank.icon + " " + rank.name;
  const nb = document.getElementById("nav-bugs");
  if (nb) nb.textContent = "🐛 " + state.bugsFound;
}

// ─── Answer Checking ──────────────────────────────────────────────────────────
function checkAnswer() {
  const course  = COURSES[state.currentCourse];
  const chapter = course.chapters[state.currentChapter];
  const code    = window.damlEditor ? window.damlEditor.getValue() : "";
  const fb      = document.getElementById("editor-feedback");

  for (const fp of chapter.forbiddenPatterns) {
    if (code.includes(fp)) {
      fb.innerHTML = `<span class="feedback-error">❌ Still contains: <code>${fp}</code> — this is the bug to fix!</span>`;
      return;
    }
  }
  const missing = chapter.requiredPatterns.filter(p => !code.includes(p));
  if (missing.length > 0) {
    fb.innerHTML = `<span class="feedback-error">❌ Missing: <code>${missing[0]}</code></span>`;
    return;
  }

  const wasNew  = !state.completed[chapter.id];
  const oldRank = getRankIdx();
  state.completed[chapter.id] = true;
  if (wasNew) state.bugsFound += chapter.forbiddenPatterns.length > 0 ? 1 : 0;
  saveState();

  fb.innerHTML = `<span class="feedback-ok">✅ Correct! Your tree grows stronger 🌱</span>`;
  document.getElementById("btn-next").style.display  = "inline-block";
  document.getElementById("btn-check").style.display = "none";
  renderChapterList(course);
  renderCharacter();

  const newRank = getRankIdx();
  document.getElementById("modal-title").textContent = "Trail Marker Reached! 🌿";
  document.getElementById("modal-msg").textContent   = `You completed "${chapter.title}" — your forest grows!`;
  document.getElementById("modal-icon").textContent  = getRank().icon;

  const rankUp = document.getElementById("modal-rank-up");
  if (wasNew && newRank > oldRank) {
    document.getElementById("modal-rank-name").textContent = getRank().name;
    rankUp.style.display = "block";
  } else {
    rankUp.style.display = "none";
  }
  document.getElementById("success-modal").style.display = "flex";
  updateNavbar();
}

function showHint() {
  const chapter = COURSES[state.currentCourse].chapters[state.currentChapter];
  document.getElementById("hint-area").innerHTML =
    `<div class="hint-box">🍃 <strong>Forest Hint:</strong> ${chapter.hint}</div>`;
}

function resetCode() {
  const chapter = COURSES[state.currentCourse].chapters[state.currentChapter];
  if (window.damlEditor) window.damlEditor.setValue(chapter.initialCode);
  document.getElementById("editor-feedback").innerHTML =
    `<span class="feedback-info">Code reset. Try again! 🌱</span>`;
  document.getElementById("btn-next").style.display  = "none";
  document.getElementById("btn-check").style.display = "inline-block";
}

function closeModal() { document.getElementById("success-modal").style.display = "none"; }

function nextChapter() {
  const course = COURSES[state.currentCourse];
  if (state.currentChapter < course.chapters.length-1) {
    openLesson(state.currentCourse, state.currentChapter+1);
  } else if (state.currentCourse < COURSES.length-1) {
    openLesson(state.currentCourse+1, 0);
  } else {
    showPage("courses");
  }
}

function prevChapter() {
  if (state.currentChapter > 0) {
    openLesson(state.currentCourse, state.currentChapter-1);
  } else if (state.currentCourse > 0) {
    const prev = COURSES[state.currentCourse-1];
    openLesson(state.currentCourse-1, prev.chapters.length-1);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadState();
renderHome();
updateNavbar();
