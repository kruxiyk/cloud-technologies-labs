# ЛР2 · В10 «Служба доставки» · Ідентичність і доступ

Модель доступу з ХТС_Лаб2_Варіанти.pdf: **власник + модератор**. JavaScript, Cloudflare Workers, Google Cloud Firestore. Використовується той самий Firebase-проєкт `lab1-v10-delivery`, база `(default)`, Worker `lab1-v10-delivery` та адреса ЛР1.

- Адреса після розгортання ЛР2: https://lab1-v10-delivery.kruxi-labs.workers.dev
- Сторінка входу після розгортання: https://lab1-v10-delivery.kruxi-labs.workers.dev/login
- Репозиторій: https://github.com/kruxiyk/cloud-technologies-labs (розмістити цей каталог у `lr2/`).

**Стан комплекту:** ЛР2 розгорнуто на Worker ЛР1. Вхід через Google перевірено локально та за публічною адресою /login. check2.mjs: локально 24/24, workers.dev 24/24. Секрет ADMIN_TOKEN видалено.

## 1. Що змінилося

`src/auth.js` адаптований із готового Firestore-модуля прикладу ЛР2: один `accounts:lookup` для переданого токена, перевірка exp після перевірки Firebase. Додані захисні перевірки структури JWT, uid, aud/iss та відповідь 503 при недоступності сервісу; підпис не перевіряється простим декодуванням — для цього обов’язково виконується lookup. `AUTH_URL` дозволений лише для ізольованих тестів, у конфігурації Worker його немає.

`src/index.js`: кожен API-запит потребує ID token, роль читається з `roles/{uid}`, власник нової посилки береться тільки з перевіреного токена. Усі відповіді мають **Cache-Control: no-store**, включно з помилками та /login. Static assets проходять через Worker (`run_worker_first=true`), тому кеш не обходить цю політику.

У файлах ЛР1 для В10 метод зміни не вказаний (маршрути там передбачали тільки GET/POST). У цій адаптації ЛР2 **обрано PATCH /api/parcels/:id** для часткової зміни за фрагментом mutations прикладу. DELETE і PUT не реалізовані. Це явне рішення адаптації, а не твердження про відсутню в таблиці вимогу В10. У готовому check2.mjs змінено лише CONFIG: предметна область, PATCH, тестова посилка та подія; логіку перевірок не змінено. Для одного методу зміни оригінальний скрипт виконує 24 перевірки.

Статистика ЛР1 `?day=YYYY-MM-DD` збережена: звичайний користувач бачить суму лише своїх доставлених посилок за created_on, модератор — усіх. Додатковий параметр `parcel_id` звужує статистику до одного документа й перевіряє deny (чужий — 403). Він потрібен готовому check2.mjs для перевірки доступу до статистики конкретного запису; інша посилка не домішується до результату. Окремої дати вручення у схемі досі немає.

## 2. Розпакування

У папці репозиторію мають бути окремі `lr1/` та `lr2/`. Розпакуйте каталог lr2 з архіву поруч із lr1. Не копіюйте node_modules чи секрети до репозиторію. PowerShell у каталозі lr2:

```powershell
npm.cmd ci
npm.cmd run check:syntax
npm.cmd test
```

Якщо GitHub-копія lr1 не містить `.dev.vars`, джерелом ключа залишається оригінальна робоча папка `D:\DNU\Хмарні технології\project\.dev.vars`. Новий ключ сервісного акаунта створювати не потрібно.

## 3. Firebase Authentication

Відкрийте **наявний** проєкт `lab1-v10-delivery` у Firebase Console.

1. Security → Authentication → Get started.
2. Sign-in method → Google → Enable. Support email — власна особиста пошта. Save.
3. Add new provider → Email/Password → увімкніть перший перемикач Email/Password; Email link не потрібний. Save.
4. Authentication → Settings → Authorized domains: додайте `localhost` і `lab1-v10-delivery.kruxi-labs.workers.dev` без протоколу і шляху. У нових Firebase-проєктах localhost може не бути автоматично. Для браузерного входу відкривайте саме localhost, не 127.0.0.1.
5. Project settings → General → Your apps → Web (`</>`) → nickname `lr2-login`. Firebase Hosting не вмикайте. Register app.
6. Із firebaseConfig потрібен **apiKey**. authDomain та projectId цього проєкту вже заповнено у wrangler.jsonc. Це публічні налаштування, не GCP private_key і не ID token.

Підказки: [вхід Google](https://firebase.google.com/docs/auth/web/google-signin), [localhost у нових проєктах](https://firebase.google.com/docs/auth/faq-and-troubleshooting), [Firestore/IAM і lookup з методички](https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/lookup).

## 4. Конфігурація та локальні секрети

```powershell
npm.cmd run configure
```

Скрипт запитає публічний Web apiKey та повний шлях до `.dev.vars` ЛР1. Він запише Web apiKey до vars у wrangler.jsonc та **лише GCP_SA_KEY** у новий `.dev.vars`, у UTF-8 без BOM. Старий файл ЛР1 не змінюється. Не вказуйте шлях до JSON-ключа: очікується саме `.dev.vars` ЛР1. Якщо `.dev.vars` ЛР2 уже існує, скрипт не перезапише його; налаштуйте ключ вручну або пропустіть копіювання Enter.

У ЛР2 спільний секрет не використовується. Не додавайте в її `.dev.vars` ADMIN_TOKEN. Не показуйте ключ, ID token чи паролі в чаті, звіті, скриншотах або git. `.test-users.json` та `*-token.txt` уже внесені до .gitignore. Web apiKey — не секрет.

## 5. Локальний вхід

```powershell
npm.cmd run dev
```

Відкрийте http://localhost:8787/login. Увійдіть особистим Google-акаунтом або email/password. Сторінка показує uid та дозволяє викликати власний API. Розділ токена закритий у details; не розкривайте його на скриншотах. Токен зберігається в пам’яті сторінки, SDK оновлює його; після перезавантаження сторінки потрібно ввійти знову. Виклик API передає свіжий токен. Зовнішній URL у полі запиту заборонений, щоб випадково не передати Bearer-токен іншому сайту.

Сторінка використовує ту саму закріплену версію Firebase SDK 12.19.0, що й наданий приклад. Конфігурацію вона читає з /firebase-config.json; дублювати apiKey у HTML не потрібно.

## 6. Готовий check2.mjs та модератор

У **другому** терміналі, також у lr2:

```powershell
npm.cmd run check -- http://localhost:8787
```

Обгортка читає Web apiKey із конфігурації та запускає наданий check2.mjs. Прямий еквівалент: `node check2.mjs http://localhost:8787 YOUR_WEB_API_KEY`.

Перший запуск створює alice@example.com, bob@example.com і mod@example.com з випадковими паролями в локальному `.test-users.json`, друкує **uid модератора** та інструкцію. До призначення ролі перевірки mod закономірно не пройдуть.

У Firestore Console, тій самій базі `(default)`:

- створіть колекцію `roles`;
- Document ID — **точний uid mod**, надрукований check2.mjs;
- поле `role`, тип string, значення `moderator`.

Призначити цю роль через /api неможливо. Роль не слід призначати alice чи bob. Збережіть документ і повторіть команду перевірки. Очікуваний результат після налаштування — **«Пройшло 24 з 24»**. Цей рядок до реального запуску є очікуванням, не доказом хмарної роботи.

При помилці 503 дивіться перший термінал. Firestore може попросити **новий індекс із owner_uid**: відкрийте посилання з помилки, Create, дочекайтеся Enabled та повторіть check2. Конфігурація індексів включає старі індекси ЛР1 і нові власницькі. Можна скористатися Firebase CLI для їх розгортання; не видаляйте наявні індекси ЛР1.

check2 сам створює тестові посилки та події в місті `Перевірка-ЛР2`, тому запуск seed для перевірки не потрібний. Повторні перевірки додають по дві посилки; старі посилки ЛР1 не видаляються. При дуже великій кількості запусків вибірка тестових записів може перевищити limit=100 — прибирайте старі тестові записи через консоль, не змінюючи даних ЛР1. Користувачів alice/bob/mod та `.test-users.json` збережіть до захисту ЛР3. Флаги оригінального скрипта --token/--delete у спрощеній роботі не потрібні; не запускайте їх.

## 7. Матриця доступу В10

Таблиця описує очікувані коди для коректних параметрів та наявної посилки. Власник — автор цієї посилки; інший користувач — alice/bob без ролі.

| Маршрут | Без токена | Власник | Інший користувач | Модератор |
| --- | --- | --- | --- | --- |
| GET /api/parcels | 401 | 200, лише свої | 200, лише свої | 200, усі |
| POST /api/parcels | 401 | 201, owner з токена | 201, owner з його токена | 201, owner з токена mod |
| GET /api/parcels/:id | 401 | 200 | 403 | 200 |
| GET /api/parcels/stats?day=… | 401 | 200, сума своїх | 200, сума своїх | 200, сума всіх |
| GET /api/parcels/stats?day=…&parcel_id=:id | 401 | 200 | 403 | 200 |
| GET /api/parcels/:id/events | 401 | 200 | 403 | 200 |
| POST /api/parcels/:id/events | 401 | 201 | 403 | 201 |
| PATCH /api/parcels/:id | 401 | 200 | 403 | 200 |
| POST /api/roles | 401 | 404 | 404 | 404 |

Для неіснуючого документа після автентифікації — 404. Для PUT/DELETE від автентифікованого користувача — 405. Некоректні поля — 400; підміна owner_uid — 403. Усі ці відповіді мають no-store. GET /login, /login.js, /firebase-config.json публічні; без дійсного ID token API не відкривається. PATCH ніколи не змінює owner_uid, навіть коли його виконує модератор; права події успадковано від посилки. Для простого читання додається одне читання документа ролі, тому x-read-count може відрізнятися від ЛР1.

## 8. Що буде зі старими даними

30 посилок ЛР1 без owner_uid залишаються в тій самій колекції. Звичайному користувачеві вони недоступні; модератор бачить їх та їхні events. Автоматичного присвоєння власника чи міграції немає. Якщо потрібні власні приклади, увійдіть через /login, задайте ID_TOKEN локально і виконайте seed.mjs один раз: він додасть 30 нових власних посилок, а не перенесе існуючі. Для check2 це зайве.

## 9. Розгортання після захисту ЛР1

Переконайтеся, що локально пройшли всі перевірки та особистий Google-вхід. Потім із lr2:

```powershell
npm.cmd run deploy
npx.cmd wrangler secret bulk .dev.vars
npx.cmd wrangler secret delete ADMIN_TOKEN
npm.cmd run check -- https://lab1-v10-delivery.kruxi-labs.workers.dev
```

Підтвердження видалення ADMIN_TOKEN — yes. GCP_SA_KEY не видаляйте. Ім’я Worker не змінюйте, новий піддомен або база не потрібні. Успадкований GCP_SA_KEY зазвичай уже збережений у Worker, повторний bulk синхронізує саме цей ключ. Якщо Wrangler знову дає внутрішню помилку, не видаляйте Worker: перевірте Deployments, Domains та останні логи `npx.cmd wrangler tail`.

Після deploy відкрийте публічний /login та перевірте Google-вхід. Старий check.mjs ЛР1 після переходу більше не має проходити: читання тепер потребує ID token. Оновіть статус у README та заповніть REPORT-LR2.html тільки справжніми результатами.

## 10. Результати та звіт

```powershell
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
New-Item -ItemType Directory -Force results
npm.cmd run check -- http://localhost:8787 | Tee-Object results/check2-local.txt
npm.cmd run check -- https://lab1-v10-delivery.kruxi-labs.workers.dev | Tee-Object results/check2-cloud.txt
```

Додайте до звіту саме ці тексти моноширинним шрифтом, адреси API та /login, модель доступу, таблицю кодів і посилання на репозиторій. Знімок /login робіть з uid та прихованим полем токена. Не підміняйте хмарні 24/24 результатом тестового стенда. Шаблон уже має ПІБ Стеценко Данило В'ячеславович, групу ПС-23-1 і викладача Магас Олексій Сергійович.

Перед git add перевірте `git status --short --untracked-files=all` та `git check-ignore .dev.vars .test-users.json`. Секретів і node_modules в архіві/репозиторії не має бути. Спрощені завдання про секрет в історії git, видалення bob та додатковий IAM не виконуються.

Офіційні джерела: [токени Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [accounts:lookup](https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/lookup), [ключі Firebase](https://firebase.google.com/docs/projects/api-keys), [Workers assets](https://developers.cloudflare.com/workers/static-assets/binding/). Основні вимоги взято з наданих спрощених методичок ЛР2 та таблиці В10.
