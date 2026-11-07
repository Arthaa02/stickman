# Stickman Tournament Arena — AI Auto-Battler

Game simulasi auto-battler 2D berbasis web (**100% Pure AI vs AI Spectator Mode**) terinspirasi dari animasi pertarungan stickman klasik dengan **Hybrid Procedural 2-Bone Inverse Kinematics (IK) + Verlet Ragdoll Physics**, **Perception-Driven Utility FSM AI**, sistem **Comical Surrender**, serta **16-Fighter Single-Elimination Tournament Bracket**.

---

## Fitur Utama

- **100% AI vs AI Spectator & Manager**: Tonton jalannya pertarungan otonom, atur kecepatan (`0.25x Slow-Mo`, `1x`, `2x`, `4x`), nyalakan **Epic Clash Slow-Mo**, gunakan `Skip to Result`, atau aktifkan `Auto-Tourney` untuk menjalankan seluruh turnamen otomatis.
- **16 Karakter & Interaksi Kontra (Rock-Paper-Scissors Physics)**:
  1. **Long Sword**: Katana dasher dengan **Parry Stance** pemantul peluru berpercikan api; pedang dapat dipatahkan **Plier** atau ditarik **Magnet**.
  2. **Sniper**: Kiter jarak jauh dengan laser bidik merah `1.5s`, peluru tembus berkecepatan tinggi, & recoil ke belakang.
  3. **Glass**: Vitreomancer pendiri dinding kaca tebal yang pecah menjadi hujan beling tajam; hancur seketika oleh **Hammer** & **Plier**.
  4. **Plier**: Brawler/grappler tang raksasa pematah pedang lawan, pemotong peluru di udara, & pembelah dinding kaca.
  5. **Blue Fire**: Membakar lantai arena, melelehkan es **Ice**, serta **melapisi senjata/proyektil apa pun yang menyentuh apinya** dengan api biru mistis.
  6. **Magnet**: Menarik lepas senjata logam dari tangan lawan (**Disarm**) & memantulkan proyektil logam kembali ke penembak.
  7. **Portal**: Menaruh sepasang cincin portal Oranye & Biru untuk membelokkan tembakan musuh ke punggung penembaknya sendiri & teleportasi darurat.
  8. **Rubber**: Akrobat pemantul dinding & langit-langit arena, imun damage *blunt*/jatuh, serta memantulkan peluru dari tubuh karetnya.
  9. **Gravity**: Membalik gravitasi lawan ke langit-langit arena atau menjepit lawan di lantai berbobot **10x lipat (10G Crush)**.
  10. **Bulwark (Shield)**: *Tower shield* baja pemblokir 100% serangan frontal; rentan dari belakang/atas (**Portal**, **Clone**), **Black Hole**, & hancur sekali ayun oleh **Hammer**.
  11. **Clone**: Memunculkan 2 klon bayangan yang membingungkan *Perception Engine* musuh (pecah 1 pukulan) & mampu bertukar posisi instan.
  12. **Thunder**: *Flash-step* kilat yang menyetrum musuh kaku selama `0.8s` (membatalkan *wind-up* lawan).
  13. **Ice**: Membekukan lantai hingga lawan tergelincir hilang kendali & membekukan lawan menjadi balok es padat sementara.
  14. **Black Hole**: Melempar singularitas mini penyedot senjata lepas, serpihan kaca, & stickman lawan serta penghancur proyektil.
  15. **Rocket**: Bazooka berdaya ledak area luas (*splash knockback*) & mampu melakukan **Rocket-Jump** saat terpojok.
  16. **Hammer**: *Heavy bruiser* dengan *wind-up* gempa bumi penghancur dinding kaca & perisai **Bulwark** dalam sekali ayun + *shockwave* stun lantai.
- **Comical Surrender**: Saat terdesak total (senjata patah, terkepung dinding kaca, *disarmed* berulang kali, atau terkunci laser di HP kritis), AI mengangkat kedua tangan mengibarkan bendera putih dengan dialog jenaka (*"Nope, I'm out!"*, *"Bro chill with the glass walls!!"*, dll.).
- **Stitch API Asset Pipeline + Procedural Fallback**: Modul `stitchClient.ts` & `assetService.ts` mendukung caching `IndexedDB` / `LocalStorage` serta otomatis merender grafik vektor Canvas 2D & SVG murni tanpa error saat offline.

---

## Menjalankan Proyek

```bash
npm install
npm run dev
```

Untuk memeriksa tipe TypeScript & melakukan *production build*:

```bash
npm run build
```

