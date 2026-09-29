// Wild Eights — Graphics section of the Settings screen. Builds the controls
// inside #gfx-fieldset, localizes them (from navigator.language; the rest of
// the game is English-only) and applies every change immediately through the
// hooks app.js passes to mount(). Exposes window.WEGraphicsPanel (browser)
// and module.exports (Node: locale tables for the tests).
(function (root, factory) {
  "use strict";
  var api = factory(root && root.WEGfx ? root.WEGfx : null);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WEGraphicsPanel = api;
})(typeof window !== "undefined" ? window : globalThis, function (GFX) {
  "use strict";

  var EN = {
    legend: "Graphics", quality: "Quality", auto: "Auto (detected: {tier})",
    low: "Low", balanced: "Balanced", high: "High", ultra: "Ultra",
    renderScale: "Render scale", adaptive: "Adaptive resolution", showFps: "Show frame rate",
    fromPreset: "From preset ({tier})",
    cat_shadows: "Shadows", cat_ao: "Ambient occlusion", cat_bloom: "Bloom", cat_grade: "Color grade",
    cat_antialias: "Anti-aliasing", cat_reflections: "Reflections", cat_detail: "Surface detail",
    cat_particles: "Particles", cat_background: "Ambient animation",
    t_off: "Off", t_on: "On", t_low: "Low", t_medium: "Medium", t_high: "High",
    t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA", t_static: "Static", t_animated: "Animated",
    t_plain: "Plain", t_detailed: "Detailed",
    postNote: "Post-processing is unavailable in this browser, so the table is drawn without it.",
    unavailable: "3D view unavailable",
    sumNoShadows: "no shadows", sumShadows: "shadows", sumAo: "ambient occlusion", sumAoHigh: "full ambient occlusion",
    sumBloom: "bloom", sumReflections: "reflections", sumNoAa: "no anti-aliasing"
  };

  function over(base, o) { var r = {}, k; for (k in base) r[k] = base[k]; for (k in o) r[k] = o[k]; return r; }

  var ES = {
    legend: "Gráficos", quality: "Calidad", auto: "Automática (detectada: {tier})",
    low: "Baja", balanced: "Equilibrada", high: "Alta", ultra: "Ultra",
    renderScale: "Escala de renderizado", adaptive: "Resolución adaptativa", showFps: "Mostrar fotogramas por segundo",
    fromPreset: "Según calidad ({tier})",
    cat_shadows: "Sombras", cat_ao: "Oclusión ambiental", cat_bloom: "Resplandor", cat_grade: "Gradación de color",
    cat_antialias: "Antialiasing", cat_reflections: "Reflejos", cat_detail: "Detalle de superficies",
    cat_particles: "Partículas", cat_background: "Animación ambiental",
    t_off: "Desactivado", t_on: "Activado", t_low: "Bajo", t_medium: "Medio", t_high: "Alto",
    t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA", t_static: "Estática", t_animated: "Animada",
    t_plain: "Simple", t_detailed: "Detallado",
    postNote: "El posprocesado no está disponible en este navegador; la mesa se dibuja sin él.",
    unavailable: "Vista 3D no disponible",
    sumNoShadows: "sin sombras", sumShadows: "sombras", sumAo: "oclusión ambiental", sumAoHigh: "oclusión ambiental completa",
    sumBloom: "resplandor", sumReflections: "reflejos", sumNoAa: "sin antialiasing"
  };
  var FR = {
    legend: "Graphismes", quality: "Qualité", auto: "Auto (détecté : {tier})",
    low: "Basse", balanced: "Équilibrée", high: "Haute", ultra: "Ultra",
    renderScale: "Échelle de rendu", adaptive: "Résolution adaptative", showFps: "Afficher la fréquence d'images",
    fromPreset: "Selon la qualité ({tier})",
    cat_shadows: "Ombres", cat_ao: "Occlusion ambiante", cat_bloom: "Halo lumineux", cat_grade: "Étalonnage des couleurs",
    cat_antialias: "Anticrénelage", cat_reflections: "Reflets", cat_detail: "Détail des surfaces",
    cat_particles: "Particules", cat_background: "Animation d'ambiance",
    t_off: "Désactivé", t_on: "Activé", t_low: "Bas", t_medium: "Moyen", t_high: "Élevé",
    t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA", t_static: "Statique", t_animated: "Animée",
    t_plain: "Simple", t_detailed: "Détaillé",
    postNote: "Le post-traitement n'est pas disponible dans ce navigateur ; la table est affichée sans lui.",
    unavailable: "Vue 3D indisponible",
    sumNoShadows: "sans ombres", sumShadows: "ombres", sumAo: "occlusion ambiante", sumAoHigh: "occlusion ambiante complète",
    sumBloom: "halo", sumReflections: "reflets", sumNoAa: "sans anticrénelage"
  };

  var STRINGS = {
    "en-US": EN,
    "en-GB": over(EN, { cat_grade: "Colour grade", unavailable: "3D view unavailable" }),
    "es-419": ES,
    "es-ES": over(ES, { showFps: "Mostrar FPS", renderScale: "Escala de renderizado", t_off: "No", t_on: "Sí" }),
    "de-DE": {
      legend: "Grafik", quality: "Qualität", auto: "Automatisch (erkannt: {tier})",
      low: "Niedrig", balanced: "Ausgewogen", high: "Hoch", ultra: "Ultra",
      renderScale: "Renderskalierung", adaptive: "Adaptive Auflösung", showFps: "Bildrate anzeigen",
      fromPreset: "Laut Voreinstellung ({tier})",
      cat_shadows: "Schatten", cat_ao: "Umgebungsverdeckung", cat_bloom: "Leuchteffekt", cat_grade: "Farbkorrektur",
      cat_antialias: "Kantenglättung", cat_reflections: "Spiegelungen", cat_detail: "Oberflächendetails",
      cat_particles: "Partikel", cat_background: "Umgebungsanimation",
      t_off: "Aus", t_on: "An", t_low: "Niedrig", t_medium: "Mittel", t_high: "Hoch",
      t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA", t_static: "Statisch", t_animated: "Animiert",
      t_plain: "Einfach", t_detailed: "Detailliert",
      postNote: "Nachbearbeitung ist in diesem Browser nicht verfügbar; der Tisch wird ohne sie gezeichnet.",
      unavailable: "3D-Ansicht nicht verfügbar",
      sumNoShadows: "keine Schatten", sumShadows: "Schatten", sumAo: "Umgebungsverdeckung", sumAoHigh: "volle Umgebungsverdeckung",
      sumBloom: "Leuchteffekt", sumReflections: "Spiegelungen", sumNoAa: "keine Kantenglättung"
    },
    "fr-FR": FR,
    "fr-CA": over(FR, { showFps: "Afficher le nombre d'images par seconde", cat_bloom: "Éclat lumineux", sumBloom: "éclat" }),
    "pt-BR": {
      legend: "Gráficos", quality: "Qualidade", auto: "Automática (detectada: {tier})",
      low: "Baixa", balanced: "Equilibrada", high: "Alta", ultra: "Ultra",
      renderScale: "Escala de renderização", adaptive: "Resolução adaptativa", showFps: "Mostrar taxa de quadros",
      fromPreset: "Conforme a qualidade ({tier})",
      cat_shadows: "Sombras", cat_ao: "Oclusão ambiente", cat_bloom: "Brilho", cat_grade: "Correção de cor",
      cat_antialias: "Antisserrilhamento", cat_reflections: "Reflexos", cat_detail: "Detalhe das superfícies",
      cat_particles: "Partículas", cat_background: "Animação ambiente",
      t_off: "Desligado", t_on: "Ligado", t_low: "Baixo", t_medium: "Médio", t_high: "Alto",
      t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA", t_static: "Estática", t_animated: "Animada",
      t_plain: "Simples", t_detailed: "Detalhado",
      postNote: "O pós-processamento não está disponível neste navegador; a mesa é desenhada sem ele.",
      unavailable: "Visão 3D indisponível",
      sumNoShadows: "sem sombras", sumShadows: "sombras", sumAo: "oclusão ambiente", sumAoHigh: "oclusão ambiente completa",
      sumBloom: "brilho", sumReflections: "reflexos", sumNoAa: "sem antisserrilhamento"
    },
    "it-IT": {
      legend: "Grafica", quality: "Qualità", auto: "Automatica (rilevata: {tier})",
      low: "Bassa", balanced: "Bilanciata", high: "Alta", ultra: "Ultra",
      renderScale: "Scala di rendering", adaptive: "Risoluzione adattiva", showFps: "Mostra frequenza fotogrammi",
      fromPreset: "Da qualità ({tier})",
      cat_shadows: "Ombre", cat_ao: "Occlusione ambientale", cat_bloom: "Bagliore", cat_grade: "Correzione colore",
      cat_antialias: "Antialiasing", cat_reflections: "Riflessi", cat_detail: "Dettaglio superfici",
      cat_particles: "Particelle", cat_background: "Animazione ambientale",
      t_off: "Disattivato", t_on: "Attivato", t_low: "Basso", t_medium: "Medio", t_high: "Alto",
      t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA", t_static: "Statica", t_animated: "Animata",
      t_plain: "Semplice", t_detailed: "Dettagliato",
      postNote: "La post-elaborazione non è disponibile in questo browser; il tavolo viene disegnato senza.",
      unavailable: "Vista 3D non disponibile",
      sumNoShadows: "senza ombre", sumShadows: "ombre", sumAo: "occlusione ambientale", sumAoHigh: "occlusione ambientale completa",
      sumBloom: "bagliore", sumReflections: "riflessi", sumNoAa: "senza antialiasing"
    }
  };
  var LOCALES = Object.keys(STRINGS);

  /** Closest supported locale for a BCP-47 tag (e.g. "es-MX" -> "es-419"). */
  function pickLocale(tag) {
    var t = String(tag || "en-US");
    for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].toLowerCase() === t.toLowerCase()) return LOCALES[i];
    var lang = t.split("-")[0].toLowerCase(), region = (t.split("-")[1] || "").toUpperCase();
    if (lang === "en") return /^(GB|UK|IE|AU|NZ|ZA|IN)$/.test(region) ? "en-GB" : "en-US";
    if (lang === "es") return region === "ES" ? "es-ES" : "es-419";
    if (lang === "fr") return region === "CA" ? "fr-CA" : "fr-FR";
    if (lang === "pt") return "pt-BR";
    if (lang === "de") return "de-DE";
    if (lang === "it") return "it-IT";
    return "en-US";
  }

  var S = EN, hooks = null, built = false, timer = null;

  function tr(key, fallback, vars) {
    var s = S[key] != null ? S[key] : (EN[key] != null ? EN[key] : fallback);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }
  function tierLabel(t) { return tr("t_" + t, t); }
  function presetLabel(p) { return tr(p, p); }
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function saved() { return (hooks && hooks.get()) || {}; }
  function info() { return hooks && hooks.info ? hooks.info() : null; }

  function build() {
    var fs = $("gfx-fieldset");
    if (!fs || built) return;
    built = true;
    var grid = $("gfx-controls");
    // Categories: one select each, "From preset (…)" by default.
    GFX.CATEGORY_ORDER.forEach(function (cat) {
      var lab = el("label", { "for": "opt-gfx-" + cat });
      var span = el("span", { "data-gfx-label": cat });
      var sel = el("select", { id: "opt-gfx-" + cat, "data-gfx-cat": cat });
      lab.appendChild(span); lab.appendChild(sel);
      grid.insertBefore(lab, $("gfx-toggles"));
      sel.addEventListener("change", function () {
        var s = copy(saved());
        if (sel.value === "preset") delete s[cat]; else s[cat] = sel.value;
        commit(s);
      });
    });
    $("opt-quality").addEventListener("change", function (e) {
      commit(GFX.choosePreset(saved(), e.target.value));
    });
    var range = $("opt-gfx-scale");
    range.addEventListener("input", function () {
      $("opt-gfx-scale-out").textContent = range.value + "%";
    });
    range.addEventListener("change", function () {
      var s = copy(saved());
      var v = Math.min(200, Math.max(50, +range.value || 100));
      if (v === 100) delete s.render_scale; else s.render_scale = v / 100;
      commit(s);
    });
    $("opt-gfx-adaptive").addEventListener("change", function (e) {
      var s = copy(saved());
      if (e.target.checked) delete s.adaptive; else s.adaptive = false;
      commit(s);
    });
    $("opt-gfx-fps").addEventListener("change", function (e) {
      var s = copy(saved());
      if (e.target.checked) s.show_fps = true; else delete s.show_fps;
      commit(s);
    });
    timer = setInterval(function () {
      var scr = $("screen-settings");
      if (scr && scr.classList.contains("active")) refreshSummary();
    }, 1000);
  }

  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  function commit(s) {
    hooks.set(s);
    refresh();
  }

  function fillSelect(sel, options, value) {
    sel.textContent = "";
    options.forEach(function (o) { sel.appendChild(el("option", { value: o[0] }, o[1])); });
    sel.value = value;
  }

  /** Sync every control (labels, options, values) from the saved settings. */
  function refresh() {
    if (!built) return;
    var s = saved();
    var inf = info();
    var detected = inf ? inf.detected : "low";
    var r = inf ? inf.resolved : GFX.resolve(s, detected);
    $("gfx-legend").textContent = tr("legend");
    $("gfx-quality-label").textContent = tr("quality");
    $("gfx-scale-label").textContent = tr("renderScale");
    $("gfx-adaptive-label").textContent = tr("adaptive");
    $("gfx-fps-label").textContent = tr("showFps");
    var presetOpts = [["auto", tr("auto", null, { tier: presetLabel(detected) })]].concat(
      GFX.PRESETS.map(function (p) { return [p, presetLabel(p)]; }));
    fillSelect($("opt-quality"), presetOpts, GFX.PRESETS.indexOf(s.preset) >= 0 ? s.preset : "auto");
    GFX.CATEGORY_ORDER.forEach(function (cat) {
      document.querySelector('[data-gfx-label="' + cat + '"]').textContent = tr("cat_" + cat);
      var opts = [["preset", tr("fromPreset", null, { tier: tierLabel(GFX.presetTier(r.preset, cat)) })]].concat(
        GFX.CATEGORIES[cat].map(function (t) { return [t, tierLabel(t)]; }));
      fillSelect($("opt-gfx-" + cat), opts, GFX.CATEGORIES[cat].indexOf(s[cat]) >= 0 ? s[cat] : "preset");
    });
    var pct = Math.round((Number(s.render_scale) || 1) * 100);
    $("opt-gfx-scale").value = pct;
    $("opt-gfx-scale-out").textContent = pct + "%";
    $("opt-gfx-adaptive").checked = s.adaptive !== false;
    $("opt-gfx-fps").checked = !!s.show_fps;
    refreshSummary();
  }

  function refreshSummary() {
    var inf = info();
    var sum = $("gfx-summary"), note = $("gfx-post-note");
    if (!inf) {
      sum.textContent = tr("unavailable");
      note.hidden = true;
      return;
    }
    sum.textContent = inf.gpu + " · " + GFX.describe(inf.resolved, inf.pixels, tr);
    note.textContent = tr("postNote");
    note.hidden = !inf.postFailed;
  }

  /** hooks: { get(): savedGfx, set(savedGfx), info(): UI.graphicsInfo() | null } */
  function mount(h, locale) {
    hooks = h;
    S = STRINGS[pickLocale(locale || (typeof navigator !== "undefined" && (navigator.languages && navigator.languages[0] || navigator.language)))] || EN;
    build();
    refresh();
  }

  return { STRINGS: STRINGS, LOCALES: LOCALES, pickLocale: pickLocale, mount: mount, refresh: refresh };
});
