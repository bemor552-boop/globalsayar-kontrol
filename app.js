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
    let nabiz = null, nabizHata = null;
    try { nabiz = Number((await this._gh(`/repos/${ayar.repo}/actions/variables/PC_NABIZ`))?.value) || null; }
    catch (e) { nabizHata = /403/.test(e.message) ? "izin" : e.message; }
    return {calismalar: runs.map(r => ({id: r.id, ad: r.display_title, olay: r.event, durum: r.status, sonuc: r.conclusion,
      tarih: r.created_at, url: r.html_url, isler: r.isler || []})), nabiz, nabizHata};
  },
  async yaz(yol, veri, mesaj) {
    if (YEREL) return this._yerel("/kapi/yaz", {method: "POST", body: {yol, veri, mesaj}});
    const mevcut = await this._gh(`/repos/${ayar.repo}/contents/${encodeURI(yol)}`);
    const icerik = btoa(unescape(encodeURIComponent(JSON.stringify(veri, null, 2))));
    return this._gh(`/repos/${ayar.repo}/contents/${encodeURI(yol)}`, {method: "PUT",
      body: {message: mesaj, content: icerik, ...(mevcut?.sha ? {sha: mevcut.sha} : {})}});
  },
  async canli() {
    // Bilgisayardaki olaylar: yerelde dosyadan anında; telefonda nabız görevinin 5 dk'da bir taşıdığı PC_CANLI değişkeninden.
    // Buluttaki işlerin olayları iş bitince state/canli.json ile gelir.
    const dosya = await this.json("state/canli.json", []);
    let pc = [];
    if (!YEREL) {
      try { pc = JSON.parse((await this._gh(`/repos/${ayar.repo}/actions/variables/PC_CANLI`))?.value || "[]"); } catch (e) { pc = []; }
    }
    const gorulen = new Set(), hepsi = [];
    for (const o of [...(dosya || []), ...pc]) { const k = o.t + o.ajan + o.mesaj; if (!gorulen.has(k)) { gorulen.add(k); hepsi.push(o); } }
    return hepsi.sort((a, b) => new Date(a.t) - new Date(b.t)).slice(-150);
  },
  async gorev(gorev, ek = {}) {
    const inputs = {gorev, ...ek};
    if (YEREL) return this._yerel("/kapi/gorev", {method: "POST", body: inputs});
    return this._gh(`/repos/${ayar.repo}/actions/workflows/icerik-dongusu.yml/dispatches`, {method: "POST",
      body: {ref: "main", inputs}});
  },
};

/* ------------------------------------------------------------------ durum */
const V = {yuklendi: false, hata: null, sekme: "ofis", secili: null, rapor: null, gonderilen: {}, bekleyenKomut: []};
try { V.bekleyenKomut = JSON.parse(localStorage.getItem("gs_bekleyen_komut") || "[]"); } catch (e) {}

async function yukle() {
  try {
    const [gecmis, sosyal, kuyruk, onayAyar, ajanGecmis, strateji, istat, kesit, kota, sdurum, kararlar, calisma, config, araclar, canli, yonetici, arge, deneyler, mudurK, kadroK, kadroR] =
      await Promise.all([
        api.json("state/gecmis.json", []), api.json("state/sosyal_gecmisi.json", []), api.json("state/onay_kuyrugu.json", []),
        api.json("state/onay_ayarlari.json", null), api.json("state/ajan_gecmisi.json", []), api.json("state/strateji.json", {}),
        api.json("state/sosyal_istatistik.json", []), api.json("state/kesit_kuyrugu.json", []), api.json("state/youtube_kota.json", {}),
        api.json("state/sosyal_durum.json", {}), api.klasor("state/onay_kararlari"),
        api.calismalar().catch(e => ({calismalar: [], nabiz: null, hata: e.message})), api.metin("config.yaml").catch(() => ""),
        api.json("state/arac_durumu.json", null), api.canli().catch(() => []), api.json("state/yonetici.json", []),
        api.json("state/arge/son.json", null), api.json("state/arge/deneyler.json", []),
        api.json("state/mudur.json", []), api.json("state/ajanlar.json", []), api.json("state/ajanlar_rapor.json", {}),
      ]);
    Object.assign(V, {gecmis, sosyal, kuyruk, onayAyar, ajanGecmis, strateji, istat, kesit, kota, sdurum, araclar, canli, yonetici: yonetici || [], arge, deneyler: deneyler || [], mudur: mudurK || [], kadro: kadroK || [], kadroRapor: kadroR || {},
      kararlar: new Set((kararlar || []).map(n => n.replace(/\.json$/, ""))), calisma, config: config || "",
      yuklendi: true, hata: null, zaman: new Date()});
    komutlariEsle();
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
// Üretim turları (Türkiye saati) — .github/workflows/icerik-dongusu.yml ile aynı
const TURLAR = [["09:07", "Shorts"], ["11:07", "uzun video"], ["13:07", "Shorts"], ["17:07", "Shorts"], ["20:37", "sosyal ekip"], ["21:07", "Shorts"]];
function siradakiTur() {
  const tr = new Date(Date.now() + 3 * 3600e3), dk = tr.getUTCHours() * 60 + tr.getUTCMinutes();
  for (const [saat, ad] of TURLAR) { const [h, m] = saat.split(":").map(Number); if (h * 60 + m > dk) return `bugün ${saat} (${ad})`; }
  return `yarın ${TURLAR[0][0]} (${TURLAR[0][1]})`;
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
  const aktif = aktifIsler();
  const calisan = ajanlar().filter(a => a.aktif);
  const nabizYas = V.calisma?.nabiz ? sure(V.calisma.nabiz * 1000) : null;
  // 1) Genel durum: sistem çalışıyor mu, şu an ne yapıyor, sıradaki tur ne zaman
  k.append(el("span", {class: "cip ok", style: "font-weight:600",
    text: calisan.length ? `🟢 Sistem aktif — şu an üretimde (${calisan.map(a => a.ad).join(", ")})`
      : `🟢 Sistem aktif — beklemede, sıradaki tur ${siradakiTur()}`}));
  // 2) Üretimi kim yapıyor: PC (nabız) mı bulut mu
  if (V.calisma?.nabizHata === "izin")
    k.append(el("span", {class: "cip warn", text: "⚠️ PC durumu okunamıyor: GitHub jetonuna 'Variables: Read' izni ekle (Ayarlar)"}));
  else k.append(el("span", {class: "cip " + (pc ? "ok" : ""), text: pc ? `💻 PC açık — üretimi bilgisayar yapıyor (son sinyal ${nabizYas})`
    : pc === false ? `☁️ PC kapalı (son sinyal ${nabizYas}) — üretimi bulut yapıyor` : "💻 PC durumu bilinmiyor"}));
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
const OLAY_AJAN = {yayin: "youtube"};  // yükleme olayları YouTube masasında görünür
function sonOlay(id) {
  const liste = (V.canli || []).filter(o => (OLAY_AJAN[o.ajan] || o.ajan) === id);
  return liste.at(-1) || null;
}
function canliMi(o) {
  if (!o || o.durum !== "calisiyor") return false;
  const yas = (Date.now() - new Date(o.t)) / 1000;
  return yas < (o.ortam === "pc" && !YEREL ? 420 : 180);  // telefonda PC olayları 5 dk gecikmeli gelir
}
function canliUygula(liste) {
  for (const a of liste) {
    const o = sonOlay(a.id);
    if (!o) continue;
    if (canliMi(o)) a.aktif = true;
    if ((Date.now() - new Date(o.t)) / 1000 < 1800) a.balon = `${o.durum === "hata" ? "⚠️ " : ""}${o.mesaj}`;
    a.sonOlay = o;
  }
  return liste;
}
function ajanlar() {
  const aktif = aktifIsler();
  const uretimAktif = aktif.has("uret") || aktif.has("kapi");
  const sosyalAktif = aktif.has("sosyal") || aktif.has("onaylar") || uretimAktif;
  const son = (p) => (V.sosyal || []).filter(g => g.platform === p).at(-1);
  const sonVideo = (V.gecmis || []).filter(g => g.video_id).at(-1);
  const tiktokTaslak = (V.gecmis || []).filter(g => g.tiktok?.durum === "SEND_TO_USER_INBOX" &&
    Date.now() - new Date(g.tarih) < 3 * 864e5).length;
  const tiktokYayinda = (V.gecmis || []).filter(g => g.tiktok?.durum === "PUBLISH_COMPLETE").length;
  const igSayi = (V.gecmis || []).filter(g => g.instagram?.medya_id).length;
  const sonKomut = (V.yonetici || []).at(-1);
  const igSon = son("instagram");
  const ytSon = son("youtube");
  const raporlar = (V.sosyal || []).length;
  const _liste = [
    {id: "yonetici", ad: "Yönetici", gorev: "Senin komutlarını yürütür", renk: "#1e3a8a", sac: "#2b1d14", aktif: !!(V.bekleyenKomut || []).length, grup: "yonetim",
      balon: V.bekleyenKomut?.length ? "Komutun üzerinde çalışıyorum…" : sonKomut ? `Son: ${sonKomut.komut}` : "Komut bekliyorum — aşağıdan yaz", platform: "onay"},
    {id: "senarist", grup: "uretim", ad: "Senarist", gorev: "Fikir + senaryo", renk: "#2563eb", sac: "#3b2a1a", aktif: uretimAktif,
      balon: sonVideo ? `Son: ${sonVideo.baslik}` : "Fikir bekliyor", platform: "uretim"},
    {id: "seslendirici", grup: "uretim", ad: "Seslendirici", gorev: "Gemini TTS + altyazı", renk: "#0891b2", sac: "#111", aktif: uretimAktif,
      balon: uretimAktif ? "Kayıtta…" : "Ses hazır", platform: "uretim"},
    {id: "montajci", grup: "uretim", ad: "Montajcı", gorev: "Görüntü + müzik + kapak", renk: "#4f46e5", sac: "#7c4a1e", aktif: uretimAktif,
      balon: `${(V.gecmis || []).filter(g => g.video_id).length} video yayında`, platform: "uretim"},
    {id: "yonetmen", grup: "uretim", ad: "Görüntü Yönetmeni", gorev: "Çekim planı", renk: "#be123c", sac: "#4a2c1a", aktif: uretimAktif,
      balon: uretimAktif ? "Çekim listesi hazırlanıyor…" : "Her ifadeye bir görüntü", platform: "uretim"},
    {id: "editor", grup: "uretim", ad: "Editör", gorev: "Görüntü seçimi + kalite", renk: "#059669", sac: "#1f1f1f", aktif: uretimAktif,
      balon: (() => { const u = (V.gecmis || []).filter(g => g.goruntu_uyum != null).slice(-5);
        if (!u.length) return "Uyum puanı bekleniyor";
        const ort = u.reduce((a, g) => a + g.goruntu_uyum, 0) / u.length;
        const sorun = (V.gecmis || []).filter(g => g.kalite_sorunlari).length;
        return `Görüntü uyumu ${ort.toFixed(1)}/10${sorun ? ` · ${sorun} kalite uyarısı` : ""}`; })(),
      platform: "uretim", rozet: (V.gecmis || []).slice(-5).filter(g => g.kalite_sorunlari).length},
    {id: "strateji", grup: "yonetim", ad: "Strateji Ajanı", gorev: "Haftalık plan", renk: "#7c3aed", sac: "#c08457", aktif: aktif.has("ajan"),
      balon: V.strateji?.deney ? `Deney: ${V.strateji.deney}` : "Pazartesi planlıyor", platform: "strateji"},
    {id: "youtube", grup: "sosyal", ad: "YouTube Ajanı", gorev: "Yorum, liste, başlık", renk: "#e11d48", sac: "#222", aktif: sosyalAktif,
      balon: V.sdurum?.youtube_izin_eksik ? "İzin bekliyorum" : ytSon ? ytSon.ozet || ytSon.islem : "Yorumları izliyor", platform: "youtube"},
    {id: "tiktok", grup: "sosyal", ad: "TikTok Ajanı", gorev: "Açıklama + hashtag", renk: "#0f766e", sac: "#5b3a29", aktif: uretimAktif,
      balon: tiktokTaslak ? `${tiktokTaslak} taslak paylaşılmayı bekliyor · ${tiktokYayinda} yayında` : `${tiktokYayinda} video TikTok'ta yayında`, platform: "tiktok",
      rozet: tiktokTaslak},
    {id: "instagram", grup: "sosyal", ad: "Instagram Ajanı", gorev: "Reels + yorumlar", renk: "#c026d3", sac: "#e0b16a", aktif: sosyalAktif && !!igSon,
      balon: igSayi ? `${igSayi} Reels yayında${igSon ? " · son: " + (igSon.ozet || "") : ""}` : "İlk Reels sıradaki turda", platform: "instagram"},
    {id: "koordinator", grup: "yonetim", ad: "Koordinatör", gorev: "Rapor + kota", renk: "#ea580c", sac: "#333", aktif: aktif.has("sosyal") || aktif.has("onaylar"),
      balon: `${raporlar} işlem kayıtlı`, platform: "onay"},
    {id: "onay", grup: "yonetim", ad: "Onay Masası", gorev: "Senin kararın", renk: "#d97706", sac: null, aktif: false,
      balon: bekleyenler().length ? `${bekleyenler().length} karar bekliyor` : "Bekleyen yok", platform: "onay",
      rozet: bekleyenler().length},
  ];
  const ar = V.arge, aktifDeney = (V.deneyler || []).find(d => d.durum === "aktif");
  const ilk = (x) => (Array.isArray(x) && x.length ? (typeof x[0] === "string" ? x[0] : `${x[0].hedef}: ${x[0].tahmin || x[0].durum}`) : null);
  _liste.push(
    {id: "arge_lider", grup: "arge", ad: "Ar-Ge Lideri", gorev: "Plan + öncelikler", renk: "#6d28d9", sac: "#3f2a1d", aktif: aktif.has("arge"),
      balon: ar ? `${ar.ozet || "Rapor hazır"}` : "İlk Ar-Ge turu bekleniyor", platform: "strateji", rozet: (ar?.senin_yapacaklarin || []).length},
    {id: "arastirmaci", grup: "arge", ad: "Trend Araştırmacısı", gorev: "Rakip + fırsat avı", renk: "#0d9488", sac: "#1c1917", aktif: aktif.has("arge"),
      balon: ilk(ar?.uzmanlar?.arastirmaci?.firsatlar) || "Nişi tarayacak", platform: "strateji"},
    {id: "gelir", grup: "arge", ad: "Gelir Analisti", gorev: "Para kazanma yolu", renk: "#15803d", sac: "#a16207", aktif: aktif.has("arge"),
      balon: ilk(ar?.gelir_yol_haritasi) || "Eşikleri hesaplayacak", platform: "strateji"},
    {id: "deneyci", grup: "arge", ad: "Deney Uzmanı", gorev: "A/B testleri", renk: "#c2410c", sac: "#57534e", aktif: aktif.has("arge"),
      balon: aktifDeney ? `Deney: ${aktifDeney.ad}` : (V.deneyler || []).length ? "Yeni deney planlıyor" : "İlk deneyi kuracak", platform: "strateji"},
  );
  const md = (V.mudur || []).at(-1), den = (V.denetimler || []).at(-1);
  _liste.unshift({id: "mudur", grup: "yonetim", ad: "Müdür", gorev: "Son denetim + sistem gelişimi", renk: "#0f172a", sac: "#6b7280", aktif: false,
    balon: md?.eklenen ? `Yeni ajan: ${md.eklenen}` : md?.degerlendirme ? md.degerlendirme.slice(0, 90) : "Videoları denetler, kadroyu geliştirir", platform: "onay"});
  for (const d of V.kadro || []) _liste.push({id: d.id, grup: d.grup || "yonetim", ad: d.ad, gorev: d.gorev, renk: d.renk || "#0ea5e9", sac: "#44403c",
    aktif: false, dinamik: true, balon: V.kadroRapor?.[d.id]?.ozet || "İlk görevini bekliyor", platform: "strateji"});
  return canliUygula(_liste);
}

const OFIS = {canvas: null, ctx: null, w: 0, h: 0, kutular: [], t: 0, rafId: 0, yerler: {}};
const AZ_HAREKET = matchMedia("(prefers-reduced-motion: reduce)").matches;
const GRUPLAR = [
  ["yonetim", "YÖNETİM KATI", "#f59e0b"],
  ["uretim", "ÜRETİM BANDI", "#3b82f6"],
  ["sosyal", "SOSYAL MEDYA EKİBİ", "#ec4899"],
  ["arge", "AR-GE LABORATUVARI · büyüme + gelir", "#8b5cf6"],
];
const TEN = ["#f2c9a0", "#e0ac7e", "#c98e62", "#f5d3b3", "#a8714a", "#eac0a0"];

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
  c.addEventListener("mousemove", (e) => {
    const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    c.style.cursor = OFIS.kutular.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ? "pointer" : "default";
  });
  boyutla();
  cancelAnimationFrame(OFIS.rafId);
  const dongu = (t) => { OFIS.t = t / 1000; ofisCiz(); if (!AZ_HAREKET) OFIS.rafId = requestAnimationFrame(dongu); };
  OFIS.rafId = requestAnimationFrame(dongu);
}
const DUVAR_H = 118, BOLUM_H = 30, HUCRE_H = 214;
function boyutla() {
  const c = OFIS.canvas; if (!c) return;
  const w = c.parentElement.clientWidth;
  const sutun = w < 480 ? 2 : w < 820 ? 3 : 4;
  const liste = ajanlar();
  let h = DUVAR_H + 8;
  for (const [g] of GRUPLAR) h += BOLUM_H + Math.ceil(liste.filter(a => a.grup === g).length / sutun) * HUCRE_H + 12;
  const dpr = window.devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr; c.style.height = h + "px";
  OFIS.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Object.assign(OFIS, {w, h, sutun});
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
function koyuMu() {
  const b = renk("--bg").replace("#", "");
  if (b.length < 6) return false;
  const [r, g, bb] = [0, 2, 4].map(i => parseInt(b.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + bb * 114) / 1000 < 100;
}
function tema() {
  return koyuMu()
    ? {zemin1: "#252c38", zemin2: "#29313e", derz: "#1d232d", duvar: "#1a2130", duvarAlt: "#151b27", supurgelik: "#10151e",
       masaUst: "#6b5340", masaOn: "#523f31", masaKenar: "#7d6249", golge: "rgba(0,0,0,.35)", sandalye: "#2b3442",
       ekranKapali: "#1e293b", cerceve: "#0b1220", hali: 0.16}
    : {zemin1: "#eadfce", zemin2: "#e4d7c3", derz: "#d6c6ae", duvar: "#e4ebf4", duvarAlt: "#d6e0ec", supurgelik: "#b8c4d4",
       masaUst: "#d2a679", masaOn: "#b4865a", masaKenar: "#e0b98f", golge: "rgba(40,30,20,.16)", sandalye: "#475569",
       ekranKapali: "#334155", cerceve: "#1f2937", hali: 0.13};
}
function trSaat() { const d = new Date(Date.now() + 3 * 3600e3); return {s: d.getUTCHours(), d: d.getUTCMinutes(), sn: d.getUTCSeconds()}; }

/* --- duvar: pencereler (saate göre gökyüzü), canlı duvar ekranı, saat --- */
function duvarCiz(ctx, w, T, t) {
  const g = ctx.createLinearGradient(0, 0, 0, DUVAR_H);
  g.addColorStop(0, T.duvar); g.addColorStop(1, T.duvarAlt);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, DUVAR_H);
  ctx.fillStyle = T.supurgelik; ctx.fillRect(0, DUVAR_H - 6, w, 6);
  const {s, d, sn} = trSaat(), saat = s + d / 60;
  const gok = saat < 6 || saat >= 20 ? ["#0b1430", "#1e2a5a"] : saat < 8 ? ["#f59e8b", "#fcd9a8"] : saat < 17 ? ["#5aa9f0", "#bfe3ff"] : ["#f08a5d", "#6d5aa8"];
  const gece = saat < 6 || saat >= 20;
  const ekranW = w < 560 ? w - 96 : Math.min(320, w * 0.42), ekranX = w < 560 ? 76 : (w - ekranW) / 2;
  // pencereler: ekranın iki yanında
  const pw = 74, ph = 62, py = 18;
  const pencereler = [];
  for (let x = 18; x + pw < ekranX - 50; x += pw + 22) pencereler.push(x);
  for (let x = w - 18 - pw; x > ekranX + ekranW + 50; x -= pw + 22) pencereler.push(x);
  for (const px of pencereler) {
    const gg = ctx.createLinearGradient(0, py, 0, py + ph); gg.addColorStop(0, gok[0]); gg.addColorStop(1, gok[1]);
    ctx.fillStyle = T.cerceve; yuvarlak(ctx, px - 4, py - 4, pw + 8, ph + 8, 6); ctx.fill();
    ctx.fillStyle = gg; ctx.fillRect(px, py, pw, ph);
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    if (gece) {
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 7; i++) { const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + i * 2.1 + px)); ctx.globalAlpha = a;
        ctx.fillRect(px + (i * 29 + px * 7) % pw, py + (i * 17 + px) % (ph - 20), 1.6, 1.6); }
      ctx.globalAlpha = 1; ctx.fillStyle = "#f8f1d0"; ctx.beginPath(); ctx.arc(px + pw - 18, py + 16, 7, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,.85)";
      const bx = px + ((t * 6 + px) % (pw + 40)) - 30;
      ctx.beginPath(); ctx.arc(bx, py + 20, 8, 0, Math.PI * 2); ctx.arc(bx + 10, py + 17, 10, 0, Math.PI * 2); ctx.arc(bx + 21, py + 21, 7, 0, Math.PI * 2); ctx.fill();
    }
    // uzak şehir silueti
    ctx.fillStyle = gece ? "#141b33" : "rgba(60,80,110,.35)";
    for (let i = 0; i < 6; i++) { const bh = 12 + ((i * 37 + px) % 22); ctx.fillRect(px + i * 13, py + ph - bh, 11, bh);
      if (gece) { ctx.fillStyle = "#fde68a"; ctx.fillRect(px + i * 13 + 3, py + ph - bh + 4, 2, 2); ctx.fillStyle = "#141b33"; } }
    ctx.restore();
    ctx.fillStyle = T.cerceve; ctx.fillRect(px + pw / 2 - 1.5, py, 3, ph); ctx.fillRect(px, py + ph / 2 - 1.5, pw, 3);
  }
  // duvar ekranı
  const ey = 12, eh = DUVAR_H - 30;
  ctx.fillStyle = "#0b1220"; yuvarlak(ctx, ekranX - 6, ey - 6, ekranW + 12, eh + 12, 10); ctx.fill();
  const eg = ctx.createLinearGradient(ekranX, ey, ekranX + ekranW, ey + eh); eg.addColorStop(0, "#0f1d3a"); eg.addColorStop(1, "#16294f");
  ctx.fillStyle = eg; yuvarlak(ctx, ekranX, ey, ekranW, eh, 6); ctx.fill();
  const liste = ajanlar(), calisan = liste.filter(a => a.aktif);
  ctx.textAlign = "left"; ctx.fillStyle = "#e2e8f0"; ctx.font = "700 12px system-ui";
  ctx.fillText("GLOBAL SAYAR", ekranX + 12, ey + 18);
  const canliRenk = calisan.length ? `rgba(34,197,94,${0.55 + 0.45 * Math.abs(Math.sin(t * 3))})` : "#64748b";
  ctx.font = "600 10px system-ui"; const durumYazi = calisan.length ? "CANLI" : "BEKLEMEDE", dyw = ctx.measureText(durumYazi).width;
  ctx.fillStyle = canliRenk; ctx.beginPath(); ctx.arc(ekranX + ekranW - 18 - dyw, ey + 14, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(durumYazi, ekranX + ekranW - 10 - dyw, ey + 18);
  const son = (V.istat || []).at(-1) || {};
  const bugun = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const bugunYuk = (V.gecmis || []).filter(g => g.video_id && new Date(new Date(g.tarih).getTime() + 3 * 3600e3).toISOString().slice(0, 10) === bugun).length;
  const kutucuk = [["▶ Abone", son.youtube_abone ?? "–"], ["◎ Takipçi", son.instagram_takipci ?? "–"], ["Bugün", `${bugunYuk}/5`]];
  const kw = (ekranW - 24 - 16) / 3;
  kutucuk.forEach(([ad, deger], i) => {
    const kx = ekranX + 12 + i * (kw + 8);
    ctx.fillStyle = "rgba(255,255,255,.07)"; yuvarlak(ctx, kx, ey + 26, kw, 32, 5); ctx.fill();
    ctx.fillStyle = "#94a3b8"; ctx.font = "9px system-ui"; ctx.fillText(ad, kx + 6, ey + 38);
    ctx.fillStyle = "#f8fafc"; ctx.font = "700 12px system-ui"; ctx.fillText(satirlaraBol(ctx, String(deger), kw - 8, 1)[0] || "", kx + 6, ey + 53);
  });
  ctx.fillStyle = "#cbd5e1"; ctx.font = "10px system-ui";
  const alt = calisan.length ? `Çalışıyor: ${calisan.map(a => a.ad).join(", ")}` : `Sıradaki tur: ${siradakiTur()}`;
  ctx.fillText(satirlaraBol(ctx, alt, ekranW - 24, 1)[0] || "", ekranX + 12, ey + eh - 8);
  // analog saat
  const sx = w < 560 ? 38 : ekranX - 34, sy = 44;
  if (sx > 30 && !pencereler.some(p => Math.abs(p + pw / 2 - sx) < pw)) {
    ctx.fillStyle = "#f8fafc"; ctx.strokeStyle = T.cerceve; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx, sy, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const el_ = (aci, boy, kal) => { ctx.lineWidth = kal; ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.sin(aci) * boy, sy - Math.cos(aci) * boy); ctx.stroke(); };
    ctx.strokeStyle = "#0f172a"; el_((s % 12 + d / 60) * Math.PI / 6, 8, 2.5); el_(d * Math.PI / 30, 12, 1.8);
    ctx.strokeStyle = "#dc2626"; el_(sn * Math.PI / 30, 13, 1);
  }
}

/* --- zemin: ahşap parke --- */
function zeminCiz(ctx, w, h, T) {
  ctx.fillStyle = T.zemin1; ctx.fillRect(0, DUVAR_H, w, h - DUVAR_H);
  const ph = 22;
  for (let y = DUVAR_H, satir = 0; y < h; y += ph, satir++) {
    for (let x = -((satir * 53) % 120), i = 0; x < w; x += 120, i++) {
      ctx.fillStyle = (i + satir) % 3 === 0 ? T.zemin2 : T.zemin1; ctx.fillRect(x, y, 120, ph);
      ctx.fillStyle = T.derz; ctx.fillRect(x, y, 1, ph);
    }
    ctx.fillStyle = T.derz; ctx.fillRect(0, y, w, 1);
  }
  const gol = ctx.createLinearGradient(0, DUVAR_H, 0, DUVAR_H + 26); gol.addColorStop(0, T.golge); gol.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gol; ctx.fillRect(0, DUVAR_H, w, 26);
}

function bitki(ctx, x, y, olcek = 1) {
  ctx.fillStyle = "#a16207"; yuvarlak(ctx, x - 9 * olcek, y - 14 * olcek, 18 * olcek, 16 * olcek, 3); ctx.fill();
  ctx.fillStyle = "#16a34a";
  for (const [dx, dy, r] of [[-6, -22, 7], [5, -26, 8], [0, -33, 7], [-9, -30, 5], [9, -18, 5]]) {
    ctx.beginPath(); ctx.arc(x + dx * olcek, y + dy * olcek, r * olcek, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(x + 3 * olcek, y - 29 * olcek, 4 * olcek, 0, Math.PI * 2); ctx.fill();
}

/* --- monitörde işe göre görüntü --- */
function ekranIcerik(ctx, a, x, y, w, h, t, i) {
  const ak = a.aktif;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (!ak) {
    ctx.fillStyle = "#1e293b"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = a.renk; ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t + i);
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore(); return;
  }
  ctx.fillStyle = "#0f172a"; ctx.fillRect(x, y, w, h);
  const id = a.id;
  if (id === "seslendirici") {
    ctx.fillStyle = "#22d3ee";
    for (let k = 0; k < 11; k++) { const bh = 3 + Math.abs(Math.sin(t * 9 + k * 0.8)) * (h - 8); ctx.fillRect(x + 3 + k * (w - 6) / 11, y + (h - bh) / 2, 2.4, bh); }
  } else if (id === "montajci") {
    const renkler = ["#6366f1", "#f59e0b", "#10b981", "#ec4899"];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { ctx.fillStyle = renkler[(k + r) % 4]; ctx.fillRect(x + 3 + k * 10 + r * 3, y + 4 + r * 7, 8, 5); }
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(x + 3 + ((t * 14) % (w - 6)), y + 2, 1.5, h - 4);
  } else if (id === "yonetmen") {
    ctx.strokeStyle = "#fda4af"; ctx.lineWidth = 1.2; ctx.strokeRect(x + 6, y + 4, w - 12, h - 8);
    ctx.beginPath(); ctx.moveTo(x + w / 3, y + 4); ctx.lineTo(x + w / 3, y + h - 4); ctx.moveTo(x + 2 * w / 3, y + 4); ctx.lineTo(x + 2 * w / 3, y + h - 4); ctx.stroke();
    ctx.fillStyle = "#f43f5e"; ctx.beginPath(); ctx.arc(x + 10, y + 8, 2 + Math.abs(Math.sin(t * 4)), 0, Math.PI * 2); ctx.fill();
  } else if (id === "editor") {
    const sec = Math.floor(t * 1.5) % 6;
    for (let k = 0; k < 6; k++) { ctx.fillStyle = k === sec ? "#34d399" : "#334155"; ctx.fillRect(x + 4 + (k % 3) * 14, y + 4 + Math.floor(k / 3) * 11, 12, 9); }
  } else if (id === "strateji") {
    ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let k = 0; k <= 8; k++) { const px = x + 3 + k * (w - 6) / 8, py = y + h - 4 - (k / 8) * (h - 10) - Math.sin(k + t * 2) * 3; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
  } else if (id === "youtube" || id === "tiktok" || id === "instagram") {
    const bg = {youtube: "#dc2626", tiktok: "#0f172a", instagram: "#c026d3"}[id];
    ctx.fillStyle = bg; yuvarlak(ctx, x + w / 2 - 11, y + h / 2 - 8, 22, 16, 4); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(x + w / 2 - 3, y + h / 2 - 4); ctx.lineTo(x + w / 2 + 5, y + h / 2); ctx.lineTo(x + w / 2 - 3, y + h / 2 + 4); ctx.fill();
    ctx.fillStyle = "#f472b6"; for (let k = 0; k < 3; k++) { const yy = y + h - ((t * 12 + k * 9) % h); ctx.fillText ? ctx.fillRect(x + 6 + k * 15, yy, 3, 3) : 0; }
  } else if (id === "gelir") {
    ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let k = 0; k <= 6; k++) { const px = x + 4 + k * (w - 8) / 6, py = y + h - 5 - (k * k / 36) * (h - 12) + Math.sin(t * 3 + k) * 1.5; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke(); ctx.fillStyle = "#facc15"; ctx.font = "700 10px system-ui"; ctx.textAlign = "left"; ctx.fillText("₺", x + 4, y + 11);
  } else if (id === "deneyci") {
    const a1 = 6 + Math.abs(Math.sin(t * 2)) * (h - 12), b1 = 6 + Math.abs(Math.sin(t * 2 + 1.3)) * (h - 12);
    ctx.fillStyle = "#fb923c"; ctx.fillRect(x + 8, y + h - 3 - a1, 10, a1); ctx.fillStyle = "#60a5fa"; ctx.fillRect(x + 24, y + h - 3 - b1, 10, b1);
    ctx.fillStyle = "#e2e8f0"; ctx.font = "700 8px system-ui"; ctx.textAlign = "left"; ctx.fillText("A", x + 10, y + 9); ctx.fillText("B", x + 26, y + 9);
  } else if (id === "arastirmaci") {
    ctx.fillStyle = "#334155"; for (let k = 0; k < 4; k++) ctx.fillRect(x + 4, y + 4 + k * 6, w - 10, 3);
    const mx = x + 8 + ((t * 10) % (w - 16)), my = y + 12 + Math.sin(t * 2) * 5;
    ctx.strokeStyle = "#5eead4"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx + 4, my + 4); ctx.lineTo(mx + 8, my + 8); ctx.stroke();
  } else if (id === "yonetici") {
    ctx.fillStyle = "#fbbf24"; for (let k = 0; k < 4; k++) { const bh = 4 + ((k * 7 + Math.floor(t * 2)) % 14); ctx.fillRect(x + 6 + k * 9, y + h - 3 - bh, 6, bh); }
    ctx.fillStyle = "#94a3b8"; ctx.fillRect(x + w - 14, y + 4, 10, 2); ctx.fillRect(x + w - 14, y + 8, 7, 2);
  } else {
    ctx.fillStyle = "rgba(148,197,255,.9)";
    for (let s = 0; s < 4; s++) ctx.fillRect(x + 4 + (s % 2) * 4, y + 4 + s * 6, 6 + ((t * 22 + s * 9 + i * 5) % (w - 16)), 2);
  }
  ctx.restore();
}

/* --- karakter --- */
function karakterCiz(ctx, a, cx, by, t, i, T) {
  const ten = TEN[i % TEN.length];
  const nefes = a.aktif ? Math.sin(t * 10 + i) * 1.2 : Math.sin(t * 1.6 + i) * 0.8;
  const y = by + nefes;
  // sandalye sırtlığı
  ctx.fillStyle = T.sandalye; yuvarlak(ctx, cx - 22, by - 6, 44, 50, 12); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.06)"; yuvarlak(ctx, cx - 18, by - 2, 36, 18, 9); ctx.fill();
  // gövde
  ctx.fillStyle = a.renk; yuvarlak(ctx, cx - 18, y + 14, 36, 40, 12); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.moveTo(cx - 7, y + 14); ctx.lineTo(cx, y + 23); ctx.lineTo(cx + 7, y + 14); ctx.fill();
  if (a.id === "deneyci") { ctx.fillStyle = "#f8fafc"; yuvarlak(ctx, cx - 18, y + 14, 36, 40, 12); ctx.fill(); ctx.fillStyle = a.renk; ctx.fillRect(cx - 3, y + 16, 6, 30); }
  if (a.id === "yonetici" || a.id === "mudur" || a.id === "gelir" || a.id === "arge_lider") { ctx.fillStyle = a.id === "gelir" ? "#facc15" : "#b91c1c"; ctx.beginPath(); ctx.moveTo(cx - 2.5, y + 18); ctx.lineTo(cx + 2.5, y + 18); ctx.lineTo(cx + 3.5, y + 34); ctx.lineTo(cx, y + 38); ctx.lineTo(cx - 3.5, y + 34); ctx.fill(); }
  // boyun + baş
  ctx.fillStyle = ten; ctx.fillRect(cx - 4, y + 8, 8, 8);
  ctx.beginPath(); ctx.arc(cx, y, 13, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - 13, y + 1, 3, 0, Math.PI * 2); ctx.arc(cx + 13, y + 1, 3, 0, Math.PI * 2); ctx.fill();
  // saç (4 stil)
  ctx.fillStyle = a.sac;
  const stil = i % 4;
  ctx.beginPath(); ctx.arc(cx, y - 2, 13.5, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
  if (stil === 1) { ctx.beginPath(); ctx.arc(cx, y - 15, 6, 0, Math.PI * 2); ctx.fill(); }                 // topuz
  if (stil === 2) { ctx.fillRect(cx - 14, y - 3, 5, 18); ctx.fillRect(cx + 9, y - 3, 5, 18); }             // uzun
  if (stil === 3) { for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(cx + k * 5, y - 12, 4.5, 0, Math.PI * 2); ctx.fill(); } } // kıvırcık
  // gözler: göz kırpma; aktifken monitöre (sola) bakar
  const kirp = (t + i * 0.7) % 4.2 < 0.12;
  const bak = a.aktif ? -1.5 : 0;
  ctx.fillStyle = "#1f2937";
  if (kirp) { ctx.fillRect(cx - 6, y + 1, 4, 1.2); ctx.fillRect(cx + 2, y + 1, 4, 1.2); }
  else { ctx.beginPath(); ctx.arc(cx - 4 + bak, y + 1, 1.7, 0, Math.PI * 2); ctx.arc(cx + 4 + bak, y + 1, 1.7, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = "#7c2d12"; ctx.lineWidth = 1.2; ctx.beginPath();
  ctx.arc(cx + bak / 2, y + 5, a.aktif ? 3 : 2.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  // aksesuarlar
  ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1.3;
  if (a.id === "editor" || a.id === "strateji" || a.id === "arastirmaci" || a.id === "deneyci") { ctx.beginPath(); ctx.arc(cx - 4, y + 1, 3.4, 0, Math.PI * 2); ctx.moveTo(cx + 7.4, y + 1); ctx.arc(cx + 4, y + 1, 3.4, 0, Math.PI * 2); ctx.moveTo(cx - 0.6, y + 1); ctx.lineTo(cx + 0.6, y + 1); ctx.stroke(); }
  if (a.id === "seslendirici") { ctx.lineWidth = 2.5; ctx.strokeStyle = "#111827"; ctx.beginPath(); ctx.arc(cx, y - 1, 15, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.fillStyle = "#111827"; ctx.fillRect(cx - 17, y - 2, 5, 9); ctx.fillRect(cx + 12, y - 2, 5, 9);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - 14, y + 6); ctx.quadraticCurveTo(cx - 12, y + 11, cx - 5, y + 9); ctx.stroke(); }
  if (a.id === "yonetmen") { ctx.fillStyle = "#1f2937"; ctx.beginPath(); ctx.ellipse(cx + 1, y - 11, 14, 5, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 1, y - 14, 3, 0, Math.PI * 2); ctx.fill(); }
  // kollar: aktifken klavyede yazar, değilken masada durur
  const kol = a.aktif ? Math.sin(t * 18 + i) * 2.5 : 0;
  ctx.fillStyle = a.renk;
  yuvarlak(ctx, cx - 25, y + 22, 9, 24, 4); ctx.fill(); yuvarlak(ctx, cx + 16, y + 22, 9, 24, 4); ctx.fill();
  ctx.fillStyle = ten;
  ctx.beginPath(); ctx.arc(cx - 15, by + 50 + kol, 4.2, 0, Math.PI * 2); ctx.arc(cx + 15, by + 50 - kol, 4.2, 0, Math.PI * 2); ctx.fill();
}

function ofisCiz() {
  const {ctx, w, h, sutun} = OFIS; if (!ctx) return;
  const t = AZ_HAREKET ? 0 : OFIS.t, liste = ajanlar(), T = tema();
  zeminCiz(ctx, w, h, T);
  duvarCiz(ctx, w, T, t);
  OFIS.kutular = []; OFIS.yerler = {};
  const hw = w / sutun;
  let y0 = DUVAR_H + 8, sira = 0;
  for (const [grup, baslik, grenk] of GRUPLAR) {
    const uyeler = liste.filter(a => a.grup === grup);
    if (!uyeler.length) continue;
    const satir = Math.ceil(uyeler.length / sutun), bolumH = BOLUM_H + satir * HUCRE_H;
    // bölüm halısı + başlık
    ctx.fillStyle = grenk; ctx.globalAlpha = T.hali; yuvarlak(ctx, 8, y0, w - 16, bolumH, 16); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = grenk; ctx.globalAlpha = 0.35; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; yuvarlak(ctx, 8, y0, w - 16, bolumH, 16); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = grenk; yuvarlak(ctx, 20, y0 + 7, ctx.measureText(baslik).width + 40, 18, 9); ctx.fill();
    ctx.font = "700 10px system-ui"; ctx.textAlign = "left"; ctx.fillStyle = "#fff";
    const calisanSay = uyeler.filter(a => a.aktif).length;
    ctx.fillText(baslik + (calisanSay ? `  ·  ${calisanSay} ÇALIŞIYOR` : ""), 30, y0 + 20);
    bitki(ctx, w - 30, y0 + 30, 0.8);
    uyeler.forEach((a, j) => {
      const i = sira++;
      const cx = (j % sutun) * hw + hw / 2, top = y0 + BOLUM_H + Math.floor(j / sutun) * HUCRE_H;
      masaCiz(ctx, a, cx, top, Math.min(hw, 230), t, i, T);
    });
    y0 += bolumH + 12;
  }
  // aktif ajanlar arasında dolaşan evrak (üretim bandı akışı)
  const aktifler = liste.filter(a => a.aktif && OFIS.yerler[a.id]);
  if (aktifler.length >= 2 && !AZ_HAREKET) {
    const n = aktifler.length, faz = (t * 0.35) % n, k = Math.floor(faz), f = faz - k;
    const A = OFIS.yerler[aktifler[k].id], B = OFIS.yerler[aktifler[(k + 1) % n].id];
    const x = A.x + (B.x - A.x) * f, y = A.y + (B.y - A.y) * f - Math.sin(f * Math.PI) * 40;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(B.y - A.y, B.x - A.x) * 0.3);
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(10, 0); ctx.lineTo(-9, 5); ctx.lineTo(-5, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function masaCiz(ctx, a, cx, top, kw, t, i, T) {
  const secili = V.secili === a.id;
  const kx = cx - kw / 2 + 6, ky = top + 2, kwi = kw - 12, kh = HUCRE_H - 8;
  OFIS.kutular.push({x: kx, y: ky, w: kwi, h: kh, ajan: a});
  if (secili) {
    ctx.fillStyle = renk("--accent-soft"); ctx.globalAlpha = 0.7; yuvarlak(ctx, kx, ky, kwi, kh, 14); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = renk("--accent"); ctx.lineWidth = 2; yuvarlak(ctx, kx, ky, kwi, kh, 14); ctx.stroke();
  }
  const masaY = top + 124, masaW = Math.min(150, kwi - 10);
  // zemin gölgesi
  ctx.fillStyle = T.golge; ctx.beginPath(); ctx.ellipse(cx, masaY + 44, masaW / 2 + 6, 9, 0, 0, Math.PI * 2); ctx.fill();
  // aktif halo
  if (a.aktif) {
    const hg = ctx.createRadialGradient(cx, masaY - 10, 10, cx, masaY - 10, 80);
    hg.addColorStop(0, `rgba(34,197,94,${0.18 + 0.08 * Math.sin(t * 3 + i)})`); hg.addColorStop(1, "rgba(34,197,94,0)");
    ctx.fillStyle = hg; ctx.fillRect(cx - 80, masaY - 90, 160, 160);
  }
  if (a.sac !== null) karakterCiz(ctx, a, cx + 14, masaY - 54, t, i, T);
  // masa: üst yüzey + ön panel + ayaklar
  ctx.fillStyle = T.masaOn; ctx.fillRect(cx - masaW / 2 + 6, masaY + 30, 6, 12); ctx.fillRect(cx + masaW / 2 - 12, masaY + 30, 6, 12);
  ctx.fillStyle = T.masaUst; yuvarlak(ctx, cx - masaW / 2, masaY, masaW, 14, 4); ctx.fill();
  ctx.fillStyle = T.masaKenar; ctx.fillRect(cx - masaW / 2 + 3, masaY + 1, masaW - 6, 2);
  ctx.fillStyle = T.masaOn; yuvarlak(ctx, cx - masaW / 2 + 2, masaY + 12, masaW - 4, 22, 4); ctx.fill();
  // isim plaketi
  ctx.font = "700 10.5px system-ui";
  const pw = Math.min(masaW - 26, ctx.measureText(a.ad).width + 16);
  ctx.fillStyle = a.id === "yonetici" ? "#fbbf24" : "#f8fafc"; yuvarlak(ctx, cx - pw / 2, masaY + 16, pw, 14, 3); ctx.fill();
  ctx.fillStyle = "#0f172a"; ctx.textAlign = "center"; ctx.fillText(satirlaraBol(ctx, a.ad, pw - 6, 1)[0] || a.ad, cx, masaY + 26.5);
  // durum lambası
  const lamba = a.aktif ? "#22c55e" : a.rozet ? "#f59e0b" : "#64748b";
  if (a.aktif) { ctx.fillStyle = `rgba(34,197,94,${0.3 + 0.3 * Math.sin(t * 5 + i)})`; ctx.beginPath(); ctx.arc(cx + masaW / 2 - 10, masaY + 23, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = lamba; ctx.beginPath(); ctx.arc(cx + masaW / 2 - 10, masaY + 23, 3.5, 0, Math.PI * 2); ctx.fill();
  if (a.sac !== null) {
    // klavye + monitör + kupa
    ctx.fillStyle = "#cbd5e1"; yuvarlak(ctx, cx + 1, masaY + 3, 28, 6, 2); ctx.fill();
    ctx.fillStyle = "#94a3b8"; for (let k = 0; k < 5; k++) ctx.fillRect(cx + 3 + k * 5, masaY + 4.5, 3, 1.4);
    const mx = cx - masaW / 2 + 10, my = masaY - 36;
    ctx.fillStyle = T.cerceve; ctx.fillRect(mx + 21, masaY - 4, 6, 5); ctx.fillRect(mx + 15, masaY + 0, 18, 3);
    ctx.fillStyle = T.cerceve; yuvarlak(ctx, mx, my, 48, 34, 4); ctx.fill();
    ekranIcerik(ctx, a, mx + 3, my + 3, 42, 26, t, i);
    if (a.aktif) { ctx.fillStyle = "rgba(125,211,252,.12)"; ctx.beginPath(); ctx.moveTo(mx + 45, my + 3); ctx.lineTo(cx + 2, my - 6); ctx.lineTo(cx + 2, my + 40); ctx.lineTo(mx + 45, my + 29); ctx.fill(); }
    const kupaX = cx + masaW / 2 - 18;
    ctx.fillStyle = "#f8fafc"; yuvarlak(ctx, kupaX, masaY - 8, 9, 10, 2); ctx.fill();
    ctx.strokeStyle = "#f8fafc"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(kupaX + 10, masaY - 3, 3, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    if (a.aktif) { ctx.strokeStyle = "rgba(203,213,225,.7)"; ctx.lineWidth = 1.2;
      for (let k = 0; k < 2; k++) { ctx.beginPath(); const sy = masaY - 12 - ((t * 10 + k * 6) % 12);
        ctx.moveTo(kupaX + 3 + k * 3, masaY - 10); ctx.quadraticCurveTo(kupaX + 7 + k * 3, sy + 4, kupaX + 3 + k * 3, sy); ctx.stroke(); } }
    if (i % 3 === 1) bitki(ctx, cx - masaW / 2 - 4, masaY + 40, 0.55);
  } else {
    // onay masası: evrak tepsisi + damga + zil
    const n = Math.min(7, a.rozet || 0);
    ctx.fillStyle = "#475569"; yuvarlak(ctx, cx - 30, masaY - 6, 44, 8, 2); ctx.fill();
    for (let s = 0; s < n; s++) { ctx.fillStyle = s % 2 ? "#f8fafc" : "#e2e8f0"; ctx.fillRect(cx - 27 + (s % 2), masaY - 9 - s * 3.2, 38, 3); }
    ctx.fillStyle = "#b91c1c"; yuvarlak(ctx, cx + 24, masaY - 16, 10, 12, 2); ctx.fill(); ctx.fillStyle = "#1f2937"; ctx.fillRect(cx + 22, masaY - 4, 14, 4);
    ctx.fillStyle = "#eab308"; ctx.beginPath(); ctx.arc(cx - 46, masaY - 4, 6, Math.PI, 0); ctx.fill(); ctx.fillRect(cx - 53, masaY - 4, 14, 2.5);
    ctx.font = "26px system-ui"; ctx.textAlign = "center"; ctx.fillText(n ? "📥" : "✅", cx, masaY - 30);
  }
  OFIS.yerler[a.id] = {x: cx, y: masaY - 30};
  // görev yazısı
  ctx.textAlign = "center"; ctx.fillStyle = renk("--muted"); ctx.font = "11px system-ui";
  ctx.fillText(satirlaraBol(ctx, a.gorev, kwi - 10, 1)[0] || "", cx, masaY + 60);
  // rozet
  if (a.rozet) {
    const rx = cx - masaW / 2 + 56, ry = masaY - 40;
    ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(rx, ry, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "700 10px system-ui"; ctx.textAlign = "center"; ctx.fillText(String(a.rozet), rx, ry + 3.5);
  }
  // konuşma balonu
  ctx.font = "11px system-ui";
  const bw = Math.min(kwi - 6, 200), satirlar = satirlaraBol(ctx, a.balon, bw - 22, 2);
  const bh = 12 + satirlar.length * 14, bx = cx - bw / 2, byy = top + 6;
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.fillStyle = renk("--panel"); yuvarlak(ctx, bx, byy, bw, bh, 9); ctx.fill(); ctx.restore();
  ctx.strokeStyle = a.aktif ? a.renk : renk("--line"); ctx.lineWidth = a.aktif ? 1.5 : 1; yuvarlak(ctx, bx, byy, bw, bh, 9); ctx.stroke();
  ctx.fillStyle = a.renk; yuvarlak(ctx, bx + 4, byy + 5, 3, bh - 10, 2); ctx.fill();
  ctx.fillStyle = renk("--panel"); ctx.beginPath(); ctx.moveTo(cx + 6, byy + bh - 0.5); ctx.lineTo(cx + 16, byy + bh - 0.5); ctx.lineTo(cx + 12, byy + bh + 7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = renk("--fg"); ctx.textAlign = "center";
  satirlar.forEach((s, j) => ctx.fillText(s, cx + 3, byy + 17 + j * 14));
  if (a.aktif) { ctx.fillStyle = a.renk; for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 6 - k * 0.8));
    ctx.beginPath(); ctx.arc(bx + bw - 22 + k * 6, byy + bh - 6, 1.8, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
}

function cekmeceCiz() {
  const k = document.getElementById("cekmece"); if (!k) return;
  k.replaceChildren();
  const a = ajanlar().find(x => x.id === V.secili);
  if (!a) { k.append(el("div", {class: "alt", text: "Bir ajana dokun: ne yaptığını ve raporlarını gör."})); return; }
  k.append(el("h2", {}, ikon(a.platform), " ", a.ad), el("p", {class: "alt", text: `${a.gorev} · ${a.aktif ? "şu an çalışıyor" : "beklemede"}`}));
  let kayitlar = [];
  if (a.id === "mudur" || a.dinamik) { mudurCekmece(k, a); return; }
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
  if (a.grup === "arge") { argeCekmece(k, a); return; }
  const olaylar = (V.canli || []).filter(o => (OLAY_AJAN[o.ajan] || o.ajan) === a.id).slice(-6).reverse();
  if (olaylar.length) {
    k.append(el("div", {class: "etiket", text: "Canlı etkinlik", style: "margin-top:6px"}));
    for (const o of olaylar) k.append(el("div", {class: "alt", style: "overflow-wrap:anywhere"},
      `${o.durum === "hata" ? "⚠️" : o.durum === "bitti" ? "✓" : "●"} ${o.mesaj} · ${sure(o.t)}`));
    k.append(el("div", {class: "etiket", text: "Sonuçlar", style: "margin-top:10px"}));
  }
  if (!kayitlar.length) k.append(el("div", {class: "bos", text: "Henüz kayıt yok."}));
  for (const r of kayitlar) k.append(el("div", {class: "satir"}, ikon(a.platform),
    el("div", {class: "ic"}, el("b", {text: r.b}), el("div", {class: "m alt", text: `${r.m || ""}`}), el("div", {class: "alt", text: sure(r.t)}))));
  if (a.id === "onay" && kayitlar.length) k.append(el("button", {class: "dugme birincil", text: "Onaylara git", onclick: () => sekmeAc("onaylar")}));
}

function mudurCekmece(k, a) {
  const olaylar = (V.canli || []).filter(o => o.ajan === a.id).slice(-6).reverse();
  if (olaylar.length) {
    k.append(el("div", {class: "etiket", text: "Canlı etkinlik"}));
    for (const o of olaylar) k.append(el("div", {class: "alt", style: "overflow-wrap:anywhere"}, `${o.durum === "hata" ? "⚠️" : o.durum === "bitti" ? "✓" : "●"} ${o.mesaj} · ${sure(o.t)}`));
  }
  const bolum = (baslik, maddeler) => { if (!maddeler?.length) return;
    k.append(el("div", {class: "etiket", text: baslik, style: "margin-top:10px"}));
    for (const m of maddeler) k.append(el("div", {class: "alt", style: "overflow-wrap:anywhere;margin:3px 0"}, "• " + m)); };
  if (a.dinamik) {
    const d = (V.kadro || []).find(x => x.id === a.id), r = V.kadroRapor?.[a.id];
    k.append(el("p", {style: "margin:8px 0", text: r?.ozet || "Henüz rapor yok; Müdür'ün bir sonraki turunda çalışacak."}));
    bolum("Öneriler", r?.oneriler); if (d?.neden) bolum("Müdür neden ekledi", [d.neden]);
    return;
  }
  const md = V.mudur || [];
  if (!md.length) { k.append(el("div", {class: "bos", text: "Müdür henüz değerlendirme yapmadı. Çarşamba ve cumartesi çalışır; Yönetici'ye “Müdür turunu çalıştır” diyebilirsin. Her video yayından önce Müdür'ün son denetiminden geçer."})); return; }
  const s = md.at(-1);
  k.append(el("p", {style: "margin:8px 0", text: s.degerlendirme || ""}), el("div", {class: "alt", text: `Son değerlendirme: ${sure(s.t)}`}));
  bolum("Öncelikler", s.oncelikler);
  if (s.eklenen) bolum("Bu turda kadroya eklenen", [s.eklenen]);
  if (s.emekli?.length) bolum("Emekli edilen", s.emekli);
  bolum("Kadro (Müdür'ün açtığı ajanlar)", (V.kadro || []).map(d => `${d.ad} — ${d.gorev}`));
}

function argeCekmece(k, a) {
  const ar = V.arge, olaylar = (V.canli || []).filter(o => o.ajan === a.id).slice(-6).reverse();
  if (olaylar.length) {
    k.append(el("div", {class: "etiket", text: "Canlı etkinlik"}));
    for (const o of olaylar) k.append(el("div", {class: "alt", style: "overflow-wrap:anywhere"}, `${o.durum === "bitti" ? "✓" : "●"} ${o.mesaj} · ${sure(o.t)}`));
  }
  if (!ar) { k.append(el("div", {class: "bos", text: "Ar-Ge ekibi henüz rapor yazmadı. Çarşamba ve cumartesi 12:37'de çalışır; Yönetici'ye “Ar-Ge ekibini çalıştır” diyebilirsin."})); return; }
  const bolum = (baslik, maddeler) => { if (!maddeler?.length) return;
    k.append(el("div", {class: "etiket", text: baslik, style: "margin-top:10px"}));
    for (const m of maddeler) k.append(el("div", {class: "alt", style: "overflow-wrap:anywhere;margin:3px 0"}, "• " + (typeof m === "string" ? m : `${m.hedef} — ${m.durum} → ${m.tahmin}`))); };
  k.append(el("p", {style: "margin:8px 0", text: ar.ozet || ""}), el("div", {class: "alt", text: `Son rapor: ${sure(ar.tarih)}`}));
  const u = ar.uzmanlar || {};
  if (a.id === "arge_lider") { bolum("Öncelikler", ar.oncelikler); bolum("✋ Senin yapacakların", ar.senin_yapacaklarin); bolum("Gelir yol haritası", ar.gelir_yol_haritasi); }
  if (a.id === "arastirmaci") { k.append(el("p", {class: "alt", text: u.arastirmaci?.ozet || ""})); bolum("Fırsatlar", u.arastirmaci?.firsatlar); bolum("Öneriler", u.arastirmaci?.oneriler);
    bolum("Üretime verilen yönerge", ar.icerik_yonergesi?.firsat_konulari); }
  if (a.id === "gelir") { k.append(el("p", {class: "alt", text: u.gelir?.ozet || ""})); bolum("Gelir yol haritası", ar.gelir_yol_haritasi);
    bolum("Gelir kanalları", u.gelir?.firsatlar);
    bolum("Platform eşikleri", Object.values(ar.esikler || {}).map(e => `${e.ad}: ${[e.abone_ilerleme && "abone " + e.abone_ilerleme,
      e.shorts_90g_ilerleme && "Shorts 90 gün " + e.shorts_90g_ilerleme, e.abone_icin_tahmini_gun && "~" + e.abone_icin_tahmini_gun + " gün"].filter(Boolean).join(" · ") || e.kosul}`)); }
  if (a.id === "deneyci") { k.append(el("p", {class: "alt", text: u.deneyci?.ozet || ""}));
    for (const d of (V.deneyler || []).slice().reverse().slice(0, 5)) k.append(el("div", {class: "satir"}, ikon("strateji"), el("div", {class: "ic"},
      el("b", {text: `${d.durum === "aktif" ? "🧪 " : "✓ "}${d.ad}`}), el("div", {class: "alt", text: `A: ${d.A} · B: ${d.B}`}),
      el("div", {class: "alt", text: d.durum === "aktif" ? `Hedef: varyant başına ${d.hedef_video} olgun video · ${sure(d.baslangic)} başladı` : `Kazanan: ${d.kazanan} — ${d.ozet || ""}`})))); }
  k.append(el("button", {class: "dugme", style: "margin-top:10px", text: "Tüm Ar-Ge raporları", onclick: () => sekmeAc("raporlar")}));
}

function canliSerit() {
  const k = el("div", {class: "kart", id: "canli-serit", style: "margin-bottom:12px;display:flex;flex-direction:column;gap:6px"});
  const liste = ajanlar();
  const calisan = liste.filter(a => a.aktif);
  const son = (V.canli || []).slice(-6).reverse();
  const nokta = (renk) => el("span", {style: `display:inline-block;width:10px;height:10px;border-radius:50%;background:${renk};margin-right:6px`});
  k.append(el("b", {}, nokta(calisan.length ? "#22c55e" : "#94a3b8"),
    calisan.length ? `Şu an çalışan: ${calisan.map(a => a.ad).join(", ")}` : "Şu an çalışan ajan yok — bir sonraki tur planlandığı saatte başlar"));
  for (const o of son) {
    const a = liste.find(x => x.id === (OLAY_AJAN[o.ajan] || o.ajan));
    k.append(el("div", {class: "alt", style: "overflow-wrap:anywhere"},
      `${o.durum === "hata" ? "⚠️" : o.durum === "bitti" ? "✓" : "●"} ${a ? a.ad : o.ajan}: ${o.mesaj} · ${sure(o.t)}${o.ortam === "bulut" ? " · bulut" : ""}`));
  }
  if (!son.length) k.append(el("div", {class: "alt", text: "Henüz canlı etkinlik yok. İlk üretim turunda ajanların her adımı burada akacak."}));
  return k;
}

/* ------------------------------------------------------------------ yönetici ajan */
function komutlariEsle() {  // yanıtı gelen bekleyen komutları listeden düşür
  const yanitli = new Set((V.yonetici || []).map(o => o.id));
  V.bekleyenKomut = (V.bekleyenKomut || []).filter(k => !yanitli.has(k.id) && Date.now() - new Date(k.tarih) < 20 * 60e3);
  try { localStorage.setItem("gs_bekleyen_komut", JSON.stringify(V.bekleyenKomut)); } catch (e) {}
}
let _komutSayac = 0;
function yoneticiAkisiYenile() {  // bekleyen komut varken yanıtı sık sık kontrol et
  clearTimeout(_komutSayac);
  if (!V.bekleyenKomut?.length) return;
  _komutSayac = setTimeout(async () => {
    try { V.yonetici = await api.json("state/yonetici.json", []); V.canli = await api.canli(); komutlariEsle(); ciz(); } catch (e) {}
    yoneticiAkisiYenile();
  }, YEREL ? 4000 : 15000);
}
async function komutGonder(metin) {
  metin = String(metin || "").trim();
  if (!metin) return;
  const tarih = new Date().toISOString();
  try {
    let id;
    if (YEREL) id = (await api._yerel("/kapi/komut", {method: "POST", body: {metin}})).id;
    else {
      id = tarih.replace(/\D/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
      await api.yaz(`state/yonetici/komutlar/${id}.json`, {id, metin, kaynak: "telefon", tarih}, "yönetici komutu");
    }
    V.bekleyenKomut.push({id, metin, tarih});
    komutlariEsle();
    bildir(YEREL ? "Yönetici komutunu aldı, çalışıyor." : "Komut iletildi; yönetici bulutta 1-2 dakika içinde yanıtlar.");
    ciz(); yoneticiAkisiYenile();
  } catch (e) { bildir("Komut gönderilemedi: " + e.message, true); }
}
function yoneticiGecmis() {
  const k = el("div", {id: "yonetici-gecmis", style: "display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto;margin:8px 0"});
  const balon = (metin, ben, alt) => el("div", {style: `align-self:${ben ? "flex-end" : "flex-start"};max-width:88%;padding:8px 11px;border-radius:12px;` +
      `white-space:pre-wrap;overflow-wrap:anywhere;font-size:.9rem;${ben ? "background:var(--accent);color:#fff;border-bottom-right-radius:4px" :
      "background:var(--bg);border:1px solid var(--line);border-bottom-left-radius:4px"}`},
    metin, alt ? el("div", {style: `font-size:.72rem;margin-top:4px;opacity:.75`, text: alt}) : null);
  const gecmis = (V.yonetici || []).slice(-6);
  for (const o of gecmis) {
    k.append(balon(o.komut, true, sure(o.tarih || o.bitis)));
    k.append(balon(String(o.yanit || "").replace(/\*\*/g, "").replace(/^\s*[•*-]\s+/gm, "• "), false, [o.eylemler?.length ? "Yaptıkları: " + o.eylemler.join(" · ") : "", o.ortam === "bulut" ? "bulutta" : "bilgisayarda"].filter(Boolean).join(" — ")));
  }
  for (const b of V.bekleyenKomut || []) {
    k.append(balon(b.metin, true, sure(b.tarih)));
    const son = (V.canli || []).filter(o => o.ajan === "yonetici").at(-1);
    k.append(balon((YEREL ? "Düşünüyorum… " : "Buluta iletildi, birazdan yanıtlarım… ") + (son && Date.now() - new Date(son.t) < 120e3 ? `(${son.mesaj})` : ""), false));
  }
  if (!gecmis.length && !(V.bekleyenKomut || []).length)
    k.append(el("div", {class: "alt", text: "Henüz komut yok. Örnek: “Bugün nasıl gidiyoruz?”, “Uzay hakkında bir Shorts üret ve yayınla”, “Sonraki videolar antik Mısır hakkında olsun”."}));
  setTimeout(() => { k.scrollTop = k.scrollHeight; });
  return k;
}
function yoneticiKart() {
  const kart = el("div", {class: "kart", id: "yonetici-kart", style: "margin-bottom:12px;border-left:4px solid #1e3a8a"});
  kart.append(el("h2", {style: "margin-bottom:2px"}, "🧑‍💼 Yönetici'ye komut ver"),
    el("p", {class: "alt", style: "margin:0", text: "Rapor iste, video ürettir, konu ver, ayar değiştir, onay ver. " +
      (YEREL ? "Bilgisayarda hemen çalışır." : "Telefondan verilen komut bulutta 1-2 dakikada yürütülür.") + " Yayın herkese açıktır; ‘yayınla’ demezsen yüklemez."}));
  kart.append(yoneticiGecmis());
  const girdi = el("input", {id: "yonetici-girdi", type: "text", maxlength: "600", placeholder: "Yöneticiye yaz…", "aria-label": "Yöneticiye komut",
    style: "flex:1;min-width:0;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit"});
  const gonder = () => { const m = girdi.value; girdi.value = ""; komutGonder(m); };
  girdi.addEventListener("keydown", e => { if (e.key === "Enter") gonder(); });
  kart.append(el("div", {style: "display:flex;gap:8px"}, girdi, el("button", {class: "dugme birincil", text: "Gönder", onclick: gonder})));
  const hizli = el("div", {style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"});
  for (const h of ["Bugün nasıl gidiyoruz?", "En çok izlenen videolar hangileri?", "Şimdi 1 Shorts üret (yükleme)", "Sosyal turu şimdi çalıştır", "Bekleyen onaylar neler?"])
    hizli.append(el("button", {class: "cip", style: "cursor:pointer", text: h, onclick: () => komutGonder(h)}));
  kart.append(hizli);
  return kart;
}

function ofis3dAcik() {
  if (typeof Ofis3D === "undefined" || !Ofis3D.var()) return false;
  try { return localStorage.getItem("gs_ofis3d") !== "0"; } catch (e) { return true; }
}
function ofisSekmesi(m) {
  m.append(yoneticiKart());
  m.append(canliSerit());
  const kap = el("div", {id: "ofis-kap"});
  const uc = ofis3dAcik();
  const gecis = el("button", {class: "dugme", type: "button", style: "margin-bottom:8px;padding:6px 12px;font-size:13px",
    text: uc ? "🖼️ 2B görünüme geç" : "🧊 3B ofise geç", onclick: () => {
      try { localStorage.setItem("gs_ofis3d", uc ? "0" : "1"); } catch (e) {}
      ciz();
    }});
  m.append(typeof Ofis3D !== "undefined" && Ofis3D.var() ? gecis : "", kap, el("div", {class: "kart cekmece", id: "cekmece"}));
  if (uc) { kap.classList.add("o3"); Ofis3D.kur(kap); } else ofisKur(kap);
  cekmeceCiz();
  // Hızlı görevler
  const g = el("div", {class: "kart cekmece"}, el("h2", {text: "Görev ver"}),
    el("p", {class: "alt", text: "Bulutta hemen çalıştırır. Yayın herkese açıktır; günlük ~5 yükleme kotası vardır."}));
  const satir = el("div", {style: "display:flex;gap:8px;flex-wrap:wrap"});
  const gorevler = [
    ["🎬 1 Shorts üret ve yayınla", "uret", {shorts: "1", videos: "0", yukle: "true"}, "Şimdi bir Shorts üretilip YouTube'a (ve açıksa TikTok/Instagram'a) yüklenecek."],
    ["📣 Sosyal turu çalıştır", "sosyal", {}, "Yorum yanıtları, başlık iyileştirme ve rapor şimdi çalışacak."],
    ["🧭 Strateji ajanı", "ajan", {}, "Strateji ajanı şimdi kanalı inceleyip haftalık planı güncelleyecek."],
    ["🔬 Ar-Ge ekibi", "arge", {}, "Ar-Ge ekibi şimdi büyüme/gelir araştırması ve A/B deneylerini çalıştıracak (~10 dk)."],
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
  const [sos, aj, ag] = await Promise.all([api.klasor("state/sosyal_raporlari"), api.klasor("state/ajan_raporlari"), api.klasor("state/arge/raporlar")]);
  const dosyalar = [...ag.map(n => ({yol: "state/arge/raporlar/" + n, ad: "🔬 Ar-Ge · " + n.replace(".md", "")})),...sos.map(n => ({yol: "state/sosyal_raporlari/" + n, ad: "📣 Sosyal · " + n.replace(".md", "")})),
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
  if (!api.hazir()) { cancelAnimationFrame(OFIS.rafId); if (typeof Ofis3D !== "undefined") Ofis3D.durdur(); m.replaceChildren(); kurulumEkrani(m); return; }
  if (V.hata && !V.yuklendi) { m.replaceChildren(el("div", {class: "hata", text: "Veri okunamadı: " + V.hata})); return; }
  if (!V.yuklendi) return;
  if (V.sekme === "ofis" && document.getElementById("ofis") && !ofis3dAcik()) {  // canvas zaten canlı: sadece şerit ve çekmece
    document.getElementById("canli-serit")?.replaceWith(canliSerit());
    document.getElementById("yonetici-gecmis")?.replaceWith(yoneticiGecmis());
    const yeniH = OFIS.h; boyutla(); if (OFIS.h !== yeniH) ofisCiz();
    cekmeceCiz(); ofisCiz(); return;
  }
  if (V.sekme === "ofis" && document.getElementById("ofis3d") && ofis3dAcik()) {  // 3B sahne canlı: sadece şerit ve çekmece
    document.getElementById("canli-serit")?.replaceWith(canliSerit());
    document.getElementById("yonetici-gecmis")?.replaceWith(yoneticiGecmis());
    Ofis3D.guncelle(); cekmeceCiz(); return;
  }
  cancelAnimationFrame(OFIS.rafId); OFIS.ctx = null; if (typeof Ofis3D !== "undefined") Ofis3D.durdur();
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
if (api.hazir()) {
  yukle().then(yoneticiAkisiYenile);
  setInterval(() => { if (!document.hidden) yukle(); }, 60000);
  if (YEREL) setInterval(async () => {  // yerelde canlı akış 10 sn'de bir
    if (document.hidden || V.sekme !== "ofis") return;
    try { V.canli = await api.canli(); ciz(); } catch (e) {}
  }, 10000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && api.hazir()) yukle(); });
