#!/usr/bin/env python3
# src/services/instagramPoster.py
# Totli - Instagram auto poster (Post + Story)

import os
import sys
import json
import random
import requests
from pathlib import Path
from instagrapi import Client
from PIL import Image, ImageDraw, ImageFont
import io

# ── Config ──────────────────────────────────────────
INSTAGRAM_USERNAME = os.environ.get("INSTAGRAM_USERNAME", "")
INSTAGRAM_PASSWORD = os.environ.get("INSTAGRAM_PASSWORD", "")
TG_CHANNEL        = "https://t.me/totli_tortlari"
SHOP_PHONE        = "+998 77 737 77 40"
LOCATION_LINK     = "https://maps.app.goo.gl/aX7c62z9kNTQYBEu5"
SESSION_FILE      = Path(__file__).parent / "instagram_session.json"

# ── Shablonlar ──────────────────────────────────────
POST_CAPTIONS = [
    f"🎂 Bugun yangi tort tayyorlandi!\nHar bir bo'lagi sevgi va mahorat bilan yaratilgan.\n\n📍 Sang'sentir, Anhor minosi yonida\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#totli #Tort #sangliklar #SangSentir",
    f"✨ Shirinlik — bu shunchaki taom emas, bu his-tuyg'u!\nTotli'da har bir tort maxsus kunda siz uchun yaratiladi.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#totliDokon #popliklar #sangliklar",
    f"🍰 Tug'ilgan kun? Nikoh? Tabriklash?\nHar qanday maxsus kun uchun tort tayyorlaymiz!\n100% tabiiy mahsulotlar, noyob dizayn.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#Tort #Shirinlik #totli",
    f"🌸 Chiroyli tort — chiroyli kun!\nTotli'da professional tortchilar tomonidan tayyorlangan.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#TortToshkent #totli #Handmade",
    f"🎉 Hayotdagi har bir lahza shirin bo'lsin!\nBiz sizning xursandchiligingiz uchun ishlaymiz.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#totli #SweetLife #popliklar",
    f"👨‍🍳 Har kuni yangi, har kuni mazali!\nOshpazlarimiz ertalabdan boshlab sizning uchun ishlaydi.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#TortUsta #totli #sangliklar",
    f"💝 Sevimlilaringizni xursand qiling!\nTortimiz nafaqat ko'rishga, balki ta'mga ham ajoyib.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#Shirinlik #Tort #totliDokon",
    f"🏆 Toshkentning eng mazali torti — bu bizda!\nMijozlarimiz fikri — bizning eng katta mukofotimiz.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#BestCake #totli #sangliklarFood",
    f"🌈 Ranglar, ta'm, xushbo'ylik — hammasi bir tortda!\nTotli'da har bir buyurtma individual yondashuv bilan tayyorlanadi.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#totli #CustomCake #sangliklar",
    f"🎂 Tort — bu san'at!\nBiz har bir tortni qo'l bilan, yurak bilan yaratamiz.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#TortSanati #totli #Handmade",
    f"🍓 Yangi mavsumiy tort!\nTabiiy mevalar va krem — tabiiy ta'm.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#MavsumiyTort #totli #FreshCake",
    f"💫 Siz tanlagan dizayn — biz bajaramiz!\nFoto yuboring — xuddi shunday tortni tayyorlaymiz.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#CustomDesign #totli #popliklar",
    f"🎁 Do'stingizga sovg'a qidirmoqdasizmi?\nTort — eng yaxshi, eng shirin sovg'a!\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#SovgaTort #totli #sangliklar",
    f"☕ Choy ustiga nima yaxshi?\nAlbatta Totli'dan yangi pirog yoki keks!\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#Keks #Pirog #totli",
    f"🌟 Sifatga ishoning — Totli'ga ishoning!\nHar bir mahsulotimiz sifatli va tabiiy.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#SifatliTort #totli #sangliklar",
    f"🥳 Korporativ tadbirlar uchun tortlar!\n20+ kishilik buyurtmalarni ham bajaramiz.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#KorporativTort #totli #Event",
    f"👰 Nikoh torti — eng muhim tort!\nKelin-kuyov uchun maxsus dizayn, maxsus ta'm.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#NikohTorti #WeddingCake #totli",
    f"🎓 Bitiruvchi kuni yaqinlashmoqda?\nDiplom, gul va Totli torti — mukammal kombinatsiya!\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#Graduation #totli #TortToshkent",
    f"❄️ Sovuq kunlarda issiq shirinlik!\nTotli'da issiq choy va mazali piroglar kutmoqda.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#IssiqShirinlik #totli #sangliklar",
    f"🌺 Har kuni yangi kreatsiya!\nOshpazlarimiz har kuni yangi dizaynlar tayyorlaydi.\n\n📍 Sang'sentir, Anhor minosi\n📞 {SHOP_PHONE}\n🔗 {TG_CHANNEL}\n🗺 {LOCATION_LINK}\n\n#DailyBake #totli #FreshCake",
]

STORY_CAPTIONS = [
    f"🎂 Bugungi tort!\nBuyurtma: {SHOP_PHONE}\n👆 Kanal: {TG_CHANNEL}",
    f"✨ Yangi tort tayyor!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"😍 Bu tortni ko'rdingizmi?!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🔥 Bugun juda chiroyli chiqdi!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"💝 Sevimlilaringizga sovg'a!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🎉 Yangi kreatsiya!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"👀 Bugungi yangilik!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🌸 Chiroyli va mazali!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"⭐ Bugun ham sifatli!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🍓 Yangi tort! Tabiiy, mazali!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🎂 Kunlik yangilik!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"💫 Har kuni yangi!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🥳 Bayram uchun tort?\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"😋 Mazali ko'rinmayaptimi?!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🌈 Rang-barang, mazali!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"✅ Sifat kafolat!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🎁 Sovg'a uchun ideal!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"💖 Bugungi maxsus tort!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🏆 Eng mazali tort bizda!\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
    f"🌟 Yangi ish! Yoqdimi?\n📞 {SHOP_PHONE}\n👆 {TG_CHANNEL}",
]

# ── Instagram client ─────────────────────────────────
def get_client():
    cl = Client()
    cl.delay_range = [2, 5]

    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD)
            print("✅ Session yuklandi")
            return cl
        except Exception as e:
            print(f"⚠️ Session eskirgan, qayta login: {e}")

    cl.login(INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD)
    cl.dump_settings(SESSION_FILE)
    print("✅ Instagram ga kirildi")
    return cl

# ── Rasmni kvadrat qilish (Instagram uchun) ──────────
def prepare_image(img_path: Path) -> Path:
    img = Image.open(img_path).convert("RGB")
    w, h = img.size
    size = max(w, h)
    bg = Image.new("RGB", (size, size), (255, 255, 255))
    bg.paste(img, ((size - w) // 2, (size - h) // 2))
    bg = bg.resize((1080, 1080), Image.LANCZOS)
    out = img_path.parent / f"ready_{img_path.name}"
    bg.save(out, "JPEG", quality=95)
    return out

# ── Asosiy funksiya ──────────────────────────────────
def post_to_instagram(image_paths: list):
    """
    image_paths: 5 ta rasm yo'li (list of str)
    1 ta carousel post + 5 ta story joylanadi
    """
    if not INSTAGRAM_USERNAME or not INSTAGRAM_PASSWORD:
        print("❌ INSTAGRAM_USERNAME yoki INSTAGRAM_PASSWORD .env da yo'q")
        sys.exit(1)

    if len(image_paths) < 1:
        print("❌ Rasm yo'li berilmadi")
        sys.exit(1)

    cl = get_client()

    # Rasmlarni tayyorlash
    ready_paths = []
    for p in image_paths:
        rp = prepare_image(Path(p))
        ready_paths.append(rp)

    post_caption  = random.choice(POST_CAPTIONS)
    story_caption = random.choice(STORY_CAPTIONS)

    # ── 1. Carousel POST (5 ta rasm bitta postda) ──
    try:
        if len(ready_paths) == 1:
            cl.photo_upload(ready_paths[0], post_caption)
        else:
            cl.album_upload(ready_paths, post_caption)
        print("✅ Post joylandi")
    except Exception as e:
        print(f"❌ Post xatosi: {e}")

    # ── 2. Har bir rasm uchun Story ──
    for i, rp in enumerate(ready_paths):
        try:
            # Story uchun 9:16 formatga o'tkazamiz
            img = Image.open(rp).convert("RGB")
            story_bg = Image.new("RGB", (1080, 1920), (18, 18, 18))
            img.thumbnail((1080, 1080))
            w, h = img.size
            story_bg.paste(img, ((1080 - w) // 2, (1920 - h) // 2 - 100))

            story_path = rp.parent / f"story_{i}_{rp.name}"
            story_bg.save(story_path, "JPEG", quality=95)

            # Story link (TG kanal) — sticker sifatida
            cl.photo_upload_to_story(
                story_path,
                caption=story_caption,
                links=[{"webUri": TG_CHANNEL}]
            )
            print(f"✅ Story {i+1} joylandi")
        except Exception as e:
            print(f"⚠️ Story {i+1} xatosi: {e}")

    # Vaqtinchalik fayllarni tozalash
    for rp in ready_paths:
        try:
            rp.unlink()
        except:
            pass

    print("🎉 Hammasi tayyor!")

if __name__ == "__main__":
    # node dan chaqirilganda: python3 instagramPoster.py img1.jpg img2.jpg ...
    images = sys.argv[1:]
    post_to_instagram(images)
