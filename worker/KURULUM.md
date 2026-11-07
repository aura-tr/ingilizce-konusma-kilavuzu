# AURA Worker kurulumu (Aşama 3)

Bu köprü, uygulama ile Claude arasında durur. API anahtarı yalnızca Cloudflare'de gizli değer olarak saklanır; depoda ve uygulamada yoktur.

1. **Anthropic Console** → API Keys → yeni anahtar oluşturun. Billing → aylık harcama limiti koyun.
2. **Cloudflare** → Workers & Pages → Create → Worker → adı: `aura-worker` → Deploy.
3. Worker → **Edit code** → `aura-worker.js` dosyasının tamamını yapıştırın → Deploy.
4. Worker → Settings → **Variables and Secrets**:
   - `ANTHROPIC_API_KEY` (Secret) → Anthropic anahtarı
   - `FAMILY_CODE` (Secret) → aile kodu (kendiniz belirleyin)
   - İsteğe bağlı: `MODEL` (varsayılan `claude-haiku-5-5`), `ALLOWED_ORIGIN` (varsayılan `https://aura-tr.github.io`)
5. Worker adresini kopyalayın (`https://aura-worker.<hesap>.workers.dev`).
6. Uygulamada öğretmen sayfası `…/#desteler` → **Yapay zekâ öğretmen** → adres + aile kodu → **Kaydet ve test et**.

Test ettiğinizde "Bağlantı çalışıyor" ve öğretmenin ilk cümlesi görünür.
