"use strict";
/* 3 boyutlu ofis (Three.js r128). Tepeden/açılı görünüm, sürükle=döndür, tekerlek/çimdik=yakınlaştır, sağ tık/iki parmak=kaydır.
   Ajanlar çalışırken masada yazar; boştayken kalkıp kahve makinesine, kanepeye, pinpon masasına, puflara ve toplantı odasına gider.
   Veri app.js'ten gelir (ajanlar(), V, GRUPLAR, TEN, koyuMu, cekmeceCiz). WebGL yoksa app.js 2B ofise döner. */
const Ofis3D = (() => {
  const O = {kok: null, hazir: false, ag: {}, desk: {}, slots: [], imza: "", raf: 0, t0: 0, son: 0, secili: null, odak: null,
             cam: {tx: 0, ty: 0, tz: 0, az: 0, kutup: 0.95, uzak: 46}, hedef: null, tvKey: ""};

  const var_ = () => { try { if (!window.THREE) return false; const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } };

  /* ------------------------------------------------------------ yardımcılar */
  const GC = {}, MC = {};
  const geo = (tip, ...p) => GC[tip + p.join(",")] ||= new THREE[tip](...p);
  const mat = (c, o = {}) => MC[c + JSON.stringify(o)] ||= new THREE.MeshLambertMaterial({color: c, ...o});
  const mesh = (g, m, x = 0, y = 0, z = 0, p) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; if (p) p.add(o); return o; };
  const kutu = (w, h, d, c, x, y, z, p, o) => mesh(geo("BoxGeometry", w, h, d), mat(c, o), x, y, z, p);
  const silin = (rt, rb, h, c, x, y, z, p, seg = 14) => mesh(geo("CylinderGeometry", rt, rb, h, seg), mat(c), x, y, z, p);
  const kure = (r, c, x, y, z, p) => mesh(geo("SphereGeometry", r, 16, 12), mat(c), x, y, z, p);
  const grup = (x, y, z, p) => { const g = new THREE.Group(); g.position.set(x, y, z); if (p) p.add(g); return g; };
  const lerp = (a, b, f) => a + (b - a) * f;
  const rastgele = (a, b) => a + Math.random() * (b - a);

  const T = () => koyuMu()
    ? {bg: 0x0b0f16, hem: 0.5, dir: 0.55, duvar: "#2a3344", duvarU: "#1d2533", kor: "#7a8aa5", kosk: "#4a3d33", koridor: "#3b3128", cizgi: "#2f261e",
       masa: "#8a6a4c", beyaz: "#cfd6e2", cam: 0x6a86b8, gun: false, cim: "#1f3a2e", cim2: "#183024", hemS: 0x8fa4d0, hemG: 0x2a2f3a, dirC: 0xaab8e8}
    : {bg: 0xdfe8f5, hem: 0.62, dir: 0.62, duvar: "#f1f4f9", duvarU: "#dde4ee", kor: "#9fb0c8", kosk: "#d9c3a3", koridor: "#caa97c", cizgi: "#b7936a",
       masa: "#d2a679", beyaz: "#f8fafc", cam: 0x9fd0ff, gun: true, cim: "#86c06f", cim2: "#74ad5f", hemS: 0xdcecff, hemG: 0xb59d7c, dirC: 0xfff0d2};

  /* ------------------------------------------------------------ yerleşim */
  const KOL = 4, ADIM = 3.9, SATIR = 4.6, UST = 3.2, ALT = 1.3, KENAR = 3.4, GEN = 16;
  function yerlesim(liste) {
    const sol = ["yonetim", "uretim"], sag = ["sosyal", "arge"];
    const uyeler = g => liste.filter(a => a.grup === g);
    const derin = ids => ids.reduce((s, g) => { const n = uyeler(g).length; return s + (n ? UST + Math.ceil(n / KOL) * SATIR + ALT + 0.4 : 0); }, 0);
    const Ds = derin(sol), Dg = derin(sag), D = Math.max(Ds, Dg, 26);
    const zonlar = [], desk = {}, bos = {sol: 0, sag: 0};
    for (const [taraf, ids, sx, D0] of [["sol", sol, -1, Ds], ["sag", sag, 1, Dg]]) {
      let z = -D / 2;
      for (const g of ids) {
        const u = uyeler(g); if (!u.length) continue;
        const satir = Math.ceil(u.length / KOL), h = UST + satir * SATIR + ALT;
        const meta = GRUPLAR.find(x => x[0] === g);
        zonlar.push({g, taraf, x0: sx < 0 ? -KENAR - GEN : KENAR, x1: sx < 0 ? -KENAR : KENAR + GEN, z0: z, z1: z + h, renk: meta[2], baslik: meta[1]});
        u.forEach((a, j) => {
          const c = j % KOL, r = Math.floor(j / KOL);
          const x = sx * (KENAR + 2.1 + c * ADIM), zz = z + UST + r * SATIR;
          desk[a.id] = {x, z: zz, taraf, aisleZ: zz + 2.8, kenar: sx * (KENAR - 0.3), grup: g};
        });
        z += h + 0.4;
      }
      bos[taraf] = D / 2 - z;
    }
    return {zonlar, desk, D, bos};
  }

  /* ------------------------------------------------------------ dünya */
  function dunya(liste) {
    if (O.dunya) { O.sahne.remove(O.dunya); }
    const th = T(), L = yerlesim(liste), W = grup(0, 0, 0, O.sahne);
    O.dunya = W; O.L = L; O.desk = L.desk; O.slots = []; O.yan = {sol: [], sag: []}; O.moveObj = [];
    O.sahne.background = new THREE.Color(th.bg);
    O.hem.intensity = th.hem; O.dir.intensity = th.dir; O.hem.color.set(th.hemS); O.hem.groundColor.set(th.hemG); O.dir.color.set(th.dirC); O.fill.intensity = th.gun ? 0.22 : 0.12;
    const D = L.D, zN = -D / 2, zS = D / 2, XW = KENAR + GEN + 0.2;
    // zemin
    mesh(geo("BoxGeometry", XW * 2 + 1, 0.3, D + 1), mat(th.koridor), 0, -0.16, 0, W).castShadow = false;
    cevre(W, th, XW, D);
    const tahta = zeminTahta(th);
    const kor = new THREE.Mesh(geo("PlaneGeometry", KENAR * 2, D), new THREE.MeshLambertMaterial({map: tahta}));
    kor.rotation.x = -Math.PI / 2; kor.position.y = 0.012; kor.receiveShadow = true; W.add(kor);
    tahta.repeat.set(KENAR * 2 / 4, D / 4);
    for (const z of L.zonlar) {
      const c = new THREE.Color(z.renk).lerp(new THREE.Color(th.gun ? "#f4f1ea" : "#252a33"), th.gun ? 0.68 : 0.78);
      const ht = haliTex("#" + c.getHexString(), th.gun); ht.repeat.set((z.x1 - z.x0) / 3, (z.z1 - z.z0) / 3);
      const p = new THREE.Mesh(geo("PlaneGeometry", z.x1 - z.x0, z.z1 - z.z0), new THREE.MeshLambertMaterial({map: ht}));
      p.rotation.x = -Math.PI / 2; p.position.set((z.x0 + z.x1) / 2, 0.014, (z.z0 + z.z1) / 2); p.receiveShadow = true; W.add(p);
      zonEtiketi(W, z);
      // alçak bölme duvarları (dış + kat arası)
      const dis = z.taraf === "sol" ? z.x0 : z.x1;
      kutu(0.25, 1.1, z.z1 - z.z0, th.duvar, dis, 0.55, (z.z0 + z.z1) / 2, W);
      kutu(GEN, 0.9, 0.18, z.renk, (z.x0 + z.x1) / 2, 0.45, z.z1 + 0.2, W);
      // zemin üstüne renkli şerit (koridor tarafı)
      kutu(0.12, 0.05, z.z1 - z.z0, z.renk, z.taraf === "sol" ? z.x1 : z.x0, 0.03, (z.z0 + z.z1) / 2, W);
    }
    // kuzey (arka) duvar + pencereler
    kutu(XW * 2 + 0.6, 3.6, 0.35, th.duvar, 0, 1.8, zN - 0.2, W);
    kutu(XW * 2 + 0.6, 0.18, 0.5, th.duvarU, 0, 0.09, zN - 0.2, W);
    for (let x = -XW + 3.2; x < XW - 2; x += 5) {
      if (Math.abs(x) < 5) continue;
      kutu(3.4, 1.8, 0.05, th.cam, x, 2.0, zN + 0.0, W, {emissive: new THREE.Color(th.cam), emissiveIntensity: th.gun ? 0.5 : 0.18});
      kutu(3.6, 0.1, 0.12, "#555", x, 1.1, zN + 0.02, W);
    }
    for (const sx of [-1, 1]) kutu(0.35, 1.2, D + 0.5, th.duvar, sx * (XW + 0.1), 0.6, 0, W);
    kutu(XW * 2 + 0.6, 0.5, 0.25, th.duvar, 0, 0.25, zS + 0.35, W);
    // koridor mobilyası (iki şerit: |x| 1.5..3.0); yürüme şeridi x∈[-1.2,1.2] boş
    koridor(W, th, L);
    // masalar
    for (const a of liste) masa(W, th, a, L.desk[a.id]);
    // toplantı odası: boş kalan taraf
    const t = L.bos.sol >= L.bos.sag ? "sol" : "sag";
    if (Math.max(L.bos.sol, L.bos.sag) > 7.5) toplanti(W, th, t, D / 2 - L.bos[t], L.bos[t]);
    // canlı pano (TV)
    tv(W, zN);
    O.golge.target.position.set(0, 0, 0);
    O.golge.position.set(18, 38, 20);
    const kam = O.golge.shadow.camera, ek = Math.max(XW, D / 2) + 4;
    kam.left = -ek; kam.right = ek; kam.top = ek; kam.bottom = -ek; kam.updateProjectionMatrix();
  }

  /* dış çevre: çim, ağaçlar, çalılar, taş kenar (oyun hissi) */
  function cevre(W, th, XW, D) {
    const g = new THREE.Mesh(geo("PlaneGeometry", XW * 2 + 90, D + 90), new THREE.MeshLambertMaterial({map: cimTex(th)}));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.31; g.receiveShadow = true; W.add(g);
    kutu(XW * 2 + 1.6, 0.18, D + 1.6, th.gun ? "#b9bfca" : "#3a4150", 0, -0.22, 0, W).castShadow = false;
    const rnd = (n => () => (n = (n * 16807) % 2147483647) / 2147483647)(7);
    const agac = (x, z, s) => {
      const t = grup(x, -0.3, z, W); silin(0.28 * s, 0.4 * s, 2.2 * s, "#6b4a2b", 0, 1.1 * s, 0, t, 8);
      const yc = th.gun ? ["#3f9d55", "#4cae62", "#2f8a49"] : ["#1d4a33", "#245a3e", "#17402b"];
      kure(1.5 * s, yc[0], 0, 3.0 * s, 0, t); kure(1.1 * s, yc[1], 0.5 * s, 3.9 * s, 0.2 * s, t); kure(0.95 * s, yc[2], -0.5 * s, 3.5 * s, -0.3 * s, t);
    };
    const cali = (x, z, s) => { kure(0.7 * s, th.gun ? "#4aa65f" : "#1f5239", x, -0.05, z, W).scale.y = 0.75; kure(0.45 * s, th.gun ? "#5cbd72" : "#2a6445", x + 0.6 * s, -0.12, z + 0.2, W); };
    for (let z = -D / 2 - 6; z <= D / 2 + 1; z += 5.2) for (const sx of [-1, 1]) { agac(sx * (XW + 3.5 + rnd() * 5), z + rnd() * 2, 0.9 + rnd() * 0.7); if (rnd() > 0.4) cali(sx * (XW + 1.5 + rnd()), z + rnd() * 3, 0.8 + rnd() * 0.5); }
    for (let x = -XW - 2; x <= XW + 2; x += 6) agac(x + rnd() * 2, -D / 2 - 5 - rnd() * 4, 1 + rnd() * 0.8);
    for (let x = -XW + 2; x <= XW - 2; x += 4.5) if (Math.abs(x) > 2.5) cali(x, D / 2 + 2 + rnd() * 1.2, 0.8 + rnd() * 0.4);
    const yol = new THREE.Mesh(geo("PlaneGeometry", 3.2, 14), new THREE.MeshLambertMaterial({color: th.gun ? "#d8cfc0" : "#4a4640"})); yol.rotation.x = -Math.PI / 2; yol.position.set(0, -0.29, D / 2 + 7.4); yol.receiveShadow = true; W.add(yol);
  }
  function cimTex(th) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); g.fillStyle = th.cim; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 160; i++) { g.fillStyle = i % 2 ? th.cim2 : th.cim; g.globalAlpha = 0.55; g.fillRect(Math.random() * 128, Math.random() * 128, 3 + Math.random() * 6, 3 + Math.random() * 6); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20, 20); return t;
  }
  function haliTex(hex, gun) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), b = new THREE.Color(hex);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const k = b.clone().offsetHSL(0, 0, ((x + y) % 2 ? 0.025 : -0.025) + (Math.sin(x * 12.9 + y * 78.2) * 0.012)); g.fillStyle = "#" + k.getHexString(); g.fillRect(x * 16, y * 16, 16, 16); }
    g.strokeStyle = gun ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.05)"; g.lineWidth = 1; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16, 128); g.moveTo(0, i * 16); g.lineTo(128, i * 16); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function zeminTahta(th) {
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    const bz = new THREE.Color(th.koridor);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) { const x0 = ((i * 97) % 256) + (k - 1) * 128; g.fillStyle = "#" + bz.clone().offsetHSL(0, 0, Math.sin(i * 7.3 + k * 3.1) * 0.035).getHexString(); g.fillRect(x0, i * 64, 128, 64); }
    g.strokeStyle = th.cizgi; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); }
    for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) { g.beginPath(); g.moveTo((i * 97 + k * 128) % 256, i * 64); g.lineTo((i * 97 + k * 128) % 256, i * 64 + 64); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  function zonEtiketi(W, z) {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 128; const g = c.getContext("2d");
    g.font = "700 64px system-ui,sans-serif"; g.fillStyle = z.renk; g.globalAlpha = 0.85; g.textBaseline = "middle";
    g.fillText(z.baslik, 10, 66);
    const tx = new THREE.CanvasTexture(c); tx.anisotropy = 4;
    const p = new THREE.Mesh(geo("PlaneGeometry", 10.5, 1.3), new THREE.MeshBasicMaterial({map: tx, transparent: true, depthWrite: false}));
    p.rotation.x = -Math.PI / 2; p.position.set(z.x0 + 5.8, 0.02, z.z0 + 0.9); W.add(p);
  }

  /* masa + sandalye + dekor */
  function masa(W, th, a, d) {
    if (!d) return;
    const G = grup(d.x, 0, d.z, W), yon = ["mudur", "yonetici"].includes(a.id), lab = a.grup === "arge";
    const ust = yon ? "#4a3626" : lab ? th.beyaz : th.masa;
    G.userData.ajan = a.id; O.moveObj.push(G);
    const gen = yon ? 2.7 : 2.3;
    kutu(gen, 0.08, 1.1, ust, 0, 0.76, 0, G);
    for (const sx of [-1, 1]) kutu(0.08, 0.74, 1.0, lab ? "#9aa5b5" : "#444c59", sx * (gen / 2 - 0.1), 0.37, 0, G);
    kutu(gen - 0.2, 0.5, 0.05, lab ? "#9aa5b5" : "#444c59", 0, 0.5, -0.45, G);
    // monitör (ekran oyuncuya bakar: +z)
    const mg = grup(0, 0.8, -0.25, G);
    kutu(0.12, 0.28, 0.1, "#222", 0, 0.14, 0, mg); kutu(0.5, 0.04, 0.3, "#222", 0, 0.02, 0, mg);
    kutu(1.05, 0.62, 0.06, "#111827", 0, 0.58, 0, mg);
    const ek = new THREE.MeshBasicMaterial({color: 0x1e293b});
    const ekran = new THREE.Mesh(geo("PlaneGeometry", 0.96, 0.53), ek); ekran.position.set(0, 0.58, 0.034); mg.add(ekran);
    // klavye + fare + kupa
    kutu(0.7, 0.03, 0.22, "#1f2937", 0, 0.8, 0.28, G); kutu(0.1, 0.03, 0.14, "#111", 0.55, 0.8, 0.3, G);
    silin(0.06, 0.05, 0.1, a.renk, -0.85, 0.85, 0.15, G, 10);
    // masa bayrağı (kimlik rengi)
    silin(0.015, 0.015, 0.7, "#888", gen / 2 - 0.2, 1.1, -0.35, G, 6); kutu(0.32, 0.2, 0.02, a.renk, gen / 2 - 0.02, 1.35, -0.35, G);
    const hh = [...a.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 3;
    if (!yon) {
      if (hh === 0) { silin(0.07, 0.055, 0.1, "#b45309", 0.95, 0.85, -0.2, G, 8); kure(0.12, "#22a55a", 0.95, 1.0, -0.2, G); }
      else if (hh === 1) { kutu(0.2, 0.26, 0.03, "#fef3c7", 0.95, 0.94, -0.3, G).rotation.x = -0.15; kutu(0.15, 0.2, 0.035, a.renk, 0.95, 0.94, -0.28, G).rotation.x = -0.15; }
      else { silin(0.02, 0.02, 0.36, "#555", 0.95, 0.98, -0.2, G, 6); kutu(0.22, 0.04, 0.16, "#fde68a", 0.95, 1.18, -0.15, G, {emissive: new THREE.Color("#fde68a"), emissiveIntensity: 0.4}); }
    }
    // sandalye
    const ch = grup(0, 0, 0.95, G); ch.userData.sandalye = true;
    silin(0.3, 0.3, 0.07, th.gun ? "#475569" : "#2b3442", 0, 0.47, 0, ch, 16); kutu(0.55, 0.62, 0.08, th.gun ? "#475569" : "#2b3442", 0, 0.85, 0.28, ch);
    silin(0.04, 0.04, 0.4, "#222", 0, 0.25, 0, ch, 6); silin(0.28, 0.28, 0.03, "#222", 0, 0.03, 0, ch, 8);
    // role özel
    const id = a.id;
    if (id === "seslendirici") { silin(0.02, 0.02, 0.55, "#111", -0.7, 1.05, 0.1, G, 6); kure(0.07, "#222", -0.7, 1.36, 0.1, G); }
    if (id === "yonetmen") { kutu(0.3, 0.2, 0.22, "#111", -0.75, 0.9, 0.15, G); silin(0.07, 0.07, 0.16, "#333", -0.75, 0.9, 0.32, G).rotation.x = Math.PI / 2; kutu(0.3, 0.12, 0.03, "#f8fafc", 0.8, 0.82, 0.25, G); }
    if (id === "montajci") { kutu(0.9, 0.5, 0.05, "#111827", -1.15, 1.1, -0.15, G).rotation.y = 0.5; }
    if (id === "editor" || id === "senarist") { kutu(0.3, 0.04, 0.4, "#f8fafc", -0.8, 0.82, 0.2, G); kutu(0.28, 0.04, 0.38, "#e5e7eb", -0.78, 0.86, 0.22, G).rotation.y = 0.2; }
    if (id === "onay") { kutu(0.5, 0.1, 0.35, "#92400e", -0.8, 0.82, 0.1, G); kutu(0.42, 0.05, 0.28, "#f8fafc", -0.8, 0.9, 0.1, G); }
    if (id === "gelir") { for (let k = 0; k < 4; k++) silin(0.09, 0.09, 0.025, "#facc15", -0.8, 0.82 + k * 0.03, 0.2, G, 12); }
    if (lab) for (const [x, c] of [[-0.85, "#38bdf8"], [-0.65, "#a3e635"], [0.9, "#f472b6"]]) { silin(0.07, 0.07, 0.2, "#e2e8f0", x, 0.9, 0.2, G, 10); silin(0.06, 0.06, 0.1, c, x, 0.86, 0.2, G, 10); }
    if (yon) { silin(0.03, 0.03, 0.4, "#555", 1.0, 0.98, -0.2, G, 6); kutu(0.3, 0.05, 0.2, "#fbbf24", 1.0, 1.22, -0.2, G, {emissive: new THREE.Color("#fbbf24"), emissiveIntensity: 0.6}); }
    O.ag[a.id] && (O.ag[a.id].ekranMat = ek);
    G.userData.ek = ek; G.userData.ajanId = a.id;
  }

  /* koridor / dinlenme alanı */
  function koridor(W, th, L) {
    const D = L.D, zN = -D / 2 + 3.5, zS = D / 2 - 2;
    const sol = [], sag = [];
    const sofa = (x, z, yon, renk) => {
      const g = grup(x, 0, z, W); g.rotation.y = yon;           // yon: oturanların baktığı yön
      kutu(1.0, 0.45, 2.5, renk, 0, 0.3, 0, g); kutu(0.25, 0.55, 2.5, renk, -0.42, 0.75, 0, g);
      for (const s of [-1, 1]) kutu(1.0, 0.3, 0.2, renk, 0, 0.55, s * 1.25, g);
      return g;
    };
    const kahve = (x, z) => {
      const g = grup(x, 0, z, W);
      kutu(0.9, 0.9, 1.7, th.masa, 0, 0.45, 0, g); kutu(0.7, 1.2, 0.55, "#1f2937", 0, 1.5, -0.45, g);
      kutu(0.5, 0.06, 0.05, "#fb923c", 0.0, 1.7, -0.15, g, {emissive: new THREE.Color("#fb923c"), emissiveIntensity: 0.9});
      silin(0.05, 0.05, 0.1, "#f8fafc", 0, 0.95, 0.2, g, 8);
    };
    const su = (x, z) => { const g = grup(x, 0, z, W); kutu(0.5, 0.9, 0.5, "#e2e8f0", 0, 0.45, 0, g); silin(0.22, 0.22, 0.55, "#60a5fa", 0, 1.15, 0, g, 12).material = mat("#60a5fa", {transparent: true, opacity: 0.7}); };
    const bitki = (x, z, s = 1, p = W) => { const g = grup(x, 0, z, p); silin(0.3 * s, 0.22 * s, 0.5 * s, "#a16207", 0, 0.25 * s, 0, g, 10);
      for (const [dx, dy, dz, r] of [[0, 0.9, 0, 0.42], [0.18, 0.7, 0.1, 0.3], [-0.2, 0.75, -0.1, 0.32]]) kure(r * s, "#22a55a", dx * s, dy * s, dz * s, g); };
    const pinpon = (x, z) => {
      const g = grup(x, 0, z, W);
      kutu(1.5, 0.08, 2.7, "#15803d", 0, 0.76, 0, g); kutu(1.5, 0.09, 0.04, "#f8fafc", 0, 0.76, 0, g); kutu(0.03, 0.09, 2.7, "#f8fafc", 0, 0.77, 0, g);
      kutu(1.6, 0.16, 0.03, "#e5e7eb", 0, 0.88, 0, g);
      for (const sx of [-0.65, 0.65]) for (const sz of [-1.2, 1.2]) kutu(0.07, 0.72, 0.07, "#374151", sx, 0.36, sz, g);
      O.top = kure(0.04, "#fff", x, 0.9, z, W); O.top.userData = {x, z};
    };
    const puf = (x, z, c) => { const m = kure(0.5, c, x, 0.28, z, W); m.scale.set(1, 0.6, 1); };
    const rafi = (x, z) => { const g = grup(x, 0, z, W); kutu(1.8, 2.2, 0.45, th.masa, 0, 1.1, 0, g);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) kutu(0.18, 0.4, 0.3, ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7"][(r * 3 + k) % 5], -0.75 + k * 0.25, 0.4 + r * 0.5, 0.05, g); };
    const slot = (x, z, yaw, tip, otur, ek = {}) => O.slots.push({x, z, yaw, tip, otur, dolu: null, ...ek});
    const aralik = (n, a, b) => Array.from({length: n}, (_, i) => a + (b - a) * (i + 0.5) / n);
    // sol şerit: rafı, kanepe, pinpon, puflar, bitki
    const zl = aralik(4, zN, zS);
    rafi(-2.9, zN - 0.2); sol.push({z: zN - 0.2, h: 1.2});
    sofa(-2.35, zl[0] + 0.4, Math.PI / 2, "#6366f1");
    for (const k of [-0.8, 0, 0.8]) slot(-2.2, zl[0] + 0.4 + k, Math.PI / 2, "kanepe", true);
    sol.push({z: zl[0] + 0.4, h: 1.7});
    pinpon(-2.2, zl[1]); slot(-2.2, zl[1] - 1.75, 0, "oyun", false); slot(-2.2, zl[1] + 1.75, Math.PI, "oyun", false); sol.push({z: zl[1], h: 1.9});
    const pc = ["#f43f5e", "#f59e0b", "#14b8a6"];
    [[-2.5, zl[2] - 0.6], [-1.9, zl[2] + 0.4], [-2.7, zl[2] + 1.2]].forEach(([x, z], i) => { puf(x, z, pc[i]); slot(x + 0.1, z, Math.PI / 2, "puf", true, {alcak: 0.18}); });
    sol.push({z: zl[2] + 0.3, h: 1.7});
    bitki(-2.7, zl[3], 1.3); sol.push({z: zl[3], h: 0.9});
    // sağ şerit: kahve, su, bitki, kanepe, bitki
    const zr = aralik(4, zN, zS);
    kahve(2.6, zr[0]); slot(1.6, zr[0] - 0.4, -Math.PI / 2, "kahve", false); slot(1.6, zr[0] + 0.5, -Math.PI / 2, "kahve", false); sag.push({z: zr[0], h: 1.9});
    su(2.7, zr[0] + 1.6); slot(1.7, zr[0] + 1.6, -Math.PI / 2, "su", false); sag.push({z: zr[0] + 1.6, h: 0.7});
    bitki(2.6, zr[1], 1.2); sag.push({z: zr[1], h: 0.9});
    sofa(2.35, zr[2], -Math.PI / 2, "#0ea5e9");
    for (const k of [-0.8, 0, 0.8]) slot(2.2, zr[2] + k, -Math.PI / 2, "kanepe", true);
    sag.push({z: zr[2], h: 1.8});
    bitki(2.7, zr[3], 1.0); bitki(2.7, zr[3] + 1.0, 0.8); sag.push({z: zr[3] + 0.5, h: 1.6});
    // yuvarlak halı
    for (const [x, z, r] of [[-2.0, zl[0] + 0.4, 1.7], [2.0, zr[2], 1.7]]) { const h = silin(r, r, 0.02, th.gun ? "#fbbf24" : "#5b4a1e", x, 0.025, z, W, 32); h.castShadow = false; }
    // geçiş boşlukları: öğeler arası orta noktalar
    const bosluk = (arr) => { const s = [...arr].sort((a, b) => a.z - b.z), out = [];
      for (let i = 0; i < s.length - 1; i++) { const m = (s[i].z + s[i].h / 2 + s[i + 1].z - s[i + 1].h / 2) / 2; if (s[i + 1].z - s[i + 1].h / 2 - (s[i].z + s[i].h / 2) > 0.9) out.push(m); }
      return out.length ? out : [zS + 1]; };
    O.yan = {sol: bosluk(sol), sag: bosluk(sag)};
    O.sol = sol;
  }

  function toplanti(W, th, taraf, z0, h) {
    const sx = taraf === "sol" ? -1 : 1, cx = sx * (KENAR + GEN / 2), cz = z0 + h / 2 - 0.2;
    const c = new THREE.Color("#94a3b8").lerp(new THREE.Color(th.gun ? "#f4f1ea" : "#252a33"), th.gun ? 0.8 : 0.75);
    const p = new THREE.Mesh(geo("PlaneGeometry", GEN, h - 0.8), new THREE.MeshLambertMaterial({color: c})); p.rotation.x = -Math.PI / 2; p.position.set(cx, 0.014, cz); p.receiveShadow = true; W.add(p);
    zonEtiketi(W, {x0: cx - GEN / 2, z0: cz - (h - 0.8) / 2 + 0.1, renk: "#64748b", baslik: "TOPLANTI ODASI"});
    kutu(GEN, 1.1, 0.2, th.duvar, cx, 0.55, z0 + h - 0.2, W); kutu(0.25, 1.1, h, th.duvar, sx * (KENAR + GEN), 0.55, z0 + h / 2, W);
    kutu(5.6, 0.1, 1.6, "#6b4f3a", cx, 0.76, cz + 0.3, W); kutu(0.5, 0.7, 1.2, "#4b3829", cx - 1.6, 0.4, cz + 0.3, W); kutu(0.5, 0.7, 1.2, "#4b3829", cx + 1.6, 0.4, cz + 0.3, W);
    kutu(2.4, 1.3, 0.06, "#0f172a", cx, 1.5, z0 + h - 0.35, W, {emissive: new THREE.Color("#1e3a8a"), emissiveIntensity: 0.5});
    for (const k of [-2, 0, 2]) for (const s of [-1, 1]) {
      const g = grup(cx + k * 1.0 + (k === 0 ? 0 : 0), 0, cz + 0.3 + s * 1.2, W);
      silin(0.28, 0.28, 0.07, "#475569", 0, 0.47, 0, g, 12); kutu(0.5, 0.55, 0.07, "#475569", 0, 0.8, s * 0.26, g); silin(0.04, 0.04, 0.4, "#222", 0, 0.25, 0, g, 6);
      O.slots.push({x: cx + k * 1.0, z: cz + 0.3 + s * 1.15, yaw: s > 0 ? Math.PI : 0, tip: "toplanti", otur: true, dolu: null, masaOn: true});
    }
  }

  function tv(W, zN) {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 512; O.tvCv = c; O.tvTx = new THREE.CanvasTexture(c);
    kutu(7.2, 3.4, 0.2, "#0b0f16", 0, 2.1, zN + 0.08, W);
    const p = new THREE.Mesh(geo("PlaneGeometry", 6.9, 3.1), new THREE.MeshBasicMaterial({map: O.tvTx})); p.position.set(0, 2.1, zN + 0.2); W.add(p);
    O.tvKey = "";
  }
  function tvCiz() {
    const c = O.tvCv; if (!c) return;
    const olaylar = (V.canli || []).slice(-6).reverse(), s = trSaat();
    const anahtar = olaylar.map(o => o.t + o.mesaj).join("|") + s.s + ":" + s.d;
    if (anahtar === O.tvKey) return; O.tvKey = anahtar;
    const g = c.getContext("2d");
    g.fillStyle = "#0b1220"; g.fillRect(0, 0, 1024, 512);
    g.fillStyle = "#1e3a8a"; g.fillRect(0, 0, 1024, 84);
    g.font = "700 46px system-ui,sans-serif"; g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText("GLOBAL SAYAR · CANLI AKIŞ", 28, 44);
    g.textAlign = "right"; g.fillText(`${String(s.s).padStart(2, "0")}:${String(s.d).padStart(2, "0")}`, 996, 44); g.textAlign = "left";
    g.font = "600 34px system-ui,sans-serif";
    if (!olaylar.length) { g.fillStyle = "#94a3b8"; g.fillText("Henüz olay yok — ajanlar beklemede", 28, 160); }
    olaylar.forEach((o, i) => {
      const y = 130 + i * 62;
      g.fillStyle = o.durum === "hata" ? "#f87171" : o.durum === "bitti" ? "#4ade80" : "#38bdf8";
      g.beginPath(); g.arc(44, y, 11, 0, 7); g.fill();
      g.fillStyle = "#e2e8f0"; const m = `${o.ajan}: ${o.mesaj}`; g.fillText(m.length > 52 ? m.slice(0, 51) + "…" : m, 72, y);
    });
    O.tvTx.needsUpdate = true;
  }

  /* ------------------------------------------------------------ karakter */
  function karakter(a, i) {
    const R = grup(0, 0, 0), ten = TEN[i % TEN.length], P = {};
    const govde = grup(0, 0, 0, R); P.govde = govde;
    const pant = ["#334155", "#1f2937", "#3f3f46", "#44403c"][i % 4], id = a.id;
    P.torso = silin(0.25, 0.29, 0.62, a.renk, 0, 1.06, 0, govde, 14);
    if (id === "deneyci") { silin(0.28, 0.33, 0.9, "#f8fafc", 0, 0.98, 0, govde, 14); }
    P.bacak = [];
    for (const sx of [-1, 1]) {
      const th = grup(sx * 0.12, 0.76, 0, govde), sh = grup(0, -0.4, 0, th);
      kutu(0.17, 0.4, 0.19, pant, 0, -0.2, 0, th); kutu(0.15, 0.38, 0.17, pant, 0, -0.19, 0, sh); kutu(0.18, 0.09, 0.3, "#111827", 0, -0.42, 0.05, sh);
      P.bacak.push({th, sh});
    }
    P.kol = [];
    for (const sx of [-1, 1]) {
      const k = grup(sx * 0.34, 1.32, 0, govde);
      silin(0.07, 0.065, 0.56, a.renk, 0, -0.27, 0, k, 8); kure(0.075, ten, 0, -0.57, 0, k);
      P.kol.push(k);
    }
    P.bas = grup(0, 1.62, 0, govde);
    kure(0.22, ten, 0, 0, 0, P.bas);
    for (const sx of [-1, 1]) { kure(0.026, "#111827", sx * 0.08, 0.02, 0.2, P.bas); kure(0.04, ten, sx * 0.22, 0, 0, P.bas); }
    kutu(0.07, 0.02, 0.02, "#7c2d12", 0, -0.08, 0.205, P.bas);
    const sac = a.sac || "#444", stil = i % 4;
    const sc = mesh(geo("SphereGeometry", 0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), mat(sac), 0, 0.02, -0.02, P.bas); sc.rotation.x = -0.25;
    if (stil === 1) kure(0.09, sac, 0, 0.24, -0.08, P.bas);
    if (stil === 2) { kutu(0.07, 0.34, 0.14, sac, -0.21, -0.1, -0.04, P.bas); kutu(0.07, 0.34, 0.14, sac, 0.21, -0.1, -0.04, P.bas); }
    if (stil === 3) for (let k = -2; k <= 2; k++) kure(0.07, sac, k * 0.085, 0.2, -0.02, P.bas);
    if (["yonetici", "mudur", "gelir", "arge_lider"].includes(id)) { const k = kutu(0.07, 0.34, 0.03, id === "gelir" ? "#facc15" : "#b91c1c", 0, 1.08, 0.26, govde); k.rotation.x = -0.05; }
    if (["editor", "strateji", "arastirmaci", "deneyci"].includes(id)) for (const sx of [-1, 1]) { const t = mesh(geo("TorusGeometry", 0.06, 0.012, 6, 14), mat("#0f172a"), sx * 0.08, 0.03, 0.215, P.bas); }
    if (id === "seslendirici") { const t = mesh(geo("TorusGeometry", 0.235, 0.02, 6, 16, Math.PI), mat("#111827"), 0, 0.02, 0, P.bas); t.rotation.z = 0; for (const sx of [-1, 1]) kutu(0.07, 0.14, 0.12, "#111827", sx * 0.235, 0, 0, P.bas); }
    if (id === "yonetmen") { silin(0.2, 0.22, 0.09, "#1f2937", 0.01, 0.2, 0, P.bas, 14); kutu(0.2, 0.025, 0.2, "#1f2937", 0, 0.17, 0.2, P.bas); }
    // el kupası (kahve ve içme için)
    P.kupa = silin(0.045, 0.04, 0.1, "#f8fafc", 0, -0.62, 0.05, P.kol[1], 8); P.kupa.visible = false;
    R.traverse(o => { o.userData.ajanId = a.id; });
    return {R, P};
  }

  /* ------------------------------------------------------------ etiket (sprite) */
  function etiket(A, a) {
    const bal = (O.secili === a.id || a.aktif) && a.balon ? String(a.balon).slice(0, 70) : "";
    const k = [A.emoji, a.ad, a.aktif, a.rozet || 0, bal, O.secili === a.id, koyuMu()].join("|");
    if (A.eKey === k) return; A.eKey = k;
    const c = A.cv, g = c.getContext("2d"), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H); g.textBaseline = "middle";
    // balon
    let y0 = 0;
    if (bal) {
      g.font = "500 26px system-ui,sans-serif";
      const satirlar = []; let s = "";
      for (const w of bal.split(" ")) { if (g.measureText(s + " " + w).width > 400 && s) { satirlar.push(s); s = w; } else s = (s ? s + " " : "") + w; }
      satirlar.push(s); const L = satirlar.slice(0, 3), bh = 18 + L.length * 32;
      g.fillStyle = "rgba(255,255,255,.96)"; g.strokeStyle = a.renk; g.lineWidth = 3;
      g.beginPath(); g.roundRect(30, 6, 452, bh, 18); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(236, 6 + bh); g.lineTo(256, 6 + bh + 16); g.lineTo(276, 6 + bh); g.fillStyle = "rgba(255,255,255,.96)"; g.fill();
      g.fillStyle = "#111827"; L.forEach((t, i) => g.fillText(t, 46, 6 + 26 + i * 32));
      y0 = bh + 22;
    }
    const ad = a.ad + (A.emoji ? "  " + A.emoji : ""); g.font = "700 30px system-ui,sans-serif";
    const w = Math.min(g.measureText(ad).width + 74, 500), x = (W - w) / 2, y = H - 56;
    g.fillStyle = O.secili === a.id ? a.renk : "rgba(15,23,42,.88)"; g.beginPath(); g.roundRect(x, y, w, 46, 23); g.fill();
    g.fillStyle = a.aktif ? "#4ade80" : "#94a3b8"; g.beginPath(); g.arc(x + 24, y + 23, 8, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.fillText(ad, x + 42, y + 24);
    if (a.rozet) { g.fillStyle = "#ef4444"; g.beginPath(); g.arc(x + w - 6, y + 4, 17, 0, 7); g.fill(); g.fillStyle = "#fff"; g.font = "700 22px system-ui"; g.textAlign = "center"; g.fillText(String(a.rozet), x + w - 6, y + 5); g.textAlign = "left"; }
    A.tx.needsUpdate = true;
  }

  /* ------------------------------------------------------------ ajan senkron */
  function senkron(liste) {
    const imza = liste.map(a => a.id + a.grup + a.renk).join(",") + "|" + koyuMu();
    const yeniden = imza !== O.imza;
    if (yeniden) {
      for (const id of Object.keys(O.ag)) if (!liste.some(a => a.id === id)) { O.sahne.remove(O.ag[id].R); O.sahne.remove(O.ag[id].spr); O.sahne.remove(O.ag[id].pb); delete O.ag[id]; }
      O.imza = imza; O.slotSifirla = true;
      for (const a of liste) {
        let A = O.ag[a.id];
        if (!A) {
          const i = Object.keys(O.ag).length, {R, P} = karakter(a, i + liste.indexOf(a));
          const cv = document.createElement("canvas"); cv.width = 512; cv.height = 240;
          const tx = new THREE.CanvasTexture(cv); tx.anisotropy = 4;
          const spr = new THREE.Sprite(new THREE.SpriteMaterial({map: tx, transparent: true, depthTest: false}));
          spr.renderOrder = 10; spr.center.set(0.5, 0.0);
          const pb = new THREE.Mesh(geo("OctahedronGeometry", 0.13), new THREE.MeshBasicMaterial({color: 0x4ade80, transparent: true, opacity: 0.92})); pb.scale.y = 1.7; O.sahne.add(pb);
          O.sahne.add(R, spr);
          A = O.ag[a.id] = {id: a.id, R, P, cv, tx, spr, pb, durum: "masa", yol: [], sonraki: O.t0 + rastgele(5, 25), faz: Math.random() * 6, slot: null, yaw: Math.PI, pos: new THREE.Vector3()};
          const d = O.desk[a.id]; if (d) { A.pos.set(d.x, 0, d.z + 0.95); R.position.copy(A.pos); R.rotation.y = Math.PI; }
        }
        A.eKey = "";
      }
      dunya(liste);
      for (const a of liste) { const A = O.ag[a.id], d = O.desk[a.id]; if (A && d && A.durum === "masa") { A.pos.set(d.x, 0, d.z + 0.95); } if (A) { A.slot = null; if (A.durum !== "masa") { A.durum = "masa"; A.yol = []; } } }
    }
    for (const a of liste) { const A = O.ag[a.id]; if (A) A.a = a; }
    return yeniden;
  }

  /* ------------------------------------------------------------ hareket */
  const HIZ = 1.8;
  function yolKur(A, slot, geri) {
    const d = O.desk[A.id]; if (!d) return [];
    const gaps = O.yan[d.taraf], gz = gaps.reduce((b, z) => Math.abs(z - d.aisleZ) < Math.abs(b - d.aisleZ) ? z : b, gaps[0]);
    const sx = d.taraf === "sol" ? -1 : 1, kx = sx * (KENAR - 0.4), ax = sx * (KENAR + 0.1);
    const p = [{x: d.x, z: d.z + 1.9}, {x: d.x, z: d.aisleZ}, {x: ax, z: d.aisleZ}];
    if (Math.abs(gz - d.aisleZ) > 0.2) p.push({x: ax, z: gz});
    p.push({x: 0, z: gz}, {x: 0, z: slot.z}, {x: slot.x, z: slot.z});
    if (slot.masaOn) { p.splice(p.length - 2, 2, {x: slot.x < 0 ? slot.x : slot.x, z: slot.z}); }
    return geri ? p.reverse().slice(1).concat([{x: d.x, z: d.z + 0.95}]) : p;
  }
  function git(A, slot) { slot.dolu = A.id; A.slot = slot; A.durum = "gidis"; A.yol = yolKur(A, slot, false); A.kalk = true; }
  function eve(A) {
    if (A.slot) { const s = A.slot; A.yol = yolKur(A, s, true); s.dolu = null; A.slot = null; }
    else A.yol = A.yol.length ? A.yol : [{x: O.desk[A.id].x, z: O.desk[A.id].z + 0.95}];
    A.durum = "donus";
  }

  function hareket(A, dt, t) {
    const a = A.a, d = O.desk[A.id]; if (!a || !d) return;
    const R = A.R, P = A.P;
    let poz = "masa", yurur = false;
    // karar
    if (A.durum === "masa") {
      if (!a.aktif && t > A.sonraki && !AZ_HAREKET) {
        const bos = O.slots.filter(s => !s.dolu);
        if (bos.length && Math.random() < 0.85) git(A, bos[Math.random() * bos.length | 0]);
        else A.sonraki = t + rastgele(8, 20);
      }
    } else if (A.durum === "poi") {
      if (a.aktif || t > A.bekle) eve(A);
    } else if (A.durum === "gidis" && a.aktif) {
      // hedefe giderken iş geldi: yeni slotu bırak, evi sür
      if (A.slot) { A.slot.dolu = null; A.slot = null; }
      A.durum = "donus"; A.yol = [{x: d.x, z: d.aisleZ}, {x: d.x, z: d.z + 0.95}];
    }
    // yürüme
    if ((A.durum === "gidis" || A.durum === "donus") && A.yol.length) {
      const h = A.yol[0], dx = h.x - A.pos.x, dz = h.z - A.pos.z, m = Math.hypot(dx, dz), adim = HIZ * dt;
      if (m <= adim) { A.pos.x = h.x; A.pos.z = h.z; A.yol.shift(); }
      else { A.pos.x += dx / m * adim; A.pos.z += dz / m * adim; const hy = Math.atan2(dx, dz); let df = hy - A.yaw; df = Math.atan2(Math.sin(df), Math.cos(df)); A.yaw += df * Math.min(1, dt * 9); }
      yurur = true;
      if (!A.yol.length) {
        if (A.durum === "gidis") { A.durum = "poi"; A.bekle = t + rastgele(12, 32); A.yaw = A.slot.yaw; }
        else { A.durum = "masa"; A.yaw = Math.PI; A.sonraki = t + rastgele(10, 40); }
      }
    }
    let oturuyor = false, y = 0;
    if (A.durum === "masa") { oturuyor = true; y = 0; poz = a.aktif ? "yaz" : "bos"; A.yaw = lerpAci(A.yaw, Math.PI, dt * 6); }
    if (A.durum === "poi") { const s = A.slot; poz = s.tip; oturuyor = s.otur; y = s.alcak ? -s.alcak : 0; A.yaw = lerpAci(A.yaw, s.yaw, dt * 6); }
    // poz uygula
    R.position.set(A.pos.x, 0, A.pos.z); R.rotation.y = A.yaw;
    const f = A.faz, sal = Math.sin(t * 9 + f);
    const koltuk = oturuyor ? -0.32 + (y || 0) : 0;
    P.govde.position.y = lerp(P.govde.position.y, koltuk + (yurur ? Math.abs(sal) * 0.03 : 0), Math.min(1, dt * 10));
    P.kupa.visible = poz === "kahve" || poz === "su";
    for (const b of P.bacak) {
      const s = b === P.bacak[0] ? 1 : -1;
      if (oturuyor) { b.th.rotation.x = -Math.PI / 2 + 0.05; b.sh.rotation.x = Math.PI / 2; }
      else if (yurur) { b.th.rotation.x = sal * 0.7 * s; b.sh.rotation.x = Math.max(0, -sal * s) * 0.8; }
      else { b.th.rotation.x = 0; b.sh.rotation.x = 0; }
    }
    const [kL, kR] = P.kol;
    if (yurur) { kL.rotation.x = -sal * 0.6; kR.rotation.x = sal * 0.6; kL.rotation.z = kR.rotation.z = 0; }
    else if (poz === "yaz") { const k = Math.sin(t * 17 + f) * 0.12, k2 = Math.sin(t * 14 + f) * 0.12; kL.rotation.x = -1.35 + k; kR.rotation.x = -1.35 + k2; kL.rotation.z = 0.08; kR.rotation.z = -0.08; }
    else if (poz === "bos") { kL.rotation.x = -0.5 + Math.sin(t + f) * 0.05; kR.rotation.x = -0.5; kL.rotation.z = 0.1; kR.rotation.z = -0.1; }
    else if (poz === "kahve" || poz === "su") { kL.rotation.x = -0.2; kL.rotation.z = 0.1; kR.rotation.x = -1.7 + Math.sin(t * 1.4 + f) * 0.15; kR.rotation.z = -0.15; }
    else if (poz === "oyun") { kL.rotation.x = -0.9; kR.rotation.x = -1.2 + Math.sin(t * 7 + f) * 0.5; kL.rotation.z = 0.1; kR.rotation.z = -0.1; }
    else if (poz === "toplanti") { kL.rotation.x = -0.8; kR.rotation.x = -0.4 + Math.sin(t * 3 + f) * 0.4; kL.rotation.z = 0.1; kR.rotation.z = -0.1; }
    else { kL.rotation.x = -0.3; kR.rotation.x = -0.3; kL.rotation.z = 0.12; kR.rotation.z = -0.12; }
    A.emoji = yurur ? "🚶" : ({yaz: "⌨️", bos: "💤", kahve: "☕", su: "💧", oyun: "🏓", kanepe: "🛋️", puf: "😌", toplanti: "💬"})[poz] || "";
    // baş: boştayken etrafa bakınır
    P.bas.rotation.y = poz === "yaz" ? Math.sin(t * 0.7 + f) * 0.08 : Math.sin(t * 0.6 + f) * 0.5;
    P.bas.rotation.x = poz === "yaz" ? 0.12 : 0;
    // masa ekranı
    const sk = O.desk[A.id], g = sk && O.dunya.children.find(c => c.userData.ajanId === A.id && c.userData.ek);
    if (g) { const e = g.userData.ek; const acik = a.aktif; e.color.setHex(acik ? 0x38bdf8 : 0x1e293b); if (acik) e.color.offsetHSL(0, 0, Math.sin(t * 6 + f) * 0.06); }
  }
  const lerpAci = (a, b, f) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * Math.min(1, f); };

  /* ------------------------------------------------------------ kamera / giriş */
  function kameraUygula() {
    const c = O.cam, cam = O.kamera, sp = Math.sin(c.kutup), cp = Math.cos(c.kutup);
    cam.position.set(c.tx + c.uzak * sp * Math.sin(c.az), c.ty + c.uzak * cp, c.tz + c.uzak * sp * Math.cos(c.az));
    cam.lookAt(c.tx, c.ty, c.tz);
  }
  const sinir = () => ({x: KENAR + GEN, z: (O.L?.D || 28) / 2});
  function girdi(cv) {
    const ptr = new Map(); let hareketMesafe = 0, baslangic = null, pinch = 0;
    cv.style.touchAction = "none";
    cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, {x: e.clientX, y: e.clientY}); hareketMesafe = 0; baslangic = {x: e.clientX, y: e.clientY}; O.odak = null;
      if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
    cv.addEventListener("pointermove", e => {
      const p = ptr.get(e.pointerId);
      if (!p) { O.fare = {x: e.clientX, y: e.clientY}; return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; hareketMesafe += Math.abs(dx) + Math.abs(dy);
      const c = O.cam;
      if (ptr.size === 2) {
        p.x = e.clientX; p.y = e.clientY; const [a, b] = [...ptr.values()], m = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) c.uzak = Math.max(10, Math.min(120, c.uzak * pinch / m)); pinch = m; kaydir(dx / 2, dy / 2);
      } else if (e.buttons & 2 || e.shiftKey || e.ctrlKey) { kaydir(dx, dy); p.x = e.clientX; p.y = e.clientY; }
      else { c.az -= dx * 0.006; c.kutup = Math.max(0.08, Math.min(1.35, c.kutup - dy * 0.005)); p.x = e.clientX; p.y = e.clientY; }
    });
    const bit = e => {
      const var_ = ptr.delete(e.pointerId); pinch = 0;
      if (var_ && hareketMesafe < 8 && ptr.size === 0 && e.type === "pointerup") sec(isabet(e.clientX, e.clientY));
    };
    cv.addEventListener("pointerup", bit); cv.addEventListener("pointercancel", bit);
    cv.addEventListener("contextmenu", e => e.preventDefault());
    cv.addEventListener("wheel", e => { e.preventDefault(); O.cam.uzak = Math.max(10, Math.min(120, O.cam.uzak * (1 + Math.sign(e.deltaY) * 0.1))); O.odak = null; }, {passive: false});
  }
  function kaydir(dx, dy) {
    const c = O.cam, k = c.uzak * 0.0017, s = sinir();
    const rx = Math.cos(c.az), rz = -Math.sin(c.az), fx = -Math.sin(c.az), fz = -Math.cos(c.az);
    c.tx = Math.max(-s.x, Math.min(s.x, c.tx - dx * k * rx + dy * k * fx * -1 * -1 * 1));
    c.tz = Math.max(-s.z, Math.min(s.z, c.tz - dx * k * rz - dy * k * fz * -1));
  }
  function isabet(cx, cy) {
    const r = O.cv.getBoundingClientRect(), v = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    O.ray.setFromCamera(v, O.kamera);
    const hit = O.ray.intersectObjects([...Object.values(O.ag).map(A => A.R), ...O.dunya.children.filter(c => c.userData.ajanId)], true)[0];
    let o = hit?.object; while (o && !o.userData.ajanId) o = o.parent;
    return o?.userData.ajanId || null;
  }
  function sec(id) {
    if (!id) return;
    V.secili = id; O.secili = id; for (const A of Object.values(O.ag)) A.eKey = "";
    cekmeceCiz();
    const A = O.ag[id]; if (A) O.odak = {id};
    document.getElementById("cekmece")?.scrollIntoView({behavior: "smooth", block: "nearest"});
  }
  function gorunum(ad) {
    const c = O.cam; O.odak = null;
    const k = Math.max(1, 1.25 / (O.kamera?.aspect || 1.4));   // dikey (telefon) ekranda daha uzaktan bak
    if (ad === "tepe") O.hedef = {kutup: 0.1, az: 0, uzak: Math.max(46, (O.L?.D || 28) * 1.5) * k, tx: 0, tz: 0};
    else if (ad === "yakin") O.hedef = {kutup: 0.8, az: 0.35, uzak: 24 * Math.min(k, 1.6), tx: c.tx, tz: c.tz};
    else O.hedef = {kutup: 0.95, az: 0, uzak: Math.max(40, (O.L?.D || 28) * 1.45) * k, tx: 0, tz: 0};
  }

  /* ------------------------------------------------------------ kurulum / döngü */
  function baslat() {
    if (O.hazir) return;
    const cv = document.createElement("canvas"); O.cv = cv;
    const r = new THREE.WebGLRenderer({canvas: cv, antialias: true, alpha: false, powerPreference: "high-performance"});
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    O.r = r; O.sahne = new THREE.Scene(); O.kamera = new THREE.PerspectiveCamera(38, 1, 0.5, 400); O.ray = new THREE.Raycaster();
    O.hem = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.8); O.sahne.add(O.hem);
    O.dir = new THREE.DirectionalLight(0xffffff, 0.8); O.golge = O.dir; O.dir.castShadow = true; O.dir.shadow.mapSize.set(2048, 2048); O.dir.shadow.bias = -0.0006;
    O.sahne.add(O.dir, O.dir.target);
    O.fill = new THREE.DirectionalLight(0xbcd4ff, 0.2); O.fill.position.set(-24, 18, -16); O.sahne.add(O.fill);
    O.kok = el("div", {id: "ofis3d", role: "img", "aria-label": "Ajanların 3 boyutlu ofisi"});
    O.kok.append(cv);
    const dugme = (ad, f) => el("button", {class: "dugme", type: "button", text: ad, onclick: f, style: "padding:6px 10px;font-size:13px"});
    O.kok.append(el("div", {class: "o3-arac"}, dugme("🔭 Tepeden", () => gorunum("tepe")), dugme("📐 Açılı", () => gorunum("aci")), dugme("🔍 Yakın", () => gorunum("yakin")),
      dugme("＋", () => { O.cam.uzak = Math.max(10, O.cam.uzak * 0.85); }), dugme("－", () => { O.cam.uzak = Math.min(120, O.cam.uzak * 1.18); })));
    O.kok.append(el("div", {class: "o3-ipucu", text: "Sürükle: döndür · çimdik/tekerlek: yakınlaştır · iki parmak/sağ tık: kaydır · ajana dokun: aç"}));
    girdi(cv);
    new ResizeObserver(() => boyut()).observe(O.kok);
    O.hazir = true; O.imza = ""; gorunum("aci"); Object.assign(O.cam, O.hedef); O.hedef = null;
  }
  function boyut() {
    if (!O.kok) return; const w = O.kok.clientWidth, h = O.kok.clientHeight; if (!w || !h) return;
    O.r.setSize(w, h, false); O.kamera.aspect = w / h; O.kamera.updateProjectionMatrix();
  }
  function kur(kap) {
    baslat(); kap.append(O.kok); boyut();
    senkron(ajanlar());
    if (!O.ilkGorunum) { O.ilkGorunum = true; gorunum("aci"); Object.assign(O.cam, O.hedef); O.hedef = null; } cancelAnimationFrame(O.raf); O.son = performance.now(); O.raf = requestAnimationFrame(dongu);
  }
  function guncelle() { if (O.hazir) senkron(ajanlar()); }
  function durdur() { cancelAnimationFrame(O.raf); O.raf = 0; }

  let sonListe = 0, liste = [];
  function dongu(now) {
    if (!O.kok?.isConnected) { O.raf = 0; return; }
    O.raf = requestAnimationFrame(dongu);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - O.son) / 1000); O.son = now; O.t0 += dt; const t = O.t0;
    if (now - sonListe > 700) { liste = ajanlar(); senkron(liste); sonListe = now; }
    const c = O.cam;
    if (O.hedef) { const h = O.hedef, f = Math.min(1, dt * 4); for (const k of ["kutup", "az", "uzak", "tx", "tz"]) c[k] = k === "az" ? lerpAci(c[k], h[k], f) : lerp(c[k], h[k], f);
      if (Math.abs(c.uzak - h.uzak) < 0.2 && Math.abs(c.kutup - h.kutup) < 0.01) O.hedef = null; }
    if (O.odak) { const A = O.ag[O.odak.id]; if (A) { c.tx = lerp(c.tx, A.pos.x, Math.min(1, dt * 3)); c.tz = lerp(c.tz, A.pos.z, Math.min(1, dt * 3)); c.uzak = lerp(c.uzak, 20, Math.min(1, dt * 2)); } }
    kameraUygula();
    for (const A of Object.values(O.ag)) {
      hareket(A, dt, t);
      const a = A.a; if (!a) continue;
      etiket(A, a);
      const dist = O.kamera.position.distanceTo(A.R.position), s = Math.max(0.6, Math.min(2.6, dist / 30)) * 3.4;
      A.spr.scale.set(s, s * 240 / 512, 1); A.spr.position.set(A.pos.x, 2.5, A.pos.z);
      A.pb.position.set(A.pos.x, 2.12 + Math.sin(t * 2.2 + A.faz) * 0.06, A.pos.z); A.pb.rotation.y = t * 1.6 + A.faz;
      A.pb.material.color.setHex(a.rozet ? 0xf97316 : a.aktif ? 0x4ade80 : 0x7dd3fc);
    }
    // seçili halka
    if (O.secili && O.ag[O.secili]) {
      if (!O.halka) { O.halka = new THREE.Mesh(geo("TorusGeometry", 0.6, 0.05, 8, 32), new THREE.MeshBasicMaterial({color: 0xfacc15})); O.halka.rotation.x = Math.PI / 2; O.sahne.add(O.halka); }
      const A = O.ag[O.secili]; O.halka.position.set(A.pos.x, 0.06, A.pos.z); O.halka.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    }
    // pinpon topu
    if (O.top) { const oy = O.slots.filter(s => s.tip === "oyun" && s.dolu).length, u = O.top.userData; O.top.visible = oy > 0;
      const k = (Math.sin(t * 3) + 1) / 2; O.top.position.set(u.x + Math.sin(t * 1.7) * 0.2, 0.86 + Math.abs(Math.sin(t * 6)) * 0.3, u.z + (k - 0.5) * 2.2); }
    if (Math.floor(t * 2) !== O.tvTik) { O.tvTik = Math.floor(t * 2); tvCiz(); }
    O.r.render(O.sahne, O.kamera);
  }

  return {var: var_, kur, guncelle, durdur, sec, gorunum};
})();
