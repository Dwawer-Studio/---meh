# طرح ورجوع كتالوج P4

## ترتيب التفعيل

```text
schema additive
→ card_catalog قراءة فقط
→ tamashi_wallet من verified gameplay
→ free rotation / card_lab
→ friendly_recipes
→ تعريف واحد friendly-5
→ public standardized recipe بعد التحقق
→ verified_iap أخيرًا وبموفّر حقيقي
```

كل علم مستقل ومغلق افتراضيًا. `catalog_expansion` لا يفتح تلقائيًا في local
ولا production. التطبيق الذي يحتوي التعريف والآرت ينشر قبل تفعيل catalog؛
capability لكل جالس تمنع unknown definition.

تبعيات الخادم تفشل الإقلاع بدل تشغيل وضع جزئي: `card_catalog` يحتاج
`tamashi_wallet`، و`friendly_recipes` يحتاج الاثنين، و`verified_iap` يحتاج
المحفظة. يمكن إبقاء المحفظة وحدها لجمع مكافآت اللعب قبل فتح واجهة الكتالوج.

إقلاع التوسعة يفشل إن غاب أي من:

- `MEH_CATALOG_EXPANSION=true`
- `MEH_CATALOG_ENVELOPE_PATH` إلى envelope موقّع لا إلى manifest خام.
- `MEH_CATALOG_PUBLIC_KEY` لمفتاح Ed25519 العام؛ يقبل `\n` المهرب في السر.

ثم تمرر `MEH_CARD_CONTENT_FLAGS` و`MEH_FREE_ROTATION_IDS` بعد تفعيل النسخة
الموقعة. أي علم أو تعريف دوران غير موجود يوقف الإقلاع بدل التجاهل الصامت. لا
يوضع المفتاح الخاص أو receipt أو token في هذه المتغيرات.

## بوابة 5%

- غرفة ودية فقط، تعريف واحد، content flag واحد.
- sample وguardrails مقفلة في `P4-R01`.
- لا تغيير وصفة أثناء مباراة أو بعد ready من دون تصفير ready.
- الوصفة ونسخة catalog تقفلان في room/replay.
- لا توسيع إذا العينة غير كافية حتى لو لم يصل alert.

## حواجز التوقف

- loop أو card loss أو replay mismatch أو unknown definition واحد.
- انخفاض MCR أو ارتفاع early exit/مدة المباراة فوق P4-R01.
- تعريف لا يفهم أثره/counterplay في P4-H01.
- فرق ledger واحد، رصيد سالب، receipt مزدوج، أو unlock مزدوج.
- شبهة أفضلية ملكية فردية أو public recipe مختلف بين لاعبين.

## الرجوع

1. أوقف توجيه غرف جديدة للـcontent flag.
2. اترك الغرف المقفلة السليمة تكمل إن لم توجد مشكلة نزاهة؛ عند النزاهة
   أغلقها ولا تمنح نتيجة اقتصادية.
3. عطّل `MEH_CARD_CONTENT_FLAGS` للبطاقة أولًا. `CatalogRegistry.rollback()`
   يعيد embedded classic، ثم عطّل
   `catalog_expansion` و`friendly_recipes` حسب نطاق الحادث.
   أبقِ envelope والمفتاح العام مثبتين عند إعادة التشغيل: الخادم يسجل النسخة
   التاريخية لاستعادة الغرف المقفلة عليها لكنه لا يفعّلها للغرف الجديدة عندما
   يكون `MEH_CATALOG_EXPANSION=false`.
4. لا down migration ولا حذف ledger/receipt/unlock. أصلح forward.
5. العميل القديم يرى classic فقط؛ العميل الذي يحتاج تعريفًا مجهولًا يُرفض
   بـ`CATALOG_UPDATE_REQUIRED` ولا يدخل match ناقصة.
6. replay للحادث + 100k regression + اختبار بشري قبل العودة إلى 5%.
