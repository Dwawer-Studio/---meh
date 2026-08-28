# عقد بروتوكول P2

الإصدار: `meh.realtime.v1`

## 1. الغلاف

يرسل العميل:

```json
{
  "v": 1,
  "type": "match.action",
  "requestId": "01J...ULID",
  "clientSeq": 12,
  "lastServerSeq": 41,
  "payload": {}
}
```

ويرد الخادم:

```json
{
  "v": 1,
  "type": "match.ack",
  "serverSeq": 42,
  "ackRequestId": "01J...ULID",
  "stateVersion": 9,
  "stateFingerprint": "fnv1a32-...",
  "payload": {}
}
```

## 2. الثوابت والحدود

| الحقل | العقد |
|---|---|
| حجم الرسالة | 16 KiB كحد أقصى |
| `requestId` | 16–64 حرفًا من `[A-Za-z0-9_-]` |
| `clientSeq` | عدد صحيح موجب، يزيد واحدًا لكل connection session |
| `serverSeq` | عدد صحيح موجب خاص بالغرفة، لا يعاد استخدامه |
| مهلة `hello` | 5 ثوانٍ |
| heartbeat | ping كل 10 ثوانٍ، إنهاء بعد غياب pong لدورتين |
| seat lease | 30 ثانية من آخر انقطاع قابل للاستعادة |
| action rate | burst 8، refill بمعدل 4/ثانية لكل connection |
| join rate | 10 محاولات/دقيقة لكل IP hash ثم تباطؤ/رفض |

## 3. أنواع العميل

- `session.hello`: إثبات guest/access token، نسخة العميل، وآخر `serverSeq`.
- `room.create`: إنشاء مجلس خاص أو quick play.
- `room.join`: دخول بكود؛ الرمز ليس سر مصادقة.
- `seat.resume`: رمز استعادة يعرض مرة واحدة.
- `seat.ready`: جاهزية الجولة التالية.
- `match.action`: `play`, `draw`, أو قرار أثر مع `turnId` متوقع.
- `snapshot.request`: عند فجوة أو بصمة غير مطابقة.
- `seat.leave`: إلغاء الرمز والعقد فورًا.

لا يقبل الخادم اسم اللاعب أو `seatId` أو وقت الحركة كدليل ملكية. الملكية تأتي
من الجلسة المصادق عليها وربط الاتصال بالمقعد.

## 4. ردود الخادم

- `session.welcome`: session id وقدرات الإصدار.
- `room.snapshot`: عرض منقح بحسب المقعد.
- `match.ack`: إقرار فعل واحد، وقد يكون `duplicate: true`.
- `match.rejected`: سبب ثابت مثل `OUT_OF_TURN`, `ILLEGAL_CARD`,
  `STALE_TURN`, `BAD_SEQUENCE`, أو `RATE_LIMITED`.
- `seat.lease`: رمز جديد يعرض مرة واحدة ووقت انتهائه.
- `server.resync_required`: فجوة لا يغطيها مخزن الرسائل؛ يليه snapshot.
- `server.error`: معرف حادث فقط، بلا stack أو SQL أو سر.

## 5. ترتيب المعالجة

```text
تحقق الحجم/JSON/schema
→ تحقق الجلسة وrate limit
→ استرجاع نتيجة idempotency إن وجدت
→ تحقق clientSeq وrequestId للطلب الجديد
→ قفل الغرفة ومعاملة التخزين
→ MatchReducer
→ حفظ action + snapshot عند السياسة
→ commit
→ حفظ الإقرار ثم البث المنقح
```

إذا فشل الحفظ لا يبث الخادم حالة جديدة. وإذا انقطع العميل بعد commit يعيد
الطلب نفسه، فيستلم الإقرار المخزن بدل تنفيذ مزدوج.

مفتاح idempotency الدائم `(roomId, requestId)` ويرتبط بالمقعد والحساب. لذلك
يبقى صالحًا بعد اتصال استعادة جديد، ولا يستطيع مقعد آخر استرداد الرد حتى لو
عرف `requestId`.

## 6. التنقيح

snapshot المقعد يحتوي يده كاملة، عدد أوراق الآخرين، أعلى بطاقة، اللون، الدور،
العقوبة، والخيارات القانونية لذلك المقعد. لا يحتوي ترتيب الرزمة، أيدي الآخرين،
بصمات رموز الاستعادة، IP، أو حقول تدقيق داخلية.

## 7. واجهة الحساب والمزامنة

- `POST /v1/guest`: ينشئ هوية ضيف ورمز وصول يعرض مرة واحدة.
- `POST /v1/account/upgrade`: ترقية اختيارية؛ لا تخزن مادة الاعتماد الخام.
- `POST /v1/account/login`: إصدار جلسة جديدة للحساب المرقّى؛ الخطأ موحد ولا
  يكشف إن كان `accountId` موجودًا.
- `PATCH /v1/account/settings`: دمج قائمة إعدادات مقيدة وزيادة `syncRevision`.
- `GET /v1/account/sync`: snapshot مصادق عليه للحساب والإعدادات وعضويات
  المجالس التي وافق عليها اللاعب، مع revision لكل مجلس.
- `DELETE /v1/account`: حذف الحساب والجلسات والعضويات وفصل الهوية عن السجل.

إنشاء المجلس وتجربة «آخر المجالس» نفسها من نطاق P3؛ P2 توفر مخطط العضوية
وعقد المزامنة فقط كي لا تخزن P3 هذه الحالة محليًا أو في العميل.
