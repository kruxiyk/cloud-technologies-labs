# Лабораторна №1 · В10 «Служба доставки»

JavaScript, Cloudflare Workers Free, Google Cloud Firestore Spark. Проєкт створений за чотирма наданими PDF та гілкою firestore прикладу ХТС_Лаб1_Код.zip. HTTP-маршрути реалізовані стандартним Fetch API без Hono/Zod; перевірка полів і OAuth використовують власні невеликі модулі та Web Crypto. Є 30 посилок і 60 подій.

**Публічна адреса API:** https://lab1-v10-delivery.kruxi-labs.workers.dev **Репозиторій:** https://github.com/kruxiyk/cloud-technologies-labs. API опубліковано, перевірка check.mjs за публічною адресою завершилася PASS 04.11.2026.

## 1. Підготовка

1. Встановіть Node.js 22 або новіший (рекомендовано 24 LTS), розпакуйте архів. Для здачі розмістіть цей каталог у `lr1/` репозиторію.
2. Увімкніть двофакторну автентифікацію Google, Cloudflare, GitHub.
3. Створіть Firebase-проєкт на Spark та Firestore Standard у Native mode, базу `(default)`, правила production mode. Банківську картку й Blaze для цієї роботи не підключайте.
4. Створіть окремий сервісний акаунт `lr1-api`, надайте роль **Cloud Datastore User** (`roles/datastore.user`). Створіть JSON-ключ. Зберігайте його поза репозиторієм. Не використовуйте firebase-adminsdk з надмірними правами.
5. Виконайте `npm install`. Це встановлює Wrangler для запуску й публікації, створює package-lock.json; додайте lock-файл до власного репозиторію. Для офлайн-тестів npm install не потрібний.
6. Скопіюйте `.dev.vars.example` у `.dev.vars`. Замініть ADMIN_TOKEN довгим випадковим секретом. Для GCP_SA_KEY в один рядок вставте повний JSON ключа всередині одинарних лапок. Залиште JSON-послідовності `\n` усередині private_key. Файл `.dev.vars` і ключ не публікуйте.

Генерація секрету: `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`.

## 2. Правила та індекси

Встановіть у Firebase Console → Firestore → Rules вміст `firestore.rules`. Усі прямі клієнтські операції заборонені. Worker автентифікується через IAM: його серверні операції правилами клієнтів не обмежуються.

У Firestore → Indexes створіть composite indexes із `firestore.indexes.json` (collection `parcels`, collection scope):

| Поля | Порядок |
| --- | --- |
| status, city, weight_kg, __name__ | ASC, ASC, DESC, DESC |
| status, created_on, cod_amount | ASC, ASC, ASC |

`__name__` Firestore може додавати автоматично; переконайтеся, що його напрямок DESC для першого індексу. Дочекайтеся стану Enabled. Альтернатива з Firebase CLI: `npx firebase-tools login`, потім `npx firebase-tools deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID`. Firebase CLI не входить у залежності проєкту. Якщо Firestore просить додатковий індекс, точне посилання є в `npx wrangler tail`, не у публічній відповіді.

## 3. Запуск та початкові дані (PowerShell)

```powershell
npm run check:syntax
npm test
npm run dev
```

В іншому вікні PowerShell, у цьому самому каталозі:

```powershell
$env:API_URL = 'http://localhost:8787'
node --env-file=.dev.vars scripts/seed.mjs
node --env-file=.dev.vars check.mjs
node scripts/measure.mjs
```

**Seed запускайте один раз на порожній базі:** POST призначає випадкові id, повторний seed додає дублікати. Локальний Worker звертається до справжньої хмарної Firestore, тому після deploy повторно засівати базу не треба. `generate-data.mjs` відтворює тільки локальний JSON. Набір має 26 доставлених посилок до Києва: перша сторінка 25, друга 1. Повторювана маса дозволяє перевірити додаткове сортування за id.

## 4. Публікація

```powershell
npx wrangler login
npm run deploy
npx wrangler secret bulk .dev.vars
$env:API_URL = 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev'
node --env-file=.dev.vars check.mjs
node scripts/measure.mjs
```

Підставте адресу, яку надрукує deploy. За потреби спочатку виберіть у `wrangler.jsonc` вільне ім’я Worker. До завантаження секретів запити до бази можуть повертати 503, а POST — 401. Для логів: `npx wrangler tail`. Впишіть реальну адресу й репозиторій у README та звіт. Не додавайте секрети до скриншотів.

## 5. Маршрути

| Метод і адреса | Параметри / тіло | Успіх |
| --- | --- | --- |
| GET /api/parcels | обов’язкові status, city; limit=25 (1–100), offset=0 | 200: items, next_offset, next_cursor |
| POST /api/parcels | усі 7 полів посилки, Bearer ADMIN_TOKEN | 201: створена посилка з id |
| GET /api/parcels/:id | Firestore id | 200: посилка |
| GET /api/parcels/stats | day=YYYY-MM-DD | 200: day, total_cod_amount |
| GET /api/parcels/:id/events | без параметрів | 200: items, новіші at першими |
| POST /api/parcels/:id/events | at, location, note; Bearer ADMIN_TOKEN | 201: створена подія |

Відомий маршрут із непідтримуваним методом, включно з PUT/PATCH/DELETE, повертає **405** та Allow. Метод зміни записів таблицею В10 не заданий; наданий приклад і методичка передбачають створення POST. Невідомий маршрут/відсутня посилка: 404; неправильні параметри, поля, дати, JSON: 400; POST без/з неправильним токеном: 401; неправильний Content-Type: 415; завелике тіло: 413; збій бази чи конфігурації: 503.

Посилка: tracking — непорожній рядок; weight_kg — число 0.01–1000; city — рядок; status — `прийнято`, `в дорозі`, `доставлено`, `повернено`; created_on — справжня дата YYYY-MM-DD; fragile — boolean; cod_amount — число 0–500000. Подія: at — UTC ISO 8601 із Z, location і note — непорожні рядки. Невідомі поля заборонені. Трек-номер не оголошений у методичці унікальним: унікальність tracking не нав’язується.

### Три запити та приклади

1. `GET /api/parcels?status=доставлено&city=Київ&limit=25&offset=0`: фільтр стану й міста, weight_kg DESC, при однаковій масі id DESC. Приклад форми: `{"items":[{"id":"ID_FROM_FIRESTORE","tracking":"UA-V10-0001","weight_kg":30,"city":"Київ","status":"доставлено","created_on":"2026-03-15","fragile":true,"cod_amount":100.25}],"next_offset":null,"next_cursor":null}`. Це ілюстрація структури, не збережена відповідь хмарного API.
2. `GET /api/parcels/stats?day=2026-03-15`: `{"day":"2026-03-15","total_cod_amount":16942.25}` для чистого початкового набору. «За день» трактовано за **created_on**, єдиною датою посилки в схемі; обираємо поточний status=доставлено. Для поля типу дата рівність дню еквівалентна проміжку UTC [день 00:00, наступний день 00:00). Це не сума за фактичною датою вручення: такого поля методичка не містить. Для справжнього обліку вручень потрібне окреме поле delivered_at. Порожня сума — 0.
3. `GET /api/parcels/ID_FROM_FIRESTORE/events`: `{"items":[{"id":"EVENT_ID","at":"2026-03-16T10:00:00.000Z","location":"Сортувальний центр","note":"Посилку оброблено"}]}`. Події зберігаються в `parcels/{id}/events/{eventId}`. Зв’язок задає шлях підколекції; додаткового поля parcel_id у документі не потрібно. Усі події читаються без обмеження сторінки, at DESC, id DESC.

Приклад створення посилки:

```powershell
$headers = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
$body = @{tracking='TEST-001'; weight_kg=1.5; city='Київ'; status='прийнято'; created_on='2026-03-15'; fragile=$false; cod_amount=500} | ConvertTo-Json
Invoke-RestMethod "$env:API_URL/api/parcels" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Ця команда потребує ADMIN_TOKEN у середовищі поточного вікна; `--env-file` передає його лише відповідному процесу Node.

## 6. Кеш і метрики

Усі GET 200 мають `Cache-Control: max-age=300`; помилки не кешуються цим заголовком. POST має no-store. Cache API не використовується: це дозвіл браузеру/проміжному кешу зберігати відповідь, а не автоматичний edge-кеш Worker. Після запису клієнт може бачити старий GET до 300 секунд.

На списку **x-read-count — реальний executionStats.readOperations з Firestore Query Explain analyze=true**, а не кількість повернутих елементів. Якщо Explain не повернув метрик, API дає 503, не вигадує показники. Заголовок на одному документі — 1; на events — метрика дочірнього запиту плюс 1 читання батьківського документа. Для агрегації цей заголовок не надається. Node-скрипти виконують нові HTTP-запити й не використовують кеш браузера.

`next_offset` повертається для повної сторінки; повна остання сторінка може вимагати ще одного порожнього запиту, як у наданому прикладі. Додатковий `next_cursor` містить масу, id та фільтри. Передайте його через URLSearchParams як cursor без offset. Курсор використовує значення межі без додаткового читання документа; курсор не є секретом і не захищає дані. Параметри фільтра при продовженні не змінюйте. Пагінація не фіксує snapshot: під час перевірки не змінюйте дані паралельно.

`npm run measure` порівнює дві сторінки offset і cursor, друкує реальні метрики та floor(50000/reads). Це ліміт лише за читаннями, без інших користувачів, консолі, інших запитів і незалежних обмежень Worker. Пропущені offset документи також оплачуються; курсор їх не перечитує. Query Explain Analyze виконує запит і витрачає квоту. Можливі також читання індексних записів; покладайтеся на метрики, не підміняйте їх формулою offset+limit.

Поточні офіційні джерела: [Firestore pricing](https://firebase.google.com/docs/firestore/pricing), [Query Explain](https://firebase.google.com/docs/firestore/query-explain), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/). Firestore має безкоштовну квоту 50000 читань/добу для однієї бази; регіон, індекси та склад запитів впливають на платний облік.

## 7. Перевірки та звіт

`npm test` — автономні тести з пам’яттєвим сховищем та перевіркою REST-запитів адаптера. `npm run check:syntax` перевіряє всі JS-файли. `check.mjs` — власна автоматична перевірка за вимогами методички (готового викладацького check.mjs у прикладі немає). Вона очікує рівно початкові дані, перевіряє 25+1, курсор, статистику, події, статуси, кеш і відмову без токена. З ADMIN_TOKEN додатково перевіряє авторизовану валідацію. Успішне створення перевіряється автономними тестами та seed-скриптом.

Для збереження фактичних результатів:

```powershell
New-Item -ItemType Directory -Force results
node --env-file=.dev.vars check.mjs | Tee-Object results/cloud-check.txt
node scripts/measure.mjs | Tee-Object results/cloud-reads.jsonl
nslookup YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
curl.exe -si "$env:API_URL/api/parcels/stats?day=2026-03-15"
```

Відкрийте `REPORT.html` у браузері, заповніть позначені поля й таблиці справжніми даними, за потреби надрукуйте у PDF. Шаблон не містить вигаданих адрес, IP, cf-ray чи хмарних вимірів. Локальний протокол перевірки додано окремо.
