JOBSWIPE PATCH - UNDO REVIEWER

Patch ini hanya berisi file yang perlu ditambahkan/diganti, bukan seluruh source project.

1. Di GitHub, buka folder components lalu ganti reviewer.tsx dengan file dari patch/components/reviewer.tsx.
2. Tambahkan file supabase/undo-patch.sql ke folder supabase (atau buka file ini dan copy seluruh SQL ke Supabase SQL Editor).
3. Jalankan undo-patch.sql SATU KALI di Supabase SQL Editor.
4. Commit dan push ke GitHub. Tunggu Vercel selesai deploy.

Fitur:
- Tombol Undo membatalkan keputusan terakhir reviewer yang sedang login.
- Shortcut Ctrl+Z (atau Cmd+Z di Mac).
- Lowongan yang di-undo dikembalikan ke status pending dan langsung ditampilkan lagi kepada reviewer tersebut.
- Kartu pending yang sedang dipegang reviewer dilepas agar tidak tertinggal/terkunci.
- Statistik dikirim kembali oleh RPC yang sama.

Catatan: Undo hanya membatalkan aksi terakhir milik reviewer yang sedang login, bukan aksi reviewer lain. Jalankan SQL patch sekali saja; aman dijalankan ulang karena menggunakan CREATE OR REPLACE.
