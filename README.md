<div align="center">

# 🎴 مِهْ — Meh

### لعبة ورق بطابع بحريني تُلعب في المتصفّح

تخلّص من جميع بطاقاتك قبل اللاعبين الآخرين عبر مطابقة **الألوان** أو **الشخصيات** — مع بطاقات خاصة وقوى خارقة بطابع خليجي مرح.

</div>

---

## ✨ المميزات

- 🃏 **لعب فوري في المتصفّح** — بدون تثبيت، فقط افتح ولعب
- 🤖 **3 خصوم أذكياء** (أحمد، نورة، خالد) بذكاء اصطناعي
- 🌐 **لعب جماعي أونلاين** — أنشئ غرفة وشارك كودها مع أصدقائك، مع استعادة الاتصال المؤقت
- 🪑 **مجالس عائدة اختيارية** — موافقة صريحة، إعادة تجميع، حصيلة مجلس وموعد اختياري خلف أعلام مستقلة
- 👤 **نظام أعضاء** — احفظ اسمك وصورتك وإحصائياتك (فوز/خسارة)
- 🌐 **لغتان** — عربي / English مع دعم كامل للاتجاهين (RTL/LTR)
- 🔊 **مؤثرات صوتية** مولّدة برمجياً (بلا ملفات صوت)
- 👁️ **مراعاة عمى الألوان** — رموز مميزة لكل لون
- ⌨️ **دعم لوحة المفاتيح وقارئات الشاشة** — بطاقات وأفعال مسماة مع إدارة واضحة للتركيز
- 🔋 **وضع توفير البطارية** و ☀️ **منع نوم الشاشة**
- 😊 **تفاعل بالإيموجي** أثناء اللعب
- ✨ حركات وتأثيرات: توزيع أوراق حقيقي، مؤشّر اتجاه دوّار، قصاصات احتفال

## 🎯 كيف تلعب

1. اضغط **العب**
2. في دورك، ارمِ بطاقة تطابق **اللون** أو **الشخصية** المعروضة
3. يمكنك السحب من الكومة بدل الرمي حتى لو كانت لديك بطاقة مناسبة
4. أول من يتخلّص من كل بطاقاته **يفوز!**

### 🌟 بطاقات مميزة
| البطاقة | التأثير |
|---|---|
| 🃏 مِهْ | التالي يسحب 1 + تختار اللون |
| 📜 شنو كنت تقول | التالي يسحب 4 + تختار اللون |
| 🛑 انثبر مكانك | تخطّي اللاعب التالي |
| 🔄 يوتيرن | عكس اتجاه اللعب |
| ⚡ هجمة مرتدة | ترتدّ على من هاجمك بالسحب |
| 🦇 فانتوم | يلغي السحب المعلّق + حصانة |
| 👸 دراما كوين | تخطّي لاعبَين |
| ⚓ النوخذة | الدور يرجع لك |

## 🛠️ التقنيات

- **HTML / CSS / JavaScript** بلا إطار عمل في المتصفح
- **Node.js + WebSocket + PostgreSQL** لمسار اللعب صاحب السلطة، مع PeerJS كمسار ودي قديم بلا نتائج موثوقة
- **Web Audio API** للأصوات
- **localStorage** لحفظ الأعضاء والإعدادات

## 🚀 التشغيل محلياً

يمكن فتح `index.html` مباشرة. ولتشغيل محلي ثابت مطابق لبوابة المتصفح استخدم
خادم التطوير الصغير المرفق:

```bash
git clone https://github.com/Dwawer-Studio/---meh.git
cd ---meh
npm ci
npm run serve
# افتح http://127.0.0.1:4173
```

ولتجربة خدمة P2 صاحبة السلطة محليًا، اترك خادم الواجهة يعمل وشغّل في نافذة
طرفية ثانية:

```bash
npm run serve:service
# افتح http://127.0.0.1:4173/?service=local
```

مشغّل التطوير يستخدم ذاكرة مؤقتة عمدًا؛ تفقد الغرف والحسابات عند إيقافه. وضع
الإنتاج يرفض البدء بلا `DATABASE_URL` و`MEH_APP_SECRET` و`MEH_INTERNAL_ADMIN_TOKEN`
مستقل، وتوجد القيم الموثقة في `.env.example`.

## 🧪 الفحص للمطورين

تحتاج أدوات الفحص إلى Node.js 22.22 أو أحدث ضمن الإصدار 22، أو Node.js 24.8
فما بعد. ثبّت الاعتماديات المقفلة ثم شغّل البوابة الكاملة:

```bash
npm ci
npm run test:e2e:install
npm run check
```

يمكن تشغيل الأجزاء منفردة عبر `npm run validate` و`npm test` و`npm run test:security`
و`npm run test:reliability` و`npm run test:rules` و`npm run test:quality`
و`npm run test:responsive` و`npm run test:architecture` و`npm run test:smoke`
و`npm run test:workflows` و`npm run test:final` و`npm run test:e2e`
و`npm run check:assets`. بوابات P2 المنفصلة هي `npm run test:p2`،
و`npm run test:p2:replay`، و`npm run test:p2:load`،
و`npm run test:p2:network-load`، و`npm run test:p2:recovery`. وبوابتا P3 هما
`npm run test:p3` و`npm run test:p3:load`. وبوابات P4 هي
`npm run test:p4`، و`npm run test:p4:simulation` لمحاكاة 100 ألف مباراة،
و`npm run test:p4:economy` لمعايرة نموذج تاماشي. ولإعادة
الاختبار من لقطة مؤقتة بلا `node_modules` مسبق:

```bash
npm run check:clean
```

تفاصيل خط الأساس والعيوب المسجّلة موجودة في `docs/BASELINE.md`، وتقرير إصلاحات
الأمان في `docs/PHASE-1-SECURITY.md`، وتقرير الاعتمادية والاستعادة في
`docs/PHASE-2-RELIABILITY.md`، وتقرير سلامة قواعد البطاقات في
`docs/PHASE-3-GAME-RULES.md`، وتقرير إمكانية الوصول في
`docs/PHASE-4-ACCESSIBILITY.md`، وتقرير جودة القالب وتنظيم CSS في
`docs/PHASE-5-QUALITY.md`، وتقرير تجربة الهاتف والتخطيط المتجاوب في
`docs/PHASE-6-RESPONSIVE.md`، وتقرير تفكيك بنية محرك اللعبة في
`docs/PHASE-7-ARCHITECTURE.md`، وتقرير التشغيل المحلي وفصل النشر في
`docs/PHASE-8-LOCAL-CI.md`، وتقرير اختبارات المتصفح الفعلية في
`docs/PHASE-9-BROWSER-E2E.md`، وتقرير اختبار العميلين في
`docs/PHASE-10-ONLINE-E2E.md`، والمراجعة الختامية ومصفوفة الجاهزية في
`docs/PHASE-11-FINAL-AUDIT.md`، ومرجع قواعد اللعب المعتمدة في
`docs/RULES-DECISIONS.md`. أما برنامج التحول من لعبة مكتملة الأساس إلى منتج
اجتماعي قابل للنمو، مع إبقاء قلب اللعب ثابتًا، فموثق في
`docs/PRODUCT-TRANSFORMATION-PROGRAM.md`. وتقرير تنفيذ مرحلة تأسيس الدليل P0 في
`docs/PHASE-P0-CORE-EVIDENCE.md`، مع نموذج التهديد في
`docs/THREAT-MODEL-P0.md`. أما تنفيذ الشريحة الاجتماعية P1 وحالتها الصادقة ففي
`docs/PHASE-P1-SOCIAL-SESSION.md`، ودليل اختبارها البشري في
`docs/P1-VALIDATION-RUNBOOK.md`، ونموذج تهديدها في `docs/THREAT-MODEL-P1.md`.
وتنفيذ خدمة P2 وعقدها وتشغيلها موثق في `docs/PHASE-P2-SOCIAL-SERVICE.md`،
و`docs/P2-PROTOCOL.md`، و`docs/P2-OPERATIONS-RUNBOOK.md`، ونموذج تهديدها في
`docs/THREAT-MODEL-P2.md`. وتنفيذ المجلس العائد P3 موثق في
`docs/PHASE-P3-RETURNING-MAJLIS.md`، وخطة تجاربه في `docs/P3-EXPERIMENT-PLAN.md`،
وتشغيل البلاغات في `docs/P3-MODERATION-RUNBOOK.md`، ونموذج تهديده في
`docs/THREAT-MODEL-P3.md`. وتنفيذ كتالوج البطاقات وتاماشي P4 موثق في
`docs/PHASE-P4-CARD-CATALOG.md`، وعقد تأليف البطاقة في
`docs/P4-CARD-AUTHORING-CONTRACT.md`، وتشغيل الاقتصاد في
`docs/P4-TAMASHI-OPERATIONS.md`، والطرح والرجوع في
`docs/P4-CATALOG-ROLLOUT-ROLLBACK.md`، ونموذج التهديد في
`docs/THREAT-MODEL-P4.md`.
أما برنامج إعادة بناء UI/UX من هوية Dwawer، مع قفل قلب اللعبة وآرت البطاقات،
فموثق في `docs/UIUX-STUDIO-IDENTITY-TRANSFORMATION.md`.
وتنفيذ شريحة الدستور البصري والنماذج المرجعية UIX-0 موثق في
`docs/UIX-0-VISUAL-CONTRACT.md`.
والاختبارات البشرية والميدانية المؤجلة بقرار مالك المنتج مجمعة في
`docs/DEFERRED-VALIDATION-REGISTER.md`.

خلال التطوير تشغّل GitHub Actions بوابة الاختبارات فقط. نشر Azure محفوظ كفعل
يدوي صريح، ولا يعمل تلقائيًا على الفروع أو طلبات الدمج إلى أن تُجهز الاستضافة.

---

<div align="center">
صُنعت بحبّ 🇧🇭
</div>
