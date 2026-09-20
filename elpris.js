/* Elpris time for time.
   Laeser data.json fra samme mappe. Sidespecifikke vaerdier kommer fra
   window.ELPRIS, som HTML-filen saetter foer dette script hentes.
   Alle priser i data.json er kr./kWh ekskl. moms. */
(function () {
  "use strict";

  var CFG = window.ELPRIS || {};
  var NET = CFG.net || "elnet-midt";
  var TZ = "Europe/Copenhagen";
  var MOMS = 1.25;

  /* Energinet-poster en C-kunde i 0,4 kV-nettet betaler. Eksakt navnematch,
     trimmet og i smaa bogstaver - ikke regex. Et regexmatch paa "transmission"
     rammer ogsaa 132/150 kV-tariffen og elafgift transmissionsnettet, og
     "^systemtarif" rammer storforbrugersatsen. Tilsammen 5,32 oere/kWh for meget. */
  var STANDARD_POSTER = ["transmissions nettarif", "systemtarif", "elafgift"];

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined && txt !== null) n.textContent = txt;
    return n;
  }

  var nf2 = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf1 = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function kr(v) { return nf2.format(v) + " kr."; }
  function ore(v) { return nf1.format(v * 100) + " øre"; }
  function hhmm(h) { return (h < 10 ? "0" + h : h) + ":00"; }
  function nkey(s) { return String(s).trim().toLowerCase(); }

  var state = {
    data: null,
    visning: "frem",     // "frem" eller en ISO-dato
    valgt: null,         // {iso, h} for den time brugeren har klikket
    valgtePoster: null,  // Set af normaliserede Energinet-navne
    fejl: false
  };

  /* ---------- dato og klokke i dansk tid ---------- */
  function iDagISO() {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
  }
  function timeNu() {
    return parseInt(new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", hour12: false
    }).format(new Date()), 10);
  }
  function dagNavn(iso) {
    var i = iDagISO();
    if (iso === i) return "I dag";
    var d = new Date(iso + "T12:00:00Z"), n = new Date(i + "T12:00:00Z");
    if (Math.round((d - n) / 86400000) === 1) return "I morgen";
    var s = new Intl.DateTimeFormat("da-DK", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function dage() { return Object.keys(state.data.days).sort(); }

  /* ---------- fejl ---------- */
  function visFejl(overskrift, detalje) {
    state.fejl = true;
    var box = $("errbox");
    box.innerHTML = "";
    var d = el("div", "err");
    d.appendChild(el("strong", null, overskrift));
    if (detalje) { d.appendChild(document.createElement("br")); d.appendChild(el("code", null, detalje)); }
    box.appendChild(d);
    $("chartHost").innerHTML = "";
    $("tblCard").hidden = true;
    $("stamp").textContent = "Ingen gyldige priser";
  }

  /* ---------- beregning ---------- */
  function momsFaktor() { return $("vat").checked ? MOMS : 1; }
  function tillaeg() {
    var v = parseFloat($("markup").value);
    return isFinite(v) && v > 0 ? v / 100 : 0;   // oere/kWh ex moms -> kr./kWh
  }

  function enValgte(dag) {
    return (dag.energinet || []).filter(function (p) { return state.valgtePoster.has(nkey(p.note)); });
  }
  function enMangler(dag) {
    var har = (dag.energinet || []).map(function (p) { return nkey(p.note); });
    return STANDARD_POSTER.filter(function (n) { return har.indexOf(n) === -1; });
  }

  /* En time: {iso, h, stroem, tarif, total} - alt i kr./kWh med gaeldende momsfaktor. */
  function time(iso, h) {
    var dag = state.data.days[iso];
    var spot = dag.spot ? dag.spot[h] : null;
    if (spot === null || spot === undefined) return null;
    var dso = dag.dso ? dag.dso[NET] : null;
    if (!dso) return null;
    var m = momsFaktor(), t = tillaeg();
    var enSum = 0;
    enValgte(dag).forEach(function (p) { enSum += (p.prices[h] || 0); });
    var stroem = (spot + t) * m;
    var tarif = ((dso.prices[h] || 0) + enSum) * m;
    return { iso: iso, h: h, spot: spot, dso: dso.prices[h] || 0, en: enSum, stroem: stroem, tarif: tarif, total: stroem + tarif };
  }

  function doegn(iso) {
    var ud = [];
    for (var h = 0; h < 24; h++) ud.push(time(iso, h));
    return ud;
  }

  /* Alle timer fra nu og saa langt data raekker. */
  function fremITiden() {
    var iDag = iDagISO(), nu = timeNu(), ud = [];
    dage().forEach(function (iso) {
      if (iso < iDag) return;
      for (var h = (iso === iDag ? nu : 0); h < 24; h++) {
        var r = time(iso, h);
        if (r) ud.push(r);
      }
    });
    return ud;
  }

  /* ---------- hero: altid prisen lige nu ---------- */
  function tegnHero() {
    var iDag = iDagISO(), nu = timeNu();
    var r = state.data.days[iDag] ? time(iDag, nu) : null;
    if (!r) {
      var f = fremITiden();
      r = f.length ? f[0] : null;
      $("heroLbl").textContent = r ? dagNavn(r.iso) + " " + hhmm(r.h) + "–" + hhmm((r.h + 1) % 24) : "Ingen pris";
    } else {
      $("heroLbl").textContent = "Prisen lige nu (" + hhmm(nu) + "–" + hhmm((nu + 1) % 24) + ")";
    }
    if (!r) { $("heroPrice").firstChild.nodeValue = "–"; return; }

    $("heroPrice").firstChild.nodeValue = nf2.format(r.total);
    $("heroSpot").textContent = kr(r.stroem);
    $("heroTar").textContent = kr(r.tarif);
    var sum = Math.abs(r.stroem) + Math.abs(r.tarif);
    var p = sum > 0 ? (Math.abs(r.stroem) / sum) * 100 : 50;
    $("splitS").style.width = p.toFixed(1) + "%";
    $("splitT").style.width = (100 - p).toFixed(1) + "%";
  }

  /* ---------- visning: frem i tiden ---------- */
  function tegnFrem() {
    var host = $("chartHost");
    host.innerHTML = "";
    $("tblCard").hidden = true;

    var raekker = fremITiden();
    if (!raekker.length) { host.appendChild(el("div", "skeleton", "Ingen priser frem i tiden")); return; }

    var maxT = Math.max.apply(null, raekker.map(function (r) { return r.total; }));
    var skala = maxT > 0 ? maxT : 1;
    var billigst = raekker.reduce(function (a, x) { return x.total < a.total ? x : a; });
    var iDag = iDagISO(), nu = timeNu();

    var wrap = el("div", "rows");
    var sidsteDag = null;
    raekker.forEach(function (r) {
      if (r.iso !== sidsteDag) {
        wrap.appendChild(el("div", "daybreak", dagNavn(r.iso)));
        sidsteDag = r.iso;
      }
      var rw = el("button", "rrow");
      rw.type = "button";
      rw.setAttribute("aria-label", dagNavn(r.iso) + " " + hhmm(r.h) + ", " + kr(r.total));
      rw.appendChild(el("span", "t", hhmm(r.h)));
      var track = el("span", "track");
      var bs = el("i", "bs"), bt = el("i", "bt");
      bs.style.width = ((Math.max(r.stroem, 0) / skala) * 100).toFixed(2) + "%";
      bt.style.width = ((Math.max(r.tarif, 0) / skala) * 100).toFixed(2) + "%";
      track.appendChild(bs); track.appendChild(bt);
      rw.appendChild(track);
      rw.appendChild(el("span", "v", nf2.format(r.total)));
      if (r.iso === iDag && r.h === nu) rw.classList.add("now");
      if (r === billigst) rw.classList.add("cheap");
      if (state.valgt && state.valgt.iso === r.iso && state.valgt.h === r.h) rw.classList.add("sel");
      rw.addEventListener("click", function () { state.valgt = { iso: r.iso, h: r.h }; tegn(); });
      wrap.appendChild(rw);
    });
    host.appendChild(wrap);
    host.appendChild(detaljelinje(raekker));
    noegletal(raekker);
  }

  /* ---------- visning: ét doegn ---------- */
  function tegnDoegn(iso) {
    var host = $("chartHost");
    host.innerHTML = "";
    $("tblCard").hidden = false;

    var rows = doegn(iso);
    var g = rows.filter(function (r) { return r; });
    if (!g.length) { host.appendChild(el("div", "skeleton", "Ingen priser for dette døgn")); return; }

    var maxV = Math.max.apply(null, g.map(function (r) { return r.total; }));
    var minV = Math.min.apply(null, g.map(function (r) { return r.total; }));
    var top = Math.max(maxV, 0), bund = Math.min(minV, 0);
    var spaend = (top - bund) || 1;
    var H = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--chart-h"), 10) || 230;
    var px = function (v) { return (Math.abs(v) / spaend) * H; };
    var nuTime = iso === iDagISO() ? timeNu() : -1;

    var row = el("div", "chartrow");
    var yax = el("div", "yaxis");
    yax.style.height = H + "px";
    for (var gi = 0; gi <= 4; gi++) {
      var s = el("span", null, nf2.format(bund + (spaend * gi) / 4));
      s.style.bottom = ((gi / 4) * H) + "px";
      yax.appendChild(s);
    }

    var bars = el("div", "bars");
    bars.style.height = H + "px";
    for (var gl = 1; gl < 4; gl++) {
      var line = el("i", "gridline");
      line.style.bottom = ((gl / 4) * H) + "px";
      bars.appendChild(line);
    }

    var negH = px(bund);
    rows.forEach(function (r, h) {
      var col = el("button", "col");
      col.type = "button";
      col.setAttribute("aria-label", hhmm(h) + (r ? ", " + kr(r.total) : ", ingen pris"));
      var pos = el("div", "pos"), neg = el("div", "neg");
      pos.style.height = (H - negH) + "px";
      neg.style.height = negH + "px";
      if (r) {
        if (r.total >= 0) {
          var st = el("i", "seg t"); st.style.height = px(Math.max(r.tarif, 0)) + "px";
          var ss = el("i", "seg s"); ss.style.height = px(Math.max(r.stroem, 0)) + "px";
          pos.appendChild(st); pos.appendChild(ss);
        } else {
          var sn = el("i", "seg s"); sn.style.height = px(r.total) + "px";
          neg.appendChild(sn);
        }
      } else col.classList.add("dim");
      col.appendChild(pos);
      if (bund < 0) { col.appendChild(el("div", "zeroline")); col.appendChild(neg); }
      if (state.valgt && state.valgt.iso === iso && state.valgt.h === h) col.classList.add("sel");
      if (r) col.addEventListener("click", function () { state.valgt = { iso: iso, h: h }; tegn(); });
      bars.appendChild(col);
    });

    if (nuTime >= 0) {
      var mark = el("i", "nowmark");
      mark.style.left = (((nuTime + 0.5) / 24) * 100).toFixed(2) + "%";
      bars.appendChild(mark);
    }

    var band = el("div", "loadband");
    rows.forEach(function (r) {
      var d = el("div");
      d.style.background = r ? niveaufarve(r.total, minV, maxV) : "var(--line)";
      band.appendChild(d);
    });

    var xax = el("div", "xaxis");
    for (var h2 = 0; h2 < 24; h2++) xax.appendChild(el("div", null, h2 % 3 === 0 ? String(h2) : ""));

    var plot = el("div", "plot");
    plot.appendChild(bars); plot.appendChild(band); plot.appendChild(xax);
    row.appendChild(yax); row.appendChild(plot);
    host.appendChild(row);
    host.appendChild(detaljelinje(nuTime >= 0 && rows[nuTime] ? [rows[nuTime]].concat(g) : g));

    noegletal(g);
    tegnTabel(rows, iso);
  }

  function niveaufarve(v, min, max) {
    if (max === min) return "var(--ok)";
    var p = (v - min) / (max - min);
    return p < 0.34 ? "var(--ok)" : (p < 0.67 ? "var(--tariff)" : "var(--now)");
  }

  function detaljelinje(kandidater) {
    var r = null;
    if (state.valgt) r = time(state.valgt.iso, state.valgt.h);
    if (!r) r = kandidater[0];
    var d = el("div", "detail");
    d.appendChild(el("span", "h", dagNavn(r.iso) + " " + hhmm(r.h) + "–" + hhmm((r.h + 1) % 24)));
    d.appendChild(el("span", null, "Strøm " + kr(r.stroem)));
    d.appendChild(el("span", null, "Transport og afgifter " + kr(r.tarif)));
    d.appendChild(el("span", "tot", kr(r.total)));
    return d;
  }

  function noegletal(rows) {
    if (!rows.length) return;
    var b = rows.reduce(function (a, x) { return x.total < a.total ? x : a; });
    var d = rows.reduce(function (a, x) { return x.total > a.total ? x : a; });
    $("cheapV").textContent = kr(b.total);
    $("cheapS").textContent = dagNavn(b.iso) + " " + hhmm(b.h) + "–" + hhmm((b.h + 1) % 24);
    $("expV").textContent = kr(d.total);
    $("expS").textContent = dagNavn(d.iso) + " " + hhmm(d.h) + "–" + hhmm((d.h + 1) % 24);
  }

  function tegnTabel(rows, iso) {
    var tabel = $("tbl");
    tabel.querySelector("caption").textContent =
      "Alle priser i kr. pr. kWh " + ($("vat").checked ? "inkl. moms" : "ekskl. moms");
    var tb = tabel.querySelector("tbody");
    tb.innerHTML = "";
    var nuTime = iso === iDagISO() ? timeNu() : -1;
    var g = rows.filter(function (r) { return r; });
    var billigst = g.length ? g.reduce(function (a, x) { return x.total < a.total ? x : a; }).h : -1;

    rows.forEach(function (r, h) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", null, hhmm(h) + "–" + hhmm((h + 1) % 24)));
      if (!r) {
        var td = el("td", null, "–"); td.colSpan = 3; tr.appendChild(td);
      } else {
        tr.appendChild(el("td", null, nf2.format(r.stroem)));
        tr.appendChild(el("td", null, nf2.format(r.tarif)));
        tr.appendChild(el("td", null, nf2.format(r.total)));
        var c = [];
        if (h === nuTime) c.push("now");
        if (h === billigst) c.push("cheap");
        tr.className = c.join(" ");
      }
      tb.appendChild(tr);
    });
  }

  /* ---------- navigation ---------- */
  function tegnDagnav() {
    var nav = $("daynav");
    nav.innerHTML = "";
    function knap(id, tekst) {
      var b = el("button", null, tekst);
      b.type = "button";
      b.setAttribute("aria-pressed", state.visning === id ? "true" : "false");
      b.addEventListener("click", function () {
        if (state.visning === id) return;
        state.visning = id; state.valgt = null; tegn();
      });
      nav.appendChild(b);
    }
    knap("frem", "Frem i tiden");
    dage().forEach(function (iso) { knap(iso, dagNavn(iso)); });
  }

  /* ---------- indstillinger ---------- */
  function tegnPoster(iso) {
    var dag = state.data.days[iso];
    var m = momsFaktor();

    $("dsoHead").textContent = (CFG.netNavn || "Netselskab") + (CFG.gln ? " — GLN " + CFG.gln : "");
    var box = $("dsoBox");
    box.innerHTML = "";
    var dso = dag.dso ? dag.dso[NET] : null;
    if (dso) {
      box.appendChild(el("label", null, dso.note + " (" + dso.code + ")"));
      var trin = [];
      dso.prices.forEach(function (p) { if (trin.indexOf(p) === -1) trin.push(p); });
      trin.sort(function (a, b) { return a - b; });
      box.appendChild(el("span", "amt", trin.map(function (p) { return nf1.format(p * m * 100); }).join(" / ") + " øre"));
    } else {
      box.appendChild(el("label", null, "Nettarif mangler i data.json for " + NET));
    }

    var enBox = $("enBox");
    enBox.innerHTML = "";
    (dag.energinet || []).forEach(function (p, i) {
      var k = nkey(p.note);
      var r = el("div", "setrow");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "en" + i;
      cb.checked = state.valgtePoster.has(k);
      cb.addEventListener("change", function () {
        if (cb.checked) state.valgtePoster.add(k); else state.valgtePoster.delete(k);
        tegn();
      });
      var lab = el("label", null, p.note);
      lab.setAttribute("for", cb.id);
      r.appendChild(cb); r.appendChild(lab);
      r.appendChild(el("span", "amt", ore((p.prices[0] || 0) * m)));
      enBox.appendChild(r);
    });
  }

  /* ---------- samlet tegning ---------- */
  function tegn() {
    var liste = dage();
    var refDag = state.visning === "frem"
      ? (liste.indexOf(iDagISO()) !== -1 ? iDagISO() : liste[0])
      : state.visning;
    var dag = state.data.days[refDag];
    if (!dag) { visFejl("Ingen data for " + refDag); return; }

    if (!dag.dso || !dag.dso[NET]) {
      visFejl("Nettarif mangler for " + (CFG.netNavn || NET) + " den " + refDag + ".",
        "data.json har ingen post under dso." + NET + ". Prisen ville blive for lav, så den vises ikke.");
      return;
    }
    var mangler = enMangler(dag);
    if (mangler.length) {
      visFejl("Energinet-poster mangler i data.json: " + mangler.join(", ") + ".",
        "Posterne kan have skiftet navn hos Energi Data Service. Prisen ville blive for lav, så den vises ikke.");
      return;
    }
    state.fejl = false;
    $("errbox").innerHTML = "";

    tegnDagnav();
    tegnHero();
    if (state.visning === "frem") tegnFrem(); else tegnDoegn(state.visning);
    tegnPoster(refDag);

    var g = state.data.generated ? new Date(state.data.generated) : null;
    $("stamp").textContent = "Priser opdateret " + (g
      ? new Intl.DateTimeFormat("da-DK", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(g)
      : "ukendt");
  }

  /* ---------- indlaesning ---------- */
  function hent() {
    $("stamp").textContent = "Henter priser…";
    var url = "data.json?t=" + Date.now();
    fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("data.json svarede " + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.days || !Object.keys(j.days).length) throw new Error("data.json indeholder ingen døgn");
        state.data = j;
        state.visning = "frem";
        state.valgt = null;
        state.valgtePoster = new Set(STANDARD_POSTER);
        $("place").textContent = CFG.sted || j.priceArea || "DK1";
        if ($("fnet")) $("fnet").textContent = CFG.netNavn || "Netselskabet";
        tegn();
      })
      .catch(function (e) {
        visFejl("Kunne ikke hente priserne.", String(e.message || e) + " — " + url);
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("reload").addEventListener("click", hent);
    $("markup").addEventListener("input", function () { if (state.data && !state.fejl) tegn(); });
    $("vat").addEventListener("change", function () { if (state.data && !state.fejl) tegn(); });
    setInterval(function () { if (state.data && !state.fejl) tegn(); }, 60000);
    hent();
  });
})();
