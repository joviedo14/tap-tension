(function () {
  "use strict";
  var D = window.TapDSP;
  var KEY = "tap-tension-v1";
  var $ = function (id) { return document.getElementById(id); };

  // ---------- data ----------
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function job(o) {
    return {
      id: uid(), date: o.date, label: o.label,
      mains: { type: o.mt, gauge: o.mg }, crosses: { type: o.ct, gauge: o.cg },
      refM: o.rm, refC: o.rc, factor: 1, readings: []
    };
  }

  function seed() {
    // From Juan's stringing log. Gauges are typical values; edit if different.
    return {
      current: "speed",
      racquets: [
        { id: "speed", name: "Head Speed Pro", head: 100, jobs: [job({ date: "2026-10-12", label: "Kirschbaum Syn Gut", mt: "synthetic", mg: 1.30, ct: "synthetic", cg: 1.30, rm: 50, rc: 48 })] },
        { id: "blackout", name: "Solinco Blackout", head: 100, jobs: [job({ date: "2026-10-01", label: "Kirschbaum Syn Gut", mt: "synthetic", mg: 1.30, ct: "synthetic", cg: 1.30, rm: 53, rc: 50 })] },
        { id: "prince", name: "Prince Tour 100", head: 100, jobs: [job({ date: "2026-09-30", label: "Kirschbaum Syn Gut", mt: "synthetic", mg: 1.30, ct: "synthetic", cg: 1.30, rm: 53, rc: 50 })] },
        { id: "boom", name: "Dad's Boom MP", head: 100, jobs: [job({ date: "2026-10-22", label: "Isospeed Spin", mt: "poly", mg: 1.25, ct: "poly", cg: 1.25, rm: 50, rc: 50 })] }
      ]
    };
  }

  var state;
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) { state = null; }
  if (!state || !state.racquets || !state.racquets.length) state = seed();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast("Couldn't save on this device"); } }

  function racquet() {
    var r = state.racquets.filter(function (x) { return x.id === state.current; })[0];
    if (!r) { r = state.racquets[0]; state.current = r.id; }
    return r;
  }
  function curJob() { var r = racquet(); return r.jobs[r.jobs.length - 1]; }
  function setupFor(r, j) {
    return { headIn2: r.head, mu: D.effectiveMu(j.mains, j.crosses), factor: j.factor || 1 };
  }
  function refAvg(j) { return (Number(j.refM) + Number(j.refC)) / 2; }

  // ---------- UI helpers ----------
  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function fmtDate(s) {
    var p = s.split("-"); var m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return m[Number(p[1]) - 1] + " " + Number(p[2]);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- render ----------
  function renderRail() {
    var rail = $("rail"); rail.innerHTML = "";
    state.racquets.forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = r.name;
      b.setAttribute("aria-pressed", r.id === state.current ? "true" : "false");
      b.onclick = function () { state.current = r.id; save(); clearTaps(); renderAll(); };
      rail.appendChild(b);
    });
  }

  function renderJob() {
    var j = curJob();
    $("jobLine").innerHTML = "<b>" + esc(j.label || "Strings") + "</b> at " + j.refM + "/" + j.refC + " lb, strung " + fmtDate(j.date);
  }

  function dropInfo(j, lb) {
    if (!j.readings.length) return null;
    var base = j.readings[0].lb;
    return (lb - base) / base * 100;
  }
  function pillFor(pct) {
    if (pct === null) return '<span class="pill base">baseline</span>';
    var cls = pct > -10 ? "good" : pct > -20 ? "warn" : "bad";
    return '<span class="pill ' + cls + '">' + (pct > 0 ? "+" : "") + pct.toFixed(1) + "%</span>";
  }

  function renderLog() {
    var j = curJob(), log = $("log");
    if (!j.readings.length) {
      log.innerHTML = '<p class="empty">No readings yet. Your first saved reading becomes the baseline for this string job.</p>';
    } else {
      log.innerHTML = j.readings.map(function (rd, i) {
        var pct = i === 0 ? null : dropInfo(j, rd.lb);
        return '<div class="logrow"><div class="d">' + fmtDate(rd.date) +
          '<span>' + (rd.note ? esc(rd.note) : rd.taps + " taps, " + Math.round(rd.hz) + " Hz") + "</span></div>" +
          '<div class="lb">' + rd.lb.toFixed(1) + "</div><div>" + pillFor(pct) +
          '<button class="x" type="button" aria-label="Delete reading" data-i="' + i + '">×</button></div></div>';
      }).reverse().join("");
      Array.prototype.forEach.call(log.querySelectorAll(".x"), function (b) {
        b.onclick = function () {
          if (b.dataset.armed) { j.readings.splice(Number(b.dataset.i), 1); save(); renderLog(); renderChart(); }
          else { b.dataset.armed = "1"; b.textContent = "Delete?"; b.style.fontSize = "13px"; }
        };
      });
    }
  }

  function renderChart() {
    var j = curJob(), svg = $("chart"), W = 340, H = 150, L = 34, R = 10, T = 12, B = 24;
    var pts = j.readings;
    if (!pts.length) {
      svg.innerHTML = '<text x="170" y="80" text-anchor="middle" fill="var(--muted)" font-size="13">Readings will chart here</text>';
      return;
    }
    var base = pts[0].lb;
    var vals = pts.map(function (p) { return p.lb; }).concat([base * 0.78, base * 1.03]);
    var lo = Math.floor(Math.min.apply(null, vals) - 1), hi = Math.ceil(Math.max.apply(null, vals) + 1);
    var y = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B); };
    var x = function (i) { return pts.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (pts.length - 1); };
    var s = "";
    s += '<rect x="' + L + '" y="' + y(base * 0.9) + '" width="' + (W - L - R) + '" height="' + (y(base * 0.8) - y(base * 0.9)) + '" fill="var(--warn)" opacity="0.12"/>';
    s += '<rect x="' + L + '" y="' + y(base * 0.8) + '" width="' + (W - L - R) + '" height="' + Math.max(0, H - B - y(base * 0.8)) + '" fill="var(--bad)" opacity="0.10"/>';
    var step = (hi - lo) > 12 ? 5 : 2;
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" fill="var(--muted)" font-size="11">' + v + "</text>";
    }
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(base) + '" y2="' + y(base) + '" stroke="var(--muted)" stroke-dasharray="4 4"/>';
    s += '<text x="' + (W - R) + '" y="' + (y(base) - 5) + '" text-anchor="end" fill="var(--muted)" font-size="11">baseline</text>';
    if (pts.length > 1) {
      s += '<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" points="' +
        pts.map(function (p, i) { return x(i) + "," + y(p.lb); }).join(" ") + '"/>';
    }
    pts.forEach(function (p, i) {
      var last = i === pts.length - 1;
      s += '<circle cx="' + x(i) + '" cy="' + y(p.lb) + '" r="' + (last ? 5 : 3.5) + '" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>';
    });
    s += '<text x="' + L + '" y="' + (H - 6) + '" fill="var(--muted)" font-size="11">' + fmtDate(pts[0].date) + "</text>";
    if (pts.length > 1) s += '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" fill="var(--muted)" font-size="11">' + fmtDate(pts[pts.length - 1].date) + "</text>";
    svg.innerHTML = s;
  }

  var MAT_KEYS = Object.keys(D.MATERIALS);
  function fillSelect(sel) {
    sel.innerHTML = MAT_KEYS.map(function (k) { return '<option value="' + k + '">' + D.MATERIALS[k].label + "</option>"; }).join("");
  }
  fillSelect($("fMType")); fillSelect($("fCType"));

  function renderSetup() {
    var r = racquet(), j = curJob();
    $("fName").value = r.name; $("fHead").value = r.head;
    $("fMType").value = j.mains.type; $("fMGauge").value = j.mains.gauge;
    $("fCType").value = j.crosses.type; $("fCGauge").value = j.crosses.gauge;
    $("fRefM").value = j.refM; $("fRefC").value = j.refC;
    $("fLabel").value = j.label || ""; $("fDate").value = j.date;
    $("fFactor").value = (j.factor || 1).toFixed(2);
    $("delRacquetBtn").hidden = state.racquets.length < 2;
  }

  function bindSetup() {
    function num(id, lo, hi, fallback) {
      var v = parseFloat($(id).value);
      return isFinite(v) && v >= lo && v <= hi ? v : fallback;
    }
    ["fName","fHead","fMType","fMGauge","fCType","fCGauge","fRefM","fRefC","fLabel","fDate","fFactor"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        var r = racquet(), j = curJob();
        r.name = $("fName").value.trim() || r.name;
        r.head = num("fHead", 80, 135, r.head);
        j.mains = { type: $("fMType").value, gauge: num("fMGauge", 1.0, 1.5, j.mains.gauge) };
        j.crosses = { type: $("fCType").value, gauge: num("fCGauge", 1.0, 1.5, j.crosses.gauge) };
        j.refM = num("fRefM", 20, 80, j.refM); j.refC = num("fRefC", 20, 80, j.refC);
        j.label = $("fLabel").value.trim();
        if ($("fDate").value) j.date = $("fDate").value;
        j.factor = num("fFactor", 0.5, 2, j.factor || 1);
        // Recompute saved readings from their frequencies so they stay comparable
        var su = setupFor(r, j);
        j.readings.forEach(function (rd) { rd.lb = D.tensionLb(rd.hz, su); });
        save(); renderRail(); renderJob(); renderLog(); renderChart(); recalcTaps();
      });
    });
    $("newJobBtn").onclick = function () {
      var r = racquet(), j = curJob();
      var nj = JSON.parse(JSON.stringify(j));
      nj.id = uid(); nj.date = today(); nj.readings = [];
      r.jobs.push(nj); save(); renderAll();
      toast("New string job started. Update the strings and tensions above.");
    };
    $("addRacquetBtn").onclick = function () {
      var r = { id: uid(), name: "New racquet", head: 100, jobs: [job({ date: today(), label: "", mt: "synthetic", mg: 1.30, ct: "synthetic", cg: 1.30, rm: 50, rc: 48 })] };
      state.racquets.push(r); state.current = r.id; save(); renderAll();
      $("setupBox").open = true; $("fName").focus(); $("fName").select();
    };
    $("delRacquetBtn").onclick = function () {
      var b = $("delRacquetBtn");
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to delete " + racquet().name + " and its readings"; return; }
      state.racquets = state.racquets.filter(function (x) { return x.id !== state.current; });
      state.current = state.racquets[0].id; delete b.dataset.armed; b.textContent = "Delete this racquet";
      save(); renderAll();
    };
  }

  // ---------- taps ----------
  var taps = []; // {hz, ok}
  function clearTaps() { taps = []; recalcTaps(); }
  function goodTaps() {
    var ok = taps.filter(function (t) { return t.ok; }).slice(-8);
    if (ok.length >= 3) {
      var m = D.median(ok.map(function (t) { return t.hz; }));
      ok.forEach(function (t) { t.outlier = Math.abs(t.hz - m) / m > 0.04; });
      ok = ok.filter(function (t) { return !t.outlier; });
    }
    return ok;
  }
  function recalcTaps() {
    var r = racquet(), j = curJob(), su = setupFor(r, j);
    var ok = goodTaps();
    var tapsEl = $("taps");
    tapsEl.innerHTML = taps.slice(-10).map(function (t) {
      return '<span class="tap' + (t.ok && !t.outlier ? "" : " off") + '">' + (t.hz ? D.tensionLb(t.hz, su).toFixed(1) : "?") + "</span>";
    }).join("");
    $("nTaps").textContent = ok.length; $("tapWord").textContent = ok.length === 1 ? "tap" : "taps";
    if (!ok.length) {
      $("bigLb").innerHTML = "--<small>lb</small>"; $("hz").textContent = "--"; $("spread").textContent = "--"; $("pctRef").textContent = "--";
      $("saveBtn").disabled = true; current = null; return;
    }
    var hz = D.median(ok.map(function (t) { return t.hz; }));
    var lb = D.tensionLb(hz, su);
    var lbs = ok.map(function (t) { return D.tensionLb(t.hz, su); });
    var spread = ok.length > 1 ? (Math.max.apply(null, lbs) - Math.min.apply(null, lbs)) / lb * 100 : null;
    $("bigLb").innerHTML = lb.toFixed(1) + "<small>lb</small>";
    $("hz").textContent = Math.round(hz);
    $("spread").textContent = spread === null ? "--" : spread.toFixed(1) + "%";
    $("pctRef").textContent = Math.round(lb / refAvg(j) * 100) + "%";
    current = { hz: hz, lb: lb, n: ok.length, spread: spread };
    $("saveBtn").disabled = ok.length < 3;
    if (ok.length < 3) setStatus("Keep tapping. " + (3 - ok.length) + " more clean " + (3 - ok.length === 1 ? "tap" : "taps") + " needed.", "");
    else if (spread !== null && spread < 3) setStatus("Taps agree. Save when ready.", "ok");
    else setStatus("Taps disagree. Tap the same spot with the same force.", "warn");
  }
  var current = null;
  function setStatus(msg, cls) { var s = $("status"); s.textContent = msg; s.className = "status" + (cls ? " " + cls : ""); }

  $("clearBtn").onclick = function () { clearTaps(); setStatus(listening ? "Listening. Tap the center of the strings." : "Taps cleared.", ""); };
  $("saveBtn").onclick = function () {
    if (!current) return;
    var j = curJob();
    j.readings.push({ date: today(), hz: current.hz, lb: current.lb, taps: current.n, note: $("noteIn").value.trim() });
    $("noteIn").value = ""; save(); renderLog(); renderChart();
    var pct = j.readings.length > 1 ? dropInfo(j, current.lb) : null;
    toast(pct === null ? "Saved as the baseline for this string job" : "Saved. " + (pct > 0 ? "+" : "") + pct.toFixed(1) + "% vs baseline");
    clearTaps(); setStatus(listening ? "Saved. Still listening." : "Saved.", "ok");
  };

  // ---------- audio ----------
  var ctx, stream, proc, src, listening = false, wakeLock = null;
  var ring, ringSize = 1 << 16, written = 0, noise = 0.002, lastTrig = -1e9, pending = null;

  function onAudio(e) {
    var x = e.inputBuffer.getChannelData(0), n = x.length, sr = ctx.sampleRate, i, pk = 0, ss = 0;
    for (i = 0; i < n; i++) {
      ring[(written + i) & (ringSize - 1)] = x[i];
      var a = x[i] < 0 ? -x[i] : x[i]; if (a > pk) pk = a; ss += x[i] * x[i];
    }
    var rms = Math.sqrt(ss / n);
    $("meter").style.width = Math.min(100, pk * 160) + "%";
    var thresh = Math.max(0.03, noise * 12);
    if (!pending && pk > thresh && (written - lastTrig) > sr * 0.3) {
      var at = 0; for (i = 0; i < n; i++) { if ((x[i] < 0 ? -x[i] : x[i]) > thresh) { at = i; break; } }
      lastTrig = written + at;
      pending = { start: lastTrig + Math.round(sr * 0.004), len: Math.round(sr * 0.12) };
    } else if (!pending) {
      noise = noise * 0.95 + rms * 0.05;
    }
    written += n;
    if (pending && written >= pending.start + pending.len) {
      var seg = new Float32Array(pending.len);
      for (i = 0; i < pending.len; i++) seg[i] = ring[(pending.start + i) & (ringSize - 1)];
      pending = null;
      handleTap(seg, sr);
    }
  }

  function handleTap(seg, sr) {
    var su = setupFor(racquet(), curJob());
    var fmin = D.frequencyFor(15, su), fmax = D.frequencyFor(100, su);
    var res = D.analyze(seg, sr, fmin, fmax);
    if (res && res.snr >= 6) { taps.push({ hz: res.hz, ok: true }); }
    else { taps.push({ hz: res ? res.hz : 0, ok: false }); setStatus("Unclear tap. Tap a bit harder, closer to the mic.", "warn"); }
    recalcTaps();
  }

  function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("This browser can't use the microphone here. Open the app over https in Chrome.", "bad"); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then(function (s) {
        stream = s;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        src = ctx.createMediaStreamSource(s);
        proc = ctx.createScriptProcessor(2048, 1, 1);
        ring = new Float32Array(ringSize); written = 0; lastTrig = -1e9; pending = null; noise = 0.002;
        proc.onaudioprocess = onAudio;
        src.connect(proc); proc.connect(ctx.destination);
        listening = true;
        var b = $("listenBtn"); b.classList.add("live"); b.innerHTML = '<span class="dot"></span>Stop listening';
        setStatus("Listening. Tap the center of the strings.", "");
        if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (w) { wakeLock = w; }).catch(function () {});
      })
      .catch(function () { setStatus("Microphone blocked. Allow mic access for this site in Chrome's site settings.", "bad"); });
  }
  function stop() {
    listening = false;
    try { proc && proc.disconnect(); src && src.disconnect(); } catch (e) {}
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    if (ctx) ctx.close();
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    $("meter").style.width = "0";
    var b = $("listenBtn"); b.classList.remove("live"); b.textContent = "Start listening";
    if (!current) setStatus("Stopped.", "");
  }
  $("listenBtn").onclick = function () { listening ? stop() : start(); };
  document.addEventListener("visibilitychange", function () { if (document.hidden && listening) stop(); });

  // ---------- export ----------
  $("exportBtn").onclick = function () {
    var rows = ["racquet,strung_on,strings,ref_mains,ref_crosses,reading_date,tension_lb,frequency_hz,taps,pct_vs_baseline,note"];
    state.racquets.forEach(function (r) {
      r.jobs.forEach(function (j) {
        j.readings.forEach(function (rd, i) {
          var pct = i === 0 ? "" : ((rd.lb - j.readings[0].lb) / j.readings[0].lb * 100).toFixed(1);
          rows.push([r.name, j.date, j.label, j.refM, j.refC, rd.date, rd.lb.toFixed(1), rd.hz.toFixed(1), rd.taps, pct, rd.note || ""]
            .map(function (v) { v = String(v); return /[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","));
        });
      });
    });
    var text = rows.join("\n");
    if (rows.length === 1) { toast("No readings to copy yet"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Log copied as CSV"); }, function () { toast("Copy failed"); });
    } else toast("Copy isn't available in this browser");
  };

  function renderAll() { renderRail(); renderJob(); renderSetup(); renderLog(); renderChart(); recalcTaps(); setStatus("Tap Start, then tap the center of the strings 5 or 6 times.", ""); }
  bindSetup();
  renderAll();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
