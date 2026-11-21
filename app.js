/* Global Sayar Kontrol Merkezi — ajanların 2D ofisi, onaylar, akış, raporlar, videolar, ayarlar.
 * İki veri kaynağı:
 *   yerel  : bilgisayardaki panel (127.0.0.1:8765/kontrol) — anahtar gerekmez, panel dosyaları okur/yazar
 *   github : her yerden (telefon) — kullanıcının bu cihaza girdiği, yalnızca bu depoya yetkili GitHub anahtarıyla
 * Uygulama sistemi doğrudan değiştirmez: onay kararlarını state/onay_kararlari/<id>.json olarak yazar, bulut bunları
 * dakikalar içinde uygular. Tüm metinler textContent ile basılır (HTML enjeksiyonu yok). */
"use strict";

const YEREL = ["127.0.0.1", "localhost"].includes(location.hostname);
const AYAR_ANAHTARI = "gs_kontrol_ayar";
const ISLEM_ADLARI = {
  "youtube.soru_yorumu": "YouTube: yeni videoya soru yorumu",
  "youtube.yanit": "YouTube: izleyici yorumuna yanıt",
  "youtube.baslik": "YouTube: düşük performanslı başlığı değiştirme",
  "youtube.listeye_ekle": "YouTube: oynatma listesine ekleme",
  "instagram.yanit": "Instagram: yorum yanıtı",
  "strateji.ayar": "Strateji ajanı: ayar değişikliği",
};
const PLATFORM = {
  youtube: {ad: "YouTube", renk: "#e11d48", harf: "Y"}, instagram: {ad: "Instagram", renk: "#c026d3", harf: "I"},
  tiktok: {ad: "TikTok", renk: "#0f766e", harf: "T"}, strateji: {ad: "Strateji", renk: "#7c3aed", harf: "S"},
  uretim: {ad: "Üretim", renk: "#2563eb", harf: "Ü"}, onay: {ad: "Onay", renk: "#d97706", harf: "O"},
};

let ayar = {};
try { ayar = JSON.parse(localStorage.getItem(AYAR_ANAHTARI) || "{}"); } catch (e) { ayar = {}; }
function ayarKaydet() { try { localStorage.setItem(AYAR_ANAHTARI, JSON.stringify(ayar)); } catch (e) { /* özel mod */ } }

/* ------------------------------------------------------------------ veri katmanı */
const api = {
  hazir() { return YEREL || (ayar.token && ayar.repo); },
  async _gh(yol, opt = {}) {
    const r = await fetch("https://api.github.com" + yol, {
      method: opt.method || "GET",
      headers: {Authorization: "Bearer " + ayar.token, Accept: opt.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", ...(opt.body ? {"Content-Type": "application/json"} : {})},
      body: opt.body ? JSON.stringify(opt.body) : undefined, cache: "no-store"});
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`);
    if (r.status === 204) return {};
    return opt.raw ? r.text() : r.json();
  },
  async _yerel(yol, opt = {}) {
    const r = await fetch(yol, {method: opt.method || "GET", cache: "no-store",
      headers: opt.body ? {"Content-Type": "application/json"} : {}, body: opt.body ? JSON.stringify(opt.body) : undefined});
    if (r.status === 404 || r.status === 204) return null;
    if (!r.ok) throw new Error(`Panel ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.headers.get("content-type")?.includes("json") ? r.json() : r.text();
  },
  async metin(yol) {
    return YEREL ? this._yerel("/kapi/dosya?yol=" + encodeURIComponent(yol))
                 : this._gh(`/repos/${ayar.repo}/contents/${encodeURI(yol)}`, {raw: true});
  },
  async json(yol, varsayilan) {
    const t = await this.metin(yol);
    if (t == null) return varsayilan;
    try { return typeof t === "string" ? JSON.parse(t) : t; } catch (e) { return varsayilan; }
  },
  async klasor(yol) {
    if (YEREL) return (await this._yerel("/kapi/klasor?yol=" + encodeURIComponent(yol))) || [];
    const d = await this._gh(`/repos/${ayar.repo}/contents/${encodeURI(yol)}`);
    return Array.isArray(d) ? d.map(x => x.name) : [];
  },
  async calismalar() {
    if (YEREL) return (await this._yerel("/kapi/calismalar")) || {calismalar: [], nabiz: null};
    const runs = (await this._gh(`/repos/${ayar.repo}/actions/runs?per_page=12`))?.workflow_runs || [];
    const aktif = runs.filter(r => r.status !== "completed").slice(0, 4);
    for (const r of aktif) r.isler = ((await this._gh(`/repos/${ayar.repo}/actions/runs/${r.id}/jobs`))?.jobs || [])
      .map(j => ({ad: j.name, durum: j.status, sonuc: j.conclusion}));
    let nabiz = null;
    try { nabiz = Number((await this._gh(`/repos/${ayar.repo}/actions/variables/PC_NABIZ`))?.value) || null; } catch (e) { /* yetki yok */ }
    return {calismalar: runs.map(r => ({id: r.id, ad: r.display_title, olay: r.event, durum: r.status, sonuc: r.conclusion,
      tarih: r.created_at, url: r.html_url, isler: r.isler || []})), nabiz};
  },
  async yaz(yol, veri, mesaj) {
    if (YEREL) return this._yerel("/kapi/yaz", {method: "POST", body: {yol, veri, mesaj}});
    const mevcut = await this._gh(`/repos/${ayar.repo}/contents/${encodeURI(yol)}`);
    const icerik = btoa(unescape(encodeURIComponent(JSON.stringify(veri, null, 2))));
    return this._gh(`/repos/${ayar.repo}/contents/${encodeURI(yol)}`, {method: "PUT",
      body: {message: mesaj, content: icerik, ...(mevcut?.sha ? {sha: mevcut.sha} : {})}});
  },
  async gorev(gorev, ek = {}) {
    const inputs = {gorev, ...ek};
    if (YEREL) return this._yerel("/kapi/gorev", {method: "POST", body: inputs});
    return this._gh(`/repos/${ayar.repo}/actions/workflows/icerik-dongusu.yml/dispatches`, {method: "POST",
      body: {ref: "main", inputs}});
  },
};

/* ------------------------------------------------------------------ durum */
const V = {yuklendi: false, hata: null, sekme: "ofis", secili: null, rapor: null, gonderilen: {}};

async function yukle() {
  try {
    const [gecmis, sosyal, kuyruk, onayAyar, ajanGecmis, strateji, istat, kesit, kota, sdurum, kararlar, calisma, config, araclar] =
      await Promise.all([
        api.json("state/gecmis.json", []), api.json("state/sosyal_gecmisi.json", []), api.json("state/onay_kuyrugu.json", []),
        api.json("state/onay_ayarlari.json", null), api.json("state/ajan_gecmisi.json", []), api.json("state/strateji.json", {}),
        api.json("state/sosyal_istatistik.json", []), api.json("state/kesit_kuyrugu.json", []), api.json("state/youtube_kota.json", {}),
        api.json("state/sosyal_durum.json", {}), api.klasor("state/onay_kararlari"),
        api.calismalar().catch(e => ({calismalar: [], nabiz: null, hata: e.message})), api.metin("config.yaml").catch(() => ""),
        api.json("state/arac_durumu.json", null),
      ]);
    Object.assign(V, {gecmis, sosyal, kuyruk, onayAyar, ajanGecmis, strateji, istat, kesit, kota, sdurum, araclar,
      kararlar: new Set((kararlar || []).map(n => n.replace(/\.json$/, ""))), calisma, config: config || "",
      yuklendi: true, hata: null, zaman: new Date()});
  } catch (e) {
    V.hata = e.message;
  }
  ciz();
}

function onayGereken() {
  if (V.onayAyar && Array.isArray(V.onayAyar.onay_gereken)) return V.onayAyar.onay_gereken;
  const m = /onay_gereken:\s*\[([^\]]*)\]/.exec(V.config || "");
  return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : [];
}
const bekleyenler = () => (V.kuyruk || []).filter(k => k.durum === "bekliyor");
function aktifIsler() {
  const s = new Set();
  for (const c of V.calisma?.calismalar || []) {
    if (c.durum === "completed") continue;
    for (const j of c.isler || []) if (j.durum !== "completed") s.add(j.ad);
    if (!c.isler?.length) s.add("bilinmiyor");
  }
  return s;
}
function pcAcik() { const n = V.calisma?.nabiz; return n ? (Date.now() / 1000 - n) < 900 : null; }
function sure(tarih) {
  const sn = (Date.now() - new Date(tarih).getTime()) / 1000;
  if (sn < 90) return "az önce"; if (sn < 3600) return `${Math.round(sn / 60)} dk önce`;
  if (sn < 86400) return `${Math.round(sn / 3600)} sa önce`; return `${Math.round(sn / 86400)} gün önce`;
}

/* ------------------------------------------------------------------ küçük DOM yardımcıları */
function el(etiket, ozellik = {}, ...cocuklar) {
  const e = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellik)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of cocuklar.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function ikon(platform) {
  const p = PLATFORM[platform] || {harf: "?", renk: "#64748b"};
  return el("span", {class: "ikon", style: `background:${p.renk}`, text: p.harf, "aria-hidden": "true"});
}
function onayKutusu(baslik, metin, tamam) {
  const kutu = el("div", {class: "onaykutu", role: "dialog", "aria-modal": "true"},
    el("div", {class: "kart"}, el("h2", {text: baslik}), el("p", {text: metin}),
      el("div", {style: "display:flex;gap:8px;justify-content:flex-end"},
        el("button", {class: "dugme", text: "Vazgeç", onclick: () => kutu.remove()}),
        el("button", {class: "dugme birincil", text: "Evet", onclick: async () => { kutu.remove(); await tamam(); }}))));
  document.body.append(kutu);
}

/* ------------------------------------------------------------------ üst şerit */
function cipleriCiz() {
  const k = document.getElementById("cipler");
  k.replaceChildren();
  if (!V.yuklendi) return;
  const pc = pcAcik();
  k.append(el("span", {class: "cip " + (pc ? "ok" : pc === false ? "" : ""), text: pc ? "💻 PC açık — üretim bilgisayarda" : pc === false ? "☁️ PC kapalı — üretim bulutta" : "💻 PC durumu bilinmiyor"}));
  const aktif = aktifIsler();
  k.append(el("span", {class: "cip " + (aktif.size ? "warn" : ""), text: aktif.size ? `⚙️ Bulutta çalışıyor: ${[...aktif].join(", ")}` : "☁️ Bulut boşta"}));
  const son = (V.istat || []).at(-1);
  if (son?.youtube_abone != null) k.append(el("span", {class: "cip", text: `▶ ${son.youtube_abone} abone`}));
  if (son?.instagram_takipci != null) k.append(el("span", {class: "cip", text: `◎ ${son.instagram_takipci} takipçi`}));
  if (V.kota?.birim != null) k.append(el("span", {class: "cip " + (V.kota.birim > 8000 ? "warn" : ""), text: `Kota ${V.kota.birim}/10.000`}));
  const b = bekleyenler().length;
  if (b) k.append(el("span", {class: "cip warn", text: `✋ ${b} onay bekliyor`}));
  const rozetYeri = document.querySelector('[data-sekme="onaylar"]');
  rozetYeri.querySelector(".rozet")?.remove();
  if (b) rozetYeri.append(el("span", {class: "rozet", text: b}));
}

/* ------------------------------------------------------------------ 2D ofis */
function ajanlar() {
  const aktif = aktifIsler();
  const uretimAktif = aktif.has("uret") || aktif.has("kapi");
  const sosyalAktif = aktif.has("sosyal") || aktif.has("onaylar") || uretimAktif;
  const son = (p) => (V.sosyal || []).filter(g => g.platform === p).at(-1);
  const sonVideo = (V.gecmis || []).filter(g => g.video_id).at(-1);
  const tiktokTaslak = (V.gecmis || []).filter(g => g.tiktok?.durum === "SEND_TO_USER_INBOX" &&
    Date.now() - new Date(g.tarih) < 3 * 864e5).length;
  const igSon = son("instagram");
  const ytSon = son("youtube");
  const raporlar = (V.sosyal || []).length;
  return [
    {id: "senarist", ad: "Senarist", gorev: "Fikir + senaryo", renk: "#2563eb", sac: "#3b2a1a", aktif: uretimAktif,
      balon: sonVideo ? `Son: ${sonVideo.baslik}` : "Fikir bekliyor", platform: "uretim"},
    {id: "seslendirici", ad: "Seslendirici", gorev: "Gemini TTS + altyazı", renk: "#0891b2", sac: "#111", aktif: uretimAktif,
      balon: uretimAktif ? "Kayıtta…" : "Ses hazır", platform: "uretim"},
    {id: "montajci", ad: "Montajcı", gorev: "Görüntü + müzik + kapak", renk: "#4f46e5", sac: "#7c4a1e", aktif: uretimAktif,
      balon: `${(V.gecmis || []).filter(g => g.video_id).length} video yayında`, platform: "uretim"},
    {id: "yonetmen", ad: "Görüntü Yönetmeni", gorev: "Çekim planı", renk: "#be123c", sac: "#4a2c1a", aktif: uretimAktif,
      balon: uretimAktif ? "Çekim listesi hazırlanıyor…" : "Her ifadeye bir görüntü", platform: "uretim"},
    {id: "editor", ad: "Editör", gorev: "Görüntü seçimi + kalite", renk: "#059669", sac: "#1f1f1f", aktif: uretimAktif,
      balon: (() => { const u = (V.gecmis || []).filter(g => g.goruntu_uyum != null).slice(-5);
        if (!u.length) return "Uyum puanı bekleniyor";
        const ort = u.reduce((a, g) => a + g.goruntu_uyum, 0) / u.length;
        const sorun = (V.gecmis || []).filter(g => g.kalite_sorunlari).length;
        return `Görüntü uyumu ${ort.toFixed(1)}/10${sorun ? ` · ${sorun} kalite uyarısı` : ""}`; })(),
      platform: "uretim", rozet: (V.gecmis || []).slice(-5).filter(g => g.kalite_sorunlari).length},
    {id: "strateji", ad: "Strateji Ajanı", gorev: "Haftalık plan", renk: "#7c3aed", sac: "#c08457", aktif: aktif.has("ajan"),
      balon: V.strateji?.deney ? `Deney: ${V.strateji.deney}` : "Pazartesi planlıyor", platform: "strateji"},
    {id: "youtube", ad: "YouTube Ajanı", gorev: "Yorum, liste, başlık", renk: "#e11d48", sac: "#222", aktif: sosyalAktif,
      balon: V.sdurum?.youtube_izin_eksik ? "İzin bekliyorum" : ytSon ? ytSon.ozet || ytSon.islem : "Yorumları izliyor", platform: "youtube"},
    {id: "tiktok", ad: "TikTok Ajanı", gorev: "Açıklama + hashtag", renk: "#0f766e", sac: "#5b3a29", aktif: uretimAktif,
      balon: tiktokTaslak ? `${tiktokTaslak} taslak paylaşılmayı bekliyor` : "Taslaklar temiz", platform: "tiktok",
      rozet: tiktokTaslak},
    {id: "instagram", ad: "Instagram Ajanı", gorev: "Reels + yorumlar", renk: "#c026d3", sac: "#e0b16a", aktif: sosyalAktif && !!igSon,
      balon: igSon ? igSon.ozet : "Hesap bağlanmayı bekliyor", platform: "instagram"},
    {id: "koordinator", ad: "Koordinatör", gorev: "Rapor + kota", renk: "#ea580c", sac: "#333", aktif: aktif.has("sosyal") || aktif.has("onaylar"),
      balon: `${raporlar} işlem kayıtlı`, platform: "onay"},
    {id: "onay", ad: "Onay Masası", gorev: "Senin kararın", renk: "#d97706", sac: null, aktif: false,
      balon: bekleyenler().length ? `${bekleyenler().length} karar bekliyor` : "Bekleyen yok", platform: "onay",
      rozet: bekleyenler().length},
  ];
}

const OFIS = {canvas: null, ctx: null, w: 0, h: 0, kutular: [], t: 0, rafId: 0};
const AZ_HAREKET = matchMedia("(prefers-reduced-motion: reduce)").matches;

function ofisKur(kap) {
  const c = el("canvas", {id: "ofis", role: "img", "aria-label": "Ajanların 2 boyutlu ofisi"});
  kap.append(c);
  OFIS.canvas = c; OFIS.ctx = c.getContext("2d");
  c.addEventListener("click", (e) => {
    const r = c.getBoundingClientRect();
    const x = (e.clientX - r.left), y = (e.clientY - r.top);
    const k = OFIS.kutular.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (k) { V.secili = k.ajan.id; cekmeceCiz(); document.getElementById("cekmece")?.scrollIntoView({behavior: "smooth", block: "nearest"}); }
  });
  boyutla();
  cancelAnimationFrame(OFIS.rafId);
  const dongu = (t) => { OFIS.t = t / 1000; ofisCiz(); if (!AZ_HAREKET) OFIS.rafId = requestAnimationFrame(dongu); };
  OFIS.rafId = requestAnimationFrame(dongu);
}
function boyutla() {
  const c = OFIS.canvas; if (!c) return;
  const w = c.parentElement.clientWidth;
  const sutun = w < 520 ? 2 : w < 860 ? 3 : 3;
  const satir = Math.ceil(ajanlar().length / sutun);
  const hucreH = 236; // balon (üst) + masa + isim/görev (alt) bir sonraki satırın balonuyla çakışmasın
  const h = satir * hucreH + 30;
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr; c.style.height = h + "px";
  OFIS.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Object.assign(OFIS, {w, h, sutun, hucreH});
}
function renk(ad) { return getComputedStyle(document.documentElement).getPropertyValue(ad).trim(); }
function yuvarlak(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function satirlaraBol(ctx, metin, genislik, enCok) {
  const kelimeler = String(metin).split(/\s+/); const satirlar = []; let s = "";
  for (const k of kelimeler) {
    const deneme = s ? s + " " + k : k;
    if (ctx.measureText(deneme).width > genislik && s) { satirlar.push(s); s = k; } else s = deneme;
    if (satirlar.length === enCok) break;
  }
  if (satirlar.length < enCok && s) satirlar.push(s);
  if (satirlar.length === enCok && kelimeler.join(" ").length > satirlar.join(" ").length) satirlar[enCok - 1] = satirlar[enCok - 1].replace(/.{0,2}$/, "…");
  return satirlar;
}
function ofisCiz() {
  const {ctx, w, h, sutun, hucreH} = OFIS; if (!ctx) return;
  const t = OFIS.t, liste = ajanlar();
  // zemin: karo desen
  ctx.fillStyle = renk("--floor"); ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = renk("--floor2");
  for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < w; x += 64) ctx.fillRect(x, y, 32, 32);
  ctx.fillStyle = renk("--wall"); ctx.fillRect(0, 0, w, 18);
  OFIS.kutular = [];
  const hw = w / sutun;
  liste.forEach((a, i) => {
    const cx = (i % sutun) * hw + hw / 2, cy = Math.floor(i / sutun) * hucreH + 30 + hucreH / 2;
    const secili = V.secili === a.id;
    const kx = cx - Math.min(hw, 220) / 2 + 6, ky = cy - hucreH / 2 + 4, kw = Math.min(hw, 220) - 12, kh = hucreH - 10;
    OFIS.kutular.push({x: kx, y: ky, w: kw, h: kh, ajan: a});
    if (secili) { ctx.strokeStyle = renk("--accent"); ctx.lineWidth = 2; yuvarlak(ctx, kx, ky, kw, kh, 14); ctx.stroke(); }
    // halı
    ctx.fillStyle = a.renk + "22"; yuvarlak(ctx, cx - 70, cy - 10, 140, 92, 14); ctx.fill();
    // masa
    const masaY = cy + 22;
    ctx.fillStyle = "#8b6a4a"; yuvarlak(ctx, cx - 58, masaY, 116, 34, 6); ctx.fill();
    ctx.fillStyle = "#6f5238"; ctx.fillRect(cx - 52, masaY + 34, 8, 16); ctx.fillRect(cx + 44, masaY + 34, 8, 16);
    // monitör
    const parla = a.aktif ? 0.55 + 0.45 * Math.abs(Math.sin(t * 4 + i)) : 0;
    ctx.fillStyle = "#1f2937"; yuvarlak(ctx, cx - 24, masaY - 26, 48, 30, 4); ctx.fill();
    ctx.fillStyle = a.aktif ? `rgba(110,200,255,${parla})` : "#334155"; ctx.fillRect(cx - 20, masaY - 22, 40, 22);
    if (a.aktif) { ctx.fillStyle = "rgba(255,255,255,.8)"; for (let s = 0; s < 3; s++) ctx.fillRect(cx - 16, masaY - 18 + s * 6, 10 + ((t * 20 + s * 7 + i * 5) % 22), 2); }
    ctx.fillStyle = "#1f2937"; ctx.fillRect(cx - 3, masaY + 4, 6, 4);
    // karakter (masanın arkasında)
    if (a.sac !== null) {
      const zipla = a.aktif ? Math.sin(t * 10 + i) * 1.5 : Math.sin(t * 1.5 + i) * 1;
      const by = masaY - 44 + zipla;
      ctx.fillStyle = a.renk; yuvarlak(ctx, cx - 17, by + 12, 34, 30, 10); ctx.fill();          // gövde
      ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(cx, by + 2, 12, 0, Math.PI * 2); ctx.fill(); // baş
      ctx.fillStyle = a.sac; ctx.beginPath(); ctx.arc(cx, by - 2, 12, Math.PI, 0); ctx.fill();          // saç
      ctx.fillStyle = "#1f2937"; ctx.fillRect(cx - 5, by + 1, 2, 3); ctx.fillRect(cx + 3, by + 1, 2, 3); // gözler
      // kollar: aktifken klavyede
      const kol = a.aktif ? Math.sin(t * 16 + i) * 3 : 0;
      ctx.fillStyle = a.renk; ctx.fillRect(cx - 21, by + 26 + kol, 8, 14); ctx.fillRect(cx + 13, by + 26 - kol, 8, 14);
    } else {
      // onay masası: evrak yığını
      for (let s = 0; s < Math.min(6, a.rozet || 1); s++) { ctx.fillStyle = s % 2 ? "#f8fafc" : "#e2e8f0"; ctx.fillRect(cx - 18 + s, masaY - 8 - s * 4, 36, 6); }
      ctx.font = "22px system-ui"; ctx.textAlign = "center"; ctx.fillText("🗂️", cx, masaY - 34);
    }
    // isim + görev
    ctx.textAlign = "center"; ctx.fillStyle = renk("--fg"); ctx.font = "600 13px system-ui";
    ctx.fillText(a.ad, cx, masaY + 70);
    ctx.fillStyle = renk("--muted"); ctx.font = "11px system-ui"; ctx.fillText(a.gorev, cx, masaY + 85);
    // durum noktası
    ctx.fillStyle = a.aktif ? "#22c55e" : a.rozet ? "#f59e0b" : "#94a3b8";
    ctx.beginPath(); ctx.arc(cx - ctx.measureText(a.gorev).width / 2 - 8, masaY + 81, 4, 0, Math.PI * 2); ctx.fill();
    // konuşma balonu
    ctx.font = "11px system-ui";
    const bw = Math.min(kw - 8, 190), satirlar = satirlaraBol(ctx, a.balon, bw - 16, 2);
    const bh = 10 + satirlar.length * 14, bx = cx - bw / 2, byy = ky + 4;
    ctx.fillStyle = renk("--panel"); ctx.strokeStyle = renk("--line"); ctx.lineWidth = 1;
    yuvarlak(ctx, bx, byy, bw, bh, 8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 5, byy + bh); ctx.lineTo(cx + 5, byy + bh); ctx.lineTo(cx, byy + bh + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = renk("--fg"); satirlar.forEach((s, j) => ctx.fillText(s, cx, byy + 16 + j * 14));
    // rozet
    if (a.rozet) {
      ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(cx + 46, masaY - 26, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 11px system-ui"; ctx.fillText(String(a.rozet), cx + 46, masaY - 22);
    }
  });
}

function cekmeceCiz() {
  const k = document.getElementById("cekmece"); if (!k) return;
  k.replaceChildren();
  const a = ajanlar().find(x => x.id === V.secili);
  if (!a) { k.append(el("div", {class: "alt", text: "Bir ajana dokun: ne yaptığını ve raporlarını gör."})); return; }
  k.append(el("h2", {}, ikon(a.platform), " ", a.ad), el("p", {class: "alt", text: `${a.gorev} · ${a.aktif ? "şu an çalışıyor" : "beklemede"}`}));
  let kayitlar = [];
  if (a.id === "editor" || a.id === "yonetmen") kayitlar = (V.gecmis || []).filter(g => g.video_id).slice(-8).reverse()
    .map(g => ({b: g.baslik, m: `görüntü uyumu ${g.goruntu_uyum ?? "–"}/10${g.kalite_sorunlari ? " · ⚠️ " + g.kalite_sorunlari.join(", ") : " · kalite temiz"}`, t: g.tarih}));
  else if (a.platform === "uretim") kayitlar = (V.gecmis || []).filter(g => g.video_id).slice(-8).reverse()
    .map(g => ({b: g.baslik, m: `${g.tur} · ${g.istatistik?.izlenme ?? "?"} izlenme`, t: g.tarih}));
  else if (a.platform === "strateji") kayitlar = (V.ajanGecmis || []).slice(-8).reverse()
    .map(g => ({b: g.tur === "strateji" ? "Haftalık strateji" : `Ayar: ${g.anahtar}`, m: g.deney || `${g.eski} → ${g.yeni} (${g.gerekce || ""})`, t: g.tarih}));
  else if (a.id === "onay") kayitlar = bekleyenler().map(k => ({b: ISLEM_ADLARI[`${k.platform}.${k.islem}`] || k.islem, m: k.ozet, t: k.tarih}));
  else if (a.platform === "tiktok") kayitlar = (V.gecmis || []).filter(g => g.tiktok).slice(-8).reverse()
    .map(g => ({b: g.baslik, m: g.tiktok.durum === "SEND_TO_USER_INBOX" ? "Taslak — TikTok uygulamasından paylaş" : (g.tiktok.durum || g.tiktok.hata || ""), t: g.tarih}));
  else kayitlar = (V.sosyal || []).filter(g => a.id === "koordinator" || g.platform === a.platform).slice(-10).reverse()
    .map(g => ({b: `${g.islem}${g.uygulandi ? "" : " (öneri)"}`, m: g.ozet || g.hedef, t: g.tarih}));
  if (!kayitlar.length) k.append(el("div", {class: "bos", text: "Henüz kayıt yok."}));
  for (const r of kayitlar) k.append(el("div", {class: "satir"}, ikon(a.platform),
    el("div", {class: "ic"}, el("b", {text: r.b}), el("div", {class: "m alt", text: `${r.m || ""}`}), el("div", {class: "alt", text: sure(r.t)}))));
  if (a.id === "onay" && kayitlar.length) k.append(el("button", {class: "dugme birincil", text: "Onaylara git", onclick: () => sekmeAc("onaylar")}));
}

function ofisSekmesi(m) {
  const kap = el("div", {id: "ofis-kap"});
  m.append(kap, el("div", {class: "kart cekmece", id: "cekmece"}));
  ofisKur(kap);
  cekmeceCiz();
  // Hızlı görevler
  const g = el("div", {class: "kart cekmece"}, el("h2", {text: "Görev ver"}),
    el("p", {class: "alt", text: "Bulutta hemen çalıştırır. Yayın herkese açıktır; günlük ~5 yükleme kotası vardır."}));
  const satir = el("div", {style: "display:flex;gap:8px;flex-wrap:wrap"});
  const gorevler = [
    ["🎬 1 Shorts üret ve yayınla", "uret", {shorts: "1", videos: "0", yukle: "true"}, "Şimdi bir Shorts üretilip YouTube'a (ve açıksa TikTok/Instagram'a) yüklenecek."],
    ["📣 Sosyal turu çalıştır", "sosyal", {}, "Yorum yanıtları, başlık iyileştirme ve rapor şimdi çalışacak."],
    ["🧭 Strateji ajanı", "ajan", {}, "Strateji ajanı şimdi kanalı inceleyip haftalık planı güncelleyecek."],
    ["✅ Onayları şimdi uygula", "onaylar", {}, "Verdiğin onaylar hemen uygulanacak."],
  ];
  for (const [ad, gorev, ek, aciklama] of gorevler) satir.append(el("button", {class: "dugme", text: ad, onclick: () =>
    onayKutusu(ad, aciklama, async () => {
      try { await api.gorev(gorev, ek); bildir(`${ad}: başlatıldı. Birkaç saniye içinde ofiste görünür.`); setTimeout(yukle, 8000); }
      catch (e) { bildir("Başlatılamadı: " + e.message, true); }
    })}));
  g.append(satir);
  m.append(g);
}

/* ------------------------------------------------------------------ onaylar */
function onaylarSekmesi(m) {
  const b = bekleyenler();
  m.append(el("h2", {text: `Onay bekleyenler (${b.length})`}));
  if (!b.length) m.append(el("div", {class: "kart bos", text: "Bekleyen karar yok. Ajanlar onay gereken bir şey önerince burada görünür."}));
  const izgara = el("div", {class: "izgara"});
  for (const k of b) {
    const gonderildi = V.gonderilen[k.id] || (V.kararlar?.has(k.id) ? "gönderildi" : null);
    const not = el("input", {type: "text", placeholder: "Not (isteğe bağlı)", "aria-label": "Karar notu", id: "not-" + k.id});
    const karar = async (deger) => {
      try {
        await api.yaz(`state/onay_kararlari/${k.id}.json`, {id: k.id, karar: deger, not: not.value || undefined,
          tarih: new Date().toISOString(), kaynak: YEREL ? "panel" : "telefon"}, `onay: ${k.islem} ${deger}`);
        V.gonderilen[k.id] = deger; ciz(); bildir(deger === "onaylandi" ? "Onaylandı — dakikalar içinde uygulanacak." : "Reddedildi.");
      } catch (e) { bildir("Gönderilemedi: " + e.message, true); }
    };
    izgara.append(el("div", {class: "kart onay"},
      el("div", {class: "satir", style: "border:0;padding:0"}, ikon(k.platform),
        el("div", {class: "ic"}, el("b", {text: ISLEM_ADLARI[`${k.platform}.${k.islem}`] || `${k.platform} · ${k.islem}`}),
          el("div", {class: "m", text: k.ozet}), el("div", {class: "alt", text: `${sure(k.tarih)} · ${k.hedef}`}))),
      k.veri?.neden ? el("div", {class: "alt", text: "Gerekçe: " + k.veri.neden}) : null,
      gonderildi ? el("div", {class: "bilgi", text: gonderildi === "reddedildi" ? "Reddedildi; uygulanmayacak." : "Karar gönderildi, uygulanıyor…"})
        : el("div", {class: "eylem"}, not,
          el("button", {class: "dugme ok", text: "Onayla", onclick: () => karar("onaylandi")}),
          el("button", {class: "dugme kirmizi", text: "Reddet", onclick: () => karar("reddedildi")}))));
  }
  m.append(izgara);
  const gecmis = (V.kuyruk || []).filter(k => k.durum !== "bekliyor").slice(-15).reverse();
  if (gecmis.length) {
    m.append(el("h2", {text: "Son kararlar", style: "margin-top:20px"}));
    const kart = el("div", {class: "kart"});
    const ad = {uygulandi: "✅ uygulandı", reddedildi: "⛔ reddedildi", hata: "⚠️ hata", zaman_asimi: "⌛ süresi doldu", onaylandi: "⏳ uygulanacak"};
    for (const k of gecmis) kart.append(el("div", {class: "satir"}, ikon(k.platform),
      el("div", {class: "ic"}, el("b", {text: ad[k.durum] || k.durum}), el("div", {class: "m alt", text: k.ozet}),
        k.hata ? el("div", {class: "alt", text: k.hata}) : null)));
    m.append(kart);
  }
}

/* ------------------------------------------------------------------ akış */
function akisSekmesi(m) {
  const olaylar = [
    ...(V.sosyal || []).map(g => ({p: g.platform, b: `${g.islem}${g.uygulandi ? "" : " (öneri)"}${g.onayli ? " · onaylı" : ""}`, m: g.ozet || g.hedef, t: g.tarih})),
    ...(V.ajanGecmis || []).map(g => ({p: "strateji", b: g.tur === "strateji" ? "Haftalık strateji yazıldı" : `Ayar ${g.onay_bekliyor ? "önerildi" : "değişti"}: ${g.anahtar}`,
      m: g.deney || `${g.eski} → ${g.yeni}`, t: g.tarih})),
    ...(V.gecmis || []).filter(g => g.video_id).map(g => ({p: "uretim", b: `Yayınlandı (${g.tur})`, m: g.baslik, t: g.tarih})),
  ].sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, 80);
  m.append(el("h2", {text: "Ajanların yaptıkları"}));
  const kart = el("div", {class: "kart"});
  if (!olaylar.length) kart.append(el("div", {class: "bos", text: "Henüz kayıt yok."}));
  for (const o of olaylar) kart.append(el("div", {class: "satir"}, ikon(o.p),
    el("div", {class: "ic"}, el("b", {text: o.b}), el("div", {class: "m alt", text: o.m || ""}), el("div", {class: "alt", text: sure(o.t)}))));
  m.append(kart);
  const c = (V.calisma?.calismalar || []).slice(0, 8);
  if (c.length) {
    m.append(el("h2", {text: "Bulut çalıştırmaları", style: "margin-top:20px"}));
    const k2 = el("div", {class: "kart"});
    for (const r of c) k2.append(el("div", {class: "satir"}, el("div", {class: "ic"},
      el("b", {text: `${r.durum === "completed" ? (r.sonuc === "success" ? "✅" : r.sonuc === "skipped" ? "⏭️" : "⚠️") : "⚙️"} ${r.ad}`}),
      el("div", {class: "alt", text: `${r.olay} · ${sure(r.tarih)}${r.isler?.length ? " · " + r.isler.map(j => j.ad).join(", ") : ""}`})),
      r.url ? el("a", {href: r.url, target: "_blank", rel: "noopener", text: "Aç"}) : null));
    m.append(k2);
  }
}

/* ------------------------------------------------------------------ raporlar */
function md(metin) {
  // Küçük ve güvenli markdown: önce her şey kaçırılır, sonra sınırlı biçimler eklenir
  const kac = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const satir = s => kac(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(https:\/\/[^\s)<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const out = []; let kod = false, liste = false;
  for (const s of String(metin).split("\n")) {
    if (s.startsWith("```")) { if (liste) { out.push("</ul>"); liste = false; } out.push(kod ? "</pre>" : "<pre>"); kod = !kod; continue; }
    if (kod) { out.push(kac(s)); continue; }
    if (/^- /.test(s)) { if (!liste) { out.push("<ul>"); liste = true; } out.push(`<li>${satir(s.slice(2))}</li>`); continue; }
    if (liste) { out.push("</ul>"); liste = false; }
    const h = /^(#{1,3}) (.*)/.exec(s);
    if (h) out.push(`<h${h[1].length}>${satir(h[2])}</h${h[1].length}>`); else if (s.trim()) out.push(`<p>${satir(s)}</p>`);
  }
  if (liste) out.push("</ul>"); if (kod) out.push("</pre>");
  return out.join("\n");
}
async function raporlarSekmesi(m) {
  m.append(el("h2", {text: "Raporlar"}));
  const iki = el("div", {class: "iki"}), sol = el("div", {class: "kart"}), sag = el("div", {class: "kart rapor", text: "Soldan bir rapor seç."});
  iki.append(sol, sag); m.append(iki);
  const [sos, aj] = await Promise.all([api.klasor("state/sosyal_raporlari"), api.klasor("state/ajan_raporlari")]);
  const dosyalar = [...sos.map(n => ({yol: "state/sosyal_raporlari/" + n, ad: "📣 Sosyal · " + n.replace(".md", "")})),
    ...aj.map(n => ({yol: "state/ajan_raporlari/" + n, ad: "🧭 Strateji · " + n.replace(".md", "")}))]
    .filter(d => d.yol.endsWith(".md")).sort((a, b) => b.yol.split("/").pop().localeCompare(a.yol.split("/").pop()));
  if (!dosyalar.length) sol.append(el("div", {class: "bos", text: "Henüz rapor yok."}));
  const ac = async (d) => {
    V.rapor = d.yol; sol.querySelectorAll(".liste-btn").forEach(b => b.setAttribute("aria-current", String(b.dataset.yol === d.yol)));
    sag.textContent = "Yükleniyor…";
    const t = await api.metin(d.yol);
    sag.innerHTML = md(t || "(boş)"); // md() tüm girdiyi kaçırır
  };
  for (const d of dosyalar.slice(0, 40)) sol.append(el("button", {class: "liste-btn", "data-yol": d.yol, text: d.ad, onclick: () => ac(d)}));
  if (dosyalar[0]) ac(dosyalar.find(d => d.yol === V.rapor) || dosyalar[0]);
}

/* ------------------------------------------------------------------ videolar */
function videolarSekmesi(m) {
  const v = (V.gecmis || []).filter(g => g.video_id).slice(-40).reverse();
  m.append(el("h2", {text: `Videolar (${v.length})`}));
  const kart = el("div", {class: "kart"});
  for (const g of v) {
    const ist = g.istatistik || {};
    kart.append(el("div", {class: "satir"}, ikon("uretim"), el("div", {class: "ic video"},
      el("b", {text: g.baslik}), el("span", {class: "sayi", text: `${ist.izlenme ?? "–"} ▶`}),
      el("div", {class: "alt", text: `${g.tur} · ${sure(g.tarih)} · ${ist.begeni ?? 0} beğeni · ${ist.yorum ?? 0} yorum${ist.izlenme_orani ? ` · %${ist.izlenme_orani} izlenme oranı` : ""}`}),
      el("span", {}, el("a", {href: g.url, target: "_blank", rel: "noopener", text: "YouTube"}),
        g.instagram?.url ? [" · ", el("a", {href: g.instagram.url, target: "_blank", rel: "noopener", text: "Instagram"})] : null,
        g.tiktok ? el("span", {class: "alt", text: ` · TikTok: ${g.tiktok.durum === "SEND_TO_USER_INBOX" ? "taslak" : g.tiktok.durum || "hata"}`}) : null))));
  }
  if (!v.length) kart.append(el("div", {class: "bos", text: "Henüz video yok."}));
  m.append(kart);
}

/* ------------------------------------------------------------------ ayarlar */
function ayarlarSekmesi(m) {
  m.append(el("h2", {text: "Onay gerektiren işlemler"}));
  const secili = new Set(onayGereken());
  const kart = el("div", {class: "kart form"});
  kart.append(el("p", {class: "alt", text: "İşaretli işlemler sen onaylamadan yapılmaz. İşaretsizler sınırlar içinde otomatik yapılır ve raporlanır."}));
  const kutular = {};
  for (const [k, ad] of Object.entries(ISLEM_ADLARI)) {
    const id = "onay-" + k.replace(".", "-");
    kutular[k] = el("input", {type: "checkbox", id, ...(secili.has(k) ? {checked: ""} : {})});
    kart.append(el("label", {class: "anahtar", for: id}, kutular[k], el("span", {text: ad})));
  }
  kart.append(el("div", {}, el("button", {class: "dugme birincil", text: "Kaydet", onclick: async () => {
    const liste = Object.entries(kutular).filter(([, e]) => e.checked).map(([k]) => k);
    try { await api.yaz("state/onay_ayarlari.json", {onay_gereken: liste, tarih: new Date().toISOString()}, "onay ayarları güncellendi");
      bildir("Kaydedildi."); setTimeout(yukle, 1500); } catch (e) { bildir("Kaydedilemedi: " + e.message, true); }
  }})));
  m.append(kart);
  m.append(el("h2", {text: "Ortak araç kutusu (bütün ajanlar kullanır)", style: "margin-top:20px"}));
  const ak = el("div", {class: "kart"});
  const liste = Object.values(V.araclar?.araclar || {});
  if (!liste.length) ak.append(el("div", {class: "bos", text: "Araç durumu ilk üretim turunda yazılır."}));
  for (const a of liste) ak.append(el("div", {class: "satir"}, el("span", {class: "ikon", style: `background:${a.hazir ? "#16a34a" : "#d97706"}`, text: a.hazir ? "✓" : "!"}),
    el("div", {class: "ic"}, el("b", {text: a.ad}), el("div", {class: "m alt", text: a.saglayicilar}),
      a.eksik?.length ? el("div", {class: "alt", text: "Eksik: " + a.eksik.join(", ")}) : null)));
  if (V.araclar?.tarih) ak.append(el("div", {class: "alt", text: "Durum: " + sure(V.araclar.tarih)}));
  m.append(ak);
  m.append(el("h2", {text: "Bağlantı", style: "margin-top:20px"}));
  const b = el("div", {class: "kart form"});
  if (YEREL) b.append(el("p", {text: "Bilgisayardaki panelden bağlısın: anahtar gerekmez. Telefonda kullanmak için uygulamayı telefonda açıp GitHub anahtarını gir."}));
  else {
    b.append(el("p", {class: "alt", text: `Depo: ${ayar.repo || "-"} · anahtar bu cihazda saklanıyor.`}),
      el("button", {class: "dugme kirmizi", text: "Bu cihazdan çıkış yap", onclick: () => { ayar = {}; ayarKaydet(); location.reload(); }}));
  }
  b.append(el("p", {class: "alt", text: "Telefona kurmak: tarayıcı menüsü → \"Ana ekrana ekle\". Uygulama gibi açılır."}));
  m.append(b);
}

/* ------------------------------------------------------------------ ilk kurulum (telefon) */
function kurulumEkrani(m) {
  m.append(el("h2", {text: "Telefonu bağla"}));
  const f = el("div", {class: "kart form"});
  f.append(el("p", {text: "Bu uygulama verileri doğrudan senin GitHub deponla okur/yazar. Bir kez, yalnızca bu depoya yetkili bir anahtar gir; anahtar sadece bu cihazda saklanır."}),
    el("ol", {}, el("li", {}, el("a", {href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener", text: "GitHub → yeni ince ayarlı anahtar"}), " aç"),
      el("li", {text: "Repository access: Only select repositories → icerik-motoru"}),
      el("li", {text: "İzinler: Contents (Read and write), Actions (Read and write), Variables (Read-only)"}),
      el("li", {text: "Süre: 90 gün ya da istediğin kadar · oluştur ve kopyala"})));
  const tok = el("input", {type: "password", id: "tok", placeholder: "github_pat_…", autocomplete: "off", "aria-label": "GitHub anahtarı"});
  const repo = el("input", {type: "text", id: "repo", placeholder: "kullanici/icerik-motoru", value: ayar.repo || "", "aria-label": "Depo"});
  const hata = el("div", {});
  f.append(el("label", {for: "tok", text: "Anahtar"}), tok, el("label", {for: "repo", text: "Depo (boş bırakırsan bulurum)"}), repo, hata,
    el("button", {class: "dugme birincil", text: "Bağlan", onclick: async () => {
      hata.replaceChildren();
      ayar.token = tok.value.trim();
      try {
        if (!repo.value.trim()) {
          const r = await fetch("https://api.github.com/user/repos?per_page=100&affiliation=owner", {headers: {Authorization: "Bearer " + ayar.token}});
          if (!r.ok) throw new Error("Anahtar geçersiz (" + r.status + ")");
          const bul = (await r.json()).find(x => x.name === "icerik-motoru");
          if (!bul) throw new Error("icerik-motoru deposu bulunamadı; depoyu elle yaz.");
          ayar.repo = bul.full_name;
        } else ayar.repo = repo.value.trim();
        await api._gh(`/repos/${ayar.repo}/contents/state/gecmis.json`, {raw: true});
        ayarKaydet(); location.reload();
      } catch (e) { hata.append(el("div", {class: "hata", text: e.message})); }
    }}));
  m.append(f);
}

/* ------------------------------------------------------------------ çatı */
function bildir(metin, hata = false) {
  const b = el("div", {class: hata ? "hata" : "bilgi", role: "status",
    style: "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(80px + env(safe-area-inset-bottom,0px));z-index:30;max-width:90vw", text: metin});
  document.body.append(b); setTimeout(() => b.remove(), 4500);
}
function sekmeAc(s) { V.sekme = s; try { localStorage.setItem("gs_sekme", s); } catch (e) {} ciz(); }
async function ciz() {
  cipleriCiz();
  document.querySelectorAll(".sekme").forEach(b => b.setAttribute("aria-selected", String(b.dataset.sekme === V.sekme)));
  const m = document.getElementById("icerik");
  if (!api.hazir()) { cancelAnimationFrame(OFIS.rafId); m.replaceChildren(); kurulumEkrani(m); return; }
  if (V.hata && !V.yuklendi) { m.replaceChildren(el("div", {class: "hata", text: "Veri okunamadı: " + V.hata})); return; }
  if (!V.yuklendi) return;
  if (V.sekme === "ofis" && document.getElementById("ofis")) { cekmeceCiz(); ofisCiz(); return; } // canvas zaten canlı
  cancelAnimationFrame(OFIS.rafId); OFIS.ctx = null;
  m.replaceChildren();
  if (V.hata) m.append(el("div", {class: "hata", text: "Son yenileme başarısız: " + V.hata}));
  ({ofis: ofisSekmesi, onaylar: onaylarSekmesi, akis: akisSekmesi, raporlar: raporlarSekmesi,
    videolar: videolarSekmesi, ayarlar: ayarlarSekmesi}[V.sekme] || ofisSekmesi)(m);
  m.append(el("p", {class: "alt", style: "margin-top:16px;text-align:center",
    text: `Son yenileme: ${V.zaman?.toLocaleTimeString("tr-TR") || "-"} · ${YEREL ? "yerel panel" : "GitHub"} · her dakika yenilenir`}));
}

document.getElementById("sekmeler").addEventListener("click", e => { const b = e.target.closest(".sekme"); if (b) sekmeAc(b.dataset.sekme); });
addEventListener("resize", () => { if (OFIS.ctx) { boyutla(); ofisCiz(); } });
try { V.sekme = localStorage.getItem("gs_sekme") || "ofis"; } catch (e) {}
if ("serviceWorker" in navigator && !YEREL) navigator.serviceWorker.register("sw.js").catch(() => {});
ciz();
if (api.hazir()) { yukle(); setInterval(() => { if (!document.hidden) yukle(); }, 60000); }
document.addEventListener("visibilitychange", () => { if (!document.hidden && api.hazir()) yukle(); });
