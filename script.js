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
    
    // Bersihkan enter dan spasi berlebih
    let cleanAddr = alamatMentah.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
    let parts = cleanAddr.split(',').map(p => p.trim());
    
    let prov = ""; let kota = ""; let kec = ""; let desa = ""; let rtrw = ""; let sisa = "";

    // Potong mundur dari kanan ke kiri
    if (parts.length > 0) prov = parts.pop().replace(/Prov\.\s*/i, "").trim();
    if (parts.length > 0) kota = parts.pop().replace(/Kab\.\s*/i, "").replace(/Kota\.\s*/i, "").trim();
    if (parts.length > 0) kec = parts.pop().replace(/Kec\.\s*/i, "").trim();
    if (parts.length > 0) desa = parts.pop().replace(/Kel\.\s*/i, "").replace(/Desa\.\s*/i, "").trim();

    // Gabungkan kembali sisa teks paling kiri untuk dicari RT/RW nya
    let sisaTeks = parts.join(', ');
    
    // Deteksi pola RT/RW menggunakan Regex Pintar
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

    log(`Hasil urai -> Alamat: ${sisa} | RT/RW: ${rtrw} | Desa: ${desa} | Kec: ${kec}`, "success");
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

            log(`Membaca isi teks dokumen PDF (${pdf.numPages} halaman)...`, "process");
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join("\n");
                fullText += pageText + "\n";
            }

            evaluasiPolaTeks(fullText);
        };
        reader.readAsArrayBuffer(file);
    } catch (err) {
        log("Gagal membaca berkas PDF secara direct: " + err.message, "error");
    }
});

// Penentu tipe dokumen berdasarkan kata kunci unik di dalam PDF
function evaluasiPolaTeks(text) {
    log("Menganalisis jenis tanda pengenal berkas...", "process");
    
    if (text.includes("TANDA BUKTI PENDAFTARAN") || text.includes("Nomor Pendaftaran")) {
        log("Tipe Dokumen Terdeteksi: BUKTI PENDAFTARAN SEKOLAH", "success");
        ekstrakDataPendaftaran(text);
    } 
    else if (text.includes("TANDA BUKTI APPROVAL") || text.includes("Verifikasi Akun") || text.includes("KODE AKTIVASI")) {
        log("Tipe Dokumen Terdeteksi: BUKTI VERIFIKASI/APPROVAL AKUN", "success");
        ekstrakDataVerifikasi(text);
    } 
    else {
        log("Pola teks tidak beraturan. Mencoba ekstrasi dengan mode fleksibel...", "warning");
        if (text.includes("Jalur") && text.includes("Waktu")) {
            ekstrakDataPendaftaran(text);
        } else {
            ekstrakDataVerifikasi(text);
        }
    }
}

// Parsers khusus dokumen lembar pendaftaran pilihan jurusan
function ekstrakDataPendaftaran(text) {
    const dapatkanTeks = (regex, def = "") => {
        const match = text.match(regex);
        return match ? match[1].trim() : def;
    };

    const rawAlamat = dapatkanTeks(/Alamat\n*\"?,\"?\"?([^\"\n]+)/) || dapatkanTeks(/Alamat\s*:\s*([^\n]+)/);
    const alamatUrai = uraiAlamat(rawAlamat);
    const ttlUrai = uraiTempatTanggalLahir(dapatkanTeks(/Tempat & Tgl\. Lahir\n*\"?,\"?\"?([^\"\n]+)/));

    currentExtractedData = {
        tipe_berkas: "PENDAFTARAN",
        nomor_pendaftaran: dapatkanTeks(/Nomor Pendaftaran\n*\"?,\"?\"?([^\"\n]+)/),
        nomor_peserta: dapatkanTeks(/Nomor Peserta\n*\"?,\"?\"?([^\"\n]+)/),
        lokasi_pendaftaran: dapatkanTeks(/Lokasi Pendaftaran\n*\"?,\"?\"?([^\"\n]+)/) + " " + dapatkanTeks(/Teknik\s+[^\n]+/),
        jalur: dapatkanTeks(/Jalur\n*\"?,\"?\"?([^\"\n]+)/),
        waktu: dapatkanTeks(/Waktu\n*\"?,\"?\"?([^\"\n]+)/),
        nama: dapatkanTeks(/Nama Lengkap\n*\"?,\"?\"?([^\"\n]+)/),
        jenis_kelamin: dapatkanTeks(/Jenis Kelamin\n*\"?,\"?\"?([^\"\n]+)/),
        tempat_lahir: ttlUrai.tempat,
        tanggal_lahir: ttlUrai.tanggal,
        alamat_sisa: alamatUrai.sisa,
        rtrw: alamatUrai.rtrw,
        desa: alamatUrai.desa,
        kecamatan: alamatUrai.kec,
        kota: alamatUrai.kota,
        provinsi: alamatUrai.prov,
        sekolah_asal: dapatkanTeks(/Sekolah Asal\n*\"?,\"?\"?([^\"\n]+)/),
        jenis_lulusan: dapatkanTeks(/Jenis Lulusan\n*\"?,\"?\"?([^\"\n]+)/),
        tahun_lulus: dapatkanTeks(/Tahun Lulus\n*\"?,\"?\"?([^\"\n]+)/),
        pilihan_sekolah: dapatkanTeks(/Daftar Pilihan Sekolah\n*\"?,\"?\"?([^\"\n]+)/),
        nilai_akhir: dapatkanTeks(/Nilai Akhir\n*\"?,\"?\"?([^\"\n]+)/, "0"),
        jarak: dapatkanTeks(/Jarak\n*\"?,\"?\"?([^\"\n]+)/),
        usia: dapatkanTeks(/Usia\n*\"?,\"?\"?([^\"\n]+)/)
    };

    tampilkanFormulirData(currentExtractedData);
}

// Parsers khusus dokumen lembar akun / verifikasi approval
function ekstrakDataVerifikasi(text) {
    const dapatkanTeks = (regex, def = "") => {
        const match = text.match(regex);
        return match ? match[1].trim() : def;
    };

    const rawAlamat = dapatkanTeks(/Alamat\n*\"?,\"?\"?([^\"\n]+)/);
    const alamatUrai = uraiAlamat(rawAlamat);
    const ttlUrai = uraiTempatTanggalLahir(dapatkanTeks(/Tempat & Tgl\. Lahir\n*\"?,\"?\"?([^\"\n]+)/));

    // Ekstraksi Link Google Maps Koordinat (Jika file ajuan akun awal yang dimasukkan)
    let koordinatMaps = "";
    const mapsMatch = text.match(/https:\/\/maps\.google\.com\/[^\s\n\"]+/i) || text.match(/http:\/\/googleusercontent\.com\/maps[^\s\n\"]+/i);
    if (mapsMatch) koordinatMaps = mapsMatch[0].trim();

    currentExtractedData = {
        tipe_berkas: "AJUAN_AKUN",
        ajuan_akun: koordinatMaps ? "Ya" : "Tidak", 
        verifikasi: koordinatMaps ? "Tidak" : "Ya",
        nomor_peserta: dapatkanTeks(/Nomor Peserta\n*\"?,\"?\"?([^\"\n]+)/),
        nisn: dapatkanTeks(/NISN\n*\"?,\"?\"?([^\"\n]+)/),
        nama: dapatkanTeks(/Nama Lengkap\n*\"?,\"?\"?([^\"\n]+)/),
        jenis_kelamin: dapatkanTeks(/Kelamin\n*\"?,\"?\"?([^\"\n]+)/),
        tempat_lahir: ttlUrai.tempat,
        tanggal_lahir: ttlUrai.tanggal,
        alamat_sisa: alamatUrai.sisa,
        rtrw: alamatUrai.rtrw,
        desa: alamatUrai.desa || dapatkanTeks(/Desa\n*\"?,\"?\"?([^\"\n]+)/, "-"),
        kecamatan: alamatUrai.kec,
        kota: alamatUrai.kota,
        provinsi: alamatUrai.prov,
        sekolah_asal: dapatkanTeks(/Sekolah Asal\n*\"?,\"?\"?([^\"\n]+)/),
        sekolah_asal_dari: "Dalam Provinsi",
        afirmasi_miskin: dapatkanTeks(/Status Siswa Keluarga Ekonomi Tidak Mampu\n*\"?,\"?\"?([^\"\n]+)/, "Tidak"),
        afirmasi_panti: dapatkanTeks(/Status Anak Panti Asuhan\n*\"?,\"?\"?([^\"\n]+)/, "Tidak"),
        afirmasi_ats: dapatkanTeks(/Status Anak Tidak Sekolah[^\n]*\n*\"?,\"?\"?([^\"\n]+)/, "Tidak"),
        nama_kejuaraan: dapatkanTeks(/Nama Kejuaraan\n*\"?,\"?\"?([^\"\n]+)/),
        nilai_kejuaraan: dapatkanTeks(/Nilai Kejuaraan\n*\"?,\"?\"?([^\"\n]+)/, "0"),
        organisasi: dapatkanTeks(/Organisasi\n*\"?,\"?\"?([^\"\n]+)/, "Tidak ada organisasi"),
        nilai_organisasi: dapatkanTeks(/Nilai Organisasi\n*\"?,\"?\"?([^\"\n]+)/, "0"),
        nilai_rapor: dapatkanTeks(/Nilai Rata-rata Rapor\n*\"?,\"?\"?([^\"\n]+)/, "0"),
        status_domisili: dapatkanTeks(/Status Domisili Siswa\n*\"?,\"?\"?([^\"\n]+)/),
        tgl_cetak_kk: dapatkanTeks(/Tanggal Cetak Kartu Keluarga\n*\"?,\"?\"?([^\"\n]+)/),
        no_wa: dapatkanTeks(/No Telepon \(WA\)\n*[^\n]*\n*\"?,\"?\"?([^\"\n]+)/),
        surat_sehat: dapatkanTeks(/Surat Keterangan Sehat[^\n]*\n*\"?,\"?\"?([^\"\n]+)/, "Ya"),
        disabilitas: dapatkanTeks(/Disabilitas\n*[^\n]*\n*\"?,\"?\"?([^\"\n]+)/, "Tidak"),
        prestasi_khusus: dapatkanTeks(/Prestasi Khusus\n*[^\n]*\n*\"?,\"?\"?([^\"\n]+)/, "Tidak"),
        wilayah_mutasi: dapatkanTeks(/Kab\/Kota Sesuai Wilayah Surat Tugas Mutasi\n*[^\n]*\n*\"?,\"?\"?([^\"\n]+)/),
        operator: dapatkanTeks(/Dicetak oleh ([^ \n\r\t,]+ [^ \n\r\t,]+)/) || "Sigit Hantoro",
        maps_url: koordinatMaps
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

    // Set Value Global Field
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
