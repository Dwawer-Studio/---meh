# تشغيل تاماشي P4

## العقد المالي

تاماشي عملة داخل اللعبة بلا cash-out أو تحويل لاعب-إلى-لاعب أو wager. مصادرها
المسموحة فقط:

- `verified_gameplay`: مباراة خادمية مكتملة، بشران أصليان على الأقل، والمقعد
  بقي بشريًا متصلًا.
- `verified_in_app_purchase`: verifier حقيقي يعيد transaction/SKU/amount
  المطابق لقائمة الخادم.
- `catch_up_adjustment`: حملة تشغيل داخلية idempotent ومحددة الأهلية والانتهاء.

المصرف الحالي الوحيد هو `card_unlock` مباشر بسعر ثابت. لا packs ولا duplicate
ولا احتمالات.

## المكافأة المقفلة مبدئيًا

- إكمال موثوق: 100.
- مشاركة صحية: 20.
- فوز: 20.
- فائز مشارك 140 مقابل خاسر مشارك 120؛ فرق 16.67%.
- أي مقعد خرج/انقطع أو نُفذ عنه إجراء تلقائي بسبب انتهاء المؤقت لا يأخذ منحة
  تلك المباراة؛ لا تكفي إبقاء الجلسة متصلة لكسب تاماشي.
- نفس cohort: أول 8 مباريات في نافذة 24 ساعة.
- الحساب: 20 مباراة مكافأة في يوم UTC.
- حملة catch-up داخلية فقط، idempotent، بتاريخ أهلية/انتهاء صالحين، وبحد أقصى
  100,000 تاماشي للحساب في الحملة الواحدة لمنع خطأ تشغيل كارثي.

السعر المستهدف = عدد الجلسات × 120، لذلك اللاعب الصحي يصل في الزمن المعلن حتى
لو لم يفز. bonus الفوز يسرّع فقط. هذه أرقام engineering provisional؛ لا يُفعّل
مصرف إنتاج قبل `P4-E01`.

## reconciliation المنفذ

تعمل المصالحة عند إقلاع الخدمة ثم كل خمس دقائق، ويمكن للمشغل تشغيلها يدويًا عبر
`POST /internal/tamashi/reconcile` من loopback وبـadmin token. تتحقق من:

1. مجموع credits - debits لكل حساب = wallet balance.
2. كل receipt له ledger واحد أو duplicate بلا credit.
3. كل unlock له debit واحد بالسعر المنشور.
4. كل match settlement له صفر أو أكثر من grants، ولا match يمنح مرتين.
5. تسلسل `wallet_revision` بلا فجوات، وكل `balance_after` يطابق السلسلة.
6. lifetime gameplay/purchased/spent يطابق مصادر دفتر القيود.

أي فرق أو تعذر قراءة snapshot يجمّد كل mutations في `tamashi_wallet` و
`verified_iap` داخل العملية ويرجع `ECONOMY_FROZEN` مع إبقاء اللعب والقراءة.
قراءة حساب بلا محفظة تعيد رصيدًا صفريًا افتراضيًا ولا تنشئ صفًا، لذلك يبقى هذا
العقد صحيحًا حتى أثناء التجميد.
التجميد sticky ولا يزول بعودة فحص واحد ناجح؛ يلزم تحقيق، إصلاح forward مدقق،
ثم إعادة تشغيل مراقبة. لا يصحح الرصيد بتعديل مباشر. ينشأ قيد تعويضي مدقق فقط
بعد التحقيق.

## تفعيل الشراء

`verified_iap` يبقى مغلقًا حتى:

- adapter Apple/Google فعلي مع تحقق server-to-server.
- sandbox واختبارات duplicate/concurrency/refund.
- قائمة SKU وamount مراجعة وموقعة ضمن release.
- سياسة refund/chargeback ودعم المستخدم واحتفاظ السجل معتمدة.
- dashboard لمعدل الرفض، mismatch، duplicate ووقت verifier.

غياب أي شرط يعني 404 لا verifier تجريبي في الإنتاج.
الخدمة تحد تحقق الإيصال بعشر ثوانٍ، تمرر `AbortSignal` للمحوّل، وتحوّل تعطل
الموفّر إلى `PURCHASE_VERIFICATION_UNAVAILABLE` بلا تسريب رسالة الموفّر للعميل.

## الحوادث

- receipt reuse أو mismatch: لا credit، audit، ورفع fraud signal بلا token خام.
- ارتفاع reward suppression: ثبّت السياسة ولا توسع؛ افحص false positives.
- farming: جمّد source المتأثر لا أرصدة سليمة؛ لا تعاقب الخسارة.
- خطأ سعر: عطّل البطاقة/content flag؛ لا تحذف ledger ولا migration.
- حذف حساب: wallet/unlocks تزول، والسجل يبقى منزوع account id وفق سياسة
  الاحتفاظ.
