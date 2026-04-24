// Monaco Editor integration with DAML syntax highlighting

require(["vs/editor/editor.main"], function () {

  // Register DAML language
  monaco.languages.register({ id: "daml" });

  monaco.languages.setMonarchTokensProvider("daml", {
    keywords: [
      "module","where","import","template","with","signatory","observer",
      "ensure","choice","controller","do","create","exercise","fetch","archive",
      "return","let","in","if","then","else","case","of","nonconsuming",
      "interface","implements","viewtype","key","maintainer","assert",
      "submit","submitMustFail","allocateParty","getTime","passTime",
      "setTime","query","queryContractId","fetchByKey","lookupByKey",
      "exerciseByKey","abort","error","try","catch","throw","forall",
      "daml","this","self",
    ],
    typeKeywords: [
      "Party","Text","Int","Decimal","Bool","Time","RelTime",
      "ContractId","Optional","Update","Script","Either",
    ],
    operators: ["=","->","<-","::","..","&&","||","==","/=","<","<=",">",">=","+","-","*","/","<>","$","@"],

    tokenizer: {
      root: [
        [/--.*$/,                          "comment"],
        [/{-/,                             { token: "comment", next: "@blockcomment" }],
        [/"[^"]*"/,                        "string"],
        [/\b(True|False)\b/,              "constant.language"],
        [/\b\d+\.\d+\b/,                  "number.float"],
        [/\b\d+\b/,                        "number"],
        [/\b[A-Z][a-zA-Z0-9_']*\b/,       "type.identifier"],
        [/\b[a-z_][a-zA-Z0-9_']*\b/,      {
          cases: {
            "@keywords":     "keyword",
            "@typeKeywords": "type",
            "@default":      "identifier",
          }
        }],
        [/[=\-<>:!+*\/\\&|@$#~.]+/,       "operator"],
      ],
      blockcomment: [
        [/-}/,  { token: "comment", next: "@pop" }],
        [/./,   "comment"],
      ],
    },
  });

  // Dark DAML theme
  monaco.editor.defineTheme("daml-forest", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment",          foreground: "4b5563", fontStyle: "italic" },
      { token: "keyword",          foreground: "4ade80", fontStyle: "bold" },
      { token: "type.identifier",  foreground: "86efac" },
      { token: "type",             foreground: "a7f3d0" },
      { token: "string",           foreground: "fbbf24" },
      { token: "number",           foreground: "fb923c" },
      { token: "number.float",     foreground: "fb923c" },
      { token: "constant.language",foreground: "d97706" },
      { token: "operator",         foreground: "fbbf24" },
      { token: "identifier",       foreground: "ecfdf5" },
    ],
    colors: {
      "editor.background":          "#0a130a",
      "editor.foreground":          "#ecfdf5",
      "editorLineNumber.foreground":"#374151",
      "editorCursor.foreground":    "#4ade80",
      "editor.selectionBackground": "#166534",
      "editor.lineHighlightBackground": "#0d1a0d",
      "editorGutter.background":    "#0a130a",
      "scrollbarSlider.background": "#172917",
    },
  });

  // Create editor
  const container = document.getElementById("monaco-editor");
  const initialCourse  = COURSES[0];
  const initialChapter = initialCourse.chapters[0];

  window.damlEditor = monaco.editor.create(container, {
    value:                  initialChapter.initialCode,
    language:               "daml",
    theme:                  "daml-forest",
    fontSize:               13,
    fontFamily:             "'JetBrains Mono', monospace",
    lineNumbers:            "on",
    minimap:                { enabled: false },
    scrollBeyondLastLine:   false,
    wordWrap:               "on",
    automaticLayout:        true,
    tabSize:                2,
    renderLineHighlight:    "line",
    cursorBlinking:         "smooth",
    smoothScrolling:        true,
    bracketPairColorization: { enabled: true },
    padding:                { top: 12, bottom: 12 },
  });

  // Auto-validate on change (debounced)
  let validateTimeout = null;
  window.damlEditor.onDidChangeModelContent(() => {
    clearTimeout(validateTimeout);
    validateTimeout = setTimeout(liveValidate, 800);
  });

  function liveValidate() {
    const course  = COURSES[state.currentCourse];
    if (!course) return;
    const chapter = course.chapters[state.currentChapter];
    if (!chapter) return;
    const code = window.damlEditor.getValue();
    const fb   = document.getElementById("editor-feedback");

    // Check forbidden patterns
    for (const fp of chapter.forbiddenPatterns) {
      if (code.includes(fp)) {
        fb.innerHTML = `<span class="feedback-error">⚠️ Bug still present: <code>${fp}</code></span>`;
        return;
      }
    }

    // Count how many required patterns are present
    const total  = chapter.requiredPatterns.length;
    const found  = chapter.requiredPatterns.filter(p => code.includes(p)).length;
    if (total === 0) {
      fb.innerHTML = `<span class="feedback-info">Ready to check when done.</span>`;
    } else if (found === total) {
      fb.innerHTML = `<span class="feedback-ok">✅ Looking good! Click Check Answer.</span>`;
    } else {
      fb.innerHTML = `<span class="feedback-info">${found}/${total} requirements met…</span>`;
    }
  }
});
