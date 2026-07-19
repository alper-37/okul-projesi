# ADAB Proje Tanıtım Rehberi

## Kısa Özet
ADAB (Dijital İmece), öğrencilerin akademik soru–cevap etkileşimini güvenli ve yönetilebilir bir ortamda buluşturan, okul içi dayanışmayı güçlendiren bir eğitim platformudur. Öğrenciler ders bazlı soru sorar, öğretmenler/ yetkililer yanıtlar ve içerikleri onaylar. Sistem, etkileşim ve başarıyı görünür kılan istatistiksel panellerle desteklenir.

## Problem ve Motivasyon
- Öğrencilerin doğru ve hızlı geri bildirim alma ihtiyacı
- Soru–cevap etkileşimlerinin dağınık kanallarda kalması
- Okul içi akademik dayanışmanın ölçümlenememesi

## Çözüm
ADAB; soru sorma, onay süreci, cevaplama ve istatistik takibini tek bir noktada birleştirir. Kullanıcı rolleri sayesinde güvenlik ve kalite kontrolü sağlanır.

## Öne Çıkan Özellikler
- Öğrenci ve öğretmen rolleri
- Soru–cevap onay süreçleri
- Etkileşim puanı ve rozet sistemi
- Akademik raporlar (ders/sınıf dağılımı, onay oranı, hedef takibi)
- Toplu kullanıcı yükleme (CSV)
- Admin yönetim paneli

## Hedef Kitle
Ortaöğretim kurumları, öğretmenler, öğrenciler ve okul yöneticileri.

## Yenilikçi Yön
Okul içi akademik iletişimi yapılandırılmış bir dijital platforma taşıyarak ölçülebilir, güvenli ve teşvik edici bir öğrenme ekosistemi oluşturur.

## Kullanım Senaryosu
1. Öğrenci kayıt olur ve giriş yapar.
2. Ders ve sınıf seçerek soru sorar.
3. Öğretmen/ Admin onaylar ve cevaplar.
4. Öğrenci cevabı kabul ederek etkileşim puanı kazandırır.
5. Yönetim paneli ile süreç izlenir ve raporlanır.

## Teknik Özet
- Ön yüz: Vue 3 + Vite
- Veritabanı ve kimlik: Firebase (Auth + Firestore)
- Grafikler: Chart.js + vue-chartjs

## Sonuç
ADAB, okul içinde “dijital imece” kültürünü güçlendiren, ölçülebilir ve sürdürülebilir bir akademik destek platformudur.


## Yetki Rolleri (Özet)
- Admin: Tüm yönetim paneli, öğrenci/öğretmen yönetimi, onay-red, tasarım ve okul ayarları, toplu üye yükleme
- Öğretmen: Ders/sınıf ekleme-çıkarma, soru/cevap onay-red, istatistik görüntüleme
- Öğrenci: Soru sorma, cevap yazma, gelen cevabı çözüm kabul etme
- Ziyaretçi: Onaylı sorular ve liderlik tablosunu görüntüleme; etkileşim için giriş gerekir
