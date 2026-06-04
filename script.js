// URL Google Apps Script milikmu Mas
const API_URL = "https://script.google.com/macros/s/AKfycbwBaWKlzKSJwIV0g0KQvZpGEdwRj6VSsz97Kk8YhXKYdm28DIpZ3VVEEsb1GITNB9KO/exec";

// Menyimpan state data hasil ekstraksi yang sedang aktif
let currentExtractedData = null;

// Inisialisasi Elemen DOM
const pdfFileInput = document.getElementById("pdfFile");
const terminalLog = document.getElementById("terminalLog");
const btnSubmit = document.getElementById("btnSubmit");
const indicatorAcun = document.getElementById("indicator_akun");
const indicatorDaftar = document.getElementById("indicator_daftar");
const sheetTargetBadge = document.getElementById("sheetTargetBadge");

const formEmptyState = document.getElementById("formEmptyState");
const dataForm = document.getElementById("dataForm");
const sectionPendaftaran = document.getElementById("section_pendaftaran_only");
const sectionAkun = document.getElementById("section_akun_only");

// Fungsi mencetak log ke terminal box panel kiri
function log(message, type = "info") {
    const time = new Date().toLocaleTimeString('id-ID');
    let colorClass = "text-slate-400";
    if (type === "success") colorClass = "text-emerald-400 font-semibold";
    if (type === "error") colorClass = "text-rose-500 font-bold";
    if (type === "warning") colorClass = "text-amber-400";
    if (type === "process") colorClass = "text-cyan-400";

    terminalLog.innerHTML += `<div class="${colorClass}">[${time}] ${message}</div>`;
    terminalLog.scrollTop = terminalLog.scrollHeight;
}

// =========================================================================
// LOGIKA PEMISAH ALAMAT (DARI KANAN KE KIRI)
// =========================================================================
function uraiAlamat(alamatMentah) {
    if (!alamatMentah) return { sisa: "", rtrw: "", desa: "", kec: "", kota: "", prov: "" };
    
    log("Menjalankan pemisahan komponen alamat dari kanan ke kiri...", "process");
    
    let cleanAddr = alamatMentah.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
    let parts = cleanAddr.split(',').map(p => p.trim());
    
    let prov = ""; let kota = ""; let kec = ""; let desa = ""; let rtrw = ""; let sisa = "";

    if (parts.length > 0) prov = parts.pop().replace(/Prov\.\s*/i, "").trim();
    if (parts.length > 0) kota = parts.pop().replace(/Kab\.\s*/i, "").replace(/Kota\.\s*/i, "").trim();
    if (parts.length > 0) kec = parts.pop().replace(/Kec\.\s*/i, "").trim();
    if (parts.length > 0) desa = parts.pop().replace(/Kel\.\s*/i, "").replace(/Desa\.\s*/i, "").trim();

    let sisaTeks = parts.join(', ');
    
    let rtrwMatch = sisaTeks.match(/(RT\s*[\.\/\s]?\s*\d+\s*[\/\s]?\s*RW\s*[\.\/\s]?\s*\d+)/i) || 
                    sisaTeks.match(/(RT\/RW\s*\d+\/\d+)/i) ||
                    sisaTeks.match(/(\d+\/\d+)/);

    if (rtrwMatch) {
        rtrw = rtrwMatch[0].trim();
        let indexRtrw = sisaTeks.indexOf(rtrw);
        sisa = sisaTeks.substring(0, indexRtrw).trim().replace(/,$/, '').trim();
    } else {
        sisa = sisaTeks;
    }

    log(`Hasil urai -> Alamat: ${sisa} | RT/RW: ${rtrw} | Desa: ${desa}`, "success");
    return { sisa, rtrw, desa, kec, kota, prov };
}

// =========================================================================
// LOGIKA PEMISAH TEMPAT & TANGGAL LAHIR
// =========================================================================
function uraiTempatTanggalLahir(ttlMentah) {
    if (!ttlMentah) return { tempat: "", tanggal: "" };
    let parts = ttlMentah.split(',').map(p => p.trim());
    let tempat = parts[0] || "";
    let tanggal = parts.slice(1).join(', ') || "";
    return { tempat, tanggal };
}

// =========================================================================
// EVENT HANDLER UNTUK MEMBACA FILE PDF UNGGAHAN
// =========================================================================
pdfFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    log(`Menerima berkas file: ${file.name}`, "process");
    log("Mengekstrak data biner PDF lokal...", "process");

    try {
        const reader = new FileReader();
        reader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            let fullText = "";

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(" ");
                fullText += pageText + " ";
            }

            // Bersihkan spasi berlebih agar pencarian berbasis spasi tunggal akurat
            fullText = fullText.replace(/\s+/g, ' ');
            evaluasiPolaTeks(fullText);
        };
        reader.readAsArrayBuffer(file);
    } catch (err) {
        log("Gagal membaca berkas PDF secara direct: " + err.message, "error");
    }
});

function evaluasiPolaTeks(text) {
    log("Menganalisis jenis tanda pengenal berkas...", "process");
    
    if (text.includes("PENDAFTARAN") && (text.includes("Nomor Pendaftaran") || text.includes("Nilai Akhir"))) {
        log("Tipe Dokumen Terdeteksi: BUKTI PENDAFTARAN SEKOLAH", "success");
        ekstrakDataPendaftaran(text);
    } 
    else if (text.includes("PENGAJUAN AKUN") || text.includes("VERIFIKASI") || text.includes("APPROVAL")) {
        log("Tipe Dokumen Terdeteksi: BUKTI AJUAN/VERIFIKASI AKUN", "success");
        ekstrakDataVerifikasi(text);
    } 
    else {
        log("Pola teks tidak kaku. Menggunakan parser cerdas tipe akun...", "warning");
        ekstrakDataVerifikasi(text);
    }
}

// 1. PARSER 2026 UNTUK DATA AKUN / VERIFIKASI (SEPERTI DANY)
function ekstrakDataVerifikasi(text) {
    const dapatkanTeks = (mulai, selesai) => {
        let idxMulai = text.indexOf(mulai);
        if (idxMulai === -1) return "";
        idxMulai += mulai.length;
        let idxSelesai = text.indexOf(selesai, idxMulai);
        if (idxSelesai === -1) return text.substring(idxMulai).trim();
        return text.substring(idxMulai, idxSelesai).trim();
    };

    const nomorPeserta = dapatkanTeks("Nomor Peserta ", " Nama Lengkap");
    const namaLengkap = dapatkanTeks("Nama Lengkap ", " Jenis Kelamin");
    const jenisKelamin = dapatkanTeks("Jenis Kelamin ", " Tempat & Tgl. Lahir");
    const ttlMentah = dapatkanTeks("Tempat & Tgl. Lahir ", " Alamat");
    const rawAlamat = dapatkanTeks("Alamat ", " Sekolah Asal");
    const sekolahAsal = dapatkanTeks("Sekolah Asal ", " Jenis Lulusan");
    
    const afirmasiMiskin = dapatkanTeks("Status Siswa Keluarga Ekonomi Tidak Mampu ", " Status Anak Panti Asuhan");
    const afirmasiPanti = dapatkanTeks("Status Anak Panti Asuhan ", " Status Anak Tidak Sekolah");
    const afirmasiAts = dapatkanTeks("Status Anak Tidak Sekolah (Putus Sekolah) ", " Status Anak Guru");
    const namaKejuaraan = dapatkanTeks("Nama Kejuaraan ", " Nomor Piagam");
    const organisasi = dapatkanTeks("Organisasi ", " Nilai Organisasi");
    const statusDomisili = dapatkanTeks("Status Domisili Siswa ", " NIK");
    const tglCetakKk = dapatkanTeks("Tanggal Cetak Kartu Keluarga ", " No Telepon");
    const noWa = dapatkanTeks("No Telepon (WA) ", " *");
    
    // Cari Rata-Rata Rapor (Mencari angka decimal di sekitar teks rapor)
    let nilaiRapor = "0";
    let raporMatch = text.match(/Rata - Rata Nilai Rapor\s*([\d\.]+)/i) || text.match(/(\d{2}\.\d{2})\s*Keterangan/);
    if (raporMatch) nilaiRapor = raporMatch[1];

    // Ekstraksi Koordinat Geografis Langsung dari Text PDF 2026
    let koordinatMaps = "";
    let latMatch = text.match(/Latitude\s*([\-\d\.]+)/i);
    let lonMatch = text.match(/Longtitude\s*([\d\.]+)/i);
    if (latMatch && lonMatch) {
        koordinatMaps = `https://www.google.com/maps?q=${latMatch[1]},${lonMatch[1]}`;
    }

    const alamatUrai = uraiAlamat(rawAlamat);
    const ttlUrai = uraiTempatTanggalLahir(ttlMentah);

    currentExtractedData = {
        tipe_berkas: "AJUAN_AKUN",
        ajuan_akun: koordinatMaps ? "Ya" : "Tidak", 
        verifikasi: koordinatMaps ? "Tidak" : "Ya",
        nomor_peserta: nomorPeserta,
        nisn: nomorPeserta,
        nama: namaLengkap,
        jenis_kelamin: jenisKelamin,
        tempat_lahir: ttlUrai.tempat,
        tanggal_lahir: ttlUrai.tanggal,
        alamat_sisa: alamatUrai.sisa,
        rtrw: alamatUrai.rtrw,
        desa: alamatUrai.desa,
        kecamatan: alamatUrai.kec,
        kota: alamatUrai.kota,
        provinsi: alamatUrai.prov,
        sekolah_asal: sekolahAsal,
        sekolah_asal_dari: "Dalam Provinsi",
        afirmasi_miskin: afirmasiMiskin || "Tidak",
        afirmasi_panti: afirmasiPanti || "Tidak",
        afirmasi_ats: afirmasiAts || "Tidak",
        nama_kejuaraan: namaKejuaraan === "Tidak ada" ? "" : namaKejuaraan,
        nilai_kejuaraan: "0",
        organisasi: organisasi,
        nilai_organisasi: "0",
        nilai_rapor: nilaiRapor,
        status_domisili: statusDomisili,
        tgl_cetak_kk: tglCetakKk,
        no_wa: noWa,
        surat_sehat: "Ya",
        disabilitas: "Tidak",
        prestasi_khusus: "Tidak",
        wilayah_mutasi: "",
        operator: "Sigit Hantoro",
        maps_url: koordinatMaps
    };

    tampilkanFormulirData(currentExtractedData);
}

// 2. PARSER 2026 UNTUK DATA SELEKSI PENDAFTARAN (SEPERTI BEMBY)
function ekstrakDataPendaftaran(text) {
    const dapatkanTeks = (mulai, selesai) => {
        let idxMulai = text.indexOf(mulai);
        if (idxMulai === -1) return "";
        idxMulai += mulai.length;
        let idxSelesai = text.indexOf(selesai, idxMulai);
        if (idxSelesai === -1) return text.substring(idxMulai).trim();
        return text.substring(idxMulai, idxSelesai).trim();
    };

    const noPendaftaran = dapatkanTeks("Nomor Pendaftaran ", " Lokasi Pendaftaran");
    const lokasiPendaftaran = dapatkanTeks("Lokasi Pendaftaran ", " Jalur");
    const jalur = dapatkanTeks("Jalur ", " Waktu");
    const waktu = dapatkanTeks("Waktu ", " Biodata");
    
    const nomorPeserta = dapatkanTeks("Nomor Peserta ", " Nama Lengkap");
    const namaLengkap = dapatkanTeks("Nama Lengkap ", " Jenis Kelamin");
    const jenisKelamin = dapatkanTeks("Jenis Kelamin ", " Tempat & Tgl. Lahir");
    const ttlMentah = dapatkanTeks("Tempat & Tgl. Lahir ", " Alamat");
    const rawAlamat = dapatkanTeks("Alamat ", " Sekolah Asal");
    const sekolahAsal = dapatkanTeks("Sekolah Asal ", " Jenis Lulusan");
    const jenisLulusan = dapatkanTeks("Jenis Lulusan ", " Tahun Lulus");
    const tahunLulus = dapatkanTeks("Tahun Lulus ", " Daftar Pilihan");

    const nilaiAkhir = dapatkanTeks("Nilai Akhir ", " Jarak");
    const jarak = dapatkanTeks("Jarak ", " Usia");
    const usia = dapatkanTeks("Usia ", " *");

    const alamatUrai = uraiAlamat(rawAlamat);
    const ttlUrai = uraiTempatTanggalLahir(ttlMentah);

    currentExtractedData = {
        tipe_berkas: "PENDAFTARAN",
        nomor_pendaftaran: noPendaftaran,
        nomor_peserta: nomorPeserta,
        lokasi_pendaftaran: lokasiPendaftaran,
        jalur: jalur,
        waktu: waktu,
        nama: namaLengkap,
        jenis_kelamin: jenisKelamin,
        tempat_lahir: ttlUrai.tempat,
        tanggal_lahir: ttlUrai.tanggal,
        alamat_sisa: alamatUrai.sisa,
        rtrw: alamatUrai.rtrw,
        desa: alamatUrai.desa,
        kecamatan: alamatUrai.kec,
        kota: alamatUrai.kota,
        provinsi: alamatUrai.prov,
        sekolah_asal: sekolahAsal,
        jenis_lulusan: jenisLulusan,
        tahun_lulus: tahunLulus,
        pilihan_sekolah: lokasiPendaftaran.split(" ")[0] || "SMKN 1 KISMANTORO",
        nilai_akhir: nilaiAkhir,
        jarak: jarak,
        usia: usia
    };

    tampilkanFormulirData(currentExtractedData);
}

// =========================================================================
// RENDER DATA KE FORMULIR PREVIEW INTERAKTIF
// =========================================================================
function tampilkanFormulirData(data) {
    formEmptyState.classList.add("hidden");
    dataForm.classList.remove("hidden");

    btnSubmit.removeAttribute("disabled");
    btnSubmit.className = "w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold py-3.5 rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-2 text-xs uppercase tracking-wider cursor-pointer";

    sheetTargetBadge.classList.remove("hidden");
    sheetTargetBadge.innerText = `TARGET TAB: ${data.tipe_berkas}`;

    indicatorAcun.className = "bg-slate-900 border border-slate-800 text-slate-600 rounded-xl py-2.5 flex items-center justify-center gap-1.5";
    indicatorDaftar.className = "bg-slate-900 border border-slate-800 text-slate-600 rounded-xl py-2.5 flex items-center justify-center gap-1.5";

    document.getElementById("out_no_peserta").value = data.nomor_peserta || "";
    document.getElementById("out_nama").value = data.nama || "";
    document.getElementById("out_jk").value = data.jenis_kelamin || "";
    document.getElementById("out_tempat_lahir").value = data.tempat_lahir || "";
    document.getElementById("out_tanggal_lahir").value = data.tanggal_lahir || "";
    
    document.getElementById("out_alamat_sisa").value = data.alamat_sisa || "";
    document.getElementById("out_rtrw").value = data.rtrw || "";
    document.getElementById("out_desa").value = data.desa || "";
    document.getElementById("out_kecamatan").value = data.kecamatan || "";
    document.getElementById("out_kota").value = data.kota || "";
    document.getElementById("out_provinsi").value = data.provinsi || "";

    if (data.tipe_berkas === "AJUAN_AKUN") {
        indicatorAcun.className = "bg-cyan-950 border border-cyan-800/80 text-cyan-400 rounded-xl py-2.5 flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-950/40";
        sectionPendaftaran.classList.add("hidden");
        sectionAkun.classList.remove("hidden");

        document.getElementById("out_nisn").value = data.nisn || "";
        document.getElementById("out_sehat").value = data.surat_sehat || "";
        document.getElementById("out_disabilitas").value = data.disabilitas || "";
        document.getElementById("out_operator").value = data.operator || "";
        document.getElementById("out_sekolah_asal").value = data.sekolah_asal || "";
        document.getElementById("out_sekolah_asal_dari").value = data.sekolah_asal_dari || "";
        
        const mapsInput = document.getElementById("out_maps_url");
        const btnTestMap = document.getElementById("btnTestMap");
        if (data.maps_url) {
            mapsInput.value = data.maps_url;
            btnTestMap.removeAttribute("disabled");
        } else {
            mapsInput.value = "- (Peta koordinat tidak tertera di berkas verifikasi ini)";
            btnTestMap.setAttribute("disabled", "true");
        }
        log("Data Ajuan Akun/Verifikasi dipetakan sepenuhnya ke form.", "success");

    } else if (data.tipe_berkas === "PENDAFTARAN") {
        indicatorDaftar.className = "bg-emerald-950 border border-emerald-800/80 text-emerald-400 rounded-xl py-2.5 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950/40";
        sectionAkun.classList.add("hidden");
        sectionPendaftaran.classList.remove("hidden");

        document.getElementById("out_nisn").value = "- (Tidak tertera di Bukti Pendaftaran)";
        document.getElementById("out_no_pendaftaran").value = data.nomor_pendaftaran || "";
        document.getElementById("out_jalur").value = data.jalur || "";
        document.getElementById("out_lokasi_pendaftaran").value = data.lokasi_pendaftaran || "";
        document.getElementById("out_waktu").value = data.waktu || "";
        document.getElementById("out_nilai_akhir").value = data.nilai_akhir || "";
        document.getElementById("out_jarak").value = data.jarak || "";
        document.getElementById("out_usia").value = data.usia || "";
        log("Data Seleksi Pendaftaran dipetakan sepenuhnya ke form.", "success");
    }
}

// =========================================================================
// TRANSMISI DATA POST MENUJU GOOGLE APPS SCRIPT API
// =========================================================================
btnSubmit.addEventListener("click", async () => {
    if (!currentExtractedData) return;

    log("Mengirimkan enkapsulasi data menuju Google Sheets server...", "process");
    btnSubmit.setAttribute("disabled", "true");
    btnSubmit.innerText = "Proses Sinkronisasi...";

    try {
        await fetch(API_URL, {
            method: "POST",
            mode: "no-cors", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentExtractedData)
        });

        setTimeout(() => {
            log("Sinkronisasi Berhasil! Data sukses tersimpan di Google Sheets.", "success");
            log(`Nama Terdata: ${currentExtractedData.nama} (${currentExtractedData.nomor_peserta})`, "success");
            btnSubmit.removeAttribute("disabled");
            btnSubmit.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Kirim ke Google Sheets`;
        }, 1200);

    } catch (err) {
        log("Gerbang transmisi gagal mengirim data: " + err.message, "error");
        btnSubmit.removeAttribute("disabled");
        btnSubmit.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Kirim ke Google Sheets`;
    }
});

document.getElementById("btnTestMap").addEventListener("click", () => {
    if (currentExtractedData && currentExtractedData.maps_url) {
        window.open(currentExtractedData.maps_url, "_blank");
    }
});
